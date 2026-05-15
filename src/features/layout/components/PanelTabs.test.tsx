// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PanelTabs, type PanelTabId } from "./PanelTabs";

function PanelTabsHarness() {
  const [active, setActive] = useState<PanelTabId>("git");
  return <PanelTabs active={active} onSelect={setActive} />;
}

describe("PanelTabs", () => {
  it("moves selection and focus with arrow keys", async () => {
    render(<PanelTabsHarness />);
    const tabs = screen.getAllByRole("tab");

    expect(screen.getByRole("tab", { name: "Plan" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Version" })).toBeTruthy();

    tabs[1].focus();
    fireEvent.keyDown(tabs[1], { key: "ArrowRight" });

    await waitFor(() => {
      expect(tabs[2].getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(tabs[2]);
    });

    fireEvent.keyDown(tabs[2], { key: "ArrowRight" });

    await waitFor(() => {
      expect(tabs[3].getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(tabs[3]);
    });
  });
});
