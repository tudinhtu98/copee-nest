import { SitesService } from './sites.service';
export declare class SitesController {
    private readonly sites;
    constructor(sites: SitesService);
    list(req: any): import("@prisma/client").Prisma.PrismaPromise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        userId: string;
        baseUrl: string;
        wooConsumerKey: string;
        wooConsumerSecret: string;
    }[]>;
    create(req: any, body: {
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
    remove(req: any, id: string): import("@prisma/client").Prisma.Prisma__SiteClient<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        userId: string;
        baseUrl: string;
        wooConsumerKey: string;
        wooConsumerSecret: string;
    }, never, import("@prisma/client/runtime/library").DefaultArgs, import("@prisma/client").Prisma.PrismaClientOptions>;
}
