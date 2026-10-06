/**
 * @module main/ocr/engine
 *
 * **唯一**认识 ppu-paddle-ocr 的文件。换引擎只改这里，工具、IPC、界面都不动。
 *
 * 引擎懒加载、按目录缓存一份。`releaseOcrEngine()` 只丢引用 —— ORT 与 WASM 的原生
 * 内存不保证马上归还，界面文案按这个事实写（与语音一致：重启才释放）。
 *
 * 形状与耗时来自 spike 实测：design-docs/2026-10-06-local-ocr-spike.md
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { log } from "../utils/logger";

export interface OcrLine {
  text: string;
  score: number;
}

export interface OcrEngine {
  recognize(imagePath: string): Promise<OcrLine[]>;
}

/** ppu-paddle-ocr 的服务，只声明我们用到的部分。 */
export interface PaddleService {
  initialize(): Promise<void>;
  recognize(imagePath: string): Promise<unknown>;
  destroy(): Promise<void>;
}

/** 传给 ppu-paddle-ocr 的 service options。字段名以 spike 记录为准。 */
export interface PaddleServiceOptions {
  model: {
    detection: string;
    recognition: string;
    charactersDictionary: string;
  };
  detection: { maxSideLength: number };
}

export type ServiceFactory = (
  options: PaddleServiceOptions,
) => Promise<PaddleService>;

/** 目录 → service options。组装与「怎么加载」分开，组装才可测。 */
export function buildServiceOptions(opts: {
  modelDir: string;
}): PaddleServiceOptions {
  return {
    model: {
      detection: join(opts.modelDir, "det.onnx"),
      recognition: join(opts.modelDir, "rec.onnx"),
      charactersDictionary: join(opts.modelDir, "ppocrv6_dict.txt"),
    },
    // 显式 960，不用 "auto"：auto 对大图会放到 1920，白白多花时间
    detection: { maxSideLength: 960 },
  };
}

/**
 * 默认工厂：从 userData 里动态 import 运行时。
 *
 * 用 `pathToFileURL` + 动态 import 而不是 `require`：运行时是 ESM 包（`"type": "module"`），
 * 与 `pdf-reader.ts` 动态 import `pdfjs-dist` 同一套写法。
 */
export async function paddleServiceFactory(
  runtimeDir: string,
  options: PaddleServiceOptions,
): Promise<PaddleService> {
  const entry = join(runtimeDir, "node_modules", "ppu-paddle-ocr", "index.js");
  const mod = (await import(pathToFileURL(entry).href)) as unknown as {
    PaddleOcrService: new (options: PaddleServiceOptions) => PaddleService;
  };
  const service = new mod.PaddleOcrService(options);
  await service.initialize();
  return service;
}

/**
 * 服务返回结果 → 我们的行数组。
 *
 * spike 实测的形状是 `{ text, lines, confidence }`，其中 `lines` 是**行的数组**，
 * 行内是该视觉行里的文本块数组，块是 `{ text, confidence, box }`。这里展平成
 * 「一块一行」，空块丢掉。
 */
export function toLines(raw: unknown): OcrLine[] {
  if (typeof raw !== "object" || raw === null) return [];
  const result = raw as { lines?: unknown };
  if (!Array.isArray(result.lines)) return [];

  const lines: OcrLine[] = [];
  for (const group of result.lines) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      if (typeof item !== "object" || item === null) continue;
      const block = item as { text?: unknown; confidence?: unknown };
      if (typeof block.text !== "string" || block.text.trim() === "") continue;
      lines.push({
        text: block.text,
        score: typeof block.confidence === "number" ? block.confidence : 0,
      });
    }
  }
  return lines;
}

let cached: { key: string; engine: OcrEngine; service: PaddleService } | null =
  null;

/** 取引擎。同一对目录只初始化一次（初始化要建 ORT 会话，不便宜）。 */
export async function getOcrEngine(opts: {
  runtimeDir: string;
  modelDir: string;
  factory?: ServiceFactory;
}): Promise<OcrEngine> {
  const key = `${opts.runtimeDir}|${opts.modelDir}`;
  if (cached?.key === key) return cached.engine;
  releaseOcrEngine();

  const factory =
    opts.factory ??
    ((options: PaddleServiceOptions) =>
      paddleServiceFactory(opts.runtimeDir, options));
  const service = await factory(
    buildServiceOptions({ modelDir: opts.modelDir }),
  );
  const engine: OcrEngine = {
    recognize: async (imagePath: string) =>
      toLines(await service.recognize(imagePath)),
  };
  cached = { key, engine, service };
  log("[Ocr] engine ready");
  return engine;
}

/** 只丢引用。原生内存等重启归还 —— 不要在这里假装已经释放。 */
export function releaseOcrEngine(): void {
  const previous = cached;
  cached = null;
  if (previous) void previous.service.destroy().catch(() => {});
}
