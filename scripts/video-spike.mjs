#!/usr/bin/env node
/**
 * P0 SPIKE — Test khả thi tạo video sản phẩm bằng Creatomate.
 *
 * Mục tiêu: chứng minh flow "product data -> video 9:16" chạy được TRƯỚC khi
 * đụng vào codebase copee. Chạy độc lập, không cần Nest/DB, chỉ cần 1 API key.
 *
 * Cách chạy:
 *   1) Đăng ký free tại https://creatomate.com  ->  Settings -> API key
 *   2) CREATOMATE_API_KEY=xxx node scripts/video-spike.mjs
 *      (tuỳ chọn: MUSIC_URL=<link mp3> để có nhạc nền)
 *
 * Kết quả: in ra URL video + tự tải về ./video-spike-out.mp4
 *
 * Node 22 có sẵn fetch global — không cần cài thêm gì.
 */

import { writeFile } from 'node:fs/promises';

const API_KEY = process.env.CREATOMATE_API_KEY;
const MUSIC_URL = process.env.MUSIC_URL || null; // tuỳ chọn: link mp3 nhạc nền
const API = 'https://api.creatomate.com/v1/renders';

if (!API_KEY) {
  console.error('❌ Thiếu CREATOMATE_API_KEY.\n' +
    '   Lấy free tại https://creatomate.com -> Project settings -> API key\n' +
    '   Rồi chạy: CREATOMATE_API_KEY=xxx node scripts/video-spike.mjs');
  process.exit(1);
}

// ─── Data sản phẩm (giày adidas thật từ DB copee; giá để tạm cho demo) ───
// Chỗ này sau sẽ do backend bơm vào từ bảng Product.
const product = {
  title: 'adidas Running ADIZERO SL Shoes Men Black IG3334',
  price: 2000000,        // giá bán (để tạm 2 triệu cho demo)
  originalPrice: 2890000, // giá gốc -> ra badge -31%
  currency: 'VND',
  images: [
    'https://down-vn.img.susercontent.com/file/sg-11134201-8261u-mldsjy00ifpf47',
    'https://down-vn.img.susercontent.com/file/sg-11134201-825af-mgemeexjg7bf82',
    'https://down-vn.img.susercontent.com/file/sg-11134201-825a7-mgemeeynk74b18',
    'https://down-vn.img.susercontent.com/file/sg-11134201-82581-mgemeeyy4wlq13',
    'https://down-vn.img.susercontent.com/file/sg-11134201-8258m-mgemeexyjuo866',
  ],
};

// ─── Helpers ───
const vnd = (n) => n?.toLocaleString('vi-VN') + 'đ';
const discountPct = (p, o) =>
  o && p && o > p ? Math.round(((o - p) / o) * 100) : 0;

// Mỗi ảnh chiếm 1 "scene". Tổng thời lượng = images.length * SCENE.
const SCENE = 2.6; // giây / ảnh
const FADE = 0.5;

/**
 * Dựng template Creatomate (định dạng JSON "source" — render trực tiếp,
 * không cần tạo template trên dashboard). Đây chính là cái backend sẽ sinh ra.
 */
