/**
 * Minimal type declarations for proper-lockfile (transitive dependency of
 * @earendil-works/pi-coding-agent, no bundled types). Matches the API used
 * by the SDK's own auth storage.
 */
declare module "proper-lockfile" {
  interface LockOptions {
    realpath?: boolean;
    retries?: {
      retries?: number;
      factor?: number;
      minTimeout?: number;
      maxTimeout?: number;
      randomize?: boolean;
    };
    stale?: number;
    onCompromised?: (err: Error) => void;
  }

  /** Acquire an async lock; resolve with a release function. */
  export function lock(
    file: string,
    options?: LockOptions,
  ): Promise<() => Promise<void>>;

  /** Acquire a synchronous lock; returns a release function. */
  export function lockSync(file: string, options?: LockOptions): () => void;

  const lockfile: {
    lock: typeof lock;
    lockSync: typeof lockSync;
  };
  export default lockfile;
}
