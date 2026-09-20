import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { STORY_CLIP_OPTIONS, STORY_SETTING_KEYS } from './story.prompt';

/** Một cảnh trong kịch bản đã được người dùng xem và sửa. */
export class StorySceneDto {
  @IsString()
  @MinLength(1, { message: 'Cảnh nào cũng phải có lời thoại' })
  @MaxLength(500)
  spoken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1500)
  visual?: string;
}

/** Bước 2: dựng video từ kịch bản đã xác nhận (đây mới là bước tốn điểm video). */
export class CreateStoryVideoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  title!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => StorySceneDto)
  scenes!: StorySceneDto[];

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  caption?: string;

  @IsIn(STORY_CLIP_OPTIONS as unknown as number[], {
    message: 'Chỉ tạo được video 1 clip hoặc 3 clip',
  })
  clips!: number;

  @IsOptional()
  @IsString()
  mediaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  presenter?: string;

  @IsOptional()
  @IsIn(STORY_SETTING_KEYS as unknown as string[])
  setting?: string;
}
