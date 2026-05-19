import { useCallback, useEffect, useState } from "react";
import type { AppSettings, GitRuntimeInfo, ModelOption } from "@/types";
import { DEFAULT_COMMIT_MESSAGE_PROMPT } from "@utils/commitMessagePrompt";
import { getGitRuntimeInfo } from "@/services/tauri";

type UseSettingsGitSectionArgs = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  models: ModelOption[];
  enabled: boolean;
};

export type SettingsGitSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  models: ModelOption[];
  commitMessagePromptDraft: string;
  commitMessagePromptDirty: boolean;
  commitMessagePromptSaving: boolean;
  onSetCommitMessagePromptDraft: (value: string) => void;
  onSaveCommitMessagePrompt: () => Promise<void>;
  onResetCommitMessagePrompt: () => Promise<void>;
  gitRuntimeInfo: GitRuntimeInfo | null;
  gitRuntimeInfoLoading: boolean;
  gitRuntimeInfoError: string | null;
  onRefreshGitRuntimeInfo: () => Promise<void>;
};

export const useSettingsGitSection = ({
  appSettings,
  onUpdateAppSettings,
  models,
  enabled,
}: UseSettingsGitSectionArgs): SettingsGitSectionProps => {
  const [commitMessagePromptDraft, setCommitMessagePromptDraft] = useState(
    appSettings.commitMessagePrompt,
  );
  const [commitMessagePromptSaving, setCommitMessagePromptSaving] = useState(false);
  const [gitRuntimeInfo, setGitRuntimeInfo] = useState<GitRuntimeInfo | null>(null);
  const [gitRuntimeInfoLoading, setGitRuntimeInfoLoading] = useState(false);
  const [gitRuntimeInfoError, setGitRuntimeInfoError] = useState<string | null>(null);

  useEffect(() => {
    setCommitMessagePromptDraft(appSettings.commitMessagePrompt);
  }, [appSettings.commitMessagePrompt]);

  const commitMessagePromptDirty =
    commitMessagePromptDraft !== appSettings.commitMessagePrompt;

  const refreshGitRuntimeInfo = useCallback(async () => {
    setGitRuntimeInfoLoading(true);
    setGitRuntimeInfoError(null);
    try {
      setGitRuntimeInfo(await getGitRuntimeInfo());
    } catch (error) {
      setGitRuntimeInfoError(error instanceof Error ? error.message : String(error));
    } finally {
      setGitRuntimeInfoLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void refreshGitRuntimeInfo();
  }, [enabled, refreshGitRuntimeInfo]);

  const handleSaveCommitMessagePrompt = useCallback(async () => {
    if (commitMessagePromptSaving || !commitMessagePromptDirty) {
      return;
    }
    setCommitMessagePromptSaving(true);
    try {
      await onUpdateAppSettings({
        ...appSettings,
        commitMessagePrompt: commitMessagePromptDraft,
      });
    } finally {
      setCommitMessagePromptSaving(false);
    }
  }, [
    appSettings,
    commitMessagePromptDirty,
    commitMessagePromptDraft,
    commitMessagePromptSaving,
    onUpdateAppSettings,
  ]);

  const handleResetCommitMessagePrompt = useCallback(async () => {
    if (commitMessagePromptSaving) {
      return;
    }
    setCommitMessagePromptDraft(DEFAULT_COMMIT_MESSAGE_PROMPT);
    setCommitMessagePromptSaving(true);
    try {
      await onUpdateAppSettings({
        ...appSettings,
        commitMessagePrompt: DEFAULT_COMMIT_MESSAGE_PROMPT,
      });
    } finally {
      setCommitMessagePromptSaving(false);
    }
  }, [appSettings, commitMessagePromptSaving, onUpdateAppSettings]);

  return {
    appSettings,
    onUpdateAppSettings,
    models,
    commitMessagePromptDraft,
    commitMessagePromptDirty,
    commitMessagePromptSaving,
    onSetCommitMessagePromptDraft: setCommitMessagePromptDraft,
    onSaveCommitMessagePrompt: handleSaveCommitMessagePrompt,
    onResetCommitMessagePrompt: handleResetCommitMessagePrompt,
    gitRuntimeInfo,
    gitRuntimeInfoLoading,
    gitRuntimeInfoError,
    onRefreshGitRuntimeInfo: refreshGitRuntimeInfo,
  };
};
