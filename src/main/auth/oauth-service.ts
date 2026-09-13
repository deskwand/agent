import {
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeTheme,
  shell,
} from "electron";
import { t } from "../i18n";
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

// ── Dialog copy ──────────────────────────────────────────────────────
// Must be a function, not a module-level constant: the locale is only known
// after the renderer reports it, so evaluating it at import time would pin
// the language for the whole process lifetime.

function T() {
  return {
    openBrowser: t("oauth.openBrowser"),
    continue: t("oauth.continue"),
    cancel: t("oauth.cancel"),
    deviceCodeTitle: t("oauth.deviceCodeTitle"),
    deviceCodeDetail: t("oauth.deviceCodeDetail"),
    verificationCode: (code: string) => t("oauth.verificationCode", { code }),
    githubEnterpriseDetail: t("oauth.githubEnterpriseDetail"),
  };
}

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
    const T_ = T();
    clipboard.writeText(event.userCode);
    void showBrowserDialog({
      title: T_.deviceCodeTitle,
      message: T_.verificationCode(event.userCode),
      detail: T_.deviceCodeDetail,
      buttons: [{ label: T_.openBrowser, value: 0 }],
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

  if (prompt.type === "manual_code") {
    // 浏览器登录是主路径（auth_url 已打开系统浏览器）；manual_code
    // 只是登录失败时的兑底输入。不弹应用内窗口，挂起直到登录流程
    // 结束（signal abort 自动解除），保持与旧版一致的直跳浏览器体验。
    return new Promise<string>((_resolve, reject) => {
      const onAbort = () => reject(new Error("Login cancelled"));
      prompt.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  const T_ = T();
  const result = await showBrowserDialog({
    title: providerName,
    message: prompt.message,
    detail:
      providerName === "GitHub Copilot" ? T_.githubEnterpriseDetail : undefined,
    buttons: [
      { label: T_.continue, value: 0 },
      { label: T_.cancel, value: 1 },
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
