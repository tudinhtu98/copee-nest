import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ACTION_KINDS } from './actions.service';
import { CONTENT_GOALS, CONTENT_TONES, IMAGE_ASPECT_RATIOS } from './content.service';

export class WritePostDto {
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  brief?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsIn(CONTENT_TONES as unknown as string[])
  tone!: string;

  @IsIn(CONTENT_GOALS as unknown as string[])
  goal!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  variants?: number;

  @IsOptional()
  @IsString()
  mediaId?: string;

  @IsOptional()
  includeLink?: boolean;
}

export class GenerateImageDto {
  @IsString()
  @MinLength(5, { message: 'Mô tả ảnh ít nhất 5 ký tự' })
  @MaxLength(2000)
  prompt!: string;

  @IsIn(IMAGE_ASPECT_RATIOS as unknown as string[])
  aspectRatio!: string;

  @IsOptional()
  @IsString()
  referenceMediaId?: string;

  @IsOptional()
  @IsString()
  productId?: string;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1, { message: 'Nhập câu hỏi' })
  @MaxLength(2000)
  message!: string;
}

export class ProposeActionDto {
  @IsIn(ACTION_KINDS as unknown as string[])
  kind!: string;

  @IsOptional()
  params?: Record<string, unknown>;
}
