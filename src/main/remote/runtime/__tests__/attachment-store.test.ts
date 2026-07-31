import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AttachmentStore } from "../attachment-store";

const MiB = 1024 * 1024;

describe("attachment store", () => {
  it("rejects a data attachment larger than 30 MiB", async () => {
    const store = new AttachmentStore({ workspaceRoot: "/tmp" });
    const data = Buffer.alloc(30 * MiB + 1).toString("base64");

    await expect(
      store.prepareOutbound([
        {
          version: 1,
          filename: "large.bin",
          mediaType: "application/octet-stream",
          data,
        },
      ]),
    ).rejects.toMatchObject({ code: "ATTACHMENT_TOO_LARGE" });
  });

  it("rejects outbound attachments over the 50 MiB message limit", async () => {
    const store = new AttachmentStore({ workspaceRoot: "/tmp" });
    const data = Buffer.alloc(25 * MiB + 1).toString("base64");
    const attachments = ["a.bin", "b.bin"].map((filename) => ({
      version: 1 as const,
      filename,
      mediaType: "application/octet-stream",
      data,
    }));

    await expect(store.prepareOutbound(attachments)).rejects.toMatchObject({
      code: "ATTACHMENT_MESSAGE_TOO_LARGE",
    });
  });

  it("rejects local paths that escape the workspace through a symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "deskwand-attachment-test-"));
    const outside = await mkdtemp(join(tmpdir(), "deskwand-outside-test-"));
    await writeFile(join(outside, "secret.txt"), "secret");
    await mkdir(join(root, "workspace"));
    await symlink(outside, join(root, "workspace", "link"));
    const store = new AttachmentStore({ workspaceRoot: join(root, "workspace") });

    await expect(
      store.prepareOutbound([
        {
          version: 1,
          filename: "secret.txt",
          mediaType: "text/plain",
          path: join(root, "workspace", "link", "secret.txt"),
        },
      ]),
    ).rejects.toMatchObject({ code: "ATTACHMENT_PATH_ESCAPE" });
  });
});
