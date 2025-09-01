import browser from "webextension-polyfill";

export const t = (key: string, substitutions?: string | string[]) =>
  browser.i18n.getMessage(key, substitutions) || key;
