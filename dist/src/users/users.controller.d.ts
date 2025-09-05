import { UsersService } from './users.service';
export declare class UsersController {
    private readonly users;
    constructor(users: UsersService);
    getByUsername(username: string): import("@prisma/client").Prisma.Prisma__UserClient<{
        id: string;
        email: string;
        username: string;
        passwordHash: string;
        role: import("@prisma/client").$Enums.UserRole;
        balance: number;
        createdAt: Date;
        updatedAt: Date;
    } | null, null, import("@prisma/client/runtime/library").DefaultArgs, import("@prisma/client").Prisma.PrismaClientOptions>;
    create(body: {
        email: string;
        username: string;
        passwordHash: string;
    }): import("@prisma/client").Prisma.Prisma__UserClient<{
        id: string;
        email: string;
        username: string;
        role: import("@prisma/client").$Enums.UserRole;
        createdAt: Date;
    }, never, import("@prisma/client/runtime/library").DefaultArgs, import("@prisma/client").Prisma.PrismaClientOptions>;
}
