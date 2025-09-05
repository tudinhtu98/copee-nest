import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ProductsService } from './products.service';

@UseGuards(AuthGuard('jwt'))
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@Req() req: any) {
    return this.products.list(req.user.userId);
  }

  @Post('upload')
  upload(@Req() req: any, @Body() body: { productIds: string[]; siteId: string; targetCategory?: string }) {
    return this.products.createUploadJob(req.user.userId, body);
  }

  @Post('process-uploads')
  process(@Req() req: any) {
    return this.products.processPendingUploads(req.user.userId);
  }
}


