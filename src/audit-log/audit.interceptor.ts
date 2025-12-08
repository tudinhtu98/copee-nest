import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AuditLogService } from './audit-log.service';
import { Reflector } from '@nestjs/core';
import { AUDIT_METADATA_KEY } from './audit.decorator';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly auditLogService: AuditLogService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditMetadata = this.reflector.get<{
      action: string;
      resource: string;
    }>(AUDIT_METADATA_KEY, context.getHandler());

    // Nếu không có metadata audit, bỏ qua
    if (!auditMetadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Chỉ log nếu user là ADMIN hoặc MOD
    if (!user || (user.role !== 'ADMIN' && user.role !== 'MOD')) {
      return next.handle();
    }

    const startTime = Date.now();
    const { action, resource } = auditMetadata;

    return next.handle().pipe(
      tap((response) => {
        const duration = Date.now() - startTime;
        const resourceId = this.extractResourceId(request, response);

        this.auditLogService
          .create({
            userId: user.userId,
            userEmail: user.email || user.username,
            userRole: user.role,
            action,
            resource,
            resourceId,
            method: request.method,
            endpoint: request.url,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
            requestBody: request.body,
            response: this.sanitizeResponse(response),
            status: 200,
          })
          .catch((err) => {
            console.error('Failed to create audit log:', err);
          });
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        const resourceId = this.extractResourceId(request, null);

        this.auditLogService
          .create({
            userId: user.userId,
            userEmail: user.email || user.username,
            userRole: user.role,
            action,
            resource,
            resourceId,
            method: request.method,
            endpoint: request.url,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
            requestBody: request.body,
            status: error.status || 500,
            errorMessage: error.message,
          })
          .catch((err) => {
            console.error('Failed to create audit log:', err);
          });

        return throwError(() => error);
      }),
    );
  }

  private extractResourceId(request: any, response: any): string | undefined {
    // Try to get ID from request params
    if (request.params?.id) return request.params.id;
    if (request.params?.siteId) return request.params.siteId;
    if (request.params?.productId) return request.params.productId;
    if (request.params?.userId) return request.params.userId;

    // Try to get ID from response
    if (response?.id) return response.id;

    return undefined;
  }

  private sanitizeResponse(response: any): any {
    if (!response) return null;

    // Limit response size to prevent large payloads
    const responseStr = JSON.stringify(response);
    if (responseStr.length > 5000) {
      return { _truncated: true, size: responseStr.length };
    }

    return response;
  }
}
