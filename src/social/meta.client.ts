import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const GRAPH_VERSION = 'v26.0';
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Quyền xin khi kết nối Facebook. Chỉ gồm phần Page — copee không quản lý quảng cáo.
 * - pages_show_list: liệt kê Page đang quản lý
 * - pages_read_engagement: đọc thông tin Page
 * - pages_read_user_content: ĐỌC danh sách bài trên Page (bắt buộc, thiếu là lỗi #10)
 * - pages_manage_posts: đăng / xoá bài
 */
export const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_posts',
];

/**
 * Token hỏng / bị thu hồi / thiếu quyền ⇒ người dùng phải kết nối lại.
 * Dùng 409 chứ KHÔNG dùng 401: giao diện hiểu 401 là hết phiên đăng nhập và sẽ đăng xuất
 * người dùng, trong khi thứ hỏng chỉ là kết nối Facebook.
 */
export class MetaAuthError extends ConflictException {
  constructor(message: string) {
    super(message);
  }
}

interface GraphError {
  message: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
}

/** 10 và 200 = thiếu quyền; 102/190/2500 = token hỏng. Đều phải kết nối lại. */
const AUTH_CODES = new Set([10, 102, 190, 200, 2500]);
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80004]);

export interface MetaPage {
  id: string;
  name: string;
  category?: string;
  access_token?: string;
  tasks?: string[];
  picture?: { data?: { url?: string } };
}

interface MetaAttachment {
  type?: string;
  media_type?: string;
  unshimmed_url?: string;
  subattachments?: { data?: unknown[] };
}

export interface MetaPagePost {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
  full_picture?: string;
  is_published?: boolean;
  attachments?: { data?: MetaAttachment[] };
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  shares?: { count?: number };
}

/**
 * Gọi Graph API của Facebook cho phần Page: kết nối tài khoản, liệt kê Page,
 * đăng / hẹn giờ / xem / xoá bài. Mọi lỗi của Facebook được dịch sang lỗi có thông điệp
 * đọc được, và giữ nguyên câu Facebook trả về vì đó là thứ người dùng cần để sửa.
 */
