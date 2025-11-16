import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
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
    input: { sourceName: string; wooCategoryId: string },
  ) {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, userId } });
    if (!site) {
      throw new NotFoundException('Site không tồn tại');
    }

    // Get WooCommerce category to auto-populate targetId and targetName
    const wooCategory = await this.prisma.wooCommerceCategory.findFirst({
      where: { id: input.wooCategoryId, siteId },
    });

    if (!wooCategory) {
      throw new NotFoundException('WooCommerce category không tồn tại');
    }

    try {
      return await this.prisma.categoryMapping.create({
        data: {
          siteId,
          sourceName: input.sourceName,
          wooCategoryId: input.wooCategoryId,
          // Auto-populate from WooCommerceCategory
          targetId: wooCategory.wooId,
          targetName: wooCategory.name,
        },
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

  async syncWooCommerceCategories(userId: string, siteId: string) {
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, userId },
    });
    if (!site) {
      throw new NotFoundException('Site không tồn tại');
    }

    if (!site.wooConsumerKey || !site.wooConsumerSecret || !site.baseUrl) {
      throw new BadRequestException('Site chưa cấu hình WooCommerce API');
    }

    try {
      // Fetch all categories from WooCommerce (handle pagination)
      const auth = Buffer.from(
        `${site.wooConsumerKey}:${site.wooConsumerSecret}`,
      ).toString('base64');

      let allCategories: any[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const endpoint = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wc/v3/products/categories?per_page=100&page=${page}`;

        const response = await fetch(endpoint, {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new BadRequestException(
            `Không thể fetch categories từ WooCommerce: ${errorText}`,
          );
        }

        const categories = await response.json();
        allCategories = allCategories.concat(categories);
        
        // Check if there are more pages
        hasMore = categories.length === 100;
        page++;
      }

      // Sync categories to database
      const syncedCategories: any[] = [];
      for (const category of allCategories) {
        // Handle parentId: can be object with id property or number
        let parentId: string | null = null;
        if (category.parent) {
          if (typeof category.parent === 'object' && category.parent.id) {
            parentId = String(category.parent.id);
          } else {
            parentId = String(category.parent);
          }
        }

        const synced = await this.prisma.wooCommerceCategory.upsert({
          where: {
            siteId_wooId: {
              siteId: site.id,
              wooId: String(category.id),
            },
          },
          update: {
            name: category.name,
            slug: category.slug || null,
            parentId: parentId,
            count: category.count || 0,
            syncedAt: new Date(),
          },
          create: {
            siteId: site.id,
            wooId: String(category.id),
            name: category.name,
            slug: category.slug || null,
            parentId: parentId,
            count: category.count || 0,
            syncedAt: new Date(),
          },
        });
        syncedCategories.push(synced);
      }

      return {
        message: `Đã sync ${syncedCategories.length} categories`,
        count: syncedCategories.length,
        categories: syncedCategories,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Lỗi khi sync categories: ${error.message}`,
      );
    }
  }

  async getWooCommerceCategories(siteId: string, userId: string) {
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, userId },
    });
    if (!site) {
      throw new NotFoundException('Site không tồn tại');
    }

    return this.prisma.wooCommerceCategory.findMany({
      where: { siteId },
      orderBy: { name: 'asc' },
    });
  }
}


