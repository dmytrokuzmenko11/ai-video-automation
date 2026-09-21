import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { spawn } from "child_process";
import { getErrorMessage, getErrorStack, logError } from "@/lib/error-logger";

const execFile = promisify(require("child_process").execFile);

interface Scene {
  start: number;
  end: number;
  duration: number;
}

const FFPROBE_TIMEOUT_MS = 30_000;
const FFmpeg_TIMEOUT_MS = 20 * 60_000;
const SCENE_EPSILON = 0.001;
const MIN_EFFECTIVE_SCENE_DURATION = 0.04;

function formatSceneValue(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function createFfmpegFailureError({
  stage,
  message,
  stdout = "",
  stderr = "",
  exitCode = null,
  signal = null,
}: {
  stage: string;
  message: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
}) {
  const details = [
    `stage=${stage}`,
    `exitCode=${exitCode ?? "null"}`,
    `signal=${signal ?? "null"}`,
    stdout ? `stdout=${stdout.slice(-3000)}` : null,
    stderr ? `stderr=${stderr.slice(-5000)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const error = new Error(`${message}\n${details}`) as Error & {
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    stage?: string;
  };

  error.stdout = stdout;
  error.stderr = stderr;
  error.exitCode = exitCode;
  error.signal = signal;
  error.stage = stage;

  return error;
}

function validateScenes(
  scenes: Scene[],
  sourceDuration?: number
): { valid: true } | { valid: false; error: string } {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return { valid: false, error: "No scenes available for rendering." };
  }

  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const start = Number(scene.start);
    const end = Number(scene.end);
    const effectiveDuration = end - start;

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start
    ) {
      return {
        valid: false,
        error: `Invalid scene range at index ${index}: start=${scene.start}, end=${scene.end}`,
      };
    }

    if (Number.isFinite(sourceDuration) && end > (sourceDuration ?? 0) + 0.05) {
      return {
        valid: false,
        error: `Scene ${index} exceeds source duration: end=${scene.end}, sourceDuration=${sourceDuration}`,
      };
    }

    if (effectiveDuration < MIN_EFFECTIVE_SCENE_DURATION) {
      return {
        valid: false,
        error: `Scene ${index} is too short to render safely: start=${scene.start}, end=${scene.end}, duration=${effectiveDuration}`,
      };
    }

  }

  return { valid: true };
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
  const startedAt = Date.now();
  const timeoutMs = 60_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  console.log("[RENDER] source download started", {
    videoUrl,
    outputPath,
    timeoutMs,
  });

  try {
    const response = await fetch(videoUrl, { signal: controller.signal });

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

    console.log("[RENDER] source download completed", {
      videoUrl,
      outputPath,
      elapsedMs: Date.now() - startedAt,
      bytes: Buffer.from(arrayBuffer).length,
    });
  } catch (error) {
    console.error("[RENDER] source download failed", {
      videoUrl,
      outputPath,
      elapsedMs: Date.now() - startedAt,
      timeoutMs,
      error: getErrorMessage(error),
    });

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function probeMedia(inputPath: string): Promise<{
  duration?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  hasAudio: boolean;
}> {
  return new Promise((resolve, reject) => {
    const probe = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=index,codec_type,width,height,avg_frame_rate,r_frame_rate",
      "-of",
      "json",
      inputPath,
    ]);

    let stdout = "";
    let stderr = "";

    const timeoutId = setTimeout(() => {
      probe.kill("SIGKILL");
      reject(new Error(`ffprobe timed out after ${FFPROBE_TIMEOUT_MS}ms for ${inputPath}`));
    }, FFPROBE_TIMEOUT_MS);

    probe.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    probe.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    probe.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    probe.on("close", (code) => {
      clearTimeout(timeoutId);
      if (code !== 0) {
        reject(new Error(`ffprobe failed: ${stderr || stdout || `exit ${code}`}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as {
          format?: { duration?: string };
          streams?: Array<{
            codec_type?: string;
            width?: number;
            height?: number;
            avg_frame_rate?: string;
            r_frame_rate?: string;
          }>;
        };

        const videoStream = parsed.streams?.find((stream) => stream.codec_type === "video");
        const audioStream = parsed.streams?.find((stream) => stream.codec_type === "audio");
        const rateString = videoStream?.avg_frame_rate || videoStream?.r_frame_rate || "0/1";
        const [numerator, denominator] = rateString.split("/").map((value) => Number(value));
        const frameRate = denominator ? numerator / denominator : undefined;

        resolve({
          duration: parsed.format?.duration ? Number(parsed.format.duration) : undefined,
          width: videoStream?.width,
          height: videoStream?.height,
          frameRate: Number.isFinite(frameRate) ? frameRate : undefined,
          hasAudio: Boolean(audioStream),
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function normalizeSourceVideo(
  inputPath: string,
  outputPath: string,
  sourceProbe: { duration?: number; width?: number; height?: number; frameRate?: number; hasAudio: boolean }
): Promise<void> {
  const targetFps = 25;
  const evenWidth = Math.max(2, Math.floor((sourceProbe.width ?? 1280) / 2) * 2);
  const evenHeight = Math.max(2, Math.floor((sourceProbe.height ?? 720) / 2) * 2);
  const filterParts = [
    `[0:v]scale=${evenWidth}:${evenHeight},fps=${targetFps},format=yuv420p,setpts=PTS-STARTPTS[vout]`,
  ];

  if (sourceProbe.hasAudio) {
    filterParts.push(`[0:a]aformat=channel_layouts=stereo:sample_rates=44100,asetpts=PTS-STARTPTS[aout]`);
  } else {
    filterParts.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${sourceProbe.duration ?? 0},asetpts=PTS-STARTPTS[aout]`);
  }

  const args = sourceProbe.hasAudio
    ? [
        "-y",
        "-i",
        inputPath,
        "-filter_complex",
        filterParts.join(";"),
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "28",
        "-pix_fmt",
        "yuv420p",
        "-fps_mode",
        "cfr",
        "-c:a",
        "aac",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "-threads",
        "1",
        outputPath,
      ]
    : [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `anullsrc=channel_layout=stereo:sample_rate=44100`,
        "-i",
        inputPath,
        "-filter_complex",
        filterParts.join(";"),
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-shortest",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "28",
        "-pix_fmt",
        "yuv420p",
        "-fps_mode",
        "cfr",
        "-c:a",
        "aac",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "-threads",
        "1",
        outputPath,
      ];

  console.log("[RENDER] normalize video command", { inputPath, outputPath, args });

  const startedAt = Date.now();
  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let terminatedBySignal: NodeJS.Signals | null = null;
    const timeoutId = setTimeout(() => {
      ffmpeg.kill("SIGKILL");
      reject(
        createFfmpegFailureError({
          stage: "normalize",
          message: `FFmpeg normalization timed out after ${FFmpeg_TIMEOUT_MS}ms`,
          stdout,
          stderr,
          exitCode: null,
          signal: "SIGKILL",
        })
      );
    }, FFmpeg_TIMEOUT_MS);

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
    ffmpeg.on("exit", (_code, signal) => {
      terminatedBySignal = signal;
    });
    ffmpeg.on("close", (code) => {
      clearTimeout(timeoutId);
      if (code === 0) {
        console.log("[RENDER] normalize video completed", {
          inputPath,
          outputPath,
          elapsedMs: Date.now() - startedAt,
        });
        resolve();
        return;
      }

      console.error("[RENDER] normalize video failed", {
        inputPath,
        outputPath,
        elapsedMs: Date.now() - startedAt,
        exitCode: code,
        signal: terminatedBySignal,
        args,
        stderrTail: stderr.split(/\r?\n/).slice(-100).join("\n"),
      });
      reject(
        createFfmpegFailureError({
          stage: "normalize",
          message: `FFmpeg normalize failed: FFmpeg exited with code ${code ?? "unknown"}`,
          stdout,
          stderr,
          exitCode: code,
          signal: terminatedBySignal,
        })
      );
    });
  });
}

async function decodeOnlyTest(inputPath: string): Promise<void> {
  const args = [
    "-v",
    "error",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-f",
    "null",
    "-",
  ];

  console.log("[RENDER] decode test command", { inputPath, args });

  const startedAt = Date.now();
  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let terminatedBySignal: NodeJS.Signals | null = null;

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("error", reject);
    ffmpeg.on("exit", (_code, signal) => {
      terminatedBySignal = signal;
    });
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        console.log("[RENDER] decode test completed", {
          inputPath,
          elapsedMs: Date.now() - startedAt,
        });
        resolve();
        return;
      }

      const error = new Error(`FFmpeg decode test failed: FFmpeg exited with code ${code ?? "unknown"}`) as Error & {
        stdout?: string;
        stderr?: string;
        exitCode?: number | null;
        signal?: NodeJS.Signals | null;
        args?: string[];
      };

      error.stdout = stdout;
      error.stderr = stderr;
      error.exitCode = code;
      error.signal = terminatedBySignal;
      error.args = args;

      console.error("[RENDER] decode test failed", {
        inputPath,
        elapsedMs: Date.now() - startedAt,
        exitCode: code,
        signal: terminatedBySignal,
        args,
        stderrTail: stderr.split(/\r?\n/).slice(-100).join("\n"),
      });

      reject(error);
    });
  });
}

async function probeOutputFile(outputPath: string): Promise<{
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
}> {
  return new Promise((resolve, reject) => {
    const probe = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type",
      "-of",
      "json",
      outputPath,
    ]);

    let stdout = "";
    let stderr = "";
    const timeoutId = setTimeout(() => {
      probe.kill("SIGKILL");
      reject(new Error(`ffprobe output validation timed out after ${FFPROBE_TIMEOUT_MS}ms for ${outputPath}`));
    }, FFPROBE_TIMEOUT_MS);

    probe.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    probe.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    probe.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    probe.on("close", (code) => {
      clearTimeout(timeoutId);
      if (code !== 0) {
        reject(new Error(`ffprobe output validation failed: ${stderr || stdout || `exit ${code}`}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as {
          format?: { duration?: string };
          streams?: Array<{ codec_type?: string }>;
        };

        resolve({
          duration: parsed.format?.duration ? Number(parsed.format.duration) : 0,
          hasVideo: Boolean(parsed.streams?.some((stream) => stream.codec_type === "video")),
          hasAudio: Boolean(parsed.streams?.some((stream) => stream.codec_type === "audio")),
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function renderScenes(
  inputPath: string,
  outputPath: string,
  scenes: Scene[],
  encoderPreset: "veryfast" | "ultrafast" = "veryfast"
): Promise<void> {
  if (scenes.length === 0) {
    throw new Error("No scenes available for rendering.");
  }

  const filterParts: string[] = [];
  const hasAudioConcat = true;

  console.log("[RENDER] montage scenes", scenes.map((scene, index) => ({
    index,
    start: scene.start,
    end: scene.end,
    duration: Number((scene.end - scene.start).toFixed(3)),
  })));

  scenes.forEach((scene, index) => {
    const start = formatSceneValue(scene.start);
    const end = formatSceneValue(scene.end);
    filterParts.push(
      `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fps=25,format=yuv420p[v${index}]`
    );

    filterParts.push(
      `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo[a${index}]`
    );
  });

  const concatInputs = scenes
    .map((_, index) => `[v${index}][a${index}]`)
    .join("");

  filterParts.push(
    `${concatInputs}concat=n=${scenes.length}:v=1:a=${hasAudioConcat ? 1 : 0}[outv]${hasAudioConcat ? "[outa]" : ""}`
  );

  const filterComplex = filterParts.join(";");

  console.log("[RENDER] montage filtergraph", { inputPath, outputPath, filterComplex });

  const args = [
    "-y",
    "-i",
    inputPath,
    "-filter_threads",
    "1",
    "-filter_complex_threads",
    "1",
    "-filter_complex",
    filterComplex,
    "-map",
    "[outv]",
    "-map",
    "[outa]",
    "-c:v",
    "libx264",
    "-preset",
    encoderPreset,
    "-crf",
    "20",
    "-profile:v",
    "high",
    "-level:v",
    "4.0",
    "-r",
    "25",
    "-pix_fmt",
    "yuv420p",
    "-threads",
    "1",
    "-x264-params",
    "threads=1",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  try {
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      const timeoutId = setTimeout(() => {
        ffmpeg.kill("SIGKILL");
        reject(
          createFfmpegFailureError({
            stage: "montage",
            message: `FFmpeg montage timed out after ${FFmpeg_TIMEOUT_MS}ms`,
            stdout,
            stderr,
            exitCode: null,
            signal: "SIGKILL",
          })
        );
      }, FFmpeg_TIMEOUT_MS);

      ffmpeg.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      ffmpeg.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      ffmpeg.on("error", (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });

      ffmpeg.on("close", (code, signal) => {
        clearTimeout(timeoutId);
        if (code === 0) {
          resolve();
          return;
        }

        reject(
          createFfmpegFailureError({
            stage: "montage",
            message: `FFmpeg exited with code ${code ?? "unknown"}`,
            stdout,
            stderr,
            exitCode: code,
            signal,
          })
        );
      });
    });
  } catch (error) {
    void logError({
      stage: "ffmpeg",
      type: "ffmpeg_error",
      message: getErrorMessage(error),
      stackTrace: getErrorStack(error),
    });

    const ffmpegError = error as {
      message?: string;
      stderr?: string;
      stdout?: string;
    };

    const ffmpegOutput =
      ffmpegError.stderr || ffmpegError.stdout || "";

    throw new Error(
      `FFmpeg render failed: ${
        ffmpegError.message || "Unknown FFmpeg error"
      }\n${ffmpegOutput}`
    );
  }
}

async function renderScenesWithFallback(
  inputPath: string,
  outputPath: string,
  scenes: Scene[]
): Promise<{ presetUsed: "veryfast" | "ultrafast" }> {
  try {
    await renderScenes(inputPath, outputPath, scenes, "veryfast");
    return { presetUsed: "veryfast" };
  } catch (error) {
    const ffmpegError = error as { message?: string; stderr?: string; stdout?: string };
    const stderr = `${ffmpegError.stderr || ""}\n${ffmpegError.stdout || ""}`;
    const killedBySignal = stderr.includes("signal=SIGKILL") || stderr.includes("Killed");

    if (!killedBySignal) {
      throw error;
    }

    console.warn("[RENDER] montage killed with veryfast preset, retrying with ultrafast fallback");
    await renderScenes(inputPath, outputPath, scenes, "ultrafast");
    return { presetUsed: "ultrafast" };
  }
}

export async function POST(request: Request) {
  let sourcePath: string | null = null;
  let normalizedSourcePath: string | null = null;
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

    const tempDir = os.tmpdir();

    sourcePath = path.join(
      tempDir,
      `render-source-${Date.now()}.mp4`
    );

    normalizedSourcePath = path.join(
      tempDir,
      `render-normalized-${Date.now()}.mp4`
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

    const sourceProbe = await probeMedia(sourcePath);

    await decodeOnlyTest(sourcePath);

    await normalizeSourceVideo(sourcePath, normalizedSourcePath, sourceProbe);

    const normalizedProbe = await probeMedia(normalizedSourcePath);

    const validation = validateScenes(scenes, normalizedProbe.duration ?? sourceProbe.duration);

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    console.log(
      `Rendering version ${version.version_number} with ${scenes.length} scenes...`
    );

    console.log("[RENDER] montage scenes", scenes.map((scene, index) => ({
      index,
      start: scene.start,
      end: scene.end,
      duration: Number((scene.end - scene.start).toFixed(3)),
    })));

    console.log("[RENDER] montage filtergraph", scenes.map((scene, index) => {
      const start = formatSceneValue(scene.start);
      const end = formatSceneValue(scene.end);
      return {
        index,
        video: `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fps=25,format=yuv420p[v${index}]`,
        audio: `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo[a${index}]`,
      };
    }));

    const renderAttempt = await renderScenesWithFallback(
      normalizedSourcePath,
      outputPath,
      scenes
    );

    console.log("[RENDER] montage preset used", renderAttempt.presetUsed);

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
      throw new Error("Rendered output was not created.");
    }

    const outputProbe = await probeOutputFile(outputPath);

    if (!outputProbe.hasVideo || !outputProbe.hasAudio || outputProbe.duration <= 0) {
      throw new Error(
        `Rendered output validation failed: hasVideo=${outputProbe.hasVideo}, hasAudio=${outputProbe.hasAudio}, duration=${outputProbe.duration}`
      );
    }

    const renderedBuffer =
      await fs.promises.readFile(outputPath);

    const storagePath =
      `${task.id}/renders/v${version.version_number}.mp4`;

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

    const taskId =
      error instanceof Error && "taskId" in error
        ? (error as { taskId?: string }).taskId ?? null
        : null;

    void logError({
      stage: "render",
      type: "render_error",
      message: getErrorMessage(error),
      stackTrace: getErrorStack(error),
      taskId,
    });

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

    if (normalizedSourcePath) {
      try {
        await fs.promises.unlink(normalizedSourcePath);
      } catch {}
    }

    if (outputPath) {
      try {
        await fs.promises.unlink(outputPath);
      } catch {}
    }
  }
}
