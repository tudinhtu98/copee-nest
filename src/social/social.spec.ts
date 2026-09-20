import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { CryptoService } from './crypto.service';
import { normalizeImage } from './media.service';
import { toPagePostDto } from './page-posts.service';
import { validateSchedule } from './posts.service';

function cryptoWith(keys: string, active = '1'): CryptoService {
  const config = {
    get: (k: string) =>
      k === 'ENCRYPTION_KEYS'
        ? keys
        : k === 'ENCRYPTION_ACTIVE_KEY_VERSION'
          ? active
          : undefined,
  } as unknown as ConfigService;
  return new CryptoService(config);
}

const KEY_1 = randomBytes(32).toString('base64');
const KEY_2 = randomBytes(32).toString('base64');

describe('CryptoService', () => {
  it('mã hoá rồi giải mã ra đúng token ban đầu', () => {
    const crypto = cryptoWith(`1:${KEY_1}`);
    const token = 'EAAG-token-facebook-rat-dai';
    const encrypted = crypto.encrypt(token);

    expect(encrypted).not.toContain(token);
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(crypto.decrypt(encrypted)).toBe(token);
  });

  it('đổi khoá vẫn giải mã được dữ liệu mã hoá bằng khoá cũ', () => {
    const old = cryptoWith(`1:${KEY_1}`);
    const encrypted = old.encrypt('token-cu');
    // Khoá mới là 2, nhưng khoá 1 vẫn giữ trong danh sách
    const rotated = cryptoWith(`1:${KEY_1},2:${KEY_2}`, '2');

    expect(rotated.decrypt(encrypted)).toBe('token-cu');
    expect(rotated.encrypt('token-moi').startsWith('v2:')).toBe(true);
  });

  it('báo lỗi rõ ràng khi cấu hình khoá sai', () => {
    expect(() => cryptoWith('').encrypt('x')).toThrow(/ENCRYPTION_KEYS/);
    expect(() =>
      cryptoWith(`1:${randomBytes(16).toString('base64')}`).encrypt('x'),
    ).toThrow(/32 byte/);
    expect(() => cryptoWith(`1:${KEY_1}`, '9').encrypt('x')).toThrow(
      /ENCRYPTION_ACTIVE_KEY_VERSION/,
    );
  });

  it('không giải mã được nếu thiếu khoá của phiên bản đó', () => {
    const encrypted = cryptoWith(`2:${KEY_2}`, '2').encrypt('token');
    expect(() => cryptoWith(`1:${KEY_1}`).decrypt(encrypted)).toThrow(
      /không hợp lệ|thiếu khoá/,
    );
  });
});

describe('validateSchedule', () => {
  const now = new Date('2026-09-20T10:00:00Z');

  it('chấp nhận trong khoảng 10 phút – 30 ngày', () => {
    expect(() =>
      validateSchedule(new Date('2026-09-20T10:10:00Z'), now),
    ).not.toThrow();
    expect(() =>
      validateSchedule(new Date('2026-10-20T10:00:00Z'), now),
    ).not.toThrow();
  });

  it('từ chối quá sớm, quá xa hoặc ngày không hợp lệ', () => {
    expect(() =>
      validateSchedule(new Date('2026-09-20T10:09:00Z'), now),
    ).toThrow(/10 phút/);
    expect(() =>
      validateSchedule(new Date('2026-10-20T10:01:00Z'), now),
    ).toThrow(/30 ngày/);
    expect(() => validateSchedule(new Date('không phải ngày'), now)).toThrow(
      /không hợp lệ/,
    );
  });
});

describe('normalizeImage', () => {
  it('đổi PNG trong suốt sang JPEG và thu nhỏ về tối đa 2048px', async () => {
    const png = await sharp({
      create: {
        width: 3000,
        height: 1000,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();

    const out = await normalizeImage(png);

    expect([out.width, out.height]).toEqual([2048, 683]);
    expect((await sharp(out.data).metadata()).format).toBe('jpeg');
  });

  it('từ chối file không phải ảnh', async () => {
    await expect(normalizeImage(Buffer.from('không phải ảnh'))).rejects.toThrow(
      /không phải ảnh hợp lệ/,
    );
  });
});

describe('toPagePostDto', () => {
  it('đọc đúng số ảnh album, loại bài, link và lượt tương tác', () => {
    const dto = toPagePostDto(
      {
        id: 'pg_1',
        created_time: '2026-09-18T01:00:00+0000',
        message: 'Giày mới về',
        full_picture: 'https://scontent.fbcdn.net/a.jpg',
        attachments: {
          data: [
            {
              type: 'album',
              media_type: 'ALBUM',
              subattachments: { data: [{}, {}, {}] },
            },
          ],
        },
        reactions: { summary: { total_count: 12 } },
        comments: { summary: { total_count: 3 } },
        shares: { count: 2 },
      },
      new Map([['pg_1', 'local-1']]),
    );

    expect(dto).toMatchObject({
      imageCount: 3,
      type: 'album',
      link: null,
      reactions: 12,
      comments: 3,
      shares: 2,
      localPostId: 'local-1',
    });
  });

  it('bài chia sẻ link thì lấy link gốc, không lấy link bọc của Facebook', () => {
    const dto = toPagePostDto(
      {
        id: 'pg_2',
        created_time: '2026-09-18T01:00:00+0000',
        attachments: {
          data: [{ type: 'share', unshimmed_url: 'https://shop.vn/giay' }],
        },
      },
      new Map(),
    );

    expect(dto).toMatchObject({
      link: 'https://shop.vn/giay',
      message: '',
      imageCount: 0,
      localPostId: null,
    });
  });
});
