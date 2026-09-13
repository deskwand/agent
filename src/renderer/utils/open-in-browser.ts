import { toFileUrl } from "../../shared/local-file-path";
import { useAppStore } from "../store";

/**
 * 用内置浏览器打开一个本地绝对路径。
 *
 * 两件必须在这里做、不能指望调用方知道的事：
 * 1. 用户主动点击的语义是「无条件打开」：即使此前手动关过浏览器面板也要切回来，
 *    因此显式切面板，而不是依赖 App.tsx 的 onStateChanged 自动开面板
 *    （后者会被 browserDismissedRef 抑制）。
 * 2. 整页视图（密库、设置、应用、日程、diff 评审、配置弹窗）下右侧面板不渲染、
 *    WebContentsView 也会被 hide()，所以必须先切回 chat，否则点击「什么都不会发生」。
 *
 * 入参契约：绝对路径。传进来非绝对路径（例如工作目录未设置时拼出的
 * "null/foo.pdf"）时 `toFileUrl` 返回 null，本函数静默返回 —— 这类输入在改动前
 * 同样打不开（预览会读取失败、showItemInFolder 也会失败），不值得为它在这里
 * 引入 i18n 依赖（那会把 i18n/config 拉进所有组件测试的模块图）。
 */
export function openFilePathInBrowser(filePath: string): void {
  const url = toFileUrl(filePath);
  if (!url) {
    return;
  }

  const store = useAppStore.getState();
  if (store.activeView !== "chat") {
    store.setActiveView("chat");
  }
  if (store.rightPanelMode !== "browser") {
    store.toggleBrowserPanel();
  }

  // browser.navigate 永不 reject（主进程返回的是状态快照）；
  // 加载失败由面板内的 did-fail-load 提示呈现。
  void window.electronAPI?.browser.navigate(url);
}
