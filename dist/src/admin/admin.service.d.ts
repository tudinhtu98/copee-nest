import { PrismaService } from '../prisma/prisma.service';
export declare class AdminService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    summary(): Promise<{
        users: number;
        spent: number;
    }>;
}
