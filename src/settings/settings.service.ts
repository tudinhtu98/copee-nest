import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cấu hình runtime lưu trong DB (bảng settings) — đổi được qua trang admin,
 * không cần sửa .env + restart. Có cache trong bộ nhớ, làm mới khi set.
 */
@Injectable()
export class SettingsService {
  private cache = new Map<string, string>();
  private loaded = false;

  constructor(private readonly prisma: PrismaService) {}

  private async load() {
    if (this.loaded) return;
    const all = await this.prisma.setting.findMany();
    this.cache = new Map(all.map((s) => [s.key, s.value]));
    this.loaded = true;
  }

  async get(key: string): Promise<string | null> {
    await this.load();
    return this.cache.get(key) ?? null;
  }

  /** Lấy nhiều key cùng lúc. */
  async getMany(keys: string[]): Promise<Record<string, string | null>> {
    await this.load();
    return Object.fromEntries(keys.map((k) => [k, this.cache.get(k) ?? null]));
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    await this.load();
    this.cache.set(key, value);
  }
}
