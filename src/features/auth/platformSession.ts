const STORAGE_KEY = "enterprise-platform-session";

export type PlatformSession = {
  tenantDomain: string;
  keyPreview: string;
  signedInAt: number;
};

export type PlatformLoginInput = {
  tenantDomain: string;
  apiKey: string;
};

function maskApiKey(apiKey: string) {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) {
    return "••••";
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function loadPlatformSession(): PlatformSession | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PlatformSession>;
    if (!parsed.tenantDomain || !parsed.keyPreview || !parsed.signedInAt) {
      return null;
    }
    return {
      tenantDomain: parsed.tenantDomain,
      keyPreview: parsed.keyPreview,
      signedInAt: parsed.signedInAt,
    };
  } catch {
    return null;
  }
}

export function savePlatformSession(input: PlatformLoginInput): PlatformSession {
  const session: PlatformSession = {
    tenantDomain: input.tenantDomain.trim(),
    keyPreview: maskApiKey(input.apiKey),
    signedInAt: Date.now(),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function clearPlatformSession() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEY);
}
