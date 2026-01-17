import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username } });
  }

  async createUser(params: {
    email: string;
    username: string;
    passwordHash: string;
    role?: UserRole;
  }) {
    const { email, username, passwordHash, role } = params;
    const user = await this.prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        role: role ?? 'USER',
        balance: 10000, // Initial balance for new users
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        createdAt: true,
      },
    });

    // Create transaction record for initial balance
    await this.prisma.transaction.create({
      data: {
        userId: user.id,
        amount: 10000,
        type: 'INITIAL_BALANCE',
        description: 'Số dư khởi tạo cho tài khoản mới',
      },
    });

    return user;
  }
}


