import { spawn } from 'node:child_process';
import { writeFile, readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

/**
 * Ghép 1 ảnh (end-card) thành ~N giây ở CUỐI video, giữ nguyên độ phân giải video
 * (scale2ref co ảnh về đúng khổ video). Audio gốc giữ nguyên (end-card im lặng).
 * Dùng ffmpeg-static (binary đóng gói, không cần cài trên server).
 */
export async function appendImageToVideo(
  videoBuffer: Buffer,
  pngBuffer: Buffer,
  seconds = 3,
): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('Không tìm thấy ffmpeg-static binary');

  const dir = await mkdtemp(join(tmpdir(), 'copee-vid-'));
  const inVid = join(dir, 'in.mp4');
  const inImg = join(dir, 'card.png');
  const outVid = join(dir, 'out.mp4');

  try {
    await writeFile(inVid, videoBuffer);
    await writeFile(inImg, pngBuffer);

    // Chuẩn hoá cả 2 về 1080x1920 30fps rồi nối (video trước, end-card sau).
    // Upscale video Omni 720p -> 1080p luôn, end-card native 1080p.
    const filter =
      '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p[v];' +
      '[1:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p[c];' +
      '[v][c]concat=n=2:v=1:a=0[outv]';

    const args = [
      '-y',
      '-i', inVid,
      '-loop', '1', '-t', String(seconds), '-i', inImg,
      '-filter_complex', filter,
      '-map', '[outv]',
      '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      outVid,
    ];

    await new Promise<void>((resolve, reject) => {
      const p = spawn(ffmpegPath as string, args);
      let err = '';
      p.stderr.on('data', (d) => { err += d.toString(); if (err.length > 8000) err = err.slice(-8000); });
      p.on('error', reject);
      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg thoát mã ${code}: ${err.slice(-600)}`));
      });
    });

    return await readFile(outVid);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
