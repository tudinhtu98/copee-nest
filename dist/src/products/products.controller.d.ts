import { ProductsService } from './products.service';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
export declare class ProductsController {
    private readonly products;
    constructor(products: ProductsService);
    list(req: AuthenticatedRequest, page?: string, limit?: string, search?: string, status?: string, sortBy?: string, sortOrder?: string): Promise<{
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
            images: import("@prisma/client/runtime/library").JsonValue | null;
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
    upload(req: AuthenticatedRequest, body: {
        productIds: string[];
        siteId: string;
        targetCategory?: string;
    }): Promise<{
        queued: number;
    }>;
    process(req: AuthenticatedRequest): Promise<{
        processed: number;
        success?: undefined;
    } | {
        processed: number;
        success: number;
    }>;
    copy(req: AuthenticatedRequest, body: {
        sourceUrl: string;
        title?: string;
        description?: string;
        images?: string[];
        price?: number;
        currency?: string;
        category?: string;
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
        images: import("@prisma/client/runtime/library").JsonValue | null;
        price: number | null;
        currency: string | null;
        errorMessage: string | null;
    }>;
    update(req: AuthenticatedRequest, id: string, body: {
        title?: string;
        description?: string;
        price?: number;
        category?: string;
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
        images: import("@prisma/client/runtime/library").JsonValue | null;
        price: number | null;
        currency: string | null;
        errorMessage: string | null;
    }>;
}
