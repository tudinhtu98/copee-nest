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

    // Use raw query with unaccent for Vietnamese search without diacritics
    if (params.search) {
      const searchTerm = `%${params.search}%`;
      const paramsList: any[] = [searchTerm];
      let paramIndex = 2;
      
      let roleCondition = '';
      if (params.actorRole === UserRole.MOD) {
        roleCondition = `AND u.role = $${paramIndex}`;
        paramsList.push(UserRole.USER);
        paramIndex++;
      }
      
      paramsList.push(limit, skip);

      const [usersRaw, totalRaw] = await Promise.all([
        this.prisma.$queryRawUnsafe<Array<{
          id: string;
          email: string;
          username: string | null;
          role: string;
          balance: number;
          banned_at: Date | null;
          created_at: Date;
          updated_at: Date | null;
        }>>(
          `SELECT u.*
           FROM users u
           WHERE (unaccent(u.email) ILIKE unaccent($1) OR unaccent(u.username) ILIKE unaccent($1))
           ${roleCondition}
           ORDER BY u.created_at DESC
           LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
          ...paramsList,
        ),
        this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*)::int as count
           FROM users u
           WHERE (unaccent(u.email) ILIKE unaccent($1) OR unaccent(u.username) ILIKE unaccent($1))
           ${roleCondition}`,
          searchTerm,
          ...(params.actorRole === UserRole.MOD ? [UserRole.USER] : []),
        ),
      ]);

      const users = usersRaw.map((user) => ({
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role as UserRole,
        balance: user.balance,
        bannedAt: user.banned_at?.toISOString() || null,
        createdAt: user.created_at.toISOString(),
        updatedAt: user.updated_at?.toISOString(),
      }));

      const total = Number(totalRaw[0]?.count || 0);

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

    // Normal query when no search
    let where: any = {};
    if (params.actorRole === UserRole.MOD) {
      where.role = UserRole.USER;
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

  async listSites(params: { page?: number; limit?: number; search?: string; userId?: string }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (params.search) {
      // Use unaccent for Vietnamese search without diacritics
      // PostgreSQL unaccent extension handles this automatically when enabled
      where.OR = [
        {
          name: {
            contains: params.search,
            mode: 'insensitive' as const,
          },
        },
        {
          baseUrl: {
            contains: params.search,
            mode: 'insensitive' as const,
          },
        },
      ];
    }

    if (params.userId) {
      where.userId = params.userId;
    }

    // If search is provided, use raw query with unaccent for better Vietnamese support
    if (params.search) {
      const searchTerm = `%${params.search}%`;
      const userIdCondition = params.userId ? `AND s.user_id = $${params.userId ? '3' : '2'}` : '';
      const userIdParam = params.userId ? [params.userId] : [];

      const [sitesRaw, totalRaw] = await Promise.all([
        this.prisma.$queryRawUnsafe<Array<{
          id: string;
          name: string;
          base_url: string;
          user_id: string;
          created_at: Date;
          user_email: string | null;
          user_username: string | null;
        }>>(
          `SELECT s.*, u.email as user_email, u.username as user_username
           FROM sites s
           LEFT JOIN users u ON s.user_id = u.id
           WHERE (unaccent(s.name) ILIKE unaccent($1) OR unaccent(s.base_url) ILIKE unaccent($1))
           ${userIdCondition}
           ORDER BY s.created_at DESC
           LIMIT $${params.userId ? '4' : '2'} OFFSET $${params.userId ? '5' : '3'}`,
          searchTerm,
          limit,
          skip,
          ...userIdParam,
        ),
        this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*)::int as count
           FROM sites s
           WHERE (unaccent(s.name) ILIKE unaccent($1) OR unaccent(s.base_url) ILIKE unaccent($1))
           ${userIdCondition}`,
          searchTerm,
          ...userIdParam,
        ),
      ]);

      const sites = sitesRaw.map((site) => ({
        id: site.id,
        name: site.name,
        baseUrl: site.base_url,
        userId: site.user_id,
        createdAt: site.created_at,
        user: site.user_email
          ? {
              email: site.user_email,
              username: site.user_username,
            }
          : undefined,
      }));

      const total = Number(totalRaw[0]?.count || 0);

      return {
        sites,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }

    // Fallback to normal Prisma query when no search
    const [sites, total] = await this.prisma.$transaction([
      this.prisma.site.findMany({
        where,
        include: {
          user: {
            select: {
              email: true,
              username: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.site.count({ where }),
    ]);

    return {
      sites,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async listCategories(params: { page?: number; limit?: number; search?: string }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {
      category: { not: null },
    };

    // Use raw query with unaccent for Vietnamese search without diacritics
    if (params.search) {
      const searchTerm = `%${params.search}%`;
      const categoriesRaw = await this.prisma.$queryRawUnsafe<Array<{
        category: string;
        count: bigint;
      }>>(
        `SELECT category, COUNT(*)::int as count
         FROM products
         WHERE category IS NOT NULL AND unaccent(category) ILIKE unaccent($1)
         GROUP BY category
         ORDER BY category ASC
         LIMIT $2 OFFSET $3`,
        searchTerm,
        limit,
        skip,
      );

      const totalRaw = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(DISTINCT category)::int as count
         FROM products
         WHERE category IS NOT NULL AND unaccent(category) ILIKE unaccent($1)`,
        searchTerm,
      );

      const total = Number(totalRaw[0]?.count || 0);
      const categories = categoriesRaw.map((item) => ({
        category: item.category,
        count: Number(item.count),
      }));

      return {
        categories,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }

    // Normal query when no search
    // Get unique categories with count
    const categoriesRaw = await this.prisma.product.groupBy({
      by: ['category'],
      where,
      _count: { _all: true },
      orderBy: { category: 'asc' },
    });

    const total = categoriesRaw.length;
    const paginated = categoriesRaw.slice(skip, skip + limit);

    const categories = paginated
      .filter((item) => item.category)
      .map((item) => ({
        category: item.category as string,
        count: item._count._all,
      }));

    return {
      categories,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async listProducts(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    category?: string;
    userId?: string;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    // Use raw query with unaccent for Vietnamese search without diacritics
    if (params.search) {
      const searchTerm = `%${params.search}%`;
      const paramsList: any[] = [searchTerm];
      let paramIndex = 2;
      
      let additionalConditions = '';
      if (params.status) {
        additionalConditions += `AND p.status = $${paramIndex}`;
        paramsList.push(params.status);
        paramIndex++;
      }
      if (params.category) {
        additionalConditions += `AND p.category = $${paramIndex}`;
        paramsList.push(params.category);
        paramIndex++;
      }
      if (params.userId) {
        additionalConditions += `AND p.user_id = $${paramIndex}`;
        paramsList.push(params.userId);
        paramIndex++;
      }
      
      paramsList.push(limit, skip);

      const [productsRaw, totalRaw] = await Promise.all([
        this.prisma.$queryRawUnsafe<Array<{
          id: string;
          title: string | null;
          source_url: string;
          status: string;
          category: string | null;
          price: number | null;
          original_price: number | null;
          created_at: Date;
          user_id: string;
          user_email: string | null;
          user_username: string | null;
        }>>(
          `SELECT p.*, u.email as user_email, u.username as user_username
           FROM products p
           LEFT JOIN users u ON p.user_id = u.id
           WHERE (unaccent(p.title) ILIKE unaccent($1) 
                  OR unaccent(p.description) ILIKE unaccent($1)
                  OR unaccent(p.category) ILIKE unaccent($1)
                  OR unaccent(p.source_url) ILIKE unaccent($1))
           ${additionalConditions}
           ORDER BY p.created_at DESC
           LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
          ...paramsList,
        ),
        this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*)::int as count
           FROM products p
           WHERE (unaccent(p.title) ILIKE unaccent($1) 
                  OR unaccent(p.description) ILIKE unaccent($1)
                  OR unaccent(p.category) ILIKE unaccent($1)
                  OR unaccent(p.source_url) ILIKE unaccent($1))
           ${additionalConditions}`,
          searchTerm,
          ...(params.status ? [params.status] : []),
          ...(params.category ? [params.category] : []),
          ...(params.userId ? [params.userId] : []),
        ),
      ]);

      const products = productsRaw.map((product) => ({
        id: product.id,
        title: product.title,
        sourceUrl: product.source_url,
        status: product.status as any,
        category: product.category,
        price: product.price,
        originalPrice: product.original_price,
        createdAt: product.created_at.toISOString(),
        user: product.user_email
          ? {
              email: product.user_email,
              username: product.user_username,
            }
          : undefined,
      }));

      const total = Number(totalRaw[0]?.count || 0);

      return {
        products,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }

    // Normal query when no search
    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: 'insensitive' as const } },
        { description: { contains: params.search, mode: 'insensitive' as const } },
        { category: { contains: params.search, mode: 'insensitive' as const } },
        { sourceUrl: { contains: params.search, mode: 'insensitive' as const } },
      ];
    }

    if (params.status) {
      where.status = params.status;
    }

    if (params.category) {
      where.category = params.category;
    }

    if (params.userId) {
      where.userId = params.userId;
    }

    const [products, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: {
          user: {
            select: {
              email: true,
              username: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}


