import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  getBalance(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId }, select: { balance: true } });
  }

  credit(userId: string, amount: number, reference?: string) {
    return this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { balance: { increment: amount } } }),
      this.prisma.transaction.create({ data: { userId, amount, type: 'CREDIT', reference } }),
    ]);
  }

  debit(userId: string, amount: number, reference?: string) {
    return this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { balance: { decrement: amount } } }),
      this.prisma.transaction.create({ data: { userId, amount: -Math.abs(amount), type: 'DEBIT', reference } }),
    ]);
  }
}


