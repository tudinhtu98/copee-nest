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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const billing_service_1 = require("./billing.service");
const roles_decorator_1 = require("../auth/roles.decorator");
const client_1 = require("@prisma/client");
let BillingController = class BillingController {
    billing;
    constructor(billing) {
        this.billing = billing;
    }
    balance(req) {
        return this.billing.getBalance(req.user.userId);
    }
    credit(req, body) {
        return this.billing.credit(req.user.userId, body.amount, body.reference);
    }
    spending(req, range = 'week') {
        const allowed = {
            week: 'week',
            month: 'month',
            quarter: 'quarter',
            year: 'year',
        };
        const period = allowed[range] ?? 'week';
        return this.billing.spending(req.user.userId, period);
    }
    transactions(req, page, limit, type, startDate, endDate) {
        return this.billing.getTransactions(req.user.userId, {
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 20,
            type: type || undefined,
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined,
        });
    }
};
exports.BillingController = BillingController;
__decorate([
    (0, common_1.Get)('balance'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "balance", null);
__decorate([
    (0, common_1.Post)('credit'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "credit", null);
__decorate([
    (0, common_1.Get)('spending'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('range')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "spending", null);
__decorate([
    (0, common_1.Get)('transactions'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('limit')),
    __param(3, (0, common_1.Query)('type')),
    __param(4, (0, common_1.Query)('startDate')),
    __param(5, (0, common_1.Query)('endDate')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "transactions", null);
exports.BillingController = BillingController = __decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, roles_decorator_1.Roles)(client_1.UserRole.USER),
    (0, common_1.Controller)('billing'),
    __metadata("design:paramtypes", [billing_service_1.BillingService])
], BillingController);
//# sourceMappingURL=billing.controller.js.map