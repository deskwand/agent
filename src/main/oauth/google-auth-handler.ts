import http from "node:http";
import type { AddressInfo } from "node:net";
import { t } from "../i18n";
import { shell } from "electron";
import {
  GOOGLE_CLIENT_ID,
  DESKWAND_API_URL,
  GOOGLE_OAUTH_SCOPES,
  OAUTH_CALLBACK_TIMEOUT_MS,
} from "../../shared/oauth-config";
import type { CloudAuthLoginResult } from "../../shared/ipc-types";

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function buildGoogleAuthUrl(port: number): string {
  const redirectUri = `http://localhost:${port}/callback`;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPES,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<CloudAuthLoginResult> {
  const res = await fetch(`${DESKWAND_API_URL}/api/auth/google-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body.error?.message || `HTTP ${res.status}`;
    const errCode = body.error?.code || "INTERNAL_ERROR";
    throw Object.assign(new Error(message), {
      code: errCode,
      status: res.status,
    });
  }
  return res.json() as Promise<CloudAuthLoginResult>;
}

export async function startGoogleAuth(): Promise<CloudAuthLoginResult> {
  const port = await findAvailablePort();
  const redirectUri = `http://localhost:${port}/callback`;

  const codePromise = new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${port}`);

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            "<html><body style='font-family:sans-serif;text-align:center;padding-top:80px;'>" +
              t("oauth.loginSuccessPage"),
          );
          server.close();
          resolve(code);
        } else if (error) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            "<html><body style='font-family:sans-serif;text-align:center;padding-top:80px;'>" +
              t("oauth.loginCancelledPage"),
          );
          server.close();
          const err = new Error(t("oauth.userCancelled"));
          (err as unknown as Record<string, unknown>).code = "USER_CANCELLED";
          reject(err);
        } else {
          res.writeHead(400);
          res.end("Bad request");
        }
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    const timeout = setTimeout(() => {
      server.close();
      const err = new Error(t("oauth.timeout"));
      (err as unknown as Record<string, unknown>).code = "TIMEOUT";
      reject(err);
    }, OAUTH_CALLBACK_TIMEOUT_MS);

    server.on("close", () => clearTimeout(timeout));
    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    server.listen(port, "127.0.0.1", () => {
      const authUrl = buildGoogleAuthUrl(port);
      shell.openExternal(authUrl).catch((err: unknown) => {
        server.close();
        reject(err);
      });
    });
  });

  const code = await codePromise;
  return exchangeCodeForToken(code, redirectUri);
}
