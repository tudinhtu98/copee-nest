import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const GBASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface EndcardInput {
  title: string;
  features: string; // vd "SIÊU NHẸ • ÊM ÁI • CHÍNH HÃNG"
  price?: number | null;
  originalPrice?: number | null;
}

/**
 * Tạo end-card (thumbnail cuối video): Gemini nano-banana dựng nền + sản phẩm
 * (KHÔNG chữ) -> @napi-rs/canvas overlay chữ tiếng Việt CHUẨN 100% (Be Vietnam Pro).
 * Không dùng Creatomate. Trả PNG 1080x1920.
 */
@Injectable()
export class EndcardService {
  private readonly logger = new Logger(EndcardService.name);
  private fontsReady = false;

  constructor(private readonly config: ConfigService) {
    this.registerFonts();
  }

  private registerFonts() {
    if (this.fontsReady) return;
    const candidates = [
      join(__dirname, 'assets', 'fonts'),
      join(process.cwd(), 'src', 'video', 'assets', 'fonts'),
      join(process.cwd(), 'dist', 'src', 'video', 'assets', 'fonts'),
    ];
    const dir = candidates.find((d) => existsSync(join(d, 'BeVietnamPro-ExtraBold.ttf')));
    if (!dir) {
      this.logger.warn('Không tìm thấy font Be Vietnam Pro — end-card có thể sai dấu.');
      return;
    }
    GlobalFonts.registerFromPath(join(dir, 'BeVietnamPro-ExtraBold.ttf'), 'BVP-XB');
    GlobalFonts.registerFromPath(join(dir, 'BeVietnamPro-Bold.ttf'), 'BVP-B');
    this.fontsReady = true;
  }

  private key(): string {
    const k = this.config.get<string>('GEMINI_API_KEY');
    if (!k) throw new Error('GEMINI_API_KEY chưa được cấu hình');
    return k;
  }

  private vnd(n?: number | null): string {
    return (n ?? 0).toLocaleString('vi-VN') + 'đ';
  }

