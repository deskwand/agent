import { describe, it, expect } from "vitest";
import { createSentenceStream } from "../../renderer/utils/tts/stream-sentences";

describe("createSentenceStream", () => {
  it("emits nothing while the only sentence is unfinished", () => {
    const s = createSentenceStream();
    expect(s.push("这个报错的意思")).toEqual([]);
    expect(s.push("这个报错的意思是端口被占用")).toEqual([]);
  });

  it("emits a sentence once it ends with a terminator", () => {
    const s = createSentenceStream();
    expect(s.push("这个报错的意思是端口被占用了。")).toEqual([
      "这个报错的意思是端口被占用了。",
    ]);
  });

  it("holds the trailing sentence and releases it when the next arrives", () => {
    const s = createSentenceStream();
    s.push("端口被占用了。");
    expect(s.push("端口被占用了。先确认是谁在用它")).toEqual([]);
    expect(s.push("端口被占用了。先确认是谁在用它，然后换一个端口。")).toEqual([
      "先确认是谁在用它，然后换一个端口。",
    ]);
  });

  it("never repeats an emitted sentence across pushes", () => {
    const s = createSentenceStream();
    expect(s.push("第一句。")).toEqual(["第一句。"]);
    expect(s.push("第一句。第二句。")).toEqual(["第二句。"]);
    expect(s.push("第一句。第二句。")).toEqual([]);
  });

  it("flush releases the unfinished tail", () => {
    const s = createSentenceStream();
    s.push("端口被占用了。换一个端口就行");
    expect(s.flush()).toEqual(["换一个端口就行"]);
  });

  it("flush is idempotent", () => {
    const s = createSentenceStream();
    s.push("一句");
    expect(s.flush()).toEqual(["一句"]);
    expect(s.flush()).toEqual([]);
  });

  it("skips fenced code blocks entirely", () => {
    const s = createSentenceStream();
    expect(
      s.push("看这段代码：\n```ts\nconst port = 3000;\n```\n它占用了端口。"),
    ).toEqual(["看这段代码：", "它占用了端口。"]);
  });

  it("handles an unterminated code block without emitting its content", () => {
    const s = createSentenceStream();
    expect(s.push("先看这个。\n```ts\nconst port = 3000;")).toEqual([
      "先看这个。",
    ]);
  });

  it("strips markdown emphasis and inline code markers", () => {
    const s = createSentenceStream();
    expect(s.push("把 **端口** 改成 `3000` 就行。")).toEqual([
      "把 端口 改成 3000 就行。",
    ]);
  });

  it("strips leading heading markers", () => {
    const s = createSentenceStream();
    expect(s.push("## 原因。")).toEqual(["原因。"]);
  });
});
