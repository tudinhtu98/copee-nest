import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SitesService } from './sites.service';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

@UseGuards(AuthGuard('jwt'))
@Roles(UserRole.USER)
@Controller('sites')
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.sites.list(req.user.userId);
  }

  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      name: string;
      baseUrl: string;
      wooConsumerKey: string;
      wooConsumerSecret: string;
      wpUsername?: string;
      wpApplicationPassword?: string;
      shopeeAffiliateId?: string;
    },
  ) {
    return this.sites.create(req.user.userId, body);
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      wpUsername?: string;
      wpApplicationPassword?: string;
      shopeeAffiliateId?: string;
    },
  ) {
    return this.sites.update(req.user.userId, id, body);
  }

  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.sites.remove(req.user.userId, id);
  }


  @Post(':siteId/categories/sync')
  syncCategories(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
  ) {
    return this.sites.syncWooCommerceCategories(req.user.userId, siteId);
  }

  @Get(':siteId/categories')
  getCategories(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
  ) {
    return this.sites.getWooCommerceCategories(siteId, req.user.userId);
  }

  @Post(':siteId/categories')
  createCategory(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() body: { name: string; parentId?: string },
  ) {
    return this.sites.createWooCommerceCategory(req.user.userId, siteId, body);
  }

  @Post(':siteId/test-connection')
  testConnection(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
  ) {
    return this.sites.testConnection(req.user.userId, siteId);
  }
}


