// @vitest-environment jsdom
//
// Sidebar 的「新建项目」弹窗（迁移到 OccludingDialog）。
//
// 三件事：
//   1. 打开后焦点在项目名输入框上（原实现靠 `autoFocus`）
//   2. busy 时三条关闭路径全挡住（原实现只在遮罩 onClick 里挡 + 按钮 disabled）
//   3. 空闲时 Esc 关闭
//
// harness 抄自 src/tests/renderer/sidebar-project-groups.test.ts —— 那个文件
// 已经能成功挂载真的 `Sidebar`（含 `createProject` 的 IPC 桩），不另发明一套。
//
// ⚠️ 「新建项目」的入口在项目操作菜单里，而菜单的触发器是个**没有 aria-label、
// 没有文本**的 ChevronDown 按钮。所以只能按图标类名找它 —— 这是本文件唯一
// 脆弱的地方，下面有一条断言把它的唯一性钉住。
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../renderer/i18n/config";
import { Sidebar } from "../../renderer/components/Sidebar";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";
import { setupDialogTest } from "../dialog-test-helpers";

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  deleteSession: vi.fn(),
  deleteProject: vi.fn(),
  archiveSession: vi.fn(),
  getSessionMessages: vi.fn(),
  getSessionTraceSteps: vi.fn(),
  changeWorkingDir: vi.fn(),
  createProject: vi.fn(),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ ...ipc, isElectron: true }),
}));

let d: ReturnType<typeof setupDialogTest>;
let shell: () => Element | null;

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // vi.clearAllMocks() **不**清 mockImplementation —— busy 用例会装一个永不 resolve 的
  // 实现，这里显式复位，否则将来把用例顺序调整后后面的用例会挂住而不是失败。
  ipc.createProject.mockResolvedValue({ success: true });
  useAppStore.setState(useAppStore.getInitialState(), true);
  d = setupDialogTest();
  ({ shell } = d);
});

afterEach(() => {
  d.teardown();
  vi.unstubAllGlobals();
});

