/**
 * @module renderer/capabilities/install-queue
 *
 * 串行安装队列：同一时刻只有一个下载在跑，其余排队。
 *
 * 为什么串行：三行同时点会一起拉 ~335MB，进度条互相抢带宽，用户也读不出
 * "现在到底在下什么"。主进程那边的按模型守卫仍然是最后一道防线，这里只管排队。
 *
 * 队列**只在内存里**：应用退出即丢，下次进来按 install.json 回真实状态 ——
 * 渲染层不记任何持久化的"在装"。
 */
export interface InstallQueue {
  enqueue(id: string, run: () => Promise<void>): Promise<void>;
  /** 当前在飞的那个（没有则 null）。 */
  running(): string | null;
  /** 排队位次，1 起；在飞的不算排队，返回 null。 */
  position(id: string): number | null;
  subscribe(listener: () => void): () => void;
}

interface Pending {
  id: string;
  run: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export function createInstallQueue(): InstallQueue {
  const pending: Pending[] = [];
  let activeId: string | null = null;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const pump = (): void => {
    if (activeId !== null || pending.length === 0) return;
    const next = pending.shift();
    if (!next) return;
    activeId = next.id;
    emit();
    /**
     * 先清 activeId、再 resolve 调用方。
     *
     * 反过来的话（`run().then(resolve).finally(clear)`）调用方在
     * `await enqueue(...)` 之后读到的 `running()` 还是**它自己** —— `.finally` 比
     * 调用方的后续晚一拍。这不是理论：测试就是在这个断言上红的。
     */
    const finish = () => {
      activeId = null;
      emit();
      pump();
    };
    void (async () => {
      try {
        await next.run();
      } catch (error) {
        // 同步抛也要走同一条出口 —— 否则 `activeId` 永久卡住 = 队列死锁。
        finish();
        next.reject(error);
        return;
      }
      finish();
      next.resolve();
    })();
  };

  return {
    enqueue(id, run) {
      return new Promise<void>((resolve, reject) => {
        pending.push({ id, run, resolve, reject });
        emit();
        pump();
      });
    },
    running: () => activeId,
    position(id) {
      const index = pending.findIndex((item) => item.id === id);
      return index === -1 ? null : index + 1;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
