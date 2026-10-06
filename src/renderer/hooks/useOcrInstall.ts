/**
 * @module renderer/hooks/useOcrInstall
 *
 * OCR 的安装态订阅。与语音的 useVoiceEngine 同形，但没有「录制前确认」那一套 ——
 * OCR 只有设置面板一个入口。
 */
import { useEffect, useState } from "react";
import type { OcrInstallState } from "../../shared/ipc-types";

export function useOcrInstall(): { install: OcrInstallState | null } {
  const [install, setInstall] = useState<OcrInstallState | null>(null);

  useEffect(() => {
    const ocr = window.electronAPI?.ocr;
    if (!ocr) return;
    const unsubscribe = ocr.onEvent((event) => {
      if (event.type === "install") setInstall(event.state);
    });
    // 读不到就停在「未知」：面板显示未安装，点下载会再问一次主进程
    void ocr
      .getInstallState()
      .then(setInstall)
      .catch(() => {
        /* 未知态 */
      });
    return unsubscribe;
  }, []);

  return { install };
}
