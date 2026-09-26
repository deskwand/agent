import type { AppConfig } from "../../types";

/**
 * 成功提示要展示的「通道 · 模型」；返回 null 表示"还不能提示"。
 *
 * 一次连接会推两个 config.status 快照（saveProvider、setActiveProvider），而
 * saveProvider 不动 activeProviderKey —— fresh install 上第一个快照仍然指向默认的
 * "openrouter"，那时读不到 provider，直接提示就会得到「已连接 openrouter · 」。
 * 所以只有 activeProviderKey 真指向一个带 defaultModel 的 provider 才算就绪。
 */
export function connectionNoticeValues(
  config: AppConfig | null,
): { provider: string; model: string } | null {
  if (!config) return null;
  const activeKey = config.activeProviderKey;
  const provider = activeKey ? config.providers[activeKey] : undefined;
  if (!provider?.defaultModel) return null;
  return {
    provider: provider.name || String(activeKey || ""),
    model: provider.defaultModel,
  };
}
