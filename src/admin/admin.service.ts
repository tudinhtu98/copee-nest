import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';

type StatsRange = 'week' | 'month' | 'quarter' | 'year';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  async summary() {
    const [users, spent] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { type: 'DEBIT' },
      }),
    ]);
    const totalSpent = spent._sum.amount ?? 0;
    return { users, spent: Math.abs(totalSpent) };
  }

  async creditUser(params: {
    actorId: string;
    userId: string;
    amount: number;
    reference?: string;
  }) {
    const { actorId, userId, amount, reference } = params;
    if (!amount || amount <= 0) {
      throw new BadRequestException('Số tiền phải lớn hơn 0');
    }
    const description = `Manual credit by ${actorId}`;
    const result = await this.billing.credit(
      userId,
      amount,
      reference,
      description,
    );
    return {
      userId,
      amount,
      reference: result.transaction.reference,
      balance: result.user.balance,
    };
  }

  async stats(range: StatsRange) {
    const start = this.getRangeStart(range);

    const [topUsersRaw, topSitesRaw, topProductsRaw, topCategoriesRaw] =
      await this.prisma.$transaction([
        this.prisma.transaction.groupBy({
          by: ['userId'],
          where: { type: 'DEBIT', createdAt: { gte: start } },
          _sum: { amount: true },
          orderBy: { userId: 'asc' },
        }),
        this.prisma.uploadJob.groupBy({
          by: ['siteId'],
          where: { status: 'SUCCESS', createdAt: { gte: start } },
          _count: { _all: true },
          orderBy: { siteId: 'asc' },
        }),
        this.prisma.uploadJob.groupBy({
          by: ['productId'],
          where: { status: 'SUCCESS', createdAt: { gte: start } },
          _count: { _all: true },
          orderBy: { productId: 'asc' },
        }),
        this.prisma.product.groupBy({
          by: ['category'],
          where: { category: { not: null }, createdAt: { gte: start } },
          _count: { _all: true },
          orderBy: { category: 'asc' },
        }),
      ]);

    const countValue = (count: unknown): number => {
      if (!count || typeof count === 'boolean') return 0;
      if (typeof count === 'object' && '_all' in (count as Record<string, number | undefined>)) {
        return (count as Record<string, number | undefined>)._all ?? 0;
      }
      return 0;
    };

    const sortedUsers = [...topUsersRaw]
      .sort((a, b) => (a._sum?.amount ?? 0) - (b._sum?.amount ?? 0))
      .slice(0, 5);
    const sortedSites = [...topSitesRaw]
      .sort((a, b) => countValue(b._count) - countValue(a._count))
      .slice(0, 5);
    const sortedProducts = [...topProductsRaw]
      .sort((a, b) => countValue(b._count) - countValue(a._count))
      .slice(0, 5);
    const sortedCategories = [...topCategoriesRaw]
      .sort((a, b) => countValue(b._count) - countValue(a._count))
      .slice(0, 5);

    const userIds = sortedUsers.map((item) => item.userId);
    const siteIds = sortedSites.map((item) => item.siteId);
    const productIds = sortedProducts.map((item) => item.productId);

    const [users, sites, products] = await Promise.all([
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, username: true, email: true },
          })
        : Promise.resolve([] as { id: string; username: string | null; email: string }[]),
      siteIds.length
        ? this.prisma.site.findMany({
            where: { id: { in: siteIds } },
            select: { id: true, name: true, baseUrl: true },
          })
        : Promise.resolve([] as { id: string; name: string; baseUrl: string }[]),
      productIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, title: true, sourceUrl: true },
          })
        : Promise.resolve([] as { id: string; title: string; sourceUrl: string }[]),
    ]);

    const topUsers = sortedUsers.map((item) => {
      const info = users.find((user) => user.id === item.userId);
      return {
        userId: item.userId,
        username: info?.username || 'unknown',
        email: info?.email || '',
        spent: Math.abs(item._sum?.amount ?? 0),
      };
    });

    const topSites = sortedSites.map((item) => {
      const info = sites.find((site) => site.id === item.siteId);
      return {
        siteId: item.siteId,
        name: info?.name || 'unknown',
        baseUrl: info?.baseUrl || '',
        uploads: countValue(item._count),
      };
    });

    const topProducts = sortedProducts.map((item) => {
      const info = products.find((product) => product.id === item.productId);
      return {
        productId: item.productId,
        title: info?.title || 'Sản phẩm',
        sourceUrl: info?.sourceUrl || '',
        uploads: countValue(item._count),
      };
    });

    const topCategories = sortedCategories
      .filter((item) => item.category)
      .map((item) => ({ category: item.category as string, count: countValue(item._count) }));

    return {
      range,
      topUsers,
      topSites,
      topProducts,
      topCategories,
    };
  }

  private getRangeStart(range: StatsRange) {
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
    return start;
  }
}


