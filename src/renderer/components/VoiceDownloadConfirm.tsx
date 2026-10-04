/**
 * @module renderer/components/VoiceDownloadConfirm
 *
 * 「要不要下 140MB 的语音模型」这一问。文案只在这里，两个宿主各渲染一行。
 *
 * 不加 Esc / 点遮罩关闭：要花 140MB 的决定，要求一个明确答复。
 */
import { useTranslation } from "react-i18next";
import type { VoiceEngine } from "../hooks/useVoiceEngine";
import { ConfirmDialog } from "./ConfirmDialog";

export function VoiceDownloadConfirm({ engine }: { engine: VoiceEngine }) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      isOpen={engine.confirmOpen}
      title={t("chat.voiceDownloadConfirm")}
      confirmLabel={t("chat.voiceDownloadConfirmOk")}
      tone="primary"
      onConfirm={engine.confirmDownload}
      onCancel={engine.cancelDownload}
    />
  );
}
