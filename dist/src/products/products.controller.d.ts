import { ProductsService } from './products.service';
export declare class ProductsController {
    private readonly products;
    constructor(products: ProductsService);
    list(req: any): import("@prisma/client").Prisma.PrismaPromise<{
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
    upload(req: any, body: {
        productIds: string[];
        siteId: string;
        targetCategory?: string;
    }): import("@prisma/client").Prisma.PrismaPromise<import("@prisma/client").Prisma.BatchPayload>;
    process(req: any): Promise<{
        processed: number;
        success?: undefined;
    } | {
        processed: number;
        success: number;
    }>;
}
