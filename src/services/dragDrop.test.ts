import { beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeWindowDragDrop } from "./dragDrop";

const isTauriMock = vi.hoisted(() => vi.fn(() => false));
const getCurrentWindowMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("missing tauri metadata");
  }),
);

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: isTauriMock,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: getCurrentWindowMock,
}));

describe("subscribeWindowDragDrop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(false);
  });

  it("does not touch the Tauri window in a web preview", () => {
    const unsubscribe = subscribeWindowDragDrop(vi.fn());

    expect(getCurrentWindowMock).not.toHaveBeenCalled();

    unsubscribe();
  });
});
