import { describe, it, expect, vi, afterEach } from "vitest";
import { CloudApiClient } from "../src/renderer/services/cloud-api";

describe("CloudApiClient topup methods", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("createTopUpOrder posts snake_case body and unwraps { order }", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        capturedUrl = String(url);
        capturedBody = String(init.body);
        return new Response(
          JSON.stringify({
            order: {
              id: "o1",
              chain: "bsc",
              amount_cents: 1000,
              deposit_address: "0xabc",
              expires_at: "2026-08-01 12:00:00",
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const api = new CloudApiClient("tok");
    const order = await api.createTopUpOrder(1000, "bsc");

    expect(order.id).toBe("o1");
    expect(order.deposit_address).toBe("0xabc");
    expect(capturedUrl).toBe("https://api.deskwand.com/api/payments/orders");
    expect(JSON.parse(capturedBody)).toEqual({
      amount_cents: 1000,
      chain: "bsc",
    });
  });

  it("getTopUpOrder GETs the order and unwraps { order }", async () => {
    let capturedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        capturedUrl = String(url);
        return new Response(
          JSON.stringify({
            order: {
              id: "o1",
              status: "pending",
              credits: 0,
              tx_hash: "",
              confirmed_at: null,
              expires_at: "2026-08-01 12:00:00",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const api = new CloudApiClient("tok");
    const order = await api.getTopUpOrder("o1");

    expect(capturedUrl).toBe("https://api.deskwand.com/api/payments/orders/o1");
    expect(order.status).toBe("pending");
  });

  it("getMe returns credits balance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              email: "a@b.com",
              level: "default",
              credits_balance: 100,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const api = new CloudApiClient("tok");
    const me = await api.getMe();

    expect(me.credits_balance).toBe(100);
  });

  it("getTopUpOrders requests list without query when empty", async () => {
    let capturedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        capturedUrl = String(url);
        return new Response(JSON.stringify({ orders: [], has_more: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const api = new CloudApiClient("tok");
    const res = await api.getTopUpOrders({});

    expect(capturedUrl).toBe("https://api.deskwand.com/api/payments/orders");
    expect(res.orders).toEqual([]);
    expect(res.has_more).toBe(false);
  });

  it("getTopUpOrders appends limit and offset query params", async () => {
    let capturedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        capturedUrl = String(url);
        return new Response(JSON.stringify({ orders: [], has_more: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const api = new CloudApiClient("tok");
    await api.getTopUpOrders({ limit: 20, offset: 40 });

    const u = new URL(capturedUrl);
    expect(u.pathname).toBe("/api/payments/orders");
    expect(u.searchParams.get("limit")).toBe("20");
    expect(u.searchParams.get("offset")).toBe("40");
  });
});
