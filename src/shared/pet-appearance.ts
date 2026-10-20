import { isPetCharacter, type PetCharacter } from "./pet-characters";

/** 自定义桌宠图片的持久化配置；只存文件名，文件在 <userData>/desktop-pet/。 */
export interface PetCustomImageConfig {
  fileName: string;
  enabled: boolean;
}

/** 主进程 → pet 窗口的完整外观；image 非空时使用自定义图片。 */
export interface PetAppearance {
  character: PetCharacter;
  image: string | null;
}

/** 与 pet-image.ts 的落盘命名保持一致：custom-<ts>[-n].<ext>。 */
const CUSTOM_IMAGE_FILE_NAME = /^custom-\d+(?:-\d+)?\.(?:png|jpg|gif|webp)$/;

export function isSafePetImageFileName(value: unknown): value is string {
  return typeof value === "string" && CUSTOM_IMAGE_FILE_NAME.test(value);
}

/** 配置可能被手改：非法值一律降级为“没有自定义图片”。 */
export function normalizePetCustomImage(
  value: unknown,
): PetCustomImageConfig | null {
  if (!value || typeof value !== "object") return null;
  const { fileName, enabled } = value as {
    fileName?: unknown;
    enabled?: unknown;
  };
  if (!isSafePetImageFileName(fileName)) return null;
  return { fileName, enabled: enabled === true || enabled === 1 };
}

export function isPetAppearance(value: unknown): value is PetAppearance {
  if (!value || typeof value !== "object") return false;
  const { character, image } = value as {
    character?: unknown;
    image?: unknown;
  };
  return (
    isPetCharacter(character) && (image === null || typeof image === "string")
  );
}

export async function resolvePetAppearance({
  character,
  customImage,
  readImage,
}: {
  character: PetCharacter;
  customImage: PetCustomImageConfig | null;
  readImage: (fileName: string) => Promise<string | null>;
}): Promise<PetAppearance> {
  if (!customImage?.enabled) return { character, image: null };
  // 文件丢了/读坏了都不该阻塞窗口：回落到内置角色，配置留给用户手动清理。
  const image = await readImage(customImage.fileName).catch(() => null);
  return { character, image };
}
