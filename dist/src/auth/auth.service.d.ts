import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
export declare class AuthService {
    private readonly users;
    private readonly jwt;
    constructor(users: UsersService, jwt: JwtService);
    register(params: {
        email: string;
        username: string;
        password: string;
    }): Promise<{
        id: string;
        email: string;
        username: string;
        role: import("@prisma/client").$Enums.UserRole;
        createdAt: Date;
    }>;
    login(params: {
        email: string;
        password: string;
    }): Promise<{
        access_token: string;
    }>;
}
