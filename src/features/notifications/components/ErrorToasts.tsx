import { useState } from "react";

import type { ErrorToast } from "../../../services/toasts";
import { copyDiagnostics } from "@services/diagnostics";
import {
  ToastBody,
  ToastCard,
  ToastHeader,
  ToastTitle,
  ToastViewport,
} from "../../design-system/components/toast/ToastPrimitives";
import { useI18n } from "@/features/i18n/i18n";

type ErrorToastsProps = {
  toasts: ErrorToast[];
  onDismiss: (id: string) => void;
};

function ErrorToastRow({
  toast,
  onDismiss,
}: {
  toast: ErrorToast;
  onDismiss: (id: string) => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await copyDiagnostics(new Error(`${toast.title}: ${toast.message}`));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — the message is still on screen for the user to copy.
    }
  };

  return (
    <ToastCard className="error-toast" role="alert">
      <ToastHeader className="error-toast-header">
        <ToastTitle className="error-toast-title">{toast.title}</ToastTitle>
        <button
          type="button"
          className="ghost error-toast-copy"
          onClick={handleCopy}
          title={t("error.copyDiagnostics")}
        >
          {copied ? t("error.copied") : t("error.copyDiagnostics")}
        </button>
        <button
          type="button"
          className="ghost error-toast-dismiss"
          onClick={() => onDismiss(toast.id)}
          aria-label={t("error.dismiss")}
          title={t("error.dismissTitle")}
        >
          ×
        </button>
      </ToastHeader>
      <ToastBody className="error-toast-body">{toast.message}</ToastBody>
    </ToastCard>
  );
}

export function ErrorToasts({ toasts, onDismiss }: ErrorToastsProps) {
  if (!toasts.length) {
    return null;
  }

  return (
    <ToastViewport className="error-toasts" role="region" ariaLive="assertive">
      {toasts.map((toast) => (
        <ErrorToastRow key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </ToastViewport>
  );
}
