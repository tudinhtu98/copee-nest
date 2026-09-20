import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  STORY_CLIP_OPTIONS,
  STORY_SETTING_KEYS,
  STORY_STYLE_KEYS,
} from '../video/story.prompt';
import { ACTION_KINDS } from './actions.service';
import {
  CONTENT_GOALS,
  CONTENT_TONES,
  IMAGE_ASPECT_RATIOS,
} from './content.service';

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

/** Bước 1: nhờ AI viết kịch bản video kể chuyện (chưa dựng video, chưa tốn tiền video). */
export class DraftStoryDto {
  @IsString()
  @MinLength(5, {
    message: 'Hãy mô tả câu chuyện bạn muốn kể (ít nhất 5 ký tự)',
  })
  @MaxLength(1000)
  topic!: string;

  @IsIn(STORY_STYLE_KEYS as unknown as string[])
  style!: string;

  @IsIn(STORY_CLIP_OPTIONS as unknown as number[], {
    message: 'Chỉ tạo được video 1 clip hoặc 3 clip',
  })
  clips!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  audience?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  presenter?: string;

  @IsOptional()
  @IsIn(STORY_SETTING_KEYS as unknown as string[])
  setting?: string;

  @IsOptional()
  @IsString()
  mediaId?: string;
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
