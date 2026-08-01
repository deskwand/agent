import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeTheme,
  shell,
} from "electron";
import type {
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
} from "@earendil-works/pi-ai";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import type { OAuthStatusResult } from "../../shared/ipc-types";
import { extractOAuthProviderId } from "../../shared/oauth-utils";
import {
  getAuthPath,
  getSharedModelRuntime,
  invalidateSessionRuntimeApiKeys,
} from "../agent/shared-model-runtime";
import { buildDeskWandProviderId } from "../agent/subagent/provider-bridge";
import { configStore } from "../config/config-store";
import { log } from "../utils/logger";

const SUPPORTED_OAUTH_PROVIDERS = [
  { id: "openai-codex", name: "OpenAI Codex" },
  { id: "github-copilot", name: "GitHub Copilot" },
  { id: "anthropic", name: "Anthropic" },
] as const;

// ── Minimal in-app i18n for OAuth dialogs ────────────────────────────

const isZh = (app.getLocale() ?? "en").startsWith("zh");

const T = {
  openBrowser: isZh ? "打开浏览器" : "Open Browser",
  continue: isZh ? "继续" : "Continue",
  cancel: isZh ? "取消" : "Cancel",
  deviceCodeTitle: isZh ? "设备验证码" : "Device Code",
  deviceCodeDetail: isZh
    ? "验证码已复制到剪贴板，将打开浏览器窗口，粘贴验证码即可完成登录。"
    : "The code has been copied to your clipboard. A browser window will open — paste the code there to complete login.",
  verificationCode: isZh
    ? (code: string) => `您的验证码：${code}`
    : (code: string) => `Your verification code: ${code}`,
  githubEnterpriseDetail: isZh
    ? "个人账号留空，默认使用 github.com"
    : "Leave blank for personal github.com account.",
};

// ── Theme-aware CSS ──────────────────────────────────────────────────

function dialogCss(dark: boolean): string {
  const bg = dark ? "#1c1c1e" : "#ffffff";
  const fg = dark ? "#e5e5e7" : "#1d1d1f";
  const muted = dark ? "#a1a1a6" : "#6e6e73";
  const subtle = dark ? "#8e8e93" : "#86868b";
  const surface = dark ? "#2c2c2e" : "#f5f5f7";
  const border = dark ? "#3a3a3c" : "#d2d2d7";
  const accent = dark ? "#0a84ff" : "#0071e3";
  const btnSecondaryBg = dark ? "#3a3a3c" : "#e8e8ed";
  const btnSecondaryFg = dark ? "#e5e5e7" : "#1d1d1f";
  return `
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background:${bg}; color:${fg}; display:flex; flex-direction:column;
  align-items:center; justify-content:center; height:100vh; padding:24px; }
h2 { font-size:15px; font-weight:600; margin-bottom:8px; text-align:center; color:${fg}; }
p { font-size:13px; color:${muted}; margin-bottom:16px; text-align:center; line-height:1.4; }
.buttons { display:flex; gap:8px; margin-top:8px; }
.btn { padding:8px 20px; border:none; border-radius:8px; font-size:13px; font-weight:500; cursor:pointer; transition:opacity .15s; }
.btn:hover { opacity:.85; }
.btn-primary { background:${accent}; color:#fff; }
.btn-secondary { background:${btnSecondaryBg}; color:${btnSecondaryFg}; }
.input { width:100%; padding:8px 12px; border:1px solid ${border}; border-radius:8px;
  background:${surface}; color:${fg}; font-size:13px; margin-bottom:12px; outline:none; }
.input:focus { border-color:${accent}; }
.input::placeholder { color:${subtle}; }
.detail { font-size:12px; color:${subtle}; }
`;
}

// ── Browser-style in-app dialog helpers ──────────────────────────────

interface BrowserDialogOption {
  label: string;
  /** Index in the returned Promise. 0 = first button, etc. */
  value: number;
}

