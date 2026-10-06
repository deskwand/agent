import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_INLINE_ARTIFACT_BYTES,
  buildArtifactCsp,
  createArtifactUrl,
  getArtifactMimeType,
  isInlineArtifactPath,
  parseArtifactUrl,
  resolveArtifactFilePath,
  resolveArtifactRenderUrl,
  serveArtifactFile,
  verifyArtifactUrl,
} from "../../main/artifact-protocol";

function makeDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "artifact-protocol-")));
}

describe("isInlineArtifactPath", () => {
  it("accepts html and svg regardless of case", () => {
    expect(isInlineArtifactPath("/w/report.html")).toBe(true);
    expect(isInlineArtifactPath("/w/report.HTML")).toBe(true);
    expect(isInlineArtifactPath("/w/chart.svg")).toBe(true);
  });

  it("rejects other extensions and no extension", () => {
    expect(isInlineArtifactPath("/w/notes.md")).toBe(false);
    expect(isInlineArtifactPath("/w/data.json")).toBe(false);
    expect(isInlineArtifactPath("/w/README")).toBe(false);
  });
});

describe("getArtifactMimeType", () => {
  it("maps the entry documents", () => {
    expect(getArtifactMimeType("/w/a.html")).toBe("text/html; charset=utf-8");
    expect(getArtifactMimeType("/w/a.svg")).toBe("image/svg+xml");
  });

  it("maps sibling images so a reported chart can load", () => {
    expect(getArtifactMimeType("/w/chart.png")).toBe("image/png");
    expect(getArtifactMimeType("/w/pic.JPG")).toBe("image/jpeg");
    expect(getArtifactMimeType("/w/pic.webp")).toBe("image/webp");
  });

  it("returns null for things that must not be served", () => {
    expect(getArtifactMimeType("/w/styles.css")).toBeNull();
    expect(getArtifactMimeType("/w/notes.md")).toBeNull();
    expect(getArtifactMimeType("/w/data.json")).toBeNull();
  });
});

describe("buildArtifactCsp", () => {
  it("lists exactly the directives we need", () => {
    const csp = buildArtifactCsp();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'unsafe-inline'");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain("img-src deskwand-artifact: data:");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-src 'none'");
  });

  it("does not open sources we deliberately left closed", () => {
    const csp = buildArtifactCsp();
    expect(csp).not.toContain("media-src");
    expect(csp).not.toContain("font-src");
    expect(csp).not.toContain("blob:");
    expect(csp).not.toContain("'self'");
  });
});

describe("createArtifactUrl / parseArtifactUrl / verifyArtifactUrl", () => {
  it("round-trips a file and signs its directory", () => {
    const dir = makeDir();
    writeFileSync(join(dir, "report.html"), "<h1>hi</h1>");
    const url = createArtifactUrl(join(dir, "report.html"));
    expect(url).not.toBeNull();

    const parsed = parseArtifactUrl(url as string);
    expect(parsed).not.toBeNull();
    expect(parsed?.relativePath).toBe("report.html");
    expect(verifyArtifactUrl(parsed!.rootRef, parsed!.sig)).toBe(dir);
  });

  it("resolves an alias to the real file name", () => {
    const dir = makeDir();
    writeFileSync(join(dir, "real.html"), "<h1>hi</h1>");
    symlinkSync(join(dir, "real.html"), join(dir, "alias.html"));
    const url = createArtifactUrl(join(dir, "alias.html"));
    const parsed = parseArtifactUrl(url as string);
    expect(parsed?.relativePath).toBe("real.html");
  });

  it("rejects a tampered or truncated signature", () => {
    const dir = makeDir();
    writeFileSync(join(dir, "report.html"), "<h1>hi</h1>");
    const parsed = parseArtifactUrl(
      createArtifactUrl(join(dir, "report.html"))!,
    );
    expect(
      verifyArtifactUrl(parsed!.rootRef, "x".repeat(parsed!.sig.length)),
    ).toBeNull();
    expect(
      verifyArtifactUrl(parsed!.rootRef, parsed!.sig.slice(0, 8)),
    ).toBeNull();
  });

  it("returns null for non-inline extensions and missing files", () => {
    const dir = makeDir();
    writeFileSync(join(dir, "notes.md"), "# hi");
    expect(createArtifactUrl(join(dir, "notes.md"))).toBeNull();
    expect(createArtifactUrl(join(dir, "ghost.html"))).toBeNull();
  });

  it("rejects urls whose scheme, host, or shape is wrong", () => {
    expect(parseArtifactUrl("https://local/a/b/c")).toBeNull();
    expect(parseArtifactUrl("deskwand-artifact://elsewhere/a/b/c")).toBeNull();
    expect(parseArtifactUrl("deskwand-artifact://local/only-one")).toBeNull();
  });
});

