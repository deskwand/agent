import { closeSync, existsSync, openSync, readSync } from "node:fs";

const LEGACY_MEMORY_CONTEXT_MARKER = "<memory_context>";
const SESSION_SCAN_BUFFER_BYTES = 64 * 1024;

export function piSessionFileContainsLegacyMemoryContext(
  filePath?: string | null,
): boolean {
  if (!filePath || !existsSync(filePath)) return false;

  let fileDescriptor: number | undefined;
  try {
    fileDescriptor = openSync(filePath, "r");
    const buffer = Buffer.allocUnsafe(SESSION_SCAN_BUFFER_BYTES);
    let carry = "";
    let bytesRead = 0;

    do {
      bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, null);
      const text = carry + buffer.toString("utf8", 0, bytesRead);
      if (text.includes(LEGACY_MEMORY_CONTEXT_MARKER)) {
        return true;
      }
      carry = text.slice(-(LEGACY_MEMORY_CONTEXT_MARKER.length - 1));
    } while (bytesRead > 0);

    return false;
  } catch {
    return true;
  } finally {
    if (fileDescriptor !== undefined) {
      try {
        closeSync(fileDescriptor);
      } catch {
        // The scan result has already been determined.
      }
    }
  }
}
