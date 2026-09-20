/**
 * Ghép nhiều clip mp4 thành một video và lấy khung hình cuối của một clip.
 *
 * Chỉ dùng cho video kể chuyện nhiều clip (người dùng chọn 3 clip ~24s):
 *  - `lastFrameJpeg`: lấy khung cuối clip trước làm ảnh khởi tạo clip sau, để AI giữ
 *    NGUYÊN một người / một bối cảnh xuyên suốt (không có ảnh mồi thì mỗi clip ra một người khác);
 *  - `concatMp4`: nối các clip lại, chuẩn hoá về cùng khung hình dọc Full HD.
 *
 * Binary lấy từ gói npm `ffmpeg-static` — máy chủ không cần cài ffmpeg riêng.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);
/** Ghép/giải mã vài clip ngắn chỉ mất vài giây; quá ngưỡng này coi như treo. */
const FFMPEG_TIMEOUT_MS = 120_000;

function binary(): string {
  if (!ffmpegPath)
    throw new Error(
      'Không tìm thấy ffmpeg (gói ffmpeg-static chưa cài đặt xong)',
    );
  return ffmpegPath;
}

async function ffmpeg(args: string[]): Promise<void> {
  await run(binary(), ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    timeout: FFMPEG_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** Thư mục tạm riêng cho mỗi lần chạy, luôn dọn kể cả khi lỗi. */
async function inTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'copee-video-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Khung hình cuối của clip, trả về JPEG. */
export async function lastFrameJpeg(
  video: Buffer,
): Promise<{ data: string; mime: string }> {
  return inTempDir(async (dir) => {
    const input = join(dir, 'in.mp4');
    const output = join(dir, 'last.jpg');
    await writeFile(input, video);
    // -sseof -0.3: nhảy tới 0,3 giây cuối rồi lấy 1 khung — nhanh hơn duyệt cả video.
    await ffmpeg([
      '-sseof',
      '-0.3',
      '-i',
      input,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      output,
    ]);
    const jpg = await readFile(output);
    return { data: jpg.toString('base64'), mime: 'image/jpeg' };
  });
}

/** Khung hình đích khi ghép: dọc Full HD, khớp khung Veo trả về. */
const OUT_WIDTH = 1080;
const OUT_HEIGHT = 1920;
const OUT_FPS = 30;

/**
 * Nối các clip mp4 theo đúng thứ tự truyền vào. Một clip thì trả lại nguyên vẹn.
 *
 * Luôn chuẩn hoá rồi mã hoá lại thay vì nối kiểu copy luồng: demuxer `concat` KHÔNG báo
 * lỗi khi các clip lệch độ phân giải/fps, nó lặng lẽ cho ra file sai (đã thử: 2 clip 2 giây
 * lệch khung ra file 5 giây, hình méo). Mã hoá lại vài chục giây video chỉ mất vài giây CPU,
 * không đáng để đánh đổi lấy rủi ro đó.
 */
export async function concatMp4(parts: Buffer[]): Promise<Buffer> {
  if (parts.length === 0) throw new Error('Không có clip nào để ghép');
  if (parts.length === 1) return parts[0];

  return inTempDir(async (dir) => {
    const files: string[] = [];
    for (const [i, part] of parts.entries()) {
      const path = join(dir, `part${i}.mp4`);
      await writeFile(path, part);
      files.push(path);
    }
    const output = join(dir, 'out.mp4');

    // Mỗi clip: phủ kín khung dọc (phóng to rồi cắt, không bao giờ viền đen), cùng fps,
    // cùng tần số tiếng — có vậy bộ lọc concat mới nối được.
    const build = (withAudio: boolean) => {
      const normalize = files
        .map((_, i) => {
          const video =
            `[${i}:v]scale=${OUT_WIDTH}:${OUT_HEIGHT}:force_original_aspect_ratio=increase,` +
            `crop=${OUT_WIDTH}:${OUT_HEIGHT},setsar=1,fps=${OUT_FPS}[v${i}]`;
          return withAudio
            ? `${video};[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`
            : video;
        })
        .join(';');
      const chain = files
        .map((_, i) => (withAudio ? `[v${i}][a${i}]` : `[v${i}]`))
        .join('');
      const filter = `${normalize};${chain}concat=n=${files.length}:v=1:a=${withAudio ? 1 : 0}[v]${withAudio ? '[a]' : ''}`;
      return [
        ...files.flatMap((f) => ['-i', f]),
        '-filter_complex',
        filter,
        '-map',
        '[v]',
        ...(withAudio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '128k'] : []),
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        output,
      ];
    };

    try {
      await ffmpeg(build(true));
    } catch {
      // Hiếm: một clip nào đó không có tiếng -> bộ lọc [i:a] không tồn tại.
      // Thà ra video câm còn hơn hỏng cả job đã tốn tiền dựng.
      await ffmpeg(build(false));
    }
    return readFile(output);
  });
}
