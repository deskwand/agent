import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MAX_IDEA_BODY_CODE_POINTS } from "../../shared/ideas";
import { useAppStore } from "../store";
import { captureShortcutLabel } from "../utils/capture-shortcut-label";
import {
  IDEA_CAPTURE_VOICE_OWNER,
  isVoiceHeldElsewhere,
} from "../utils/voice/voice-owner";
import { usePushToTalk } from "../hooks/usePushToTalk";
import { useVoiceEngine } from "../hooks/useVoiceEngine";
import { useVoiceInput, VOICE_MESSAGE_KEYS } from "../hooks/useVoiceInput";
import { VoiceDownloadConfirm } from "./VoiceDownloadConfirm";
import { toMicButtonProps, VoiceMicButton } from "./VoiceMicButton";
import { Button } from "./app-button";
import { OccludingDialog } from "./ui/occluding-dialog";
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

/**
 * 记一笔：一个浮层、一个 textarea，Enter 存下。
 *
 * 刻意压在这上面而不是占用聊天输入框 —— 记东西不该打断正在进行的会话。
 * 失败时**不关浮层**：写了半段的想法因为一次 IO 抖动消失，比报错本身糟得多。
 *
 * 关闭键由 DialogContent 自带的那个承担，这里不另画一个（两个关闭入口只是噪音）。
 */
