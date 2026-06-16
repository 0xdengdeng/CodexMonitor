import { useCallback, useRef } from "react";
import { useI18n } from "@/features/i18n/i18n";
import { useUpdater } from "../../update/hooks/useUpdater";
import { useAgentSoundNotifications } from "../../notifications/hooks/useAgentSoundNotifications";
import { useAgentSystemNotifications } from "../../notifications/hooks/useAgentSystemNotifications";
import { useWindowFocusState } from "../../layout/hooks/useWindowFocusState";
import { useTauriEvent } from "./useTauriEvent";
import { playNotificationSound } from "../../../utils/notificationSounds";
import { subscribeUpdaterCheck } from "../../../services/events";
import { sendNotification } from "../../../services/tauri";
import type { DebugEntry } from "../../../types";

type Params = {
  enabled?: boolean;
  autoCheckOnMount?: boolean;
  firstLaunchGuideEligible?: boolean;
  notificationSoundsEnabled: boolean;
  systemNotificationsEnabled: boolean;
  subagentSystemNotificationsEnabled: boolean;
  isSubagentThread?: (workspaceId: string, threadId: string) => boolean;
  getWorkspaceName?: (workspaceId: string) => string | undefined;
  onThreadNotificationSent?: (workspaceId: string, threadId: string) => void;
  onDebug: (entry: DebugEntry) => void;
  successSoundUrl: string;
  errorSoundUrl: string;
};

export function useUpdaterController({
  enabled = true,
  autoCheckOnMount = true,
  firstLaunchGuideEligible = false,
  notificationSoundsEnabled,
  systemNotificationsEnabled,
  subagentSystemNotificationsEnabled,
  isSubagentThread,
  getWorkspaceName,
  onThreadNotificationSent,
  onDebug,
  successSoundUrl,
  errorSoundUrl,
}: Params) {
  const { t } = useI18n();
  const {
    state: updaterState,
    startUpdate,
    cancelUpdate,
    checkForUpdates,
    dismiss,
    postUpdateNotice,
    dismissPostUpdateNotice,
    postUpdateDemoGuide,
    dismissPostUpdateDemoGuide,
    tryPostUpdateDemoGuide,
  } = useUpdater({
    enabled,
    autoCheckOnMount,
    firstLaunchGuideEligible,
    onDebug,
  });
  const isWindowFocused = useWindowFocusState();
  const nextTestSoundIsError = useRef(false);

  const subscribeUpdaterCheckEvent = useCallback(
    (handler: () => void) =>
      subscribeUpdaterCheck(handler, {
        onError: (error) => {
          onDebug({
            id: `${Date.now()}-client-updater-menu-error`,
            timestamp: Date.now(),
            source: "error",
            label: "updater/menu-error",
            payload: error instanceof Error ? error.message : String(error),
          });
        },
      }),
    [onDebug],
  );

  useTauriEvent(
    subscribeUpdaterCheckEvent,
    () => {
      void checkForUpdates({ announceNoUpdate: true });
    },
    { enabled },
  );

  useAgentSoundNotifications({
    enabled: notificationSoundsEnabled,
    isWindowFocused,
    onDebug,
  });

  useAgentSystemNotifications({
    enabled: systemNotificationsEnabled,
    subagentNotificationsEnabled: subagentSystemNotificationsEnabled,
    isSubagentThread,
    isWindowFocused,
    getWorkspaceName,
    onThreadNotificationSent,
    onDebug,
  });

  const handleTestNotificationSound = useCallback(() => {
    const useError = nextTestSoundIsError.current;
    nextTestSoundIsError.current = !useError;
    const type = useError ? "error" : "success";
    const url = useError ? errorSoundUrl : successSoundUrl;
    playNotificationSound(url, type, onDebug);
  }, [errorSoundUrl, onDebug, successSoundUrl]);

  const handleTestSystemNotification = useCallback(() => {
    if (!systemNotificationsEnabled) {
      return;
    }
    void sendNotification(
      t("notifications.testTitle"),
      t("notifications.testBody"),
    ).catch((error) => {
      onDebug({
        id: `${Date.now()}-client-notification-test-error`,
        timestamp: Date.now(),
        source: "error",
        label: "notification/test-error",
        payload: error instanceof Error ? error.message : String(error),
      });
    });
  }, [onDebug, systemNotificationsEnabled, t]);

  return {
    updaterState,
    startUpdate,
    cancelUpdate,
    checkForUpdates,
    dismissUpdate: dismiss,
    postUpdateNotice,
    dismissPostUpdateNotice,
    postUpdateDemoGuide,
    dismissPostUpdateDemoGuide,
    tryPostUpdateDemoGuide,
    handleTestNotificationSound,
    handleTestSystemNotification,
  };
}
