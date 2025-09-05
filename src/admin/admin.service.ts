import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const [users, spent] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.transaction.aggregate({ _sum: { amount: true }, where: { type: 'DEBIT' } }),
    ]);
    return { users, spent: spent._sum.amount ?? 0 };
  }
}


