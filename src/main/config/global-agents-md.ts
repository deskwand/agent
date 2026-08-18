import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logWarn } from "../utils/logger";

export function getGlobalAgentsMdPath(): string {
  return path.join(os.homedir(), ".deskwand", "AGENTS.md");
}

export function readGlobalAgentsMd(): {
  path: string;
  content: string;
} | null {
  const filePath = getGlobalAgentsMdPath();
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return { path: filePath, content: fs.readFileSync(filePath, "utf-8") };
  } catch (error) {
    logWarn("[global-agents-md] read failed:", error);
    return null;
  }
}

export function writeGlobalAgentsMd(content: string): {
  ok: boolean;
  error?: string;
} {
  const filePath = getGlobalAgentsMdPath();
  const tmpPath = `${filePath}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmpPath, content, "utf-8");
    fs.renameSync(tmpPath, filePath);
    return { ok: true };
  } catch (error) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.rmSync(tmpPath, { force: true });
      }
    } catch {
      // ignore cleanup failure
    }
    logWarn("[global-agents-md] write failed:", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildAgentsFilesOverride(): (base: {
  agentsFiles: Array<{ path: string; content: string }>;
}) => { agentsFiles: Array<{ path: string; content: string }> } {
  return (base) => {
    try {
      const file = readGlobalAgentsMd();
      if (!file || !file.content.trim()) {
        return base;
      }
      return {
        agentsFiles: [
          { path: file.path, content: file.content },
          ...base.agentsFiles,
        ],
      };
    } catch {
      return base; // fail-closed：任何异常都不影响会话创建
    }
  };
}
