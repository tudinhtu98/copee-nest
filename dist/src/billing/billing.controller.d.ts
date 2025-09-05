import { BillingService } from './billing.service';
export declare class BillingController {
    private readonly billing;
    constructor(billing: BillingService);
    balance(req: any): import("@prisma/client").Prisma.Prisma__UserClient<{
        balance: number;
    } | null, null, import("@prisma/client/runtime/library").DefaultArgs, import("@prisma/client").Prisma.PrismaClientOptions>;
    credit(req: any, body: {
        amount: number;
        reference?: string;
    }): Promise<[{
        id: string;
        email: string;
        username: string;
        passwordHash: string;
        role: import("@prisma/client").$Enums.UserRole;
        balance: number;
        createdAt: Date;
        updatedAt: Date;
    }, {
        id: string;
        createdAt: Date;
        userId: string;
        amount: number;
        type: string;
        description: string | null;
        reference: string | null;
    }]>;
}
