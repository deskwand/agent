/**
 * @module renderer/components/message/AskUserVoiceField
 *
 * ask_user 卡片里的一个自由输入框：输入框 + 右侧内嵌的麦克风。
 *
 * **一个字段一个 `useVoiceInput` 实例**，所以「点哪录哪」是结构事实：没有「当前录音
 * 目标是哪个框」这种状态，也没有值的第二份镜像。`getSnapshot` 直接闭包读这次的
 * `value` —— hook 每次渲染都会刷新它手里的 optionsRef，闭包读到的就是最新值。
 *
 * 两条必须记住的：
 *  1. **卸载要自己收。** 卡片会被窗口化卸载（切到别的视图、滚出 400 条渲染窗口、
 *     收起「其他…」），而 `useVoiceInput` 卸载时不停采集、也不 cancel 主进程会话
 *     （它只清整理计时器），Esc 监听器同样随卸载消失 —— 不收就是系统录音灯常亮
 *     且用户没有任何办法停它。
 *  2. **录音期间输入框保持可编辑**：实时转写就是它。
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { useVoiceEngine } from "../../hooks/useVoiceEngine";
import {
  VOICE_MESSAGE_KEYS,
  useVoiceInput,
  type VoiceStatus,
} from "../../hooks/useVoiceInput";
import { isVoiceHeldElsewhere } from "../../utils/voice/voice-owner";
import { VoiceDownloadConfirm } from "../VoiceDownloadConfirm";
import { VoiceMicButton } from "../VoiceMicButton";
import { Input } from "../ui/input";

/** "其他…" 与 text 题共用同一份上限，与工具侧校验保持一致。 */
const ASK_USER_INPUT_MAX_LENGTH = 2000;

/** 从 AskUserCard 原样搬来（两个自由输入框现在都归本组件渲染）。 */
const INPUT_BASE =
  "w-full rounded-lg border border-border/40 bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none h-auto shadow-none";

export interface AskUserVoiceFieldProps {
  /** 占用者 id：`ask-user:<toolCallId>:<text|other>:<index>`。 */
  ownerId: string;
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
  /** false = 卡片还没挂起 / 已锁定：输入框只读，麦克风整个不渲染。 */
  interactive: boolean;
}

export function AskUserVoiceField({
  ownerId,
  value,
  onChange,
  placeholder,
  interactive,
}: AskUserVoiceFieldProps) {
  const { t } = useTranslation();
  const voiceOwner = useAppStore((s) => s.voiceInputOwner);
  const setVoiceInputOwner = useAppStore((s) => s.setVoiceInputOwner);
  const voiceModeOpen = useAppStore((s) => s.voiceModeOpen);
  // 读不到配置时按「开」处理：录音本身要求 enabled === true，而那个值来自同一份配置。
  const autoPolish = useAppStore(
    (s) => s.appConfig?.voiceEngine?.autoPolish !== false,
  );
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);

  const noticeSeqRef = useRef(0);
  const notify = (
    messageKey: string,
    type: "warning" | "error" | "success",
  ) => {
    noticeSeqRef.current += 1;
    setGlobalNotice({
      // ownerId 进 id：同一张卡两个字段同时报错也不撞 key。
      id: `${ownerId}-${noticeSeqRef.current}`,
      type,
      message: t(messageKey),
      // 一起传 messageKey：切语言后提示跟着变（与 ChatView / WelcomeView 同一套约定）。
      messageKey,
    });
  };

  // 就绪判定、安装态、下载确认都在这里（与聊天框同一个 hook）。
  const voiceEngine = useVoiceEngine({
    onReady: () => notify("chat.voiceReady", "success"),
    onEnableFailed: () => notify("chat.voiceEnableFailed", "error"),
  });

  /** 程序化写值绕过 DOM 的 maxLength，所以上限必须在这里自己兜（主进程不校验长度）。 */
  const write = (text: string) =>
    onChange(text.slice(0, ASK_USER_INPUT_MAX_LENGTH));

  const voice = useVoiceInput({
    ensureReady: voiceEngine.ensureReady,
    autoPolish,
    // 实时读取，不是快照：不要缓存它。
    getSnapshot: () => value,
    onText: write,
    onRestore: write,
    onError: (code) => notify(VOICE_MESSAGE_KEYS[code], "error"),
  });

  // 占用 / 释放。占用覆盖 requesting / recording / finishing —— 收尾期间主进程会话
  // 还在、引擎还在吐尾巴，这时放开会让别处在「上一路没结束」时开第二路。
  const holdsMic = voice.status !== "idle";
  useEffect(() => {
    if (!holdsMic) return;
    setVoiceInputOwner(ownerId);
    return () => {
      // 只释放自己那份：清理晚到一步时别把接手的那一路的占用误删。
      if (useAppStore.getState().voiceInputOwner === ownerId) {
        setVoiceInputOwner(null);
      }
    };
  }, [holdsMic, ownerId, setVoiceInputOwner]);

  // 卸载即收（卡片会被窗口化卸载，见模块头注释）。status 走 ref：
  // 挂载时建的清理闭包读不到之后的状态，而空依赖数组才拦得住「每次 status 变化都收一次」。
  const statusRef = useRef<VoiceStatus>(voice.status);
  statusRef.current = voice.status;
  const cancelRef = useRef(voice.cancel);
  cancelRef.current = voice.cancel;
  useEffect(
    () => () => {
      if (statusRef.current !== "idle") void cancelRef.current();
    },
    [],
  );

  // 锁定（提交）后这一格不再可交互，录音也一并收掉 —— 不把「提交被禁」当成唯一保证。
  useEffect(() => {
    if (!interactive && statusRef.current !== "idle") void cancelRef.current();
  }, [interactive]);

  const blocked = isVoiceHeldElsewhere(voiceOwner, ownerId) || voiceModeOpen;
  // 麦克风恒占 36px（录音中也是同一个按钮，只换图标），所以右让位宽度不再随状态变：
  // 以前胶囊宽 80px 要写 pr-20，现在恒定 pr-11。
  const inputClassName = `${INPUT_BASE} pr-11`;

  return (
    <div className="relative">
      <Input
        type="text"
        disabled={!interactive}
        maxLength={ASK_USER_INPUT_MAX_LENGTH}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={inputClassName}
      />
      {interactive && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2">
          <VoiceMicButton
            status={voice.status}
            polishing={voice.polishing}
            install={voiceEngine.install}
            blocked={blocked}
            onToggle={() => {
              // `blocked` 是上一帧的 props：同帧里被别处抢走时再确认一次，别开第二路。
              if (
                isVoiceHeldElsewhere(
                  useAppStore.getState().voiceInputOwner,
                  ownerId,
                )
              ) {
                return;
              }
              voice.toggle();
            }}
          />
        </div>
      )}
      {/* 关着时整个不挂载：一张卡可能有两个字段，各挂一份弹窗没必要。 */}
      {voiceEngine.confirmOpen && <VoiceDownloadConfirm engine={voiceEngine} />}
    </div>
  );
}