function showBrowserDialog(opts: {
  title: string;
  message: string;
  detail?: string;
  buttons: BrowserDialogOption[];
  defaultId?: number;
  input?: {
    placeholder?: string;
    defaultValue?: string;
    type?: "text" | "password";
  };
  signal?: AbortSignal;
}): Promise<{ response: number; input?: string }> {
  if (opts.signal?.aborted) {
    return Promise.resolve({ response: -1 });
  }

  return new Promise((resolve) => {
    const buttonHtml = opts.buttons
      .map(
        (btn, i) =>
          `<button class="btn ${i === (opts.defaultId ?? 0) ? "btn-primary" : "btn-secondary"}" onclick="submit(${btn.value})">${btn.label}</button>`,
      )
      .join("");

    const inputHtml = opts.input
      ? `<input class="input" type="${opts.input.type ?? "text"}" placeholder="${opts.input.placeholder ?? ""}" value="${opts.input.defaultValue ?? ""}" id="userInput" />`
      : "";

    const dark = nativeTheme.shouldUseDarkColors;
    const css = dialogCss(dark);

    const win = new BrowserWindow({
      width: 420,
      height: opts.input ? 260 : 210,
      resizable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      title: opts.title,
      // contextIsolation disabled to read __dialogResult via executeJavaScript (data: URL, no XSS risk)
      webPreferences: { nodeIntegration: false, contextIsolation: false },
    });

    win.loadURL(
      `data:text/html,${encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${css}</style></head><body>
<h2>${opts.title}</h2>
${opts.message ? `<p>${opts.message}</p>` : ""}
${opts.detail ? `<p class="detail">${opts.detail}</p>` : ""}
${inputHtml}
<div class="buttons">${buttonHtml}</div>
<script>function submit(v){window.__dialogResult={response:v,input:document.getElementById('userInput')?.value};setTimeout(()=>window.close(),0)}</script>
</body></html>`)}`,
    );

    const closeOnAbort = (): void => {
      if (!win.isDestroyed()) win.close();
    };
    opts.signal?.addEventListener("abort", closeOnAbort, { once: true });

    let resolved = false;
    win.on("close", async () => {
      if (resolved) return;
      resolved = true;
      opts.signal?.removeEventListener("abort", closeOnAbort);
      try {
        const result = await win.webContents.executeJavaScript(
          "window.__dialogResult",
        );
        resolve(
          result && typeof result === "object"
            ? (result as { response: number; input?: string })
            : { response: -1 },
        );
      } catch {
        resolve({ response: -1 });
      }
    });
  });
}

function notifyAuth(event: AuthEvent): void {
  if (event.type === "auth_url") {
    void shell.openExternal(event.url);
    return;
  }
  if (event.type === "device_code") {
    clipboard.writeText(event.userCode);
    void showBrowserDialog({
      title: T.deviceCodeTitle,
      message: T.verificationCode(event.userCode),
      detail: T.deviceCodeDetail,
      buttons: [{ label: T.openBrowser, value: 0 }],
    }).then(() => shell.openExternal(event.verificationUri));
    return;
  }
  if (event.type === "info") {
    log("[OAuth] Provider info:", event.message);
  }
}

async function promptAuth(
  prompt: AuthPrompt,
  providerName: string,
): Promise<string> {
  if (prompt.type === "select") {
    const first = prompt.options[0]?.id;
    if (!first) throw new Error("Login cancelled");
    return first;
  }

  const result = await showBrowserDialog({
    title: providerName,
    message: prompt.message,
    detail:
      providerName === "GitHub Copilot" ? T.githubEnterpriseDetail : undefined,
    buttons: [
      { label: T.continue, value: 0 },
      { label: T.cancel, value: 1 },
    ],
    input: {
      placeholder: prompt.placeholder,
      type: prompt.type === "secret" ? "password" : "text",
    },
    signal: prompt.signal,
  });
  if (result.response !== 0) throw new Error("Login cancelled");
  return result.input?.trim() || "";
}

function createAuthInteraction(providerName: string): AuthInteraction {
  return {
    notify: notifyAuth,
    prompt: (prompt) => promptAuth(prompt, providerName),
  };
}

async function handleLogin(
  _event: Electron.IpcMainInvokeEvent,
  providerId: string,
  force = false,
): Promise<void> {
  if (!force && readStoredCredential(providerId, getAuthPath())) return;

  const runtime = await getSharedModelRuntime();
  const providerName =
    SUPPORTED_OAUTH_PROVIDERS.find((provider) => provider.id === providerId)
      ?.name ?? providerId;
  await runtime.login(providerId, "oauth", createAuthInteraction(providerName));
}

async function handleLogout(
  _event: Electron.IpcMainInvokeEvent,
  providerId: string,
): Promise<void> {
  const runtime = await getSharedModelRuntime();
  await runtime.logout(providerId);
  await runtime.removeRuntimeApiKey(providerId);
  await invalidateSessionRuntimeApiKeys(providerId);

  for (const profileKey of Object.keys(configStore.getAll().providers)) {
    if (extractOAuthProviderId(profileKey) === providerId) {
      const deskwandProviderId = buildDeskWandProviderId(profileKey);
      await runtime.removeRuntimeApiKey(deskwandProviderId);
      await invalidateSessionRuntimeApiKeys(deskwandProviderId);
    }
  }
}

async function handleStatus(
  _event: Electron.IpcMainInvokeEvent,
  providerId: string,
): Promise<OAuthStatusResult> {
  const providerName =
    SUPPORTED_OAUTH_PROVIDERS.find((provider) => provider.id === providerId)
      ?.name ?? providerId;
  const credential = readStoredCredential(providerId, getAuthPath());
  if (!credential) return { loggedIn: false, providerName };

  return {
    loggedIn: true,
    expiresAt: credential.type === "oauth" ? credential.expires : undefined,
    providerName,
  };
}

export function initOAuthService(): void {
  ipcMain.handle("auth.login", handleLogin);
  ipcMain.handle("auth.logout", handleLogout);
  ipcMain.handle("auth.status", handleStatus);
}
