import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
    },
  ) {
    return this.sites.create(req.user.userId, body);
  }

  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.sites.remove(req.user.userId, id);
  }

  @Get(':siteId/category-mappings')
  getCategoryMappings(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
  ) {
    return this.sites.getCategoryMappings(siteId, req.user.userId);
  }

  @Post(':siteId/category-mappings')
  createCategoryMapping(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() body: { sourceName: string; targetId: string; targetName: string },
  ) {
    return this.sites.createCategoryMapping(req.user.userId, siteId, body);
  }

  @Delete(':siteId/category-mappings/:mappingId')
  deleteCategoryMapping(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('mappingId') mappingId: string,
  ) {
    return this.sites.deleteCategoryMapping(req.user.userId, siteId, mappingId);
  }
}


