/**
 * Dựng prompt cho video "một người nói chuyện" (talking head) kể chuyện đời sống.
 *
 * Tách riêng khỏi service để test được bằng hàm thuần: toàn bộ phần khó là CÁCH VIẾT prompt,
 * không phải phần gọi mạng.
 *
 * Hai prompt khác nhau:
 *  1. `buildScriptPrompt` — hỏi Gemini để RA KỊCH BẢN (lời thoại tiếng Việt + mô tả cảnh tiếng Anh).
 *     Người dùng đọc, sửa, xác nhận rồi mới sang bước 2 (bước 2 mới tốn tiền AI video).
 *  2. `buildClipPrompt` — ghép kịch bản đã duyệt thành prompt gửi Veo/Omni.
 */

/** Phong cách kể chuyện; nhãn tiếng Việt dùng luôn cho giao diện. */
export const STORY_STYLES = {
  'tam-su': 'Tâm sự nhẹ nhàng, như kể cho bạn thân nghe',
  'thang-than': 'Thẳng thắn, hơi gai góc, dám nói điều người khác ngại nói',
  'hai-huoc': 'Hài hước, tự trào, bắt trend mạng xã hội',
  'truyen-cam-hung': 'Truyền cảm hứng, ấm áp, kết bằng một bài học',
  'tranh-luan': 'Nêu quan điểm gây tranh luận lành mạnh để kéo bình luận',
} as const;

export type StoryStyle = keyof typeof STORY_STYLES;
export const STORY_STYLE_KEYS = Object.keys(STORY_STYLES) as StoryStyle[];

/** Bối cảnh quay gợi ý; để trống thì AI tự chọn bối cảnh hợp câu chuyện. */
export const STORY_SETTINGS = {
  car: 'Ngồi trong ô tô, quay selfie (kiểu video đang viral)',
  cafe: 'Ngồi quán cà phê, ánh sáng tự nhiên',
  home: 'Ở nhà, phòng khách hoặc góc bàn làm việc',
  street: 'Đi bộ ngoài phố, quay cầm tay',
  office: 'Ở văn phòng, sau giờ làm',
} as const;

export type StorySetting = keyof typeof STORY_SETTINGS;
export const STORY_SETTING_KEYS = Object.keys(STORY_SETTINGS) as StorySetting[];

/** Mô tả bối cảnh bằng tiếng Anh cho model video. */
const SETTING_EN: Record<StorySetting, string> = {
  car: 'sitting in the driver seat of a modern car, daylight coming through the windows, city street visible and slightly blurred outside',
  cafe: 'sitting at a table in a cozy coffee shop, soft natural window light, warm bokeh background',
  home: 'sitting at home in a living room, warm indoor lighting, tidy everyday background',
  street:
    'standing on a city sidewalk, natural daylight, blurred street life in the background',
  office:
    'sitting at a desk in a modern office after work hours, soft ceiling light, blurred office background',
};

/** Số clip cho phép: 1 clip (~8s, rẻ) hoặc 3 clip ghép lại (~24s, đắt gấp 3). */
export const STORY_CLIP_OPTIONS = [1, 3] as const;
export type StoryClips = (typeof STORY_CLIP_OPTIONS)[number];

/**
 * Ngân sách chữ cho mỗi clip. Người Việt nói thong thả ~3 tiếng/giây; clip 8s trừ
 * đầu-cuối còn ~7s thoại → ~24 tiếng. Nói quá dài thì model cắt ngang câu.
 */
export const MAX_WORDS_PER_CLIP = 26;

export interface StoryScene {
  /** Lời thoại TIẾNG VIỆT nhân vật nói trong clip này. */
  spoken: string;
  /** Mô tả hình ảnh/diễn xuất bằng TIẾNG ANH cho model video. */
  visual: string;
}

export interface StoryScript {
  title: string;
  scenes: StoryScene[];
  /** Caption tiếng Việt kèm hashtag để đăng Facebook/TikTok. */
  caption: string;
}

export interface ScriptRequest {
  topic: string;
  style: StoryStyle;
  clips: StoryClips;
  /** Ai là người xem: "mẹ bỉm sữa", "dân văn phòng 25-35"… */
  audience?: string;
  /** Mô tả nhân vật khi người dùng KHÔNG tải ảnh chân dung lên. */
  presenter?: string;
  setting?: StorySetting;
  /** Có ảnh chân dung thật hay không — đổi cách mô tả nhân vật trong prompt. */
  hasPortrait: boolean;
}

