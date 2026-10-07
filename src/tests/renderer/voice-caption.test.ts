import { describe, expect, it } from "vitest";
import {
  stripVoiceMarkers,
  voiceCaptionLine,
} from "../../renderer/utils/voice/voice-caption";

describe("stripVoiceMarkers", () => {
  it("去掉配对的强调标记", () => {
    expect(stripVoiceMarkers("**第一天**：断桥")).toBe("第一天：断桥");
    expect(stripVoiceMarkers("__重点__内容")).toBe("重点内容");
    expect(stripVoiceMarkers("~~划掉~~")).toBe("划掉");
  });

  it("中英混排的加粗也能去掉", () => {
    expect(stripVoiceMarkers("这是**重点**内容")).toBe("这是重点内容");
    expect(stripVoiceMarkers("the **important** thing")).toBe(
      "the important thing",
    );
    expect(stripVoiceMarkers("**粗**：注释")).toBe("粗：注释");
  });

  it("不碰落单的 * 与 _", () => {
    expect(stripVoiceMarkers("2*3=6")).toBe("2*3=6");
    expect(stripVoiceMarkers("snake_case 命名")).toBe("snake_case 命名");
  });

  // 评审发现：代码类回答会被静默改写。这三条是回归锁。
  it("不碰标识符与路径里的双下划线", () => {
    expect(stripVoiceMarkers("def __init__(self):")).toBe(
      "def __init__(self):",
    );
    expect(stripVoiceMarkers("self.__dict__")).toBe("self.__dict__");
  });

  it("不碰幂运算与 glob 的双星号", () => {
    expect(stripVoiceMarkers("2**3**4")).toBe("2**3**4");
    expect(stripVoiceMarkers("src/**/a/**/*.ts")).toBe("src/**/a/**/*.ts");
    expect(stripVoiceMarkers("$a**b**c$")).toBe("$a**b**c$");
  });

  it("去掉行内代码的反引号", () => {
    expect(stripVoiceMarkers("跑 `npm run dev`")).toBe("跑 npm run dev");
  });

  it("去掉行首标题号与引用号", () => {
    expect(stripVoiceMarkers("#### 标题\n正文")).toBe("标题\n正文");
    expect(stripVoiceMarkers("> 引用")).toBe("引用");
  });

  it("删掉围栏行，保留代码内容", () => {
    expect(stripVoiceMarkers("```\nconst a = 1;\n```")).toBe("const a = 1;");
  });

  // 围栏里的内容是代码：行首 `#`、`>` 都不能按 markdown 处理。
  it("围栏内部一个字符都不动", () => {
    expect(stripVoiceMarkers("```\n# 注释\n> 输出\n```")).toBe(
      "# 注释\n> 输出",
    );
    expect(stripVoiceMarkers("前后\n```py\ndef __init__(self):\n```")).toBe(
      "前后\ndef __init__(self):",
    );
  });

  it("保留列表符与缩进", () => {
    expect(stripVoiceMarkers("- 断桥\n  1. 上午")).toBe("- 断桥\n  1. 上午");
  });
});

describe("voiceCaptionLine", () => {
  const base = {
    state: "listening" as const,
    transcript: "",
    answer: "",
    spoken: "",
  };

  it("识别中显示转写", () => {
    expect(
      voiceCaptionLine({
        ...base,
        state: "capturing",
        transcript: "说到一半",
        answer: "上一轮的回答",
      }),
    ).toBe("说到一半");
  });

  it("正在念的那个合成单元优先于整段回答", () => {
    expect(
      voiceCaptionLine({
        ...base,
        state: "speaking",
        answer: "第一句。第二句。",
        spoken: "第二句。",
      }),
    ).toBe("第二句。");
  });

  it("去标记只作用于回答侧，不动转写", () => {
    expect(voiceCaptionLine({ ...base, spoken: "**重点**" })).toBe("重点");
    // 转写是用户自己说的话，原样显示 —— 里面写了 ** 就让它原样出现。
    expect(
      voiceCaptionLine({
        ...base,
        state: "capturing",
        transcript: "他说 **这个词**",
      }),
    ).toBe("他说 **这个词**");
  });

  it("没在念的时候回落到回答：无可朗读文本的整轮靠它才不空", () => {
    // 纯代码块回答时 onSentence 一次都不触发，没有这条回落那一行会整轮空着。
    expect(
      voiceCaptionLine({ ...base, answer: "```\nconst a = 1;\n```" }),
    ).toBe("const a = 1;");
  });

  it("回答也空就回落转写，再空就是空串", () => {
    expect(voiceCaptionLine({ ...base, transcript: "兜底" })).toBe("兜底");
    expect(voiceCaptionLine(base)).toBe("");
  });

  it("只有空白的 spoken / answer 不占屏", () => {
    expect(
      voiceCaptionLine({
        ...base,
        spoken: "   ",
        answer: "  \n ",
        transcript: "兜底",
      }),
    ).toBe("兜底");
  });
});
