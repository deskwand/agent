export interface SshHostInput {
  label: string;
  host: string;
  port: number;
  username: string;
  authMode: "password" | "key";
  privateKeyPath?: string;
  defaultPath?: string;
}

export function validateSshHostInput(
  input: SshHostInput,
): { ok: true } | { ok: false; error: "host" | "username" | "port" } {
  if (!input.host.trim() || /\s/.test(input.host.trim())) {
    return { ok: false, error: "host" };
  }
  if (!input.username.trim()) return { ok: false, error: "username" };
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    return { ok: false, error: "port" };
  }
  return { ok: true };
}
