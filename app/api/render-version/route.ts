import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFile = promisify(require("child_process").execFile);

interface Scene {
  start: number;
  end: number;
  duration: number;
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
}

async function downloadVideo(
  videoUrl: string,
  outputPath: string
): Promise<void> {
  const response = await fetch(videoUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to download source video: ${response.status} ${response.statusText}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();

  await fs.promises.writeFile(
    outputPath,
    Buffer.from(arrayBuffer)
  );
}

async function renderScenes(
  inputPath: string,
  outputPath: string,
  scenes: Scene[]
): Promise<void> {
  if (scenes.length === 0) {
    throw new Error("No scenes available for rendering.");
  }

  const filterParts: string[] = [];

  scenes.forEach((scene, index) => {
    filterParts.push(
      `[0:v]trim=start=${scene.start}:end=${scene.end},setpts=PTS-STARTPTS[v${index}]`
    );

    filterParts.push(
      `[0:a]atrim=start=${scene.start}:end=${scene.end},asetpts=PTS-STARTPTS[a${index}]`
    );
  });

  const concatInputs = scenes
    .map((_, index) => `[v${index}][a${index}]`)
    .join("");

  filterParts.push(
    `${concatInputs}concat=n=${scenes.length}:v=1:a=1[outv][outa]`
  );

  const filterComplex = filterParts.join(";");

  const args = [
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[outv]",
    "-map",
    "[outa]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ];

  try {
    await execFile("ffmpeg", args, {
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const ffmpegError = error as {
      message?: string;
      stderr?: string;
    };

    throw new Error(
      `FFmpeg render failed: ${
        ffmpegError.message || "Unknown FFmpeg error"
      }\n${ffmpegError.stderr || ""}`
    );
  }
}

export async function POST(request: Request) {
  let sourcePath: string | null = null;
  let outputPath: string | null = null;

  try {
    const { versionId } = await request.json();

    if (!versionId) {
      return NextResponse.json(
        { error: "Missing versionId" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data: version, error: versionError } =
      await supabase
        .from("video_versions")
        .select("*")
        .eq("id", versionId)
        .single();

    if (versionError || !version) {
      return NextResponse.json(
        {
          error:
            versionError?.message ||
            "Version not found.",
        },
        { status: 404 }
      );
    }

    const { data: task, error: taskError } =
      await supabase
        .from("tasks")
        .select("id, video_url, status")
        .eq("id", version.task_id)
        .single();

    if (taskError || !task) {
      return NextResponse.json(
        {
          error:
            taskError?.message ||
            "Task not found.",
        },
        { status: 404 }
      );
    }

    if (!task.video_url) {
      return NextResponse.json(
        {
          error: "Task does not have an uploaded video.",
        },
        { status: 400 }
      );
    }

    const scenes = Array.isArray(version.scenes)
      ? (version.scenes as Scene[])
      : [];

    if (scenes.length === 0) {
      return NextResponse.json(
        {
          error: "This version does not contain any scenes.",
        },
        { status: 400 }
      );
    }

    for (const scene of scenes) {
      if (
        !Number.isFinite(scene.start) ||
        !Number.isFinite(scene.end) ||
        scene.start < 0 ||
        scene.end <= scene.start
      ) {
        return NextResponse.json(
          {
            error: "Version contains invalid scene timestamps.",
          },
          { status: 400 }
        );
      }
    }

    const tempDir = os.tmpdir();

    sourcePath = path.join(
      tempDir,
      `render-source-${Date.now()}.mp4`
    );

    outputPath = path.join(
      tempDir,
      `render-output-${Date.now()}.mp4`
    );

    console.log(
      `Downloading source video for version ${version.version_number}...`
    );

    await downloadVideo(
      task.video_url,
      sourcePath
    );

    console.log(
      `Rendering version ${version.version_number} with ${scenes.length} scenes...`
    );

    await renderScenes(
      sourcePath,
      outputPath,
      scenes
    );

    const renderedBuffer =
      await fs.promises.readFile(outputPath);

    const storagePath =
      `${task.id}/renders/v${version.version_number}.mp4`;

    console.log(
      `Uploading rendered video to ${storagePath}...`
    );

    const { error: uploadError } =
      await supabase.storage
        .from("videos")
        .upload(
          storagePath,
          renderedBuffer,
          {
            contentType: "video/mp4",
            upsert: true,
          }
        );

    if (uploadError) {
      throw new Error(
        `Failed to upload rendered video: ${uploadError.message}`
      );
    }

    const {
      data: publicUrlData,
    } = supabase.storage
      .from("videos")
      .getPublicUrl(storagePath);

    const renderUrl =
      `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { data: updatedVersion, error: updateError } =
      await supabase
        .from("video_versions")
        .update({
          render_url: renderUrl,
        })
        .eq("id", versionId)
        .select()
        .single();

    if (updateError) {
      throw new Error(
        `Failed to save render URL: ${updateError.message}`
      );
    }

    if (task.status !== "review") {
      const { error: taskUpdateError } = await supabase
        .from("tasks")
        .update({
          status: "review",
        })
        .eq("id", task.id);

      if (taskUpdateError) {
        throw new Error(
          `Failed to update task status to review: ${taskUpdateError.message}`
        );
      }
    }

    console.log(
      `Version ${version.version_number} rendered successfully.`
    );

    return NextResponse.json({
      success: true,
      version: updatedVersion,
      task: task.status === "review" ? task : { ...task, status: "review" },
      renderUrl,
    });
  } catch (error) {
    console.error(
      "Render version route error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown render error.",
      },
      { status: 500 }
    );
  } finally {
    if (sourcePath) {
      try {
        await fs.promises.unlink(sourcePath);
      } catch {}
    }

    if (outputPath) {
      try {
        await fs.promises.unlink(outputPath);
      } catch {}
    }
  }
}
