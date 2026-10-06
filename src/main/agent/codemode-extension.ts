/**
 * codemode 扩展的装配。
 *
 * codemode 与 MCP **无关**（它调的是「标了 `codemode` exposure 的工具」，也能调 active 的 `direct` 工具，
 * 不关心工具来自哪）—— 所以本文件放在 `agent/` 而不是 `mcp/`。
 *
 * 两个刻意的选择：
 *
 * 1. **永远注册，由配置决定是否激活。** 上游的 codemode 是「registered inactive」设计
 *    （`extensions/codemode/index.d.ts`：要 `--tools` / `defaultTools` / `setActiveTools()` 才激活）。
 *    默认关时它注册进来但不进 active 集合 ⇒ 对现有行为零影响。
 *
 * 2. **激活走 `defaultTools: ["+codemode"]` 设置，而不是在工厂里 `setActiveTools`。**
 *    实测（`src/tests/agent/codemode-extension.test.ts`）：会话初始化会**从注册表重算** active 集合
 *    （`agent-session.js` 的 `_isActivatedOnRegistration`：`_isDeclarable(name) && defaultActive !== false`），
 *    这个重算发生在**扩展工厂之后** ⇒ 工厂里调的 `setActiveTools` **会被覆盖**。
 *    `defaultTools` 是会话初始化的一部分，不会被盖掉，也正是上游文档给的激活方式
 *    （`docs/settings.md`：`{"defaultTools": ["+codemode"]}`）。
 *    （MCP 扩展之所以能在运行时 `setActiveTools`，是因为它在**建连完成后**才调，那时重算早已过去。）
 *
 * 不传 `models` —— 跟随上游默认（`true`）。要关掉是显式偏离，见 `shared/codemode-config.ts` 的说明。
 */
import {
  createCodemodeExtension,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { CODEMODE_INLINE_BUDGET } from "../../shared/codemode-config";
import { configStore } from "../config/config-store";
import { log } from "../utils/logger";

export function createDeskwandCodemodeExtension(): ExtensionFactory {
  const config = configStore.get("codemode");
  const inner = createCodemodeExtension({
    mode: config.mode,
    // 固定 0：不内联工具签名，模型在脚本里用 searchTools() 现场找
    //（见 shared/codemode-config.ts）。
    inlineBudget: CODEMODE_INLINE_BUDGET,
    // 刻意不传 `models`：pi 默认 true，即把模型目录/分类器 API（`models.classify` 等）
    // 声明进 codemode 描述、并注入脚本沙盒。**这两千字符是留着的**，因为后续要接分类器
    // （脚本里把数据丢给分类器模型批量打标，不占主对话上下文）。
    // 体检数据与取舍见 design-docs/2026-10-06-tool-exposure-slim-design.md 的「codemode 描述体检」。
  });

  log(`[codemode] registered (mode=${config.mode})`);
  return inner;
}
