import { PrismaService } from '../prisma/prisma.service';
export declare class SitesService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    list(userId: string): import("@prisma/client").Prisma.PrismaPromise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        userId: string;
        baseUrl: string;
        wooConsumerKey: string;
        wooConsumerSecret: string;
    }[]>;
    create(userId: string, input: {
        name: string;
        baseUrl: string;
        wooConsumerKey: string;
        wooConsumerSecret: string;
    }): import("@prisma/client").Prisma.Prisma__SiteClient<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        userId: string;
        baseUrl: string;
        wooConsumerKey: string;
        wooConsumerSecret: string;
    }, never, import("@prisma/client/runtime/library").DefaultArgs, import("@prisma/client").Prisma.PrismaClientOptions>;
    remove(userId: string, id: string): Promise<{
        removed: number;
    }>;
    getCategoryMappings(siteId: string, userId: string): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        siteId: string;
        sourceName: string;
        targetId: string;
        targetName: string;
    }[]>;
    createCategoryMapping(userId: string, siteId: string, input: {
        sourceName: string;
        targetId: string;
        targetName: string;
    }): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        siteId: string;
        sourceName: string;
        targetId: string;
        targetName: string;
    }>;
    deleteCategoryMapping(userId: string, siteId: string, mappingId: string): Promise<{
        removed: number;
    }>;
}
