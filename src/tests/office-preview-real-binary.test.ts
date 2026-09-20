import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import { renderOfficePreview } from "../main/office/office-preview";

/**
 * 与真实 officecli 二进制的集成测试。
 *
 * `office-preview.test.ts` 注入 runner，验的是分类与错误映射；那个层面**验不到**
 * 真实的命令行拼得对不对、以及产物路径能不能被渲染层转成 file:// URL。这里补上。
 *
 * 二进制来自 `npm run prepare:bin`（resources/bin 是 gitignore 的），所以没有二进制的
 * 检出环境会自动跳过而不是失败。
 */
const BIN_DIR = path.join(
  process.cwd(),
  "resources",
  "bin",
  `${process.platform}-${process.arch === "arm64" ? "arm64" : "x64"}`,
);
const RESIDENT_TAG = ["__resident", "-serve__"].join("");
const BIN = path.join(
  BIN_DIR,
  process.platform === "win32" ? "officecli.exe" : "officecli",
);
const HAS_BIN = fs.existsSync(BIN);

/** 当前存活的 officecli 守护进程数（非 win32）。 */
function residentPids(): Set<number> {
  try {
    // 用绝对路径的 ps，不依赖 PATH、也不用 pgrep：vitest worker 里 pgrep 可能解析不到
    // （那样 catch 会一直返回 0，测试就变成恒等比较的假通过——这个坑踩过一次）。
    const out = execFileSync("/bin/ps", ["-Ao", "pid,command"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pids = new Set<number>();
    for (const line of out.split("\n")) {
      if (!line.includes(RESIDENT_TAG)) continue;
      const pid = Number.parseInt(line.trim().split(/\s+/)[0], 10);
      if (Number.isFinite(pid)) pids.add(pid);
    }
    return pids;
  } catch {
    return new Set();
  }
}

describe.skipIf(!HAS_BIN)("renderOfficePreview (real binary)", () => {
  let workDir: string;
  let source: string;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "office-preview-real-"));
    source = path.join(workDir, "sample.docx");
    // 用 officecli 自己造一份 fixture，避免把一个二进制文档塞进仓库。
    // 这些调用也显式关掉常驻：否则它们留下的守护进程可能在本文件后续用例的
    // `before` 快照之后才落地，被"不得留下守护进程"那条断言误判。
    const noResident = { ...process.env, OFFICECLI_NO_AUTO_RESIDENT: "1" };
    execFileSync(BIN, ["create", source], { stdio: "ignore", env: noResident });
    execFileSync(
      BIN,
      [
        "add",
        source,
        "/body",
        "--type",
        "paragraph",
        "--prop",
        "text=Preview fixture",
      ],
      { stdio: "ignore", env: noResident },
    );
    execFileSync(BIN, ["close", source], { stdio: "ignore", env: noResident });
  }, 60_000);

  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  const deps = () => ({ findBinDir: () => BIN_DIR, outDir: workDir });

  it("renders a real document to a non-empty, self-contained html file", async () => {
    const res = await renderOfficePreview(source, deps());

    expect(res.ok, JSON.stringify(res)).toBe(true);
    const html = fs.readFileSync(res.outPath as string, "utf8");
    expect(html.length).toBeGreaterThan(500);
    // 自包含是「离线可用」的前提：不得引用任何外部 http(s) 资源。
    expect(html.match(/(?:src|href)="https?:\/\/[^"]+"/g) ?? []).toEqual([]);
  });

  it("returns a path the renderer can convert to a file url", async () => {
    const res = await renderOfficePreview(source, deps());

    // openFilePathInBrowser 内部会做这个转换；这里断言它确实能被转换，
    // 因为主进程返回的是路径而不是 URL（见 design §5.2 第 5 条）。
    expect(
      pathToFileURL(res.outPath as string).href.startsWith("file://"),
    ).toBe(true);
  });

  it("does not let officecli phone home, even with no session started", async () => {
    // enrichProcessPathForBuild() 里的 OFFICECLI_SKIP_UPDATE 要等会话启动才写入
    // process.env；预览可能发生在任何会话之前（开应用→文件面板→双击）。
    // 用干净 HOME 模拟那个时刻：若 officecli 发起了更新检查，它会写下
    // ~/.officecli/config.json（实测不带该变量时 autoUpdate:true + lastUpdateCheck）。
    const freshHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "office-preview-home-"),
    );
    const savedHome = process.env.HOME;
    const savedSkip = process.env.OFFICECLI_SKIP_UPDATE;
    delete process.env.OFFICECLI_SKIP_UPDATE;
    process.env.HOME = freshHome;
    try {
      const res = await renderOfficePreview(source, deps());
      expect(res.ok, JSON.stringify(res)).toBe(true);
      expect(
        fs.existsSync(path.join(freshHome, ".officecli", "config.json")),
      ).toBe(false);
    } finally {
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
      if (savedSkip !== undefined)
        process.env.OFFICECLI_SKIP_UPDATE = savedSkip;
      fs.rmSync(freshHome, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "does not leave a __resident-serve__ daemon behind",
    async () => {
      // 实测：一次 `view` 会留下一个守护进程（PPID 1，RSS ~50MB，并持有该文档），
      // 靠 ~60s 空闲才自退；连续预览多个文档会堆起来。预览是一次性的，不该常驻。
      //
      // 必须用一份**本测试独有**的文档：officecli 的守护进程是按文档路径复用的，
      // 若复用文件里前面几个用例已经渲染过的 fixture，那个路径上早已有守护进程，
      // 这里就观察不到"新起的那个"，测试会恒过。
      // 造 fixture 的三次调用也要关掉常驻：否则 close 之后那个守护进程可能在
      // `before` 快照**之后**才真正退出/落地，被误判成"本次渲染新起的"。
      const noResident = { ...process.env, OFFICECLI_NO_AUTO_RESIDENT: "1" };
      const ownSource = path.join(workDir, "resident-probe.docx");
      execFileSync(BIN, ["create", ownSource], {
        stdio: "ignore",
        env: noResident,
      });
      execFileSync(
        BIN,
        [
          "add",
          ownSource,
          "/body",
          "--type",
          "paragraph",
          "--prop",
          "text=probe",
        ],
        { stdio: "ignore", env: noResident },
      );
      execFileSync(BIN, ["close", ownSource], {
        stdio: "ignore",
        env: noResident,
      });

      // 比 PID 集合而不是数量：旧进程到期退出只会"减少"集合，不会造成假失败。
      const before = residentPids();

      await renderOfficePreview(ownSource, deps());
      await new Promise((resolve) => setTimeout(resolve, 800));

      const appeared = [...residentPids()].filter((pid) => !before.has(pid));
      expect(appeared).toEqual([]);
    },
    60_000,
  );

  it("reports render-failed for a file officecli cannot read", async () => {
    const bogus = path.join(workDir, "not-a-document.docx");
    fs.writeFileSync(bogus, "definitely not a docx");

    const res = await renderOfficePreview(bogus, deps());

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("render-failed");
  });
});
