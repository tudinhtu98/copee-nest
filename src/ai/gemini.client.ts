import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';

const GBASE = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT_MS = 120_000;
/** Đủ rộng cho 3 phương án bài viết kể cả khi model tiêu ~1.000 token cho phần suy nghĩ. */
const TEXT_MAX_OUTPUT_TOKENS = 4096;

export interface GeneratedImage {
  /** null khi model từ chối tạo (nội dung bị chặn). */
  image: Buffer | null;
  mimeType: string | null;
  blockedReason: string | null;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
  functionCall?: { name?: string; args?: unknown };
  functionResponse?: { name: string; response: unknown };
}

interface GeminiResponse {
  candidates?: { content?: GeminiContent; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

export interface GeminiContent {
  role?: string;
  parts?: GeminiPart[];
}

export interface ChatToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ChatTurn {
  text: string;
  calls: ChatToolCall[];
  /** Lượt trả lời của model, phải đưa NGUYÊN VĂN vào lịch sử trước khi gửi kết quả công cụ. */
  content: GeminiContent | null;
  finishReason?: string;
}

/**
 * Gemini không nhận JSON Schema thuần: `type` phải viết in (OBJECT, STRING…) và các khoá lạ
 * như additionalProperties bị từ chối. Hàm này đổi lược đồ công cụ sang dạng Gemini hiểu.
 */
export function toGeminiSchema(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const source = input as Record<string, unknown>;
  if (typeof source.type !== 'string') return undefined;
  const schema: Record<string, unknown> = { type: source.type.toUpperCase() };
  if (typeof source.description === 'string') schema.description = source.description;
  if (Array.isArray(source.enum)) schema.enum = source.enum.map(String);
  if (Array.isArray(source.required)) schema.required = source.required.map(String);
  if (source.properties && typeof source.properties === 'object') {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source.properties as Record<string, unknown>)) {
      const converted = toGeminiSchema(value);
      if (converted) properties[key] = converted;
    }
    schema.properties = properties;
  }
  if (source.items) {
    const items = toGeminiSchema(source.items);
    if (items) schema.items = items;
  }
  return schema;
}

/**
 * Gọi Gemini cho phần viết chữ và tạo ảnh (video vẫn do RenderService lo).
 * Dùng REST giống RenderService để không thêm SDK mới; model đổi được qua Settings hoặc .env.
 */
@Injectable()
export class GeminiClient {
  private readonly logger = new Logger(GeminiClient.name);

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  private key(): string {
    const key = this.config.get<string>('GEMINI_API_KEY');
    if (!key) throw new BadRequestException('GEMINI_API_KEY chưa được cấu hình');
    return key;
  }

  /** Model viết chữ; đổi trong Cài đặt (GEMINI_TEXT_MODEL) mà không cần deploy lại. */
  async textModel(): Promise<string> {
    return (
      (await this.settings.get('GEMINI_TEXT_MODEL')) ||
      this.config.get<string>('GEMINI_TEXT_MODEL') ||
      'gemini-2.5-flash'
    );
  }

  /**
   * Model cho trợ lý chat. Phải là đời 3.x: đo thực tế thấy gemini-2.5-flash KHÔNG chịu nối chuỗi
   * công cụ (được bảo tự tra id thì nó vẫn hỏi ngược người dùng), còn 3.5-flash / 3.8-flash làm đúng.
   */
  async chatModel(): Promise<string> {
    return (
      (await this.settings.get('AI_CHAT_MODEL')) ||
      this.config.get<string>('AI_CHAT_MODEL') ||
      'gemini-3.8-flash'
    );
  }

  /**
   * Model tạo ảnh. Lưu ý: các model ảnh của Google KHÔNG có hạn mức miễn phí,
   * key phải được bật thanh toán.
   */
  async imageModel(): Promise<string> {
    return (
      (await this.settings.get('GEMINI_IMAGE_MODEL')) ||
      this.config.get<string>('GEMINI_IMAGE_MODEL') ||
      'gemini-3.1-flash-lite-image'
    );
  }

