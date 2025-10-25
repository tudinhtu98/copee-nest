import { BillingService } from './billing.service';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
export declare class BillingController {
    private readonly billing;
    constructor(billing: BillingService);
    balance(req: AuthenticatedRequest): import("@prisma/client").Prisma.Prisma__UserClient<{
        balance: number;
    } | null, null, import("@prisma/client/runtime/library").DefaultArgs, import("@prisma/client").Prisma.PrismaClientOptions>;
    credit(req: AuthenticatedRequest, body: {
        amount: number;
        reference?: string;
    }): Promise<{
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
    spending(req: AuthenticatedRequest, range?: 'week' | 'month' | 'quarter' | 'year'): Promise<{
        amount: number;
    }>;
    transactions(req: AuthenticatedRequest, page?: string, limit?: string, type?: string, startDate?: string, endDate?: string): Promise<{
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
