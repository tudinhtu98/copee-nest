"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const billing_service_1 = require("../billing/billing.service");
let AdminService = class AdminService {
    prisma;
    billing;
    constructor(prisma, billing) {
        this.prisma = prisma;
        this.billing = billing;
    }
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
    async creditUser(params) {
        const { actorId, userId, amount, reference } = params;
        if (!amount || amount <= 0) {
            throw new common_1.BadRequestException('Số tiền phải lớn hơn 0');
        }
        const description = `Manual credit by ${actorId}`;
        const result = await this.billing.credit(userId, amount, reference, description);
        return {
            userId,
            amount,
            reference: result.transaction.reference,
            balance: result.user.balance,
        };
    }
    async stats(range) {
        const start = this.getRangeStart(range);
        const [topUsersRaw, topSitesRaw, topProductsRaw, topCategoriesRaw] = await this.prisma.$transaction([
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
        const countValue = (count) => {
            if (!count || typeof count === 'boolean')
                return 0;
            if (typeof count === 'object' && '_all' in count) {
                return count._all ?? 0;
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
                : Promise.resolve([]),
            siteIds.length
                ? this.prisma.site.findMany({
                    where: { id: { in: siteIds } },
                    select: { id: true, name: true, baseUrl: true },
                })
                : Promise.resolve([]),
            productIds.length
                ? this.prisma.product.findMany({
                    where: { id: { in: productIds } },
                    select: { id: true, title: true, sourceUrl: true },
                })
                : Promise.resolve([]),
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
            .map((item) => ({ category: item.category, count: countValue(item._count) }));
        return {
            range,
            topUsers,
            topSites,
            topProducts,
            topCategories,
        };
    }
    getRangeStart(range) {
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
};
exports.AdminService = AdminService;
exports.AdminService = AdminService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        billing_service_1.BillingService])
], AdminService);
//# sourceMappingURL=admin.service.js.map