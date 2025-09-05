"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcrypt"));
const prisma = new client_1.PrismaClient();
async function main() {
    const passUser = await bcrypt.hash('password123', 10);
    const passAdmin = await bcrypt.hash('password123', 10);
    const user = await prisma.user.upsert({
        where: { email: 'user@copee.local' },
        update: {},
        create: { email: 'user@copee.local', username: 'user', passwordHash: passUser, role: 'USER' }
    });
    const admin = await prisma.user.upsert({
        where: { email: 'admin@copee.local' },
        update: {},
        create: { email: 'admin@copee.local', username: 'admin', passwordHash: passAdmin, role: 'ADMIN' }
    });
    const products = await prisma.product.createMany({
        data: Array.from({ length: 5 }).map((_, i) => ({
            userId: user.id,
            sourceShop: 'shopee',
            sourceUrl: 'https://shopee.vn/item/' + (1000 + i),
            title: 'Sản phẩm demo ' + (i + 1),
            status: 'DRAFT'
        }))
    });
    console.log('Seed done', { user: { email: user.email, role: user.role }, admin: { email: admin.email, role: admin.role }, products });
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
//# sourceMappingURL=seed.js.map