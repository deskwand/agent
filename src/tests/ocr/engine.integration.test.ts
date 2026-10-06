import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getOcrEngine, releaseOcrEngine } from "../../main/ocr/engine";

/**
 * 真模型集成测试。默认跳过 —— CI 上没有运行时与模型。
 * 手动跑：
 *   OCR_TEST_RUNTIME=/tmp/ocr-runtime OCR_TEST_MODEL=/tmp/ocr-spike/models \
 *     OCR_TEST_IMAGE=/tmp/ocr-spike/sample.png npx vitest run src/tests/ocr/engine.integration.test.ts
 */
const runtimeDir = process.env.OCR_TEST_RUNTIME ?? "";
const modelDir = process.env.OCR_TEST_MODEL ?? "";
const image = process.env.OCR_TEST_IMAGE ?? "";
const ready =
  Boolean(runtimeDir && modelDir && image) &&
  existsSync(join(modelDir, "det.onnx")) &&
  existsSync(image);

describe.skipIf(!ready)("engine 真模型", () => {
  it("从一张真图里认出文字", async () => {
    const engine = await getOcrEngine({ runtimeDir, modelDir });
    const lines = await engine.recognize(image);
    expect(lines.length).toBeGreaterThan(0);
    console.log(
      lines.map((line) => `${line.score.toFixed(2)} ${line.text}`).join("\n"),
    );
    releaseOcrEngine();
  }, 120_000);
});
