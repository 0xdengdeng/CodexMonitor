import type { Dispatch, RefObject, SetStateAction } from "react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import ImagePlus from "lucide-react/dist/esm/icons/image-plus";
import Plus from "lucide-react/dist/esm/icons/plus";
import {
  PopoverMenuItem,
  PopoverSurface,
} from "../../design-system/components/popover/PopoverPrimitives";
import { useI18n } from "@/features/i18n/i18n";

type ComposerMobileActionsMenuProps = {
  disabled: boolean;
  handleMobileAttachClick: () => void;
  handleMobileExpandClick: () => void;
  isExpanded: boolean;
  mobileActionsOpen: boolean;
  mobileActionsRef: RefObject<HTMLDivElement | null>;
  onAddAttachment?: () => void;
  onToggleExpand?: () => void;
  setMobileActionsOpen: Dispatch<SetStateAction<boolean>>;
};

export function ComposerMobileActionsMenu({
  disabled,
  handleMobileAttachClick,
  handleMobileExpandClick,
  isExpanded,
  mobileActionsOpen,
  mobileActionsRef,
  onAddAttachment,
  onToggleExpand,
  setMobileActionsOpen,
}: ComposerMobileActionsMenuProps) {
  const { t } = useI18n();
  const moreActionsLabel = t("composer.moreActions");

  return (
    <div
      className={`composer-mobile-menu${mobileActionsOpen ? " is-open" : ""}`}
      ref={mobileActionsRef}
    >
      <button
        type="button"
        className="composer-action composer-action--mobile-menu"
        onClick={() => setMobileActionsOpen((prev) => !prev)}
        disabled={disabled}
        aria-expanded={mobileActionsOpen}
        aria-haspopup="menu"
        aria-label={moreActionsLabel}
        title={moreActionsLabel}
      >
        <Plus size={14} aria-hidden />
      </button>
      {mobileActionsOpen && (
        <PopoverSurface className="composer-mobile-actions-popover" role="menu">
          <PopoverMenuItem
            onClick={handleMobileAttachClick}
            disabled={disabled || !onAddAttachment}
            icon={<ImagePlus size={14} />}
          >
            {t("composer.addImage")}
          </PopoverMenuItem>
          {onToggleExpand && (
            <PopoverMenuItem
              onClick={handleMobileExpandClick}
              disabled={disabled}
              icon={
                isExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />
              }
            >
              {isExpanded ? t("composer.collapseInput") : t("composer.expandInput")}
            </PopoverMenuItem>
          )}
        </PopoverSurface>
      )}
    </div>
  );
}
