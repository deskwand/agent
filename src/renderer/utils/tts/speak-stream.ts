/**
 * @module renderer/utils/tts/speak-stream
 *
 * 流式朗读的渲染层原语：调 IPC、按 streamId 过滤块、把取消传到主进程。
 *
 * **朗读与语音对话共用它** —— 两份实现就是两份各写一遍的过滤与取消。
 *
 * 时序上有一点要小心：`streamId` 是主进程分配的，而块是**推**过来的。所以先订阅
 * 再 invoke；invoke 返回之前的块一律丢弃（主进程只在 handler 返回后才可能推块，
 * 所以这是纯防御）。
 */
import type {
  TtsSpeakOptions,
  TtsStreamEvent,
} from "../../../shared/ipc-types";

export interface SpeakStreamChunk {
  samples: Float32Array;
  sampleRate: number;
}

export interface SpeakStreamHandlers {
  onChunk(chunk: SpeakStreamChunk): void;
  onDone(): void;
  onError(error: string): void;
}

/**
 * 开始一次流式合成。返回**取消函数**：解订阅 + 让主进程停止合成。
 * 取消之后不会再触发任何 handler。
 */
export function speakStream(
  text: string,
  opts: TtsSpeakOptions | undefined,
  handlers: SpeakStreamHandlers,
): () => void {
  const tts = window.electronAPI?.tts;
  if (!tts?.speakStream || !tts.onStream) {
    // **同步**报错（调用方必须容忍：不许在赋值前用返回的取消函数）。
    handlers.onError("tts streaming unavailable");
    return () => {};
  }

  /**
   * 已经收到终态（done / error）。终态之后一律不再取消：主进程那边这个流已经
   * 结束，再发 `cancelStream` 只会往它的 `cancelled` 集合里塞一个永不清理的 id
   * （那儿的清理挂在流自己的 finally 上）。
   */
  let finished = false;

  let streamId: number | null = null;
  let cancelled = false;

  const unsubscribe = tts.onStream((event: TtsStreamEvent) => {
    if (cancelled) return;
    if (streamId === null || event.streamId !== streamId) return; // 不是自己这个流
    if (event.type === "chunk") {
      handlers.onChunk({
        samples: event.samples,
        sampleRate: event.sampleRate,
      });
      return;
    }
    unsubscribe();
    finished = true;
    if (event.type === "done") handlers.onDone();
    else handlers.onError(event.error);
  });

  void tts
    .speakStream(text, opts)
    .then((result) => {
      streamId = result.streamId;
      // 在 invoke 返回之前就被取消：这时才知道 id，补上取消（否则那句会在主进程
      // 里白合成到底）。
      if (cancelled && !finished) void tts.cancelStream?.(streamId);
    })
    .catch((error: unknown) => {
      if (cancelled) return;
      unsubscribe();
      finished = true;
      handlers.onError(error instanceof Error ? error.message : String(error));
    });

  return () => {
    cancelled = true;
    unsubscribe();
    if (streamId !== null && !finished) void tts.cancelStream?.(streamId);
  };
}