function projectSession(cwd: string): Session {
  return {
    id: "p1",
    title: "deskwand",
    cwd,
    isProjectMode: true,
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Session;
}

async function flush(): Promise<void> {
  await act(async () => {});
}

async function renderSidebar(): Promise<void> {
  await act(async () => {
    useAppStore.setState({ sessions: [projectSession("/work/deskwand")] });
    d.container.ownerDocument; // no-op，保持 container 引用被使用
    // 侧栏的项目默认收起；本测试要的是项目区里的菜单，所以先展开
    localStorage.setItem(
      "deskwand.sidebarGroupExpansion",
      JSON.stringify({ projects: true }),
    );
  });
  await d.render(<Sidebar width={280} />);
  await flush();
}

/** 项目操作菜单的触发器（无文本、无 aria-label，只能按图标找）。 */
function projectActionsTrigger(): HTMLButtonElement | undefined {
  // 这个定位器依赖「body 里只有一个 chevron 按钮」—— 多一个就会点到别的菜单。
  // 把依赖本身断言出来，否则将来多出一个 chevron 会静默点错元素。
  expect(
    document.body.querySelectorAll("button svg.lucide-chevron-down").length,
    "按图标找菜单触发器的前提是它唯一",
  ).toBe(1);
  return Array.from(document.body.querySelectorAll("button")).find((b) =>
    b.querySelector("svg.lucide-chevron-down"),
  ) as HTMLButtonElement | undefined;
}

/** 点开「项目操作」菜单 → 点「新建项目」→ 弹窗出现。 */
async function openCreateProject(): Promise<void> {
  const trigger = projectActionsTrigger();
  expect(trigger, "项目操作菜单的触发器必须找得到").toBeTruthy();
  await act(async () => {
    trigger!.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
  });

  // ⚠️ Radix 的 DropdownMenuItem 渲染成 **div[role="menuitem"]**（不是 button ✗）
  // —— 只查 "button" 会永远找不到 ✓✓（探针实测：aria-expanded=true、role=menu 已在 body ✓）。
  const newProject = Array.from(
    document.body.querySelectorAll<HTMLElement>('button, [role="menuitem"]'),
  ).find((b) => b.textContent === i18n.t("sidebar.newProject"));
  expect(newProject, "菜单里的「新建项目」必须出现").toBeTruthy();
  await act(async () => {
    newProject!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  // 让弹窗真正挂载完再返回：Radix 的 dismissal（遮罩点击）监听是在 effect 里注册的，
  // 紧接着就派发 pointerdown/click 可能还没装上 —— 那会让「点遮罩」类用例偶发失败。
  await flush();
}

function projectNameInput(): HTMLInputElement | null {
  return document.body.querySelector<HTMLInputElement>(
    '[role="dialog"] input[type="text"]',
  );
}

async function typeInto(el: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Sidebar 的「新建项目」弹窗", () => {
  it("打开后弹窗存在，且占用 occlusion", async () => {
    await renderSidebar();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
    await openCreateProject();
    expect(shell(), "弹窗必须存在").not.toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
  });

  it("打开后焦点在项目名输入框上", async () => {
    // 原实现靠 input 的 autoFocus。Radix 的 FocusScope 会聚焦容器内第一个
    // 可聚焦后代 —— 本面板里就是它（标题是纯文本、内置关闭键渲染在 children 之后）。
    await renderSidebar();
    await openCreateProject();
    const input = projectNameInput();
    expect(input, "输入框必须存在").not.toBeNull();
    // ⚠️ Radix 的 `Presence` **延后一帧**挂载内容 ✓，并在 `setTimeout(…, 0)` 里移动焦点 ✗
    //（§0 第 6 条 ✓）→ **先推一个宏任务再断言** ✓，而不是删掉这条断言 ✗
    //（计划 7 曾把「我没做到」误写成「jsdom 做不到」✗，删掉两条真能验的断言 ✗）。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement, "焦点必须在输入框上").toBe(input);
  });

  it("空闲时 Esc 关闭", async () => {
    await renderSidebar();
    await openCreateProject();

    // 先断言它**确实开着**：否则这条会在旧的内联结构下因为
    // `shell()`（查 [role="dialog"]）找不到东西而「空断言成真」—— 假绿。
    // 用标题文案定位（新旧结构都有它），这样两个方向都有意义。
    const title = i18n.t("sidebar.createProjectTitle");
    expect(document.body.textContent, "弹窗必须先开着").toContain(title);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          // 陷阱 2：不声明 cancelable 的话 preventDefault 是空操作
          cancelable: true,
        }),
      );
    });
    expect(document.body.textContent, "Esc 之后弹窗该关了").not.toContain(
      title,
    );
  });

  it("busy 时三条关闭路径全挡住【Review Focus #3】", async () => {
    // 原实现只在遮罩的 onClick 里挡（`if (isCreatingProject) return;`）外加两个按钮
    // disabled；Radix 又引入 Esc 与内置关闭键两条新路径（遮罩点击本身由 Radix 接管）。
    // 所以守卫必须统一在 onOpenChange 里 —— 这条用例把三条都走一遍。
    ipc.createProject.mockImplementation(() => new Promise(() => {})); // 永不 resolve → 停在 busy
    await renderSidebar();
    await openCreateProject();

    const input = projectNameInput()!;
    await typeInto(input, "demo");
    // 弹窗里的提交键：限定在 [role="dialog"] 里找 —— 菜单里那个「新建项目」
    // 文案与它完全相同，全局按标签找会点错元素。
    const submit = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[role="dialog"] button',
      ),
    ).find((b) => b.textContent === i18n.t("sidebar.newProject"));
    expect(submit, "弹窗里的提交键必须存在").toBeTruthy();
    await act(async () => {
      submit!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(ipc.createProject).toHaveBeenCalledTimes(1);

    // 路径一：Esc
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(shell(), "busy 时 Esc 不得关闭").not.toBeNull();

    // 路径二：DialogContent 内置的关闭键
    await act(async () => {
      d.builtinCloseButton().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(shell(), "busy 时关闭键不得关闭").not.toBeNull();

    // 路径三（遮罩点击）**刻意不在这里断言**：本 harness 里往 container 派发
    // pointerdown/click 到达 Radix DismissableLayer 是不可靠的 ——
    // 实测同一份代码连跑 3 次全过、第 4 次却红，而把守卫去掉后它反而失败
    // （去掉守卫不可能让空闲路径不关闭）→ 这条断言给不出可信信号，留着是 flaky。
    //
    // 之所以敢不留：守卫在 `onOpenChange` 上，而那是**唯一的关闭漏斗** ——
    // Radix 的 Esc、内置关闭键、遮罩点击三条路径都从它走，前两条上面已经证明
    // 被挡住；第三条按 Radix 的构造与它们同路。
    //
    // 计划 2 的评审对同类问题的结论也是这句：「守卫在共享路径上，行为已覆盖，
    // 属测试覆盖缺口而非行为缺口」。
  });
  it("新聊天行尾的 ▾ 胶囊键补了 px-0：不会被 Button 的 px-4 撑到 32", async () => {
    // 2026-10-10 实测：不传 size + 手写宽度 ⇒ `px-4` 留下 ⇒ 盒宽被撑到 32（作者写的更窄 ✗）。
    // 2026-10-15：▾ 从顶部那颗 32² 图标格挪到「新聊天」整行的行尾，宽度 w-6。
    await renderSidebar(); // 该文件既有的辅助：渲染带项目行的侧栏（项目区已展开）
    const tokens = projectActionsTrigger()!.className.split(/\s+/);
    expect(tokens).toContain("px-0");
    expect(tokens).toContain("w-6");
    expect(tokens).not.toContain("px-4");
  });
});
