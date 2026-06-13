import { useCallback, useEffect, useId, useState } from "react";
import type { CSSProperties } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { LucideIcon } from "lucide-react";
import GitPullRequest from "lucide-react/dist/esm/icons/git-pull-request";
import Image from "lucide-react/dist/esm/icons/image";
import Plug from "lucide-react/dist/esm/icons/plug";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import WandSparkles from "lucide-react/dist/esm/icons/wand-sparkles";
import { useI18n } from "@/features/i18n/i18n";
import { useUpdateDemoPlayback } from "../hooks/useUpdateDemoPlayback";
import type { UpdateDemoGuide, UpdateDemoStep } from "../utils/updateDemoGuides";

type UpdateDemoGuideModalProps = {
  guide: UpdateDemoGuide;
  releaseNotesUrl?: string | null;
  onDismiss: () => void;
  onTryIt: () => void;
};

type GuideLayout = {
  anchored: boolean;
  targetStyle?: CSSProperties;
  cardStyle: CSSProperties;
  placement: "top" | "right" | "bottom" | "left" | "center";
};

type GuidePhase = "intro" | "tour";

type IntroItem = {
  titleKey: UpdateDemoGuide["titleKey"];
  bodyKey: UpdateDemoGuide["subtitleKey"];
  icon: LucideIcon;
};

const CARD_WIDTH = 372;
const CARD_HEIGHT = 334;
const INTRO_WIDTH = 680;
const VIEWPORT_GAP = 16;
const TARGET_PADDING = 8;
const TARGET_SELECTOR = "[data-update-guide-target]";

function getStepIcon(step: UpdateDemoStep): LucideIcon {
  switch (step.id) {
    case "project-context":
      return Sparkles;
    case "image-context":
    case "task-context":
      return Image;
    case "generate-image":
      return WandSparkles;
    case "capability-center":
      return Plug;
    case "review-work":
      return GitPullRequest;
    default:
      return Sparkles;
  }
}

