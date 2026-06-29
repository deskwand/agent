import { clipboard, dialog, ipcMain, shell } from "electron";
import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { getSharedAuthStorage } from "../agent/shared-auth";
import type { OAuthStatusResult } from "../../shared/ipc-types";

const SUPPORTED_OAUTH_PROVIDERS = [
  { id: "openai-codex", name: "OpenAI Codex" },
  { id: "github-copilot", name: "GitHub Copilot" },
  { id: "anthropic", name: "Anthropic" },
] as const;

function createOAuthCallbacks(): OAuthLoginCallbacks {
  return {
    onAuth: (info) => {
      void shell.openExternal(info.url);
    },

    onDeviceCode: (info) => {
      // Copy code to clipboard and show dialog before opening browser
      clipboard.writeText(info.userCode);
      void dialog.showMessageBox({
        type: "info",
        title: "Device Code",
        message: `Your verification code: ${info.userCode}`,
        detail: "The code has been copied to your clipboard. A browser window will open — paste the code there to complete login.",
        buttons: ["Open Browser"],
        defaultId: 0,
      }).then(() => {
        void shell.openExternal(info.verificationUri);
      });
    },

    onPrompt: async () => {
      throw new Error("Login cancelled");
    },

    onSelect: async (prompt) => {
      const id = prompt.options[0]?.id;
      if (!id) return undefined;
      return id;
    },
  };
}

async function handleLogin(
  _event: Electron.IpcMainInvokeEvent,
  providerId: string,
  force = false,
): Promise<void> {
  const authStorage = getSharedAuthStorage();

  if (!force) {
    const existing = authStorage.get(providerId);
    if (existing) {
      return;
    }
  }

  await authStorage.login(providerId, createOAuthCallbacks());
}

async function handleLogout(
  _event: Electron.IpcMainInvokeEvent,
  providerId: string,
): Promise<void> {
  const authStorage = getSharedAuthStorage();
  authStorage.remove(providerId);
}

async function handleStatus(
  _event: Electron.IpcMainInvokeEvent,
  providerId: string,
): Promise<OAuthStatusResult> {
  const authStorage = getSharedAuthStorage();
  const provider = SUPPORTED_OAUTH_PROVIDERS.find((p) => p.id === providerId);
  const providerName = provider?.name ?? providerId;

  const cred = authStorage.get(providerId);
  if (!cred) {
    return { loggedIn: false, providerName };
  }

  return {
    loggedIn: true,
    expiresAt:
      cred.type === "oauth" && typeof cred.expires === "number"
        ? cred.expires
        : undefined,
    providerName,
  };
}

export function initOAuthService(): void {
  ipcMain.handle("auth.login", handleLogin);
  ipcMain.handle("auth.logout", handleLogout);
  ipcMain.handle("auth.status", handleStatus);
}
