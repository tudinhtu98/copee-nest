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
import { Audit } from '../audit-log/audit.decorator';

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
  @Audit('CREDIT_USER', 'User')
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
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const allowed: Record<string, 'week' | 'month' | 'quarter' | 'year'> = {
      week: 'week',
      month: 'month',
      quarter: 'quarter',
      year: 'year',
    };
    const period = allowed[range] ?? 'week';
    return this.admin.stats(
      period,
      type,
      page ? parseInt(page, 10) : undefined,
      limit ? parseInt(limit, 10) : undefined,
    );
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
  @Audit('CREATE_USER', 'User')
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
  @Audit('UPDATE_USER', 'User')
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
  @Audit('DELETE_USER', 'User')
  deleteUser(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.admin.deleteUser(id, req.user.role);
  }

  @Post('users/:id/ban')
  @Audit('BAN_USER', 'User')
  banUser(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.admin.banUser(id, req.user.role);
  }

  @Post('users/:id/unban')
  @Audit('UNBAN_USER', 'User')
  unbanUser(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.admin.unbanUser(id, req.user.role);
  }

  @Get('sites')
  listSites(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('userId') userId?: string,
  ) {
    return this.admin.listSites({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      userId,
    });
  }

  @Get('categories')
  listCategories(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.admin.listCategories({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
    });
  }

  @Get('products')
  listProducts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('userId') userId?: string,
  ) {
    return this.admin.listProducts({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      status,
      category,
      userId,
    });
  }
}


