import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(params: {
    email: string;
    username: string;
    password: string;
  }) {
    const { email, username, password } = params;
    const existed = await this.users.findByEmail(email);
    if (existed) throw new BadRequestException('Email đã tồn tại');
    const existedUsername = await this.users.findByUsername(username);
    if (existedUsername) throw new BadRequestException('Username đã tồn tại');
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.users.createUser({ email, username, passwordHash });
    return user;
  }

  async login(params: { email: string; password: string }) {
    const { email, password } = params;
    const user = await this.users.findByEmail(email);
    if (!user) throw new UnauthorizedException('Sai thông tin');
    const ok = await bcrypt.compare(password, (user as any).passwordHash || '');
    if (!ok) throw new UnauthorizedException('Sai thông tin');
    
    const payload = {
      sub: (user as any).id,
      role: (user as any).role,
      username: (user as any).username,
    };
    
    // Tạo access token (15 phút)
    const accessToken = await this.jwt.signAsync(payload);
    
    // Tạo refresh token (30 ngày)
    const refreshToken = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 ngày
    
    // Lưu refresh token vào database
    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: (user as any).id,
        expiresAt,
      },
    });
    
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  async refresh(refreshToken: string) {
    // Tìm refresh token trong database
    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException('Refresh token không hợp lệ');
    }

    // Kiểm tra token đã hết hạn chưa
    if (tokenRecord.expiresAt < new Date()) {
      // Xóa token hết hạn
      await this.prisma.refreshToken.delete({
        where: { id: tokenRecord.id },
      });
      throw new UnauthorizedException('Refresh token đã hết hạn');
    }

    const user = tokenRecord.user as any;
    const payload = {
      sub: user.id,
      role: user.role,
      username: user.username,
    };

    // Tạo access token mới (15 phút)
    const accessToken = await this.jwt.signAsync(payload);

    // Token rotation: Tạo refresh token mới và xóa token cũ
    const newRefreshToken = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 ngày

    await this.prisma.$transaction([
      // Xóa token cũ
      this.prisma.refreshToken.delete({
        where: { id: tokenRecord.id },
      }),
      // Tạo token mới
      this.prisma.refreshToken.create({
        data: {
          token: newRefreshToken,
          userId: user.id,
          expiresAt,
        },
      }),
    ]);

    return {
      access_token: accessToken,
      refresh_token: newRefreshToken,
    };
  }

  async logout(refreshToken: string) {
    // Xóa refresh token khi logout
    await this.prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });
    return { message: 'Đăng xuất thành công' };
  }
}
