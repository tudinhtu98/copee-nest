import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AiAction, ChatMessage, Conversation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toActionDto, type ActionDto } from './actions.service';
import { GeminiClient, type GeminiContent } from './gemini.client';
import { AiToolsService } from './tools';

const MAX_TOOL_ROUNDS = 6;
const HISTORY_LIMIT = 12;

export interface ChatMessageDto {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: { name: string; summary: string }[];
  actions: ActionDto[];
  cost: number;
  createdAt: string;
}

export interface ConversationDto {
  id: string;
  title: string;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
}

function systemPrompt(today: string): string {
  return [
    'Bạn là trợ lý của copee — công cụ giúp người bán hàng Việt Nam: copy sản phẩm từ Shopee,',
    'đăng lên website WooCommerce, tạo video quảng cáo, và quản lý fanpage Facebook.',
    `Hôm nay là ${today}. Trả lời bằng tiếng Việt, ngắn gọn, đi thẳng vào việc.`,
    '',
    'Nguyên tắc:',
    '- Luôn gọi công cụ để lấy dữ liệu thật trước khi trả lời. Không đoán số dư, giá, trạng thái job.',
    '- KHÔNG BAO GIỜ hỏi người dùng id (sản phẩm, site, fanpage, bài) — họ không biết id.',
    '  Người dùng nói tên gần đúng thì tự gọi list_products / list_pages / list_sites để tìm, rồi dùng id tìm được.',
    '  Tìm ra đúng một kết quả thì làm luôn; nhiều kết quả thì liệt kê ngắn gọn cho họ chọn; không có thì báo không tìm thấy.',
    '- Đủ thông tin rồi thì gọi công cụ ngay trong cùng lượt, đừng hỏi lại cho có.',
    '- Mọi việc TỐN ĐIỂM hoặc khó hoàn tác (tạo ảnh, tạo video, đăng bài, đăng sản phẩm lên site, xoá bài)',
    '  chỉ tạo ĐỀ XUẤT. Người dùng bấm Xác nhận trên thẻ đề xuất thì mới chạy.',
    '  Tuyệt đối không nói "đã đăng / đã tạo xong"; hãy nói "đã tạo đề xuất, bạn bấm Xác nhận để thực hiện".',
    '- Riêng viết nội dung bài (write_post_content) có trừ điểm ngay: nói rõ số điểm đã trừ sau khi viết xong.',
    '- Trước khi làm việc tốn điểm, nếu người dùng chưa biết giá thì nói giá (get_balance có bảng giá).',
    '- Công cụ báo lỗi thì giải thích lại cho người dùng bằng lời dễ hiểu, không tìm cách lách.',
  ].join('\n');
}

