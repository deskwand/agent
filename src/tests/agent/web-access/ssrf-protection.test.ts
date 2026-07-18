import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  fetchRemoteUrl,
  validateRemoteUrl,
} from "../../../main/agent/tools/web-access/ssrf-protection";
import { publicLookup } from "./test-fixtures";

describe("SSRF protection", () => {
  it.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://2130706433/",
  ])("blocks internal target %s", async (url) => {
    await expect(
      validateRemoteUrl(url, { lookup: publicLookup }),
    ).rejects.toThrow(/internal|Blocked/);
  });

  it("blocks hostnames resolving to private addresses", async () => {
    await expect(
      validateRemoteUrl("https://example.test/", {
        lookup: async () => [{ address: "192.168.0.2", family: 4 }],
      }),
    ).rejects.toThrow(/192\.168\.0\.2/);
  });

  it("permits public HTTP and HTTPS targets", async () => {
    await expect(
      validateRemoteUrl("https://example.com/path", { lookup: publicLookup }),
    ).resolves.toMatchObject({ hostname: "example.com" });
    await expect(
      validateRemoteUrl("http://93.184.216.34/"),
    ).resolves.toMatchObject({ hostname: "93.184.216.34" });
  });

  it("passes the validated DNS addresses to the actual request", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("Unpinned fetch path used");
    };
    const fetchResolved = async (
      _url: URL,
      _init: RequestInit,
      addresses: Array<{ address: string; family: number }>,
    ) => {
      expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
      return new Response("ok");
    };

    await expect(
      fetchRemoteUrl(
        "https://example.com/",
        {},
        {
          lookup: publicLookup,
          fetch: fetchImpl,
          fetchResolved,
        },
      ),
    ).resolves.toBeInstanceOf(Response);
  });

  it("connects to the pinned address while preserving the public host", async () => {
    const server = createServer((request, response) => {
      response.end(
        `${request.headers.host || ""}|${request.headers["accept-encoding"] || ""}`,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Missing test server address");
    }

    try {
      const response = await fetchRemoteUrl(
        `http://safe.example.test:${address.port}/`,
        {},
        {
          lookup: async () => [{ address: "127.0.0.1", family: 4 }],
          allowRanges: ["127.0.0.1/32"],
        },
      );
      expect(await response.text()).toBe(
        `safe.example.test:${address.port}|identity`,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("skips all SSRF checks when ssrfEnabled is false", async () => {
    // internal hostnames that would normally be blocked
    await expect(
      validateRemoteUrl("http://localhost/", {
        lookup: publicLookup,
        ssrfEnabled: false,
      }),
    ).resolves.toMatchObject({ hostname: "localhost" });

    await expect(
      validateRemoteUrl("http://192.168.1.1/", {
        ssrfEnabled: false,
      }),
    ).resolves.toMatchObject({ hostname: "192.168.1.1" });

    // DNS-resolved private addresses also pass through
    await expect(
      validateRemoteUrl("https://private.example/", {
        lookup: async () => [{ address: "10.0.0.5", family: 4 }],
        ssrfEnabled: false,
      }),
    ).resolves.toMatchObject({ hostname: "private.example" });
  });

  it("validates redirect targets before following", async () => {
    const requested: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requested.push(input.toString());
      return new Response("", {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      });
    };

    await expect(
      fetchRemoteUrl(
        "https://example.com/",
        {},
        { lookup: publicLookup, fetch: fetchImpl },
      ),
    ).rejects.toThrow(/Blocked internal address/);
    expect(requested).toEqual(["https://example.com/"]);
  });
});
