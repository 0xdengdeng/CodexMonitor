// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnterpriseAiLoginResult } from "@/types";
import { enterpriseAiLogin } from "@services/tauri";
import { EnterpriseAiLoginModal } from "./EnterpriseAiLoginModal";

vi.mock("@services/tauri", () => ({
  enterpriseAiLogin: vi.fn(),
}));

const enterpriseAiLoginMock = vi.mocked(enterpriseAiLogin);

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  enterpriseAiLoginMock.mockReset();
});

describe("EnterpriseAiLoginModal", () => {
  it("requires a tenant domain before submitting", () => {
    render(<EnterpriseAiLoginModal onCancel={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Sign in and save" }));

    expect(screen.getByText("Enter a tenant domain before signing in.")).toBeTruthy();
    expect(enterpriseAiLoginMock).not.toHaveBeenCalled();
  });

  it("requires an API Key before submitting", () => {
    render(<EnterpriseAiLoginModal onCancel={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Tenant domain"), {
      target: { value: "acme" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in and save" }));

    expect(screen.getByText("Enter an API Key before saving.")).toBeTruthy();
    expect(enterpriseAiLoginMock).not.toHaveBeenCalled();
  });

  it("logs in and reports the login result", async () => {
    const loginResult = {
      settings: {
        enterpriseAi: {
          tenantDomain: "acme",
          status: "connected",
          accountName: "Acme",
          keyLast4: "1234",
          lastValidatedAtMs: 1,
          lastError: null,
        },
      },
      usage: {
        tenantDomain: "acme",
        accountName: "Acme",
        requests7d: 12,
        tokens7d: 3456,
        balance: 78,
      },
    } as EnterpriseAiLoginResult;
    const onSuccess = vi.fn();
    enterpriseAiLoginMock.mockResolvedValue(loginResult);

    render(
      <EnterpriseAiLoginModal
        initialTenantDomain="  acme  "
        onCancel={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "  sk-test  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in and save" }));

    await waitFor(() => {
      expect(enterpriseAiLoginMock).toHaveBeenCalledWith("acme", "sk-test");
      expect(onSuccess).toHaveBeenCalledWith(loginResult);
    });
  });
});
