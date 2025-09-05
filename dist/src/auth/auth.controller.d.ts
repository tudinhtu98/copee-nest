import { AuthService } from './auth.service';
export declare class AuthController {
    private readonly auth;
    constructor(auth: AuthService);
    register(body: {
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
    login(body: {
        email: string;
        password: string;
    }): Promise<{
        access_token: string;
    }>;
}
