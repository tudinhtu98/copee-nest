import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { FacebookPage, SocialConnection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from './crypto.service';
import { MetaClient } from './meta.client';

const STATE_TTL_SECONDS = 600;

export interface ConnectionDto {
  id: string;
  displayName: string;
  status: string;
  scopes: string[];
  tokenExpiresAt: string | null;
  pageCount: number;
  lastError: string | null;
  createdAt: string;
}

export interface PageDto {
  id: string;
  externalId: string;
  name: string;
  category: string | null;
  pictureUrl: string | null;
  /** Người kết nối có quyền đăng bài lên Page này không. */
  canPublish: boolean;
}

export function toPageDto(p: FacebookPage): PageDto {
  // tasks rỗng = token cũ không trả tasks; coi như có quyền, để Facebook tự báo lỗi nếu không
  const has = (task: string) => p.tasks.length === 0 || p.tasks.includes(task) || p.tasks.includes('MANAGE');
  return {
    id: p.id,
    externalId: p.externalId,
    name: p.name,
    category: p.category,
    pictureUrl: p.pictureUrl,
    canPublish: has('CREATE_CONTENT'),
  };
}

/**
 * Kết nối tài khoản Facebook của người dùng và lấy danh sách fanpage.
 * Access token (cả token người dùng lẫn token từng Page) luôn được mã hoá trước khi lưu.
 */
@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly meta: MetaClient,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** State ký bằng JWT: Facebook gọi lại không mang theo phiên đăng nhập của người dùng. */
  authUrl(userId: string): string {
    const state = this.jwt.sign(
      { userId },
      { secret: this.config.get('JWT_SECRET') || 'dev-secret', expiresIn: STATE_TTL_SECONDS },
    );
    return this.meta.authUrl(state);
  }

  async completeOAuth(code: string, state: string): Promise<{ userId: string }> {
    let userId: string;
    try {
      const payload = this.jwt.verify<{ userId: string }>(state, {
        secret: this.config.get('JWT_SECRET') || 'dev-secret',
      });
      userId = payload.userId;
    } catch {
      throw new BadRequestException('Phiên kết nối đã hết hạn, vui lòng thử lại');
    }
    const shortLived = await this.meta.exchangeCode(code);
    const token = await this.meta.exchangeLongLived(shortLived).catch(() => shortLived);
    await this.save(userId, token);
    return { userId };
  }

  /** Luồng dán token thủ công (Graph API Explorer), dùng khi chưa cấu hình App ID/Secret. */
  async connectWithToken(userId: string, rawToken: string): Promise<ConnectionDto> {
    const token = rawToken.trim();
    if (token.length < 30) throw new BadRequestException('Token không hợp lệ');
    const longLived = this.meta.configured ? await this.meta.exchangeLongLived(token).catch(() => token) : token;
    return this.save(userId, longLived);
  }

  private async save(userId: string, token: string): Promise<ConnectionDto> {
    const info = await this.meta.inspectToken(token);
    if (!info.scopes.includes('pages_show_list')) {
      throw new BadRequestException('Token thiếu quyền quản lý Page (pages_show_list). Hãy cấp quyền rồi thử lại.');
    }
    const profile = await this.meta.me(token);
    const externalUserId = info.userId || profile.id;
    const data = {
      displayName: profile.name,
      encrypted: this.crypto.encrypt(token),
      tokenExpiresAt: info.expiresAt,
      scopes: info.scopes,
      status: 'ACTIVE' as const,
      lastError: null,
    };
    const connection = await this.prisma.socialConnection.upsert({
      where: { userId_platform_externalUserId: { userId, platform: 'FACEBOOK', externalUserId } },
      update: data,
      create: { ...data, userId, platform: 'FACEBOOK', externalUserId },
    });
    await this.syncPages(connection, token);
    return this.toDto(connection.id);
  }

  /**
   * Lưu danh sách Page kèm Page access token. Lỗi ở đây không làm hỏng việc kết nối:
   * người dùng vẫn kết nối xong, chỉ là chưa thấy Page nào.
   */
  async syncPages(connection: SocialConnection, token: string): Promise<number> {
    try {
      const pages = await this.meta.listPages(token);
      const seen: string[] = [];
      for (const page of pages) {
        if (!page.access_token) continue;
        seen.push(page.id);
        const data = {
          connectionId: connection.id,
          name: page.name,
          category: page.category ?? null,
          pictureUrl: page.picture?.data?.url ?? null,
          encrypted: this.crypto.encrypt(page.access_token),
          tasks: page.tasks ?? [],
        };
        await this.prisma.facebookPage.upsert({
          where: { userId_externalId: { userId: connection.userId, externalId: page.id } },
          update: data,
          create: { ...data, userId: connection.userId, externalId: page.id },
        });
      }
      // Page không còn quản lý qua kết nối này thì gỡ khỏi danh sách
      await this.prisma.facebookPage.deleteMany({
        where: { userId: connection.userId, connectionId: connection.id, externalId: { notIn: seen } },
      });
      return seen.length;
    } catch (e) {
      this.logger.warn(`Không tải được danh sách Page: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
  }

  async list(userId: string): Promise<ConnectionDto[]> {
    const rows = await this.prisma.socialConnection.findMany({
      where: { userId },
      include: { _count: { select: { pages: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      status: c.status,
      scopes: c.scopes,
      tokenExpiresAt: c.tokenExpiresAt?.toISOString() ?? null,
      pageCount: c._count.pages,
      lastError: c.lastError,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  async pages(userId: string): Promise<PageDto[]> {
    const rows = await this.prisma.facebookPage.findMany({ where: { userId }, orderBy: { name: 'asc' } });
    return rows.map(toPageDto);
  }

  /** Tải lại danh sách Page từ Facebook cho mọi kết nối đang hoạt động. */
  async refreshPages(userId: string): Promise<PageDto[]> {
    const connections = await this.prisma.socialConnection.findMany({ where: { userId, status: 'ACTIVE' } });
    for (const connection of connections) {
      await this.syncPages(connection, this.crypto.decrypt(connection.encrypted));
    }
    return this.pages(userId);
  }

  async disconnect(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.socialConnection.deleteMany({ where: { id, userId } });
    if (!count) throw new NotFoundException('Không tìm thấy kết nối');
  }

  /** Page kèm token đã giải mã, dùng cho các thao tác gọi Facebook. */
  async pageWithToken(userId: string, pageId: string): Promise<{ page: FacebookPage; token: string }> {
    const page = await this.prisma.facebookPage.findFirst({ where: { id: pageId, userId } });
    if (!page) throw new NotFoundException('Không tìm thấy Page');
    return { page, token: this.crypto.decrypt(page.encrypted) };
  }

  /** Đánh dấu kết nối cần đăng nhập lại (token hỏng / bị thu hồi). */
  async markNeedsReauth(connectionId: string, message: string): Promise<void> {
    await this.prisma.socialConnection.update({
      where: { id: connectionId },
      data: { status: 'NEEDS_REAUTH', lastError: message.slice(0, 500) },
    });
  }

  private async toDto(id: string): Promise<ConnectionDto> {
    const row = await this.prisma.socialConnection.findUniqueOrThrow({ where: { id } });
    const dto = (await this.list(row.userId)).find((c) => c.id === id);
    if (!dto) throw new NotFoundException('Không đọc được kết nối vừa lưu');
    return dto;
  }
}
