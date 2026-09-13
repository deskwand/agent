// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { Tooltip } from "../../renderer/components/Tooltip";

// children 必须放在 props 里：React 18 的 createElement 重载要求 props 自身满足
// 组件必填 props，把 children 作为位置参数传递不算数。
function renderTooltip(label: string): Document {
  return new JSDOM(
    renderToStaticMarkup(
      React.createElement(Tooltip, {
        label,
        children: React.createElement("button", null, "x"),
      }),
    ),
  ).window.document;
}

describe("Tooltip", () => {
  it("默认不渲染气泡（可见性由 hover/focus state 驱动）", () => {
    const doc = renderTooltip("文件浏览");
    expect(doc.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("不输出原生 title 属性", () => {
    const doc = renderTooltip("文件浏览");
    expect(doc.querySelectorAll("[title]").length).toBe(0);
  });

  it("按钮自身是锚点包裹层的子元素", () => {
    const doc = renderTooltip("a");
    const anchor = doc.querySelector(".tt-anchor");
    expect(anchor).not.toBeNull();
    expect(anchor!.querySelector("button")).not.toBeNull();
  });

  it("空 label 时只渲染 children，不产生气泡也不产生包裹层", () => {
    // 迁移前某些按钮在特定状态下把 title 设为 ""（不显示提示）。
    // 空 label 必须保持这个语义，而不是渲染一个空气泡。
    const doc = renderTooltip("");
    expect(doc.querySelector('[role="tooltip"]')).toBeNull();
    expect(doc.querySelector(".tt-anchor")).toBeNull();
    expect(doc.querySelector("button")).not.toBeNull();
  });
});
