import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import { Readable } from "node:stream";
import { protocol } from "electron";
import {
  buildLocalVideoUrl,
  getVideoMimeType,
  isKnownVideoFile,
} from "../shared/video-file";

export const VIDEO_PROTOCOL_SCHEME = "deskwand-media";

const videoUrlSecret = randomBytes(32);

function signVideoPath(filePath: string): string {
  return createHmac("sha256", videoUrlSecret)
    .update(filePath)
    .digest("base64url");
}

function hasValidSignature(filePath: string, signature: string): boolean {
  const expectedSignature = signVideoPath(filePath);
  if (signature.length !== expectedSignature.length) return false;
  return timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature),
  );
}

export function createVideoSourceUrl(filePath: string): string {
  const normalizedPath = normalize(filePath);
  return buildLocalVideoUrl(normalizedPath, signVideoPath(normalizedPath));
}

type VideoByteRange =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

export function parseVideoByteRange(
  header: string | null,
  size: number,
): VideoByteRange {
  if (!header) return { kind: "full" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size <= 0) return { kind: "unsatisfiable" };

  const [, startText, endText] = match;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { kind: "unsatisfiable" };
    }
    return {
      kind: "partial",
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    };
  }

  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return { kind: "unsatisfiable" };
  }

  return {
    kind: "partial",
    start,
    end: Math.min(requestedEnd, size - 1),
  };
}

function errorResponse(status: number): Response {
  return new Response(null, { status });
}

function toResponseBody(
  filePath: string,
  start: number,
  end: number,
): BodyInit {
  const nodeStream = createReadStream(filePath, { start, end });
  return Readable.toWeb(nodeStream) as unknown as BodyInit;
}

export async function handleVideoRequest(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse(405);
  }

  let filePath: string;
  try {
    const url = new URL(request.url);
    const requestedPath = url.searchParams.get("path");
    const signature = url.searchParams.get("signature");
    if (
      url.protocol !== `${VIDEO_PROTOCOL_SCHEME}:` ||
      url.hostname !== "local" ||
      !requestedPath ||
      !signature ||
      !hasValidSignature(requestedPath, signature)
    ) {
      return errorResponse(403);
    }
    if (!isAbsolute(requestedPath) || !isKnownVideoFile(requestedPath)) {
      return errorResponse(400);
    }
    filePath = normalize(requestedPath);
  } catch {
    return errorResponse(400);
  }

  let fileSize: number;
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return errorResponse(400);
    fileSize = fileStat.size;
  } catch {
    return errorResponse(404);
  }

  const range = parseVideoByteRange(request.headers.get("range"), fileSize);
  if (range.kind === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${fileSize}` },
    });
  }

  const start = range.kind === "partial" ? range.start : 0;
  const end = range.kind === "partial" ? range.end : Math.max(0, fileSize - 1);
  const contentLength = fileSize === 0 ? 0 : end - start + 1;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Length": String(contentLength),
    "Content-Type": getVideoMimeType(filePath),
  });
  if (range.kind === "partial") {
    headers.set("Content-Range", `bytes ${start}-${end}/${fileSize}`);
  }

  const body =
    request.method === "HEAD" || fileSize === 0
      ? null
      : toResponseBody(filePath, start, end);
  return new Response(body, {
    status: range.kind === "partial" ? 206 : 200,
    headers,
  });
}

export function registerVideoProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: VIDEO_PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
      },
    },
  ]);
}

export async function installVideoProtocol(): Promise<void> {
  await protocol.handle(VIDEO_PROTOCOL_SCHEME, handleVideoRequest);
}
