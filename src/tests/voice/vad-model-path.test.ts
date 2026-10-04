/**
 * 随包模型文件的路径解析。
 *
 * 它只有两个分支（打包 / 开发），但两个都要对：开发时指错，本地根本起不来；
 * 打包时指错，装出来的应用里 VAD 永远加载失败 —— 而这在没有麦克风的 CI 里
 * 是测不出来的。
 *
 * `process.resourcesPath` 由 Electron 在运行时注入，这里是 Node 环境，
 * 所以直接赋值（与 `specPath()` 用的是同一个锚点）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isPackaged: false,
  appPath: "/repo",
}));

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged;
    },
    getAppPath: () => mocks.appPath,
  },
}));

const { readBundledModelPath } = await import("../../main/speech/runtime-spec");

const originalResourcesPath = process.resourcesPath;

/** `process.resourcesPath` 是 Electron 注入的只读属性，测试里只能这样改。 */
const setResourcesPath = (value: string | undefined) => {
  Object.defineProperty(process, "resourcesPath", {
    value,
    configurable: true,
    writable: true,
  });
};

afterEach(() => {
  setResourcesPath(originalResourcesPath);
});

describe("readBundledModelPath", () => {
  it("开发时从仓库 resources/ 取", () => {
    mocks.isPackaged = false;
    expect(readBundledModelPath("silero_vad.onnx")).toBe(
      "/repo/resources/silero_vad.onnx",
    );
  });

  it("打包后从 extraResources 的根取", () => {
    mocks.isPackaged = true;
    setResourcesPath("/app/Resources");
    expect(readBundledModelPath("silero_vad.onnx")).toBe(
      "/app/Resources/silero_vad.onnx",
    );
  });
});
