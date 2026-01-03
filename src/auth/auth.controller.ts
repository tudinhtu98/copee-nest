import { Body, Controller, Post, Patch, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedRequest } from './authenticated-request';
import { GoogleAuthDto } from './google-auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(
    @Body() body: { email: string; username: string; password: string },
  ) {
    return this.auth.register(body);
  }

  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.auth.login({ email: body.email, password: body.password });
  }

  @Post('refresh')
  refresh(@Body() body: { refresh_token: string }) {
    return this.auth.refresh(body.refresh_token);
  }

  @Post('logout')
  logout(@Body() body: { refresh_token: string }) {
    return this.auth.logout(body.refresh_token);
  }

  @Post('google-oauth')
  googleAuth(@Body() body: GoogleAuthDto) {
    return this.auth.googleAuth({
      email: body.email,
      name: body.name,
      googleId: body.googleId,
      image: body.image,
    });
  }

  @Patch('profile')
  @UseGuards(AuthGuard('jwt'))
  updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      currentPassword?: string;
      newPassword?: string;
    },
  ) {
    return this.auth.updateProfile(req.user.userId, body);
  }

  @Post('set-password')
  @UseGuards(AuthGuard('jwt'))
  setInitialPassword(
    @Req() req: AuthenticatedRequest,
    @Body() body: { password: string },
  ) {
    return this.auth.setInitialPassword(req.user.userId, body.password);
  }
}
