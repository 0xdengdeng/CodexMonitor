import { useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ConversationItem, TurnPlan } from "../../../types";
import { useI18n } from "@/features/i18n/i18n";
import { Check, Circle, Loader2, Terminal, X } from "lucide-react";
import { normalizePublicImageModel } from "@/utils/imageModels";

type PlanPanelProps = {
  plan: TurnPlan | null;
  isProcessing: boolean;
  backgroundTasks?: BackgroundTask[];
  generatedImages?: GeneratedImageItem[];
  onOpenBackgroundTask?: (taskId: string) => void;
  onOpenGeneratedImage?: (imageId: string) => void;
};

export type BackgroundTask = {
  id: string;
  title: string;
  status?: "running" | "active" | "idle" | "exited";
  detail?: string | null;
};

export type GeneratedImageItem = Extract<
  ConversationItem,
  { kind: "imageGeneration" }
>;

function formatProgress(plan: TurnPlan) {
  const total = plan.steps.length;
  if (!total) {
    return "";
  }
  const completed = plan.steps.filter((step) => step.status === "completed").length;
  return `${completed}/${total}`;
}

function progressPercent(plan: TurnPlan | null) {
  const total = plan?.steps.length ?? 0;
  if (!plan || !total) {
    return 0;
  }
  const completed = plan.steps.filter((step) => step.status === "completed").length;
  return Math.round((completed / total) * 100);
}

function normalizeImageSrc(src: string | null) {
  if (!src) {
    return "";
  }
  if (
    src.startsWith("data:") ||
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("file://")
  ) {
    return src;
  }
  try {
    return convertFileSrc(src);
  } catch {
    return "";
  }
}

