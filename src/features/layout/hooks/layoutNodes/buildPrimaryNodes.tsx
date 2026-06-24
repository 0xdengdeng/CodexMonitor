import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import { Sidebar } from "../../../app/components/Sidebar";
import { Home } from "../../../home/components/Home";
import { MainHeader } from "../../../app/components/MainHeader";
import { Messages } from "../../../messages/components/Messages";
import { ApprovalToasts } from "../../../app/components/ApprovalToasts";
import { ElicitationToasts } from "../../../app/components/ElicitationToasts";
import { UpdateToast } from "../../../update/components/UpdateToast";
import { ErrorToasts } from "../../../notifications/components/ErrorToasts";
import { Composer } from "../../../composer/components/Composer";
import { TabBar } from "../../../app/components/TabBar";
import { TabletNav } from "../../../app/components/TabletNav";
import type {
  LayoutNodesResult,
  LayoutPrimarySurface,
} from "./types";
import { useI18n } from "@/features/i18n/i18n";

export type PrimaryLayoutNodesOptions = LayoutPrimarySurface;

type PrimaryLayoutNodes = Pick<
  LayoutNodesResult,
  | "sidebarNode"
  | "messagesNode"
  | "composerNode"
  | "approvalToastsNode"
  | "elicitationToastsNode"
  | "updateToastNode"
  | "errorToastsNode"
  | "homeNode"
  | "mainHeaderNode"
  | "desktopTopbarLeftNode"
  | "tabletNavNode"
  | "tabBarNode"
>;

function BackToChatButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      className="icon-button back-button"
      onClick={onClick}
      aria-label={t("layout.backToChat")}
    >
      <ArrowLeft aria-hidden />
    </button>
  );
}

export function buildPrimaryNodes(options: PrimaryLayoutNodesOptions): PrimaryLayoutNodes {
  const sidebarNode = <Sidebar {...options.sidebarProps} />;

  const messagesNode = <Messages {...options.messagesProps} />;

  const composerNode = options.composerProps ? <Composer {...options.composerProps} /> : null;

  const approvalToastsNode = <ApprovalToasts {...options.approvalToastsProps} />;

  const elicitationToastsNode = <ElicitationToasts {...options.elicitationToastsProps} />;

  const updateToastNode = <UpdateToast {...options.updateToastProps} />;

  const errorToastsNode = <ErrorToasts {...options.errorToastsProps} />;

  const homeNode = <Home {...options.homeProps} />;

  const mainHeaderNode = options.mainHeaderProps ? (
    <MainHeader {...options.mainHeaderProps} />
  ) : null;

  const desktopTopbarLeftNode = (
    <>
      {options.desktopTopbarProps.showBackToChat && (
        <BackToChatButton onClick={options.desktopTopbarProps.onExitDiff} />
      )}
      {mainHeaderNode}
    </>
  );

  const tabletNavNode = (
    <TabletNav {...options.tabletNavProps} />
  );

  const tabBarNode = <TabBar {...options.tabBarProps} />;

  return {
    sidebarNode,
    messagesNode,
    composerNode,
    approvalToastsNode,
    elicitationToastsNode,
    updateToastNode,
    errorToastsNode,
    homeNode,
    mainHeaderNode,
    desktopTopbarLeftNode,
    tabletNavNode,
    tabBarNode,
  };
}