/** Đếm tiếng (âm tiết) trong câu tiếng Việt — tiếng Việt mỗi tiếng cách nhau bằng khoảng trắng. */
export function countWords(text: string): number {
  return (text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Prompt hỏi Gemini để ra kịch bản. Yêu cầu trả JSON để bóc chắc tay.
 *
 * Mục tiêu "nhiều tương tác nhất có thể" được viết thành các ràng buộc cụ thể
 * (hook 3 giây đầu, chi tiết thật, kết bằng câu hỏi) thay vì lời dặn chung chung,
 * vì model làm theo ràng buộc cụ thể tốt hơn hẳn.
 */
export function buildScriptPrompt(req: ScriptRequest): string {
  const totalSec = req.clips * 8;
  const sceneRule =
    req.clips === 1
      ? 'Chỉ 1 cảnh: hook + câu chuyện gọn + câu hỏi mời bình luận, tất cả trong 1 hơi nói.'
      : `Đúng ${req.clips} cảnh nối liền nhau thành một mạch: cảnh 1 là HOOK (câu gây tò mò/đồng cảm ngay từ chữ đầu tiên), cảnh 2 là DIỄN BIẾN (chi tiết thật, cụ thể), cảnh 3 là CHỐT (bài học hoặc quan điểm) + câu hỏi mời khán giả bình luận.`;

  const character = req.hasPortrait
    ? 'Nhân vật là người trong ảnh người dùng tải lên. Phần "visual" KHÔNG được mô tả ngoại hình (tuổi, tóc, khuôn mặt, trang phục) vì phải giữ nguyên người trong ảnh; chỉ mô tả biểu cảm, cử chỉ, góc máy và bối cảnh.'
    : `Nhân vật do AI tạo: ${req.presenter?.trim() || 'người Việt Nam, khoảng 25-32 tuổi, ăn mặc đời thường, gương mặt thân thiện'}. Phần "visual" của MỌI cảnh phải mô tả nhân vật giống hệt nhau để các clip trông như cùng một người.`;

  return [
    `Bạn là người viết kịch bản video ngắn (Reels/TikTok) tiếng Việt, chuyên dạng "một người nói thẳng vào camera" kể chuyện đời sống.`,
    `Viết kịch bản cho video dọc 9:16, dài ~${totalSec} giây, chia thành ${req.clips} cảnh, mỗi cảnh ~8 giây.`,
    '',
    `Chủ đề người dùng muốn kể: ${req.topic.trim()}`,
    `Phong cách: ${STORY_STYLES[req.style]}.`,
    req.audience?.trim() ? `Khán giả mục tiêu: ${req.audience.trim()}.` : '',
    req.setting
      ? `Bối cảnh quay: ${STORY_SETTINGS[req.setting]}.`
      : 'Bối cảnh quay: tự chọn cho hợp câu chuyện, đời thường, dễ quay.',
    character,
    '',
    'Quy tắc bắt buộc cho LỜI THOẠI (trường "spoken"):',
    `- Tiếng Việt có dấu, mỗi cảnh TỐI ĐA ${MAX_WORDS_PER_CLIP} tiếng (đếm theo khoảng trắng). Dài hơn là video bị cắt ngang câu.`,
    '- Viết như người thật nói: câu ngắn, có ngập ngừng tự nhiên, không văn viết, không liệt kê gạch đầu dòng.',
    '- Câu đầu tiên phải giữ chân người xem trong 3 giây: một tình huống cụ thể, một con số, hoặc một câu nói ngược đời.',
    '- Kể chi tiết THẬT và cụ thể (thời điểm, câu nói, hành động) thay vì nói đạo lý chung chung.',
    '- KHÔNG đọc số điện thoại, link, tên thương hiệu, tên người thật hay địa chỉ cụ thể.',
    '- Kết video bằng một câu hỏi mở mời người xem kể chuyện của họ ở phần bình luận.',
    '- Không công kích cá nhân, không kỳ thị, không khẳng định đặc điểm cá nhân của người xem, không hứa hẹn kết quả tuyệt đối.',
    '',
    sceneRule,
    '',
    'Quy tắc cho MÔ TẢ HÌNH (trường "visual"):',
    '- Viết bằng TIẾNG ANH, cho model video image-to-video hiểu.',
    '- Nêu rõ: biểu cảm và cử chỉ khớp với lời thoại, góc máy selfie cầm tay, ánh sáng tự nhiên, quay thật (live-action, photorealistic), KHÔNG hoạt hình.',
    '- KHÔNG mô tả chữ, phụ đề, tiêu đề hay watermark xuất hiện trên màn hình.',
    '',
    'Trả về DUY NHẤT một JSON hợp lệ, không giải thích thêm:',
    '{',
    '  "title": "tiêu đề ngắn tiếng Việt để người dùng nhận ra video này",',
    `  "scenes": [{ "spoken": "lời thoại tiếng Việt", "visual": "english shot description" }] // đúng ${req.clips} phần tử`,
    '  ,"caption": "caption tiếng Việt đăng Facebook: 2-3 dòng theo giọng câu chuyện + câu hỏi mời bình luận + 5-7 hashtag"',
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Bóc kịch bản từ câu trả lời của model (model hay bọc JSON trong ```json). */
export function parseScript(raw: string, clips: number): StoryScript {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start)
    throw new Error('AI không trả về kịch bản đọc được');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error('AI không trả về kịch bản đọc được');
  }
  const obj = parsed as {
    title?: unknown;
    scenes?: unknown;
    caption?: unknown;
  };
  const scenes = Array.isArray(obj.scenes)
    ? obj.scenes
        .map((s) => s as { spoken?: unknown; visual?: unknown })
        .filter(
          (s) => typeof s.spoken === 'string' && s.spoken.trim().length > 0,
        )
        .map((s) => ({
          spoken: (s.spoken as string).trim(),
          visual: typeof s.visual === 'string' ? s.visual.trim() : '',
        }))
        .slice(0, clips)
    : [];
  if (scenes.length !== clips) {
    throw new Error(
      `AI trả về ${scenes.length} cảnh thay vì ${clips}, thử viết lại kịch bản.`,
    );
  }
  return {
    title:
      typeof obj.title === 'string' && obj.title.trim()
        ? obj.title.trim()
        : scenes[0].spoken.slice(0, 60),
    scenes,
    caption: typeof obj.caption === 'string' ? obj.caption.trim() : '',
  };
}

export interface ClipPromptInput {
  scene: StoryScene;
  /** Có ảnh chân dung làm khung hình đầu hay không. */
  hasPortrait: boolean;
  presenter?: string;
  setting?: StorySetting;
  /** Clip thứ mấy trong chuỗi (từ 1). Clip sau nối tiếp clip trước. */
  index: number;
  total: number;
}

/**
 * Ghép prompt gửi Veo/Omni cho MỘT clip.
 *
 * Ba thứ luôn bị ép trong code, không để AI kịch bản tự quyết:
 *  - khung dọc 9:16;
 *  - CẤM mọi chữ trên hình (Veo viết tiếng Việt sai dấu — xem README);
 *  - lời thoại đặt trong ngoặc kép và ghi rõ nói tiếng Việt, để model khớp khẩu hình.
 */
export function buildClipPrompt(input: ClipPromptInput): string {
  const { scene, index, total } = input;
  const who = input.hasPortrait
    ? 'The person from the reference image speaks directly to the camera. Keep their face, hair, skin tone, age and clothing EXACTLY as in the reference image — do not change or beautify the face.'
    : `A Vietnamese presenter speaks directly to the camera: ${input.presenter?.trim() || 'a friendly Vietnamese person in their late twenties, casual everyday clothes'}.`;
  const place = input.setting
    ? SETTING_EN[input.setting]
    : 'in a natural everyday Vietnamese setting that fits the story';

  return [
    'VERTICAL 9:16 portrait video (aspect ratio 9:16, taller than wide), handheld selfie shot from arm length, front-facing phone camera look.',
    who,
    `Setting: ${place}.`,
    scene.visual,
    total > 1
      ? `This is part ${index} of ${total} of one continuous monologue: same person, same clothes, same location and same lighting as the other parts, single continuous take, no cuts.`
      : 'Single continuous take, no cuts.',
    'Live-action photorealistic footage shot on a modern smartphone, natural lighting, realistic skin texture, slight handheld camera movement. NOT animation, NOT CGI, NOT a cartoon.',
    `The person speaks in VIETNAMESE with natural, accurate lip-sync, warm conversational tone, clear voice, quiet realistic room ambience and no background music. Spoken line (Vietnamese, say exactly this and nothing else): "${scene.spoken}"`,
    'NO on-screen text: do not render any text, subtitles, captions, titles, letters, numbers, logos or watermarks anywhere in the video.',
  ].join('\n\n');
}

/** Toàn bộ lời thoại ghép lại — trả cho người dùng tự chèn phụ đề khi đăng. */
export function joinSpoken(scenes: StoryScene[]): string {
  return scenes.map((s) => s.spoken.trim()).join('\n');
}
