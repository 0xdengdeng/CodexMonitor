// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorToasts } from "./ErrorToasts";

afterEach(cleanup);

vi.mock("@services/diagnostics", () => ({
  copyDiagnostics: vi.fn().mockResolvedValue("diagnostics-blob"),
}));
import { copyDiagnostics } from "@services/diagnostics";

const mockedCopyDiagnostics = vi.mocked(copyDiagnostics);

describe("ErrorToasts", () => {
  it("renders assertive live region and dismisses items", () => {
    const onDismiss = vi.fn();
    render(
      <ErrorToasts
        toasts={[
          { id: "toast-1", title: "Error title", message: "Something failed" },
        ]}
        onDismiss={onDismiss}
      />,
    );

    const region = screen.getByRole("region");
    expect(region.getAttribute("aria-live")).toBe("assertive");
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(onDismiss).toHaveBeenCalledWith("toast-1");
  });

  it("copies diagnostics (with the toast context) when the copy button is clicked", async () => {
    mockedCopyDiagnostics.mockClear();
    render(
      <ErrorToasts
        toasts={[{ id: "toast-1", title: "Boom", message: "bad thing" }]}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));

    await waitFor(() => expect(mockedCopyDiagnostics).toHaveBeenCalledTimes(1));
    const passed = mockedCopyDiagnostics.mock.calls[0]?.[0];
    expect(typeof passed).toBe("string");
    expect(passed as string).toContain("Boom");
    expect(passed as string).toContain("bad thing");
    expect(await screen.findByText("Copied ✓")).toBeTruthy();
  });
});
