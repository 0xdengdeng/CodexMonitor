import ArrowDownUp from "lucide-react/dist/esm/icons/arrow-down-up";
import BetweenHorizontalStart from "lucide-react/dist/esm/icons/between-horizontal-start";
import Calendar from "lucide-react/dist/esm/icons/calendar";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus";
import FolderTree from "lucide-react/dist/esm/icons/folder-tree";
import ListFilter from "lucide-react/dist/esm/icons/list-filter";
import ListTree from "lucide-react/dist/esm/icons/list-tree";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Search from "lucide-react/dist/esm/icons/search";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ThreadListOrganizeMode, ThreadListSortKey } from "../../../types";
import {
  MenuTrigger,
  PopoverMenuItem,
  PopoverSurface,
} from "../../design-system/components/popover/PopoverPrimitives";
import { useMenuController } from "../hooks/useMenuController";
import { useI18n } from "@/features/i18n/i18n";

type SidebarHeaderProps = {
  onSelectHome: () => void;
  onAddWorkspace: () => void;
  onToggleSearch: () => void;
  isSearchOpen: boolean;
  threadListSortKey: ThreadListSortKey;
  onSetThreadListSortKey: (sortKey: ThreadListSortKey) => void;
  threadListOrganizeMode: ThreadListOrganizeMode;
  onSetThreadListOrganizeMode: (organizeMode: ThreadListOrganizeMode) => void;
  onRefreshAllThreads: () => void;
  onOpenCapabilities: () => void;
  refreshDisabled?: boolean;
  refreshInProgress?: boolean;
};

