/**
 * Gắn aff_id vào link Shopee (giống luồng upload WooCommerce). Caption bán hàng
 * giờ do Gemini viết; ở đây chỉ lo phần link affiliate để chèn vào cuối caption.
 */
export function toAffiliateLink(
  sourceUrl: string,
  affiliateId?: string | null,
): string {
  if (!sourceUrl) return '';
  if (!affiliateId || !affiliateId.trim()) return sourceUrl;
  try {
    const url = new URL(sourceUrl);
    url.searchParams.set('aff_id', affiliateId.trim());
    return url.toString();
  } catch {
    return sourceUrl;
  }
}

/** Ghép caption Gemini + link mua (giới hạn 1024 ký tự cho Telegram video caption). */
export function finalizeCaption(geminiCaption: string, affiliateLink: string): string {
  const link = affiliateLink ? `\n\n👉 Mua ngay: ${affiliateLink}` : '';
  const room = 1024 - link.length;
  const body = geminiCaption.length > room ? geminiCaption.slice(0, room - 1) + '…' : geminiCaption;
  return body + link;
}
