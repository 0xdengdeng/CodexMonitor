import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import X from "lucide-react/dist/esm/icons/x";
import type {
  AppSettings,
  TailscaleDaemonCommandPreview,
  TailscaleStatus,
  TcpDaemonStatus,
} from "@/types";
import { ModalShell } from "@/features/design-system/components/modal/ModalShell";
import {
  SettingsSection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import { SelectMenu } from "@/features/design-system/components/select/SelectMenu";
import { useI18n } from "@/features/i18n/i18n";
import { checkBrowserReadiness, requestScreenRecordingPermission } from "@/services/tauri";
import { openUrl } from "@tauri-apps/plugin-opener";

const CHROME_DOWNLOAD_URL = "https://www.google.com/chrome/";

type AddRemoteBackendDraft = {
  name: string;
  host: string;
  token: string;
};

type SettingsServerSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  isMobilePlatform: boolean;
  mobileConnectBusy: boolean;
  mobileConnectStatusText: string | null;
  mobileConnectStatusError: boolean;
  remoteBackends: AppSettings["remoteBackends"];
  activeRemoteBackendId: string | null;
  remoteStatusText: string | null;
  remoteStatusError: boolean;
  remoteNameError: string | null;
  remoteHostError: string | null;
  remoteNameDraft: string;
  remoteHostDraft: string;
  remoteTokenDraft: string;
  nextRemoteNameSuggestion: string;
  tailscaleStatus: TailscaleStatus | null;
  tailscaleStatusBusy: boolean;
  tailscaleStatusError: string | null;
  tailscaleCommandPreview: TailscaleDaemonCommandPreview | null;
  tailscaleCommandBusy: boolean;
  tailscaleCommandError: string | null;
  tcpDaemonStatus: TcpDaemonStatus | null;
  tcpDaemonBusyAction: "start" | "stop" | "status" | null;
  onSetRemoteNameDraft: Dispatch<SetStateAction<string>>;
  onSetRemoteHostDraft: Dispatch<SetStateAction<string>>;
  onSetRemoteTokenDraft: Dispatch<SetStateAction<string>>;
  onCommitRemoteName: () => Promise<void>;
  onCommitRemoteHost: () => Promise<void>;
  onCommitRemoteToken: () => Promise<void>;
  onSelectRemoteBackend: (id: string) => Promise<void>;
  onAddRemoteBackend: (draft: AddRemoteBackendDraft) => Promise<void>;
  onMoveRemoteBackend: (id: string, direction: "up" | "down") => Promise<void>;
  onDeleteRemoteBackend: (id: string) => Promise<void>;
  onRefreshTailscaleStatus: () => void;
  onRefreshTailscaleCommandPreview: () => void;
  onUseSuggestedTailscaleHost: () => Promise<void>;
  onTcpDaemonStart: () => Promise<void>;
  onTcpDaemonStop: () => Promise<void>;
  onTcpDaemonStatus: () => Promise<void>;
  onMobileConnectTest: () => void;
};

