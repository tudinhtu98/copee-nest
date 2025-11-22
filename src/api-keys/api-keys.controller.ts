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
import { ApiKeysService } from './api-keys.service';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

@Controller('api-keys')
@UseGuards(AuthGuard('jwt'))
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  createApiKey(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      name: string;
      permissions?: string[];
      expiresInDays?: number;
    },
  ) {
    return this.apiKeysService.createApiKey(
      req.user.userId,
      body.name,
      body.permissions || ['products:read', 'products:write'],
      body.expiresInDays,
    );
  }

  @Get()
  listApiKeys(@Req() req: AuthenticatedRequest) {
    return this.apiKeysService.listApiKeys(req.user.userId);
  }

  @Delete(':id')
  revokeApiKey(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.apiKeysService.revokeApiKey(req.user.userId, id);
  }
}