/** Trợ lý AI trong web: hỏi đáp dữ liệu copee và tạo đề xuất cho các việc cần xác nhận. */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiClient,
    private readonly tools: AiToolsService,
  ) {}

  async listConversations(userId: string): Promise<ConversationDto[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { userId },
      include: { _count: { select: { messages: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    return rows.map((c) => ({
      id: c.id,
      title: c.title,
      messageCount: c._count.messages,
      lastMessageAt: c.messages[0]?.createdAt.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  async createConversation(userId: string): Promise<ConversationDto> {
    const row = await this.prisma.conversation.create({ data: { userId, title: 'Cuộc trò chuyện mới' } });
    return { id: row.id, title: row.title, messageCount: 0, lastMessageAt: null, createdAt: row.createdAt.toISOString() };
  }

  async detail(userId: string, id: string): Promise<ConversationDto & { messages: ChatMessageDto[] }> {
    const conversation = await this.find(userId, id);
    const messages = await this.prisma.chatMessage.findMany({
      where: { conversationId: id },
      include: { actions: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      id: conversation.id,
      title: conversation.title,
      messageCount: messages.length,
      lastMessageAt: messages.at(-1)?.createdAt.toISOString() ?? null,
      createdAt: conversation.createdAt.toISOString(),
      messages: messages.map(toMessageDto),
    };
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.find(userId, id);
    await this.prisma.conversation.delete({ where: { id } });
  }

  /**
   * Một lượt hỏi đáp: AI gọi công cụ để lấy dữ liệu thật (tối đa MAX_TOOL_ROUNDS vòng) rồi trả lời.
   * Công cụ tạo đề xuất sẽ được gắn vào câu trả lời để người dùng bấm Xác nhận.
   */
  async send(userId: string, conversationId: string, message: string): Promise<{ message: ChatMessageDto }> {
    const conversation = await this.find(userId, conversationId);
    const history = await this.prisma.chatMessage.findMany({
      where: { conversationId },
      include: { actions: true },
      orderBy: { createdAt: 'asc' },
      take: HISTORY_LIMIT,
    });
    await this.prisma.chatMessage.create({ data: { conversationId, role: 'user', content: message } });

    const contents: GeminiContent[] = [
      ...history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: withActionOutcome(m) }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ];
    const definitions = this.tools.definitions();
    const actor = { userId, source: 'CHAT' as const, canWrite: true };

    const toolCalls: { name: string; summary: string }[] = [];
    const actionIds: string[] = [];
    let cost = 0;
    let answer = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const turn = await this.gemini.chat({ system: systemPrompt(new Date().toLocaleDateString('vi-VN')), contents, tools: definitions });
      if (turn.text) answer = turn.text;
      if (!turn.calls.length) break;

      // Lượt của model phải giữ nguyên văn trong lịch sử trước khi gửi kết quả công cụ
      contents.push(turn.content ?? { role: 'model', parts: turn.calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })) });

      const responses: { functionResponse: { name: string; response: unknown } }[] = [];
      for (const call of turn.calls) {
        try {
          const result = await this.tools.execute(call.name, call.args, actor);
          toolCalls.push({ name: call.name, summary: result.summary });
          if (result.actionId) actionIds.push(result.actionId);
          if (result.cost) cost += result.cost;
          responses.push({ functionResponse: { name: call.name, response: { output: result.data } } });
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          this.logger.warn(`Công cụ ${call.name} lỗi: ${detail}`);
          // Ghi cả lần gọi lỗi để người dùng thấy, tránh trường hợp AI nói "đã làm" mà thực ra hỏng
          toolCalls.push({ name: call.name, summary: `lỗi: ${detail.slice(0, 120)}` });
          responses.push({ functionResponse: { name: call.name, response: { error: detail } } });
        }
      }
      contents.push({ role: 'user', parts: responses });
    }

    if (!answer) answer = 'Mình chưa lấy được dữ liệu để trả lời. Bạn thử hỏi cụ thể hơn nhé.';

    const saved = await this.prisma.chatMessage.create({
      data: { conversationId, role: 'assistant', content: answer, toolCalls: toolCalls as object, cost },
    });
    if (actionIds.length) {
      await this.prisma.aiAction.updateMany({ where: { id: { in: actionIds }, userId }, data: { chatMessageId: saved.id } });
    }
    const actions = actionIds.length
      ? await this.prisma.aiAction.findMany({ where: { chatMessageId: saved.id }, orderBy: { createdAt: 'asc' } })
      : [];

    // Đặt tên cuộc trò chuyện theo câu hỏi đầu tiên
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: conversation.title === 'Cuộc trò chuyện mới' ? { title: message.slice(0, 60) } : { updatedAt: new Date() },
    });

    return { message: toMessageDto({ ...saved, actions }) };
  }

  private async find(userId: string, id: string): Promise<Conversation> {
    const row = await this.prisma.conversation.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Không tìm thấy cuộc trò chuyện');
    return row;
  }
}

/**
 * Lịch sử gửi cho AI chỉ có chữ; kèm thêm kết cục của các đề xuất trong câu trả lời cũ để lượt sau
 * AI biết người dùng đã xác nhận hay huỷ, không nhắc lại như thể vẫn đang chờ.
 */
function withActionOutcome(m: ChatMessage & { actions: AiAction[] }): string {
  if (!m.actions.length) return m.content;
  const notes = m.actions.map((a) => {
    const dto = toActionDto(a);
    return `[Đề xuất "${dto.summary}": ${dto.status}${dto.error ? ` — ${dto.error}` : ''}]`;
  });
  return `${m.content}\n\n${notes.join('\n')}`;
}

function toMessageDto(m: ChatMessage & { actions?: AiAction[] }): ChatMessageDto {
  return {
    id: m.id,
    role: m.role as 'user' | 'assistant',
    content: m.content,
    toolCalls: (m.toolCalls as unknown as { name: string; summary: string }[]) ?? [],
    actions: (m.actions ?? []).map((a) => toActionDto(a)),
    cost: m.cost,
    createdAt: m.createdAt.toISOString(),
  };
}
