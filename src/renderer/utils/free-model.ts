/**
 * 免费模型判定（纯展示层）。
 *
 * 数据来源只有模型 id / 名称：`-free`（opencode 端点）、`:free`（OpenRouter）、
 * 以及名称里独立出现的 Free。刻意不用子串匹配 —— `freedom` / `freestyle`
 * 这类词不该被当成免费模型。
 *
 * `free` 字段是给将来的权威标记留的入口：主进程若按注册表 cost 打标，
 * 直接传进来即可，优先级高于文本判定。
 */
const FREE_TOKEN = /(^|[^a-z])free([^a-z]|$)/i;

export interface FreeModelLike {
  id: string;
  name?: string;
  label?: string;
  free?: boolean;
}

export function isFreeModel(model: FreeModelLike): boolean {
  if (model.free === true) return true;
  const name = model.name?.trim() || model.label?.trim() || "";
  return FREE_TOKEN.test(model.id) || FREE_TOKEN.test(name);
}
