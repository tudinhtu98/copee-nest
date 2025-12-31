import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
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
    try {
      const { email, username, password } = params;

      // Validate input
      if (!email || !username || !password) {
        throw new BadRequestException('Email, username và password là bắt buộc');
      }

      if (password.length < 6) {
        throw new BadRequestException('Mật khẩu phải có ít nhất 6 ký tự');
      }

      // Check existing email
      const existed = await this.users.findByEmail(email);
      if (existed) throw new BadRequestException('Email đã tồn tại');

      // Check existing username
      const existedUsername = await this.users.findByUsername(username);
      if (existedUsername) throw new BadRequestException('Username đã tồn tại');

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create user
      const user = await this.users.createUser({ email, username, passwordHash });
      return user;
    } catch (error) {
      // Handle known exceptions
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }

      // Handle Prisma unique constraint violations
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          const field = (error.meta?.target as string[])?.[0] || 'trường';
          throw new BadRequestException(`${field} đã tồn tại`);
        }
      }

      // Log unexpected errors
      console.error('Register error:', error);
      throw new InternalServerErrorException(
        'Đã xảy ra lỗi khi đăng ký. Vui lòng thử lại.',
      );
    }
  }

  async login(params: { email: string; password: string }) {
    const { email, password } = params;
    const user = await this.users.findByEmail(email);
    if (!user) throw new UnauthorizedException('Sai thông tin');
    const ok = await bcrypt.compare(password, (user as any).passwordHash || '');
    if (!ok) throw new UnauthorizedException('Sai thông tin');
    
    const payload = {
      sub: (user as any).id,
      email: (user as any).email,
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
      email: user.email,
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
      // Xóa token cũ (sử dụng deleteMany để tránh lỗi nếu token đã bị xóa)
      this.prisma.refreshToken.deleteMany({
        where: { token: refreshToken },
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

  async updateProfile(
    userId: string,
    params: {
      currentPassword?: string;
      newPassword?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User không tồn tại');
    }

    const updateData: any = {};

    // Đổi mật khẩu
    if (params.newPassword) {
      if (!params.currentPassword) {
        throw new BadRequestException('Vui lòng nhập mật khẩu hiện tại');
      }

      // Kiểm tra mật khẩu hiện tại
      const isCurrentPasswordValid = await bcrypt.compare(
        params.currentPassword,
        (user as any).passwordHash || '',
      );
      if (!isCurrentPasswordValid) {
        throw new BadRequestException('Mật khẩu hiện tại không đúng');
      }

      // Hash mật khẩu mới
      updateData.passwordHash = await bcrypt.hash(params.newPassword, 10);
    }

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('Không có thông tin nào để cập nhật');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        createdAt: true,
      },
    });

    return updated;
  }
}
