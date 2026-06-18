// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, CodexDoctorResult } from "@/types";
import { useAppSettings } from "./useAppSettings";
import {
  getAppSettings,
  getRuntimeImageModelList,
  runCodexDoctor,
  updateAppSettings,
} from "@services/tauri";
import { UI_SCALE_DEFAULT, UI_SCALE_MAX } from "@utils/uiScale";

vi.mock("@services/tauri", () => ({
  getAppSettings: vi.fn(),
  getRuntimeImageModelList: vi.fn(),
  updateAppSettings: vi.fn(),
  runCodexDoctor: vi.fn(),
}));

const getAppSettingsMock = vi.mocked(getAppSettings);
const getRuntimeImageModelListMock = vi.mocked(getRuntimeImageModelList);
const updateAppSettingsMock = vi.mocked(updateAppSettings);
const runCodexDoctorMock = vi.mocked(runCodexDoctor);

describe("useAppSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads settings and normalizes theme + uiScale", async () => {
    getAppSettingsMock.mockResolvedValue(
      ({
        uiScale: UI_SCALE_MAX + 1,
        theme: "nope" as unknown as AppSettings["theme"],
        interfaceLanguage: "fr-FR",
        backendMode: "remote",
        remoteBackendHost: "example:1234",
        managedRuntime: {
          enabled: true,
          baseUrl: " https://runtime.example/v1 ",
          model: "  ",
          imageModel: " gpt-image-2-pro ",
        },
        enterpriseAi: {
          tenantDomain: " acme ",
          status: "connected",
          accountName: " Team ",
          keyLast4: " 1234 ",
          lastValidatedAtMs: 123,
          lastError: " ",
        },
        personality: "unknown",
        uiFontFamily: "",
        codeFontFamily: "  ",
        codeFontSize: 25,
      } as unknown) as AppSettings,
    );

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.uiScale).toBe(UI_SCALE_MAX);
    expect(result.current.settings.theme).toBe("system");
    expect(result.current.settings.interfaceLanguage).toBe("system");
    expect(result.current.settings.uiFontFamily).toContain("system-ui");
    expect(result.current.settings.codeFontFamily).toContain("ui-monospace");
    expect(result.current.settings.codeFontSize).toBe(16);
    expect(result.current.settings.personality).toBe("friendly");
    expect(result.current.settings.backendMode).toBe("remote");
    expect(result.current.settings.remoteBackendHost).toBe("example:1234");
    expect(result.current.settings.managedRuntime).toEqual({
      enabled: true,
      baseUrl: "https://runtime.example/v1",
      model: null,
      imageModel: "gpt-image-2-pro",
    });
    expect(result.current.settings.enterpriseAi).toEqual({
      tenantDomain: "acme",
      status: "connected",
      accountName: "Team",
      keyLast4: "1234",
      lastValidatedAtMs: 123,
      lastError: null,
    });
  });

  it("keeps defaults when getAppSettings fails", async () => {
    getAppSettingsMock.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.uiScale).toBe(UI_SCALE_DEFAULT);
    expect(result.current.settings.theme).toBe("system");
    expect(result.current.settings.interfaceLanguage).toBe("system");
    expect(result.current.settings.uiFontFamily).toContain("system-ui");
    expect(result.current.settings.codeFontFamily).toContain("ui-monospace");
    expect(result.current.settings.backendMode).toBe("local");
    expect(result.current.settings.interruptShortcut).toBeTruthy();
  });

  it("persists settings via updateAppSettings and updates local state", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const next: AppSettings = {
      ...result.current.settings,
      codexArgs: "--profile dev",
      theme: "nope" as unknown as AppSettings["theme"],
      uiScale: 0.04,
      uiFontFamily: "",
      codeFontFamily: "  ",
      codeFontSize: 2,
      notificationSoundsEnabled: false,
    };
    const saved: AppSettings = {
      ...result.current.settings,
      codexArgs: "--profile dev",
      theme: "dark",
      uiScale: 2.4,
      uiFontFamily: "Avenir, sans-serif",
      codeFontFamily: "JetBrains Mono, monospace",
      codeFontSize: 13,
      notificationSoundsEnabled: false,
    };
    updateAppSettingsMock.mockResolvedValue(saved);

    let returned: AppSettings | undefined;
    await act(async () => {
      returned = await result.current.saveSettings(next);
    });

    expect(updateAppSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: "system",
        uiScale: 0.1,
        uiFontFamily: expect.stringContaining("system-ui"),
        codeFontFamily: expect.stringContaining("ui-monospace"),
        codeFontSize: 9,
        notificationSoundsEnabled: false,
      }),
    );
    expect(returned).toEqual(saved);
    expect(result.current.settings.theme).toBe("dark");
    expect(result.current.settings.uiScale).toBe(2.4);
  });

  it("reconciles the saved image model with the runtime image catalog after loading settings", async () => {
    getAppSettingsMock.mockResolvedValue({
      managedRuntime: {
        enabled: true,
        baseUrl: "https://adg-uat.zhaozhunai.com/v1",
        model: "qihang-ultra-5.5",
        imageModel: "legacy-image-model",
      },
    } as AppSettings);
    getRuntimeImageModelListMock.mockResolvedValue({
      object: "list",
      data: [{ id: "gpt-image-2", object: "model" }],
    });
    updateAppSettingsMock.mockImplementation(async (settings: AppSettings) => settings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() =>
      expect(updateAppSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          managedRuntime: expect.objectContaining({
            imageModel: "gpt-image-2",
          }),
        }),
      ),
    );

    expect(result.current.settings.managedRuntime.imageModel).toBe("gpt-image-2");
  });

  it("keeps the saved image model when it is present in the runtime image catalog", async () => {
    getAppSettingsMock.mockResolvedValue({
      managedRuntime: {
        enabled: true,
        baseUrl: "https://adg-uat.zhaozhunai.com/v1",
        model: "qihang-ultra-5.5",
        imageModel: "gpt-image-2",
      },
    } as AppSettings);
    getRuntimeImageModelListMock.mockResolvedValue({
      object: "list",
      data: [{ id: "gpt-image-2", object: "model" }],
    });

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(getRuntimeImageModelListMock).toHaveBeenCalled());

    expect(updateAppSettingsMock).not.toHaveBeenCalled();
    expect(result.current.settings.managedRuntime.imageModel).toBe("gpt-image-2");
  });

  it("optimistically updates settings while save is pending", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let resolveSave: ((settings: AppSettings) => void) | undefined;
    const pendingSave = new Promise<AppSettings>((resolve) => {
      resolveSave = resolve;
    });
    updateAppSettingsMock.mockReturnValue(pendingSave);
    const next: AppSettings = {
      ...result.current.settings,
      theme: "dark",
    };

    let savePromise: Promise<AppSettings>;
    await act(async () => {
      savePromise = result.current.saveSettings(next);
    });

    expect(result.current.settings.theme).toBe("dark");

    const saved: AppSettings = {
      ...next,
      theme: "dim",
    };
    await act(async () => {
      resolveSave?.(saved);
      await savePromise;
    });

    expect(result.current.settings.theme).toBe("dim");
  });

  it("rolls back optimistic settings when save fails", async () => {
    getAppSettingsMock.mockResolvedValue({ theme: "light" } as AppSettings);
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings.theme).toBe("light");

    updateAppSettingsMock.mockRejectedValue(new Error("save failed"));

    await expect(
      act(async () => {
        await result.current.saveSettings({
          ...result.current.settings,
          theme: "dark",
        });
      }),
    ).rejects.toThrow("save failed");

    expect(result.current.settings.theme).toBe("light");
  });

  it("does not let an older save overwrite a newer local setting", async () => {
    getAppSettingsMock.mockResolvedValue({ theme: "system" } as AppSettings);
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let resolveFirst: ((settings: AppSettings) => void) | undefined;
    let resolveSecond: ((settings: AppSettings) => void) | undefined;
    updateAppSettingsMock
      .mockReturnValueOnce(new Promise<AppSettings>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockReturnValueOnce(new Promise<AppSettings>((resolve) => {
        resolveSecond = resolve;
      }));

    let firstSave: Promise<AppSettings>;
    await act(async () => {
      firstSave = result.current.saveSettings({
        ...result.current.settings,
        theme: "light",
      });
    });
    expect(result.current.settings.theme).toBe("light");

    let secondSave: Promise<AppSettings>;
    await act(async () => {
      secondSave = result.current.saveSettings({
        ...result.current.settings,
        theme: "dark",
      });
    });
    expect(result.current.settings.theme).toBe("dark");

    await act(async () => {
      resolveFirst?.({
        ...result.current.settings,
        theme: "light",
      });
      await firstSave;
    });
    expect(result.current.settings.theme).toBe("dark");

    await act(async () => {
      resolveSecond?.({
        ...result.current.settings,
        theme: "dark",
      });
      await secondSave;
    });
    expect(result.current.settings.theme).toBe("dark");
  });

  it("surfaces doctor errors", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    runCodexDoctorMock.mockRejectedValue(new Error("doctor fail"));
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(result.current.doctor("--profile test")).rejects.toThrow(
      "doctor fail",
    );
    expect(runCodexDoctorMock).toHaveBeenCalledWith("--profile test");
  });

  it("returns doctor results", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    const response: CodexDoctorResult = {
      ok: true,
      version: "1.0.0",
      appServerOk: true,
      details: null,
      path: null,
      nodeOk: true,
      nodeVersion: "20.0.0",
      nodeDetails: null,
    };
    runCodexDoctorMock.mockResolvedValue(response);
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(result.current.doctor(null)).resolves.toEqual(response);
    expect(runCodexDoctorMock).toHaveBeenCalledWith(null);
  });
});
