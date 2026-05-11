import { pushErrorToast } from "@services/toasts";

const GENERIC_TITLE_ZH = "出了点问题";
const GENERIC_MESSAGE_ZH = "请稍后重试,或联系客服。";

type FriendlyErrorOptions = {
  title?: string;
  fallbackMessage?: string;
  includeOriginalMessage?: boolean;
};

function originalMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

export function pushFriendlyError(error: unknown, options?: FriendlyErrorOptions) {
  const title = options?.title ?? GENERIC_TITLE_ZH;
  const fallback = options?.fallbackMessage ?? GENERIC_MESSAGE_ZH;
  const detail = options?.includeOriginalMessage ? originalMessage(error) : null;
  const message = detail ? `${fallback}(${detail})` : fallback;

  console.error("[friendly-error]", error);

  return pushErrorToast({
    title,
    message,
  });
}
