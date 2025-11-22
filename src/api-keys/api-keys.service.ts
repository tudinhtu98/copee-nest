import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate a new API key
   * Returns the plain text key (only shown once) and the hashed version for storage
   */
  async createApiKey(
    userId: string,
    name: string,
    permissions: string[] = ['products:read', 'products:write'],
    expiresInDays?: number,
  ) {
    // Generate a random API key (format: copee_xxxxx...xxxxx)
    const prefix = 'copee_';
    const randomBytes = crypto.randomBytes(32).toString('base64url');
    const plainKey = prefix + randomBytes;

    // Hash the key for storage (similar to password hashing)
    const hashedKey = await bcrypt.hash(plainKey, 10);

    // Calculate expiration date if provided
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    // Store the hashed key
    const apiKey = await this.prisma.apiKey.create({
      data: {
        key: hashedKey,
        name,
        userId,
        permissions,
        expiresAt,
      },
    });

    // Return the plain key (only shown once) and metadata
    return {
      id: apiKey.id,
      key: plainKey, // Only shown once!
      name: apiKey.name,
      permissions: apiKey.permissions,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    };
  }

  /**
   * Validate an API key and return user info
   */
  async validateApiKey(apiKey: string): Promise<{
    userId: string;
    permissions: string[];
  }> {
    // Get ALL API keys to match the key (we need to compare hashes)
    const allApiKeys = await this.prisma.apiKey.findMany({
      select: {
        id: true,
        key: true,
      },
    });

    // Try to match the provided key against stored hashed keys
    let matchedKeyId: string | null = null;
    for (const storedKey of allApiKeys) {
      const isValid = await bcrypt.compare(apiKey, storedKey.key);
      if (isValid) {
        matchedKeyId = storedKey.id;
        break;
      }
    }

    if (!matchedKeyId) {
      throw new UnauthorizedException('API key không hợp lệ');
    }

    // Now query the matched key with full details and check revoked status
    // This ensures we get the latest status from database
    const currentKey = await this.prisma.apiKey.findUnique({
      where: { id: matchedKeyId },
      select: {
        id: true,
        userId: true,
        permissions: true,
        revokedAt: true,
        expiresAt: true,
      },
    });

    if (!currentKey) {
      throw new UnauthorizedException('API key không tồn tại');
    }

    // Check if key is revoked - Prisma returns null for nullable DateTime when null
    // If revokedAt is not null, it means the key has been revoked
    // Use strict check: if revokedAt exists (is not null and not undefined), it's revoked
    if (currentKey.revokedAt !== null && currentKey.revokedAt !== undefined) {
      throw new UnauthorizedException('API key đã bị thu hồi');
    }

    // Check if key is expired
    if (currentKey.expiresAt !== null && currentKey.expiresAt !== undefined) {
      if (currentKey.expiresAt <= new Date()) {
        throw new UnauthorizedException('API key đã hết hạn');
      }
    }

    // Update last used timestamp (only if not revoked)
    // This will fail if key was revoked between the check and update
    try {
      const updateResult = await this.prisma.apiKey.updateMany({
        where: {
          id: matchedKeyId,
          revokedAt: null, // Only update if not revoked
        },
        data: { lastUsedAt: new Date() },
      });

      // If no rows were updated, key was revoked
      if (updateResult.count === 0) {
        throw new UnauthorizedException('API key đã bị thu hồi');
      }
    } catch (error) {
      // If update fails, key might have been revoked, throw error
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('API key không hợp lệ hoặc đã bị thu hồi');
    }

    return {
      userId: currentKey.userId,
      permissions: currentKey.permissions,
    };
  }

  /**
   * List all API keys for a user
   */
  async listApiKeys(userId: string) {
    return this.prisma.apiKey.findMany({
      where: {
        userId,
        revokedAt: null,
      },
      select: {
        id: true,
        name: true,
        permissions: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Revoke an API key
   */
  async revokeApiKey(userId: string, apiKeyId: string) {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: {
        id: apiKeyId,
        userId,
        revokedAt: null,
      },
    });

    if (!apiKey) {
      throw new NotFoundException('API key không tồn tại hoặc đã bị thu hồi');
    }

    await this.prisma.apiKey.update({
      where: { id: apiKeyId },
      data: { revokedAt: new Date() },
    });

    return { message: 'API key đã được thu hồi' };
  }

  /**
   * Check if API key has required permission
   */
  hasPermission(permissions: string[], required: string): boolean {
    // Support wildcard permissions
    if (permissions.includes('*')) {
      return true;
    }
    return permissions.includes(required);
  }
}
