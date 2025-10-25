import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SitesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.site.findMany({ where: { userId } });
  }

  create(
    userId: string,
    input: {
      name: string;
      baseUrl: string;
      wooConsumerKey: string;
      wooConsumerSecret: string;
    },
  ) {
    return this.prisma.site.create({ data: { userId, ...input } });
  }

  async remove(userId: string, id: string) {
    const result = await this.prisma.site.deleteMany({ where: { id, userId } });
    if (result.count === 0) {
      throw new NotFoundException('Site không tồn tại');
    }
    return { removed: result.count };
  }

  async getCategoryMappings(siteId: string, userId: string) {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, userId } });
    if (!site) {
      throw new NotFoundException('Site không tồn tại');
    }
    return this.prisma.categoryMapping.findMany({ where: { siteId } });
  }

  async createCategoryMapping(
    userId: string,
    siteId: string,
    input: { sourceName: string; targetId: string; targetName: string },
  ) {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, userId } });
    if (!site) {
      throw new NotFoundException('Site không tồn tại');
    }

    try {
      return await this.prisma.categoryMapping.create({
        data: { siteId, ...input },
      });
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new BadRequestException('Category mapping đã tồn tại');
      }
      throw e;
    }
  }

  async deleteCategoryMapping(userId: string, siteId: string, mappingId: string) {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, userId } });
    if (!site) {
      throw new NotFoundException('Site không tồn tại');
    }

    const result = await this.prisma.categoryMapping.deleteMany({
      where: { id: mappingId, siteId },
    });

    if (result.count === 0) {
      throw new NotFoundException('Mapping không tồn tại');
    }

    return { removed: result.count };
  }
}


