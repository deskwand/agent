import type { ModelOptionGroup } from "../components/ChatInputBottomBar";

/**
 * 当前选中模型的显示名：按 profileKey 限定分组查找 label（如云模型的真实模型 id），
 * 找不到回退 model id。多 provider 可能含同名模型 id，必须先定位分组避免串组。
 */
export function resolveModelLabel(
  modelOptions: ModelOptionGroup[],
  profileKey: string,
  model: string,
): string {
  return (
    modelOptions
      .find((g) => g.profileKey === profileKey)
      ?.items.find((item) => item.id === model)?.name ?? model
  );
}

/**
 * provider 的显示名（模型菜单分组标题、subagent 的 provider 选择器共用）。
 *
 * 云 provider 的 name 是登录/启动时按当时语言写进配置的普通字符串
 * （见 buildDeskwandProviderPayload），切语言不会重建它，所以这里按 profileKey
 * 实时取 i18n 文案覆盖；其余 provider 沿用配置里的名字——用户自己填的名字必须原样保留。
 * 返回 undefined 时由调用方走各自的兜底文案。
 */
export function resolveProviderDisplayName(
  profileKey: string,
  storedName: string | undefined,
  t: (key: string, opts?: { defaultValue: string }) => string,
): string | undefined {
  if (profileKey === "custom:deskwand") {
    return t("providers.deskwandCloud", { defaultValue: "DeskWand 云" });
  }
  return storedName;
}
