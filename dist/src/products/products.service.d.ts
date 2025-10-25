import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
export declare class ProductsService {
    private readonly prisma;
    private readonly billing;
    constructor(prisma: PrismaService, billing: BillingService);
    list(userId: string, options?: {
        page?: number;
        limit?: number;
        search?: string;
        status?: string;
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
    }): Promise<{
        items: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            description: string | null;
            userId: string;
            sourceUrl: string;
            category: string | null;
            title: string;
            status: import("@prisma/client").$Enums.ProductStatus;
            sourceShop: string;
            images: Prisma.JsonValue | null;
            price: number | null;
            currency: string | null;
            errorMessage: string | null;
        }[];
        pagination: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
        };
    }>;
    createUploadJob(userId: string, body: {
        productIds: string[];
        siteId: string;
        targetCategory?: string;
    }): Promise<{
        queued: number;
    }>;
    processPendingUploads(userId: string): Promise<{
        processed: number;
        success?: undefined;
    } | {
        processed: number;
        success: number;
    }>;
    updateProduct(userId: string, productId: string, data: {
        title?: string | null;
        description?: string | null;
        price?: number | null;
        category?: string | null;
    }): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        description: string | null;
        userId: string;
        sourceUrl: string;
        category: string | null;
        title: string;
        status: import("@prisma/client").$Enums.ProductStatus;
        sourceShop: string;
        images: Prisma.JsonValue | null;
        price: number | null;
        currency: string | null;
        errorMessage: string | null;
    }>;
    copyProduct(userId: string, input: {
        sourceUrl: string;
        title?: string;
        description?: string | null;
        images?: string[] | null;
        price?: number | null;
        currency?: string | null;
        category?: string | null;
    }): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        description: string | null;
        userId: string;
        sourceUrl: string;
        category: string | null;
        title: string;
        status: import("@prisma/client").$Enums.ProductStatus;
        sourceShop: string;
        images: Prisma.JsonValue | null;
        price: number | null;
        currency: string | null;
        errorMessage: string | null;
    }>;
    private uploadImageToMediaLibrary;
    private uploadToWoo;
}
