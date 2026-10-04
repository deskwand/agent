import { describe, expect, it } from "vitest";
import { pickEngine } from "../../main/tts/route";

describe("pickEngine", () => {
  it("keeps Chinese sentences (with English terms) on the Chinese engine", () => {
    expect(
      pickEngine("运行 npm install 安装依赖，然后 npm run build 打包。"),
    ).toBe("zh");
  });

  it("routes a fully English sentence to the English engine", () => {
    expect(pickEngine("The preload script was not bundled.")).toBe("en");
  });

  it("routes short English sentences too — no word-count floor", () => {
    expect(pickEngine("Looks good.")).toBe("en");
    expect(pickEngine("npm run build")).toBe("en");
    expect(pickEngine("OK.")).toBe("en");
    expect(pickEngine("tsc")).toBe("en");
  });

  it("keeps an English sentence that quotes Chinese on the Chinese engine", () => {
    expect(pickEngine("The term 打包 means bundling.")).toBe("zh");
  });

  it("never routes letterless notation to the English engine", () => {
    // 明确选择（设计 §4.2）：无字母的记号段走中文引擎，中文 fst 会把数字念出来
    expect(pickEngine("1.0.47")).toBe("zh");
    expect(pickEngine("3.14")).toBe("zh");
    expect(pickEngine("12")).toBe("zh");
    expect(pickEngine("50%")).toBe("zh");
    expect(pickEngine("——")).toBe("zh");
  });

  it("keeps non-Latin scripts off the English engine", () => {
    expect(pickEngine("こんにちは")).toBe("zh");
    expect(pickEngine("αβγ")).toBe("zh");
    expect(pickEngine("Привет")).toBe("zh");
  });

  it("needs at least two letters", () => {
    expect(pickEngine("A.")).toBe("zh");
    expect(pickEngine("x")).toBe("zh");
  });
});
