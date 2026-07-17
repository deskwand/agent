import { platform } from "os";
import { existsSync } from "fs";
import { join } from "path";
import { app } from "electron";

const GIT_BASH_PATHS = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
];

function findGitBash(): string | null {
  for (const p of GIT_BASH_PATHS) {
    if (existsSync(p)) return p;
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const p = join(localAppData, "Programs", "Git", "bin", "bash.exe");
    if (existsSync(p)) return p;
  }
  return null;
}

function findBusybox(): string | null {
  try {
    // Packaged: busybox lives in <resources>/busybox/busybox.exe
    if (app.isPackaged) {
      const p = join(app.getAppPath(), "..", "busybox", "busybox.exe");
      if (existsSync(p)) return p;
    }
    // Development: resources/busybox/win32-x64/busybox.exe relative to project root
    const devPath = join(
      app.getAppPath(),
      "resources",
      "busybox",
      "win32-x64",
      "busybox.exe",
    );
    if (existsSync(devPath)) return devPath;
  } catch {
    // app.getAppPath() may throw before app is ready
  }
  return null;
}

/**
 * Returns the appropriate shell for the current platform.
 * Windows: Git Bash → busybox ash → cmd.exe
 * Unix: SHELL env var or /bin/bash
 */
export function getDefaultShell(): string {
  if (platform() === "win32") {
    const gitBash = findGitBash();
    if (gitBash) return gitBash;

    const busybox = findBusybox();
    if (busybox) return busybox;

    return process.env.COMSPEC || "cmd.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

/**
 * Returns shell execution arguments for running a command string.
 * bash/ash: ['-c', command]
 * cmd: ['/c', command]
 * busybox: ['ash', '-c', command]
 */
export function getShellArgs(command: string): [string, string[]] {
  const shell = getDefaultShell();
  if (platform() === "win32") {
    if (shell.endsWith("busybox.exe")) {
      return [shell, ["ash", "-c", command]];
    }
    const isBash = shell.toLowerCase().includes("bash");
    return [shell, [isBash ? "-c" : "/c", command]];
  }
  return [shell, ["-c", command]];
}
