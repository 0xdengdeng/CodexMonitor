import type { LanguagePreference } from "@/types";

export type LanguageOption = {
  value: LanguagePreference;
  shortLabel: string;
  label: string;
};

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: "zh-CN", shortLabel: "中文", label: "简体中文" },
  { value: "en-US", shortLabel: "EN", label: "English" },
];

export function nextLanguage(language: LanguagePreference): LanguagePreference {
  return language === "zh-CN" ? "en-US" : "zh-CN";
}
