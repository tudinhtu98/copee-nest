import { AdminService } from './admin.service';
export declare class AdminController {
    private readonly admin;
    constructor(admin: AdminService);
    summary(): Promise<{
        users: number;
        spent: number;
    }>;
}
