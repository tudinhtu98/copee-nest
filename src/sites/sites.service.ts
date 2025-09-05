import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SitesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.site.findMany({ where: { userId } });
  }

  create(userId: string, input: { name: string; baseUrl: string; wooConsumerKey: string; wooConsumerSecret: string }) {
    return this.prisma.site.create({ data: { userId, ...input } });
  }

  remove(userId: string, id: string) {
    return this.prisma.site.delete({ where: { id } });
  }
}


