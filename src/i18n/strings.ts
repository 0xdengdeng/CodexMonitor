import type { LanguagePreference } from "@/types";

export type TranslationKey =
  | "app.language.switcherLabel"
  | "app.language.chinese"
  | "app.language.english";

export const STRINGS: Record<LanguagePreference, Record<TranslationKey, string>> = {
  "zh-CN": {
    "app.language.switcherLabel": "切换语言",
    "app.language.chinese": "中文",
    "app.language.english": "EN",
  },
  "en-US": {
    "app.language.switcherLabel": "Switch language",
    "app.language.chinese": "中文",
    "app.language.english": "EN",
  },
};
