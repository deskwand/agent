import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  previewOutPath,
  renderOfficePreview,
} from "../main/office/office-preview";

describe("previewOutPath", () => {
  it("is stable for the same source path", () => {
    const a = previewOutPath("/repo/report.docx", "/tmp/out");
    const b = previewOutPath("/repo/report.docx", "/tmp/out");
    expect(a).toBe(b);
  });

  it("differs between source paths and always ends in .html", () => {
    const a = previewOutPath("/repo/report.docx", "/tmp/out");
    const b = previewOutPath("/repo/budget.xlsx", "/tmp/out");
    expect(a).not.toBe(b);
    expect(a.endsWith(".html")).toBe(true);
    expect(b.endsWith(".html")).toBe(true);
  });
});

describe("renderOfficePreview", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "office-preview-test-"));
  });

  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  const deps = (
    over: Partial<Parameters<typeof renderOfficePreview>[1]> = {},
  ) => ({
    findBinDir: () => "/fake/bin",
    outDir,
    ...over,
  });

  it("reports binary-missing without spawning anything", async () => {
    const run = vi.fn();
    const res = await renderOfficePreview(
      "/repo/a.docx",
      deps({ findBinDir: () => null, run }),
    );

    expect(res).toEqual({ ok: false, reason: "binary-missing" });
    expect(run).not.toHaveBeenCalled();
  });

  it("returns the output path on success and writes the output", async () => {
    const source = "/repo/a.docx";
    const res = await renderOfficePreview(
      source,
      deps({
        run: async (_bin, args) => {
          fs.writeFileSync(args[args.length - 1], "<html>ok</html>");
          return { code: 0, stderr: "" };
        },
      }),
    );

    expect(res.ok).toBe(true);
    // 返回的是**路径**不是 file:// URL：渲染层的 openFilePathInBrowser 只接受路径,
    // 而 toFileUrl 会拒绝已经带 file:// 的输入（返回 null → 静默不动）。
    expect(res.outPath).toBe(previewOutPath(source, outDir));
  });

  it("passes the right arguments to officecli", async () => {
    const run = vi.fn(
      async (_bin: string, args: string[], _timeoutMs: number) => {
        fs.writeFileSync(args[args.length - 1], "x");
        return { code: 0, stderr: "" };
      },
    );
    await renderOfficePreview("/repo/a.docx", deps({ run }));

    const [binPath, args, timeoutMs] = run.mock.calls[0];
    expect(binPath.endsWith("officecli")).toBe(true);
    expect(args).toEqual([
      "view",
      "/repo/a.docx",
      "html",
      "-o",
      previewOutPath("/repo/a.docx", outDir),
    ]);
    expect(timeoutMs).toBe(10_000);
  });

  it("reports render-failed on a non-zero exit", async () => {
    const res = await renderOfficePreview(
      "/repo/a.docx",
      deps({ run: async () => ({ code: 2, stderr: "boom" }) }),
    );
    expect(res).toEqual({ ok: false, reason: "render-failed" });
  });

  it("reports timeout when the child was killed by the timeout", async () => {
    const res = await renderOfficePreview(
      "/repo/a.docx",
      deps({ run: async () => ({ code: 1, stderr: "", timedOut: true }) }),
    );
    expect(res).toEqual({ ok: false, reason: "timeout" });
  });

  it("distinguishes a plain non-zero exit from a timeout", async () => {
    const res = await renderOfficePreview(
      "/repo/a.docx",
      deps({
        run: async () => ({ code: 3, stderr: "bad docx", timedOut: false }),
      }),
    );
    expect(res).toEqual({ ok: false, reason: "render-failed" });
  });

  it("reports render-failed when the runner itself throws", async () => {
    const res = await renderOfficePreview(
      "/repo/a.docx",
      deps({
        run: async () => {
          throw new Error("spawn ENOENT");
        },
      }),
    );
    expect(res).toEqual({ ok: false, reason: "render-failed" });
  });

  it("reports empty-output when the process succeeds but writes nothing", async () => {
    const res = await renderOfficePreview(
      "/repo/a.docx",
      deps({ run: async () => ({ code: 0, stderr: "" }) }),
    );
    expect(res).toEqual({ ok: false, reason: "empty-output" });
  });

  it("uses officecli.exe on win32", async () => {
    const run = vi.fn(async (_bin: string, args: string[]) => {
      fs.writeFileSync(args[args.length - 1], "x");
      return { code: 0, stderr: "" };
    });
    const original = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    try {
      await renderOfficePreview("/repo/a.docx", deps({ run }));
      expect(run.mock.calls[0][0].endsWith("officecli.exe")).toBe(true);
    } finally {
      if (original) Object.defineProperty(process, "platform", original);
    }
  });
});
