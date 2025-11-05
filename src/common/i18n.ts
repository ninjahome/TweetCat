// i18n.ts
import browser from "webextension-polyfill";

// ====== 导入你的语言包（根据你的项目路径调整） ======
import zhMessages from "../../dist/_locales/zh_CN/messages.json";
import enMessages from "../../dist/_locales/en/messages.json";

// ====== 内部状态 ======
let currentLocale = "en";

/**
 * 自动检测 Twitter 的语言设置
 * 优先级：
 * 1. window.__twttr.config.lang
 * 2. <html lang>
 * 3. navigator.language
 */
export function detectTwitterLang(): string {
    try {
        const twLang =
            (window as any).__twttr?.config?.lang ||
            document.documentElement.lang ||
            navigator.language ||
            "en";
        currentLocale = twLang.toLowerCase();
        console.log("[i18n] detected Twitter lang:", currentLocale);
    } catch (e) {
        console.warn("[i18n] detectTwitterLang failed:", e);
        currentLocale = "en";
    }
    return currentLocale;
}

// 放在 i18n.ts：替换原来的 t()
function applySubs(str: string, substitutions?: string | string[]) {
    if (!substitutions) return str;
    const arr = Array.isArray(substitutions) ? substitutions : [substitutions];
    return arr.reduce((s, v, i) => s.replace(new RegExp(`\\$${i + 1}`, "g"), String(v)), str);
}

export function t(key: string, substitutions?: string | string[]): string {
    // 1) 优先：按 Twitter 语言（currentLocale）从手动字典取
    const isZh = currentLocale.toLowerCase().startsWith("zh");
    const dict = isZh ? zhMessages : enMessages;
    const fromTwitter = dict?.[key]?.message;
    if (fromTwitter) return applySubs(fromTwitter, substitutions);

    // 2) 回退：浏览器 i18n（按浏览器语言）
    const msg = browser.i18n.getMessage(key, substitutions);
    if (msg) return msg;

    // 3) 最终回退：原样返回 key
    return key;
}

/**
 * 初始化语言环境（建议在 content script 启动时调用）
 */

export function initI18n(): void {
    if (window.location.protocol.startsWith("chrome-extension")) {
        currentLocale = navigator.language.toLowerCase();
    } else {
        currentLocale = detectTwitterLang();
    }
    console.log(`[i18n] initialized with locale: ${currentLocale}`);
}