  private async fetchImage(url: string): Promise<{ data: string; mime: string }> {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://shopee.vn/' } });
    if (!r.ok) throw new Error(`Tải ảnh SP lỗi ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    return { data: buf.toString('base64'), mime: (r.headers.get('content-type') || 'image/jpeg').split(';')[0] };
  }

  /** Gemini nano-banana: nền tối + sản phẩm, KHÔNG chữ. Trả Buffer png, hoặc null nếu lỗi. */
  private async generateBackground(img: { data: string; mime: string }): Promise<Buffer | null> {
    const prompt =
      'Hero product shot of the EXACT product from this image, floating centered, on a premium ' +
      'dark charcoal gradient background with subtle orange rim lighting, cinematic studio product ' +
      'photography, vertical 9:16 composition, generous dark negative space at top and bottom. ' +
      'Absolutely NO text, NO letters, NO logos added.';
    for (let a = 1; a <= 3; a++) {
      try {
        const res = await fetch(`${GBASE}/models/gemini-2.5-flash-image:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': this.key(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: img.mime, data: img.data } }] }],
            generationConfig: { responseModalities: ['IMAGE'] },
          }),
        });
        const j: any = await res.json();
        if (!res.ok) {
          if (res.status >= 500 && a < 3) { await new Promise((x) => setTimeout(x, 3000)); continue; }
          throw new Error(`${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
        }
        const p = (j.candidates?.[0]?.content?.parts || []).find((x: any) => x.inline_data || x.inlineData);
        const inl = p?.inline_data || p?.inlineData;
        if (inl?.data) return Buffer.from(inl.data, 'base64');
      } catch (e: any) {
        this.logger.warn(`Gemini bg lỗi (lần ${a}): ${e.message}`);
        if (a >= 3) return null;
      }
    }
    return null;
  }

  /** Vẽ chữ tiếng Việt lên nền -> PNG 1080x1920. */
  private async compose(bgBuf: Buffer, data: EndcardInput): Promise<Buffer> {
    const W = 1080, H = 1920;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // nền tối + ảnh cover-fit
    ctx.fillStyle = '#0e0e14';
    ctx.fillRect(0, 0, W, H);
    const bg = await loadImage(bgBuf);
    const scale = Math.max(W / bg.width, H / bg.height);
    const dw = bg.width * scale, dh = bg.height * scale;
    ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh);

    // gradient tối trên/dưới cho chữ nổi
    const gTop = ctx.createLinearGradient(0, 0, 0, 520);
    gTop.addColorStop(0, 'rgba(8,8,14,0.92)'); gTop.addColorStop(1, 'rgba(8,8,14,0)');
    ctx.fillStyle = gTop; ctx.fillRect(0, 0, W, 520);
    const gBot = ctx.createLinearGradient(0, H - 720, 0, H);
    gBot.addColorStop(0, 'rgba(8,8,14,0)'); gBot.addColorStop(0.55, 'rgba(8,8,14,0.9)'); gBot.addColorStop(1, 'rgba(8,8,14,0.98)');
    ctx.fillStyle = gBot; ctx.fillRect(0, H - 720, W, 720);

    ctx.textAlign = 'center';
    const round = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    // pill trên
    ctx.font = '34px BVP-XB';
    const pill = 'DEAL HOT HÔM NAY';
    const pw = ctx.measureText(pill).width + 70;
    ctx.fillStyle = '#ff7a00'; round((W - pw) / 2, 70, pw, 74, 37); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(pill, W / 2, 120);

    // tiêu đề (thu nhỏ nếu dài)
    let tf = 96;
    ctx.font = `${tf}px BVP-XB`;
    while (ctx.measureText(data.title).width > W - 80 && tf > 46) { tf -= 4; ctx.font = `${tf}px BVP-XB`; }
    ctx.fillStyle = '#fff'; ctx.fillText(data.title, W / 2, 260);

    // features
    ctx.fillStyle = '#ff9d2e'; ctx.font = '44px BVP-B';
    ctx.fillText(data.features, W / 2, 340);

    // giá
    ctx.fillStyle = '#ffd400'; ctx.font = '120px BVP-XB';
    ctx.fillText(this.vnd(data.price), W / 2, H - 340);
    if (data.originalPrice && data.price && data.originalPrice > data.price) {
      ctx.fillStyle = '#bfbfbf'; ctx.font = '46px BVP-B';
      const og = 'Giá gốc ' + this.vnd(data.originalPrice);
      ctx.fillText(og, W / 2, H - 250);
      const ow = ctx.measureText(og).width;
      ctx.strokeStyle = '#bfbfbf'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo((W - ow) / 2, H - 265); ctx.lineTo((W + ow) / 2, H - 265); ctx.stroke();
    }

    // CTA
    const cta = 'BẤM LINK MUA NGAY';
    ctx.font = '52px BVP-XB';
    const cw = Math.max(ctx.measureText(cta).width + 120, 720);
    ctx.fillStyle = '#ff7a00'; round((W - cw) / 2, H - 190, cw, 120, 60); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(cta, W / 2, H - 112);

    return canvas.encode('png');
  }

  /** Tạo end-card hoàn chỉnh từ ảnh sản phẩm + text. Trả PNG buffer. */
  async build(productImageUrl: string, data: EndcardInput): Promise<Buffer> {
    this.registerFonts();
    const img = await this.fetchImage(productImageUrl);
    let bg = await this.generateBackground(img);
    if (!bg) {
      // Fallback: dùng thẳng ảnh sản phẩm làm nền (kém đẹp hơn nhưng vẫn ra end-card)
      this.logger.warn('Dùng ảnh sản phẩm gốc làm nền end-card (Gemini bg lỗi).');
      bg = Buffer.from(img.data, 'base64');
    }
    return this.compose(bg, data);
  }
}
