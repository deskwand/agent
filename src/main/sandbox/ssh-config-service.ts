import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { configStore } from "../config/config-store";
import type { KnownHostsStore, SshHostConfig } from "./types";
import { SshConnection } from "./ssh-connection";
import { ensureAppKey } from "./ssh-app-key";

/** 用于建连的私钥内容：指定私钥优先，否则用应用自持密钥。 */
export function readHostPrivateKey(
  host: SshHostConfig,
  appKeyPath: string,
): string {
  return readFileSync(
    host.authMode === "key" && host.privateKeyPath
      ? host.privateKeyPath
      : appKeyPath,
    "utf8",
  );
}

export class SshConfigService {
  listHosts(): SshHostConfig[] {
    return configStore.get("sshHosts") ?? [];
  }

  getHost(id: string): SshHostConfig | undefined {
    return this.listHosts().find((host) => host.id === id);
  }

  saveHost(input: Omit<SshHostConfig, "id"> & { id?: string }): SshHostConfig {
    const hosts = this.listHosts();
    // 逐字段取：渲染层若多传 password 之类的字段，也不会落进配置
    const saved: SshHostConfig = {
      id: input.id ?? randomUUID(),
      label: input.label.trim() || `${input.username}@${input.host}`,
      host: input.host.trim(),
      port: input.port || 22,
      username: input.username.trim(),
      authMode: input.authMode,
      privateKeyPath: input.privateKeyPath,
      defaultPath: input.defaultPath,
    };
    const next = input.id
      ? hosts.map((host) => (host.id === input.id ? saved : host))
      : [...hosts, saved];
    configStore.update({ sshHosts: next });
    return saved;
  }

  deleteHost(id: string, referencedCwds: string[]): void {
    const prefix = `ssh://${id}/`;
    if (referencedCwds.some((cwd) => cwd.startsWith(prefix))) {
      throw new Error(
        "This server is still used by an open project. Close the project first.",
      );
    }
    configStore.update({
      sshHosts: this.listHosts().filter((host) => host.id !== id),
    });
  }
}

export class SshConnectionPool {
  private connections = new Map<string, SshConnection>();

  async get(
    host: SshHostConfig,
    deps: { knownHosts: KnownHostsStore; keyDir: string },
  ): Promise<SshConnection> {
    const existing = this.connections.get(host.id);
    if (existing && !existing.isClosed) return existing;
    this.connections.delete(host.id);
    const appKey = ensureAppKey(deps.keyDir);
    const privateKey = readHostPrivateKey(host, appKey.privateKeyPath);
    const connection = new SshConnection({
      host: host.host,
      port: host.port,
      username: host.username,
      auth: { kind: "key", privateKey },
      knownHosts: deps.knownHosts,
    });
    this.connections.set(host.id, connection);
    return connection;
  }

  activeHostIds(): string[] {
    return [...this.connections.keys()];
  }

  async closeAll(): Promise<void> {
    const all = [...this.connections.values()];
    this.connections.clear();
    await Promise.all(all.map((conn) => conn.close()));
  }
}
