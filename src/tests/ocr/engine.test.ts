import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOcrEngine,
  releaseOcrEngine,
  toLines,
  type ServiceFactory,
} from "../../main/ocr/engine";

afterEach(() => releaseOcrEngine());

/**
 * 形状取自 spike 实测（design-docs/2026-10-06-local-ocr-spike.md）：
 * `lines` 是「行的数组」，行内是文本块数组，块是 `{ text, confidence, box }`。
 */
describe("toLines", () => {
  it("展平行内文本块，分数取 confidence", () => {
    const raw = {
      text: "第一行\n第二行",
      lines: [
        [
          {
            text: "第一",
            confidence: 0.9,
            box: { x: 1, y: 2, width: 3, height: 4 },
          },
          {
            text: "行",
            confidence: 0.8,
            box: { x: 5, y: 2, width: 3, height: 4 },
          },
        ],
        [
          {
            text: "第二行",
            confidence: 0.7,
            box: { x: 1, y: 20, width: 3, height: 4 },
          },
        ],
      ],
    };
    expect(toLines(raw)).toEqual([
      { text: "第一", score: 0.9 },
      { text: "行", score: 0.8 },
      { text: "第二行", score: 0.7 },
    ]);
  });

  it("空文本的块丢掉，缺 confidence 记 0", () => {
    const raw = {
      lines: [[{ text: "", confidence: 0.98 }], [{ text: "有字" }]],
    };
    expect(toLines(raw)).toEqual([{ text: "有字", score: 0 }]);
  });

  it("形状不对时返回空数组，不抛", () => {
    expect(toLines(null)).toEqual([]);
    expect(toLines("…")).toEqual([]);
    expect(toLines({})).toEqual([]);
    expect(toLines({ lines: [{}] })).toEqual([]);
    expect(toLines({ lines: [[null]] })).toEqual([]);
  });
});

describe("getOcrEngine", () => {
  const dirs = () => {
    const root = mkdtempSync(join(tmpdir(), "ocr-engine-"));
    const runtime = join(root, "runtime");
    const model = join(root, "model");
    mkdirSync(runtime, { recursive: true });
    mkdirSync(model, { recursive: true });
    for (const file of ["det.onnx", "rec.onnx", "ppocrv6_dict.txt"]) {
      writeFileSync(join(model, file), "x");
    }
    return { root, runtime, model };
  };

  it("把模型路径与 maxSideLength 组装成 service options，且只初始化一次", async () => {
    const { root, runtime, model } = dirs();
    const instances: Array<{
      options: unknown;
      destroy: ReturnType<typeof vi.fn>;
    }> = [];
    const factory: ServiceFactory = async (options) => {
      const destroy = vi.fn(async () => {});
      instances.push({ options, destroy });
      return {
        initialize: async () => {},
        recognize: async () => ({
          lines: [[{ text: "你好", confidence: 0.95 }]],
        }),
        destroy,
      };
    };

    const engine = await getOcrEngine({
      runtimeDir: runtime,
      modelDir: model,
      factory,
    });
    expect(instances).toHaveLength(1);
    expect(instances[0].options).toEqual({
      model: {
        detection: join(model, "det.onnx"),
        recognition: join(model, "rec.onnx"),
        charactersDictionary: join(model, "ppocrv6_dict.txt"),
      },
      detection: { maxSideLength: 960 },
    });

    await expect(engine.recognize("/tmp/a.png")).resolves.toEqual([
      { text: "你好", score: 0.95 },
    ]);

    // 第二次取同一个引擎：不再新建
    await getOcrEngine({ runtimeDir: runtime, modelDir: model, factory });
    expect(instances).toHaveLength(1);

    releaseOcrEngine();
    expect(instances[0].destroy).toHaveBeenCalledOnce();
    rmSync(root, { recursive: true, force: true });
  });

  it("换一对目录时重建引擎，并销毁上一个", async () => {
    const first = dirs();
    const second = dirs();
    const destroy = vi.fn(async () => {});
    const factory: ServiceFactory = async () => ({
      initialize: async () => {},
      recognize: async () => ({ lines: [] }),
      destroy,
    });

    await getOcrEngine({
      runtimeDir: first.runtime,
      modelDir: first.model,
      factory,
    });
    await getOcrEngine({
      runtimeDir: second.runtime,
      modelDir: second.model,
      factory,
    });
    expect(destroy).toHaveBeenCalledOnce();
    rmSync(first.root, { recursive: true, force: true });
    rmSync(second.root, { recursive: true, force: true });
  });
});