function getIntroItems(guide: UpdateDemoGuide): IntroItem[] {
  if (guide.kind === "firstLaunch") {
    return [
      {
        titleKey: "updateDemo.firstLaunch.addProjectTitle",
        bodyKey: "updateDemo.firstLaunch.addProjectBody",
        icon: Sparkles,
      },
      {
        titleKey: "updateDemo.firstLaunch.startThreadTitle",
        bodyKey: "updateDemo.firstLaunch.startThreadBody",
        icon: Image,
      },
      {
        titleKey: "updateDemo.firstLaunch.reviewWorkTitle",
        bodyKey: "updateDemo.firstLaunch.reviewWorkBody",
        icon: GitPullRequest,
      },
    ];
  }
  return [
    {
      titleKey: "updateDemo.releaseConsole.projectContextTitle",
      bodyKey: "updateDemo.releaseConsole.projectContextBody",
      icon: Sparkles,
    },
    {
      titleKey: "updateDemo.releaseConsole.visualContextTitle",
      bodyKey: "updateDemo.releaseConsole.visualContextBody",
      icon: WandSparkles,
    },
    {
      titleKey: "updateDemo.releaseConsole.controlTitle",
      bodyKey: "updateDemo.releaseConsole.controlBody",
      icon: GitPullRequest,
    },
  ];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getTargetTokens(element: HTMLElement): string[] {
  return (element.dataset.updateGuideTarget ?? "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function findGuideTarget(focus: UpdateDemoStep["focus"]): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(TARGET_SELECTOR),
  );
  return (
    candidates.find((candidate) => getTargetTokens(candidate).includes(focus)) ??
    null
  );
}

function buildAnchoredLayout(target: HTMLElement): GuideLayout {
  const rect = target.getBoundingClientRect();
  const viewportWidth = window.innerWidth || 1024;
  const viewportHeight = window.innerHeight || 768;
  const targetLeft = clamp(
    rect.left - TARGET_PADDING,
    VIEWPORT_GAP,
    viewportWidth - VIEWPORT_GAP,
  );
  const targetTop = clamp(
    rect.top - TARGET_PADDING,
    VIEWPORT_GAP,
    viewportHeight - VIEWPORT_GAP,
  );
  const targetWidth = Math.max(44, rect.width + TARGET_PADDING * 2);
  const targetHeight = Math.max(44, rect.height + TARGET_PADDING * 2);
  const rightSpace = viewportWidth - (rect.right + VIEWPORT_GAP);
  const leftSpace = rect.left - VIEWPORT_GAP;
  const bottomSpace = viewportHeight - (rect.bottom + VIEWPORT_GAP);
  const topSpace = rect.top - VIEWPORT_GAP;
  let placement: GuideLayout["placement"] = "right";
  let left = rect.right + 18;
  let top = rect.top + rect.height / 2 - CARD_HEIGHT / 2;

  if (rightSpace < CARD_WIDTH && leftSpace >= CARD_WIDTH) {
    placement = "left";
    left = rect.left - CARD_WIDTH - 18;
  } else if (rightSpace < CARD_WIDTH && bottomSpace >= CARD_HEIGHT) {
    placement = "bottom";
    left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
    top = rect.bottom + 18;
  } else if (rightSpace < CARD_WIDTH && topSpace >= CARD_HEIGHT) {
    placement = "top";
    left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
    top = rect.top - CARD_HEIGHT - 18;
  }

  return {
    anchored: true,
    placement,
    targetStyle: {
      left: targetLeft,
      top: targetTop,
      width: clamp(targetWidth, 44, viewportWidth - VIEWPORT_GAP * 2),
      height: clamp(targetHeight, 44, viewportHeight - VIEWPORT_GAP * 2),
    },
    cardStyle: {
      left: clamp(left, VIEWPORT_GAP, viewportWidth - CARD_WIDTH - VIEWPORT_GAP),
      top: clamp(top, VIEWPORT_GAP, viewportHeight - CARD_HEIGHT - VIEWPORT_GAP),
      width: CARD_WIDTH,
    },
  };
}

function buildFallbackLayout(): GuideLayout {
  return {
    anchored: false,
    placement: "center",
    cardStyle: {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      width: CARD_WIDTH,
    },
  };
}

function buildIntroLayout(): GuideLayout {
  return {
    anchored: false,
    placement: "center",
    cardStyle: {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      width: INTRO_WIDTH,
    },
  };
}

export function UpdateDemoGuideModal({
  guide,
  releaseNotesUrl,
  onDismiss,
  onTryIt,
}: UpdateDemoGuideModalProps) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const [phase, setPhase] = useState<GuidePhase>("intro");
  const [layout, setLayout] = useState<GuideLayout>(() => buildIntroLayout());
  const { activeStep, progress, seekToStep, usesStaticSteps } =
    useUpdateDemoPlayback(guide);
  const isFirstLaunch = guide.kind === "firstLaunch";
  const introItems = getIntroItems(guide);
  const activeStepIndex = Math.max(
    0,
    guide.steps.findIndex((step) => step.id === activeStep.id),
  );

  const updateLayout = useCallback(
    (shouldScroll: boolean) => {
      const target = findGuideTarget(activeStep.focus);
      if (!target) {
        setLayout(buildFallbackLayout());
        return;
      }
      if (shouldScroll && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({
          block: "center",
          inline: "center",
          behavior: "smooth",
        });
      }
      window.requestAnimationFrame(() => {
        setLayout(buildAnchoredLayout(target));
      });
    },
    [activeStep.focus],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  useEffect(() => {
    if (phase === "intro") {
      setLayout(buildIntroLayout());
      return undefined;
    }
    updateLayout(true);
    const handleViewportChange = () => updateLayout(false);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [phase, updateLayout]);

  return (
    <div
      className={`update-demo-modal ${
        phase === "intro"
          ? "is-intro"
          : layout.anchored
            ? "is-anchored"
            : "is-fallback"
      } placement-${layout.placement}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <button
        className="update-demo-backdrop"
        type="button"
        aria-label={t("settings.close")}
        onClick={onDismiss}
      />
      {phase === "tour" && layout.anchored && (
        <div className="update-demo-target-ring" style={layout.targetStyle} />
      )}

      <section className="update-demo-card" style={layout.cardStyle}>
        {phase === "intro" ? (
          <>
            <header className="update-demo-intro-header">
              <div>
                <div className="update-demo-kicker">
                  {isFirstLaunch
                    ? t("updateDemo.firstLaunch.kicker")
                    : t("updateDemo.firstOfficialRelease")}
                </div>
                <h2 className="update-demo-title" id={titleId}>
                  {t(guide.titleKey)}
                </h2>
              </div>
              <div className="update-demo-version-mark">v{guide.version}</div>
            </header>

            <p className="update-demo-subtitle" id={descriptionId}>
              {t(guide.subtitleKey)}
            </p>

            <div className="update-demo-intro-flow">
              {introItems.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <div className="update-demo-intro-item" key={item.titleKey}>
                    <span className="update-demo-intro-icon">
                      <ItemIcon size={16} aria-hidden />
                    </span>
                    <div>
                      <strong>{t(item.titleKey)}</strong>
                      <p>{t(item.bodyKey)}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <footer className="update-demo-actions">
              <button className="secondary" type="button" onClick={onDismiss}>
                {t("updateDemo.skip")}
              </button>
              {releaseNotesUrl && (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    void openUrl(releaseNotesUrl);
                  }}
                >
                  {t("updateDemo.releaseNotes")}
                </button>
              )}
              <button
                className="primary"
                type="button"
                onClick={() => setPhase("tour")}
              >
                {t("updateDemo.startTour")}
              </button>
            </footer>
          </>
        ) : (
          <>
            <header className="update-demo-header">
              <div className="update-demo-kicker">
                {isFirstLaunch
                  ? t("updateDemo.firstLaunch.kicker")
                  : t("updateDemo.firstOfficialRelease")}
              </div>
              <div className="update-demo-step-count">
                {t("updateDemo.currentStep", {
                  current: String(activeStepIndex + 1),
                  total: String(guide.steps.length),
                })}
              </div>
            </header>

            <div className="update-demo-heading">
              <h2 className="update-demo-title" id={titleId}>
                {t(activeStep.captionTitleKey)}
              </h2>
              <p className="update-demo-subtitle" id={descriptionId}>
                {t(activeStep.captionBodyKey)}
              </p>
            </div>

            {!layout.anchored && (
              <div className="update-demo-fallback">
                <strong>{t("updateDemo.targetMissingTitle")}</strong>
                <p>{t("updateDemo.targetMissingBody")}</p>
              </div>
            )}

            {layout.anchored && (
              <div className="update-demo-anchor-hint">
                {t("updateDemo.anchoredHint")}
              </div>
            )}

            {usesStaticSteps ? (
              <div
                className="update-demo-static"
                aria-label={t("updateDemo.stageAria")}
              >
                <div className="update-demo-static-title">
                  {t("updateDemo.reducedMotionTitle")}
                </div>
                <div className="update-demo-static-steps">
                  {guide.steps.map((step, index) => (
                    <button
                      className={step.id === activeStep.id ? "is-active" : ""}
                      key={step.id}
                      type="button"
                      onClick={() => seekToStep(step.id)}
                    >
                      <span className="update-demo-static-index">{index + 1}</span>
                      <span>{t(step.labelKey)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <nav
                  className="update-demo-timeline"
                  aria-label={t("updateDemo.timelineAria")}
                >
                  {guide.steps.map((step) => {
                    const StepIcon = getStepIcon(step);
                    return (
                      <button
                        className={step.id === activeStep.id ? "is-active" : ""}
                        key={step.id}
                        type="button"
                        aria-pressed={step.id === activeStep.id}
                        onClick={() => seekToStep(step.id)}
                      >
                        <StepIcon size={15} aria-hidden />
                        <span>{t(step.labelKey)}</span>
                      </button>
                    );
                  })}
                </nav>
                <div className="update-demo-progress" aria-hidden>
                  <span style={{ width: `${progress}%` }} />
                </div>
              </>
            )}

            <footer className="update-demo-actions">
              <button className="secondary" type="button" onClick={onDismiss}>
                {t("updateDemo.skip")}
              </button>
              {releaseNotesUrl && (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    void openUrl(releaseNotesUrl);
                  }}
                >
                  {t("updateDemo.releaseNotes")}
                </button>
              )}
              <button className="primary" type="button" onClick={onTryIt}>
                {isFirstLaunch
                  ? t("updateDemo.firstLaunch.start")
                  : t("updateDemo.tryIt")}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
