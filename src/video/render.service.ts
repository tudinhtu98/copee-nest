import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { pickRandomMusic } from './music-library';

/** Dữ liệu sản phẩm tối thiểu để dựng video. */
export interface VideoProductInput {
  title: string;
  price?: number | null;
  originalPrice?: number | null;
  images: string[];
}

export interface RenderResult {
  url: string;
  durationSec: number;
  musicUrl: string | null;
}

const API_URL = 'https://api.creatomate.com/v1/renders';
const SCENE = 2.6; // giây / ảnh
const FADE = 0.5;
const MAX_IMAGES = 6;
// Creatomate: shape cần path (SVG, hệ toạ độ 0-100) mới vẽ ra hình. Đây là 1 chữ nhật đầy.
const RECT_PATH = 'M 0 0 L 100 0 L 100 100 L 0 100 Z';

/**
 * Gọi Creatomate render 1 video sản phẩm 9:16. Toàn bộ việc nặng (encode) chạy
 * trên hạ tầng Creatomate — server copee chỉ gửi JSON và nhận URL mp4.
 *
 * Cần biến môi trường CREATOMATE_API_KEY.
 */
@Injectable()
export class RenderService {
  private readonly logger = new Logger(RenderService.name);

  constructor(private readonly config: ConfigService) {}

  private vnd(n?: number | null): string {
    return (n ?? 0).toLocaleString('vi-VN') + 'đ';
  }

  private discountPct(price?: number | null, original?: number | null): number {
    if (original && price && original > price) {
      return Math.round(((original - price) / original) * 100);
    }
    return 0;
  }

  /** Dựng JSON "source" cho Creatomate (render trực tiếp, không cần template dashboard). */
  buildSource(p: VideoProductInput, musicUrl: string | null) {
    const imgs = (p.images || [])
      .filter((u) => typeof u === 'string' && u.trim().length > 0)
      .slice(0, MAX_IMAGES);
    const total = Math.max(imgs.length, 1) * SCENE;
    const pct = this.discountPct(p.price, p.originalPrice);

    const elements: any[] = [];

    // Nền tối để chữ nổi
    elements.push({
      type: 'shape',
      track: 1,
      width: '100%',
      height: '100%',
      fill_color: '#0f0f0f',
      path: RECT_PATH,
    });

    // Các scene ảnh: fade chuyển cảnh + Ken Burns (zoom nhẹ)
    imgs.forEach((src, i) => {
      elements.push({
        type: 'image',
        track: 2,
        source: src,
        time: i * SCENE,
        duration: SCENE + FADE,
        x_anchor: '50%',
        y_anchor: '50%',
        width: '100%',
        height: '72%',
        y: '36%',
        fit: 'cover',
        scale: [
          { time: 0, value: '100%' },
          { time: SCENE + FADE, value: '112%' },
        ],
        animations: [{ type: 'fade', duration: FADE, transition: true }],
      });
    });

    // Badge giảm giá (nếu có)
    if (pct > 0) {
      elements.push({
        type: 'shape',
        track: 3,
        x: '79%',
        y: '11%',
        width: '30%',
        height: '10%',
        x_anchor: '50%',
        y_anchor: '50%',
        fill_color: '#ee4d2d',
        border_radius: '9 vmin',
        path: RECT_PATH,
      });
      elements.push({
        type: 'text',
        track: 4,
        x: '79%',
        y: '11%',
        x_anchor: '50%',
        y_anchor: '50%',
        width: '30%',
        text: `-${pct}%`,
        font_family: 'Montserrat',
        font_weight: '800',
        font_size: '7 vh',
        fill_color: '#ffffff',
        text_align: 'center',
      });
    }

    // Tên sản phẩm
    elements.push({
      type: 'text',
      track: 5,
      x: '50%',
      y: '80%',
      x_anchor: '50%',
      y_anchor: '50%',
      width: '90%',
      text: p.title,
      font_family: 'Montserrat',
      font_weight: '700',
      font_size: '4.6 vh',
      fill_color: '#ffffff',
      text_align: 'center',
      line_height: '115%',
      animations: [{ type: 'fade', duration: 0.6, time: 0.2 }],
    });

    // Giá bán
    elements.push({
      type: 'text',
      track: 6,
      x: '50%',
      y: '90%',
      x_anchor: '50%',
      y_anchor: '50%',
      text: this.vnd(p.price),
      font_family: 'Montserrat',
      font_weight: '800',
      font_size: '8 vh',
      fill_color: '#ffd000',
      text_align: 'center',
      animations: [
        {
          type: 'scale',
          scope: 'element',
          duration: 0.6,
          time: 0.4,
          easing: 'elastic-out',
          start_scale: '60%',
          end_scale: '100%',
        },
      ],
    });

    // Giá gốc gạch ngang (nếu có giảm)
    if (pct > 0) {
      elements.push({
        type: 'text',
        track: 7,
        x: '50%',
        y: '95.5%',
        x_anchor: '50%',
        y_anchor: '50%',
        text: this.vnd(p.originalPrice),
        font_family: 'Montserrat',
        font_weight: '500',
        font_size: '3.6 vh',
        fill_color: '#aaaaaa',
        text_align: 'center',
        strikethrough: true,
      });
    }

    // Nhạc nền (cắt theo thời lượng video, fade cuối)
    if (musicUrl) {
      elements.push({
        type: 'audio',
        source: musicUrl,
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

  /** Render video và trả URL mp4. Ném lỗi nếu thất bại. */
  async renderProductVideo(p: VideoProductInput): Promise<RenderResult> {
    const apiKey = this.config.get<string>('CREATOMATE_API_KEY');
    if (!apiKey) {
      throw new Error('CREATOMATE_API_KEY chưa được cấu hình');
    }

    const images = (p.images || []).filter(
      (u) => typeof u === 'string' && u.trim().length > 0,
    );
    if (images.length === 0) {
      throw new Error('Sản phẩm không có ảnh để tạo video');
    }

    const musicUrl = pickRandomMusic(this.config.get<string>('VIDEO_MUSIC_URLS'));
    const source = this.buildSource({ ...p, images }, musicUrl);
    const durationSec = source.duration;

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source }),
    });

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Creatomate trả về không phải JSON: ${text.slice(0, 300)}`);
    }
    if (!res.ok) {
      throw new Error(
        `Creatomate lỗi ${res.status}: ${JSON.stringify(data).slice(0, 400)}`,
      );
    }

    const job = Array.isArray(data) ? data[0] : data;
    this.logger.log(`Render id ${job.id} — ${job.status}`);

    // Poll tới khi xong (tối đa ~2 phút)
    let final = job;
    const started = Date.now();
    const TIMEOUT_MS = 120_000;
    while (
      ['planned', 'waiting', 'transcribing', 'rendering'].includes(final.status)
    ) {
      if (Date.now() - started > TIMEOUT_MS) {
        throw new Error('Render quá thời gian chờ (120s)');
      }
      await new Promise((r) => setTimeout(r, 3000));
      const poll = await fetch(`${API_URL}/${job.id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      final = await poll.json();
    }

    if (final.status !== 'succeeded' || !final.url) {
      throw new Error(
        `Render thất bại: ${final.status} — ${final.error_message || 'không rõ'}`,
      );
    }

    return { url: final.url, durationSec, musicUrl };
  }
}
