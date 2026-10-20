import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import type { HostKeyDecision, KnownHostsStore } from "./types";

interface KnownHostEntry {
  fingerprint: string;
  firstSeenAt: string;
}

export class FileKnownHosts implements KnownHostsStore {
  private entries: Record<string, KnownHostEntry>;

  constructor(private readonly filePath: string) {
    this.entries = existsSync(filePath)
      ? (JSON.parse(readFileSync(filePath, "utf8")) as Record<
          string,
          KnownHostEntry
        >)
      : {};
  }

  private key(host: string, port: number): string {
    return `${host}:${port}`;
  }

  check(host: string, port: number, fingerprint: string): HostKeyDecision {
    const entry = this.entries[this.key(host, port)];
    if (!entry) return "unknown";
    return entry.fingerprint === fingerprint ? "trusted" : "mismatch";
  }

  trust(host: string, port: number, fingerprint: string): void {
    this.entries[this.key(host, port)] = {
      fingerprint,
      firstSeenAt: new Date().toISOString(),
    };
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2), {
      mode: 0o600,
    });
  }
}

/**
 * 进程内单例：适配器与 IPC 必须查同一份内存表。
 * 各自 new 一个会把「用户刚确认的指纹」丢在另一个实例里。
 */
let sharedKnownHosts: FileKnownHosts | null = null;

export function getKnownHosts(filePath: string): FileKnownHosts {
  if (!sharedKnownHosts) sharedKnownHosts = new FileKnownHosts(filePath);
  return sharedKnownHosts;
}
