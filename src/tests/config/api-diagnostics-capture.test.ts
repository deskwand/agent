import * as net from "net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type * as ProviderModelsModule from "../../main/config/provider-models";

const { listProviderModelsMock } = vi.hoisted(() => ({
  listProviderModelsMock: vi.fn(),
}));

vi.mock("../../main/config/provider-models", async () => {
  const actual = await vi.importActual<typeof ProviderModelsModule>(
    "../../main/config/provider-models",
  );
  return { ...actual, listProviderModels: listProviderModelsMock };
});

import { runDiagnostics } from "../../main/config/api-diagnostics";

// 真起一个本地 TCP 端口，让 DNS（loopback 直接 ok）/ TCP 步走真实成功路径；
// http 协议下 TLS 步会自行 skip。这样只需要 mock 掉出网的那一步。
const server = net.createServer();
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address() as net.AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("diagnostics model capture", () => {
  beforeEach(() => {
    listProviderModelsMock.mockReset();
  });

  it("captures the live model list and skips the inference step", async () => {
    listProviderModelsMock.mockResolvedValue({
      ok: true,
      source: "live",
      filtered: 2,
      models: [
        { id: "deepseek-chat", label: "deepseek-chat" },
        { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
      ],
    });

    const result = await runDiagnostics({
      provider: "custom",
      customProtocol: "openai",
      apiKey: "sk-test",
      baseUrl,
      captureModels: true,
    });

    expect(result.overallOk).toBe(true);
    expect(result.modelsSource).toBe("live");
    expect(result.modelsFiltered).toBe(2);
    expect(result.models).toEqual([
      { id: "deepseek-chat", name: "deepseek-chat" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
    ]);
    expect(result.steps.find((s) => s.name === "model")?.status).toBe("skip");
  });

  it("treats a 404 endpoint as reachable but unsupported", async () => {
    listProviderModelsMock.mockResolvedValue({
      ok: true,
      source: "unsupported",
      filtered: 0,
      models: [],
    });

    const result = await runDiagnostics({
      provider: "custom",
      customProtocol: "openai",
      apiKey: "sk-test",
      baseUrl,
      captureModels: true,
    });

    const auth = result.steps.find((s) => s.name === "auth");
    expect(auth?.status).toBe("ok");
    expect(auth?.fix).toBe("models_list_not_supported");
    expect(result.modelsSource).toBe("unsupported");
    expect(result.models).toBeUndefined();
  });

  it("fails the auth step on an invalid key and keeps the reason", async () => {
    listProviderModelsMock.mockResolvedValue({
      ok: false,
      source: "error",
      filtered: 0,
      models: [],
      error: "invalid api key",
      errorType: "unauthorized",
    });

    const result = await runDiagnostics({
      provider: "custom",
      customProtocol: "openai",
      apiKey: "sk-bad",
      baseUrl,
      captureModels: true,
    });

    const auth = result.steps.find((s) => s.name === "auth");
    expect(auth?.status).toBe("fail");
    expect(auth?.fix).toBe("auth_invalid_key");
    expect(result.modelsSource).toBe("error");
    expect(result.modelsError).toBe("invalid api key");
  });

  it("maps a missing key to its own fix code", async () => {
    listProviderModelsMock.mockResolvedValue({
      ok: false,
      source: "error",
      filtered: 0,
      models: [],
      error: "No API key provided",
      errorType: "missing_key",
    });

    const result = await runDiagnostics({
      provider: "custom",
      customProtocol: "openai",
      apiKey: "",
      baseUrl,
      captureModels: true,
    });

    expect(result.steps.find((s) => s.name === "auth")?.fix).toBe(
      "missing_api_key",
    );
  });

  it("adds no model fields when capture is off", async () => {
    listProviderModelsMock.mockResolvedValue({
      ok: true,
      source: "live",
      filtered: 0,
      models: [{ id: "deepseek-chat", label: "deepseek-chat" }],
    });

    const result = await runDiagnostics({
      provider: "custom",
      customProtocol: "openai",
      apiKey: "sk-test",
      baseUrl,
    });

    expect(result.models).toBeUndefined();
    expect(result.modelsSource).toBeUndefined();
  });
});
