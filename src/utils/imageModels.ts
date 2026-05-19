export function normalizePublicImageModel(
  value: string | null | undefined,
): string {
  const trimmed = value?.trim() ?? "";
  return trimmed;
}
