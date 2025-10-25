import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
type StatsRange = 'week' | 'month' | 'quarter' | 'year';
export declare class AdminService {
    private readonly prisma;
    private readonly billing;
    constructor(prisma: PrismaService, billing: BillingService);
    summary(): Promise<{
        users: number;
        spent: number;
    }>;
    creditUser(params: {
        actorId: string;
        userId: string;
        amount: number;
        reference?: string;
    }): Promise<{
        userId: string;
        amount: number;
        reference: string | null;
        balance: number;
    }>;
    stats(range: StatsRange): Promise<{
        range: StatsRange;
        topUsers: {
            userId: string;
            username: string;
            email: string;
            spent: number;
        }[];
        topSites: {
            siteId: string;
            name: string;
            baseUrl: string;
            uploads: number;
        }[];
        topProducts: {
            productId: string;
            title: string;
            sourceUrl: string;
            uploads: number;
        }[];
        topCategories: {
            category: string;
            count: number;
        }[];
    }>;
    private getRangeStart;
}
export {};
