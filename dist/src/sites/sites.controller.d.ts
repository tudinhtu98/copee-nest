import { SitesService } from './sites.service';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
export declare class SitesController {
    private readonly sites;
    constructor(sites: SitesService);
    list(req: AuthenticatedRequest): import("@prisma/client").Prisma.PrismaPromise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        userId: string;
        baseUrl: string;
        wooConsumerKey: string;
        wooConsumerSecret: string;
    }[]>;
    create(req: AuthenticatedRequest, body: {
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
    remove(req: AuthenticatedRequest, id: string): Promise<{
        removed: number;
    }>;
    getCategoryMappings(req: AuthenticatedRequest, siteId: string): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        siteId: string;
        sourceName: string;
        targetId: string;
        targetName: string;
    }[]>;
    createCategoryMapping(req: AuthenticatedRequest, siteId: string, body: {
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
    deleteCategoryMapping(req: AuthenticatedRequest, siteId: string, mappingId: string): Promise<{
        removed: number;
    }>;
}
