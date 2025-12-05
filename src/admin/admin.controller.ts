import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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

  @Get('users')
  listUsers(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.admin.listUsers({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      actorRole: req.user.role,
    });
  }

  @Post('users')
  createUser(
    @Body()
    body: {
      email: string;
      username: string;
      password: string;
      role?: UserRole;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.admin.createUser({
      ...body,
      actorRole: req.user.role,
    });
  }

  @Patch('users/:id')
  updateUser(
    @Param('id') id: string,
    @Body()
    body: {
      email?: string;
      username?: string;
      password?: string;
      role?: UserRole;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.admin.updateUser(id, {
      ...body,
      actorRole: req.user.role,
    });
  }

  @Delete('users/:id')
  deleteUser(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.admin.deleteUser(id, req.user.role);
  }

  @Post('users/:id/ban')
  banUser(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.admin.banUser(id, req.user.role);
  }

  @Post('users/:id/unban')
  unbanUser(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.admin.unbanUser(id, req.user.role);
  }
}


