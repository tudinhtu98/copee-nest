import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing API key');
    }

    const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix

    try {
      const { userId, permissions } = await this.apiKeysService.validateApiKey(
        apiKey,
      );

      // Attach user info to request
      request.user = {
        userId,
        permissions,
        isApiKey: true,
      };

      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid API key');
    }
  }
}

