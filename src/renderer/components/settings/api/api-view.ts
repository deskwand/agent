/**
 * API 设置的三层视图状态机（列表 → 目录 → 添加/详情）。
 *
 * 纯函数、不持状态：交给 SettingsAPI 的 useState 存，好处是路由规则可单测，
 * 也避免把「返回目标」散进各个组件的 props。
 */
import type { ProviderProfileKey } from "../../../types";
import type { ProviderCatalogEntry } from "../provider-catalog";

/** 四个 tab 的值；returnTo 只影响返回落点，不影响页面内容。 */
export type ApiTabValue = "main" | "vision" | "search" | "utility";

export type ApiView =
  | { kind: "list" }
  | { kind: "catalog"; returnTo: ApiTabValue }
  | { kind: "add"; entry: ProviderCatalogEntry; returnTo: ApiTabValue }
  | { kind: "detail"; profileKey: ProviderProfileKey; returnTo: ApiTabValue };

export const API_VIEW_LIST: ApiView = { kind: "list" };

export function openCatalog(returnTo: ApiTabValue): ApiView {
  return { kind: "catalog", returnTo };
}

export function pickCatalogEntry(
  view: ApiView,
  entry: ProviderCatalogEntry,
): ApiView {
  if (view.kind !== "catalog") return view;
  return { kind: "add", entry, returnTo: view.returnTo };
}

export function backFrom(view: ApiView): ApiView {
  if (view.kind === "add") return { kind: "catalog", returnTo: view.returnTo };
  return API_VIEW_LIST;
}

export function openDetail(
  profileKey: ProviderProfileKey,
  returnTo: ApiTabValue,
): ApiView {
  return { kind: "detail", profileKey, returnTo };
}
