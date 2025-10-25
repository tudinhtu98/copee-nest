import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminService } from './admin.service';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

@Controller('admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MOD)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('summary')
  summary(@Req() req: AuthenticatedRequest) {
    return this.admin.summary();
  }

  @Post('users/:id/credit')
  creditUser(
    @Param('id') id: string,
    @Body() body: { amount: number; reference?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.admin.creditUser({
      actorId: req.user.userId,
      userId: id,
      amount: body.amount,
      reference: body.reference,
    });
  }

  @Get('stats')
  stats(
    @Query('range') range: 'week' | 'month' | 'quarter' | 'year' = 'week',
  ) {
    const allowed: Record<string, 'week' | 'month' | 'quarter' | 'year'> = {
      week: 'week',
      month: 'month',
      quarter: 'quarter',
      year: 'year',
    };
    const period = allowed[range] ?? 'week';
    return this.admin.stats(period);
  }
}


