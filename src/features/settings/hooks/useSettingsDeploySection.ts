import { useCallback, useEffect, useState } from "react";
import type { BackendMode } from "@/types";
import { deployClearToken, deploySetToken, deployTokenStatus } from "@services/tauri";
import { useI18n } from "@/features/i18n/i18n";

export type SettingsDeploySectionProps = {
  remoteUnsupported: boolean;
  tokenConfigured: boolean;
  tokenDraft: string;
  saving: boolean;
  error: string | null;
  onTokenDraftChange: (value: string) => void;
  onSaveToken: () => Promise<void>;
  onClearToken: () => Promise<void>;
};

function errorText(err: unknown, fallback: string): string {
  if (typeof err === "string" && err.trim()) {
    return err;
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

/**
 * Local state for the deploy-token settings section (set / clear / status of the sk-adgd_ token).
 * App-only: the deploy token commands reject in remote mode, so we skip the probe and show an
 * unsupported note rather than surfacing a backend rejection as a red error.
 */
export function useSettingsDeploySection(
  backendMode: BackendMode,
): SettingsDeploySectionProps {
  const { t } = useI18n();
  const remoteUnsupported = backendMode === "remote";
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (remoteUnsupported) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const configured = await deployTokenStatus();
        if (!cancelled) {
          setTokenConfigured(configured);
        }
      } catch (err) {
        if (!cancelled) {
          setError(errorText(err, t("settings.deploy.statusCheckFailed")));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remoteUnsupported, t]);

  const onSaveToken = useCallback(async () => {
    const normalized = tokenDraft.trim();
    if (!normalized) {
      setError(t("settings.deploy.tokenRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await deploySetToken(normalized);
      setTokenConfigured(true);
      setTokenDraft("");
    } catch (err) {
      setError(errorText(err, t("settings.deploy.saveFailed")));
    } finally {
      setSaving(false);
    }
  }, [tokenDraft, t]);

  const onClearToken = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await deployClearToken();
      setTokenConfigured(false);
      setTokenDraft("");
    } catch (err) {
      setError(errorText(err, t("settings.deploy.clearFailed")));
    } finally {
      setSaving(false);
    }
  }, [t]);

  return {
    remoteUnsupported,
    tokenConfigured,
    tokenDraft,
    saving,
    error,
    onTokenDraftChange: setTokenDraft,
    onSaveToken,
    onClearToken,
  };
}
