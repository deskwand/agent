import { describe, expect, it, vi } from "vitest";
import { probeLocalGateway } from "../../main/config/local-gateway";

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("probeLocalGateway", () => {
  it("counts the models a running gateway lists", async () => {
    const fetchImpl = respond({
      data: [{ id: "auto/gpt-5.6-luna" }, { id: "opencode-go/kimi-k3" }],
    });
    const result = await probeLocalGateway(
      { baseUrl: "http://127.0.0.1:3425/v1", apiKey: "magpie" },
      { connectTcp: async () => true, fetchImpl },
    );

    expect(result).toEqual({ available: true, modelCount: 2 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:3425/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer magpie" },
      }),
    );
  });

  it("treats an auth rejection as a running gateway", async () => {
    const result = await probeLocalGateway(
      {},
      { connectTcp: async () => true, fetchImpl: respond({}, 401) },
    );
    expect(result).toEqual({ available: true });
  });

  it("reports unavailable when nothing listens on the port", async () => {
    const fetchImpl = vi.fn();
    const result = await probeLocalGateway(
      {},
      { connectTcp: async () => false, fetchImpl },
    );
    expect(result).toEqual({ available: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stays available when /models fails after TCP connected", async () => {
    const result = await probeLocalGateway(
      {},
      {
        connectTcp: async () => true,
        fetchImpl: vi.fn(async () => {
          throw new Error("timeout");
        }),
      },
    );
    expect(result).toEqual({ available: true });
  });

  it("stays available when the payload has no data array", async () => {
    const result = await probeLocalGateway(
      {},
      { connectTcp: async () => true, fetchImpl: respond({ object: "list" }) },
    );
    expect(result).toEqual({ available: true });
  });

  it("probes the base url the caller typed", async () => {
    const fetchImpl = respond({ data: [] });
    await probeLocalGateway(
      { baseUrl: "http://192.168.1.20:3425/v1" },
      { connectTcp: async () => true, fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://192.168.1.20:3425/v1/models",
      expect.anything(),
    );
  });

  it("strips IPv6 brackets before dialing", async () => {
    const connectTcp = vi.fn(async () => false);
    await probeLocalGateway(
      { baseUrl: "http://[::1]:3425/v1" },
      { connectTcp, fetchImpl: vi.fn() },
    );
    expect(connectTcp).toHaveBeenCalledWith("::1", 3425, expect.any(Number));
  });
});
