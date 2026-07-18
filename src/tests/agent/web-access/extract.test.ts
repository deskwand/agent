import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  execFile: vi.fn((..._args: unknown[]) => undefined),
}));

vi.mock("node:child_process", () => ({
  execFile: childProcessMocks.execFile,
}));
import {
  extractContent,
  type ExtractOptions,
} from "../../../main/agent/tools/web-access/extract";
import {
  extractGitHub,
  parseGitHubUrl,
} from "../../../main/agent/tools/web-access/github-extract";
import type { WebSearchRuntime } from "../../../main/agent/tools/web-access/gemini-search";
import { makePdf, publicLookup } from "./test-fixtures";

const runtime: WebSearchRuntime = { defaultProvider: "auto" };
const extractionOptions = (): ExtractOptions => ({
  workspaceDir: process.cwd(),
  tempDir: join(tmpdir(), "deskwand-web-access-test"),
  runtime,
  lookup: publicLookup,
  fetch: globalThis.fetch,
});

function stubHtml(html: string, jina?: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith("https://r.jina.ai/")) {
        return new Response(jina ?? "", {
          status: jina ? 200 : 503,
          headers: { "content-type": "text/markdown" },
        });
      }
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  childProcessMocks.execFile.mockReset();
});

describe("content extraction", () => {
  it("extracts a readable HTML article as Markdown", async () => {
    stubHtml(
      `<html><head><title>Guide</title></head><body><article><h1>Guide</h1><p>${"Useful text ".repeat(60)}</p></article></body></html>`,
    );
    const result = await extractContent(
      "https://example.com/guide",
      undefined,
      extractionOptions(),
    );
    expect(result.error).toBeNull();
    expect(result.title).toContain("Guide");
    expect(result.content).toContain("Useful text");
  });

  it("returns a structured blocked error when HTTP and Jina access fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).startsWith("https://r.jina.ai/")
          ? new Response("blocked", { status: 503 })
          : new Response("forbidden", { status: 403 }),
      ),
    );
    const result = await extractContent(
      "https://example.com/forbidden",
      undefined,
      extractionOptions(),
    );
    expect(result.errorCode).toBe("FETCH_BLOCKED");
  });

  it("uses Jina after recoverable Readability failure", async () => {
    stubHtml(
      "<html><body>cookie notice</body></html>",
      `# Recovered\n\n${"Useful content ".repeat(50)}`,
    );
    const result = await extractContent(
      "https://example.com/blocked",
      undefined,
      extractionOptions(),
    );
    expect(result.content).toContain("Recovered");
  });

  it("routes PDF responses to in-memory extraction", async () => {
    const pdf = makePdf("PDF text");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(pdf, {
            status: 200,
            headers: { "content-type": "application/pdf" },
          }),
      ),
    );
    const result = await extractContent(
      "https://example.com/file.pdf",
      undefined,
      extractionOptions(),
    );
    expect(result.content).toContain("PDF text");
  });

  it("cancels a response rejected by its declared content length", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: {
              "content-type": "text/html",
              "content-length": String(6 * 1024 * 1024),
            },
          }),
      ),
    );

    const result = await extractContent(
      "https://example.com/declared-large",
      undefined,
      extractionOptions(),
    );

    expect(result.errorCode).toBe("CONTENT_TOO_LARGE");
    expect(cancelled).toBe(true);
  });

  it("stops streaming responses that exceed the content limit", async () => {
    let cancelled = false;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls <= 7) {
          controller.enqueue(new Uint8Array(1024 * 1024));
        } else {
          controller.close();
        }
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ),
    );

    const result = await extractContent(
      "https://example.com/large",
      undefined,
      extractionOptions(),
    );
    expect(result.errorCode).toBe("CONTENT_TOO_LARGE");
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(8);
  });

  it("distinguishes request timeout from caller cancellation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        );
      }),
    );
    const result = await extractContent(
      "https://example.com/slow",
      undefined,
      extractionOptions(),
    );
    expect(result.errorCode).toBe("REQUEST_TIMEOUT");
  });

  it("rejects YouTube as a deferred capability", async () => {
    const result = await extractContent(
      "https://youtube.com/watch?v=abc",
      undefined,
      extractionOptions(),
    );
    expect(result.errorCode).toBe("UNSUPPORTED_CONTENT");
  });
});

