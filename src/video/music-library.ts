/**
 * Thư viện nhạc nền không bản quyền để ghép ngẫu nhiên vào video sản phẩm.
 *
 * Mặc định dùng nhạc SoundHelix (tự do dùng cho mọi mục đích, kể cả thương mại
 * — xem https://www.soundhelix.com/faq). Để thay bằng kho nhạc riêng của bạn
 * (tải từ Pixabay/Uppbeat rồi host trên R2/CDN), set biến môi trường:
 *
 *   VIDEO_MUSIC_URLS="https://cdn.ban/nhac1.mp3,https://cdn.ban/nhac2.mp3"
 *
 * Danh sách trong env sẽ GHI ĐÈ danh sách mặc định bên dưới.
 */

const DEFAULT_MUSIC: string[] = [
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-11.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-15.mp3',
];

/** Trả về danh sách nhạc hiện dùng (env override nếu có). */
export function getMusicLibrary(envValue?: string): string[] {
  const fromEnv = (envValue ?? process.env.VIDEO_MUSIC_URLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_MUSIC;
}

/** Chọn ngẫu nhiên 1 bản nhạc. Trả về null nếu thư viện rỗng. */
export function pickRandomMusic(envValue?: string): string | null {
  const lib = getMusicLibrary(envValue);
  if (lib.length === 0) return null;
  return lib[Math.floor(Math.random() * lib.length)];
}
