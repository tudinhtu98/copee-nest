import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Markup } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import {
  loadTiers,
  computeTotal,
  formatPoints,
  Tier,
} from './telegram.tiers';

/** Trạng thái hội thoại tạm thời theo từng chat của admin. */
type Pending =
  | { kind: 'awaitAmount'; userId: string; username: string; balance: number }
  | {
      kind: 'confirm';
      userId: string;
      username: string;
      base: number;
      bonus: number;
      total: number;
      balance: number;
    };

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot?: Telegraf;
  private tiers: Tier[] = [];
  private allowedIds = new Set<number>();
  private pending = new Map<number, Pending>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  onModuleInit() {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN chưa được cấu hình — bot Telegram không khởi động.',
      );
      return;
    }

    this.tiers = loadTiers(this.config.get<string>('TELEGRAM_TIERS'));
    this.allowedIds = new Set(
      (this.config.get<string>('TELEGRAM_ADMIN_IDS') || '')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0),
    );

    if (this.allowedIds.size === 0) {
      this.logger.warn(
        'TELEGRAM_ADMIN_IDS đang rỗng — KHÔNG ai dùng được bot. Hãy thêm chat id của admin.',
      );
    }

    this.bot = new Telegraf(token);
    this.registerHandlers(this.bot);
    this.bot
      .launch()
      .then(() => this.logger.log('Bot Telegram đã khởi động.'))
      .catch((err) => this.logger.error('Không khởi động được bot', err));
  }

  onModuleDestroy() {
    this.bot?.stop('SIGTERM');
  }

  // --- Quyền truy cập ---
  private isAllowed(id?: number): boolean {
    return !!id && this.allowedIds.has(id);
  }

  private actorLabel(ctx: any): string {
    const u = ctx.from;
    return u?.username ? `@${u.username}` : `tg:${u?.id}`;
  }

  // --- Đăng ký handler ---
  private registerHandlers(bot: Telegraf) {
    bot.start((ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return this.denyAndReport(ctx);
      return ctx.reply(
        'Bot nạp điểm Copee 👋\n\n' +
          `Chat id của bạn: ${ctx.from?.id}\n\n` +
          'Gửi username khách cần nạp (vd: nguyenvana hoặc @nguyenvana), ' +
          'hoặc dùng: /napt nguyenvana',
      );
    });

    bot.command('napt', (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return this.denyAndReport(ctx);
      const arg = ctx.message.text.replace(/^\/napt(@\w+)?\s*/i, '').trim();
      if (!arg) return ctx.reply('Cú pháp: /napt <username>');
      return this.lookupAndOffer(ctx, arg);
    });

    bot.on('text', (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return this.denyAndReport(ctx);
      const text = ctx.message.text.trim();
      if (text.startsWith('/')) return; // các lệnh khác bỏ qua

      const state = this.pending.get(ctx.from!.id);
      if (state?.kind === 'awaitAmount') {
        return this.handleManualAmount(ctx, state, text);
      }
      // Mặc định: coi như username cần tra cứu
      return this.lookupAndOffer(ctx, text);
    });

    // Chọn 1 mức gợi ý: tier:<index>
    bot.action(/^tier:(\d+)$/, async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return this.denyAndReport(ctx);
      await ctx.answerCbQuery();
      const idx = Number(ctx.match[1]);
      const tier = this.tiers[idx];
      const state = this.pending.get(ctx.from!.id);
      if (!tier || !state)
        return ctx.editMessageText('Phiên đã hết hạn. Gửi lại username nhé.');
      const target =
        state.kind === 'awaitAmount' || state.kind === 'confirm'
          ? { userId: state.userId, username: state.username, balance: state.balance }
          : null;
      if (!target) return;
      return this.askConfirm(
        ctx,
        target.userId,
        target.username,
        target.balance,
        tier.base,
        tier.bonus,
      );
    });

    // Nhập tay
    bot.action('manual', async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return this.denyAndReport(ctx);
      await ctx.answerCbQuery();
      const state = this.pending.get(ctx.from!.id);
      if (!state)
        return ctx.editMessageText('Phiên đã hết hạn. Gửi lại username nhé.');
      this.pending.set(ctx.from!.id, {
        kind: 'awaitAmount',
        userId: state.userId,
        username: state.username,
        balance: state.balance,
      });
      return ctx.editMessageText(
        `Nhập số điểm muốn nạp cho ${state.username} (vd: 75000):`,
      );
    });

    bot.action('do_credit', async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return this.denyAndReport(ctx);
      await ctx.answerCbQuery();
      return this.executeCredit(ctx);
    });

    bot.action('cancel', async (ctx) => {
      await ctx.answerCbQuery('Đã hủy');
      this.pending.delete(ctx.from!.id);
      return ctx.editMessageText('❌ Đã hủy giao dịch.');
    });
  }

  private async denyAndReport(ctx: any) {
    this.logger.warn(
      `Từ chối truy cập: ${this.actorLabel(ctx)} (id=${ctx.from?.id})`,
    );
    if (ctx.answerCbQuery) await ctx.answerCbQuery().catch(() => undefined);
    return ctx.reply(
      `⛔ Bạn không có quyền dùng bot này.\nChat id của bạn: ${ctx.from?.id}`,
    );
  }

  // --- Tra cứu user theo username và hiện bàn phím mức nạp ---
  private async lookupAndOffer(ctx: any, raw: string) {
    const username = raw.replace(/^@/, '').trim();
    const user = await this.prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true, username: true, balance: true, bannedAt: true },
    });
    if (!user) {
      return ctx.reply(`Không tìm thấy user "${username}". Kiểm tra lại username.`);
    }

    this.pending.set(ctx.from!.id, {
      kind: 'awaitAmount', // tạm giữ thông tin target; chờ chọn mức hoặc nhập tay
      userId: user.id,
      username: user.username,
      balance: user.balance,
    });

    const buttons = this.tiers.map((t, i) => {
      const label =
        t.bonus > 0
          ? `${formatPoints(t.base)} +${t.bonus}%`
          : `${formatPoints(t.base)}`;
      return Markup.button.callback(label, `tier:${i}`);
    });
    // 2 nút mỗi hàng
    const rows: any[] = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    rows.push([Markup.button.callback('✏️ Nhập tay', 'manual')]);

    const banned = user.bannedAt ? '\n⚠️ User đang bị khóa!' : '';
    return ctx.reply(
      `👤 ${user.username} — Số dư: ${formatPoints(user.balance)} điểm${banned}\n\n` +
        'Chọn mức nạp:',
      Markup.inlineKeyboard(rows),
    );
  }

  // --- Nhập tay số tiền ---
  private async handleManualAmount(ctx: any, state: Pending, text: string) {
    if (state.kind !== 'awaitAmount') return;
    const amount = Number(text.replace(/[.,\s]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      return ctx.reply('Số điểm không hợp lệ. Nhập một số dương, vd: 75000');
    }
    return this.askConfirm(
      ctx,
      state.userId,
      state.username,
      state.balance,
      amount,
      0,
    );
  }

  // --- Bước xác nhận ---
  private async askConfirm(
    ctx: any,
    userId: string,
    username: string,
    balance: number,
    base: number,
    bonus: number,
  ) {
    const total = base + Math.round((base * bonus) / 100);
    this.pending.set(ctx.from!.id, {
      kind: 'confirm',
      userId,
      username,
      base,
      bonus,
      total,
      balance,
    });

    const bonusLine =
      bonus > 0
        ? `Khuyến mãi: +${bonus}% = ${formatPoints(total - base)} điểm\n`
        : '';
    const text =
      `Xác nhận nạp cho ${username}:\n\n` +
      `Mức nạp: ${formatPoints(base)} điểm\n` +
      bonusLine +
      `➡️ Cộng vào tài khoản: ${formatPoints(total)} điểm\n` +
      `Số dư hiện tại: ${formatPoints(balance)} → ${formatPoints(balance + total)}`;

    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Đồng ý', 'do_credit'),
        Markup.button.callback('❌ Hủy', 'cancel'),
      ],
    ]);
    // Nếu đến từ callback (chọn mức) thì sửa tin nhắn; nếu từ nhập tay thì gửi mới
    if (ctx.updateType === 'callback_query') {
      return ctx.editMessageText(text, kb);
    }
    return ctx.reply(text, kb);
  }

  // --- Thực hiện nạp ---
  private async executeCredit(ctx: any) {
    const state = this.pending.get(ctx.from!.id);
    if (!state || state.kind !== 'confirm') {
      return ctx.editMessageText('Phiên đã hết hạn. Gửi lại username nhé.');
    }
    const actor = this.actorLabel(ctx);
    const reference = `TG-${ctx.from!.id}-${Date.now()}`;
    const description =
      `Nạp qua Telegram bởi ${actor}` +
      (state.bonus > 0
        ? ` (mức ${state.base} +${state.bonus}%)`
        : ` (mức ${state.base})`);

    try {
      const result = await this.billing.credit(
        state.userId,
        state.total,
        reference,
        description,
      );
      this.pending.delete(ctx.from!.id);
      this.logger.log(
        `${actor} nạp ${state.total} cho ${state.username} (ref ${reference})`,
      );
      return ctx.editMessageText(
        `✅ Đã nạp ${formatPoints(state.total)} điểm cho ${state.username}.\n` +
          `Số dư mới: ${formatPoints(result.user.balance)} điểm\n` +
          `Mã GD: ${reference}`,
      );
    } catch (err: any) {
      this.logger.error('Nạp thất bại', err);
      return ctx.editMessageText(
        `❌ Nạp thất bại: ${err?.message ?? 'lỗi không xác định'}`,
      );
    }
  }
}
