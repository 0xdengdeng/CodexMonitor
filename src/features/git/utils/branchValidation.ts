import {
  translate,
  type I18nValues,
} from "@/features/i18n/i18n";

type BranchValidationTranslate = (key: string, values?: I18nValues) => string;

const defaultTranslate: BranchValidationTranslate = (key, values) =>
  translate("en", key, values);

export function validateBranchName(
  name: string,
  t: BranchValidationTranslate = defaultTranslate,
): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed === "." || trimmed === "..") {
    return t("git.branchValidation.dot");
  }
  if (/\s/.test(trimmed)) {
    return t("git.branchValidation.spaces");
  }
  if (trimmed.startsWith("/") || trimmed.endsWith("/")) {
    return t("git.branchValidation.slashEdge");
  }
  if (trimmed.includes("//")) {
    return t("git.branchValidation.doubleSlash");
  }
  if (trimmed.endsWith(".lock")) {
    return t("git.branchValidation.lockSuffix");
  }
  if (trimmed.includes("..")) {
    return t("git.branchValidation.doubleDot");
  }
  if (trimmed.includes("@{")) {
    return t("git.branchValidation.atBrace");
  }
  const invalidChars = ["~", "^", ":", "?", "*", "[", "\\"];
  if (invalidChars.some((char) => trimmed.includes(char))) {
    return t("git.branchValidation.invalidChars");
  }
  if (trimmed.endsWith(".")) {
    return t("git.branchValidation.dotSuffix");
  }
  return null;
}
