import { describe, expect, it } from "vitest";
import {
  isNearBottom,
  stripVoiceMarkers,
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

describe("isNearBottom", () => {
  it("贴底为真", () => {
    expect(isNearBottom(100, 100, 200)).toBe(true);
  });

  it("离底 24px 以内仍算贴底", () => {
    expect(isNearBottom(76, 100, 200)).toBe(true);
  });

  it("离底超过 24px 为假", () => {
    expect(isNearBottom(75, 100, 200)).toBe(false);
  });
});
