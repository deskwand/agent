export class MemoryIngestionQueue {
  private readonly chains = new Map<string, Promise<unknown>>();

  enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) || Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.chains.set(key, next);
    void next
      .finally(() => {
        if (this.chains.get(key) === next) {
          this.chains.delete(key);
        }
      })
      .catch(() => undefined);
    return next;
  }
}
