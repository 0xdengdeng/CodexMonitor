import { describe, expect, it } from "vitest";
import { buildElicitationMessage } from "./elicitationMessage";

// Fake t() that echoes the key (+ values) so each branch is observable.
const fakeT = (key: string, values?: Record<string, unknown>) =>
  values ? `${key}::${JSON.stringify(values)}` : key;

describe("buildElicitationMessage", () => {
  it("composes a localized message from _meta.tool_title for MCP tool-call approvals", () => {
    const message = buildElicitationMessage(
      {
        serverName: "playwright",
        // codex's baked-in English — must NOT be what we render
        message: 'Allow the playwright MCP server to run tool "browser_navigate"?',
        _meta: {
          codex_approval_kind: "mcp_tool_call",
          tool_title: "browser_navigate",
        },
      },
      fakeT,
    );
    expect(message).toBe('elicitation.mcpToolCall::{"tool":"browser_navigate"}');
  });

  it("falls back to a tool-less localized message when tool_title is absent", () => {
    const message = buildElicitationMessage(
      {
        serverName: "playwright",
        message: "Allow the playwright MCP server to run a tool?",
        _meta: { codex_approval_kind: "mcp_tool_call" },
      },
      fakeT,
    );
    expect(message).toBe("elicitation.mcpToolCallGeneric");
  });

  it("renders codex's message verbatim for non-tool-call elicitations", () => {
    const message = buildElicitationMessage(
      { serverName: "weather", message: "Share your location?" },
      fakeT,
    );
    expect(message).toBe("Share your location?");
  });

  it("uses the generic fallback when there is no message and no tool-call meta", () => {
    expect(buildElicitationMessage({ serverName: "weather" }, fakeT)).toBe(
      "elicitation.fallback",
    );
  });

  it("ignores a non-object _meta and renders codex's message", () => {
    const message = buildElicitationMessage(
      { serverName: "x", message: "hi", _meta: "nope" },
      fakeT,
    );
    expect(message).toBe("hi");
  });

  it("does not treat a non tool-call kind as a tool approval", () => {
    const message = buildElicitationMessage(
      {
        serverName: "x",
        message: "Pick a date.",
        _meta: { codex_approval_kind: "something_else", tool_title: "ignored" },
      },
      fakeT,
    );
    expect(message).toBe("Pick a date.");
  });
});
