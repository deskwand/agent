/**
 * @module main/artifact-protocol
 *
 * 内联产物的取文件协议。与 `video-protocol` 同一模式（自定义 scheme + 签名 URL），
 * 但多两件事：
 *
 * 1. **目录作用域**：签名绑定产物所在目录，而不是文件本身。产物引用同目录的
 *    `chart.svg` 时，相对解析后仍是同一 rootRef 与 sig，签名不会失配。
 * 2. **CSP 响应头**：产物是模型写的不可信内容，用响应头而不是 `file://` 来定边界。
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, normalize } from "node:path";
import { protocol } from "electron";
import { isPathWithinRoot } from "./tools/path-containment";
import { logError } from "./utils/logger";

export const ARTIFACT_PROTOCOL_SCHEME = "deskwand-artifact";
export const MAX_INLINE_ARTIFACT_BYTES = 5 * 1024 * 1024;

/** 入口文档白名单：只有这两种能被标成 inline。 */
const ENTRY_ARTIFACT_EXTENSIONS = [".html", ".svg"] as const;

/**
 * 子资源 MIME 表。比入口白名单宽：产物引用同目录的图片是最常见的形态
 * （"一个 HTML + 一个 PNG 图表"），只放行入口那两种会让图片全裂。
 * CSS 不在表内——必须内联，否则还要给 CSP 开 style-src 的 scheme 源。
 */
const ARTIFACT_MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** 进程内随机密钥：应用重启即失效，不需要吊销机制。 */
const artifactUrlSecret = randomBytes(32);

function extensionOf(filePath: string): string {
  const name = basename(filePath);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

export function isInlineArtifactPath(filePath: string): boolean {
  return (ENTRY_ARTIFACT_EXTENSIONS as readonly string[]).includes(
    extensionOf(filePath),
  );
}

export function getArtifactMimeType(filePath: string): string | null {
  return ARTIFACT_MIME_TYPES[extensionOf(filePath)] ?? null;
}

/**
 * CSP 里必须**显式写 scheme**，不能写 `'self'`：iframe 是 opaque origin，
 * `'self'` 匹配不到自定义 scheme，产物会静默白屏。（spike 实测：写成 scheme 源，
 * 同目录图片正常加载。）
 *
 * 只列真正需要的 source。`media-src` / `font-src` / `blob:` 是猜的，不加。
 */
export function buildArtifactCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src deskwand-artifact: data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
  ].join("; ");
}

function signRoot(rootRef: string): string {
  return createHmac("sha256", artifactUrlSecret)
    .update(rootRef)
    .digest("base64url");
}

/** 产物文件的绝对路径 → 渲染 URL。非内联扩展名、文件不存在、realpath 失败均返回 null。 */
export function createArtifactUrl(filePath: string): string | null {
  if (!isInlineArtifactPath(filePath)) return null;
  let realFile: string;
  try {
    // realpath 同时归一小写差异与符号链接——模型给的路径未必等于磁盘上的名字
    realFile = realpathSync(filePath);
  } catch {
    return null;
  }
  const rootRef = Buffer.from(dirname(realFile), "utf8").toString("base64url");
  const name = encodeURIComponent(basename(realFile));
  return `${ARTIFACT_PROTOCOL_SCHEME}://local/${rootRef}/${signRoot(rootRef)}/${name}`;
}

/** 校验签名，返回签名覆盖的目录绝对路径；校验失败返回 null。 */
export function verifyArtifactUrl(rootRef: string, sig: string): string | null {
  const expected = signRoot(rootRef);
  if (sig.length !== expected.length) return null;
  if (
    !timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))
  ) {
    return null;
  }
  const root = Buffer.from(rootRef, "base64url").toString("utf8");
  return root || null;
}

export function parseArtifactUrl(
  rawUrl: string,
): { rootRef: string; sig: string; relativePath: string } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${ARTIFACT_PROTOCOL_SCHEME}:`) return null;
  if (url.host !== "local") return null;

  let segments: string[];
  try {
    segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segments.length < 3) return null;

  const [rootRef, sig, ...rest] = segments;
  return { rootRef, sig, relativePath: rest.join("/") };
}

/**
 * root 内解析相对路径。两道关卡：先按字面路径判包含（挡 `../`），
 * 再对 realpath 判一次（挡指向外部的符号链接）。
 */
export function resolveArtifactFilePath(
  root: string,
  relativePath: string,
): string | null {
  const lexical = normalize(join(root, relativePath));
  if (!isPathWithinRoot(lexical, root)) return null;

  let real: string;
  try {
    real = realpathSync(lexical);
  } catch {
    return null;
  }
  if (!isPathWithinRoot(real, root)) return null;
  return real;
}

/** IPC 入口：把产物路径换成可渲染 URL。所有拒绝都返回 null，不抛错。 */
export async function resolveArtifactRenderUrl(
  filePath: string,
): Promise<string | null> {
  if (!isInlineArtifactPath(filePath)) return null;
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size > MAX_INLINE_ARTIFACT_BYTES) return null;
  } catch {
    return null;
  }
  return createArtifactUrl(filePath);
}

export async function serveArtifactFile(
  rootRef: string,
  sig: string,
  relativePath: string,
): Promise<Response> {
  const root = verifyArtifactUrl(rootRef, sig);
  if (!root) return new Response("Forbidden", { status: 403 });

  const filePath = resolveArtifactFilePath(root, relativePath);
  if (!filePath) return new Response("Forbidden", { status: 403 });

  const mime = getArtifactMimeType(filePath);
  if (!mime) return new Response("Unsupported type", { status: 415 });

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    if (info.size > MAX_INLINE_ARTIFACT_BYTES) {
      return new Response("Too large", { status: 413 });
    }
    const body = await readFile(filePath);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Security-Policy": buildArtifactCsp(),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logError("[ArtifactProtocol] Failed to read artifact:", error);
    return new Response("Not found", { status: 404 });
  }
}

export function registerArtifactProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ARTIFACT_PROTOCOL_SCHEME,
      privileges: { standard: true, secure: true },
    },
  ]);
}

export async function installArtifactProtocol(): Promise<void> {
  await protocol.handle(ARTIFACT_PROTOCOL_SCHEME, async (request) => {
    const parsed = parseArtifactUrl(request.url);
    if (!parsed) return new Response("Bad request", { status: 400 });
    return serveArtifactFile(parsed.rootRef, parsed.sig, parsed.relativePath);
  });
}
