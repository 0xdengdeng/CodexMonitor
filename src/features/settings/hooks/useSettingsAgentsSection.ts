import { useCallback, useEffect, useState } from "react";
import type { AgentsSettings, GeneratedAgentConfiguration } from "@services/tauri";
import type { ModelOption, WorkspaceInfo } from "@/types";
import {
  connectWorkspace,
  createAgent,
  deleteAgent,
  generateAgentDescription,
  getAgentsSettings,
  readAgentConfigToml,
  setAgentsCoreSettings,
  updateAgent,
  writeAgentConfigToml,
} from "@services/tauri";
import { useSettingsDefaultModels } from "./useSettingsDefaultModels";
import { useI18n } from "@/features/i18n/i18n";

type UseSettingsAgentsSectionArgs = {
  projects: WorkspaceInfo[];
};

export type SettingsAgentsSectionProps = {
  settings: AgentsSettings | null;
  isLoading: boolean;
  isUpdatingCore: boolean;
  creatingAgent: boolean;
  updatingAgentName: string | null;
  deletingAgentName: string | null;
  readingConfigAgentName: string | null;
  writingConfigAgentName: string | null;
  error: string | null;
  onRefresh: () => void;
  onSetMultiAgentEnabled: (enabled: boolean) => Promise<boolean>;
  onSetMaxThreads: (maxThreads: number) => Promise<boolean>;
  onSetMaxDepth: (maxDepth: number) => Promise<boolean>;
  onCreateAgent: (input: {
    name: string;
    description?: string | null;
    developerInstructions?: string | null;
    template?: "blank";
    model?: string | null;
    reasoningEffort?: string | null;
  }) => Promise<boolean>;
  onUpdateAgent: (input: {
    originalName: string;
    name: string;
    description?: string | null;
    developerInstructions?: string | null;
    renameManagedFile?: boolean;
  }) => Promise<boolean>;
  onDeleteAgent: (input: {
    name: string;
    deleteManagedFile?: boolean;
  }) => Promise<boolean>;
  onReadAgentConfig: (agentName: string) => Promise<string | null>;
  onWriteAgentConfig: (agentName: string, content: string) => Promise<boolean>;
  createDescriptionGenerating: boolean;
  editDescriptionGenerating: boolean;
  onGenerateCreateDescription: (seed: {
    name?: string;
    description: string;
    developerInstructions: string;
  }) => Promise<GeneratedAgentConfiguration | null>;
  onGenerateEditDescription: (seed: {
    name?: string;
    description: string;
    developerInstructions: string;
  }) => Promise<GeneratedAgentConfiguration | null>;
  modelOptions: ModelOption[];
  modelOptionsLoading: boolean;
  modelOptionsError: string | null;
};

const toErrorMessage = (value: unknown, fallback: string): string => {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return fallback;
};

