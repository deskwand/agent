// @vitest-environment node
import { describe, expect, it } from "vitest";

import { css } from "./theme-css-helpers";

// 这条守卫只能证明 CSS 写得对，证明不了类真的被应用 —— 后者归 feed-reader.test.tsx
describe(".prose-feed", () => {
  it("行高与段距按设计 §8.8 放大", () => {
    const lineHeight =
      /\.prose-feed \.prose-chat \{[^}]*line-height:\s*([\d.]+)/.exec(css);
    expect(Number(lineHeight?.[1])).toBeGreaterThanOrEqual(1.75);

    const paragraph =
      /\.prose-feed \.prose-chat p \{[^}]*margin-bottom:\s*([\d.]+)em/.exec(
        css,
      );
    expect(Number(paragraph?.[1])).toBeGreaterThanOrEqual(1.8);
  });

  it("保留 .prose-chat 的收尾行为，不留一个多余的空隙", () => {
    expect(
      /\.prose-feed \.prose-chat p:last-child \{[^}]*margin-bottom:\s*0/.test(
        css,
      ),
    ).toBe(true);
  });

  it("最后一条给 .prose-chat 设行高的规则就是我们这条（同特异性靠源码顺序定胜负）", () => {
    // 先剥掉注释：不剥的话，上一条规则上面的注释会被当成选择器文本的一部分
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...withoutComments.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(
      ([, selector, body]) =>
        /\.prose-chat/.test(selector) && /line-height/.test(body),
    );
    expect(rules.length).toBeGreaterThan(0);
    // 写成「最后一条」而不是「之后没有别的」：后者会把唯一可能真正赢过我们的
    // 那条（另一条 .prose-feed .prose-chat）排除在外，等于放跑风险本身
    expect(rules[rules.length - 1]![1].trim()).toBe(".prose-feed .prose-chat");
  });
});
