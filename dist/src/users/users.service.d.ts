import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';
export declare class UsersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findByEmail(email: string): import("@prisma/client").Prisma.Prisma__UserClient<{
        id: string;
        email: string;
        username: string;
        passwordHash: string;
        role: import("@prisma/client").$Enums.UserRole;
        balance: number;
        createdAt: Date;
        updatedAt: Date;
    } | null, null, import("@prisma/client/runtime/library").DefaultArgs, import("@prisma/client").Prisma.PrismaClientOptions>;
    findByUsername(username: string): import("@prisma/client").Prisma.Prisma__UserClient<{
        id: string;
        email: string;
        username: string;
        passwordHash: string;
        role: import("@prisma/client").$Enums.UserRole;
        balance: number;
        createdAt: Date;
        updatedAt: Date;
    } | null, null, import("@prisma/client/runtime/library").DefaultArgs, import("@prisma/client").Prisma.PrismaClientOptions>;
    createUser(params: {
        email: string;
        username: string;
        passwordHash: string;
        role?: UserRole;
    }): import("@prisma/client").Prisma.Prisma__UserClient<{
        id: string;
        email: string;
        username: string;
        role: import("@prisma/client").$Enums.UserRole;
        createdAt: Date;
    }, never, import("@prisma/client/runtime/library").DefaultArgs, import("@prisma/client").Prisma.PrismaClientOptions>;
}
