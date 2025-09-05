import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SitesService } from './sites.service';
import { AuthGuard } from '@nestjs/passport';

@UseGuards(AuthGuard('jwt'))
@Controller('sites')
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get()
  list(@Req() req: any) {
    return this.sites.list(req.user.userId);
  }

  @Post()
  create(
    @Req() req: any,
    @Body() body: { name: string; baseUrl: string; wooConsumerKey: string; wooConsumerSecret: string },
  ) {
    return this.sites.create(req.user.userId, body);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.sites.remove(req.user.userId, id);
  }
}


