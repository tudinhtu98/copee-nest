import { BadRequestException, Injectable } from '@nestjs/common';
import { MediaService } from '../social/media.service';
import {
  buildScriptPrompt,
  countWords,
  joinSpoken,
  MAX_WORDS_PER_CLIP,
  parseScript,
  STORY_SETTINGS,
  STORY_STYLES,
  type StoryClips,
  type StorySetting,
  type StoryStyle,
} from '../video/story.prompt';
import { GeminiClient } from './gemini.client';
import { PointsService } from './points.service';

const SYSTEM = [
  'Bạn viết kịch bản video ngắn tiếng Việt dạng "một người nói thẳng vào camera" kể chuyện đời sống.',
  'Bạn viết như người thật đang kể chuyện của chính mình, không như quảng cáo và không như bài giảng đạo lý.',
  '',
  'Ràng buộc bắt buộc:',
  '- Tiếng Việt có dấu, đúng chính tả.',
  '- Không bịa số liệu, nghiên cứu, tên người thật, thương hiệu hay địa chỉ cụ thể.',
  '- Không công kích cá nhân, không kỳ thị, không khẳng định đặc điểm cá nhân của người xem',
  '  (tránh kiểu "Bạn đang thất bại phải không?"), không hứa kết quả tuyệt đối.',
  '- Chỉ trả về JSON, không giải thích, không viết thêm chữ ngoài JSON.',
].join('\n');

export interface DraftStoryInput {
  topic: string;
  style: StoryStyle;
  clips: StoryClips;
  audience?: string;
  presenter?: string;
  setting?: StorySetting;
  /** Ảnh chân dung trong thư viện; có ảnh thì kịch bản không mô tả ngoại hình nữa. */
  mediaId?: string;
}

export interface DraftStoryResult {
  title: string;
  scenes: { spoken: string; visual: string; words: number }[];
  caption: string;
  /** Lời thoại ghép lại — người dùng copy để tự chèn phụ đề khi đăng. */
  spokenText: string;
  /** Cảnh nào dài quá nhịp nói 8 giây thì báo trước để người dùng cắt bớt. */
  warnings: string[];
  cost: number;
}

/**
 * Bước 1 của tính năng video kể chuyện: AI viết kịch bản để người dùng ĐỌC VÀ SỬA.
 *
 * Cố ý tách khỏi bước dựng video: viết kịch bản rẻ (chỉ gọi Gemini chữ) nên người dùng
 * viết lại bao nhiêu lần cũng được, còn dựng video đắt nên chỉ chạy sau khi đã bấm xác nhận.
 */
@Injectable()
export class StoryService {
  constructor(
    private readonly gemini: GeminiClient,
    private readonly points: PointsService,
    private readonly media: MediaService,
  ) {}

  /** Lựa chọn cho giao diện (phong cách, bối cảnh, số clip) — để web không phải chép lại danh sách. */
  options() {
    return {
      styles: Object.entries(STORY_STYLES).map(([value, label]) => ({
        value,
        label,
      })),
      settings: Object.entries(STORY_SETTINGS).map(([value, label]) => ({
        value,
        label,
      })),
      maxWordsPerClip: MAX_WORDS_PER_CLIP,
    };
  }

  async draft(
    userId: string,
    input: DraftStoryInput,
  ): Promise<DraftStoryResult> {
    const topic = (input.topic ?? '').trim();
    if (topic.length < 5) {
      throw new BadRequestException(
        'Hãy mô tả câu chuyện bạn muốn kể (ít nhất 5 ký tự)',
      );
    }
    await this.points.assertEnough(userId, 'AI_VIDEO_SCRIPT_COST');

    // Ảnh chân dung chỉ cần kiểm tra là có thật và thuộc về người này; nội dung ảnh
    // để bước dựng video dùng, kịch bản không cần nhìn ảnh.
    const hasPortrait = Boolean(input.mediaId);
    if (input.mediaId) await this.media.find(userId, input.mediaId);

    const prompt = buildScriptPrompt({
      topic,
      style: input.style,
      clips: input.clips,
      audience: input.audience,
      presenter: input.presenter,
      setting: input.setting,
      hasPortrait,
    });

    const text = await this.gemini.generateText({
      system: SYSTEM,
      prompt,
      maxOutputTokens: 4096,
    });
    let script;
    try {
      script = parseScript(text, input.clips);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    const warnings = script.scenes
      .map((s, i) => ({ i, words: countWords(s.spoken) }))
      .filter((s) => s.words > MAX_WORDS_PER_CLIP)
      .map(
        (s) =>
          `Cảnh ${s.i + 1} dài ${s.words} tiếng (nhịp nói 8 giây chỉ vừa khoảng ${MAX_WORDS_PER_CLIP} tiếng) — nên rút ngắn, không video sẽ bị cắt ngang câu.`,
      );

    const cost = await this.points.charge(
      userId,
      'AI_VIDEO_SCRIPT_COST',
      `ai-story:${userId}:${Date.now()}`,
      `AI viết kịch bản video: ${topic.slice(0, 60)}`,
    );

    return {
      title: script.title,
      scenes: script.scenes.map((s) => ({ ...s, words: countWords(s.spoken) })),
      caption: script.caption,
      spokenText: joinSpoken(script.scenes),
      warnings,
      cost,
    };
  }
}
