import { Body, Controller, Get, Headers, HttpCode, Logger, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { ApiKeysService } from '../api-keys/api-keys.service';
import type { ActionActor } from './actions.service';
import { AiToolsService } from './tools';

/** Phiên bản giao thức MCP mà server này nói được. */
const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'copee', version: '1.0.0' };
/** Quyền cần có trên khoá API để agent được thực hiện thao tác (đề xuất + xác nhận). */
export const MCP_WRITE_PERMISSION = 'ai:write';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: unknown; [key: string]: unknown };
}

function result(id: JsonRpcRequest['id'], payload: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result: payload };
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/**
 * MCP server (JSON-RPC 2.0 qua HTTP POST) cho agent bên ngoài như Claude Desktop.
 * Dùng chung bộ công cụ với chat trong web; agent xác thực bằng khoá API của copee.
 *
 * Xác thực kiểu "lazy": bắt tay (initialize, ping, tools/list) KHÔNG cần khoá, chỉ `tools/call`
 * mới cần — vì một số client kiểm tra URL trước khi người dùng kịp nhập khoá.
 * Khoá không có quyền `ai:write` thì chỉ đọc được, mọi thao tác ghi bị từ chối.
 */
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly tools: AiToolsService,
    private readonly config: ConfigService,
  ) {}

  /** Chuẩn Streamable HTTP: server không mở kênh SSE thì GET phải trả 405. */
  @Get()
  @HttpCode(405)
  noStream() {
    return { error: 'Server MCP này chỉ nhận POST (không mở kênh SSE)' };
  }

  @Post()
  @HttpCode(200) // Nest mặc định 201 cho POST; chuẩn MCP yêu cầu 200
  async rpc(
    @Body() body: JsonRpcRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('authorization') authorization?: string,
  ) {
    const { id, method } = body ?? {};

    // Notification = JSON-RPC không có `id`: chuẩn yêu cầu trả 202 rỗng
    if (id === undefined) {
      res.status(202);
      return;
    }

    switch (method) {
      case 'initialize':
        return result(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions:
            'Công cụ quản lý gian hàng copee: sản phẩm đã copy, website WooCommerce, video quảng cáo, ' +
            'fanpage Facebook, số dư điểm. Số tiền tính bằng "điểm". ' +
            'Các công cụ tốn điểm hoặc khó hoàn tác chỉ tạo ĐỀ XUẤT: hãy cho người dùng xem nội dung và chi phí, ' +
            'chỉ gọi confirm_action khi họ đồng ý rõ ràng. Khoá API không có quyền ai:write sẽ bị từ chối.',
        });

      case 'notifications/initialized':
      case 'ping':
        return result(id, {});

      case 'tools/list':
        return result(id, {
          tools: this.tools.definitions({ includeConfirm: true }).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });

      case 'tools/call': {
        const name = body.params?.name;
        if (!name) return rpcError(id, -32602, 'Thiếu tên công cụ');
        try {
          const actor = await this.authenticate(authorization);
          const output = await this.tools.execute(name, body.params?.arguments, actor);
          this.logger.log(`MCP ${name} · user ${actor.userId} · ${output.summary}`);
          return result(id, { content: [{ type: 'text', text: JSON.stringify(output.data, null, 2) }], isError: false });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          this.logger.warn(`MCP ${name} lỗi: ${message}`);
          return result(id, { content: [{ type: 'text', text: `Lỗi: ${message}` }], isError: true });
        }
      }

      default:
        return rpcError(id, -32601, `Phương thức không hỗ trợ: ${method ?? '(trống)'}`);
    }
  }

  /** URL để dán vào Claude Desktop hoặc agent khác. */
  url(): string {
    return `${this.config.get('PUBLIC_API_URL') || 'http://localhost:3001'}/mcp`;
  }

  private async authenticate(header: string | undefined): Promise<ActionActor> {
    const token = header?.replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new Error('Thiếu khoá API. Tạo khoá trong Cài đặt → API keys rồi cấu hình cho agent.');
    const { userId, permissions } = await this.apiKeys.validateApiKey(token);
    return {
      userId,
      source: 'MCP',
      canWrite: this.apiKeys.hasPermission(permissions, MCP_WRITE_PERMISSION),
    };
  }
}
