import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { randomBytes } from 'node:crypto';
import { Telegraf } from 'telegraf';
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
      .then(() => this.logger.log('Bot tạo video đã khởi động.'))
      .catch((err) => this.logger.error('Không khởi động được bot video', err));
  }

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

    bot.command('lienket', (ctx) => this.handleLink(ctx));
    bot.hears(/https?:\/\/\S*shopee\S*/i, (ctx) => this.handleVideoRequest(ctx));

    // Text khác: hướng dẫn
    bot.on('text', (ctx) => {
      const t = ctx.message.text.trim();
      if (t.startsWith('/')) return;
      return ctx.reply(
        'Gửi mình LINK sản phẩm Shopee (đã copy vào copee) để tạo video.\n' +
          'Chưa liên kết? Gửi: /lienket <mã> (lấy mã ở Cài đặt trên web).',
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
        `✅ Đã nhận! Đang tạo video (phí ${formatPoints(this.video.cost)} điểm khi xong).\nMã job: ${job.id}`,
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
    if (!this.bot) return;
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
