import { useTranslation } from "react-i18next";
import { useCapabilityGate } from "../hooks/useCapabilityGate";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * 共享的下载确认弹窗：一次只可能有一个（prompt 是单例槽），内容按那一行选。
 *
 * 只在 `App` 根渲染一处 —— 多处渲染就多处能叠。
 * 麦克风那条路仍用它自己的 `VoiceDownloadConfirm`（本次不迁移）。
 */
export function CapabilityDownloadConfirm(): JSX.Element {
  const { t } = useTranslation();
  const gate = useCapabilityGate();
  return (
    <ConfirmDialog
      isOpen={gate.prompt !== null}
      title={
        gate.prompt === "voice"
          ? t("capabilityIntro.confirm.voice")
          : // 语音输入那条一直就是这句话（复用，不新写）。
            // 今天只有 "voiceInput" 与 "voice" 两个 prompt 来源（ocr 没有任何入口会
            // 调 ensureReady），所以这里不需要第三条文案。
            t("chat.voiceDownloadConfirm")
      }
      confirmLabel={t("chat.voiceDownloadConfirmOk")}
      tone="primary"
      onConfirm={() => void gate.confirmDownload()}
      onCancel={gate.cancelPrompt}
    />
  );
}
