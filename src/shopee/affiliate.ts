/**
 * Tạo link affiliate Shopee từ link sản phẩm gốc.
 *
 * Định dạng: https://s.shopee.vn/an_redir?origin_link=<landing>&affiliate_id=<id>&sub_id=<sub>
 * - origin_link chỉ giữ origin + pathname (bỏ query rác của link gốc) để Shopee nhận diện đúng landing page.
 * - sub_id dùng để tracking nguồn traffic (tiktok, facebook, ...).
 */
export const DEFAULT_SUB_ID = 'copee';

export const SHOPEE_REDIRECT_BASE = 'https://s.shopee.vn/an_redir';

/** Host Shopee hợp lệ để tạo link aff. */
export function isShopeeUrl(rawUrl: string): boolean {
  try {
    const { hostname } = new URL(rawUrl);
    return /(^|\.)shopee\.[a-z.]+$/i.test(hostname);
  } catch {
    return false;
  }
}

export type AffiliateLinkResult = {
  affiliateId: string;
  subId: string;
  originLink: string;
  affiliateUrl: string;
};

/**
 * Trả về null nếu link không parse được (caller tự quyết định báo lỗi hay bỏ qua).
 */
export function buildShopeeAffiliateLink(
  rawUrl: string,
  affiliateId: string,
  subId?: string | null,
): AffiliateLinkResult | null {
  const id = affiliateId?.trim();
  if (!rawUrl || !id) return null;

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  const sub = subId?.trim() || DEFAULT_SUB_ID;
  const originLink = `${url.origin}${url.pathname}`;

  const params = new URLSearchParams({
    origin_link: originLink,
    affiliate_id: id,
    sub_id: sub,
  });

  return {
    affiliateId: id,
    subId: sub,
    originLink,
    affiliateUrl: `${SHOPEE_REDIRECT_BASE}?${params.toString()}`,
  };
}