function buildSource(p) {
  const imgs = (p.images || []).slice(0, 5);
  const total = imgs.length * SCENE;
  const pct = discountPct(p.price, p.originalPrice);

  const elements = [];

  // Nền tối để chữ nổi
  elements.push({
    type: 'shape',
    track: 1,
    width: '100%',
    height: '100%',
    fill_color: '#0f0f0f',
  });

  // Các scene ảnh: fade in/out + Ken Burns (zoom nhẹ) bằng keyframe scale
  imgs.forEach((src, i) => {
    elements.push({
      type: 'image',
      track: 2,
      source: src,
      time: i * SCENE,
      duration: SCENE + FADE, // chồng nhẹ để chuyển mượt
      x_anchor: '50%',
      y_anchor: '50%',
      width: '100%',
      height: '72%',
      y: '36%', // đẩy ảnh lên nửa trên, chừa chỗ dưới cho text
      fit: 'cover',
      // Ken Burns: zoom 100% -> 112% suốt scene
      scale: [
        { time: 0, value: '100%' },
        { time: SCENE + FADE, value: '112%' },
      ],
      animations: [
        { type: 'fade', duration: FADE, transition: true },
      ],
    });
  });

  // Badge giảm giá (nếu có) — góc trên phải
  if (pct > 0) {
    elements.push({
      type: 'shape',
      track: 3,
      x: '82%', y: '12%',
      width: '26%', height: '9%',
      x_anchor: '50%', y_anchor: '50%',
      fill_color: '#ee4d2d', // cam Shopee
      border_radius: '8 vmin', // bo tròn thành viên thuốc/badge
    });
    elements.push({
      type: 'text',
      track: 4,
      x: '82%', y: '12%',
      x_anchor: '50%', y_anchor: '50%',
      width: '26%',
      text: `-${pct}%`,
      font_family: 'Montserrat',
      font_weight: '800',
      font_size: '6.5 vh',
      fill_color: '#ffffff',
      text_align: 'center',
    });
  }

  // Khối text dưới cùng: tên + giá
  // Tên sản phẩm
  elements.push({
    type: 'text',
    track: 5,
    x: '50%', y: '80%',
    x_anchor: '50%', y_anchor: '50%',
    width: '90%',
    text: p.title,
    font_family: 'Montserrat',
    font_weight: '700',
    font_size: '4.6 vh',
    fill_color: '#ffffff',
    text_align: 'center',
    line_height: '115%',
    animations: [
      { type: 'fade', duration: 0.6, time: 0.2 },
    ],
  });

  // Giá bán (to, vàng)
  elements.push({
    type: 'text',
    track: 6,
    x: '50%', y: '90%',
    x_anchor: '50%', y_anchor: '50%',
    text: vnd(p.price),
    font_family: 'Montserrat',
    font_weight: '800',
    font_size: '8 vh',
    fill_color: '#ffd000',
    text_align: 'center',
    animations: [
      { type: 'scale', scope: 'element', duration: 0.6, time: 0.4,
        easing: 'elastic-out', start_scale: '60%', end_scale: '100%' },
    ],
  });

  // Giá gốc gạch ngang (nếu có giảm)
  if (pct > 0) {
    elements.push({
      type: 'text',
      track: 7,
      x: '50%', y: '95.5%',
      x_anchor: '50%', y_anchor: '50%',
      text: vnd(p.originalPrice),
      font_family: 'Montserrat',
      font_weight: '500',
      font_size: '3.6 vh',
      fill_color: '#aaaaaa',
      text_align: 'center',
      strikethrough: true,
    });
  }

  // Nhạc nền (tuỳ chọn)
  if (MUSIC_URL) {
    elements.push({
      type: 'audio',
      source: MUSIC_URL,
      duration: total,
      audio_fade_out: 1,
    });
  }

  return {
    output_format: 'mp4',
    width: 1080,
    height: 1920,
    frame_rate: 30,
    duration: total,
    elements,
  };
}

async function render() {
  const source = buildSource(product);
  console.log(`🎬 Sản phẩm: ${product.title}`);
  console.log(`   Giá: ${vnd(product.price)} (gốc ${vnd(product.originalPrice)}, -${discountPct(product.price, product.originalPrice)}%)`);
  console.log(`   Ảnh: ${product.images.length} | Thời lượng dự kiến: ${source.duration}s | 1080x1920`);
  console.log(`   Nhạc nền: ${MUSIC_URL ? 'có' : 'không (set MUSIC_URL để thêm)'}\n`);

  console.log('⏳ Gửi yêu cầu render lên Creatomate...');
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ source }),
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`API trả về không phải JSON: ${text.slice(0, 300)}`); }
  if (!res.ok) throw new Error(`Creatomate lỗi ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);

  // API trả mảng render (1 phần tử). Poll tới khi xong.
  const job = Array.isArray(data) ? data[0] : data;
  console.log(`   Render id: ${job.id} — trạng thái: ${job.status}`);

  let final = job;
  const started = Date.now();
  while (['planned', 'waiting', 'transcribing', 'rendering'].includes(final.status)) {
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await fetch(`${API}/${job.id}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    final = await poll.json();
    process.stdout.write(`\r   ...${final.status} (${Math.round((Date.now() - started) / 1000)}s)   `);
  }
  console.log('');

  if (final.status !== 'succeeded') {
    throw new Error(`Render thất bại: ${final.status} — ${final.error_message || 'không rõ'}`);
  }

  console.log(`\n✅ Xong! Video URL:\n   ${final.url}\n`);

  // Tải về xem cho tiện
  try {
    console.log('⬇️  Đang tải về ./video-spike-out.mp4 ...');
    const buf = Buffer.from(await (await fetch(final.url)).arrayBuffer());
    await writeFile('video-spike-out.mp4', buf);
    console.log(`   Đã lưu (${(buf.length / 1024 / 1024).toFixed(1)} MB). Mở lên xem thử!`);
  } catch (e) {
    console.log(`   (Không tải được, cứ mở URL trên: ${e.message})`);
  }
}

render().catch((e) => {
  console.error('\n❌', e.message);
  process.exit(1);
});
