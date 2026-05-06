import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { InterfaceLanguagePreference } from "@/types";

export type ResolvedInterfaceLanguage = "en" | "zh-CN";
export type I18nKey = keyof typeof enMessages;

export const DEFAULT_INTERFACE_LANGUAGE: InterfaceLanguagePreference = "system";
export const SUPPORTED_INTERFACE_LANGUAGES: InterfaceLanguagePreference[] = [
  "system",
  "en",
  "zh-CN",
];

const enMessages = {
  "home.title": "Codex Monitor",
  "home.subtitle": "Orchestrate agents across your local projects.",
  "settings.title": "Settings",
  "settings.close": "Close settings",
  "settings.mobile.sections": "Sections",
  "settings.display.interfaceLanguage.label": "Interface language",
  "settings.display.interfaceLanguage.system": "System",
  "settings.display.interfaceLanguage.english": "English",
  "settings.display.interfaceLanguage.chinese": "Simplified Chinese",
  "sidebar.usage.title": "Usage",
  "sidebar.usage.session": "Session",
  "sidebar.usage.weekly": "Weekly",
  "sidebar.account.title": "Account",
  "sidebar.account.trigger": "Account",
  "sidebar.account.cancelSwitch": "Cancel account switch",
  "sidebar.settings.open": "Open settings",
  "sidebar.settings.label": "Settings",
  "sidebar.debug.open": "Open debug log",
};

const zhCnMessages: Record<I18nKey, string> = {
  "home.title": "Codex Monitor",
  "home.subtitle": "跨本地项目编排 Codex 智能体。",
  "settings.title": "设置",
  "settings.close": "关闭设置",
  "settings.mobile.sections": "设置分区",
  "settings.display.interfaceLanguage.label": "界面语言",
  "settings.display.interfaceLanguage.system": "跟随系统",
  "settings.display.interfaceLanguage.english": "English",
  "settings.display.interfaceLanguage.chinese": "简体中文",
  "sidebar.usage.title": "用量",
  "sidebar.usage.session": "本次会话",
  "sidebar.usage.weekly": "本周",
  "sidebar.account.title": "账户",
  "sidebar.account.trigger": "账户",
  "sidebar.account.cancelSwitch": "取消切换账户",
  "sidebar.settings.open": "打开设置",
  "sidebar.settings.label": "设置",
  "sidebar.debug.open": "打开调试日志",
};

const messagesByLanguage: Record<ResolvedInterfaceLanguage, Record<I18nKey, string>> = {
  en: enMessages,
  "zh-CN": zhCnMessages,
};

export function normalizeInterfaceLanguage(
  value: unknown,
): InterfaceLanguagePreference {
  return SUPPORTED_INTERFACE_LANGUAGES.includes(
    value as InterfaceLanguagePreference,
  )
    ? (value as InterfaceLanguagePreference)
    : DEFAULT_INTERFACE_LANGUAGE;
}

export function resolveInterfaceLanguage(
  preference: unknown,
  navigatorLanguage =
    typeof navigator === "undefined" ? undefined : navigator.language,
): ResolvedInterfaceLanguage {
  const normalized = normalizeInterfaceLanguage(preference);
  if (normalized === "zh-CN" || normalized === "en") {
    return normalized;
  }
  return navigatorLanguage?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function translate(
  language: ResolvedInterfaceLanguage,
  key: string,
): string {
  const normalizedKey = key as I18nKey;
  return (
    messagesByLanguage[language][normalizedKey] ??
    messagesByLanguage.en[normalizedKey] ??
    key
  );
}

type I18nContextValue = {
  language: ResolvedInterfaceLanguage;
  languagePreference: InterfaceLanguagePreference;
  t: (key: string) => string;
};

const fallbackLanguage = resolveInterfaceLanguage(DEFAULT_INTERFACE_LANGUAGE);
const I18nContext = createContext<I18nContextValue>({
  language: fallbackLanguage,
  languagePreference: DEFAULT_INTERFACE_LANGUAGE,
  t: (key) => translate(fallbackLanguage, key),
});

type I18nProviderProps = {
  languagePreference: InterfaceLanguagePreference;
  children: ReactNode;
};

export function I18nProvider({
  languagePreference,
  children,
}: I18nProviderProps) {
  const normalizedPreference = normalizeInterfaceLanguage(languagePreference);
  const language = resolveInterfaceLanguage(normalizedPreference);
  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      languagePreference: normalizedPreference,
      t: (key) => translate(language, key),
    }),
    [language, normalizedPreference],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
