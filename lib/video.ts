import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';

export async function generateVideo(title: string, taskId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const outputDir = path.join(process.cwd(), 'public', 'videos');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, `${taskId}.mp4`);
    const cleanTitle = title.replace(/['"\\]/g, '');

    ffmpeg()
      .input('color=c=black:s=1280x720:d=5')
      .inputFormat('lavfi')
      .videoFilters([
        {
          filter: 'drawtext',
          options: {
            text: cleanTitle,
            fontsize: 48,
            fontcolor: 'white',
            x: '(w-text_w)/2',
            y: '(h-text_h)/2',
          },
        },
      ])
      .outputOptions(['-c:v libx264', '-pix_fmt yuv420p'])
      .output(outputPath)
      .on('end', () => {
        resolve(`/videos/${taskId}.mp4`);
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        reject(err);
      })
      .run();
  });
}