const SORT_MENU_WIDTH = 196;
const SORT_MENU_GAP = 8;
const SORT_MENU_VIEWPORT_MARGIN = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function SidebarHeader({
  onSelectHome,
  onAddWorkspace,
  onToggleSearch,
  isSearchOpen,
  threadListSortKey,
  onSetThreadListSortKey,
  threadListOrganizeMode,
  onSetThreadListOrganizeMode,
  onRefreshAllThreads,
  onOpenCapabilities,
  refreshDisabled = false,
  refreshInProgress = false,
}: SidebarHeaderProps) {
  const { t } = useI18n();
  const sortMenu = useMenuController();
  const {
    isOpen: sortMenuOpen,
    containerRef: sortMenuRef,
    open: openSortMenu,
    close: closeSortMenu,
  } = sortMenu;
  const sortMenuPopoverRef = useRef<HTMLDivElement | null>(null);
  const [sortMenuPosition, setSortMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const calculateSortMenuPosition = useCallback(() => {
    const trigger = sortMenuRef.current;
    if (!trigger || typeof window === "undefined") {
      return null;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const availableWidth = Math.max(
      0,
      window.innerWidth - SORT_MENU_VIEWPORT_MARGIN * 2,
    );
    const menuWidth = Math.min(SORT_MENU_WIDTH, availableWidth);
    const maxLeft = Math.max(
      SORT_MENU_VIEWPORT_MARGIN,
      window.innerWidth - menuWidth - SORT_MENU_VIEWPORT_MARGIN,
    );

    return {
      top: Math.max(SORT_MENU_VIEWPORT_MARGIN, triggerRect.bottom + SORT_MENU_GAP),
      left: clamp(
        triggerRect.right - menuWidth,
        SORT_MENU_VIEWPORT_MARGIN,
        maxLeft,
      ),
    };
  }, [sortMenuRef]);

  const updateSortMenuPosition = useCallback(() => {
    const nextPosition = calculateSortMenuPosition();
    if (!nextPosition) {
      return;
    }
    setSortMenuPosition((current) =>
      current?.top === nextPosition.top && current.left === nextPosition.left
        ? current
        : nextPosition,
    );
  }, [calculateSortMenuPosition]);

  const handleSortMenuToggle = useCallback(() => {
    if (sortMenuOpen) {
      closeSortMenu();
      return;
    }
    updateSortMenuPosition();
    openSortMenu();
  }, [closeSortMenu, openSortMenu, sortMenuOpen, updateSortMenuPosition]);

  useEffect(() => {
    if (!sortMenuOpen) {
      setSortMenuPosition(null);
      return;
    }
    updateSortMenuPosition();
    const onWindowChange = () => updateSortMenuPosition();
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange, true);
    return () => {
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange, true);
    };
  }, [sortMenuOpen, updateSortMenuPosition]);

  useEffect(() => {
    const popover = sortMenuPopoverRef.current;
    if (
      !sortMenuOpen ||
      !sortMenuPosition ||
      !popover ||
      typeof window === "undefined"
    ) {
      return;
    }

    const popoverRect = popover.getBoundingClientRect();
    const maxLeft = Math.max(
      SORT_MENU_VIEWPORT_MARGIN,
      window.innerWidth - popoverRect.width - SORT_MENU_VIEWPORT_MARGIN,
    );
    const maxTop = Math.max(
      SORT_MENU_VIEWPORT_MARGIN,
      window.innerHeight - popoverRect.height - SORT_MENU_VIEWPORT_MARGIN,
    );
    const nextLeft = clamp(
      sortMenuPosition.left,
      SORT_MENU_VIEWPORT_MARGIN,
      maxLeft,
    );
    const nextTop = clamp(
      sortMenuPosition.top,
      SORT_MENU_VIEWPORT_MARGIN,
      maxTop,
    );

    if (nextTop !== sortMenuPosition.top || nextLeft !== sortMenuPosition.left) {
      setSortMenuPosition({ top: nextTop, left: nextLeft });
    }
  }, [sortMenuOpen, sortMenuPosition]);

  const handleSelectSort = (sortKey: ThreadListSortKey) => {
    sortMenu.close();
    if (sortKey === threadListSortKey) {
      return;
    }
    onSetThreadListSortKey(sortKey);
  };

  const handleSelectOrganize = (organizeMode: ThreadListOrganizeMode) => {
    sortMenu.close();
    if (organizeMode === threadListOrganizeMode) {
      return;
    }
    onSetThreadListOrganizeMode(organizeMode);
  };

  return (
    <div className="sidebar-header">
      <div className="sidebar-header-title">
        <div className="sidebar-title-group">
          <button
            className="sidebar-title-add ds-tooltip-trigger"
            onClick={onAddWorkspace}
            data-tauri-drag-region="false"
            aria-label={t("sidebar.header.addWorkspaces")}
            data-tooltip={t("sidebar.header.addWorkspaces")}
            data-tooltip-align="start"
            data-tooltip-placement="bottom"
            type="button"
          >
            <FolderPlus aria-hidden />
          </button>
          <button
            className="subtitle subtitle-button sidebar-title-button"
            onClick={onSelectHome}
            data-tauri-drag-region="false"
            aria-label={t("sidebar.header.openHome")}
          >
            {t("sidebar.header.projects")}
          </button>
        </div>
      </div>
      <div className="sidebar-header-actions">
        <div className="sidebar-sort-menu" ref={sortMenuRef}>
          <MenuTrigger
            isOpen={sortMenuOpen}
            activeClassName="is-active"
            className="ghost sidebar-sort-toggle ds-tooltip-trigger"
            onClick={handleSortMenuToggle}
            data-tauri-drag-region="false"
            aria-label={t("sidebar.header.organizeSort")}
            title={t("sidebar.header.organizeSort")}
            data-tooltip={t("sidebar.header.organizeSort")}
            data-tooltip-align="end"
            data-tooltip-placement="bottom"
          >
            <ListFilter aria-hidden />
          </MenuTrigger>
          {sortMenuOpen && sortMenuPosition
            ? createPortal(
                <PopoverSurface
                  className="sidebar-sort-dropdown"
                  role="menu"
                  ref={sortMenuPopoverRef}
                  style={sortMenuPosition}
                  onMouseDownCapture={(event) => event.stopPropagation()}
                >
                  <div className="sidebar-sort-section-label">
                    {t("sidebar.header.organize")}
                  </div>
                  <PopoverMenuItem
                    className="sidebar-sort-option"
                    role="menuitemradio"
                    aria-checked={threadListOrganizeMode === "by_project"}
                    onClick={() => handleSelectOrganize("by_project")}
                    data-tauri-drag-region="false"
                    icon={<FolderTree aria-hidden />}
                    active={threadListOrganizeMode === "by_project"}
                  >
                    {t("sidebar.header.byProject")}
                  </PopoverMenuItem>
                  <PopoverMenuItem
                    className="sidebar-sort-option"
                    role="menuitemradio"
                    aria-checked={threadListOrganizeMode === "by_project_activity"}
                    onClick={() => handleSelectOrganize("by_project_activity")}
                    data-tauri-drag-region="false"
                    icon={<BetweenHorizontalStart aria-hidden />}
                    active={threadListOrganizeMode === "by_project_activity"}
                  >
                    {t("sidebar.header.byProjectActivity")}
                  </PopoverMenuItem>
                  <PopoverMenuItem
                    className="sidebar-sort-option"
                    role="menuitemradio"
                    aria-checked={threadListOrganizeMode === "threads_only"}
                    onClick={() => handleSelectOrganize("threads_only")}
                    data-tauri-drag-region="false"
                    icon={<ListTree aria-hidden />}
                    active={threadListOrganizeMode === "threads_only"}
                  >
                    {t("sidebar.header.threadList")}
                  </PopoverMenuItem>
                  <div className="sidebar-sort-divider" aria-hidden />
                  <div className="sidebar-sort-section-label">
                    {t("sidebar.header.sortBy")}
                  </div>
                  <PopoverMenuItem
                    className="sidebar-sort-option"
                    role="menuitemradio"
                    aria-checked={threadListSortKey === "updated_at"}
                    onClick={() => handleSelectSort("updated_at")}
                    data-tauri-drag-region="false"
                    icon={<ArrowDownUp aria-hidden />}
                    active={threadListSortKey === "updated_at"}
                  >
                    {t("sidebar.header.updated")}
                  </PopoverMenuItem>
                  <PopoverMenuItem
                    className="sidebar-sort-option"
                    role="menuitemradio"
                    aria-checked={threadListSortKey === "created_at"}
                    onClick={() => handleSelectSort("created_at")}
                    data-tauri-drag-region="false"
                    icon={<Calendar aria-hidden />}
                    active={threadListSortKey === "created_at"}
                  >
                    {t("sidebar.header.created")}
                  </PopoverMenuItem>
                </PopoverSurface>,
                document.body,
              )
            : null}
        </div>
        <button
          className="ghost sidebar-capabilities-toggle ds-tooltip-trigger"
          onClick={onOpenCapabilities}
          data-tauri-drag-region="false"
          aria-label={t("sidebar.header.capabilities")}
          type="button"
          title={t("sidebar.header.capabilities")}
          data-tooltip={t("sidebar.header.capabilities")}
          data-tooltip-align="end"
          data-tooltip-placement="bottom"
        >
          <Sparkles aria-hidden />
        </button>
        <button
          className="ghost sidebar-refresh-toggle ds-tooltip-trigger"
          onClick={onRefreshAllThreads}
          data-tauri-drag-region="false"
          aria-label={t("sidebar.header.refreshAll")}
          type="button"
          title={t("sidebar.header.refreshAll")}
          data-tooltip={t("sidebar.header.refreshAll")}
          data-tooltip-align="end"
          data-tooltip-placement="bottom"
          disabled={refreshDisabled}
          aria-busy={refreshInProgress}
        >
          <RefreshCw
            className={refreshInProgress ? "sidebar-refresh-icon spinning" : "sidebar-refresh-icon"}
            aria-hidden
          />
        </button>
        <button
          className={`ghost sidebar-search-toggle ds-tooltip-trigger${isSearchOpen ? " is-active" : ""}`}
          onClick={onToggleSearch}
          data-tauri-drag-region="false"
          aria-label={t("sidebar.header.toggleSearch")}
          data-tooltip={
            isSearchOpen ? t("sidebar.search.close") : t("sidebar.search.search")
          }
          data-tooltip-align="end"
          data-tooltip-placement="bottom"
          aria-pressed={isSearchOpen}
          type="button"
        >
          <Search aria-hidden />
        </button>
      </div>
    </div>
  );
}
