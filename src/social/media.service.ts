import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MediaAsset, MediaSource } from '@prisma/client';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';

/** Cạnh dài tối đa: đủ nét cho bảng tin Facebook mà file vẫn nhỏ. */
const MAX_EDGE = 2048;
/** Facebook nhận JPEG tối đa 4MB (PNG chỉ 1MB, nên mọi ảnh đều đổi sang JPEG). */
const FACEBOOK_MAX_BYTES = 4 * 1024 * 1024;
export const MEDIA_MAX_UPLOAD_MB = 8;

export interface MediaAssetDto {
  id: string;
  source: MediaSource;
  /** Đường dẫn ảnh, dùng thẳng làm src. */
  url: string;
  width: number;
  height: number;
  bytes: number;
  prompt: string | null;
  productId: string | null;
  createdAt: string;
}

export function toMediaDto(a: MediaAsset): MediaAssetDto {
  return {
    id: a.id,
    source: a.source,
    url: `/social/media/${a.id}/file`,
    width: a.width,
    height: a.height,
    bytes: a.bytes,
    prompt: a.prompt,
    productId: a.productId,
    createdAt: a.createdAt.toISOString(),
  };
}

/**
 * Thư viện ảnh dùng cho bài đăng fanpage. File nằm trên đĩa (MEDIA_DIR), DB chỉ giữ thông tin.
 * Mọi ảnh được chuẩn hoá về JPEG: Facebook giới hạn PNG 1MB nên ảnh PNG (nhất là ảnh do AI tạo)
 * thường bị từ chối nếu đăng thẳng.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Thư mục gốc lưu ảnh: MEDIA_DIR, mặc định <thư mục chạy>/storage/media. */
  private root(): string {
    return resolve(
      this.config.get<string>('MEDIA_DIR') ||
        join(process.cwd(), 'storage', 'media'),
    );
  }

  async store(
    userId: string,
    input: Buffer,
    meta: {
      source: MediaSource;
      prompt?: string;
      model?: string;
      productId?: string;
    },
  ): Promise<MediaAssetDto> {
    const image = await normalizeImage(input);
    const month = new Date().toISOString().slice(0, 7);
    const storageKey = `${userId}/${month}/${randomUUID()}.jpg`;
    const path = join(this.root(), storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, image.data);

    const asset = await this.prisma.mediaAsset.create({
      data: {
        userId,
        source: meta.source,
        storageKey,
        mimeType: 'image/jpeg',
        bytes: image.data.length,
        width: image.width,
        height: image.height,
        prompt: meta.prompt ?? null,
        model: meta.model ?? null,
        productId: meta.productId ?? null,
      },
    });
    return toMediaDto(asset);
  }

  async list(userId: string): Promise<MediaAssetDto[]> {
    const rows = await this.prisma.mediaAsset.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(toMediaDto);
  }

  async find(userId: string, id: string): Promise<MediaAsset> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id, userId },
    });
    if (!asset) throw new NotFoundException('Không tìm thấy ảnh');
    return asset;
  }

  /** Ảnh theo ĐÚNG thứ tự id truyền vào; id lạ (không phải của người này) thì báo lỗi. */
  async findMany(userId: string, ids: string[]): Promise<MediaAsset[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.mediaAsset.findMany({
      where: { userId, id: { in: ids } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => {
      const asset = byId.get(id);
      if (!asset) throw new NotFoundException(`Không tìm thấy ảnh ${id}`);
      return asset;
    });
  }

  read(asset: MediaAsset): Promise<Buffer> {
    return readFile(join(this.root(), asset.storageKey));
  }

  async remove(userId: string, id: string): Promise<void> {
    const asset = await this.find(userId, id);
    // Bài chưa đăng còn cần ảnh; bài đã đăng thì ảnh đã nằm trên Facebook rồi
    const inUse = await this.prisma.contentPost.count({
      where: {
        userId,
        mediaIds: { has: id },
        status: { in: ['DRAFT', 'FAILED', 'PUBLISHING'] },
      },
    });
    if (inUse) {
      throw new ConflictException(
        'Ảnh đang được dùng trong bài viết chưa đăng. Gỡ khỏi bài trước khi xoá.',
      );
    }
    await this.prisma.mediaAsset.delete({ where: { id } });
    await rm(join(this.root(), asset.storageKey), { force: true });
  }

  /** Ảnh sản phẩm đã cào về (link ngoài) → lưu vào thư viện để đăng lên Page. */
  async importFromUrl(
    userId: string,
    url: string,
    productId?: string,
  ): Promise<MediaAssetDto> {
    if (!/^https?:\/\//i.test(url))
      throw new BadRequestException('Link ảnh không hợp lệ');
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new BadRequestException('Không tải được ảnh từ link');
    }
    if (!res.ok)
      throw new BadRequestException(`Không tải được ảnh (HTTP ${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MEDIA_MAX_UPLOAD_MB * 1024 * 1024)
      throw new BadRequestException('Ảnh quá lớn');
    return this.store(userId, buffer, {
      source: 'PRODUCT',
      ...(productId ? { productId } : {}),
    });
  }
}

/**
 * Chuẩn hoá ảnh: xoay theo EXIF, thu nhỏ về ≤ 2048px, nền trắng cho ảnh trong suốt, nén JPEG.
 * Ảnh vẫn quá 4MB thì nén mạnh hơn cho vừa giới hạn của Facebook.
 */
export async function normalizeImage(
  input: Buffer,
): Promise<{ data: Buffer; width: number; height: number }> {
  const encode = (quality: number) =>
    sharp(input, { failOn: 'error' })
      .rotate()
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

  try {
    for (const quality of [88, 75, 60]) {
      const { data, info } = await encode(quality);
      if (data.length <= FACEBOOK_MAX_BYTES)
        return { data, width: info.width, height: info.height };
    }
  } catch {
    throw new BadRequestException(
      'File không phải ảnh hợp lệ hoặc định dạng chưa hỗ trợ (dùng JPG, PNG hoặc WebP).',
    );
  }
  throw new BadRequestException(
    'Ảnh quá lớn, không nén được xuống dưới 4MB theo giới hạn của Facebook.',
  );
}

/** Dùng trong test và khi khởi động để biết thư mục ảnh đã tồn tại chưa. */
export function mediaDirExists(dir: string): boolean {
  return existsSync(dir);
}
