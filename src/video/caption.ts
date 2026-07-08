/**
 * Tạo caption + hashtag để user đăng kèm video lên TikTok/Reels/FB.
 *
 * Bản MVP dùng template. Có thể nâng cấp: nếu có ANTHROPIC_API_KEY, gọi Claude
 * viết hook giật tít + hashtag theo ngành hàng (xem TODO trong processor).
 */

interface CaptionProduct {
  title: string;
  price?: number | null;
  originalPrice?: number | null;
  category?: string | null;
}

const vnd = (n?: number | null) => (n ?? 0).toLocaleString('vi-VN') + 'đ';

/** Gắn aff_id vào link Shopee nếu có (giống luồng upload WooCommerce). */
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

export function buildCaption(
  product: CaptionProduct,
  affiliateLink: string,
): string {
  const pct =
    product.originalPrice && product.price && product.originalPrice > product.price
      ? Math.round(
          ((product.originalPrice - product.price) / product.originalPrice) * 100,
        )
      : 0;

  const lines: string[] = [];
  lines.push(`🔥 ${product.title}`);
  if (pct > 0) {
    lines.push(`💥 GIẢM ${pct}% — chỉ còn ${vnd(product.price)} (giá gốc ${vnd(product.originalPrice)})`);
  } else if (product.price) {
    lines.push(`💰 Chỉ ${vnd(product.price)}`);
  }
  lines.push('👉 Mua ngay: ' + affiliateLink);
  lines.push('');
  lines.push(hashtags(product.category));
  return lines.join('\n');
}

function hashtags(category?: string | null): string {
  const base = ['#shopee', '#sanphamhot', '#muahangonline', '#review', '#deal'];
  if (category) {
    const slug = category
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, '');
    if (slug) base.unshift('#' + slug);
  }
  return base.join(' ');
}
