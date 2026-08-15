import type { ModelOptionGroup } from "../components/ChatInputBottomBar";

/**
 * 当前选中模型的显示名：按 profileKey 限定分组查找 label（如「标准」「编程」），
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
