import type { AiAction } from '@prisma/client';
import { toActionDto } from './actions.service';
import { toGeminiSchema } from './gemini.client';

const base = {
  id: 'a1',
  userId: 'u1',
  source: 'CHAT',
  kind: 'CREATE_VIDEO',
  status: 'PROPOSED',
  summary: 'Tạo video cho "Bình giữ nhiệt"',
  params: {},
  preview: {
    items: [{ label: 'Chi phí', after: '5.000 điểm' }],
    warnings: ['Trừ 5.000 điểm khi xác nhận'],
  },
  result: null,
  error: null,
  costPoints: 5000,
  chatMessageId: null,
  apiKeyId: null,
  executedAt: null,
  createdAt: new Date('2026-09-20T10:00:00Z'),
  updatedAt: new Date('2026-09-20T10:00:00Z'),
} as unknown as AiAction;

describe('toActionDto', () => {
  it('đề xuất còn hạn thì hiện đúng nội dung xem trước và chi phí', () => {
    const dto = toActionDto(
      { ...base, expiresAt: new Date('2026-09-20T10:15:00Z') },
      new Date('2026-09-20T10:05:00Z'),
    );
    expect(dto).toMatchObject({ status: 'PROPOSED', costPoints: 5000 });
    expect(dto.items[0]).toEqual({ label: 'Chi phí', after: '5.000 điểm' });
    expect(dto.warnings).toHaveLength(1);
  });

  it('quá hạn mà chưa ai bấm thì hiển thị là đã hết hạn', () => {
    const dto = toActionDto(
      { ...base, expiresAt: new Date('2026-09-20T10:15:00Z') },
      new Date('2026-09-20T10:20:00Z'),
    );
    expect(dto.status).toBe('EXPIRED');
  });

  it('đã thực hiện thì hiện kết quả từng mục thay cho bản xem trước', () => {
    const dto = toActionDto(
      {
        ...base,
        status: 'EXECUTED',
        expiresAt: new Date('2026-09-20T10:15:00Z'),
        result: { items: [{ label: 'Mã job', after: 'job-1', ok: true }] },
      } as unknown as AiAction,
      new Date('2026-09-20T10:20:00Z'),
    );
    expect(dto.status).toBe('EXECUTED');
    expect(dto.items).toEqual([{ label: 'Mã job', after: 'job-1', ok: true }]);
  });
});

describe('toGeminiSchema', () => {
  it('đổi JSON Schema sang dạng Gemini (kiểu viết in) và giữ enum, required', () => {
    const schema = toGeminiSchema({
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'id' },
        tone: { type: 'string', enum: ['friendly', 'luxury'] },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['productId'],
    });

    expect(schema).toMatchObject({
      type: 'OBJECT',
      required: ['productId'],
      properties: {
        productId: { type: 'STRING', description: 'id' },
        tone: { type: 'STRING', enum: ['friendly', 'luxury'] },
        tags: { type: 'ARRAY', items: { type: 'STRING' } },
      },
    });
  });

  it('bỏ qua dữ liệu không phải lược đồ', () => {
    expect(toGeminiSchema(null)).toBeUndefined();
    expect(toGeminiSchema({ description: 'thiếu type' })).toBeUndefined();
  });
});
