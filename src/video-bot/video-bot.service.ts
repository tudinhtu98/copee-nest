import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { randomBytes } from 'node:crypto';
import { Telegraf, Markup } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { VideoService } from '../video/video.service';
import { formatPoints } from '../telegram/telegram.tiers';
import { NotifyEvents } from '../telegram/telegram.events';
import type {
  VideoReadyPayload,
  VideoFailedPayload,
} from '../telegram/telegram.events';

/**
 * Bot Telegram DÀNH RIÊNG cho user tạo video (tách khỏi bot admin nạp điểm).
 * Token: VIDEO_BOT_TOKEN. Chức năng: /lienket gắn tài khoản, gửi link Shopee ->
 * tạo video, tự gửi video khi xong.
 */
@Injectable()
export class VideoBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoBotService.name);
  private bot?: Telegraf;
  /** Mã liên kết tạm thời: code -> { userId, hết hạn }. */
  private linkCodes = new Map<string, { userId: string; exp: number }>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly video: VideoService,
  ) {}

  /** Tạo mã liên kết (gọi từ web) để user nhập /lienket <mã> vào bot video. */
  generateLinkCode(userId: string): { code: string; expiresInSec: number } {
    const now = Date.now();
    for (const [c, v] of this.linkCodes) if (v.exp < now) this.linkCodes.delete(c);
    const code = randomBytes(4).toString('hex').toUpperCase();
    const ttl = 10 * 60 * 1000;
    this.linkCodes.set(code, { userId, exp: now + ttl });
    return { code, expiresInSec: ttl / 1000 };
  }

  onModuleInit() {
    const token = this.config.get<string>('VIDEO_BOT_TOKEN');
    if (!token) {
      this.logger.warn(
        'VIDEO_BOT_TOKEN chưa cấu hình — bot tạo video không khởi động.',
      );
      return;
    }
    this.bot = new Telegraf(token);
    this.registerHandlers(this.bot);
    this.bot
      .launch()
      .then(() => {
        this.logger.log('Bot tạo video đã khởi động.');
        // Menu lệnh hiện khi user bấm nút "/"
        this.bot?.telegram
          .setMyCommands([
            { command: 'start', description: 'Bắt đầu / hướng dẫn' },
            { command: 'lienket', description: 'Liên kết tài khoản copee' },
            { command: 'sanpham', description: 'Sản phẩm gần nhất (vd /sanpham 10)' },
            { command: 'tim', description: 'Tìm sản phẩm (vd /tim giày)' },
            { command: 'help', description: 'Xem các lệnh' },
          ])
          .catch(() => undefined);
      })
      .catch((err) => this.logger.error('Không khởi động được bot video', err));
  }

  private readonly helpText =
    '🎬 Copee Video Bot — các lệnh:\n\n' +
    '/lienket <mã> — liên kết tài khoản copee (lấy mã ở Cài đặt trên web)\n' +
    '/sanpham [số] — xem sản phẩm đã copy gần nhất (mặc định 10, tối đa 50, vd /sanpham 30)\n' +
    '/tim <từ khoá> — tìm sản phẩm theo tên (vd /tim giày)\n' +
    '/help — xem hướng dẫn này\n\n' +
    '➡️ Cách tạo video: dùng /sanpham hoặc /tim rồi BẤM NÚT sản phẩm — hoặc ' +
    'GỬI THẲNG LINK Shopee (đã copy vào copee). Bot tự tạo video + caption gửi lại.';

  onModuleDestroy() {
    this.bot?.stop('SIGTERM');
  }

  private registerHandlers(bot: Telegraf) {
    bot.start((ctx) =>
      ctx.reply(
        '🎬 Copee Video Bot 👋\n\n' +
          'Tạo video quảng cáo sản phẩm tự động để đăng bán affiliate:\n\n' +
          '1️⃣ Lấy mã liên kết trong Cài đặt trên web copee\n' +
          '2️⃣ Gửi: /lienket <mã>\n' +
          '3️⃣ Gửi link sản phẩm Shopee (đã copy vào copee) — nhận video + caption!',
      ),
    );

    bot.command('help', (ctx) => ctx.reply(this.helpText));
    bot.command('lienket', (ctx) => this.handleLink(ctx));
    bot.command('sanpham', (ctx) => this.handleRecent(ctx));
    bot.command('tim', (ctx) => this.handleSearch(ctx));
    bot.hears(/https?:\/\/\S*shopee\S*/i, (ctx) => this.handleVideoRequest(ctx));

    // Bấm nút chọn sản phẩm -> tạo video
    bot.action(/^mkvid:(.+)$/, (ctx) => this.handlePickProduct(ctx));

    // Text khác: hướng dẫn
    bot.on('text', (ctx) => {
      const t = ctx.message.text.trim();
      if (t.startsWith('/')) return;
      return ctx.reply(
        'Gửi LINK sản phẩm Shopee (đã copy vào copee) để tạo video, hoặc:\n' +
          '• /sanpham — chọn từ sản phẩm gần nhất\n' +
          '• /tim <từ khoá> — tìm sản phẩm\n' +
          'Chưa liên kết? /lienket <mã> (lấy ở Cài đặt trên web).',
      );
    });
  }

  private async handleLink(ctx: any) {
    const code = (ctx.message?.text || '')
      .replace(/^\/lienket(@\w+)?\s*/i, '')
      .trim()
      .toUpperCase();
    if (!code) {
      return ctx.reply(
        'Cú pháp: /lienket <mã>\n\nLấy mã trong Cài đặt trên web copee rồi gửi vào đây.',
      );
    }
    const entry = this.linkCodes.get(code);
    if (!entry || entry.exp < Date.now()) {
      this.linkCodes.delete(code);
      return ctx.reply('❌ Mã không hợp lệ hoặc đã hết hạn. Lấy mã mới trên web nhé.');
    }

    const telegramId = String(ctx.from.id);
    await this.prisma.user.updateMany({
      where: { telegramId },
      data: { telegramId: null },
    });
    const user = await this.prisma.user.update({
      where: { id: entry.userId },
      data: { telegramId },
      select: { username: true, balance: true },
    });
    this.linkCodes.delete(code);

    return ctx.reply(
      `✅ Đã liên kết với tài khoản "${user.username}".\n` +
        `Số dư: ${formatPoints(user.balance)} điểm\n\n` +
        '🎬 Giờ gửi link sản phẩm Shopee để tạo video!',
    );
  }

  private async handleVideoRequest(ctx: any) {
    const telegramId = String(ctx.from.id);
    const user = await this.prisma.user.findUnique({
      where: { telegramId },
      select: { id: true },
    });
    if (!user) {
      return ctx.reply(
        '🔗 Bạn chưa liên kết tài khoản.\nLấy mã trên web copee rồi gửi: /lienket <mã>',
      );
    }

    const match = (ctx.message?.text || '').match(/https?:\/\/\S+/);
    const url = match ? match[0] : '';
    if (!url) return ctx.reply('Không đọc được link. Gửi lại link sản phẩm Shopee nhé.');

    try {
      await ctx.reply('⏳ Đang tạo video... (khoảng 1-2 phút, mình sẽ gửi lại khi xong)');
      const job = await this.video.createFromUrl(user.id, url);
      return ctx.reply(
        `✅ Đã nhận! Đang tạo video (phí ${formatPoints(await this.video.getCost())} điểm khi xong).\nMã job: ${job.id}`,
      );
    } catch (e: any) {
      return ctx.reply(`⚠️ ${e?.message || 'Không tạo được video, thử lại sau.'}`);
    }
  }

  private vnd(n?: number | null): string {
    return n ? n.toLocaleString('vi-VN') + 'đ' : '—';
  }

  /** Lấy userId copee từ chat Telegram, hoặc reply nhắc liên kết & trả null. */
  private async requireUserId(ctx: any): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { telegramId: String(ctx.from.id) },
      select: { id: true },
    });
    if (!user) {
      await ctx.reply(
        '🔗 Bạn chưa liên kết tài khoản.\nLấy mã trên web copee rồi gửi: /lienket <mã>',
      );
      return null;
    }
    return user.id;
  }

  /** /sanpham [n] — n sản phẩm gần nhất (mặc định 10, tối đa 20). */
  private async handleRecent(ctx: any) {
    const userId = await this.requireUserId(ctx);
    if (!userId) return;
    const arg = (ctx.message?.text || '').replace(/^\/sanpham(@\w+)?\s*/i, '').trim();
    const n = arg ? parseInt(arg, 10) : 10;
    const products = await this.video.recentProducts(userId, Number.isFinite(n) ? n : 10);
    return this.sendProductList(ctx, products, `🕒 ${products.length} sản phẩm gần nhất`);
  }

  /** /tim <từ khoá> — tìm sản phẩm theo tên. */
  private async handleSearch(ctx: any) {
    const userId = await this.requireUserId(ctx);
    if (!userId) return;
    const q = (ctx.message?.text || '').replace(/^\/tim(@\w+)?\s*/i, '').trim();
    if (!q) return ctx.reply('Cú pháp: /tim <từ khoá>\nVí dụ: /tim giày');
    const products = await this.video.searchProducts(userId, q, 15);
    return this.sendProductList(ctx, products, `🔎 Kết quả cho "${q}" (${products.length})`);
  }

  /** Hiện danh sách sản phẩm kèm nút bấm chọn để tạo video. */
  private async sendProductList(
    ctx: any,
    products: Array<{ id: string; title: string; price: number | null }>,
    header: string,
  ) {
    if (!products.length) {
      return ctx.reply(
        'Không tìm thấy sản phẩm nào. Hãy dùng extension copy sản phẩm Shopee vào copee trước nhé.',
      );
    }
    const rows = products.map((p) => {
      const title = p.title.length > 30 ? p.title.slice(0, 30) + '…' : p.title;
      return [Markup.button.callback(`🎬 ${title} — ${this.vnd(p.price)}`, `mkvid:${p.id}`)];
    });
    return ctx.reply(header + '\n\nBấm để tạo video:', Markup.inlineKeyboard(rows));
  }

  /** Bấm nút chọn 1 sản phẩm -> tạo video. */
  private async handlePickProduct(ctx: any) {
    await ctx.answerCbQuery().catch(() => undefined);
    const productId = ctx.match?.[1];
    const userId = await this.requireUserId(ctx);
    if (!userId || !productId) return;
    try {
      const job = await this.video.createFromProduct(userId, productId);
      return ctx.reply(
        `⏳ Đang tạo video (phí ${formatPoints(await this.video.getCost())} điểm khi xong).\nMã job: ${job.id}\nMình sẽ gửi lại khi hoàn tất.`,
      );
    } catch (e: any) {
      return ctx.reply(`⚠️ ${e?.message || 'Không tạo được video, thử lại sau.'}`);
    }
  }

  @OnEvent(NotifyEvents.VideoReady)
  async onVideoReady(p: VideoReadyPayload) {
    if (!this.bot) return;
    try {
      await this.bot.telegram.sendVideo(
        p.telegramId,
        { source: p.videoPath },
        { caption: p.caption.slice(0, 1024) },
      );
    } catch (err) {
      this.logger.warn(`Gửi video thất bại: ${err}`);
      try {
        await this.bot.telegram.sendMessage(
          p.telegramId,
          `🎬 Video "${p.productTitle}" đã xong nhưng gửi lỗi. Caption:\n\n${p.caption}`,
        );
      } catch (e) {
        this.logger.error(`Không gửi được thông báo video: ${e}`);
      }
    }
  }

  @OnEvent(NotifyEvents.VideoFailed)
  async onVideoFailed(p: VideoFailedPayload) {
    if (!this.bot || !p.telegramId) return;
    try {
      await this.bot.telegram.sendMessage(
        p.telegramId,
        `❌ Tạo video "${p.productTitle}" thất bại: ${p.reason}\nĐiểm chưa bị trừ. Bạn thử lại sau nhé.`,
      );
    } catch (err) {
      this.logger.warn(`Không gửi được thông báo lỗi: ${err}`);
    }
  }
}
