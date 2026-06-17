import { Body, Controller, Get, Post, Query, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BillingService } from './billing.service';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { NotifyEvents } from '../telegram/telegram.events';
import type { DepositIntentPayload } from '../telegram/telegram.events';

@UseGuards(AuthGuard('jwt'))
@Roles(UserRole.USER)
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly events: EventEmitter2,
  ) {}

  @Get('balance')
  balance(@Req() req: AuthenticatedRequest) {
    return this.billing.getBalance(req.user.userId);
  }

  // Người dùng bấm "Tôi đã chuyển khoản" / tạo QR -> báo admin kiểm tra để nạp tay
  @Post('deposit-intent')
  depositIntent(
    @Req() req: AuthenticatedRequest,
    @Body() body: { amount: number },
  ) {
    this.events.emit(NotifyEvents.DepositIntent, {
      username: req.user.username ?? req.user.userId,
      amount: Number(body?.amount) || 0,
    } as DepositIntentPayload);
    return { ok: true };
  }

  @Post('credit')
  @Roles(UserRole.ADMIN, UserRole.MOD)
  credit(
    @Req() req: AuthenticatedRequest,
    @Body() body: { amount: number; reference?: string },
  ) {
    throw new ForbiddenException('Endpoint này đã bị vô hiệu hóa. Vui lòng sử dụng /admin/users/:id/credit để nạp tiền.');
  }

  @Get('spending')
  spending(
    @Req() req: AuthenticatedRequest,
    @Query('range') range: 'week' | 'month' | 'quarter' | 'year' = 'week',
  ) {
    const allowed: Record<string, 'week' | 'month' | 'quarter' | 'year'> = {
      week: 'week',
      month: 'month',
      quarter: 'quarter',
      year: 'year',
    };
    const period = allowed[range] ?? 'week';
    return this.billing.spending(req.user.userId, period);
  }

  @Get('transactions')
  transactions(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.billing.getTransactions(req.user.userId, {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      type: type || undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }
}


