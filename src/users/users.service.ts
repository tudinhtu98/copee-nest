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

  createUser(params: {
    email: string;
    username: string;
    passwordHash: string;
    role?: UserRole;
  }) {
    const { email, username, passwordHash, role } = params;
    return this.prisma.user.create({
      data: { email, username, passwordHash, role: role ?? 'USER' },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        createdAt: true,
      },
    });
  }
}


