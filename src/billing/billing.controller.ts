import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BillingService } from './billing.service';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

@UseGuards(AuthGuard('jwt'))
@Roles(UserRole.USER)
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('balance')
  balance(@Req() req: AuthenticatedRequest) {
    return this.billing.getBalance(req.user.userId);
  }

  @Post('credit')
  credit(
    @Req() req: AuthenticatedRequest,
    @Body() body: { amount: number; reference?: string },
  ) {
    return this.billing.credit(req.user.userId, body.amount, body.reference);
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


