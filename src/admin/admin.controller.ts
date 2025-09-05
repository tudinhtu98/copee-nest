import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminService } from './admin.service';

@UseGuards(AuthGuard('jwt'))
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('summary')
  summary() {
    return this.admin.summary();
  }
}


