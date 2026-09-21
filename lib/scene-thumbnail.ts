import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage, getErrorStack, logError } from "./error-logger";

const execFileAsync = promisify(execFile);
const ffmpegExecutable = "ffmpeg";
const THUMBNAIL_BUCKET = "videos";
const THUMBNAIL_WIDTH = 240;

ffmpeg.setFfmpegPath(ffmpegExecutable);

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
}

async function downloadVideo(videoUrl: string, outputPath: string): Promise<void> {
  const response = await fetch(videoUrl);

  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await fs.promises.writeFile(outputPath, Buffer.from(arrayBuffer));
}

function clampTimestamp(timestamp: number, duration?: number): number {
  const upperBound = Number.isFinite(duration) && duration && duration > 0 ? Math.max(duration - 0.05, 0) : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(timestamp, upperBound));
}

export function getSceneThumbnailTime(start: number, end: number): number {
  return start + (end - start) / 2;
}

async function extractFrame(
  inputPath: string,
  timestamp: number,
  outputPath: string
): Promise<void> {
  const args = [
    "-y",
    "-ss",
    String(timestamp),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-vf",
    `scale=${THUMBNAIL_WIDTH}:-2:flags=lanczos`,
    "-q:v",
    "4",
    outputPath,
  ];

  try {
    await execFileAsync(ffmpegExecutable, args, { maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    void logError({
      stage: "ffmpeg",
      type: "ffmpeg_error",
      message: getErrorMessage(error),
      stackTrace: getErrorStack(error),
    });
    throw error;
  }
}

export async function generateSceneThumbnail(options: {
  videoUrl: string;
  taskId: string;
  versionNumber: number;
  sceneIndex: number;
  start: number;
  end: number;
  duration?: number;
}): Promise<string> {
  const { videoUrl, taskId, versionNumber, sceneIndex, start, end, duration } = options;
  const supabase = getSupabaseAdmin();
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "scene-thumb-"));
  const sourcePath = path.join(tempDir, `source-${Date.now()}.mp4`);
  const outputPath = path.join(tempDir, `thumb-${Date.now()}.jpg`);

  try {
    const isUrl = videoUrl.startsWith("http://") || videoUrl.startsWith("https://");
    if (isUrl) {
      await downloadVideo(videoUrl, sourcePath);
    } else {
      throw new Error("Unsupported video reference for thumbnail extraction.");
    }

    const timestamp = clampTimestamp(getSceneThumbnailTime(start, end), duration);
    await extractFrame(sourcePath, timestamp, outputPath);

    const thumbnailBuffer = await fs.promises.readFile(outputPath);
    if (thumbnailBuffer.length === 0) {
      throw new Error("Generated thumbnail file is empty.");
    }

    const storagePath = `${taskId}/thumbnails/v${versionNumber}/scene-${sceneIndex}.jpg`;

    const { error: uploadError } = await supabase.storage.from(THUMBNAIL_BUCKET).upload(storagePath, thumbnailBuffer, {
      contentType: "image/jpeg",
      upsert: true,
    });

    if (uploadError) {
      throw new Error(`Failed to upload scene thumbnail: ${uploadError.message}`);
    }

    const { data: publicUrlData } = supabase.storage.from(THUMBNAIL_BUCKET).getPublicUrl(storagePath);
    const publicUrl = publicUrlData.publicUrl;

    if (!publicUrl) {
      throw new Error("Supabase did not return a public thumbnail URL.");
    }

    // Verify the object is actually retrievable from the browser-facing URL before returning it.
    const verifyResponse = await fetch(publicUrl);
    if (!verifyResponse.ok) {
      throw new Error(`Thumbnail URL is not browser-accessible: ${verifyResponse.status} ${verifyResponse.statusText}`);
    }

    return `${publicUrl}?v=${Date.now()}`;
  } catch (error) {
    void logError({
      stage: "ffmpeg",
      type: "thumbnail_error",
      message: getErrorMessage(error),
      stackTrace: getErrorStack(error),
    });
    throw error;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
