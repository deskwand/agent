import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeTheme,
  shell,
} from "electron";
import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { getSharedAuthStorage } from "../agent/shared-auth";
import type { OAuthStatusResult } from "../../shared/ipc-types";

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
  input?: { placeholder?: string; defaultValue?: string };
}): Promise<{ response: number; input?: string }> {
  return new Promise((resolve) => {
    const buttonHtml = opts.buttons
      .map(
        (btn, i) =>
          `<button class="btn ${i === (opts.defaultId ?? 0) ? "btn-primary" : "btn-secondary"}" onclick="submit(${btn.value})">${btn.label}</button>`,
      )
      .join("");

    const inputHtml = opts.input
      ? `<input class="input" type="text" placeholder="${opts.input.placeholder ?? ""}" value="${opts.input.defaultValue ?? ""}" id="userInput" />`
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

    let resolved = false;
    win.on("close", async () => {
      if (resolved) return;
      resolved = true;
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

function createOAuthCallbacks(): OAuthLoginCallbacks {
  return {
    onAuth: (info) => {
      // Redirects to localhost callback handled by pi-ai's local server.
      // Requires system proxy to bypass localhost (NO_PROXY=localhost,127.0.0.1).
      void shell.openExternal(info.url);
    },

    onDeviceCode: (info) => {
      clipboard.writeText(info.userCode);
      void showBrowserDialog({
        title: T.deviceCodeTitle,
        message: T.verificationCode(info.userCode),
        detail: T.deviceCodeDetail,
        buttons: [{ label: T.openBrowser, value: 0 }],
      }).then(() => {
        void shell.openExternal(info.verificationUri);
      });
    },

    onPrompt: async (prompt) => {
      const result = await showBrowserDialog({
        title: "GitHub Copilot",
        message: prompt.message,
        detail: T.githubEnterpriseDetail,
        buttons: [
          { label: T.continue, value: 0 },
          { label: T.cancel, value: 1 },
        ],
        input: prompt.allowEmpty
          ? { placeholder: prompt.placeholder }
          : undefined,
      });
      if (result.response !== 0) {
        throw new Error("Login cancelled");
      }
      return result.input?.trim() || "";
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
