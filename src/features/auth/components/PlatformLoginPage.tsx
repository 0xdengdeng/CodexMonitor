import { useState } from "react";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check";
import Building2 from "lucide-react/dist/esm/icons/building-2";
import KeyRound from "lucide-react/dist/esm/icons/key-round";
import type { LanguagePreference } from "@/types";
import { PRODUCT_NAME } from "@/config/brand";
import { LanguageSwitcher } from "@app/components/LanguageSwitcher";
import type { PlatformLoginInput } from "../platformSession";

type PlatformLoginPageProps = {
  language: LanguagePreference;
  onChangeLanguage: (language: LanguagePreference) => void;
  onSubmit: (input: PlatformLoginInput) => void;
};

const copy = {
  "zh-CN": {
    title: PRODUCT_NAME,
    subtitle: "用公司分配的 API Key 登录，开始让 AI 协助开发、修复和审查项目。",
    tenantLabel: "租户域",
    tenantPlaceholder: "例如：acme",
    apiKeyLabel: "API Key",
    apiKeyPlaceholder: "粘贴公司负责人分配给你的 API Key",
    submit: "进入工作台",
    secureTitle: "企业级接入",
    secureText: "第一版先在本地建立会话，后续会接入统一网关校验。",
    point1: "一个公司对应一个租户域",
    point2: "每位用户使用个人 API Key",
    point3: "模型能力保持 Codex 原有配置",
  },
  "en-US": {
    title: "Enterprise AI Dev Workbench",
    subtitle:
      "Sign in with your company API key to let AI help develop, fix, and review projects.",
    tenantLabel: "Tenant domain",
    tenantPlaceholder: "Example: acme",
    apiKeyLabel: "API Key",
    apiKeyPlaceholder: "Paste the API key assigned by your company owner",
    submit: "Enter workspace",
    secureTitle: "Enterprise access",
    secureText:
      "The first version creates a local session. Gateway validation comes next.",
    point1: "One tenant domain per company",
    point2: "Each user signs in with a personal API key",
    point3: "Model settings stay compatible with Codex",
  },
} satisfies Record<LanguagePreference, Record<string, string>>;

export function PlatformLoginPage({
  language,
  onChangeLanguage,
  onSubmit,
}: PlatformLoginPageProps) {
  const t = copy[language];
  const [tenantDomain, setTenantDomain] = useState("");
  const [apiKey, setApiKey] = useState("");
  const canSubmit = tenantDomain.trim().length > 0 && apiKey.trim().length > 0;

  return (
    <main className="platform-login">
      <div className="platform-login-topbar">
        <div className="platform-login-brand">{PRODUCT_NAME}</div>
        <LanguageSwitcher
          language={language}
          onChangeLanguage={onChangeLanguage}
        />
      </div>
      <section className="platform-login-panel">
        <div className="platform-login-copy">
          <div className="platform-login-badge">
            <ShieldCheck size={16} aria-hidden />
            {t.secureTitle}
          </div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
          <div className="platform-login-points">
            <span>{t.point1}</span>
            <span>{t.point2}</span>
            <span>{t.point3}</span>
          </div>
        </div>
        <form
          className="platform-login-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) {
              return;
            }
            onSubmit({
              tenantDomain: tenantDomain.trim(),
              apiKey: apiKey.trim(),
            });
          }}
        >
          <div className="platform-login-field">
            <label htmlFor="tenant-domain">{t.tenantLabel}</label>
            <div className="platform-login-input-wrap">
              <Building2 size={16} aria-hidden />
              <input
                id="tenant-domain"
                value={tenantDomain}
                onChange={(event) => setTenantDomain(event.target.value)}
                placeholder={t.tenantPlaceholder}
                autoComplete="organization"
              />
            </div>
          </div>
          <div className="platform-login-field">
            <label htmlFor="api-key">{t.apiKeyLabel}</label>
            <div className="platform-login-input-wrap">
              <KeyRound size={16} aria-hidden />
              <input
                id="api-key"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={t.apiKeyPlaceholder}
                type="password"
                autoComplete="current-password"
              />
            </div>
          </div>
          <button
            className="platform-login-submit"
            type="submit"
            disabled={!canSubmit}
          >
            {t.submit}
          </button>
          <p className="platform-login-note">{t.secureText}</p>
        </form>
      </section>
    </main>
  );
}
