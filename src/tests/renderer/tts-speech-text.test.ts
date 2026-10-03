// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  extractSpeechSegments,
  splitSentences,
} from "../../renderer/utils/tts/speech-text";

function body(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

describe("切句", () => {
  it("中英标点都切，标点跟着前句", () => {
    expect(
      splitSentences("第一句。第二句！第三句？").map((s) => s.text),
    ).toEqual(["第一句。", "第二句！", "第三句？"]);
  });

  it("小数与版本号不切", () => {
    expect(splitSentences("圆周率是 3.14 左右。").map((s) => s.text)).toEqual([
      "圆周率是 3.14 左右。",
    ]);
    expect(splitSentences("升级到 v1.0 了。").map((s) => s.text)).toEqual([
      "升级到 v1.0 了。",
    ]);
  });

  it("英文句点后必须跟空白才切，缩写不切", () => {
    expect(
      splitSentences("Use e.g. this one. Done.").map((s) => s.text),
    ).toEqual(["Use e.g. this one.", "Done."]);
  });

  it("偏移量指向原字符串", () => {
    const [first] = splitSentences("甲。乙。");
    expect("甲。乙。".slice(first.start, first.end)).toBe("甲。");
  });

  it("空输入给空数组", () => {
    expect(splitSentences("   ")).toEqual([]);
  });
});

describe("抽口播文本", () => {
  it("段落里的句子带可用于高亮的范围", () => {
    const root = body("<p>第一句。第二句。</p>");
    const segments = extractSpeechSegments(root);

    expect(segments.map((s) => s.text)).toEqual(["第一句。", "第二句。"]);
    const target = segments[1].target;
    expect(target.kind).toBe("range");
    if (target.kind === "range") {
      expect(target.startNode.textContent).toBe("第一句。第二句。");
      // 「第一句。第二句。」= 8 个字符，第二句从下标 4 开始到 8 结束（半开区间）
      expect(target.startOffset).toBe(4);
      expect(target.endOffset).toBe(8);
    }
  });

  it("代码块只报行数，并整块高亮", () => {
    const root = body("<p>如下。</p><pre>a\nb\nc\n</pre>");
    const segments = extractSpeechSegments(root);

    expect(segments.map((s) => s.text)).toEqual(["如下。", "代码块，共 3 行"]);
    expect(segments[1].target.kind).toBe("block");
  });

  it("表格先报行列再逐行念，空单元格念空", () => {
    const root = body(
      "<table><thead><tr><th>名称</th><th>值</th></tr></thead>" +
        "<tbody><tr><td>超时</td><td>5 秒</td></tr><tr><td>重试</td><td></td></tr></tbody></table>",
    );
    const segments = extractSpeechSegments(root);

    expect(segments.map((s) => s.text)).toEqual([
      "表格，2 行 2 列",
      "名称：超时，值：5 秒",
      "名称：重试，值：空",
    ]);
  });

  it("链接只读文字，不读地址", () => {
    const root = body('<p>见 <a href="https://example.com/x">文档</a>。</p>');
    const segments = extractSpeechSegments(root);
    expect(segments.map((s) => s.text)).toEqual(["见 文档。"]);
  });

  it("图片读 alt，没有 alt 就跳过", () => {
    const root = body(
      '<p>看图。<img alt="架构图" src="x.png"><img src="y.png"></p>',
    );
    const segments = extractSpeechSegments(root);
    expect(segments.map((s) => s.text)).toEqual(["看图。", "架构图"]);
  });

  it("公式跳过", () => {
    const root = body('<p>公式 <span class="katex">x^2</span> 结束。</p>');
    const segments = extractSpeechSegments(root);
    expect(segments.map((s) => s.text)).toEqual(["公式 结束。"]);
  });

  it("公式跳过时，口播文本不留双空格", () => {
    const root = body('<p>公式 <span class="katex">x^2</span> 结束。</p>');
    const segments = extractSpeechSegments(root);
    expect(segments.map((s) => s.text)).toEqual(["公式 结束。"]);
    // 范围仍然盖住原始文本（含那两个空格），高亮不会偏
    const target = segments[0].target;
    if (target.kind === "range") {
      expect(target.startNode.textContent).toBe("公式 ");
    }
  });

  it("映射不上时退化为整块高亮，而不是丢掉这句话", () => {
    const root = body("<p>孤句没有句号</p>");
    const segments = extractSpeechSegments(root);
    expect(segments).toHaveLength(1);
    expect(["range", "block"]).toContain(segments[0].target.kind);
  });

  it("空代码块不报行数", () => {
    const root = body("<pre></pre><p>只有这句。</p>");
    expect(extractSpeechSegments(root).map((s) => s.text)).toEqual([
      "只有这句。",
    ]);
  });

  it("段落之间不跨段拼句", () => {
    const root = body("<p>没有句号</p><p>第二段</p>");
    expect(extractSpeechSegments(root).map((s) => s.text)).toEqual([
      "没有句号",
      "第二段",
    ]);
  });

  it("纯代码消息只剩一条", () => {
    const root = body("<pre>const a = 1;\n</pre>");
    expect(extractSpeechSegments(root).map((s) => s.text)).toEqual([
      "代码块，共 1 行",
    ]);
  });
});
