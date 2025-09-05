import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':username')
  getByUsername(@Param('username') username: string) {
    return this.users.findByUsername(username);
  }

  @Post()
  create(@Body() body: { email: string; username: string; passwordHash: string }) {
    return this.users.createUser(body);
  }
}


