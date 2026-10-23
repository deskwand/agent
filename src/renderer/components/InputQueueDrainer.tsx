import { useEffect } from "react";
import { useIPC } from "../hooks/useIPC";
import { useAppStore } from "../store";
import { drainIdleInputQueues } from "../utils/input-queue-drain";

/**
 * 排队区自动出队器（无 UI）。
 *
 * 挂载点必须在**视图之外**（App 根节点）：排队属于会话，不属于当前视图。
 * 早先这段自动出队逻辑写在 ChatView 的 effect 里，结果是只有正在显示的会话
 * 会推进队列 —— 用户切到别的会话或设置/应用页时，排队项就卡住，得切回该
 * 会话才继续跑。挪到这里之后，任何会话只要回合结束回到 idle，队列就接着跑。
 *
 * 这里故意用 store 的 imperative subscribe 而不是选择器：这个组件不渲染任何
 * 东西，不需要跟着流式 token 重渲染。出队检查按 microtask 合并，避免高频
 * set（流式增量）触发成串扫描。
 */
export function InputQueueDrainer() {
  const { continueSession } = useIPC();

  useEffect(() => {
    let scheduled = false;
    let disposed = false;

    const run = () => {
      scheduled = false;
      if (disposed) return;
      drainIdleInputQueues(continueSession);
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(run);
    };

    const unsubscribe = useAppStore.subscribe(schedule);
    // 挂载时补一次：mount 之前 store 里可能已经有排队项（首屏快照、开发热更新）
    schedule();

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [continueSession]);

  return null;
}
