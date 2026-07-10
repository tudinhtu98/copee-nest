import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Telegraf, Markup } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { loadTiers, formatPoints, Tier } from './telegram.tiers';
import { NotifyEvents } from './telegram.events';
import type {
  UserCreatedPayload,
  SiteCreatedPayload,
  DepositIntentPayload,
} from './telegram.events';

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

  // --- Gửi thông báo chủ động tới tất cả admin ---
  async notify(text: string) {
    if (!this.bot || this.allowedIds.size === 0) return;
    for (const id of this.allowedIds) {
      try {
        await this.bot.telegram.sendMessage(id, text);
      } catch (err) {
        this.logger.warn(`Không gửi được thông báo tới ${id}: ${err}`);
      }
    }
  }

  @OnEvent(NotifyEvents.UserCreated)
  async onUserCreated(p: UserCreatedPayload) {
    await this.notify(
      `🆕 User mới đăng ký\n` +
        `Username: ${p.username}\n` +
        `Email: ${p.email}\n` +
        `Nguồn: ${p.source === 'google' ? 'Google' : 'Email/Mật khẩu'}`,
    );
  }

  @OnEvent(NotifyEvents.SiteCreated)
  async onSiteCreated(p: SiteCreatedPayload) {
    await this.notify(
      `🌐 Site mới được thêm\n` +
        `Chủ: ${p.username}\n` +
        `Tên: ${p.siteName}\n` +
        `URL: ${p.baseUrl}`,
    );
  }

  @OnEvent(NotifyEvents.DepositIntent)
  async onDepositIntent(p: DepositIntentPayload) {
    await this.notify(
      `💵 Có người tạo mã QR nạp tiền\n` +
        `Username: ${p.username}\n` +
        `Số tiền: ${formatPoints(p.amount)}₫\n\n` +
        `Kiểm tra chuyển khoản rồi nạp: /napt ${p.username}`,
    );
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
          'Nạp điểm: gửi username hoặc /napt <username>\n' +
          '📊 Báo cáo: /report',
      );
    });

    bot.command('napt', (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return this.denyAndReport(ctx);
      const arg = ctx.message.text.replace(/^\/napt(@\w+)?\s*/i, '').trim();
      if (!arg) return ctx.reply('Cú pháp: /napt <username>');
      return this.lookupAndOffer(ctx, arg);
    });

    // Phải đăng ký TRƯỚC bot.on('text') vì handler text nuốt mọi lệnh "/..."
    bot.command('report', (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return this.denyAndReport(ctx);
      return ctx.reply('📊 Chọn kỳ báo cáo:', this.reportKeyboard());
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

    // Báo cáo: nút chọn kỳ ngày/tháng/năm (lệnh /report đăng ký ở trên)
    bot.action(/^report:(day|month|year)$/, async (ctx) => {
      if (!this.isAllowed(ctx.from?.id)) return this.denyAndReport(ctx);
      await ctx.answerCbQuery();
      const period = ctx.match[1] as 'day' | 'month' | 'year';
      const text = await this.buildReport(period);
      try {
        await ctx.editMessageText(text, this.reportKeyboard());
      } catch {
        // Bỏ qua lỗi "message is not modified" khi bấm lại cùng kỳ
      }
    });
  }

  private reportKeyboard() {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('Hôm nay', 'report:day'),
        Markup.button.callback('Tháng này', 'report:month'),
        Markup.button.callback('Năm nay', 'report:year'),
      ],
    ]);
  }

  /** Mốc bắt đầu kỳ theo giờ Việt Nam (UTC+7), trả về thời điểm UTC tương ứng. */
  private periodStartVN(period: 'day' | 'month' | 'year'): Date {
    const offset = 7 * 60 * 60 * 1000;
    const vn = new Date(Date.now() + offset);
    const y = vn.getUTCFullYear();
    const m = vn.getUTCMonth();
    const d = vn.getUTCDate();
    let startMs: number;
    if (period === 'day') startMs = Date.UTC(y, m, d);
    else if (period === 'month') startMs = Date.UTC(y, m, 1);
    else startMs = Date.UTC(y, 0, 1);
    return new Date(startMs - offset);
  }

  private formatVnDate(d: Date): string {
    const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    const dd = String(vn.getUTCDate()).padStart(2, '0');
    const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${vn.getUTCFullYear()}`;
  }

  private async buildReport(period: 'day' | 'month' | 'year'): Promise<string> {
    const start = this.periodStartVN(period);
    const [credit, debit, newUsers, topCredit, topDebit] =
      await this.prisma.$transaction([
        this.prisma.transaction.aggregate({
          _sum: { amount: true },
          _count: true,
          where: { type: 'CREDIT', createdAt: { gte: start } },
        }),
        this.prisma.transaction.aggregate({
          _sum: { amount: true },
          _count: true,
          where: { type: 'DEBIT', createdAt: { gte: start } },
        }),
        this.prisma.user.count({ where: { createdAt: { gte: start } } }),
        this.prisma.transaction.groupBy({
          by: ['userId'],
          where: { type: 'CREDIT', createdAt: { gte: start } },
          _sum: { amount: true },
          orderBy: { _sum: { amount: 'desc' } },
          take: 5,
        }),
        this.prisma.transaction.groupBy({
          by: ['userId'],
          where: { type: 'DEBIT', createdAt: { gte: start } },
          _sum: { amount: true },
          orderBy: { _sum: { amount: 'asc' } }, // DEBIT âm => tiêu nhiều nhất xếp đầu
          take: 5,
        }),
      ]);

    // Lấy username cho các user xuất hiện trong bảng xếp hạng
    const ids = [...new Set([...topCredit, ...topDebit].map((r) => r.userId))];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, username: true },
        })
      : [];
    const nameOf = new Map(users.map((u) => [u.id, u.username]));

    const label =
      period === 'day' ? 'Hôm nay' : period === 'month' ? 'Tháng này' : 'Năm nay';
    const credited = credit._sum.amount ?? 0;
    const spent = Math.abs(debit._sum.amount ?? 0);

    return (
      `📊 Báo cáo — ${label}\n` +
      `Từ ${this.formatVnDate(start)} (giờ VN)\n\n` +
      `💰 Nạp: ${formatPoints(credited)} điểm (${credit._count} GD)\n` +
      `🛒 Tiêu: ${formatPoints(spent)} điểm (${debit._count} GD)\n` +
      `👥 User mới: ${newUsers}\n\n` +
      `🏆 Top nạp:\n${this.renderTop(topCredit, nameOf)}\n\n` +
      `🔥 Top tiêu:\n${this.renderTop(topDebit, nameOf)}`
    );
  }

  private renderTop(
    rows: Array<{ userId: string; _sum?: { amount?: number | null } | null }>,
    nameOf: Map<string, string>,
  ): string {
    if (!rows.length) return '—';
    return rows
      .map((r, i) => {
        const amt = Math.abs(r._sum?.amount ?? 0);
        const name = nameOf.get(r.userId) ?? r.userId;
        return `${i + 1}. ${name} — ${formatPoints(amt)}`;
      })
      .join('\n');
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
