import type { Product } from '@prisma/client';
import { describeProduct, parseVariants, productImages } from './content.service';

const product = {
  title: 'Giày chạy bộ Adidas Ultraboost',
  description: 'Đế Boost êm, size 38-44',
  category: 'Giày thể thao',
  price: 1_290_000,
  originalPrice: 2_100_000,
  currency: 'đ',
  images: ['https://img/1.jpg', 'https://img/2.jpg'],
} as unknown as Product;

describe('parseVariants', () => {
  it('đọc được JSON kể cả khi model bọc trong ```json hoặc nói thêm ngoài JSON', () => {
    expect(parseVariants('Đây nhé:\n```json\n{"variants": [" A ", "B"]}\n```')).toEqual(['A', 'B']);
  });

  it('bỏ phương án rỗng hoặc không phải chữ', () => {
    expect(parseVariants('{"variants": ["A", "", 3, "  "]}')).toEqual(['A']);
  });

  it('model không trả JSON thì dùng nguyên văn làm một phương án', () => {
    expect(parseVariants('Chỉ một bài viết thường')).toEqual(['Chỉ một bài viết thường']);
    expect(parseVariants('   ')).toEqual([]);
  });
});

describe('describeProduct', () => {
  it('đưa đúng thông tin có thật, có giá gốc khi khác giá bán', () => {
    const text = describeProduct(product);
    expect(text).toContain('Giá bán: 1.290.000đ');
    expect(text).toContain('Giá gốc: 2.100.000đ');
    expect(text).toContain('Đế Boost êm');
  });

  it('không bịa giá khi sản phẩm chưa có giá', () => {
    const text = describeProduct({ ...product, price: null, originalPrice: null } as unknown as Product);
    expect(text).not.toContain('Giá bán');
    expect(text).not.toContain('Giá gốc');
  });
});

describe('productImages', () => {
  it('đọc mảng link ảnh; dữ liệu lạ thì trả mảng rỗng', () => {
    expect(productImages(product)).toHaveLength(2);
    expect(productImages({ images: null } as unknown as Product)).toEqual([]);
    expect(productImages({ images: { a: 1 } } as unknown as Product)).toEqual([]);
  });
});
