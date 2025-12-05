import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

type StatsRange = 'week' | 'month' | 'quarter' | 'year';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  async summary() {
    const [
      users,
      activeUsers,
      bannedUsers,
      products,
      readyProducts,
      uploadedProducts,
      sites,
      uploadJobs,
      pendingJobs,
      successJobs,
      failedJobs,
      transactions,
      totalSpent,
      totalCredit,
    ] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { bannedAt: null } }),
      this.prisma.user.count({ where: { bannedAt: { not: null } } }),
      this.prisma.product.count(),
      this.prisma.product.count({ where: { status: 'READY' } }),
      this.prisma.product.count({ where: { status: 'UPLOADED' } }),
      this.prisma.site.count(),
      this.prisma.uploadJob.count(),
      this.prisma.uploadJob.count({ where: { status: 'PENDING' } }),
      this.prisma.uploadJob.count({ where: { status: 'SUCCESS' } }),
      this.prisma.uploadJob.count({ where: { status: 'FAILED' } }),
      this.prisma.transaction.count(),
      this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { type: 'DEBIT' },
      }),
      this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { type: 'CREDIT' },
      }),
    ]);

    return {
      users: {
        total: users,
        active: activeUsers,
        banned: bannedUsers,
      },
      products: {
        total: products,
        ready: readyProducts,
        uploaded: uploadedProducts,
      },
      sites: {
        total: sites,
      },
      uploadJobs: {
        total: uploadJobs,
        pending: pendingJobs,
        success: successJobs,
        failed: failedJobs,
      },
      transactions: {
        total: transactions,
        spent: Math.abs(totalSpent._sum.amount ?? 0),
        credited: Math.abs(totalCredit._sum.amount ?? 0),
      },
    };
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

  async stats(range: StatsRange, type?: string, page?: number, limit?: number) {
    const start = this.getRangeStart(range);
    const currentPage = page ?? 1;
    const pageLimit = limit ?? 10;
    const skip = (currentPage - 1) * pageLimit;

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
      .sort((a, b) => (a._sum?.amount ?? 0) - (b._sum?.amount ?? 0));
    const sortedSites = [...topSitesRaw]
      .sort((a, b) => countValue(b._count) - countValue(a._count));
    const sortedProducts = [...topProductsRaw]
      .sort((a, b) => countValue(b._count) - countValue(a._count));
    const sortedCategories = [...topCategoriesRaw]
      .sort((a, b) => countValue(b._count) - countValue(a._count));

    // Get totals before pagination
    const totalUsers = sortedUsers.length;
    const totalSites = sortedSites.length;
    const totalProducts = sortedProducts.length;
    const totalCategories = sortedCategories.length;

    // Apply pagination before fetching details - only for selected type
    let paginatedUsersRaw = sortedUsers;
    let paginatedSitesRaw = sortedSites;
    let paginatedProductsRaw = sortedProducts;
    let paginatedCategoriesRaw = sortedCategories;

    if (type === 'users') {
      paginatedUsersRaw = sortedUsers.slice(skip, skip + pageLimit);
    } else if (type === 'sites') {
      paginatedSitesRaw = sortedSites.slice(skip, skip + pageLimit);
    } else if (type === 'products') {
      paginatedProductsRaw = sortedProducts.slice(skip, skip + pageLimit);
    } else if (type === 'categories') {
      paginatedCategoriesRaw = sortedCategories.slice(skip, skip + pageLimit);
    }

    const userIds = paginatedUsersRaw.map((item) => item.userId);
    const siteIds = paginatedSitesRaw.map((item) => item.siteId);
    const productIds = paginatedProductsRaw.map((item) => item.productId);

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

    const topUsers = paginatedUsersRaw.map((item) => {
      const info = users.find((user) => user.id === item.userId);
      return {
        userId: item.userId,
        username: info?.username || 'unknown',
        email: info?.email || '',
        spent: Math.abs(item._sum?.amount ?? 0),
      };
    });

    const topSites = paginatedSitesRaw.map((item) => {
      const info = sites.find((site) => site.id === item.siteId);
      return {
        siteId: item.siteId,
        name: info?.name || 'unknown',
        baseUrl: info?.baseUrl || '',
        uploads: countValue(item._count),
      };
    });

    const topProducts = paginatedProductsRaw.map((item) => {
      const info = products.find((product) => product.id === item.productId);
      return {
        productId: item.productId,
        title: info?.title || 'Sản phẩm',
        sourceUrl: info?.sourceUrl || '',
        uploads: countValue(item._count),
      };
    });

    const topCategories = paginatedCategoriesRaw
      .filter((item) => item.category)
      .map((item) => ({ category: item.category as string, count: countValue(item._count) }));

    const getTotal = () => {
      if (type === 'users') return totalUsers;
      if (type === 'sites') return totalSites;
      if (type === 'products') return totalProducts;
      return totalCategories;
    };

    const total = getTotal();

    return {
      range,
      topUsers,
      topSites,
      topProducts,
      topCategories,
      pagination: {
        page: currentPage,
        limit: pageLimit,
        total,
        totalPages: Math.ceil(total / pageLimit),
      },
    };
  }

  async listUsers(params: { page?: number; limit?: number; search?: string; actorRole?: UserRole }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const skip = (page - 1) * limit;

    let where: any = params.search
      ? {
          OR: [
            { email: { contains: params.search, mode: 'insensitive' as const } },
            { username: { contains: params.search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    // Mod chỉ có thể xem USER, Admin có thể xem tất cả
    if (params.actorRole === UserRole.MOD) {
      where = {
        ...where,
        role: UserRole.USER,
      };
    }

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          balance: true,
          bannedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async createUser(params: {
    email: string;
    username: string;
    password: string;
    role?: UserRole;
    actorRole?: UserRole;
  }) {
    const { email, username, password, role, actorRole } = params;

    // Mod chỉ có thể tạo USER, Admin có thể tạo tất cả
    if (actorRole === UserRole.MOD && role && role !== UserRole.USER) {
      throw new ForbiddenException('Mod chỉ có thể tạo user với role USER');
    }

    // Check if email or username already exists
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });

    if (existingUser) {
      throw new BadRequestException('Email hoặc username đã tồn tại');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        role: role ?? UserRole.USER,
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        balance: true,
        bannedAt: true,
        createdAt: true,
      },
    });

    return user;
  }

  async updateUser(
    userId: string,
    params: {
      email?: string;
      username?: string;
      password?: string;
      role?: UserRole;
      actorRole?: UserRole;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User không tồn tại');
    }

    // Mod chỉ có thể sửa USER, Admin có thể sửa tất cả
    if (params.actorRole === UserRole.MOD) {
      if (user.role !== UserRole.USER) {
        throw new ForbiddenException('Mod chỉ có thể sửa user với role USER');
      }
      // Mod không thể thay đổi role thành MOD hoặc ADMIN
      if (params.role && params.role !== UserRole.USER) {
        throw new ForbiddenException('Mod không thể thay đổi role thành MOD hoặc ADMIN');
      }
    }

    const updateData: any = {};

    if (params.email && params.email !== user.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: params.email },
      });
      if (existing) {
        throw new BadRequestException('Email đã tồn tại');
      }
      updateData.email = params.email;
    }

    if (params.username && params.username !== user.username) {
      const existing = await this.prisma.user.findUnique({
        where: { username: params.username },
      });
      if (existing) {
        throw new BadRequestException('Username đã tồn tại');
      }
      updateData.username = params.username;
    }

    if (params.password) {
      updateData.passwordHash = await bcrypt.hash(params.password, 10);
    }

    if (params.role !== undefined) {
      updateData.role = params.role;
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        balance: true,
        bannedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return updated;
  }

  async deleteUser(userId: string, actorRole?: UserRole) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User không tồn tại');
    }

    // Mod chỉ có thể xóa USER, Admin có thể xóa tất cả
    if (actorRole === UserRole.MOD && user.role !== UserRole.USER) {
      throw new ForbiddenException('Mod chỉ có thể xóa user với role USER');
    }

    await this.prisma.user.delete({ where: { id: userId } });
    return { success: true };
  }

  async banUser(userId: string, actorRole?: UserRole) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User không tồn tại');
    }

    // Mod chỉ có thể ban USER, Admin có thể ban tất cả
    if (actorRole === UserRole.MOD && user.role !== UserRole.USER) {
      throw new ForbiddenException('Mod chỉ có thể ban user với role USER');
    }

    if (user.bannedAt) {
      throw new BadRequestException('User đã bị ban');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { bannedAt: new Date() },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        balance: true,
        bannedAt: true,
        updatedAt: true,
      },
    });

    return updated;
  }

  async unbanUser(userId: string, actorRole?: UserRole) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User không tồn tại');
    }

    // Mod chỉ có thể unban USER, Admin có thể unban tất cả
    if (actorRole === UserRole.MOD && user.role !== UserRole.USER) {
      throw new ForbiddenException('Mod chỉ có thể unban user với role USER');
    }

    if (!user.bannedAt) {
      throw new BadRequestException('User chưa bị ban');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { bannedAt: null },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        balance: true,
        bannedAt: true,
        updatedAt: true,
      },
    });

    return updated;
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


