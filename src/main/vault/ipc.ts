import { ipcMain, app } from "electron";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadOrCreateMek } from "./keychain";
import { packFile, unpack } from "./objects";

export function registerVaultIpc(): void {
  ipcMain.handle("vault.encryptUpload", async (_e, filePath: string) => {
    const mek = loadOrCreateMek(null); // 已初始化场景；首次需恢复码 → 抛 VAULT_UNINITIALIZED
    const { payload, id } = await packFile(filePath, mek);
    return { id, payloadBase64: payload.toString("base64") };
  });

  ipcMain.handle(
    "vault.decryptRestore",
    async (_e, id: string, payloadBase64: string) => {
      const mek = loadOrCreateMek(null);
      const buf = await unpack(Buffer.from(payloadBase64, "base64"), mek);
      const out = join(app.getPath("userData"), "vault-restore", id);
      writeFileSync(out, buf);
      return { filePath: out };
    },
  );
}
