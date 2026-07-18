import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WEB_ACCESS_TEMP_ROOT = join(tmpdir(), "deskwand-web-access");

export function getWebAccessSessionTempDir(sessionId: string): string {
  const hash = createHash("sha256").update(sessionId).digest("hex");
  return join(WEB_ACCESS_TEMP_ROOT, hash);
}

export async function removeWebAccessTempDir(sessionId: string): Promise<void> {
  await rm(getWebAccessSessionTempDir(sessionId), {
    recursive: true,
    force: true,
  });
}

export async function removeAllWebAccessTempDirs(): Promise<void> {
  await rm(WEB_ACCESS_TEMP_ROOT, { recursive: true, force: true });
}
