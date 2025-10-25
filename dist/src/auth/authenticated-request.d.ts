import { Request } from 'express';
import { UserRole } from '@prisma/client';
export interface AuthenticatedRequest extends Request {
    user: {
        userId: string;
        role: UserRole;
        username?: string;
    };
}
