import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
export declare class ProductsService {
    private readonly prisma;
    private readonly billing;
    constructor(prisma: PrismaService, billing: BillingService);
    list(userId: string): import("@prisma/client").Prisma.PrismaPromise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        description: string | null;
        sourceShop: string;
        sourceUrl: string;
        title: string;
        images: import("@prisma/client/runtime/library").JsonValue | null;
        price: number | null;
        currency: string | null;
        category: string | null;
        status: import("@prisma/client").$Enums.ProductStatus;
        errorMessage: string | null;
    }[]>;
    createUploadJob(userId: string, body: {
        productIds: string[];
        siteId: string;
        targetCategory?: string;
    }): import("@prisma/client").Prisma.PrismaPromise<import("@prisma/client").Prisma.BatchPayload>;
    processPendingUploads(userId: string): Promise<{
        processed: number;
        success?: undefined;
    } | {
        processed: number;
        success: number;
    }>;
    private uploadToWoo;
}
