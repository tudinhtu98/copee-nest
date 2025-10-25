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
exports.BillingService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let BillingService = class BillingService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    getBalance(userId) {
        return this.prisma.user.findUnique({
            where: { id: userId },
            select: { balance: true },
        });
    }
    async credit(userId, amount, reference, description) {
        if (!amount || amount <= 0) {
            throw new common_1.BadRequestException('Số tiền phải lớn hơn 0');
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
    async debit(userId, amount, reference, description) {
        if (!amount || amount <= 0) {
            throw new common_1.BadRequestException('Số tiền phải lớn hơn 0');
        }
        return this.prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({
                where: { id: userId },
                select: { id: true, balance: true },
            });
            if (!user) {
                throw new common_1.NotFoundException('Không tìm thấy người dùng');
            }
            if (user.balance < amount) {
                throw new common_1.BadRequestException('Số dư không đủ');
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
    async spending(userId, range) {
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
    async getTransactions(userId, options) {
        const page = options?.page || 1;
        const limit = options?.limit || 20;
        const skip = (page - 1) * limit;
        const where = { userId };
        if (options?.type) {
            where.type = options.type.toUpperCase();
        }
        if (options?.startDate || options?.endDate) {
            where.createdAt = {};
            if (options.startDate) {
                where.createdAt.gte = options.startDate;
            }
            if (options.endDate) {
                where.createdAt.lte = options.endDate;
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
        ]);
        return {
            items,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
};
exports.BillingService = BillingService;
exports.BillingService = BillingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], BillingService);
//# sourceMappingURL=billing.service.js.map