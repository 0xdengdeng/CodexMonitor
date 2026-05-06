import Languages from "lucide-react/dist/esm/icons/languages";
import type { LanguagePreference } from "@/types";
import { LANGUAGE_OPTIONS, nextLanguage } from "@/i18n/languages";
import { useTranslation } from "@/i18n/useTranslation";

type LanguageSwitcherProps = {
  language: LanguagePreference;
  onChangeLanguage: (language: LanguagePreference) => void;
};

export function LanguageSwitcher({
  language,
  onChangeLanguage,
}: LanguageSwitcherProps) {
  const t = useTranslation(language);
  const activeOption =
    LANGUAGE_OPTIONS.find((option) => option.value === language) ??
    LANGUAGE_OPTIONS[0];

  return (
    <button
      type="button"
      className="language-switcher"
      aria-label={t("app.language.switcherLabel")}
      title={t("app.language.switcherLabel")}
      onClick={() => onChangeLanguage(nextLanguage(language))}
      data-tauri-drag-region="false"
    >
      <Languages size={14} aria-hidden />
      <span>{activeOption.shortLabel}</span>
    </button>
  );
}
