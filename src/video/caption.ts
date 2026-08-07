/**
 * Caption bán hàng do Gemini viết; ở đây chỉ lo ghép link mua vào cuối caption.
 * Link affiliate được tạo bởi ShopeeService (xem src/shopee/affiliate.ts).
 */

/** Ghép caption Gemini + link mua (giới hạn 1024 ký tự cho Telegram video caption). */
export function finalizeCaption(geminiCaption: string, affiliateLink: string): string {
  const link = affiliateLink ? `\n\n👉 Mua ngay: ${affiliateLink}` : '';
  const room = 1024 - link.length;
  const body = geminiCaption.length > room ? geminiCaption.slice(0, room - 1) + '…' : geminiCaption;
  return body + link;
}