export function IdeaCaptureOverlay(): JSX.Element {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.ideaCaptureOpen);
  const close = useAppStore((s) => s.closeIdeaCapture);
  const loadIdeas = useAppStore((s) => s.loadIdeas);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeView = useAppStore((s) => s.activeView);
  const appConfig = useAppStore((s) => s.appConfig);
  const voiceInputOwner = useAppStore((s) => s.voiceInputOwner);
  const setVoiceInputOwner = useAppStore((s) => s.setVoiceInputOwner);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  // 语音那边读的是**实时值**，不能给快照：整理结果回来时要按当前草稿决定写不写。
  const textRef = useRef(text);
  textRef.current = text;

  const notifyVoiceError = useCallback(
    (key: string) => {
      setGlobalNotice({
        id: `idea-voice-${key}`,
        type: "error",
        message: t(key),
        messageKey: key,
      });
    },
    [setGlobalNotice, t],
  );

  const voiceEngine = useVoiceEngine({
    onEnableFailed: () => notifyVoiceError("chat.voiceEnableFailed"),
  });
  const voice = useVoiceInput({
    ensureReady: voiceEngine.ensureReady,
    autoPolish: appConfig?.voiceEngine?.autoPolish !== false,
    getSnapshot: () => textRef.current,
    onText: (next) => setText(next),
    onRestore: (snapshot) => setText(snapshot),
    onError: (code) => notifyVoiceError(VOICE_MESSAGE_KEYS[code]),
  });

  // 录音中组件卸载，必须自己收尾：`useVoiceInput` 只在 stop / cancel / 报错路径里停
  // 采集，卸载不在其中 —— 而浮层一个 Esc 就会卸载，这条路径必然会被走到。
  // ⚠️ 依赖数组必须是 `[]`：`useVoiceInput` 每次渲染都返回新对象，依赖它会让清理函数
  // **每渲染一次就跑一次** —— 而录音期间 setLevel / onText 一直在触发渲染，等于刚开录
  // 就被自己取消。状态与 cancel 都放进 ref 读最新值。
  const voiceStatusRef = useRef(voice.status);
  voiceStatusRef.current = voice.status;
  const voiceCancelRef = useRef(voice.cancel);
  voiceCancelRef.current = voice.cancel;

  // 占用 / 释放麦克风：全应用同一时刻只允许一个占用者（规则见 utils/voice/voice-owner）。
  // 占用覆盖 requesting / recording / finishing —— 收尾期间主进程会话还在、引擎还在
  // 吐尾巴，这时放开会让别处在"上一路没结束"时开第二路。
  const holdsMic = voice.status !== "idle";
  useEffect(() => {
    if (!holdsMic) return;
    setVoiceInputOwner(IDEA_CAPTURE_VOICE_OWNER);
    return () => {
      // 只释放自己那份：清理晚到一步时别把接手的那一路的占用误删。
      if (useAppStore.getState().voiceInputOwner === IDEA_CAPTURE_VOICE_OWNER) {
        setVoiceInputOwner(null);
      }
    };
  }, [holdsMic, setVoiceInputOwner]);
  useEffect(
    () => () => {
      if (voiceStatusRef.current !== "idle") void voiceCancelRef.current();
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    setText("");
    setBusy(false);
    // 焦点要落在框里：浮层的全部价值就是"打开就能写"。
    const id = window.setTimeout(() => boxRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // `blocked` 是上一帧的读数：同帧里被别处抢走时再确认一次，别开第二路。
  const guardedToggle = () => {
    if (
      isVoiceHeldElsewhere(
        useAppStore.getState().voiceInputOwner,
        IDEA_CAPTURE_VOICE_OWNER,
      )
    ) {
      return;
    }
    voice.toggle();
  };

  // 按住说话。按钮与按键走**同一条路**（都过 `guardedToggle`），让路规则也共用一份。
  //
  // ⚠️ 这一格必须自己接住：`ChatView` 与 `WelcomeView` 都在浮层打开时主动让路
  // （`!ideaCaptureOpen`，见那两处的注释）—— 也就是说这条链上其他人都退开了，而这里
  // 原来没有注册监听，于是「按住右 Option」整条链上**没有任何人响应**：2026-10-11 实测
  // 按住毫无反应、只有鼠标点得动那颗麦克风。而浮层的麦克风气泡**会**显示这个键位
  // （`toMicButtonProps` 的 `shortcutKeys`），界面承诺了却没实现。
  const pushToTalkOwns = useRef(false);
  usePushToTalk(
    appConfig?.voiceEngine?.shortcut ?? "disabled",
    {
      onStart: () => {
        if (voice.status !== "idle") return;
        pushToTalkOwns.current = true;
        guardedToggle();
      },
      onStop: () => {
        if (!pushToTalkOwns.current) return;
        pushToTalkOwns.current = false;
        if (voice.status === "recording") guardedToggle();
      },
    },
    // 浮层关着时不监听：那时聊天框那两路正在监听，开了就是两路抢同一支麦克风。
    open &&
      appConfig?.voiceEngine?.enabled === true &&
      // 别人占着就让开；**自己占着不算**（否则 keydown 把自己变成占用者 → enabled 翻假
      // → `usePushToTalk` 重订阅丢掉 holding → 松手停不下来，见 voice-owner.ts 的说明）。
      !isVoiceHeldElsewhere(voiceInputOwner, IDEA_CAPTURE_VOICE_OWNER),
  );

  const length = useMemo(() => Array.from(text).length, [text]);
  const tooLong = length > MAX_IDEA_BODY_CODE_POINTS;
  // 录音中禁发：半截转写不该落盘。
  const canSave =
    text.trim().length > 0 && !tooLong && !busy && voice.status === "idle";

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      await window.electronAPI.ideas.create({
        content: text.trim(),
        // 来源会话只在聊天视图里才有意义；别处记的想法没有"当时在聊什么"。
        sourceSessionId: activeView === "chat" ? activeSessionId : null,
        sourceView: activeView,
      });
      close();
      void loadIdeas();
      setGlobalNotice({
        id: "idea-created",
        type: "success",
        message: t("capture.saved"),
        messageKey: "capture.saved",
      });
    } catch {
      // 不关、不清：正文一个字都不能丢。
      setGlobalNotice({
        id: "idea-failed",
        type: "error",
        message: t("capture.failed"),
        messageKey: "capture.failed",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <OccludingDialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="max-w-[560px]"
        // 录音中 Esc 归麦克风：否则同一个 Esc 既取消录音又关浮层（设计 §7.3）。
        // 注意这属性属于 DismissableLayer —— 挂在 Dialog（Root）上是不生效的。
        onEscapeKeyDown={(event) => {
          if (voice.status !== "idle") event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            {t("capture.title")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("capture.subtitle")}
          </DialogDescription>
        </DialogHeader>

        <textarea
          ref={boxRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            // 中文输入法组合期间 Enter 是确认候选，必须放行。`keyCode === 229` 也要挡：
            // Windows 输入法提交候选词的那一次 Enter 有时 `isComposing` 已经是 false
            // （ChatInput 的 Enter 处理用的是同一对判断）。
            if (
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            ) {
              return;
            }
            event.preventDefault();
            void save();
          }}
          className="min-h-[96px] w-full resize-none rounded-md border border-border bg-muted p-3 text-sm outline-none"
        />

        <div className="flex items-center gap-3">
          <VoiceMicButton
            {...toMicButtonProps(
              { ...voice, toggle: guardedToggle },
              voiceEngine.install,
              {
                config: appConfig?.voiceEngine,
                platform: window.electronAPI?.platform,
                t,
              },
              isVoiceHeldElsewhere(voiceInputOwner, IDEA_CAPTURE_VOICE_OWNER),
            )}
          />
          <span className="text-xs text-muted-foreground">
            {tooLong
              ? t("capture.tooLong")
              : t("capture.hint", {
                  keys: captureShortcutLabel(window.electronAPI?.platform),
                })}
          </span>
          <span className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={close}>
              {t("capture.cancel")}
            </Button>
            <Button disabled={!canSave} onClick={() => void save()}>
              {t("capture.save")}
            </Button>
          </span>
        </div>
      </DialogContent>

      {/* 模型没装时这一次问询叠在浮层上（嵌套 Dialog）。 */}
      <VoiceDownloadConfirm engine={voiceEngine} />
    </OccludingDialog>
  );
}
