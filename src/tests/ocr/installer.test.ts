import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installOcr,
  ocrRoot,
  isInstalled,
  modelDir,
  removeOcr,
  runtimeDir,
} from "../../main/ocr/installer";

let userDataPath = "";
const runtimeFile = () =>
  join(runtimeDir(userDataPath), "node_modules", "ppu-paddle-ocr", "index.js");
const modelFiles = () =>
  ["det.onnx", "rec.onnx", "ppocrv6_dict.txt"].map((f) =>
    join(modelDir(userDataPath), f),
  );

beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), "ocr-test-"));
});
afterEach(() => rmSync(userDataPath, { recursive: true, force: true }));

/** 把「解包」这一步假装成成功：造出该出现的文件。 */
function fakeExtract() {
  return vi.fn(async (_opts: unknown, targetDir: string) => {
    if (targetDir === runtimeDir(userDataPath)) {
      mkdirSync(join(targetDir, "node_modules", "ppu-paddle-ocr"), {
        recursive: true,
      });
      writeFileSync(
        join(targetDir, "node_modules", "ppu-paddle-ocr", "index.js"),
        "export {}",
      );
      return;
    }
    mkdirSync(targetDir, { recursive: true });
    for (const file of modelFiles()) writeFileSync(file, "x");
  });
}

const baseOptions = () => ({
  userDataPath,
  runtimeUrl: "https://example.com/runtime.tar.gz",
  runtimeSha256: "a".repeat(64),
  modelUrl: "https://example.com/model.tar.gz",
  modelSha256: "b".repeat(64),
  onProgress: () => {},
  onPhase: () => {},
});

describe("ocr installer", () => {
  it("装完后 isInstalled 为真", async () => {
    expect(isInstalled(userDataPath)).toBe(false);
    await installOcr({ ...baseOptions(), extract: fakeExtract() });
    expect(isInstalled(userDataPath)).toBe(true);
    expect(existsSync(runtimeFile())).toBe(true);
  });

  it("进度是一条：运行时占前 40%，模型占后 60%", async () => {
    const percents: number[] = [];
    await installOcr({
      ...baseOptions(),
      onProgress: (p) => percents.push(p),
      extract: vi.fn(
        async (
          opts: { onProgress: (p: number) => void },
          targetDir: string,
        ) => {
          opts.onProgress(50);
          if (targetDir === runtimeDir(userDataPath)) {
            mkdirSync(join(targetDir, "node_modules", "ppu-paddle-ocr"), {
              recursive: true,
            });
            writeFileSync(
              join(targetDir, "node_modules", "ppu-paddle-ocr", "index.js"),
              "export {}",
            );
            return;
          }
          mkdirSync(targetDir, { recursive: true });
          for (const file of modelFiles()) writeFileSync(file, "x");
        },
      ),
    });
    expect(percents).toEqual([20, 70]);
  });

  it("下载失败不留半成品", async () => {
    const extract = vi.fn(async (_opts: unknown, targetDir: string) => {
      mkdirSync(targetDir, { recursive: true });
      throw new Error("sha256 mismatch");
    });
    await expect(installOcr({ ...baseOptions(), extract })).rejects.toThrow(
      "sha256 mismatch",
    );
    expect(isInstalled(userDataPath)).toBe(false);
    expect(existsSync(runtimeDir(userDataPath))).toBe(false);
  });

  it("清单说装了但文件被删 → 当没装", async () => {
    await installOcr({ ...baseOptions(), extract: fakeExtract() });
    rmSync(runtimeFile(), { force: true });
    expect(isInstalled(userDataPath)).toBe(false);
  });

  it("removeOcr 删掉两个目录", async () => {
    await installOcr({ ...baseOptions(), extract: fakeExtract() });
    removeOcr(userDataPath);
    expect(isInstalled(userDataPath)).toBe(false);
    expect(existsSync(runtimeDir(userDataPath))).toBe(false);
    expect(existsSync(modelDir(userDataPath))).toBe(false);
  });
});

describe("ocr installer — 删除要连旧版本一起清", () => {
  it("removeOcr 清掉整个 ocr 目录（含上一个运行时版本与清单）", async () => {
    await installOcr({ ...baseOptions(), extract: fakeExtract() });
    // 上一版 ORT 的残留目录：升级一次就会留下一个
    const stale = join(ocrRoot(userDataPath), "runtime", "0.0.1");
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, "junk"), "x");

    removeOcr(userDataPath);

    expect(existsSync(ocrRoot(userDataPath))).toBe(false);
    expect(existsSync(stale)).toBe(false);
  });
});
