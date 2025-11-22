import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtOrApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing authorization token');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Try JWT first (if it has typical JWT pattern: 3 parts separated by dots)
    if (token.split('.').length === 3) {
      try {
        // Verify JWT token
        const payload = await this.jwtService.verifyAsync(token, {
          secret: process.env.JWT_SECRET || 'dev-secret',
        });

        // Attach user info from JWT
        request.user = {
          userId: payload.sub,
          role: payload.role,
          username: payload.username,
          isApiKey: false,
        };

        return true;
      } catch (error) {
        // JWT verification failed, try API key
      }
    }

    // Try API key authentication
    try {
      const { userId, permissions } = await this.apiKeysService.validateApiKey(
        token,
      );

      // Check permissions if required
      const requiredPermissions = this.reflector.get<string[]>(
        'permissions',
        context.getHandler(),
      );

      if (requiredPermissions) {
        const hasPermission = requiredPermissions.some((perm) =>
          this.apiKeysService.hasPermission(permissions, perm),
        );
        if (!hasPermission) {
          throw new UnauthorizedException('Insufficient permissions');
        }
      }

      // Attach user info to request
      request.user = {
        userId,
        permissions,
        isApiKey: true,
      };

      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid token or API key');
    }
  }
}

