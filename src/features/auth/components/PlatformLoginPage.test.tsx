// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlatformLoginPage } from "./PlatformLoginPage";

describe("PlatformLoginPage", () => {
  it("submits tenant domain and API key", () => {
    const onSubmit = vi.fn();

    render(
      <PlatformLoginPage
        language="zh-CN"
        onChangeLanguage={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("租户域"), {
      target: { value: "acme" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "sk-demo-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "进入工作台" }));

    expect(onSubmit).toHaveBeenCalledWith({
      tenantDomain: "acme",
      apiKey: "sk-demo-key",
    });
  });

  it("shows English copy when language is English", () => {
    render(
      <PlatformLoginPage
        language="en-US"
        onChangeLanguage={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("Enterprise AI Dev Workbench")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enter workspace" })).toBeTruthy();
  });
});
