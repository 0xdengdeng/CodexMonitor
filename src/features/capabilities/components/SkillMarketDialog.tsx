import { useMemo, useState } from "react";
import Check from "lucide-react/dist/esm/icons/check";
import Download from "lucide-react/dist/esm/icons/download";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Search from "lucide-react/dist/esm/icons/search";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import X from "lucide-react/dist/esm/icons/x";
import type {
  SkillInstallTarget,
  SkillMarketInstallInput,
  SkillMarketItem,
  WorkspaceInfo,
} from "@/types";
import { ModalShell } from "@/features/design-system/components/modal/ModalShell";
import {
  PanelNavItem,
  PanelNavList,
  PanelSearchField,
} from "@/features/design-system/components/panel/PanelPrimitives";
import { useI18n } from "@/features/i18n/i18n";

const CATEGORY_ORDER = ["all", "writing", "engineering", "design", "images", "productivity"];

export type SkillMarketDialogProps = {
  activeWorkspace: WorkspaceInfo | null;
  items: SkillMarketItem[];
  installedSkillNames: string[];
  onClose: () => void;
  onInstallSkill: (input: SkillMarketInstallInput) => Promise<void> | void;
};

function itemMatchesQuery(item: SkillMarketItem, query: string) {
  if (!query) {
    return true;
  }
  const haystack = `${item.name} ${item.title} ${item.description} ${item.tags.join(" ")}`.toLowerCase();
  return haystack.includes(query);
}

function categoryLabel(category: string, t: ReturnType<typeof useI18n>["t"]) {
  return t(`capabilities.market.category.${category}`);
}

export function SkillMarketDialog({
  activeWorkspace,
  items,
  installedSkillNames,
  onClose,
  onInstallSkill,
}: SkillMarketDialogProps) {
  const { t } = useI18n();
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [target, setTarget] = useState<SkillInstallTarget>("global");
  const [installing, setInstalling] = useState(false);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        const categoryMatches = category === "all" || item.categories.includes(category);
        return categoryMatches && itemMatchesQuery(item, normalizedQuery);
      }),
    [category, items, normalizedQuery],
  );
  const selectedItem =
    visibleItems.find((item) => item.id === selectedId) ?? visibleItems[0] ?? null;
  const installedNames = useMemo(
    () => new Set(installedSkillNames.map((name) => name.trim()).filter(Boolean)),
    [installedSkillNames],
  );

  const handleInstall = async () => {
    if (!selectedItem) {
      return;
    }
    setInstalling(true);
    try {
      await onInstallSkill({
        itemId: selectedItem.id,
        target,
      });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <ModalShell
      className="settings-overlay skill-market-overlay"
      cardClassName="settings-window skill-market-window"
      onBackdropClick={onClose}
      ariaLabelledBy="skill-market-title"
    >
      <div className="settings-titlebar skill-market-titlebar">
        <div className="settings-title" id="skill-market-title">
          {t("capabilities.market.title")}
        </div>
        <button
          type="button"
          className="ghost icon-button settings-close"
          onClick={onClose}
          aria-label={t("capabilities.market.close")}
        >
          <X aria-hidden />
        </button>
      </div>

      <div className="settings-body skill-market-body">
        <aside className="settings-sidebar skill-market-sidebar">
          <PanelNavList className="settings-nav-list skill-market-category-list">
            {CATEGORY_ORDER.map((entry) => (
              <PanelNavItem
                key={entry}
                className="settings-nav skill-market-category"
                icon={entry === "all" ? <Sparkles aria-hidden /> : <FileText aria-hidden />}
                active={category === entry}
                onClick={() => setCategory(entry)}
                aria-label={categoryLabel(entry, t)}
              >
                <span>{categoryLabel(entry, t)}</span>
              </PanelNavItem>
            ))}
          </PanelNavList>

          <div className="skill-market-advanced" aria-label={t("capabilities.market.advanced")}>
            <div>{t("capabilities.market.advanced")}</div>
            <button type="button" className="ghost" disabled>
              {t("capabilities.market.installFromUrl")}
            </button>
            <button type="button" className="ghost" disabled>
              {t("capabilities.market.installLocal")}
            </button>
          </div>
        </aside>

        <main className="settings-content skill-market-content">
          <div className="skill-market-list-pane">
            <div>
              <h2 className="settings-section-title">{t("capabilities.market.featured")}</h2>
              <p className="settings-section-subtitle">{t("capabilities.market.subtitle")}</p>
            </div>

            <PanelSearchField
              className="skill-market-search"
              icon={<Search aria-hidden />}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("capabilities.market.search")}
            />

            <div className="skill-market-list" aria-label={t("capabilities.market.results")}>
              {visibleItems.length > 0 ? (
                visibleItems.map((item) => {
                  const installed = installedNames.has(item.name);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`skill-market-card${selectedItem?.id === item.id ? " is-active" : ""}`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <span className="skill-market-card-main">
                        <span className="skill-market-card-title">
                          <strong>{item.title}</strong>
                          {installed ? (
                            <span className="capability-source">
                              {t("capabilities.market.installed")}
                            </span>
                          ) : null}
                        </span>
                        <span className="skill-market-card-description">
                          {item.description}
                        </span>
                        <span className="skill-market-card-meta">
                          {item.publisher} · {item.tags.slice(0, 3).join(" · ")}
                        </span>
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="capabilities-empty">{t("capabilities.market.empty")}</div>
              )}
            </div>
          </div>

          <aside className="skill-market-detail" aria-label={t("capabilities.market.detail")}>
            {selectedItem ? (
              <>
                <div className="skill-market-detail-head">
                  <div className="skill-market-detail-icon" aria-hidden>
                    <Sparkles />
                  </div>
                  <div>
                    <h3>{selectedItem.name}</h3>
                    <p>{selectedItem.publisher}</p>
                  </div>
                </div>

                <div className="skill-market-detail-section">
                  <span>{t("capabilities.market.publisher")}</span>
                  <strong>{selectedItem.publisher}</strong>
                </div>
                <div className="skill-market-detail-section">
                  <span>{t("capabilities.market.installTarget")}</span>
                  <div className="skill-market-targets">
                    <button
                      type="button"
                      className={target === "global" ? "is-active" : undefined}
                      aria-pressed={target === "global"}
                      onClick={() => setTarget("global")}
                    >
                      {t("capabilities.market.target.global")}
                    </button>
                    <button
                      type="button"
                      className={target === "project" ? "is-active" : undefined}
                      aria-pressed={target === "project"}
                      onClick={() => setTarget("project")}
                      disabled={!activeWorkspace}
                    >
                      {t("capabilities.market.target.project")}
                    </button>
                  </div>
                  {!activeWorkspace ? (
                    <p className="skill-market-note">
                      {t("capabilities.market.projectRequiresWorkspace")}
                    </p>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="button primary skill-market-install"
                  onClick={() => void handleInstall()}
                  disabled={installing}
                >
                  {installing ? (
                    t("capabilities.market.installing")
                  ) : (
                    <>
                      <Download aria-hidden />
                      {t("capabilities.market.install")}
                    </>
                  )}
                </button>

                {installedNames.has(selectedItem.name) ? (
                  <div className="skill-market-installed-note">
                    <Check aria-hidden />
                    <span>{t("capabilities.market.alreadyInstalled")}</span>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="capabilities-empty">{t("capabilities.market.noDetail")}</div>
            )}
          </aside>
        </main>
      </div>
    </ModalShell>
  );
}
