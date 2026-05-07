import { readGlobalAgentsMd, writeGlobalAgentsMd } from "@services/tauri";
import { useFileEditor } from "@/features/shared/hooks/useFileEditor";
import { useI18n } from "@/features/i18n/i18n";

export function useGlobalAgentsMd() {
  const { t } = useI18n();

  return useFileEditor({
    key: "global-agents",
    read: readGlobalAgentsMd,
    write: writeGlobalAgentsMd,
    readErrorTitle: t("settings.editor.loadGlobalAgentsFailed"),
    writeErrorTitle: t("settings.editor.saveGlobalAgentsFailed"),
  });
}
