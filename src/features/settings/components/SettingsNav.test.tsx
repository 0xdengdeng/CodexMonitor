// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsNav } from "./SettingsNav";

describe("SettingsNav", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows version control as a top-level settings section", () => {
    render(
      <SettingsNav
        activeSection="version"
        onSelectSection={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Version Control" })).toBeTruthy();
  });
});
