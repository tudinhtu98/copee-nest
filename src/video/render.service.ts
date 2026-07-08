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
const DURATION = 8; // Veo tối đa 8s/clip ở 1080p

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
  private headers() {
    return { 'x-goog-api-key': this.key(), 'Content-Type': 'application/json' };
  }

  private vnd(n?: number | null): string {
    return (n ?? 0).toLocaleString('vi-VN') + 'đ';
  }

  /** Gemini viết prompt Veo (photorealistic, nhấn mạnh sản phẩm) + caption FB affiliate. */
  async generateScript(
    p: VideoProductInput,
  ): Promise<{ veoPrompt: string; caption: string }> {
    const prompt = `Bạn là đạo diễn quảng cáo sản phẩm chuyên nghiệp. Video này ĐĂNG FACEBOOK, gắn LINK AFFILIATE để bán kiếm hoa hồng — hình ảnh phải CHÂN THỰC NHƯ QUAY THẬT và LÀM NỔI BẬT SẢN PHẨM để người xem muốn mua ngay.
Sản phẩm: ${p.title}${p.category ? ` (loại: ${p.category})` : ''}, giá ${this.vnd(p.price)}${p.originalPrice ? ` (gốc ${this.vnd(p.originalPrice)})` : ''}.

Viết 1 prompt DUY NHẤT cho Veo tạo video dọc 9:16 dài 8 giây, image-to-video TỪ ảnh sản phẩm, gồm nhiều cảnh nối tiếp NHẤN MẠNH SẢN PHẨM (hero shot, cận cảnh chi tiết/chất liệu, sản phẩm được dùng trong đời thực), tạo cảm giác cao cấp và kích thích mua hàng.
YÊU CẦU BẮT BUỘC đưa vào veo_prompt:
- "photorealistic, shot on a real camera, live-action product commercial, NOT animation or CGI, realistic lighting, textures and depth of field"
- Camera chuyển động điện ảnh, nhịp nhanh; nhạc nền upbeat sôi động.
- Tuyệt đối NO text, NO letters, NO numbers, NO captions trong video.
- Giữ đúng sản phẩm trong ảnh (màu sắc, thiết kế, logo).
Trả JSON đúng schema:
{
  "veo_prompt": "prompt tiếng Anh chi tiết như trên",
  "post_caption": "caption tiếng Việt để đăng Facebook: hook giật tít + lợi ích + giá + kêu gọi bấm link mua + 5-7 hashtag. KHÔNG tự chèn link (hệ thống gắn sau)."
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
    if (!parsed.veo_prompt) throw new Error('Gemini thiếu veo_prompt');
    return {
      veoPrompt: parsed.veo_prompt,
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

  /** Veo 3.1 tạo video 8s 1080p từ ảnh sản phẩm. Trả Buffer mp4 (đã có nhạc native). */
  async generateVideo(imageUrl: string, veoPrompt: string): Promise<Buffer> {
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
          parameters: { aspectRatio: '9:16', resolution: '1080p', durationSeconds: DURATION },
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

    const { veoPrompt, caption } = await this.generateScript({ ...p, images });
    const videoBuffer = await this.generateVideo(images[0], veoPrompt);
    return { videoBuffer, caption, veoPrompt, durationSec: DURATION };
  }
}
