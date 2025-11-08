import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Req,
  UseGuards,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ProductsService } from './products.service';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

@UseGuards(AuthGuard('jwt'))
@Roles(UserRole.USER)
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.products.list(req.user.userId, {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      search: search || undefined,
      status: status || undefined,
      sortBy: (sortBy as any) || 'createdAt',
      sortOrder: (sortOrder as 'asc' | 'desc') || 'desc',
    });
  }

  @Post('upload')
  upload(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: { productIds: string[]; siteId: string; targetCategory?: string },
  ) {
    return this.products.createUploadJob(req.user.userId, body);
  }

  @Post('process-uploads')
  process(@Req() req: AuthenticatedRequest) {
    return this.products.processPendingUploads(req.user.userId);
  }

  @Post('copy')
  copy(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      sourceUrl: string;
      title?: string;
      description?: string;
      images?: string[];
      price?: number;
      currency?: string;
      category?: string;
    },
  ) {
    return this.products.copyProduct(req.user.userId, body);
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      title?: string;
      description?: string;
      price?: number;
      category?: string;
    },
  ) {
    return this.products.updateProduct(req.user.userId, id, body);
  }

  @Delete('bulk')
  deleteBulk(
    @Req() req: AuthenticatedRequest,
    @Body() body: { productIds: string[] },
  ) {
    return this.products.deleteProducts(req.user.userId, body.productIds);
  }

  @Delete(':id')
  delete(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.products.deleteProduct(req.user.userId, id);
  }
}