@Injectable()
export class MetaClient {
  private readonly logger = new Logger(MetaClient.name);

  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return Boolean(
      this.config.get('META_APP_ID') && this.config.get('META_APP_SECRET'),
    );
  }

  redirectUri(): string {
    return `${this.config.get('PUBLIC_API_URL')}/social/facebook/callback`;
  }

  authUrl(state: string): string {
    if (!this.configured) {
      throw new BadRequestException(
        'Chưa cấu hình META_APP_ID / META_APP_SECRET trong .env',
      );
    }
    const params = new URLSearchParams({
      client_id: this.config.get<string>('META_APP_ID')!,
      redirect_uri: this.redirectUri(),
      state,
      scope: META_SCOPES.join(','),
      response_type: 'code',
    });
    return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}`;
  }

  /** Đổi code lấy token ngắn hạn (~1-2 giờ). */
  async exchangeCode(code: string): Promise<string> {
    const data = await this.get<{ access_token: string }>(
      '/oauth/access_token',
      {
        client_id: this.config.get<string>('META_APP_ID')!,
        client_secret: this.config.get<string>('META_APP_SECRET')!,
        redirect_uri: this.redirectUri(),
        code,
      },
    );
    return data.access_token;
  }

  /** Đổi sang token dài hạn (~60 ngày). Facebook không có refresh token. */
  async exchangeLongLived(shortLivedToken: string): Promise<string> {
    const data = await this.get<{ access_token: string }>(
      '/oauth/access_token',
      {
        grant_type: 'fb_exchange_token',
        client_id: this.config.get<string>('META_APP_ID')!,
        client_secret: this.config.get<string>('META_APP_SECRET')!,
        fb_exchange_token: shortLivedToken,
      },
    );
    return data.access_token;
  }

  /** Token còn sống không, của ai, quyền gì, hết hạn khi nào. */
  async inspectToken(
    token: string,
  ): Promise<{ userId: string; scopes: string[]; expiresAt: Date | null }> {
    if (this.configured) {
      const appToken = `${this.config.get('META_APP_ID')}|${this.config.get('META_APP_SECRET')}`;
      const data = await this.get<{
        data: {
          user_id?: string;
          scopes?: string[];
          expires_at?: number;
          is_valid?: boolean;
          error?: GraphError;
        };
      }>('/debug_token', { input_token: token, access_token: appToken });
      const info = data.data;
      if (!info?.is_valid)
        throw new MetaAuthError(
          info?.error?.message ?? 'Token không hợp lệ hoặc đã hết hạn',
        );
      return {
        userId: String(info.user_id ?? ''),
        scopes: info.scopes ?? [],
        // expires_at = 0 nghĩa là không hết hạn (System User Token)
        expiresAt: info.expires_at ? new Date(info.expires_at * 1000) : null,
      };
    }
    // Luồng dán token thủ công khi chưa cấu hình App ID/Secret
    const me = await this.get<{ id: string }>('/me', { fields: 'id' }, token);
    const perms = await this.get<{
      data: { permission: string; status: string }[];
    }>('/me/permissions', {}, token);
    return {
      userId: me.id,
      scopes: perms.data
        .filter((p) => p.status === 'granted')
        .map((p) => p.permission),
      expiresAt: null,
    };
  }

  async me(token: string): Promise<{ id: string; name: string }> {
    const data = await this.get<{ id: string; name?: string }>(
      '/me',
      { fields: 'id,name' },
      token,
    );
    return { id: data.id, name: data.name ?? 'Tài khoản Facebook' };
  }

  /** Page người dùng quản lý, kèm Page access token để đăng bài. */
  async listPages(userToken: string): Promise<MetaPage[]> {
    const res = await this.get<{ data?: MetaPage[] }>(
      '/me/accounts',
      {
        fields: 'id,name,category,access_token,tasks,picture{url}',
        limit: '100',
      },
      userToken,
    );
    return res.data ?? [];
  }

  /**
   * Tải ảnh lên Page ở dạng CHƯA đăng để gắn vào bài sau. Bài hẹn giờ bắt buộc temporary=true,
   * nếu không Facebook từ chối bài có ảnh chưa công khai.
   */
  async uploadPagePhoto(
    pageId: string,
    pageToken: string,
    jpeg: Buffer,
    temporary: boolean,
  ): Promise<string> {
    const form = new FormData();
    form.append('published', 'false');
    if (temporary) form.append('temporary', 'true');
    form.append('access_token', pageToken);
    form.append(
      'source',
      new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }),
      'photo.jpg',
    );
    const res = await this.request<{ id: string }>(
      `${GRAPH_URL}/${pageId}/photos`,
      { method: 'POST', body: form },
    );
    return res.id;
  }

  /**
   * Đăng bài lên Page. Có `scheduledAt` ⇒ Facebook tự đăng đúng giờ (10 phút tới 30 ngày).
   * Trả về id bài dạng "<pageId>_<postId>".
   */
  async publishPagePost(
    pageId: string,
    pageToken: string,
    input: {
      message: string;
      link?: string | null;
      photoIds: string[];
      scheduledAt?: Date;
    },
  ): Promise<string> {
    const params: Record<string, string> = { message: input.message };
    if (input.link) params.link = input.link;
    input.photoIds.forEach((id, i) => {
      params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
    });
    if (input.scheduledAt) {
      params.published = 'false';
      params.scheduled_publish_time = String(
        Math.floor(input.scheduledAt.getTime() / 1000),
      );
      params.unpublished_content_type = 'SCHEDULED';
    }
    const res = await this.post<{ id: string }>(
      `/${pageId}/feed`,
      params,
      pageToken,
    );
    return res.id;
  }

  async getPagePost(postId: string, pageToken: string): Promise<MetaPagePost> {
    return this.get<MetaPagePost>(
      `/${postId}`,
      {
        fields:
          'id,message,created_time,permalink_url,full_picture,is_published,attachments{type,unshimmed_url}',
      },
      pageToken,
    );
  }

  /**
   * Bài của Page, mới nhất trước, theo từng trang. Lượt cảm xúc/bình luận chỉ lấy con số tổng
   * (limit(0).summary) để không kéo cả danh sách người bình luận về.
   */
  async listPagePosts(
    pageId: string,
    pageToken: string,
    after?: string,
  ): Promise<{ posts: MetaPagePost[]; nextCursor: string | null }> {
    const res = await this.get<{
      data?: MetaPagePost[];
      paging?: { next?: string; cursors?: { after?: string } };
    }>(
      `/${pageId}/posts`,
      {
        fields:
          'id,message,created_time,permalink_url,full_picture,' +
          'attachments{type,media_type,unshimmed_url,subattachments.limit(20){type}},' +
          'reactions.limit(0).summary(total_count),comments.limit(0).summary(total_count),shares',
        limit: '20',
        ...(after ? { after } : {}),
      },
      pageToken,
    );
    return {
      posts: res.data ?? [],
      nextCursor: res.paging?.next ? (res.paging.cursors?.after ?? null) : null,
    };
  }

  async deletePagePost(postId: string, pageToken: string): Promise<void> {
    await this.request(
      `${GRAPH_URL}/${postId}?${new URLSearchParams({ access_token: pageToken })}`,
      { method: 'DELETE' },
    );
  }

  /** Tải ảnh của bài từ CDN Facebook về máy chủ (tối đa 15MB). */
  async downloadImage(url: string): Promise<Buffer> {
    if (!/^https:\/\/[^/]*(fbcdn\.net|facebook\.com)\//i.test(url)) {
      throw new BadRequestException('Link ảnh không phải của Facebook');
    }
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new BadGatewayException('Không tải được ảnh của bài từ Facebook');
    }
    const size = Number(res.headers.get('content-length') ?? 0);
    if (!res.ok || size > 15 * 1024 * 1024)
      throw new BadGatewayException('Không tải được ảnh của bài từ Facebook');
    return Buffer.from(await res.arrayBuffer());
  }

  private get<T>(
    path: string,
    params: Record<string, string>,
    token?: string,
  ): Promise<T> {
    const query = new URLSearchParams(
      token ? { ...params, access_token: token } : params,
    );
    return this.request<T>(`${GRAPH_URL}${path}?${query}`);
  }

  private post<T>(
    path: string,
    params: Record<string, string>,
    token: string,
  ): Promise<T> {
    return this.request<T>(`${GRAPH_URL}${path}`, {
      method: 'POST',
      body: new URLSearchParams({ ...params, access_token: token }),
    });
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      this.logger.error(`Không gọi được Graph API: ${String(e)}`);
      throw new BadGatewayException(
        'Không kết nối được Facebook, vui lòng thử lại',
      );
    }
    const json = (await res.json().catch(() => null)) as
      | (T & { error?: GraphError })
      | null;
    if (!json)
      throw new BadGatewayException(
        `Facebook trả về phản hồi không hợp lệ (HTTP ${res.status})`,
      );

    const error = json.error;
    if (error) {
      const message =
        error.error_user_msg ||
        error.message ||
        'Lỗi không xác định từ Facebook';
      this.logger.warn(
        `Graph API lỗi ${error.code}/${error.error_subcode}: ${message}`,
      );
      if (AUTH_CODES.has(error.code ?? 0))
        throw new MetaAuthError(`Facebook: ${message}`);
      if (RATE_LIMIT_CODES.has(error.code ?? 0)) {
        throw new ConflictException(
          'Facebook đang giới hạn tần suất, vui lòng thử lại sau vài phút',
        );
      }
      // Facebook từ chối vì nội dung / tham số: câu của Facebook đủ cụ thể để hiện cho người dùng
      throw new BadRequestException(`Facebook: ${message}`);
    }
    if (!res.ok)
      throw new BadGatewayException(`Facebook trả về HTTP ${res.status}`);
    return json;
  }
}
