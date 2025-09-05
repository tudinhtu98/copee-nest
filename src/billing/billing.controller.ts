import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BillingService } from './billing.service';

@UseGuards(AuthGuard('jwt'))
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('balance')
  balance(@Req() req: any) {
    return this.billing.getBalance(req.user.userId);
  }

  @Post('credit')
  credit(@Req() req: any, @Body() body: { amount: number; reference?: string }) {
    return this.billing.credit(req.user.userId, body.amount, body.reference);
  }
}


