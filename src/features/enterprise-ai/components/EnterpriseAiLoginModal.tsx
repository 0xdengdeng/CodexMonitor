import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Building2, KeyRound } from "lucide-react";
import type { EnterpriseAiLoginResult } from "@/types";
import { ModalShell } from "@/features/design-system/components/modal/ModalShell";
import { useI18n } from "@/features/i18n/i18n";
import { enterpriseAiLogin } from "@services/tauri";

type EnterpriseAiLoginModalProps = {
  initialTenantDomain?: string | null;
  onCancel: () => void;
  onSuccess: (result: EnterpriseAiLoginResult) => void | Promise<void>;
};

export function EnterpriseAiLoginModal({
  initialTenantDomain,
  onCancel,
  onSuccess,
}: EnterpriseAiLoginModalProps) {
  const { t } = useI18n();
  const [tenantDomain, setTenantDomain] = useState(initialTenantDomain ?? "");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const tenantInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    tenantInputRef.current?.focus();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedTenantDomain = tenantDomain.trim();
    const normalizedApiKey = apiKey.trim();

    if (!normalizedTenantDomain) {
      setError(t("settings.codex.enterpriseTenantRequired"));
      return;
    }
    if (!normalizedApiKey) {
      setError(t("settings.codex.apiKeyRequired"));
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const result = await enterpriseAiLogin(normalizedTenantDomain, normalizedApiKey);
      await onSuccess(result);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t("enterpriseAi.login.failed"),
      );
      setIsSubmitting(false);
    }
  };

  return (
    <ModalShell
      ariaLabelledBy="enterprise-ai-login-title"
      ariaDescribedBy="enterprise-ai-login-description"
      className="enterprise-ai-login-modal"
      cardClassName="enterprise-ai-login-modal-card"
      onBackdropClick={() => {
        if (!isSubmitting) {
          onCancel();
        }
      }}
    >
      <form className="enterprise-ai-login-form" onSubmit={handleSubmit}>
        <div className="enterprise-ai-login-header">
          <div className="enterprise-ai-login-mark" aria-hidden="true">
            <KeyRound size={22} />
          </div>
          <div>
            <div id="enterprise-ai-login-title" className="ds-modal-title">
              {t("enterpriseAi.login.title")}
            </div>
            <div id="enterprise-ai-login-description" className="ds-modal-subtitle">
              {t("enterpriseAi.login.subtitle")}
            </div>
          </div>
        </div>

        <label className="enterprise-ai-login-field" htmlFor="enterprise-ai-tenant-domain">
          <span className="ds-modal-label">{t("settings.codex.enterpriseTenantDomain")}</span>
          <span className="enterprise-ai-login-input-wrap">
            <Building2 size={18} aria-hidden="true" />
            <input
              id="enterprise-ai-tenant-domain"
              ref={tenantInputRef}
              className="ds-modal-input enterprise-ai-login-input"
              value={tenantDomain}
              onChange={(event) => setTenantDomain(event.target.value)}
              placeholder={t("settings.codex.enterpriseTenantPlaceholder")}
              autoComplete="organization"
              disabled={isSubmitting}
            />
          </span>
        </label>

        <label className="enterprise-ai-login-field" htmlFor="enterprise-ai-api-key">
          <span className="ds-modal-label">{t("settings.codex.managedRuntimeApiKey")}</span>
          <span className="enterprise-ai-login-input-wrap">
            <KeyRound size={18} aria-hidden="true" />
            <input
              id="enterprise-ai-api-key"
              className="ds-modal-input enterprise-ai-login-input"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={t("enterpriseAi.login.apiKeyPlaceholder")}
              autoComplete="off"
              type="password"
              disabled={isSubmitting}
            />
          </span>
        </label>

        {error && <div className="ds-modal-error">{error}</div>}

        <div className="ds-modal-actions enterprise-ai-login-actions">
          <button
            type="button"
            className="ghost ds-modal-button"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t("settings.common.cancel")}
          </button>
          <button type="submit" className="primary ds-modal-button" disabled={isSubmitting}>
            {isSubmitting
              ? t("settings.codex.enterpriseLoggingIn")
              : t("settings.codex.enterpriseLoginAction")}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
