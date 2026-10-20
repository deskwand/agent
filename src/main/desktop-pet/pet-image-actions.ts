import type { PetCustomImageConfig } from "../../shared/pet-appearance";
import {
  PetImageError,
  type PetImageErrorCode,
  type PetImageStore,
} from "./pet-image";

export interface PetImageActions {
  choose(sourcePath: string): Promise<void>;
  remove(): Promise<void>;
}

/**
 * 选图/移除的编排逻辑：写文件 → 写配置 → 刷新窗口 → 清理旧文件。
 *
 * 单独成模块是为了能直接注入假实现，测到顺序与失败清理——
 * 这些保证是 spec 的 Review Focus，不适合只靠手工验收。
 */
export function createPetImageActions({
  store,
  getCustomImage,
  setCustomImage,
  refreshAppearance,
  showError,
  logError,
}: {
  store: Pick<PetImageStore, "choose" | "remove">;
  getCustomImage: () => PetCustomImageConfig | null;
  setCustomImage: (value: PetCustomImageConfig | null) => void;
  refreshAppearance: () => void;
  showError: (code: PetImageErrorCode) => void | Promise<void>;
  logError: (message: string, error: unknown) => void;
}): PetImageActions {
  return {
    async choose(sourcePath) {
      try {
        const { fileName } = await store.choose(sourcePath);
        const previous = getCustomImage();
        try {
          setCustomImage({ fileName, enabled: true });
        } catch (error) {
          // 配置没写成，别留下一个没有引用的新文件。
          await store.remove(fileName);
          throw error;
        }
        refreshAppearance();
        if (previous && previous.fileName !== fileName) {
          await store.remove(previous.fileName);
        }
      } catch (error) {
        const code =
          error instanceof PetImageError ? error.code : "write-failed";
        if (!(error instanceof PetImageError)) {
          logError("[DesktopPet] image import failed:", error);
        }
        await showError(code);
      }
    },

    async remove() {
      const previous = getCustomImage();
      setCustomImage(null);
      refreshAppearance();
      if (previous) await store.remove(previous.fileName);
    },
  };
}
