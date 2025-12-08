import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';

export interface CreateAuditLogDto {
  userId: string;
  userEmail: string;
  userRole: UserRole;
  action: string;
  resource: string;
  resourceId?: string;
  method: string;
  endpoint: string;
  ipAddress?: string;
  userAgent?: string;
  requestBody?: any;
  response?: any;
  status: number;
  errorMessage?: string;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateAuditLogDto) {
    // Filter sensitive data from request body
    const filteredRequestBody = this.filterSensitiveData(data.requestBody);

    return this.prisma.auditLog.create({
      data: {
        ...data,
        requestBody: filteredRequestBody,
      },
    });
  }

  async findAll(params?: {
    userId?: string;
    action?: string;
    resource?: string;
    startDate?: Date;
    endDate?: Date;
    skip?: number;
    take?: number;
  }) {
    const where: any = {};

    if (params?.userId) where.userId = params.userId;
    if (params?.action) where.action = params.action;
    if (params?.resource) where.resource = params.resource;
    if (params?.startDate || params?.endDate) {
      where.createdAt = {};
      if (params.startDate) where.createdAt.gte = params.startDate;
      if (params.endDate) where.createdAt.lte = params.endDate;
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params?.skip || 0,
        take: params?.take || 50,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { logs, total };
  }

  async findByUser(userId: string, params?: { skip?: number; take?: number }) {
    return this.findAll({
      userId,
      skip: params?.skip,
      take: params?.take,
    });
  }

  async findByResource(
    resource: string,
    resourceId?: string,
    params?: { skip?: number; take?: number },
  ) {
    const where: any = { resource };
    if (resourceId) where.resourceId = resourceId;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params?.skip || 0,
        take: params?.take || 50,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { logs, total };
  }

  private filterSensitiveData(data: any): any {
    if (!data || typeof data !== 'object') return data;

    const sensitiveFields = [
      'password',
      'passwordHash',
      'currentPassword',
      'newPassword',
      'token',
      'refreshToken',
      'accessToken',
      'apiKey',
      'secret',
      'wooConsumerSecret',
      'wpApplicationPassword',
    ];

    const filtered = Array.isArray(data) ? [...data] : { ...data };

    for (const key in filtered) {
      if (sensitiveFields.some((field) => key.toLowerCase().includes(field.toLowerCase()))) {
        filtered[key] = '[REDACTED]';
      } else if (typeof filtered[key] === 'object' && filtered[key] !== null) {
        filtered[key] = this.filterSensitiveData(filtered[key]);
      }
    }

    return filtered;
  }
}
