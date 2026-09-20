import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { POST_MAX_IMAGES } from './posts.service';

export class ConnectTokenDto {
  @IsString()
  @MinLength(30, { message: 'Token không hợp lệ' })
  @MaxLength(1000)
  accessToken!: string;
}

export class SavePostDto {
  @IsOptional()
  @IsString()
  pageId?: string | null;

  @IsOptional()
  @IsString()
  productId?: string | null;

  @IsString()
  @MaxLength(10_000)
  message!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsUrl(
    { require_protocol: true },
    { message: 'Link phải bắt đầu bằng http:// hoặc https://' },
  )
  link?: string | null;

  @IsArray()
  @ArrayMaxSize(POST_MAX_IMAGES, {
    message: `Mỗi bài tối đa ${POST_MAX_IMAGES} ảnh`,
  })
  @IsString({ each: true })
  @Type(() => String)
  mediaIds: string[] = [];
}

export class PublishPostDto {
  /** Bỏ trống = đăng ngay. */
  @IsOptional()
  @IsISO8601(
    { strict: true },
    { message: 'Giờ hẹn phải theo định dạng ISO 8601' },
  )
  scheduledAt?: string;
}

export class ImportImageDto {
  @IsUrl({ require_protocol: true }, { message: 'Link ảnh không hợp lệ' })
  url!: string;

  @IsOptional()
  @IsString()
  productId?: string;
}
