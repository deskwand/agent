import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PET_CHARACTER_COMPONENTS } from "../../renderer/pet-characters";
import { PET_CHARACTERS } from "../../shared/pet-characters";

/**
 * 直接驱动映射表本身：每个 id 渲染出来的根类名必须是它自己。
 * 这条会抓住"egg 位置挂了 PetOctopus"这类接错——只按组件逐个渲染是抓不到的
 * （那种写法里组件与类名都是测试自己写死的，映射表根本没被碰到）。
 */
it("maps every character id to the component that renders that character", () => {
  for (const id of PET_CHARACTERS) {
    const Component = PET_CHARACTER_COMPONENTS[id];
    const html = renderToStaticMarkup(<Component state="failure" />);
    // 只看根元素：类名与 data-state 必须落在同一个节点上，样式才挂得住。
    const root = html.slice(0, html.indexOf(">") + 1);
    expect(root).toContain(`class="pet-${id}"`);
    expect(root).toContain('data-state="failure"');
    // 内部类名同族，进一步确认整棵子树都属于这只角色。
    expect(html).toContain(`pet-${id}__`);
  }
});

it("covers every declared character", () => {
  expect(Object.keys(PET_CHARACTER_COMPONENTS).sort()).toEqual(
    [...PET_CHARACTERS].sort(),
  );
});
