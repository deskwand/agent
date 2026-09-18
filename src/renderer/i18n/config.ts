import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enTranslations from "./locales/en.json";
import zhTranslations from "./locales/zh.json";

i18n
  .use(LanguageDetector) // 自动检测浏览器语言
  .use(initReactI18next) // 初始化 react-i18next
  .init({
    resources: {
      en: {
        translation: enTranslations,
      },
      zh: {
        translation: zhTranslations,
      },
    },
    fallbackLng: "en", // 默认语言
    supportedLngs: ["en", "zh"], // 支持的语言
    interpolation: {
      escapeValue: false, // React 已经处理了 XSS
    },
    // 运行时兜底：两边语言都查不到的 key 会原样渲染到界面上（tooltip 里出现
    // titlebar.fileBrowser 这种原始 key），静态扫描覆盖不到的动态 key 只剩这里能留线索。
    // 必须回传 defaultValue：i18next 在 usedDefault 分支也会调用本 handler，返回值
    // 会替换掉已解析出的 defaultValue，而有些调用点拿它当哨兵/兜底文案。
    parseMissingKeyHandler: (key: string, defaultValue?: string) => {
      console.warn(`[i18n] missing key: ${key}`);
      return defaultValue ?? key;
    },
    pluralSeparator: "_", // 复数分隔符
    contextSeparator: "_", // 上下文分隔符
    detection: {
      order: ["localStorage", "navigator"], // 先检查 localStorage，再检查浏览器语言
      caches: ["localStorage"], // 将语言选择保存到 localStorage
      lookupLocalStorage: "i18nextLng", // localStorage key
    },
  });

export default i18n;

// The main process must mirror the renderer language: it has no i18n of its
// own. Report once after init (the languageChanged emitted during init() fires
// before this listener is attached) and then on every change.
function reportLocaleToMain(): void {
  const language = i18n.resolvedLanguage || i18n.language;
  // Do not report a guessed locale when the language is not settled yet:
  // main then keeps its app.getLocale() fallback, which is the pre-fix
  // behaviour, instead of being told the wrong language.
  if (!language) return;
  const locale = language.startsWith("zh") ? "zh" : "en";
  try {
    window.electronAPI?.send({
      type: "i18n.setLocale",
      payload: { locale },
    });
  } catch {
    // IPC not ready: main falls back to the OS locale, the UI is unaffected.
  }
}

i18n.on("languageChanged", reportLocaleToMain);
reportLocaleToMain();
