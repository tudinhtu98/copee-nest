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
      wpUsername?: string;
      wpApplicationPassword?: string;
    },
  ) {
    return this.prisma.site.create({ data: { userId, ...input } });
  }

  async update(
    userId: string,
    id: string,
    input: {
      wpUsername?: string;
      wpApplicationPassword?: string;
    },
  ) {
    const site = await this.prisma.site.findFirst({ where: { id, userId } });
    if (!site) {
      throw new NotFoundException('Site không tồn tại');
    }
    const updateData: any = {};
    if (input.wpUsername !== undefined) {
      updateData.wpUsername = input.wpUsername || null;
    }
    if (input.wpApplicationPassword !== undefined) {
      updateData.wpApplicationPassword = input.wpApplicationPassword || null;
    }
    return this.prisma.site.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(userId: string, id: string) {
    const result = await this.prisma.site.deleteMany({ where: { id, userId } });
    if (result.count === 0) {
      throw new NotFoundException('Site không tồn tại');
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

  async createWooCommerceCategory(
    userId: string,
    siteId: string,
    body: { name: string; parentId?: string },
  ) {
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
      const auth = Buffer.from(
        `${site.wooConsumerKey}:${site.wooConsumerSecret}`,
      ).toString('base64');

      const endpoint = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wc/v3/products/categories`;

      const payload: any = {
        name: body.name,
      };

      if (body.parentId) {
        payload.parent = parseInt(body.parentId);
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new BadRequestException(
          `Không thể tạo category trong WooCommerce: ${errorText}`,
        );
      }

      const category = await response.json();

      // Save to database
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
          parentId: category.parent ? String(category.parent) : null,
          count: category.count || 0,
          syncedAt: new Date(),
        },
        create: {
          siteId: site.id,
          wooId: String(category.id),
          name: category.name,
          slug: category.slug || null,
          parentId: category.parent ? String(category.parent) : null,
          count: category.count || 0,
          syncedAt: new Date(),
        },
      });

      return synced;
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Lỗi khi tạo category: ${error.message}`,
      );
    }
  }
}