  /** Một lượt hỏi đáp thuần chữ. `images` để model nhìn ảnh sản phẩm rồi viết sát hơn. */
  async generateText(input: {
    system: string;
    prompt: string;
    images?: { mimeType: string; base64: string }[];
    maxOutputTokens?: number;
  }): Promise<string> {
    const model = await this.textModel();
    const parts: GeminiPart[] = [
      ...(input.images ?? []).map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.base64 } })),
      { text: input.prompt },
    ];
    const res = await this.call(model, {
      contents: [{ role: 'user', parts }],
      systemInstruction: { parts: [{ text: input.system }] },
      // Gemini 2.5 trở lên tiêu output token cho phần "suy nghĩ" trước khi viết (đo thực tế:
      // ~1.000 token chỉ để nghĩ). Hạn mức sát sạt sẽ khiến bài bị cắt giữa chừng, nên để rộng.
      generationConfig: { temperature: 0.9, maxOutputTokens: input.maxOutputTokens ?? TEXT_MAX_OUTPUT_TOKENS },
    });
    const candidate = res.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim();
    if (candidate?.finishReason === 'MAX_TOKENS') {
      this.logger.warn(`Gemini cắt giữa chừng vì hết hạn mức token (model ${model})`);
      throw new BadGatewayException('AI viết dài quá mức cho phép nên bị cắt giữa chừng. Thử giảm số phương án hoặc rút ngắn mô tả.');
    }
    if (!text) {
      const reason = res.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'KHÔNG CÓ NỘI DUNG';
      throw new BadGatewayException(`AI không trả về nội dung (${reason}). Thử mô tả lại.`);
    }
    return text;
  }

  /** Tạo một ảnh. Có `reference` ⇒ AI giữ sản phẩm trong ảnh đó và chỉ đổi bối cảnh. */
  async generateImage(input: {
    prompt: string;
    aspectRatio: string;
    reference?: { mimeType: string; base64: string };
  }): Promise<GeneratedImage & { model: string }> {
    const model = await this.imageModel();
    const parts: GeminiPart[] = [
      ...(input.reference ? [{ inline_data: { mime_type: input.reference.mimeType, data: input.reference.base64 } }] : []),
      { text: input.prompt },
    ];
    const res = await this.call(model, {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: input.aspectRatio } },
    });
    const found = (res.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data || p.inline_data?.data);
    const data = found?.inlineData?.data ?? found?.inline_data?.data;
    if (!data) {
      return {
        model,
        image: null,
        mimeType: null,
        blockedReason: res.promptFeedback?.blockReason ?? res.candidates?.[0]?.finishReason ?? 'NO_IMAGE',
      };
    }
    return {
      model,
      image: Buffer.from(data, 'base64'),
      mimeType: found?.inlineData?.mimeType ?? found?.inline_data?.mime_type ?? 'image/png',
      blockedReason: null,
    };
  }

  /**
   * Một lượt chat có kèm công cụ. `contents` là toàn bộ lịch sử đang chạy (ChatService tự cộng dồn):
   * lượt của model phải được đưa lại nguyên văn, vì Gemini gắn chữ ký suy nghĩ vào chính các part đó.
   */
  async chat(input: {
    system: string;
    contents: GeminiContent[];
    tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
  }): Promise<ChatTurn> {
    const model = await this.chatModel();
    const functionDeclarations = input.tools.map((t) => {
      const parameters = toGeminiSchema(t.inputSchema);
      const hasProps = parameters?.properties && Object.keys(parameters.properties as object).length > 0;
      return {
        name: t.name,
        description: t.description,
        // Công cụ không có tham số thì phải bỏ hẳn `parameters`, không được để object rỗng
        ...(hasProps ? { parameters } : {}),
      };
    });

    const res = await this.call(model, {
      contents: input.contents,
      systemInstruction: { parts: [{ text: input.system }] },
      tools: [{ functionDeclarations }],
      generationConfig: { temperature: 0.4, maxOutputTokens: TEXT_MAX_OUTPUT_TOKENS },
    });

    const candidate = res.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    return {
      text: parts
        .map((p) => p.text ?? '')
        .join('')
        .trim(),
      calls: parts
        .flatMap((p) => (p.functionCall ? [p.functionCall] : []))
        .map((c) => ({ name: c.name ?? '', args: (c.args ?? {}) as Record<string, unknown> })),
      content: candidate?.content ?? null,
      finishReason: candidate?.finishReason,
    };
  }

  private async call(model: string, body: unknown): Promise<GeminiResponse> {
    let res: Response;
    try {
      res = await fetch(`${GBASE}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key() },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      this.logger.error(`Không gọi được Gemini: ${String(e)}`);
      throw new BadGatewayException('Không kết nối được Gemini, vui lòng thử lại');
    }

    const json = (await res.json().catch(() => null)) as GeminiResponse | null;
    if (!res.ok || json?.error) {
      const message = json?.error?.message ?? `HTTP ${res.status}`;
      this.logger.warn(`Gemini (${model}) lỗi: ${message}`);
      if (res.status === 400 && /api.?key/i.test(message)) {
        throw new BadRequestException('GEMINI_API_KEY không hợp lệ, vui lòng kiểm tra lại.');
      }
      if (res.status === 403 || (res.status === 429 && /limit:\s*0|free.?tier|billing/i.test(message))) {
        throw new BadRequestException(
          `Model ${model} cần API key đã bật thanh toán (model tạo ảnh không có hạn mức miễn phí). Google trả về: ${message}`,
        );
      }
      if (res.status === 429) throw new BadRequestException('Gemini đang giới hạn tần suất, thử lại sau ít phút.');
      if (res.status === 404) {
        throw new BadRequestException(`Model ${model} không dùng được với key này. Đổi model trong Cài đặt. Google trả về: ${message}`);
      }
      throw new BadGatewayException(`Lỗi từ Gemini: ${message}`);
    }
    if (!json) throw new BadGatewayException('Gemini trả về phản hồi không hợp lệ');
    return json;
  }
}