describe("resolveArtifactFilePath", () => {
  it("resolves a sibling file inside the root", () => {
    const dir = makeDir();
    writeFileSync(join(dir, "chart.svg"), "<svg/>");
    expect(resolveArtifactFilePath(dir, "chart.svg")).toBe(
      join(dir, "chart.svg"),
    );
  });

  it("resolves a nested file inside the root", () => {
    const dir = makeDir();
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "chart.svg"), "<svg/>");
    expect(resolveArtifactFilePath(dir, "assets/chart.svg")).toBe(
      join(dir, "assets", "chart.svg"),
    );
  });

  it("rejects escaping the root", () => {
    const dir = makeDir();
    expect(resolveArtifactFilePath(dir, "../outside.html")).toBeNull();
  });

  it("rejects a symlink pointing outside the root", () => {
    const dir = makeDir();
    const outside = makeDir();
    writeFileSync(join(outside, "secret.html"), "<h1>secret</h1>");
    symlinkSync(join(outside, "secret.html"), join(dir, "evil.html"));
    expect(resolveArtifactFilePath(dir, "evil.html")).toBeNull();
  });
});

describe("resolveArtifactRenderUrl", () => {
  it("returns a url for a small html file", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "report.html"), "<h1>hi</h1>");
    const url = await resolveArtifactRenderUrl(join(dir, "report.html"));
    expect(url).toContain("deskwand-artifact://local/");
  });

  it("returns null for wrong extension, missing file, and oversized file", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "notes.md"), "# hi");
    writeFileSync(
      join(dir, "big.html"),
      "x".repeat(MAX_INLINE_ARTIFACT_BYTES + 1),
    );
    expect(await resolveArtifactRenderUrl(join(dir, "notes.md"))).toBeNull();
    expect(await resolveArtifactRenderUrl(join(dir, "ghost.html"))).toBeNull();
    expect(await resolveArtifactRenderUrl(join(dir, "big.html"))).toBeNull();
  });
});

describe("serveArtifactFile", () => {
  function signedParts(filePath: string): {
    rootRef: string;
    sig: string;
    relativePath: string;
  } {
    const parsed = parseArtifactUrl(createArtifactUrl(filePath)!);
    return parsed!;
  }

  it("serves the file with csp and hardening headers", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "report.html"), "<h1>hi</h1>");
    const { rootRef, sig, relativePath } = signedParts(join(dir, "report.html"));

    const response = await serveArtifactFile(rootRef, sig, relativePath);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("<h1>hi</h1>");
  });

  it("serves a sibling svg inside the signed directory", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "report.html"), "<h1>hi</h1>");
    writeFileSync(join(dir, "chart.svg"), "<svg/>");
    const { rootRef, sig } = signedParts(join(dir, "report.html"));

    const response = await serveArtifactFile(rootRef, sig, "chart.svg");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
  });

  it("serves a sibling png so a reported chart loads", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "report.html"), "<h1>hi</h1>");
    writeFileSync(join(dir, "chart.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { rootRef, sig } = signedParts(join(dir, "report.html"));

    const response = await serveArtifactFile(rootRef, sig, "chart.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
  });

  it("refuses a sibling stylesheet", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "report.html"), "<h1>hi</h1>");
    writeFileSync(join(dir, "styles.css"), "h1{color:red}");
    const { rootRef, sig } = signedParts(join(dir, "report.html"));

    const response = await serveArtifactFile(rootRef, sig, "styles.css");
    expect(response.status).toBe(415);
  });

  it("returns 403 for a bad signature", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "report.html"), "<h1>hi</h1>");
    const { rootRef, relativePath } = signedParts(join(dir, "report.html"));

    const response = await serveArtifactFile(rootRef, "nope", relativePath);
    expect(response.status).toBe(403);
  });

  it("returns 403 for a path escaping the signed directory", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "report.html"), "<h1>hi</h1>");
    const { rootRef, sig } = signedParts(join(dir, "report.html"));

    const response = await serveArtifactFile(rootRef, sig, "../outside.html");
    expect(response.status).toBe(403);
  });

  it("returns 415 for a non-inline extension inside the directory", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "report.html"), "<h1>hi</h1>");
    writeFileSync(join(dir, "notes.md"), "# hi");
    const { rootRef, sig } = signedParts(join(dir, "report.html"));

    const response = await serveArtifactFile(rootRef, sig, "notes.md");
    expect(response.status).toBe(415);
  });

  it("returns 413 for a file over the size cap", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "report.html"), "<h1>hi</h1>");
    writeFileSync(
      join(dir, "big.html"),
      "x".repeat(MAX_INLINE_ARTIFACT_BYTES + 1),
    );
    const { rootRef, sig } = signedParts(join(dir, "report.html"));

    const response = await serveArtifactFile(rootRef, sig, "big.html");
    expect(response.status).toBe(413);
  });
});
