/**
 * @module renderer/hooks/useTtsPreview
 *
 * 「试听」的播放端。三档通用：快速 / 均衡走 sherpa，最佳音质由主进程把引擎的
 * 块攒成整句再返回（见 `tts.preview`）。
 *
 * 三条约束：
 *
 * 1. **一次只允许一个请求在飞**（`busy`）。引擎是串行的 —— 连点五下会排五次合成，
 *    第五段要等前四段跑完才出声，用户会以为坏了。
 * 2. **一个短命的 AudioContext**，卸载时 close。Chromium 对同时存在的 AudioContext
 *    有硬上限，浮层每开一次就 new 一个、不关，攒够了连 `new AudioContext()` 都会抛。
 * 3. 切档 / 再点 / 离开都先停上一个：试听重叠着播就是一段噪音。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TtsTone } from "../../shared/ipc-types";

export type TtsPreviewState = "idle" | "busy" | "playing";

export interface TtsPreview {
  state: TtsPreviewState;
  error: string | null;
  play(tone: TtsTone): Promise<void>;
  stop(): void;
}

export function useTtsPreview(): TtsPreview {
  const [state, setState] = useState<TtsPreviewState>("idle");
  const [error, setError] = useState<string | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  /**
   * 代数：每次 stop / 卸载都 +1。`play()` 在 await 之后核对它。
   *
   * 为什么必须有：`stop()` 只能停**已经建好**的 source，管不到还在飞的
   * `tts.preview()`。没有这道守卫，切档或离开设置页后 1–2 秒，旧档的声音会自己
   * 冒出来；卸载后那次 `new AudioContext()` 还会漏一个上下文（本文件头部警告的
   * Chromium 上限就是被这种漏法撞到的）。
   */
  const generation = useRef(0);
  /** 在飞的次数：用它挡住"连点"，也用它忽略迟到的响应。 */
  const inFlight = useRef(0);

  const stop = useCallback(() => {
    generation.current += 1; // 在飞的那次请求就此作废
    const source = sourceRef.current;
    sourceRef.current = null;
    if (source) {
      try {
        source.stop();
      } catch {
        // 已经停了
      }
    }
    setState("idle");
  }, []);

  useEffect(
    () => () => {
      generation.current += 1; // 卸载同样作废在飞请求
      const source = sourceRef.current;
      if (source) {
        try {
          source.stop();
        } catch {
          // 已经停了
        }
      }
      sourceRef.current = null;
      void contextRef.current?.close();
      contextRef.current = null;
    },
    [],
  );

  const play = useCallback(
    async (tone: TtsTone) => {
      if (inFlight.current > 0) return; // 一次只允许一个在飞
      stop();
      const myGeneration = generation.current;
      setError(null);
      inFlight.current += 1;
      setState("busy");
      try {
        const result = await window.electronAPI?.tts?.preview(tone);
        // 期间被停掉 / 切了档 / 组件已卸载 → 丢掉这次结果（别再建 AudioContext）
        if (generation.current !== myGeneration) return;
        if (!result) {
          setState("idle");
          return;
        }
        if (!result.ok) {
          setError(result.error);
          setState("idle");
          return;
        }
        const context = (contextRef.current ??= new AudioContext());
        if (context.state === "suspended") await context.resume();
        const buffer = context.createBuffer(
          1,
          result.samples.length,
          result.sampleRate,
        );
        // 用 getChannelData().set() 而不是 copyToChannel：后者在 TS 5.7 的
        // 泛型 TypedArray 下会把 ArrayBufferLike 判成不兼容
        buffer.getChannelData(0).set(result.samples);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = () => {
          // 只认当前那一个：切档时上一个的 onended 不该把新状态打回 idle
          if (sourceRef.current !== source) return;
          sourceRef.current = null;
          setState("idle");
        };
        sourceRef.current = source;
        source.start();
        setState("playing");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setState("idle");
      } finally {
        inFlight.current -= 1;
      }
    },
    [stop],
  );

  return { state, error, play, stop };
}
