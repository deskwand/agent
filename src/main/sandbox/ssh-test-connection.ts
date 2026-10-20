import { ensureAppKey } from "./ssh-app-key";
import { buildAuthorizedKeysCommand } from "./ssh-bootstrap";
import { SshConnection } from "./ssh-connection";
import { readHostPrivateKey } from "./ssh-config-service";
import { SshError, type KnownHostsStore, type SshHostConfig } from "./types";

export type TestStage = "key" | "password" | "bootstrap";

export interface TestConnectionInput {
  host: SshHostConfig;
  password?: string;
  knownHosts: KnownHostsStore;
  keyDir: string;
  onStage?: (stage: TestStage) => void;
}

/** 指纹类错误要带上指纹，UI 才能展示给用户核对。 */
function withFingerprint(error: unknown, fingerprint: string): unknown {
  if (
    error instanceof SshError &&
    (error.code === "SSH_HOST_KEY_UNKNOWN" ||
      error.code === "SSH_HOST_KEY_MISMATCH")
  ) {
    return Object.assign(error, { fingerprint });
  }
  return error;
}

function connectionFor(
  input: TestConnectionInput,
  auth:
    | { kind: "key"; privateKey: string }
    | { kind: "password"; password: string },
): SshConnection {
  return new SshConnection({
    host: input.host.host,
    port: input.host.port,
    username: input.host.username,
    auth,
    knownHosts: input.knownHosts,
  });
}

export async function testSshConnection(
  input: TestConnectionInput,
): Promise<{ passwordless: boolean; fingerprint: string }> {
  const appKey = ensureAppKey(input.keyDir);

  // 阶段 1：密钥登录（已免密时一次成功）
  input.onStage?.("key");
  const keyConn = connectionFor(input, {
    kind: "key",
    privateKey: readHostPrivateKey(input.host, appKey.privateKeyPath),
  });
  try {
    await keyConn.ensureConnected();
    return { passwordless: true, fingerprint: keyConn.fingerprint };
  } catch (error) {
    if (!(error instanceof SshError) || error.code !== "SSH_AUTH_FAILED") {
      throw withFingerprint(error, keyConn.fingerprint);
    }
  } finally {
    await keyConn.close();
  }

  // 阶段 2：密码登录并写入公钥
  if (!input.password) {
    throw new SshError(
      "SSH_AUTH_FAILED",
      "Password is required for first login",
    );
  }
  input.onStage?.("password");
  const passwordConn = connectionFor(input, {
    kind: "password",
    password: input.password,
  });
  try {
    await passwordConn.ensureConnected();
    const result = await passwordConn.exec(
      buildAuthorizedKeysCommand(appKey.publicKey),
    );
    if (!result.success) {
      throw new SshError(
        "SSH_BOOTSTRAP_FAILED",
        result.stderr.trim() || "Failed to install the public key",
      );
    }
  } finally {
    await passwordConn.close();
  }

  // 阶段 3：只用密钥再连一次，确认真的免密
  input.onStage?.("bootstrap");
  const verifyConn = connectionFor(input, {
    kind: "key",
    privateKey: readHostPrivateKey(input.host, appKey.privateKeyPath),
  });
  try {
    await verifyConn.ensureConnected();
    return { passwordless: true, fingerprint: verifyConn.fingerprint };
  } catch (error) {
    throw new SshError(
      "SSH_BOOTSTRAP_FAILED",
      error instanceof Error ? error.message : "Key verification failed",
    );
  } finally {
    await verifyConn.close();
  }
}
