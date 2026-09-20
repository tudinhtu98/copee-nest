import {
  buildClipPrompt,
  buildScriptPrompt,
  countWords,
  joinSpoken,
  parseScript,
} from './story.prompt';

describe('kịch bản video kể chuyện', () => {
  it('prompt viết kịch bản nêu rõ số cảnh và giới hạn độ dài lời thoại', () => {
    const prompt = buildScriptPrompt({
      topic: 'chuyện bị sếp mắng oan',
      style: 'tam-su',
      clips: 3,
      hasPortrait: false,
      presenter: 'nữ 28 tuổi',
    });
    expect(prompt).toContain('3 cảnh');
    expect(prompt).toContain('26 tiếng');
    expect(prompt).toContain('nữ 28 tuổi');
  });

  it('có ảnh chân dung thì cấm AI mô tả ngoại hình', () => {
    const prompt = buildScriptPrompt({
      topic: 'chuyện đi làm',
      style: 'hai-huoc',
      clips: 1,
      hasPortrait: true,
    });
    expect(prompt).toContain('KHÔNG được mô tả ngoại hình');
  });

  it('bóc được kịch bản kể cả khi model bọc trong khối ```json', () => {
    const raw =
      '```json\n{"title":"Chuyện sếp","scenes":[{"spoken":"Hôm qua tôi bị mắng oan.","visual":"close up"}],"caption":"cap"}\n```';
    const script = parseScript(raw, 1);
    expect(script.title).toBe('Chuyện sếp');
    expect(script.scenes[0].spoken).toBe('Hôm qua tôi bị mắng oan.');
    expect(script.caption).toBe('cap');
  });

  it('báo lỗi khi model trả sai số cảnh', () => {
    const raw =
      '{"title":"x","scenes":[{"spoken":"một câu","visual":"a"}],"caption":""}';
    expect(() => parseScript(raw, 3)).toThrow(/1 cảnh/);
  });

  it('prompt clip ép khung dọc, cấm chữ trên hình và đặt lời thoại nguyên văn', () => {
    const prompt = buildClipPrompt({
      scene: {
        spoken: 'Người trước mặt mình rất đáng để trân trọng.',
        visual: 'warm smile, slight nod',
      },
      hasPortrait: true,
      setting: 'car',
      index: 1,
      total: 1,
    });
    expect(prompt).toContain('9:16');
    expect(prompt).toContain('"Người trước mặt mình rất đáng để trân trọng."');
    expect(prompt).toContain('NO on-screen text');
    expect(prompt).toContain('sitting in the driver seat');
    // Có ảnh thật: phải dặn giữ nguyên khuôn mặt
    expect(prompt).toContain('EXACTLY as in the reference image');
  });

  it('clip trong chuỗi nhiều phần được dặn giữ nguyên người và bối cảnh', () => {
    const prompt = buildClipPrompt({
      scene: { spoken: 'Rồi tôi mới hiểu ra.', visual: 'thoughtful look' },
      hasPortrait: false,
      presenter: 'a Vietnamese woman in her late twenties',
      index: 2,
      total: 3,
    });
    expect(prompt).toContain('part 2 of 3');
    expect(prompt).toContain('a Vietnamese woman in her late twenties');
  });

  it('đếm tiếng và ghép lời thoại', () => {
    expect(countWords('Hôm qua tôi đi làm')).toBe(5);
    expect(countWords('   ')).toBe(0);
    expect(
      joinSpoken([
        { spoken: 'Câu một', visual: '' },
        { spoken: 'Câu hai', visual: '' },
      ]),
    ).toBe('Câu một\nCâu hai');
  });
});
