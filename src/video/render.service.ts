import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Dữ liệu sản phẩm để dựng video. */
export interface VideoProductInput {
  title: string;
  category?: string | null;
  price?: number | null;
  originalPrice?: number | null;
  images: string[];
}

export interface RenderResult {
  videoBuffer: Buffer;
  caption: string; // caption Gemini (chưa gắn link affiliate)
  veoPrompt: string;
  durationSec: number;
}

const GBASE = 'https://generativelanguage.googleapis.com/v1beta';
const VEO_DURATION = 8; // Veo tối đa 8s/clip ở 1080p
const OMNI_DURATION = 10; // Omni ~10s, 720p

/**
 * Sinh video quảng cáo sản phẩm bằng Gemini + Veo:
 *  - Gemini viết prompt (photorealistic, nhấn mạnh sản phẩm) + caption bán hàng
 *  - Veo 3.1 Lite tạo video 8s 1080x1920 Full HD, nhạc native, KHÔNG chữ
 * Toàn bộ việc nặng chạy trên hạ tầng Google — server copee chỉ gọi API.
 *
 * Cần biến môi trường GEMINI_API_KEY.
 */
@Injectable()
export class RenderService {
  private readonly logger = new Logger(RenderService.name);

  constructor(private readonly config: ConfigService) {}

  private key(): string {
    const k = this.config.get<string>('GEMINI_API_KEY');
    if (!k) throw new Error('GEMINI_API_KEY chưa được cấu hình');
    return k;
  }
  private get textModel(): string {
    return this.config.get<string>('GEMINI_TEXT_MODEL') || 'gemini-2.5-flash';
  }
  private get veoModel(): string {
    return this.config.get<string>('VEO_MODEL') || 'veo-3.1-lite-generate-preview';
  }
  private get omniModel(): string {
    return this.config.get<string>('OMNI_MODEL') || 'gemini-omni-flash-preview';
  }
  /** Engine tạo video: 'omni' (quay thật hơn, 720p) hoặc 'veo' (Full HD 1080p). */
  private get engine(): string {
    return (this.config.get<string>('VIDEO_ENGINE') || 'omni').toLowerCase();
  }
  private headers() {
    return { 'x-goog-api-key': this.key(), 'Content-Type': 'application/json' };
  }

  private vnd(n?: number | null): string {
    return (n ?? 0).toLocaleString('vi-VN') + 'đ';
  }

  /**
   * Gemini chỉ trả các THÀNH PHẦN kịch bản (cảnh + tên EN + CTA + caption);
   * còn prompt gửi Omni được GHÉP THEO TEMPLATE CHUẨN trong code để chỉ thị
   * "chữ cuối video" luôn mạnh, rõ, không bị chìm/bỏ qua.
   */
  async generateScript(p: VideoProductInput): Promise<{
    veoPrompt: string;
    caption: string;
  }> {
    const prompt = `Bạn là đạo diễn quảng cáo sản phẩm. Video dọc 9:16 ~8s, đăng Facebook gắn LINK AFFILIATE, quay-thật, nổi bật sản phẩm để kích thích mua.
Sản phẩm: ${p.title}${p.category ? ` (loại: ${p.category})` : ''}, giá ${this.vnd(p.price)}${p.originalPrice ? ` (gốc ${this.vnd(p.originalPrice)})` : ''}.

CHỈ trả JSON các thành phần sau (KHÔNG viết cả prompt, hệ thống tự ghép):
{
  "scene": "Mô tả cảnh quay bằng TIẾNG ANH cho AI video image-to-video, VERTICAL 9:16 portrait: cinematic, photorealistic, live-action product commercial (NOT animation/CGI), dynamic camera, realistic lighting, upbeat music. BẮT BUỘC ghi rõ: keep the product's EXACT colors, materials, logo and design identical to the reference image, do not recolor or restyle the product. No on-screen text during this part.",
  "end_title": "TÊN SẢN PHẨM bằng TIẾNG ANH, IN HOA, ngắn gọn (thêm màu nếu có), ví dụ 'ADIDAS ADIZERO SL - BLACK'",
  "end_cta": "câu kêu gọi ngắn bằng tiếng Anh; mặc định 'Available now - Link in bio'",
  "post_caption": "caption TIẾNG VIỆT đăng Facebook: hook giật tít + lợi ích + giá + kêu gọi bấm link mua + 5-7 hashtag. KHÔNG tự chèn link."
}`;

    const res = await fetch(
      `${GBASE}/models/${this.textModel}:generateContent`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      },
    );
    const j: any = await res.json();
    if (!res.ok) {
      throw new Error(`Gemini lỗi ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
    }
    const text =
      j?.candidates?.[0]?.content?.parts?.map((x: any) => x.text).join('') || '';
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Gemini trả về không phải JSON: ${text.slice(0, 200)}`);
    }

