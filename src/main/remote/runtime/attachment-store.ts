import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import type { AttachmentSource, OutboundAttachment } from "./contracts";

export const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;
export const MAX_MESSAGE_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
export const DOWNLOAD_TIMEOUT_MS = 30_000;
export const MAX_CONCURRENT_DOWNLOADS = 4;

export type AttachmentErrorCode =
  | "ATTACHMENT_TOO_LARGE"
  | "ATTACHMENT_MESSAGE_TOO_LARGE"
  | "ATTACHMENT_PATH_ESCAPE"
  | "ATTACHMENT_SOURCE_INVALID"
  | "ATTACHMENT_PRIVATE_ADDRESS"
  | "ATTACHMENT_SOURCE_UNAVAILABLE"
  | "ATTACHMENT_DOWNLOAD_TIMEOUT";

export class AttachmentError extends Error {
  constructor(readonly code: AttachmentErrorCode, message: string) {
    super(message);
    this.name = "AttachmentError";
  }
}

interface DownloaderRegistration {
  channelInstanceId: string;
  generation: number;
  download: (signal: AbortSignal) => Promise<Buffer>;
}

export interface AttachmentStoreOptions {
  workspaceRoot: string;
  fetcher?: typeof fetch;
}

export class AttachmentStore {
  private readonly downloaders = new Map<string, DownloaderRegistration>();
  private activeDownloads = 0;
  private readonly waitingDownloads: Array<() => void> = [];

  constructor(private readonly options: AttachmentStoreOptions) {}

  async prepareOutbound(
    attachments: OutboundAttachment[],
  ): Promise<OutboundAttachment[]> {
    let totalBytes = 0;
    const prepared: OutboundAttachment[] = [];

    for (const attachment of attachments) {
      const sources = [attachment.data, attachment.path, attachment.sourceUrl];
      if (sources.filter((source) => source !== undefined).length !== 1) {
        throw new AttachmentError(
          "ATTACHMENT_SOURCE_INVALID",
          "Exactly one attachment source is required",
        );
      }

      let size = 0;
      if (attachment.data !== undefined) {
        const data = decodeBase64(attachment.data);
        size = data.byteLength;
      } else if (attachment.path !== undefined) {
        const safePath = await this.validateWorkspacePath(attachment.path);
        size = Number((await stat(safePath)).size);
        prepared.push({ ...attachment, path: safePath });
      } else if (attachment.sourceUrl !== undefined) {
        await this.validateSourceUrl(attachment.sourceUrl);
      }

      if (size > MAX_ATTACHMENT_BYTES) {
        throw new AttachmentError(
          "ATTACHMENT_TOO_LARGE",
          `Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`,
        );
      }
      totalBytes += size;
      if (totalBytes > MAX_MESSAGE_ATTACHMENT_BYTES) {
        throw new AttachmentError(
          "ATTACHMENT_MESSAGE_TOO_LARGE",
          `Message exceeds ${MAX_MESSAGE_ATTACHMENT_BYTES} bytes`,
        );
      }
      if (attachment.path === undefined) prepared.push(attachment);
    }

    return prepared;
  }

  registerDownloader(
    source: AttachmentSource,
    download: (signal: AbortSignal) => Promise<Buffer>,
  ): void {
    this.downloaders.set(this.key(source.channelInstanceId, source.sourceRef), {
      channelInstanceId: source.channelInstanceId,
      generation: source.generation,
      download,
    });
  }

  unregisterGeneration(channelInstanceId: string, generation: number): void {
    for (const [key, registration] of this.downloaders) {
      if (
        registration.channelInstanceId === channelInstanceId &&
        registration.generation === generation
      ) {
        this.downloaders.delete(key);
      }
    }
  }