describe("GitHub extraction", () => {
  it("encodes decoded GitHub file paths exactly once", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request) => new Response("file content"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractGitHub(
      "https://github.com/owner/repo/blob/main/docs/file%20name-%E4%B8%AD.md",
      undefined,
      { tempDir: join(tmpdir(), "deskwand-web-access-path-test") },
    );

    expect(result?.content).toBe("file content");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/contents/docs/file%20name-%E4%B8%AD.md?ref=main",
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("%2520");
  });

  it("does not force-clone a repository above the absolute safety cap", async () => {
    childProcessMocks.execFile.mockImplementation((...args: unknown[]) => {
      const callback = args[3];
      if (typeof callback === "function") callback(null);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/repos/owner/huge-repo")) {
          return Response.json({ size: 2 * 1024 * 1024 });
        }
        return Response.json([
          { name: "README.md", path: "README.md", type: "file" },
        ]);
      }),
    );

    const result = await extractGitHub(
      "https://github.com/owner/huge-repo",
      undefined,
      { forceClone: true, tempDir: join(tmpdir(), "web-access-huge-test") },
    );

    expect(result?.content).toContain("README.md");
    expect(childProcessMocks.execFile).not.toHaveBeenCalled();
  });

  it("uses distinct clone directories for ambiguous owner and repository names", async () => {
    const root = join(tmpdir(), "deskwand-web-access-clone-collision-test");
    await rm(root, { recursive: true, force: true });
    const destinations: string[] = [];
    childProcessMocks.execFile.mockImplementation((...args: unknown[]) => {
      const gitArgs = args[1];
      const callback = args[3];
      if (!Array.isArray(gitArgs) || typeof callback !== "function") return;
      const destination = gitArgs.at(-1);
      if (typeof destination !== "string") return;
      destinations.push(destination);
      void mkdir(destination, { recursive: true })
        .then(() => writeFile(join(destination, "README.md"), destination))
        .then(() => callback(null))
        .catch((error: unknown) => callback(error));
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ size: 1 })),
    );

    try {
      await extractGitHub("https://github.com/a/b-c", undefined, {
        tempDir: root,
      });
      await extractGitHub("https://github.com/a-b/c", undefined, {
        tempDir: root,
      });
      expect(destinations).toHaveLength(2);
      expect(destinations[0]).not.toBe(destinations[1]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not follow a cloned README symlink outside the repository", async () => {
    const root = join(tmpdir(), "deskwand-web-access-symlink-test");
    const destination = join(root, "owner", "symlink-repo");
    await rm(root, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    await writeFile(join(root, "secret.txt"), "DO NOT EXPOSE");
    await writeFile(join(destination, "index.ts"), "export {};");
    await symlink("../../secret.txt", join(destination, "README.md"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ size: 1 })),
    );

    try {
      const result = await extractGitHub(
        "https://github.com/owner/symlink-repo",
        undefined,
        { tempDir: root },
      );
      expect(result?.content).toContain("README.md");
      expect(result?.content).not.toContain("DO NOT EXPOSE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to the public API when a repository clone fails", async () => {
    childProcessMocks.execFile.mockImplementation((...args: unknown[]) => {
      const callback = args[3];
      if (typeof callback === "function") callback(new Error("clone failed"));
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/repos/owner/fallback-repo")) {
          return Response.json({ size: 1 });
        }
        if (url.includes("/repos/owner/fallback-repo/contents")) {
          return Response.json([
            { name: "README.md", path: "README.md", type: "file" },
          ]);
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const result = await extractContent(
      "https://github.com/owner/fallback-repo",
      undefined,
      extractionOptions(),
    );
    expect(result.error).toBeNull();
    expect(result.content).toContain("README.md");
    expect(childProcessMocks.execFile).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["clone", "--depth", "1"]),
      expect.objectContaining({ timeout: 30_000 }),
      expect.any(Function),
    );
  });
});

describe("parseGitHubUrl", () => {
  it("parses repository, tree, and blob URLs", () => {
    expect(parseGitHubUrl("https://github.com/owner/repo")).toMatchObject({
      owner: "owner",
      repo: "repo",
      kind: "repo",
    });
    expect(
      parseGitHubUrl("https://github.com/owner/repo/tree/main/src"),
    ).toMatchObject({ kind: "tree", ref: "main", path: "src" });
    expect(
      parseGitHubUrl("https://github.com/owner/repo/blob/main/README.md"),
    ).toMatchObject({ kind: "blob", ref: "main", path: "README.md" });
  });
});
