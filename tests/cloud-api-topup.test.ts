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

  it("getMe returns free quota fields in snake_case", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              email: "a@b.com",
              level: "default",
              credits_balance: 100,
              free_credits_remaining: 2000,
              free_quota_expires_at: "2026-08-31 00:00:00",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const api = new CloudApiClient("tok");
    const me = await api.getMe();

    expect(me.free_credits_remaining).toBe(2000);
    expect(me.free_quota_expires_at).toBe("2026-08-31 00:00:00");
  });
});
