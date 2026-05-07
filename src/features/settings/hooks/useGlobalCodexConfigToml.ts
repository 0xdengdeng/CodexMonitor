import { readGlobalCodexConfigToml, writeGlobalCodexConfigToml } from "@services/tauri";
import { useFileEditor } from "@/features/shared/hooks/useFileEditor";
import { useI18n } from "@/features/i18n/i18n";

export function useGlobalCodexConfigToml() {
  const { t } = useI18n();

  return useFileEditor({
    key: "global-config",
    read: readGlobalCodexConfigToml,
    write: writeGlobalCodexConfigToml,
    readErrorTitle: t("settings.editor.loadGlobalConfigFailed"),
    writeErrorTitle: t("settings.editor.saveGlobalConfigFailed"),
  });
}