export function SettingsServerSection({
  appSettings,
  onUpdateAppSettings,
  isMobilePlatform,
  mobileConnectBusy,
  mobileConnectStatusText,
  mobileConnectStatusError,
  remoteBackends,
  activeRemoteBackendId,
  remoteStatusText,
  remoteStatusError,
  remoteNameError,
  remoteHostError,
  remoteNameDraft,
  remoteHostDraft,
  remoteTokenDraft,
  nextRemoteNameSuggestion,
  tailscaleStatus,
  tailscaleStatusBusy,
  tailscaleStatusError,
  tailscaleCommandPreview,
  tailscaleCommandBusy,
  tailscaleCommandError,
  tcpDaemonStatus,
  tcpDaemonBusyAction,
  onSetRemoteNameDraft,
  onSetRemoteHostDraft,
  onSetRemoteTokenDraft,
  onCommitRemoteName,
  onCommitRemoteHost,
  onCommitRemoteToken,
  onSelectRemoteBackend,
  onAddRemoteBackend,
  onMoveRemoteBackend,
  onDeleteRemoteBackend,
  onRefreshTailscaleStatus,
  onRefreshTailscaleCommandPreview,
  onUseSuggestedTailscaleHost,
  onTcpDaemonStart,
  onTcpDaemonStop,
  onTcpDaemonStatus,
  onMobileConnectTest,
}: SettingsServerSectionProps) {
  const { t } = useI18n();
  const [pendingDeleteRemoteId, setPendingDeleteRemoteId] = useState<string | null>(
    null,
  );
  const [addRemoteOpen, setAddRemoteOpen] = useState(false);
  const [addRemoteBusy, setAddRemoteBusy] = useState(false);
  const [addRemoteError, setAddRemoteError] = useState<string | null>(null);
  const [addRemoteNameDraft, setAddRemoteNameDraft] = useState("");
  const [addRemoteHostDraft, setAddRemoteHostDraft] = useState("");
  const [addRemoteTokenDraft, setAddRemoteTokenDraft] = useState("");
  // Browser toggle gates on browser availability (docs/browser-no-chrome-design.md §6): enabling
  // checks for an installed Chromium-family browser first; if none, we show an install prompt and
  // do NOT enable. Disabling never needs a check.
  const [browserChecking, setBrowserChecking] = useState(false);
  const [browserNeedsInstall, setBrowserNeedsInstall] = useState(false);
  const [browserError, setBrowserError] = useState<string | null>(null);

  const setBrowserEnabled = (enabled: boolean) =>
    onUpdateAppSettings({
      ...appSettings,
      managedBrowser: { ...appSettings.managedBrowser, enabled },
    });

  const tryEnableBrowser = async (): Promise<void> => {
    setBrowserChecking(true);
    setBrowserError(null);
    try {
      const readiness = await checkBrowserReadiness();
      if (readiness.status === "system") {
        setBrowserNeedsInstall(false);
        await setBrowserEnabled(true);
      } else {
        setBrowserNeedsInstall(true); // no browser — guide to install, leave the toggle off
      }
    } catch (error) {
      // Fail-fast: surface the failure instead of a silent unhandled rejection (design §6.1/§7).
      setBrowserError(error instanceof Error ? error.message : String(error));
    } finally {
      setBrowserChecking(false);
    }
  };

  const onToggleBrowser = () => {
    if (appSettings.managedBrowser.enabled) {
      setBrowserNeedsInstall(false);
      setBrowserError(null);
      void setBrowserEnabled(false);
    } else {
      void tryEnableBrowser();
    }
  };

  // Computer-use toggle: enabling is gated on an explicit consent step (screen is captured + sent to
  // the model) and, on macOS, the Screen-Recording permission prompt (docs/computer-use-design.md §6).
  const [computerConsentOpen, setComputerConsentOpen] = useState(false);
  const [computerBusy, setComputerBusy] = useState(false);
  const [computerError, setComputerError] = useState<string | null>(null);
  const [computerPermissionAsked, setComputerPermissionAsked] = useState(false);

  const setComputerEnabled = (enabled: boolean) =>
    onUpdateAppSettings({
      ...appSettings,
      managedComputer: { ...appSettings.managedComputer, enabled },
    });

  const onToggleComputer = () => {
    setComputerError(null);
    if (appSettings.managedComputer.enabled) {
      void setComputerEnabled(false);
    } else {
      setComputerConsentOpen(true); // consent before enabling
    }
  };

  const confirmEnableComputer = async (): Promise<void> => {
    setComputerBusy(true);
    setComputerError(null);
    try {
      // Trigger the macOS Screen-Recording prompt up front so the first capture doesn't time out.
      await requestScreenRecordingPermission();
      setComputerPermissionAsked(true);
      await setComputerEnabled(true);
      setComputerConsentOpen(false);
    } catch (error) {
      setComputerError(error instanceof Error ? error.message : String(error));
    } finally {
      setComputerBusy(false);
    }
  };
  const isMobileSimplified = isMobilePlatform;
  const pendingDeleteRemote = useMemo(
    () =>
      pendingDeleteRemoteId == null
        ? null
        : remoteBackends.find((entry) => entry.id === pendingDeleteRemoteId) ?? null,
    [pendingDeleteRemoteId, remoteBackends],
  );
  const tcpRunnerStatusText = (() => {
    if (!tcpDaemonStatus) {
      return null;
    }
    if (tcpDaemonStatus.state === "running") {
      return tcpDaemonStatus.pid
        ? t("settings.server.daemonRunningPid", {
            pid: tcpDaemonStatus.pid,
            addr:
              tcpDaemonStatus.listenAddr ??
              t("settings.server.configuredListenAddress"),
          })
        : t("settings.server.daemonRunning", {
            addr:
              tcpDaemonStatus.listenAddr ??
              t("settings.server.configuredListenAddress"),
          });
    }
    if (tcpDaemonStatus.state === "error") {
      return tcpDaemonStatus.lastError ?? t("settings.server.daemonError");
    }
    return t("settings.server.daemonStopped", {
      addr: tcpDaemonStatus.listenAddr ? ` (${tcpDaemonStatus.listenAddr})` : "",
    });
  })();

  const openAddRemoteModal = () => {
    setAddRemoteError(null);
    setAddRemoteNameDraft(nextRemoteNameSuggestion);
    setAddRemoteHostDraft(remoteHostDraft);
    setAddRemoteTokenDraft("");
    setAddRemoteOpen(true);
  };

  const closeAddRemoteModal = () => {
    if (addRemoteBusy) {
      return;
    }
    setAddRemoteOpen(false);
    setAddRemoteError(null);
  };

  const handleAddRemoteConfirm = () => {
    void (async () => {
      if (addRemoteBusy) {
        return;
      }
      setAddRemoteBusy(true);
      setAddRemoteError(null);
      try {
        await onAddRemoteBackend({
          name: addRemoteNameDraft,
          host: addRemoteHostDraft,
          token: addRemoteTokenDraft,
        });
        setAddRemoteOpen(false);
      } catch (error) {
        setAddRemoteError(error instanceof Error ? error.message : t("settings.server.unableAddRemote"));
      } finally {
        setAddRemoteBusy(false);
      }
    })();
  };

  return (
    <SettingsSection
      title={t("settings.server.title")}
      subtitle={
        isMobileSimplified
          ? t("settings.server.mobileSubtitle")
          : t("settings.server.desktopSubtitle")
      }
    >

      {!isMobileSimplified && (
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="backend-mode">
            {t("settings.server.backendMode")}
          </label>
          <SelectMenu
            id="backend-mode"
            className="settings-select"
            value={appSettings.backendMode}
            onValueChange={(nextValue) =>
              void onUpdateAppSettings({
                ...appSettings,
                backendMode: nextValue as AppSettings["backendMode"],
              })
            }
            options={[
              { value: "local", label: t("settings.server.localDefault") },
              { value: "remote", label: t("settings.server.remoteDaemon") },
            ]}
          />
          <div className="settings-help">
            {t("settings.server.backendModeHelp")}
          </div>
        </div>
      )}

      <SettingsToggleRow
        title={t("settings.features.browser.title")}
        subtitle={
          appSettings.backendMode === "remote"
            ? t("settings.features.browser.remoteUnsupported")
            : t("settings.features.browser.subtitle")
        }
      >
        <SettingsToggleSwitch
          pressed={appSettings.managedBrowser.enabled}
          disabled={appSettings.backendMode === "remote" || browserChecking}
          onClick={onToggleBrowser}
        />
      </SettingsToggleRow>
      {browserNeedsInstall && appSettings.backendMode !== "remote" ? (
        <div className="settings-help" role="status">
          {t("settings.features.browser.noBrowser")}
          <div className="settings-field-actions" style={{ marginTop: 6 }}>
            <button
              type="button"
              className="ghost"
              onClick={() => void openUrl(CHROME_DOWNLOAD_URL)}
            >
              {t("settings.features.browser.installChrome")}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={browserChecking}
              onClick={() => void tryEnableBrowser()}
            >
              {t("settings.features.browser.recheck")}
            </button>
          </div>
        </div>
      ) : null}
      {browserError ? (
        <div className="settings-help" role="alert">
          {t("settings.features.browser.checkFailed", { error: browserError })}
        </div>
      ) : null}

      <SettingsToggleRow
        title={t("settings.features.computer.title")}
        subtitle={
          appSettings.backendMode === "remote"
            ? t("settings.features.computer.remoteUnsupported")
            : t("settings.features.computer.subtitle")
        }
      >
        <SettingsToggleSwitch
          pressed={appSettings.managedComputer.enabled}
          disabled={appSettings.backendMode === "remote" || computerBusy}
          onClick={onToggleComputer}
        />
      </SettingsToggleRow>
      {computerConsentOpen && appSettings.backendMode !== "remote" ? (
        <div className="settings-help" role="status">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {t("settings.features.computer.consentTitle")}
          </div>
          {t("settings.features.computer.consentBody")}
          <div className="settings-field-actions" style={{ marginTop: 6 }}>
            <button
              type="button"
              className="primary"
              disabled={computerBusy}
              onClick={() => void confirmEnableComputer()}
            >
              {t("settings.features.computer.consentEnable")}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={computerBusy}
              onClick={() => {
                setComputerConsentOpen(false);
                setComputerError(null);
              }}
            >
              {t("settings.features.computer.consentCancel")}
            </button>
          </div>
        </div>
      ) : null}
      {computerPermissionAsked && appSettings.managedComputer.enabled ? (
        <div className="settings-help" role="status">
          {t("settings.features.computer.permissionHint")}
        </div>
      ) : null}
      {computerError ? (
        <div className="settings-help" role="alert">
          {t("settings.features.computer.enableFailed", { error: computerError })}
        </div>
      ) : null}

      <>
        {isMobileSimplified && (
          <>
            <div className="settings-field">
              <div className="settings-field-label">{t("settings.server.savedRemotes")}</div>
              <div className="settings-mobile-remotes" role="list" aria-label={t("settings.server.savedRemotes")}>
                {remoteBackends.map((entry, index) => {
                  const isActive = entry.id === activeRemoteBackendId;
                  return (
                    <div
                      className={`settings-mobile-remote${isActive ? " is-active" : ""}`}
                      role="listitem"
                      key={entry.id}
                    >
                      <div className="settings-mobile-remote-main">
                        <div className="settings-mobile-remote-name-row">
                          <div className="settings-mobile-remote-name">{entry.name}</div>
                          {isActive && (
                            <span className="settings-mobile-remote-badge">
                              {t("settings.server.active")}
                            </span>
                          )}
                        </div>
                        <div className="settings-mobile-remote-meta">TCP · {entry.host}</div>
                        <div className="settings-mobile-remote-last">
                          {t("settings.server.lastConnected", {
                            value:
                              typeof entry.lastConnectedAtMs === "number"
                                ? new Date(entry.lastConnectedAtMs).toLocaleString()
                                : t("settings.server.never"),
                          })}
                        </div>
                      </div>
                      <div className="settings-mobile-remote-actions">
                        <button
                          type="button"
                          className="ghost settings-mobile-remote-action"
                          onClick={() => {
                            void onSelectRemoteBackend(entry.id);
                          }}
                          disabled={isActive}
                          aria-label={t("settings.server.useRemote", { name: entry.name })}
                        >
                          {isActive ? t("settings.server.using") : t("settings.server.use")}
                        </button>
                        <button
                          type="button"
                          className="ghost settings-mobile-remote-action"
                          onClick={() => {
                            void onMoveRemoteBackend(entry.id, "up");
                          }}
                          disabled={index === 0}
                          aria-label={t("settings.server.moveUp", { name: entry.name })}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="ghost settings-mobile-remote-action"
                          onClick={() => {
                            void onMoveRemoteBackend(entry.id, "down");
                          }}
                          disabled={index === remoteBackends.length - 1}
                          aria-label={t("settings.server.moveDown", { name: entry.name })}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="ghost settings-mobile-remote-action settings-mobile-remote-action-danger"
                          onClick={() => {
                            setPendingDeleteRemoteId(entry.id);
                          }}
                          aria-label={t("settings.server.deleteNamed", { name: entry.name })}
                        >
                          {t("settings.server.delete")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="settings-field-row">
                <button
                  type="button"
                  className="button settings-button-compact"
                  onClick={openAddRemoteModal}
                >
                  {t("settings.server.addRemote")}
                </button>
              </div>
              {remoteStatusText && (
                <div className={`settings-help${remoteStatusError ? " settings-help-error" : ""}`}>
                  {remoteStatusText}
                </div>
              )}
              <div className="settings-help">
                {t("settings.server.switchHelp")}
              </div>
            </div>

            <div className="settings-field">
              <label className="settings-field-label" htmlFor="mobile-remote-name">
                {t("settings.server.remoteName")}
              </label>
              <input
                id="mobile-remote-name"
                className="settings-input settings-input--compact"
                value={remoteNameDraft}
                placeholder={t("settings.server.remoteNamePlaceholder")}
                onChange={(event) => onSetRemoteNameDraft(event.target.value)}
                onBlur={() => {
                  void onCommitRemoteName();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void onCommitRemoteName();
                  }
                }}
              />
              {remoteNameError && <div className="settings-help settings-help-error">{remoteNameError}</div>}
            </div>
          </>
        )}

        {!isMobileSimplified && (
          <SettingsToggleRow
            title={t("settings.server.keepDaemon")}
            subtitle={t("settings.server.keepDaemonHelp")}
          >
            <SettingsToggleSwitch
              pressed={appSettings.keepDaemonRunningAfterAppClose}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  keepDaemonRunningAfterAppClose: !appSettings.keepDaemonRunningAfterAppClose,
                })
              }
            />
          </SettingsToggleRow>
        )}

        <div className="settings-field">
          <div className="settings-field-label">{t("settings.server.remoteBackend")}</div>
          <div className="settings-field-row">
            <input
              className="settings-input settings-input--compact"
              value={remoteHostDraft}
              placeholder="127.0.0.1:4732"
              onChange={(event) => onSetRemoteHostDraft(event.target.value)}
              onBlur={() => {
                void onCommitRemoteHost();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void onCommitRemoteHost();
                }
              }}
              aria-label={t("settings.server.remoteBackendHost")}
            />
            <input
              type="password"
              className="settings-input settings-input--compact"
              value={remoteTokenDraft}
              placeholder={t("settings.server.tokenRequired")}
              onChange={(event) => onSetRemoteTokenDraft(event.target.value)}
              onBlur={() => {
                void onCommitRemoteToken();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void onCommitRemoteToken();
                }
              }}
              aria-label={t("settings.server.remoteBackendToken")}
            />
          </div>
          {remoteHostError && <div className="settings-help settings-help-error">{remoteHostError}</div>}
          <div className="settings-help">
            {isMobileSimplified
              ? t("settings.server.mobileRemoteHelp")
              : t("settings.server.desktopRemoteHelp")}
          </div>
        </div>

        {isMobileSimplified && (
          <div className="settings-field">
            <div className="settings-field-label">{t("settings.server.connectionTest")}</div>
            <div className="settings-field-row">
              <button
                type="button"
                className="button settings-button-compact"
                onClick={onMobileConnectTest}
                disabled={mobileConnectBusy}
              >
                {mobileConnectBusy
                  ? t("settings.server.connecting")
                  : t("settings.server.connectTest")}
              </button>
            </div>
            {mobileConnectStatusText && (
              <div className={`settings-help${mobileConnectStatusError ? " settings-help-error" : ""}`}>
                {mobileConnectStatusText}
              </div>
            )}
            <div className="settings-help">
              {t("settings.server.connectHelp")}
            </div>
          </div>
        )}

        {!isMobileSimplified && (
          <div className="settings-field">
            <div className="settings-field-label">{t("settings.server.mobileDaemon")}</div>
            <div className="settings-field-row">
              <button
                type="button"
                className="button settings-button-compact"
                onClick={() => {
                  void onTcpDaemonStart();
                }}
                disabled={tcpDaemonBusyAction !== null}
              >
                {tcpDaemonBusyAction === "start"
                  ? t("settings.server.starting")
                  : t("settings.server.startDaemon")}
              </button>
              <button
                type="button"
                className="button settings-button-compact"
                onClick={() => {
                  void onTcpDaemonStop();
                }}
                disabled={tcpDaemonBusyAction !== null}
              >
                {tcpDaemonBusyAction === "stop"
                  ? t("settings.server.stopping")
                  : t("settings.server.stopDaemon")}
              </button>
              <button
                type="button"
                className="button settings-button-compact"
                onClick={() => {
                  void onTcpDaemonStatus();
                }}
                disabled={tcpDaemonBusyAction !== null}
              >
                {tcpDaemonBusyAction === "status"
                  ? t("settings.server.refreshing")
                  : t("settings.server.refreshStatus")}
              </button>
            </div>
            {tcpRunnerStatusText && <div className="settings-help">{tcpRunnerStatusText}</div>}
            {tcpDaemonStatus?.startedAtMs && (
              <div className="settings-help">
                {t("settings.server.startedAt", {
                  value: new Date(tcpDaemonStatus.startedAtMs).toLocaleString(),
                })}
              </div>
            )}
            <div className="settings-help">
              {t("settings.server.daemonHelp")}
            </div>
          </div>
        )}

        {!isMobileSimplified && (
          <div className="settings-field">
            <div className="settings-field-label">{t("settings.server.tailscaleHelper")}</div>
            <div className="settings-field-row">
              <button
                type="button"
                className="button settings-button-compact"
                onClick={onRefreshTailscaleStatus}
                disabled={tailscaleStatusBusy}
              >
                {tailscaleStatusBusy
                  ? t("settings.server.checking")
                  : t("settings.server.detectTailscale")}
              </button>
              <button
                type="button"
                className="button settings-button-compact"
                onClick={onRefreshTailscaleCommandPreview}
                disabled={tailscaleCommandBusy}
              >
                {tailscaleCommandBusy
                  ? t("settings.server.refreshing")
                  : t("settings.server.refreshDaemonCommand")}
              </button>
              <button
                type="button"
                className="button settings-button-compact"
                disabled={!tailscaleStatus?.suggestedRemoteHost}
                onClick={() => {
                  void onUseSuggestedTailscaleHost();
                }}
              >
                {t("settings.server.useSuggestedHost")}
              </button>
            </div>
            {tailscaleStatusError && (
              <div className="settings-help settings-help-error">{tailscaleStatusError}</div>
            )}
            {tailscaleStatus && (
              <>
                <div className="settings-help">{tailscaleStatus.message}</div>
                <div className="settings-help">
                  {tailscaleStatus.installed
                    ? t("settings.codex.version", {
                        value: tailscaleStatus.version ?? t("settings.common.unknown"),
                      })
                    : t("settings.server.installTailscale")}
                </div>
                {tailscaleStatus.suggestedRemoteHost && (
                  <div className="settings-help">
                    {t("settings.server.suggestedRemoteHost", {
                      host: tailscaleStatus.suggestedRemoteHost,
                    })}
                  </div>
                )}
                {tailscaleStatus.tailnetName && (
                  <div className="settings-help">
                    {t("settings.server.tailnet", { name: tailscaleStatus.tailnetName })}
                  </div>
                )}
              </>
            )}
            {tailscaleCommandError && (
              <div className="settings-help settings-help-error">{tailscaleCommandError}</div>
            )}
            {tailscaleCommandPreview && (
              <>
                <div className="settings-help">
                  {t("settings.server.commandTemplate")}
                </div>
                <pre className="settings-command-preview">
                  <code>{tailscaleCommandPreview.command}</code>
                </pre>
                {!tailscaleCommandPreview.tokenConfigured && (
                  <div className="settings-help settings-help-error">
                    {t("settings.server.emptyTokenWarning")}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </>

      <div className="settings-help">
        {isMobileSimplified
          ? t("settings.server.mobileScopeHelp")
          : t("settings.server.desktopScopeHelp")}
      </div>
      {addRemoteOpen && (
        <ModalShell
          className="settings-add-remote-overlay"
          cardClassName="settings-add-remote-card"
          onBackdropClick={closeAddRemoteModal}
          ariaLabel={t("settings.server.addRemote")}
        >
          <div className="settings-add-remote-header">
            <div className="settings-add-remote-title">{t("settings.server.addRemote")}</div>
            <button
              type="button"
              className="ghost icon-button settings-add-remote-close"
              onClick={closeAddRemoteModal}
              aria-label={t("settings.server.closeAddRemote")}
              disabled={addRemoteBusy}
            >
              <X aria-hidden />
            </button>
          </div>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-add-remote-name">
              {t("settings.server.newRemoteName")}
            </label>
            <input
              id="settings-add-remote-name"
              className="settings-input settings-input--compact"
              value={addRemoteNameDraft}
              onChange={(event) => setAddRemoteNameDraft(event.target.value)}
              disabled={addRemoteBusy}
            />
          </div>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-add-remote-host">
              {t("settings.server.newRemoteHost")}
            </label>
            <input
              id="settings-add-remote-host"
              className="settings-input settings-input--compact"
              value={addRemoteHostDraft}
              placeholder="macbook.your-tailnet.ts.net:4732"
              onChange={(event) => setAddRemoteHostDraft(event.target.value)}
              disabled={addRemoteBusy}
            />
          </div>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-add-remote-token">
              {t("settings.server.newRemoteToken")}
            </label>
            <input
              id="settings-add-remote-token"
              type="password"
              className="settings-input settings-input--compact"
              value={addRemoteTokenDraft}
              placeholder={t("settings.server.tokenRequired")}
              onChange={(event) => setAddRemoteTokenDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAddRemoteConfirm();
                }
              }}
              disabled={addRemoteBusy}
            />
          </div>
          {addRemoteError && <div className="settings-help settings-help-error">{addRemoteError}</div>}
          <div className="settings-add-remote-actions">
            <button type="button" className="ghost" onClick={closeAddRemoteModal} disabled={addRemoteBusy}>
              {t("settings.common.cancel")}
            </button>
            <button
              type="button"
              className="button"
              onClick={handleAddRemoteConfirm}
              disabled={addRemoteBusy}
            >
              {addRemoteBusy
                ? t("settings.server.connecting")
                : t("settings.server.connectAdd")}
            </button>
          </div>
        </ModalShell>
      )}
      {pendingDeleteRemote && (
        <ModalShell
          className="settings-delete-remote-overlay"
          cardClassName="settings-delete-remote-card"
          onBackdropClick={() => setPendingDeleteRemoteId(null)}
          ariaLabel={t("settings.server.deleteRemoteConfirmation")}
        >
          <div className="settings-delete-remote-title">
            {t("settings.server.deleteRemoteTitle")}
          </div>
          <div className="settings-delete-remote-message">
            {t("settings.server.deleteRemoteMessage", { name: pendingDeleteRemote.name })}
          </div>
          <div className="settings-delete-remote-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => setPendingDeleteRemoteId(null)}
            >
              {t("settings.common.cancel")}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                void onDeleteRemoteBackend(pendingDeleteRemote.id);
                setPendingDeleteRemoteId(null);
              }}
            >
              {t("settings.server.deleteRemote")}
            </button>
          </div>
        </ModalShell>
      )}
    </SettingsSection>
  );
}
