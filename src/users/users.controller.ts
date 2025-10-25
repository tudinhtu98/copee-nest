import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';

@UseGuards(AuthGuard('jwt'))
@Roles(UserRole.ADMIN, UserRole.MOD)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':username')
  getByUsername(@Param('username') username: string) {
    return this.users.findByUsername(username);
  }

  @Post()
  create(
    @Body() body: { email: string; username: string; passwordHash: string },
  ) {
    return this.users.createUser(body);
  }
}


