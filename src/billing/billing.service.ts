import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  getBalance(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
  }

  async credit(
    userId: string,
    amount: number,
    reference?: string,
    description?: string,
  ) {
    if (!amount || amount <= 0) {
      throw new BadRequestException('Số tiền phải lớn hơn 0');
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: amount } },
        select: { id: true, balance: true },
      });
      const transaction = await tx.transaction.create({
        data: {
          userId,
          amount: Math.abs(amount),
          type: 'CREDIT',
          reference,
          description,
        },
      });
      return { user, transaction };
    });
  }

  async debit(
    userId: string,
    amount: number,
    reference?: string,
    description?: string,
  ) {
    if (!amount || amount <= 0) {
      throw new BadRequestException('Số tiền phải lớn hơn 0');
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, balance: true },
      });
      if (!user) {
        throw new NotFoundException('Không tìm thấy người dùng');
      }
      if (user.balance < amount) {
        throw new BadRequestException('Số dư không đủ');
      }
      const updated = await tx.user.update({
        where: { id: userId },
        data: { balance: { decrement: amount } },
        select: { id: true, balance: true },
      });
      const transaction = await tx.transaction.create({
        data: {
          userId,
          amount: -Math.abs(amount),
          type: 'DEBIT',
          reference,
          description,
        },
      });
      return { user: updated, transaction };
    });
  }

  async spending(userId: string, range: 'week' | 'month' | 'quarter' | 'year') {
    const now = new Date();
    const start = new Date(now);
    switch (range) {
      case 'month':
        start.setMonth(now.getMonth() - 1);
        break;
      case 'quarter':
        start.setMonth(now.getMonth() - 3);
        break;
      case 'year':
        start.setFullYear(now.getFullYear() - 1);
        break;
      case 'week':
      default:
        start.setDate(now.getDate() - 7);
        break;
    }

    const aggregate = await this.prisma.transaction.aggregate({
      _sum: { amount: true },
      where: {
        userId,
        type: 'DEBIT',
        createdAt: { gte: start },
      },
    });

    return { amount: Math.abs(aggregate._sum.amount ?? 0) };
  }

  async getTransactions(
    userId: string,
    options?: {
      page?: number
      limit?: number
      type?: string
      startDate?: Date
      endDate?: Date
    },
  ) {
    const page = options?.page || 1
    const limit = options?.limit || 20
    const skip = (page - 1) * limit

    const where: any = { userId }

    if (options?.type) {
      where.type = options.type.toUpperCase()
    }

    if (options?.startDate || options?.endDate) {
      where.createdAt = {}
      if (options.startDate) {
        where.createdAt.gte = options.startDate
      }
      if (options.endDate) {
        where.createdAt.lte = options.endDate
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ])

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }
}