    const scene: string =
      parsed.scene ||
      'Cinematic photorealistic live-action product commercial, dynamic camera, realistic lighting, upbeat music. Keep the product exactly as in the reference image.';
    const endTitle: string = (parsed.end_title || p.title).toString().toUpperCase().slice(0, 40);
    const endCta: string = parsed.end_cta || 'Available now - Link in bio';

    // Ghép prompt CHUẨN — ép khung dọc 9:16 + chỉ thị chữ cuối đặt riêng, mạnh.
    const veoPrompt =
      `VERTICAL 9:16 portrait video (aspect ratio 9:16, 720x1280, taller than wide). ` +
      `${scene}\n\n` +
      `IMPORTANT ON-SCREEN TEXT (this is required): In the final 3 seconds of the video, ` +
      `overlay a bold animated title card centered on screen. ` +
      `Top line — large, bold, UPPERCASE, white, sans-serif, with a subtle shadow — reads exactly: "${endTitle}". ` +
      `Second line — smaller white text on a solid dark rounded bar, directly below the title — reads exactly: "${endCta}". ` +
      `The text must be sharp, high-contrast, perfectly legible and spelled EXACTLY as written in quotes. Do not add any other text.`;

    return {
      veoPrompt,
      caption: parsed.post_caption || p.title,
    };
  }

  /** Tải ảnh sản phẩm -> base64 (Veo cần ảnh khởi tạo). */
  private async fetchImageBase64(
    url: string,
  ): Promise<{ data: string; mime: string }> {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://shopee.vn/',
      },
    });
    if (!r.ok) throw new Error(`Tải ảnh sản phẩm lỗi ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    return { data: buf.toString('base64'), mime };
  }

  /** Tạo video từ ảnh + prompt, chọn engine theo cấu hình (omni | veo). */
  async generateVideo(imageUrl: string, prompt: string): Promise<Buffer> {
    return this.engine === 'veo'
      ? this.generateVideoVeo(imageUrl, prompt)
      : this.generateVideoOmni(imageUrl, prompt);
  }

  /**
   * Gemini Omni Flash (Interactions API) — image-to-video, ĐỒNG BỘ (không poll).
   * Chân thực hơn Veo, 720p ~10s, có nhạc native. Trả Buffer mp4.
   */
  async generateVideoOmni(imageUrl: string, prompt: string): Promise<Buffer> {
    const img = await this.fetchImageBase64(imageUrl);
    const body = JSON.stringify({
      model: this.omniModel,
      input: [
        { type: 'image', data: img.data, mime_type: img.mime },
        { type: 'text', text: prompt },
      ],
    });

    // Omni preview thi thoảng trả 5xx tạm thời -> retry tối đa 3 lần.
    let j: any;
    let lastErr = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000);
      let res: Response;
      try {
        res = await fetch(`${GBASE}/interactions`, {
          method: 'POST',
          headers: this.headers(),
          signal: controller.signal,
          body,
        });
      } finally {
        clearTimeout(timer);
      }
      j = await res.json();
      if (res.ok) break;
      lastErr = `${res.status}: ${JSON.stringify(j).slice(0, 300)}`;
      // 5xx = tạm thời -> thử lại; 4xx (quota, invalid) -> ném ngay
      if (res.status >= 500 && attempt < 3) {
        this.logger.warn(`Omni ${res.status} (lần ${attempt}), thử lại...`);
        await new Promise((r) => setTimeout(r, 4000 * attempt));
        continue;
      }
      throw new Error(`Omni lỗi ${lastErr}`);
    }

    if (j.status && j.status !== 'completed') {
      throw new Error(`Omni chưa hoàn tất: ${j.status}`);
    }
    let data: string | undefined;
    for (const step of j.steps || []) {
      for (const c of step.content || []) {
        if ((c.mime_type || '').includes('video') && c.data) {
          data = c.data;
          break;
        }
      }
      if (data) break;
    }
    if (!data) throw new Error('Omni không trả về video');
    this.logger.log(`Omni (${this.omniModel}) tạo video xong`);
    return Buffer.from(data, 'base64');
  }

  /** Veo 3.1 tạo video 8s 1080p từ ảnh sản phẩm. Trả Buffer mp4 (đã có nhạc native). */
  async generateVideoVeo(imageUrl: string, veoPrompt: string): Promise<Buffer> {
    const key = this.key();
    const img = await this.fetchImageBase64(imageUrl);

    const start = await fetch(
      `${GBASE}/models/${this.veoModel}:predictLongRunning`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          instances: [
            {
              prompt: veoPrompt,
              image: { bytesBase64Encoded: img.data, mimeType: img.mime },
            },
          ],
          parameters: { aspectRatio: '9:16', resolution: '1080p', durationSeconds: VEO_DURATION },
        }),
      },
    );
    const sj: any = await start.json();
    if (!start.ok) {
      throw new Error(`Veo start lỗi ${start.status}: ${JSON.stringify(sj).slice(0, 400)}`);
    }
    const op = sj.name;
    if (!op) throw new Error(`Veo không trả operation: ${JSON.stringify(sj).slice(0, 200)}`);
    this.logger.log(`Veo (${this.veoModel}) đang render: ${op}`);

    const t0 = Date.now();
    const TIMEOUT = 6 * 60 * 1000;
    while (true) {
      if (Date.now() - t0 > TIMEOUT) throw new Error('Veo quá thời gian chờ (6 phút)');
      await new Promise((r) => setTimeout(r, 10000));
      const st: any = await (
        await fetch(`${GBASE}/${op}`, { headers: { 'x-goog-api-key': key } })
      ).json();
      if (st.error) throw new Error(`Veo lỗi: ${JSON.stringify(st.error).slice(0, 300)}`);
      if (st.done) {
        const uri =
          st?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
          st?.response?.generatedVideos?.[0]?.video?.uri;
        if (!uri) throw new Error(`Veo xong nhưng thiếu uri: ${JSON.stringify(st).slice(0, 300)}`);
        const vid = await fetch(uri, { headers: { 'x-goog-api-key': key } });
        if (!vid.ok) throw new Error(`Tải video Veo lỗi ${vid.status}`);
        return Buffer.from(await vid.arrayBuffer());
      }
    }
  }

  /** Sinh trọn 1 video sản phẩm: Gemini script -> Veo video. */
  async renderProductVideo(p: VideoProductInput): Promise<RenderResult> {
    const images = (p.images || []).filter(
      (u) => typeof u === 'string' && u.trim().length > 0,
    );
    if (images.length === 0) throw new Error('Sản phẩm không có ảnh để tạo video');

    const script = await this.generateScript({ ...p, images });
    const videoBuffer = await this.generateVideo(images[0], script.veoPrompt);
    const durationSec = this.engine === 'veo' ? VEO_DURATION : OMNI_DURATION;
    return {
      videoBuffer,
      caption: script.caption,
      veoPrompt: script.veoPrompt,
      durationSec,
    };
  }
}
