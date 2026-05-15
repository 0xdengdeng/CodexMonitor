import type { TurnPlan } from "../../../types";
import { useI18n } from "@/features/i18n/i18n";
import { Check, Circle, Loader2 } from "lucide-react";

type PlanPanelProps = {
  plan: TurnPlan | null;
  isProcessing: boolean;
};

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

function statusIcon(status: TurnPlan["steps"][number]["status"]) {
  if (status === "completed") {
    return <Check size={13} strokeWidth={2.8} />;
  }
  if (status === "inProgress") {
    return <Loader2 size={13} strokeWidth={2.5} />;
  }
  return <Circle size={13} strokeWidth={2.1} />;
}

export function PlanPanel({ plan, isProcessing }: PlanPanelProps) {
  const { t } = useI18n();
  const progress = plan ? formatProgress(plan) : "";
  const percent = progressPercent(plan);
  const steps = plan?.steps ?? [];
  const showEmpty = !steps.length && !plan?.explanation;
  const emptyLabel = isProcessing ? t("plan.waiting") : t("plan.empty");

  return (
    <aside className="plan-panel">
      <div className="plan-header">
        <span>{t("plan.title")}</span>
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
    </aside>
  );
}