  async downloadInbound(source: AttachmentSource): Promise<Buffer> {
    const registration = this.downloaders.get(
      this.key(source.channelInstanceId, source.sourceRef),
    );
    if (!registration || registration.generation !== source.generation) {
      throw new AttachmentError(
        "ATTACHMENT_SOURCE_UNAVAILABLE",
        "Attachment downloader is not registered",
      );
    }

    await this.acquireDownloadSlot();
    if (
      this.downloaders.get(this.key(source.channelInstanceId, source.sourceRef)) !==
      registration
    ) {
      this.releaseDownloadSlot();
      throw new AttachmentError(
        "ATTACHMENT_SOURCE_UNAVAILABLE",
        "Attachment downloader was unregistered while waiting",
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const data = await registration.download(controller.signal);
      if (data.byteLength > MAX_ATTACHMENT_BYTES) {
        throw new AttachmentError(
          "ATTACHMENT_TOO_LARGE",
          `Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`,
        );
      }
      return data;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AttachmentError(
          "ATTACHMENT_DOWNLOAD_TIMEOUT",
          "Attachment download timed out",
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      this.releaseDownloadSlot();
    }
  }

  private async validateWorkspacePath(path: string): Promise<string> {
    if (!isAbsolute(path)) {
      throw new AttachmentError(
        "ATTACHMENT_PATH_ESCAPE",
        "Attachment path must be absolute",
      );
    }
    const [root, resolved] = await Promise.all([
      realpath(this.options.workspaceRoot),
      realpath(path),
    ]);
    const relativePath = relative(root, resolved);
    if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new AttachmentError(
        "ATTACHMENT_PATH_ESCAPE",
        "Attachment path is outside the workspace",
      );
    }
    return resolved;
  }

  async downloadUrl(sourceUrl: string): Promise<Buffer> {
    await this.acquireDownloadSlot();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      let currentUrl = sourceUrl;
      for (
        let redirectCount = 0;
        redirectCount <= MAX_REDIRECTS;
        redirectCount += 1
      ) {
        await this.validateSourceUrl(currentUrl);
        const response = await (this.options.fetcher ?? fetch)(currentUrl, {
          redirect: "manual",
          signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location || redirectCount === MAX_REDIRECTS) {
            throw new AttachmentError(
              "ATTACHMENT_SOURCE_INVALID",
              "Too many redirects",
            );
          }
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }
        if (!response.ok || !response.body) {
          throw new AttachmentError(
            "ATTACHMENT_SOURCE_INVALID",
            "Attachment request failed",
          );
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        let reading = true;
        while (reading) {
          const part = await reader.read();
          if (part.done) {
            reading = false;
          } else {
            total += part.value.byteLength;
            if (total > MAX_ATTACHMENT_BYTES) {
              await reader.cancel();
              throw new AttachmentError(
                "ATTACHMENT_TOO_LARGE",
                `Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`,
              );
            }
            chunks.push(part.value);
          }
        }
        return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      }
      throw new AttachmentError("ATTACHMENT_SOURCE_INVALID", "Too many redirects");
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AttachmentError(
          "ATTACHMENT_DOWNLOAD_TIMEOUT",
          "Attachment download timed out",
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      this.releaseDownloadSlot();
    }
  }

  private async validateSourceUrl(sourceUrl: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      throw new AttachmentError("ATTACHMENT_SOURCE_INVALID", "Invalid URL");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new AttachmentError(
        "ATTACHMENT_SOURCE_INVALID",
        "Attachment URL must be HTTPS without credentials",
      );
    }

    const addresses = await lookup(parsed.hostname, { all: true });
    if (addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new AttachmentError(
        "ATTACHMENT_PRIVATE_ADDRESS",
        "Attachment URL resolves to a private address",
      );
    }
  }

  private async acquireDownloadSlot(): Promise<void> {
    if (this.activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
      this.activeDownloads += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waitingDownloads.push(resolve));
    this.activeDownloads += 1;
  }

  private releaseDownloadSlot(): void {
    this.activeDownloads -= 1;
    this.waitingDownloads.shift()?.();
  }

  private key(channelInstanceId: string, sourceRef: string): string {
    return `${channelInstanceId}:${sourceRef}`;
  }
}

function decodeBase64(value: string): Buffer {
  const data = Buffer.from(value, "base64");
  if (data.length === 0 && value.length > 0) {
    throw new AttachmentError("ATTACHMENT_SOURCE_INVALID", "Invalid base64 data");
  }
  return data;
}

function isPrivateAddress(address: string): boolean {
  if (address === "localhost" || address.endsWith(".localhost")) return true;
  const version = isIP(address);
  if (version === 4) {
    const [first, second] = address.split(".").map(Number);
    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      return isPrivateAddress(normalized.slice("::ffff:".length));
    }
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  return true;
}
