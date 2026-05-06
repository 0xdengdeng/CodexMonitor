// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageSwitcher } from "./LanguageSwitcher";

describe("LanguageSwitcher", () => {
  it("shows the active language and switches to English", () => {
    const onChangeLanguage = vi.fn();

    render(
      <LanguageSwitcher
        language="zh-CN"
        onChangeLanguage={onChangeLanguage}
      />,
    );

    expect(
      screen.getByRole("button", { name: "切换语言" }).textContent,
    ).toContain("中文");

    fireEvent.click(screen.getByRole("button", { name: "切换语言" }));

    expect(onChangeLanguage).toHaveBeenCalledWith("en-US");
  });

  it("shows the English label and switches to Chinese", () => {
    const onChangeLanguage = vi.fn();

    render(
      <LanguageSwitcher
        language="en-US"
        onChangeLanguage={onChangeLanguage}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Switch language" }).textContent,
    ).toContain("EN");

    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));

    expect(onChangeLanguage).toHaveBeenCalledWith("zh-CN");
  });
});
