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

  async create(
    userId: string,
    input: {
      name: string;
      baseUrl: string;
      wooConsumerKey: string;
      wooConsumerSecret: string;
      wpUsername?: string;
      wpApplicationPassword?: string;
      shopeeAffiliateId?: string;
    },
  ) {
    const { baseUrl, wooConsumerKey, wooConsumerSecret, wpUsername, wpApplicationPassword } = input;

    // 1. Normalize baseUrl (remove trailing slash, convert to lowercase)
    const normalizedUrl = baseUrl.trim().replace(/\/$/, '').toLowerCase();

    // 2. Check if normalized baseUrl already exists for ANY user
    const existingSite = await this.prisma.site.findFirst({
      where: {
        baseUrl: {
          equals: normalizedUrl,
          mode: 'insensitive', // Case-insensitive match
        },
      },
      include: { user: { select: { email: true, username: true } } },
    });

    if (existingSite) {
      throw new BadRequestException(
        `URL này đã được đăng ký bởi user khác (${existingSite.user.username}). Mỗi WordPress site chỉ có thể liên kết với 1 tài khoản.`,
      );
    }

    // 2. Test WooCommerce API connection
    try {
      const auth = Buffer.from(
        `${wooConsumerKey}:${wooConsumerSecret}`,
      ).toString('base64');
      const endpoint = `${baseUrl.replace(/\/$/, '')}/wp-json/wc/v3/system_status`;

      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new BadRequestException(
          `WooCommerce API lỗi (${response.status}): ${errorText.substring(0, 100)}`,
        );
      }
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Lỗi kết nối WooCommerce: ${error.message}`,
      );
    }

    // 3. Test WordPress Application Password (if provided)
    if (wpUsername && wpApplicationPassword) {
      try {
        const auth = Buffer.from(
          `${wpUsername}:${wpApplicationPassword}`,
        ).toString('base64');
        const endpoint = `${baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/users/me`;

        const response = await fetch(endpoint, {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new BadRequestException(
            `WordPress API lỗi (${response.status}): ${errorText.substring(0, 100)}`,
          );
        }
      } catch (error: any) {
        if (error instanceof BadRequestException) {
          throw error;
        }
        throw new BadRequestException(
          `Lỗi kết nối WordPress: ${error.message}`,
        );
      }
    }

    // 4. All validation passed, create site with normalized URL
    return this.prisma.site.create({
      data: {
        userId,
        ...input,
        baseUrl: normalizedUrl, // Save normalized URL
      },
    });
  }

  async update(
    userId: string,
    id: string,
    input: {
      wpUsername?: string;
      wpApplicationPassword?: string;
      shopeeAffiliateId?: string;
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
    if (input.shopeeAffiliateId !== undefined) {
      updateData.shopeeAffiliateId = input.shopeeAffiliateId || null;
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

  async testConnection(userId: string, siteId: string) {
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, userId },
    }) as any;
    if (!site) {
      throw new NotFoundException('Site không tồn tại');
    }

    if (!site.baseUrl) {
      throw new BadRequestException('Site chưa cấu hình base URL');
    }

    const results: {
      wooCommerce?: { success: boolean; message: string };
      wordPress?: { success: boolean; message: string };
    } = {};

    // Test WooCommerce API connection
    if (site.wooConsumerKey && site.wooConsumerSecret) {
      try {
        const auth = Buffer.from(
          `${site.wooConsumerKey}:${site.wooConsumerSecret}`,
        ).toString('base64');
        const endpoint = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wc/v3/system_status`;
        
        const response = await fetch(endpoint, {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          results.wooCommerce = {
            success: true,
            message: 'Kết nối WooCommerce API thành công',
          };
        } else {
          const errorText = await response.text();
          results.wooCommerce = {
            success: false,
            message: `WooCommerce API lỗi (${response.status}): ${errorText.substring(0, 100)}`,
          };
        }
      } catch (error: any) {
        results.wooCommerce = {
          success: false,
          message: `Lỗi kết nối WooCommerce: ${error.message}`,
        };
      }
    } else {
      results.wooCommerce = {
        success: false,
        message: 'Chưa cấu hình WooCommerce API keys',
      };
    }

    // Test WordPress Application Password connection
    if (site.wpUsername && site.wpApplicationPassword) {
      try {
        const auth = Buffer.from(
          `${site.wpUsername}:${site.wpApplicationPassword}`,
        ).toString('base64');
        const endpoint = `${site.baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/users/me`;
        
        const response = await fetch(endpoint, {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          results.wordPress = {
            success: true,
            message: 'Kết nối WordPress Application Password thành công',
          };
        } else {
          const errorText = await response.text();
          results.wordPress = {
            success: false,
            message: `WordPress API lỗi (${response.status}): ${errorText.substring(0, 100)}`,
          };
        }
      } catch (error: any) {
        results.wordPress = {
          success: false,
          message: `Lỗi kết nối WordPress: ${error.message}`,
        };
      }
    } else {
      results.wordPress = {
        success: false,
        message: 'Chưa cấu hình WordPress Application Password',
      };
    }

    return results;
  }
}


