/** Google OAuth 配置 — client_id 可公开，无安全风险（secret 在服务端） */
export const GOOGLE_CLIENT_ID = "139674134881-cf3lgnlu00kcfr2n3r4ndhciqpb09qe3.apps.googleusercontent.com";

/** DeskWand API 服务地址，主进程和渲染进程统一引用 */
export const DESKWAND_API_URL = "https://api.deskwand.com";

/** Google OAuth 请求的权限范围 */
export const GOOGLE_OAUTH_SCOPES = "openid email profile";

/** OAuth 回调等待超时（毫秒） */
export const OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
