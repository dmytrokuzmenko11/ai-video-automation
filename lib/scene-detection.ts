import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const ffmpegExecutable = 'ffmpeg';

ffmpeg.setFfmpegPath(ffmpegExecutable);

export interface Scene {
  start: number;
  end: number;
  duration: number;
}

export interface SceneDetectionResult {
  scenes: Scene[];
  count: number;
}

async function getVideoDuration(
  inputPath: string
): Promise<number> {
  try {
    const { stderr } = await execFileAsync(
      ffmpegExecutable,
      [
        '-hide_banner',
        '-i',
        inputPath,
        '-f',
        'null',
        '-',
      ],
      {
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const match = stderr.match(
      /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/
    );

    if (!match) {
      throw new Error(
        'Could not determine video duration from FFmpeg output.'
      );
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);

    const duration =
      hours * 3600 +
      minutes * 60 +
      seconds;

    if (
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      throw new Error(
        'FFmpeg returned an invalid video duration.'
      );
    }

    return duration;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown FFmpeg error';

    throw new Error(
      `Could not determine video duration: ${message}`
    );
  }
}

function parseSceneTimestamps(
  output: string
): number[] {
  const timestamps: number[] = [];

  const regex =
    /pts_time:([0-9]+(?:\.[0-9]+)?)/g;

  let match: RegExpExecArray | null;

  while ((match = regex.exec(output)) !== null) {
    const timestamp = Number.parseFloat(match[1]);

    if (Number.isFinite(timestamp)) {
      timestamps.push(timestamp);
    }
  }

  return timestamps;
}

function filterCloseCuts(
  timestamps: number[],
  minGap = 0.35
): number[] {
  const sorted = [...timestamps].sort(
    (a, b) => a - b
  );

  const filtered: number[] = [];

  for (const timestamp of sorted) {
    if (
      filtered.length === 0 ||
      timestamp - filtered[filtered.length - 1] >= minGap
    ) {
      filtered.push(timestamp);
    }
  }

  return filtered;
}

function createScenes(
  duration: number,
  cutTimestamps: number[]
): Scene[] {
  const filteredCuts = filterCloseCuts(
    cutTimestamps,
    0.35
  );

  const uniqueCuts = Array.from(
    new Set(
      filteredCuts
        .filter(
          (timestamp) =>
            timestamp > 0 &&
            timestamp < duration
        )
        .map((timestamp) =>
          Number(timestamp.toFixed(3))
        )
    )
  ).sort((a, b) => a - b);

  const scenes: Scene[] = [];

  let sceneStart = 0;

  for (const cutTimestamp of uniqueCuts) {
    if (cutTimestamp <= sceneStart) {
      continue;
    }

    const sceneDuration =
      cutTimestamp - sceneStart;

    if (sceneDuration > 0) {
      scenes.push({
        start: sceneStart,
        end: cutTimestamp,
        duration: sceneDuration,
      });
    }

    sceneStart = cutTimestamp;
  }

  if (duration > sceneStart) {
    scenes.push({
      start: sceneStart,
      end: duration,
      duration: duration - sceneStart,
    });
  }

  return scenes;
}

function runSceneDetection(
  inputPath: string,
  threshold: number
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath)
      .videoFilters(
        `select='gt(scene,${threshold})',showinfo`
      )
      .noAudio()
      .outputOptions('-f', 'null')
      .output('-');

    let stderr = '';

    command.on('stderr', (line: string) => {
      stderr += `${line}\n`;
    });

    command.on('end', () => {
      resolve(
        parseSceneTimestamps(stderr)
      );
    });

    command.on(
      'error',
      (error: Error) => {
        reject(
          new Error(
            `FFmpeg scene detection failed: ${error.message}\n${stderr}`
          )
        );
      }
    );

    command.run();
  });
}

async function downloadVideo(
  videoUrl: string,
  outputPath: string
): Promise<void> {
  const response = await fetch(videoUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to download video: ${response.status} ${response.statusText}`
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  await fs.promises.writeFile(
    outputPath,
    Buffer.from(arrayBuffer)
  );
}

export async function detectScenes(
  input: string,
  threshold = 0.12
): Promise<SceneDetectionResult> {
  if (
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 1
  ) {
    throw new Error(
      'Scene detection threshold must be between 0 and 1.'
    );
  }

  const isUrl =
    input.startsWith('http://') ||
    input.startsWith('https://');

  let inputPath = input;
  let temporaryFile: string | null = null;

  try {
    if (isUrl) {
      const extension =
        path.extname(
          new URL(input).pathname
        ) || '.mp4';

      temporaryFile = path.join(
        os.tmpdir(),
        `scene-detection-${Date.now()}${extension}`
      );

      console.log(
        `Downloading video for scene detection: ${input}`
      );

      await downloadVideo(
        input,
        temporaryFile
      );

      inputPath = temporaryFile;
    }

    console.log(
      `Starting scene detection. Threshold: ${threshold}`
    );

    const duration =
      await getVideoDuration(inputPath);

    console.log(
      `Video duration: ${duration.toFixed(3)} seconds`
    );

    const cutTimestamps =
      await runSceneDetection(
        inputPath,
        threshold
      );

    const scenes = createScenes(
      duration,
      cutTimestamps
    );

    console.log(
      `Scene detection completed. Raw cuts: ${cutTimestamps.length}, scenes: ${scenes.length}`
    );

    return {
      scenes,
      count: scenes.length,
    };
  } finally {
    if (temporaryFile) {
      try {
        await fs.promises.unlink(
          temporaryFile
        );

        console.log(
          `Temporary video file removed: ${temporaryFile}`
        );
      } catch (error) {
        console.error(
          'Failed to remove temporary video file:',
          error
        );
      }
    }
  }
}
