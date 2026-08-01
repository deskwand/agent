import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PiMarketService } from "../../main/extensions/pi-market-service";

describe("PiMarketService", () => {
  let service: PiMarketService;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new PiMarketService();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("search builds URL with keywords filter, pagination and popularity sort", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        total: 6437,
        objects: [
          {
            package: {
              name: "pi-subagents",
              description: "subagents",
              version: "0.14.3",
              date: "2026-01-01",
              author: { name: "tintinweb", email: "t@t.io" },
              keywords: ["pi-extension", "pi-package"],
            },
          },
        ],
      }),
    });
    const result = await service.search("subagent", 1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("text=keywords%3Api-package%20subagent");
    expect(url).toContain("size=20");
    expect(url).toContain("from=20");
    expect(url).toContain("sort=popularity");
    expect(result.total).toBe(6437);
    expect(result.objects[0].name).toBe("pi-subagents");
    expect(result.objects[0].author).toBe("tintinweb"); // 对象归一化
    expect(result.objects[0].type).toBe("extension");   // keywords 推导
  });

  it("search returns 0 objects when api fails", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(service.search("x", 0)).rejects.toThrow();
  });

  it("download returns 0 on 404", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    expect(await service.download("pi-subagents")).toBe(0);
  });

  it("download encodes scoped names for the HTTP URL", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ downloads: 123 }),
    });
    await service.download("@scope/pkg");
    expect((fetchSpy.mock.calls[0][0] as string)).toContain("@scope%2Fpkg");
  });

  it("detail resolves relative gallery URLs against the registry origin", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        name: "pi-x",
        description: "d",
        version: "1.0.0",
        keywords: ["pi-package"],
        pi: { image: "banner.png" },
        repository: { url: "https://github.com/x/pi-x" },
      }),
    });
    const detail = await service.detail("pi-x");
    expect(detail?.gallery?.image).toBe("https://registry.npmjs.org/banner.png");
    expect(detail?.repository).toBe("https://github.com/x/pi-x");
  });

  it("detail returns null-ish behavior on failure (throws)", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    await expect(service.detail("nope")).rejects.toThrow();
  });
});
