// Các mức nạp gợi ý. `bonus` là % khuyến mãi cộng thêm trên `base`.
// Ví dụ: base 300.000 + bonus 5% => khách được cộng 315.000 điểm.
export interface Tier {
  base: number;
  bonus: number; // phần trăm
}

export const DEFAULT_TIERS: Tier[] = [
  { base: 10_000, bonus: 0 },
  { base: 20_000, bonus: 0 },
  { base: 50_000, bonus: 0 },
  { base: 100_000, bonus: 0 },
  { base: 200_000, bonus: 0 },
  { base: 300_000, bonus: 5 },
  { base: 500_000, bonus: 15 },
  { base: 1_000_000, bonus: 20 },
];

/**
 * Đọc cấu hình mức nạp từ env TELEGRAM_TIERS nếu có.
 * Định dạng: "base:bonus,base:bonus" — ví dụ "10000:0,300000:5,1000000:20".
 */
export function loadTiers(raw?: string): Tier[] {
  if (!raw) return DEFAULT_TIERS;
  const tiers = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [base, bonus] = part.split(':').map((n) => Number(n.trim()));
      return { base, bonus: Number.isFinite(bonus) ? bonus : 0 };
    })
    .filter((t) => Number.isFinite(t.base) && t.base > 0);
  return tiers.length ? tiers : DEFAULT_TIERS;
}

/** Tổng điểm khách thực nhận = base + làm tròn(base * bonus%). */
export function computeTotal(tier: Tier): number {
  return tier.base + Math.round((tier.base * tier.bonus) / 100);
}

export function formatPoints(n: number): string {
  return n.toLocaleString('vi-VN');
}
