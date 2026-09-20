import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * Mã hoá access token của Facebook trước khi lưu DB (AES-256-GCM).
 *
 * Khoá lấy từ biến môi trường ENCRYPTION_KEYS dạng "1:<base64 32 byte>[,2:<base64 32 byte>]".
 * Có nhiều phiên bản khoá để đổi khoá mà không phải mã hoá lại dữ liệu cũ: dữ liệu mới dùng
 * khoá ENCRYPTION_ACTIVE_KEY_VERSION, dữ liệu cũ vẫn giải mã được bằng khoá cũ.
 *
 * Sinh khoá mới: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private keys = new Map<number, Buffer>();
  private activeVersion = 1;

  constructor(private readonly config: ConfigService) {}

  private load() {
    if (this.keys.size) return;
    const raw = this.config.get<string>('ENCRYPTION_KEYS');
    if (!raw) {
      throw new Error(
        'Chưa cấu hình ENCRYPTION_KEYS. Thêm vào .env: ENCRYPTION_KEYS=1:<base64 32 byte>',
      );
    }
    for (const part of raw.split(',')) {
      const [versionStr, b64] = part.trim().split(':');
      const version = Number(versionStr);
      const key = Buffer.from(b64 ?? '', 'base64');
      if (!Number.isInteger(version) || version <= 0) {
        throw new Error(`ENCRYPTION_KEYS sai định dạng ở "${part}"`);
      }
      if (key.length !== 32) {
        throw new Error(
          `Khoá phiên bản ${version} phải dài đúng 32 byte (đang ${key.length})`,
        );
      }
      this.keys.set(version, key);
    }
    this.activeVersion = Number(
      this.config.get<string>('ENCRYPTION_ACTIVE_KEY_VERSION') ?? 1,
    );
    if (!this.keys.has(this.activeVersion)) {
      throw new Error(
        `ENCRYPTION_ACTIVE_KEY_VERSION=${this.activeVersion} không có trong ENCRYPTION_KEYS`,
      );
    }
  }

  /** Kết quả: v<phiên bản>:<iv>:<tag>:<dữ liệu>, tất cả base64. */
  encrypt(plain: string): string {
    this.load();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(
      ALGORITHM,
      this.keys.get(this.activeVersion)!,
      iv,
    );
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [
      `v${this.activeVersion}`,
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      data.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string): string {
    this.load();
    const [versionPart, ivB64, tagB64, dataB64] = payload.split(':');
    const version = Number((versionPart ?? '').replace(/^v/, ''));
    const key = this.keys.get(version);
    if (!key || !ivB64 || !tagB64 || !dataB64) {
      throw new Error('Dữ liệu mã hoá không hợp lệ hoặc thiếu khoá giải mã');
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
