"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SitesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let SitesService = class SitesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    list(userId) {
        return this.prisma.site.findMany({ where: { userId } });
    }
    create(userId, input) {
        return this.prisma.site.create({ data: { userId, ...input } });
    }
    async remove(userId, id) {
        const result = await this.prisma.site.deleteMany({ where: { id, userId } });
        if (result.count === 0) {
            throw new common_1.NotFoundException('Site không tồn tại');
        }
        return { removed: result.count };
    }
    async getCategoryMappings(siteId, userId) {
        const site = await this.prisma.site.findFirst({ where: { id: siteId, userId } });
        if (!site) {
            throw new common_1.NotFoundException('Site không tồn tại');
        }
        return this.prisma.categoryMapping.findMany({ where: { siteId } });
    }
    async createCategoryMapping(userId, siteId, input) {
        const site = await this.prisma.site.findFirst({ where: { id: siteId, userId } });
        if (!site) {
            throw new common_1.NotFoundException('Site không tồn tại');
        }
        try {
            return await this.prisma.categoryMapping.create({
                data: { siteId, ...input },
            });
        }
        catch (e) {
            if (e.code === 'P2002') {
                throw new common_1.BadRequestException('Category mapping đã tồn tại');
            }
            throw e;
        }
    }
    async deleteCategoryMapping(userId, siteId, mappingId) {
        const site = await this.prisma.site.findFirst({ where: { id: siteId, userId } });
        if (!site) {
            throw new common_1.NotFoundException('Site không tồn tại');
        }
        const result = await this.prisma.categoryMapping.deleteMany({
            where: { id: mappingId, siteId },
        });
        if (result.count === 0) {
            throw new common_1.NotFoundException('Mapping không tồn tại');
        }
        return { removed: result.count };
    }
};
exports.SitesService = SitesService;
exports.SitesService = SitesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SitesService);
//# sourceMappingURL=sites.service.js.map