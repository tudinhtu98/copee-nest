import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillingService } from './billing.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Bảng `users` giả lập đúng chỗ quan trọng nhất của Postgres: câu UPDATE kèm điều kiện
 * kiểm tra số dư và trừ tiền trong **một** bước không thể bị xen ngang, còn đọc rồi mới
 * ghi thì có. Mỗi lời gọi đợi một nhịp trước khi chạy để hai việc song song thật sự đan vào nhau.
 */
function fakePrisma(initialBalance: number) {
  const state = { balance: initialBalance, exists: true };
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  const tx = {
    user: {
      async findUnique({ where }: any) {
        await tick();
        if (!state.exists || where.id !== 'u1') return null;
        return { id: 'u1', balance: state.balance };
      },
      async findUniqueOrThrow({ where }: any) {
        const found = await tx.user.findUnique({ where });
        if (!found) throw new Error('not found');
        return found;
      },
      async update({ data }: any) {
        await tick();
        state.balance -= data.balance.decrement ?? 0;
        state.balance += data.balance.increment ?? 0;
        return { id: 'u1', balance: state.balance };
      },
      async updateMany({ where, data }: any) {
        await tick();
        // Từ đây tới hết hàm là một bước duy nhất, giống UPDATE ... WHERE của Postgres.
        if (!state.exists || where.id !== 'u1') return { count: 0 };
        if (where.balance && state.balance < where.balance.gte)
          return { count: 0 };
        state.balance -= data.balance.decrement ?? 0;
        return { count: 1 };
      },
    },
    transaction: {
      async create({ data }: any) {
        await tick();
        return { id: `t${Math.random()}`, ...data };
      },
    },
  };

  const prisma = {
    $transaction: (fn: any) => fn(tx),
  } as unknown as PrismaService;

  return { prisma, state };
}

describe('BillingService.debit', () => {
  it('hai lần trừ điểm chạy song song không tiêu quá số dư đang có', async () => {
    const { prisma, state } = fakePrisma(1000);
    const billing = new BillingService(prisma);

    const results = await Promise.allSettled([
      billing.debit('u1', 700, 'A'),
      billing.debit('u1', 700, 'B'),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    expect(state.balance).toBe(300);

    const failed = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(BadRequestException);
    expect((failed.reason as Error).message).toContain('Số dư không đủ');
  });

  it('đủ số dư thì trừ đúng và ghi giao dịch âm', async () => {
    const { prisma, state } = fakePrisma(1000);
    const billing = new BillingService(prisma);

    const { user, transaction } = await billing.debit(
      'u1',
      300,
      'VIDEO:1',
      'Tạo video',
    );

    expect(user.balance).toBe(700);
    expect(state.balance).toBe(700);
    expect(transaction).toMatchObject({
      amount: -300,
      type: 'DEBIT',
      reference: 'VIDEO:1',
    });
  });

  it('không có người dùng thì báo không tìm thấy, không phải thiếu tiền', async () => {
    const { prisma, state } = fakePrisma(1000);
    state.exists = false;
    const billing = new BillingService(prisma);

    await expect(billing.debit('u1', 100)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('số tiền không hợp lệ thì chặn ngay, chưa đụng tới số dư', async () => {
    const { prisma, state } = fakePrisma(1000);
    const billing = new BillingService(prisma);

    await expect(billing.debit('u1', 0)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(billing.debit('u1', -50)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(state.balance).toBe(1000);
  });
});
