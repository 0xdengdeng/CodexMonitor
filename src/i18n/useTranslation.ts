import { useCallback } from "react";
import type { LanguagePreference } from "@/types";
import { STRINGS, type TranslationKey } from "./strings";

export function getTranslation(
  language: LanguagePreference,
  key: TranslationKey | string,
): string {
  return STRINGS[language][key as TranslationKey] ?? key;
}

export function useTranslation(language: LanguagePreference) {
  return useCallback(
    (key: TranslationKey | string) => getTranslation(language, key),
    [language],
  );
}
