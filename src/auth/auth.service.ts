import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
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
    }
    const token = await this.jwt.signAsync(payload);
    return { access_token: token };
  }
}
