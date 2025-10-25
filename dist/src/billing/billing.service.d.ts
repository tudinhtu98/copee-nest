import { PrismaService } from '../prisma/prisma.service';
export declare class BillingService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getBalance(userId: string): import("@prisma/client").Prisma.Prisma__UserClient<{
        balance: number;
    } | null, null, import("@prisma/client/runtime/library").DefaultArgs, import("@prisma/client").Prisma.PrismaClientOptions>;
    credit(userId: string, amount: number, reference?: string, description?: string): Promise<{
        user: {
            id: string;
            balance: number;
        };
        transaction: {
            id: string;
            createdAt: Date;
            amount: number;
            type: string;
            description: string | null;
            reference: string | null;
            userId: string;
        };
    }>;
    debit(userId: string, amount: number, reference?: string, description?: string): Promise<{
        user: {
            id: string;
            balance: number;
        };
        transaction: {
            id: string;
            createdAt: Date;
            amount: number;
            type: string;
            description: string | null;
            reference: string | null;
            userId: string;
        };
    }>;
    spending(userId: string, range: 'week' | 'month' | 'quarter' | 'year'): Promise<{
        amount: number;
    }>;
    getTransactions(userId: string, options?: {
        page?: number;
        limit?: number;
        type?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<{
        items: {
            id: string;
            createdAt: Date;
            amount: number;
            type: string;
            description: string | null;
            reference: string | null;
            userId: string;
        }[];
        pagination: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
        };
    }>;
}