function basename(path: string | null) {
  if (!path) {
    return "";
  }
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function statusIcon(status: TurnPlan["steps"][number]["status"]) {
  if (status === "completed") {
    return <Check size={13} strokeWidth={2.8} />;
  }
  if (status === "inProgress") {
    return <Loader2 size={13} strokeWidth={2.5} />;
  }
  return <Circle size={13} strokeWidth={2.1} />;
}

function BackgroundTasksSection({
  tasks,
  onOpenTask,
}: {
  tasks: BackgroundTask[];
  onOpenTask?: (taskId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <section className="plan-section plan-section--tasks">
      <div className="plan-section-header">
        <span>{t("plan.backgroundTasks")}</span>
        {tasks.length > 0 && <span>{tasks.length}</span>}
      </div>
      {tasks.length === 0 ? (
        <div className="plan-empty plan-section-empty">
          {t("plan.noBackgroundTasks")}
        </div>
      ) : (
        <div className="plan-task-list">
          {tasks.map((task) => {
            const content = (
              <>
                <span
                  className={`plan-task-dot plan-task-dot--${
                    task.status ?? "running"
                  }`}
                />
                <Terminal size={14} aria-hidden />
                <span className="plan-task-title">{task.title}</span>
                {task.detail ? (
                  <span className="plan-task-detail">{task.detail}</span>
                ) : null}
              </>
            );
            return onOpenTask ? (
              <button
                key={task.id}
                type="button"
                className="plan-task plan-task--button"
                onClick={() => onOpenTask(task.id)}
              >
                {content}
              </button>
            ) : (
              <div key={task.id} className="plan-task">
                {content}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function GeneratedImagesSection({
  images,
  onOpenImage,
}: {
  images: GeneratedImageItem[];
  onOpenImage?: (imageId: string) => void;
}) {
  const { t } = useI18n();
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  const previewImage = useMemo(
    () => images.find((image) => image.id === previewImageId) ?? null,
    [images, previewImageId],
  );
  const previewSrc = normalizeImageSrc(
    previewImage?.imageSrc ?? previewImage?.savedPath ?? null,
  );

  const handleOpenImage = (image: GeneratedImageItem) => {
    onOpenImage?.(image.id);
    if (image.status === "completed") {
      setPreviewImageId(image.id);
    }
  };

  return (
    <section className="plan-section plan-section--images">
      <div className="plan-section-header">
        <span>{t("plan.generatedImages")}</span>
        {images.length > 0 && <span>{images.length}</span>}
      </div>
      {images.length === 0 ? (
        <div className="plan-empty plan-section-empty">
          {t("plan.noGeneratedImages")}
        </div>
      ) : (
        <div className="plan-image-list">
          {images.map((image) => {
            const src = normalizeImageSrc(image.imageSrc ?? image.savedPath);
            const displayModel = image.model ? normalizePublicImageModel(image.model) : "";
            const title = basename(image.savedPath) || image.prompt || displayModel;
            const isCompleted = image.status === "completed";
            return (
              <button
                key={image.id}
                type="button"
                className={`plan-image-item plan-image-item--${image.status}`}
                onClick={() => handleOpenImage(image)}
                title={image.savedPath ?? undefined}
                aria-label={t("plan.openGeneratedImage", {
                  title: title || t("messages.generatedImageAlt"),
                })}
              >
                <span className="plan-image-thumb" aria-hidden>
                  {isCompleted && src ? (
                    <img src={src} alt="" loading="lazy" />
                  ) : image.status === "failed" ? (
                    <X size={14} />
                  ) : (
                    <span className="plan-image-thumb-skeleton" />
                  )}
                </span>
                <span className="plan-image-content">
                  <span className="plan-image-title">{title}</span>
                  <span className="plan-image-meta">
                    {displayModel && <span>{displayModel}</span>}
                    {image.size && <span>{image.size}</span>}
                    {image.status !== "completed" && (
                      <span>
                        {image.status === "in_progress"
                          ? t("messages.status.processing")
                          : t(`messages.status.${image.status}`, {
                              fallback: image.status,
                            })}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {previewImage && previewSrc ? (
        <div
          className="message-image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={t("files.preview.image")}
          onClick={() => setPreviewImageId(null)}
        >
          <button
            type="button"
            className="message-image-lightbox-close"
            onClick={() => setPreviewImageId(null)}
            aria-label={t("messages.closeImagePreview")}
          >
            <X size={18} aria-hidden />
          </button>
          <div
            className="message-image-lightbox-content"
            onClick={(event) => event.stopPropagation()}
          >
            <img src={previewSrc} alt={t("messages.generatedImageAlt")} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function PlanPanel({
  plan,
  isProcessing,
  backgroundTasks = [],
  generatedImages = [],
  onOpenBackgroundTask,
  onOpenGeneratedImage,
}: PlanPanelProps) {
  const { t } = useI18n();
  const progress = plan ? formatProgress(plan) : "";
  const percent = progressPercent(plan);
  const steps = plan?.steps ?? [];
  const showEmpty = !steps.length && !plan?.explanation;
  const emptyLabel = isProcessing ? t("plan.waiting") : t("plan.empty");

  return (
    <aside className="plan-panel">
      <section className="plan-section plan-section--progress">
        <div className="plan-header">
          <span>{t("plan.progress")}</span>
          {progress && <span className="plan-progress">{progress}</span>}
        </div>
        {progress && (
          <div className="plan-meter" aria-hidden>
            <span style={{ width: `${percent}%` }} />
          </div>
        )}
        {plan?.explanation && (
          <div className="plan-explanation">{plan.explanation}</div>
        )}
        {showEmpty ? (
          <div className="plan-empty">{emptyLabel}</div>
        ) : (
          <ol className="plan-list">
            {steps.map((step, index) => (
              <li key={`${step.step}-${index}`} className={`plan-step ${step.status}`}>
                <span className="plan-step-status" aria-hidden>
                  {statusIcon(step.status)}
                </span>
                <span className="plan-step-text">{step.step}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <BackgroundTasksSection
        tasks={backgroundTasks}
        onOpenTask={onOpenBackgroundTask}
      />
      <GeneratedImagesSection
        images={generatedImages}
        onOpenImage={onOpenGeneratedImage}
      />
    </aside>
  );
}
