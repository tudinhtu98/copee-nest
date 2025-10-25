import { AdminService } from './admin.service';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
export declare class AdminController {
    private readonly admin;
    constructor(admin: AdminService);
    summary(req: AuthenticatedRequest): Promise<{
        users: number;
        spent: number;
    }>;
    creditUser(id: string, body: {
        amount: number;
        reference?: string;
    }, req: AuthenticatedRequest): Promise<{
        userId: string;
        amount: number;
        reference: string | null;
        balance: number;
    }>;
    stats(range?: 'week' | 'month' | 'quarter' | 'year'): Promise<{
        range: "week" | "month" | "quarter" | "year";
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
}
