import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtOrApiKeyGuard } from './jwt-or-api-key.guard';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Module({
  imports: [
    UsersModule,
    PrismaModule,
    ApiKeysModule,
    PassportModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'dev-secret',
      signOptions: { expiresIn: '15m' }, // Access token: 15 phút
    }),
  ],
  providers: [AuthService, JwtStrategy, RolesGuard, JwtOrApiKeyGuard],
  controllers: [AuthController],
  exports: [JwtOrApiKeyGuard],
})
export class AuthModule {}