export const useSettingsAgentsSection = ({
  projects,
}: UseSettingsAgentsSectionArgs): SettingsAgentsSectionProps => {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AgentsSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdatingCore, setIsUpdatingCore] = useState(false);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [updatingAgentName, setUpdatingAgentName] = useState<string | null>(null);
  const [deletingAgentName, setDeletingAgentName] = useState<string | null>(null);
  const [readingConfigAgentName, setReadingConfigAgentName] = useState<string | null>(null);
  const [writingConfigAgentName, setWritingConfigAgentName] = useState<string | null>(null);
  const [generatingDescriptionTarget, setGeneratingDescriptionTarget] = useState<
    "create" | "edit" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const sourceWorkspaceId = projects[0]?.id ?? null;
  const sourceWorkspaceName = projects[0]?.name ?? null;
  const sourceWorkspaceConnected = projects[0]?.connected ?? false;
  const {
    models: modelOptions,
    isLoading: modelOptionsLoading,
    error: modelOptionsError,
  } = useSettingsDefaultModels(projects);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await getAgentsSettings();
      setSettings(response);
    } catch (refreshError) {
      setError(toErrorMessage(refreshError, t("settings.agents.loadFailed")));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyCoreSettings = useCallback(
    async (
      multiAgentEnabled: boolean,
      maxThreads: number,
      maxDepth: number,
    ): Promise<boolean> => {
      setIsUpdatingCore(true);
      setError(null);
      try {
        const response = await setAgentsCoreSettings({
          multiAgentEnabled,
          maxThreads,
          maxDepth,
        });
        setSettings(response);
        return true;
      } catch (updateError) {
        setError(toErrorMessage(updateError, t("settings.agents.updateCoreFailed")));
        return false;
      } finally {
        setIsUpdatingCore(false);
      }
    },
    [t],
  );

  const onSetMultiAgentEnabled = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      if (!settings) {
        return false;
      }
      return applyCoreSettings(enabled, settings.maxThreads, settings.maxDepth);
    },
    [applyCoreSettings, settings],
  );

  const onSetMaxThreads = useCallback(
    async (maxThreads: number): Promise<boolean> => {
      if (!settings) {
        return false;
      }
      return applyCoreSettings(settings.multiAgentEnabled, maxThreads, settings.maxDepth);
    },
    [applyCoreSettings, settings],
  );

  const onSetMaxDepth = useCallback(
    async (maxDepth: number): Promise<boolean> => {
      if (!settings) {
        return false;
      }
      return applyCoreSettings(settings.multiAgentEnabled, settings.maxThreads, maxDepth);
    },
    [applyCoreSettings, settings],
  );

  const onCreateAgent = useCallback(
    async (input: {
      name: string;
      description?: string | null;
      developerInstructions?: string | null;
      template?: "blank";
      model?: string | null;
      reasoningEffort?: string | null;
    }): Promise<boolean> => {
      setCreatingAgent(true);
      setError(null);
      try {
        const response = await createAgent(input);
        setSettings(response);
        return true;
      } catch (createError) {
        setError(toErrorMessage(createError, t("settings.agents.createFailed")));
        return false;
      } finally {
        setCreatingAgent(false);
      }
    },
    [t],
  );

  const onUpdateAgent = useCallback(
    async (input: {
      originalName: string;
      name: string;
      description?: string | null;
      developerInstructions?: string | null;
      renameManagedFile?: boolean;
    }): Promise<boolean> => {
      setUpdatingAgentName(input.originalName);
      setError(null);
      try {
        const response = await updateAgent(input);
        setSettings(response);
        return true;
      } catch (updateError) {
        setError(toErrorMessage(updateError, t("settings.agents.updateFailed")));
        return false;
      } finally {
        setUpdatingAgentName((current) =>
          current === input.originalName ? null : current,
        );
      }
    },
    [t],
  );

  const onDeleteAgent = useCallback(
    async (input: {
      name: string;
      deleteManagedFile?: boolean;
    }): Promise<boolean> => {
      setDeletingAgentName(input.name);
      setError(null);
      try {
        const response = await deleteAgent(input);
        setSettings(response);
        return true;
      } catch (deleteError) {
        setError(toErrorMessage(deleteError, t("settings.agents.deleteFailed")));
        return false;
      } finally {
        setDeletingAgentName((current) => (current === input.name ? null : current));
      }
    },
    [t],
  );

  const onReadAgentConfig = useCallback(async (agentName: string): Promise<string | null> => {
    setReadingConfigAgentName(agentName);
    setError(null);
    try {
      return await readAgentConfigToml(agentName);
    } catch (readError) {
      setError(toErrorMessage(readError, t("settings.agents.readConfigFailed")));
      return null;
    } finally {
      setReadingConfigAgentName((current) =>
        current === agentName ? null : current,
      );
    }
  }, [t]);

  const onWriteAgentConfig = useCallback(
    async (agentName: string, content: string): Promise<boolean> => {
      setWritingConfigAgentName(agentName);
      setError(null);
      try {
        await writeAgentConfigToml(agentName, content);
        await refresh();
        return true;
      } catch (writeError) {
        setError(toErrorMessage(writeError, t("settings.agents.writeConfigFailed")));
        return false;
      } finally {
        setWritingConfigAgentName((current) =>
          current === agentName ? null : current,
        );
      }
    },
    [refresh],
  );

  const generateDescription = useCallback(
    async (
      target: "create" | "edit",
      seed: { name?: string; description: string; developerInstructions: string },
    ): Promise<GeneratedAgentConfiguration | null> => {
      const nameSeed = seed.name?.trim() ?? "";
      const descriptionSeed = seed.description.trim();
      const developerInstructionsSeed = seed.developerInstructions.trim();
      if (!sourceWorkspaceId || !sourceWorkspaceName) {
        setError(t("settings.agents.addWorkspaceBeforeGenerate"));
        return null;
      }

      const promptSeed = [
        nameSeed ? `Agent name:\n${nameSeed}` : null,
        descriptionSeed ? `Description seed:\n${descriptionSeed}` : null,
        developerInstructionsSeed
          ? `Developer instructions seed:\n${developerInstructionsSeed}`
          : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n\n")
        .trim();
      const effectivePromptSeed =
        promptSeed.length > 0
          ? promptSeed
          : t("settings.agents.generatePromptDefault");

      setGeneratingDescriptionTarget(target);
      setError(null);
      try {
        if (!sourceWorkspaceConnected) {
          await connectWorkspace(sourceWorkspaceId);
        }
        const generated = await generateAgentDescription(sourceWorkspaceId, effectivePromptSeed);
        const nextDescription = generated.description.trim();
        const nextInstructions = generated.developerInstructions.trim();
        if (!nextDescription && !nextInstructions) {
          setError(t("settings.agents.generatedEmpty"));
          return null;
        }
        return {
          description: nextDescription,
          developerInstructions: nextInstructions,
        };
      } catch (generateError) {
        setError(toErrorMessage(generateError, t("settings.agents.generateFailed")));
        return null;
      } finally {
        setGeneratingDescriptionTarget((current) =>
          current === target ? null : current,
        );
      }
    },
    [sourceWorkspaceConnected, sourceWorkspaceId, sourceWorkspaceName, t],
  );

  return {
    settings,
    isLoading,
    isUpdatingCore,
    creatingAgent,
    updatingAgentName,
    deletingAgentName,
    readingConfigAgentName,
    writingConfigAgentName,
    error,
    onRefresh: () => {
      void refresh();
    },
    onSetMultiAgentEnabled,
    onSetMaxThreads,
    onSetMaxDepth,
    onCreateAgent,
    onUpdateAgent,
    onDeleteAgent,
    onReadAgentConfig,
    onWriteAgentConfig,
    createDescriptionGenerating: generatingDescriptionTarget === "create",
    editDescriptionGenerating: generatingDescriptionTarget === "edit",
    onGenerateCreateDescription: (seed) => generateDescription("create", seed),
    onGenerateEditDescription: (seed) => generateDescription("edit", seed),
    modelOptions,
    modelOptionsLoading,
    modelOptionsError,
  };
};
