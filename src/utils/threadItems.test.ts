import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../types";
import {
  buildConversationItem,
  buildConversationItemFromThreadItem,
  buildRawDynamicToolOutputItem,
  buildItemsFromThread,
  getRawFunctionCallId,
  getThreadCreatedTimestamp,
  getThreadTimestamp,
  imageGenerationIdsMatch,
  isRawDisplayResponseItem,
  mergeThreadItems,
  normalizeItem,
  parseRawDynamicToolCall,
  prepareThreadItems,
  unwrapRawResponseItem,
  upsertItem,
} from "./threadItems";

describe("threadItems", () => {
  it("matches generated image call ids across scoped turn anchors", () => {
    expect(imageGenerationIdsMatch("turn-1:call-image-1", "call-image-1")).toBe(
      true,
    );
    expect(imageGenerationIdsMatch("call-image-1", "turn-1:call-image-1")).toBe(
      true,
    );
    expect(imageGenerationIdsMatch("turn-1:call-image-1", "call-image-2")).toBe(
      false,
    );
  });

  it("unwraps response_item envelopes before parsing raw generated image calls", () => {
    const wrappedCall = {
      type: "response_item",
      payload: {
        type: "function_call",
        call_id: "call-wrapped-image",
        name: "generate_image",
        arguments: JSON.stringify({ prompt: "A wrapped live image" }),
      },
    };
    const call = parseRawDynamicToolCall(unwrapRawResponseItem(wrappedCall));

    expect(call).toMatchObject({
      id: "call-wrapped-image",
      tool: "generate_image",
      arguments: { prompt: "A wrapped live image" },
    });

    const wrappedOutput = {
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-wrapped-image",
        output: [
          {
            type: "input_text",
            text: JSON.stringify({
              status: "generated",
              saved_path:
                "/tmp/codex-home/generated_images/thread-1/019_call_wrapped_image.png",
            }),
          },
        ],
      },
    };
    const output = buildRawDynamicToolOutputItem(
      unwrapRawResponseItem(wrappedOutput),
      call ?? undefined,
    );

    expect(output).toMatchObject({
      type: "dynamicToolCall",
      id: "call-wrapped-image",
      tool: "generate_image",
      status: "completed",
    });
  });

  it("truncates long message text in normalizeItem", () => {
    const text = "a".repeat(21000);
    const item: ConversationItem = {
      id: "msg-1",
      kind: "message",
      role: "assistant",
      text,
    };
    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("message");
    if (normalized.kind === "message") {
      expect(normalized.text).not.toBe(text);
      expect(normalized.text.endsWith("...")).toBe(true);
      expect(normalized.text.length).toBeLessThan(text.length);
    }
  });

  it("truncates extremely large tool output for fileChange and commandExecution", () => {
    const output = "x".repeat(250000);
    const item: ConversationItem = {
      id: "tool-1",
      kind: "tool",
      toolType: "fileChange",
      title: "File changes",
      detail: "",
      output,
    };
    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("tool");
    if (normalized.kind === "tool") {
      expect(normalized.output).not.toBe(output);
      expect(normalized.output?.endsWith("...")).toBe(true);
      expect((normalized.output ?? "").length).toBeLessThan(output.length);
    }
  });

  it("truncates older tool output in prepareThreadItems", () => {
    const output = "y".repeat(21000);
    const items: ConversationItem[] = Array.from({ length: 41 }, (_, index) => ({
      id: `tool-${index}`,
      kind: "tool",
      toolType: "commandExecution",
      title: "Tool",
      detail: "",
      output,
    }));
    const prepared = prepareThreadItems(items);
    const firstOutput = prepared[0].kind === "tool" ? prepared[0].output : undefined;
    const secondOutput = prepared[1].kind === "tool" ? prepared[1].output : undefined;
    expect(firstOutput).not.toBe(output);
    expect(firstOutput?.endsWith("...")).toBe(true);
    expect(secondOutput).toBe(output);
  });

  it("respects custom max items per thread in prepareThreadItems", () => {
    const items: ConversationItem[] = Array.from({ length: 5 }, (_, index) => ({
      id: `msg-${index}`,
      kind: "message",
      role: "assistant",
      text: `message ${index}`,
    }));
    const prepared = prepareThreadItems(items, { maxItemsPerThread: 3 });
    expect(prepared).toHaveLength(3);
    expect(prepared[0]?.id).toBe("msg-2");
    expect(prepared[2]?.id).toBe("msg-4");
  });

  it("supports unlimited max items per thread in prepareThreadItems", () => {
    const items: ConversationItem[] = Array.from({ length: 5 }, (_, index) => ({
      id: `msg-${index}`,
      kind: "message",
      role: "assistant",
      text: `message ${index}`,
    }));
    const prepared = prepareThreadItems(items, { maxItemsPerThread: null });
    expect(prepared).toHaveLength(5);
  });

  it("drops assistant review summaries that duplicate completed review items", () => {
    const items: ConversationItem[] = [
      {
        id: "review-1",
        kind: "review",
        state: "completed",
        text: "Review summary",
      },
      {
        id: "msg-1",
        kind: "message",
        role: "assistant",
        text: "Review summary",
      },
    ];
    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("review");
  });

  it("summarizes explored reads and hides raw commands", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/foo.ts",
        detail: "",
        status: "completed",
        output: "",
      },
      {
        id: "cmd-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: sed -n '1,10p' src/bar.ts",
        detail: "",
        status: "completed",
        output: "",
      },
      {
        id: "msg-1",
        kind: "message",
        role: "assistant",
        text: "Done reading",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(2);
      expect(prepared[0].entries[0].kind).toBe("read");
      expect(prepared[0].entries[0].label).toContain("foo.ts");
      expect(prepared[0].entries[1].kind).toBe("read");
      expect(prepared[0].entries[1].label).toContain("bar.ts");
    }
    expect(prepared.filter((item) => item.kind === "tool")).toHaveLength(0);
  });

  it("treats inProgress command status as exploring", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg RouterDestination src",
        detail: "",
        status: "inProgress",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].status).toBe("exploring");
      expect(prepared[0].entries[0]?.kind).toBe("search");
    }
  });

  it("deduplicates explore entries when consecutive summaries merge", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/customPrompts.ts",
        detail: "",
        status: "completed",
        output: "",
      },
      {
        id: "cmd-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/customPrompts.ts",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].label).toContain("customPrompts.ts");
    }
  });

  it("preserves distinct read paths that share the same basename", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/foo/index.ts",
        detail: "",
        status: "completed",
        output: "",
      },
      {
        id: "cmd-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat tests/foo/index.ts",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(2);
      const details = prepared[0].entries.map((entry) => entry.detail ?? entry.label);
      expect(details).toContain("src/foo/index.ts");
      expect(details).toContain("tests/foo/index.ts");
    }
  });

  it("preserves multi-path read commands instead of collapsing to the last path", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/a.ts src/b.ts",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(2);
      const details = prepared[0].entries.map((entry) => entry.detail ?? entry.label);
      expect(details).toContain("src/a.ts");
      expect(details).toContain("src/b.ts");
    }
  });

  it("ignores glob patterns when summarizing rg --files commands", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg --files -g '*.ts' src",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("list");
      expect(prepared[0].entries[0].label).toBe("src");
    }
  });

  it("skips rg glob flag values and keeps the actual search path", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg myQuery -g '*.ts' src",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("search");
      expect(prepared[0].entries[0].label).toBe("myQuery in src");
    }
  });

  it("unwraps unquoted /bin/zsh -lc rg commands", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: 'Command: /bin/zsh -lc rg -n "RouterDestination" src',
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("search");
      expect(prepared[0].entries[0].label).toBe("RouterDestination in src");
    }
  });

  it("treats nl -ba as a read command", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: nl -ba src/foo.ts",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("read");
      expect(prepared[0].entries[0].detail ?? prepared[0].entries[0].label).toBe(
        "src/foo.ts",
      );
    }
  });

  it("summarizes piped nl commands using the left-hand read", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: nl -ba src/foo.ts | sed -n '1,10p'",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("read");
      expect(prepared[0].entries[0].detail ?? prepared[0].entries[0].label).toBe(
        "src/foo.ts",
      );
    }
  });

  it("does not trim pipes that appear inside quoted arguments", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: 'Command: rg "foo | bar" src',
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("search");
      expect(prepared[0].entries[0].label).toBe("foo | bar in src");
    }
  });

  it("keeps raw commands when they are not recognized", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: git status",
        detail: "",
        status: "completed",
        output: "",
      },
    ];
    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("tool");
  });

  it("keeps raw commands when they fail", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/foo.ts",
        detail: "",
        status: "failed",
        output: "No such file",
      },
    ];
    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("tool");
  });

  it("builds file change items with summary details", () => {
    const item = buildConversationItem({
      type: "fileChange",
      id: "change-1",
      status: "done",
      changes: [
        {
          path: "foo.txt",
          kind: "add",
          diff: "diff --git a/foo.txt b/foo.txt",
        },
      ],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.title).toBe("File changes");
      expect(item.detail).toBe("A foo.txt");
      expect(item.output).toContain("diff --git a/foo.txt b/foo.txt");
      expect(item.changes?.[0]?.path).toBe("foo.txt");
    }
  });

  it("exposes shared raw runtime item normalization for live and history paths", () => {
    const call = parseRawDynamicToolCall({
      type: "function_call",
      call_id: "call-shared-1",
      name: "codex_monitor.generate_image",
      arguments: JSON.stringify({
        prompt: "A shared normalization image",
        size: "1024x1024",
      }),
    });

    expect(call).toEqual({
      id: "call-shared-1",
      namespace: null,
      tool: "generate_image",
      arguments: {
        prompt: "A shared normalization image",
        size: "1024x1024",
      },
    });

    const metadata = {
      status: "generated",
      saved_path: "/tmp/codex-home/generated_images/thread-1/019_call_shared_1.png",
      model: "gpt-image-2",
    };
    const output = {
      type: "function_call_output",
      call_id: "call-shared-1",
      output: [{ type: "input_text", text: JSON.stringify(metadata) }],
    };

    expect(getRawFunctionCallId(output)).toBe("call-shared-1");
    expect(buildRawDynamicToolOutputItem(output, call ?? undefined)).toEqual({
      type: "dynamicToolCall",
      id: "call-shared-1",
      namespace: null,
      tool: "generate_image",
      status: "completed",
      arguments: {
        prompt: "A shared normalization image",
        size: "1024x1024",
      },
      contentItems: [{ type: "inputText", text: JSON.stringify(metadata) }],
      success: true,
    });
    expect(
      isRawDisplayResponseItem({
        type: "message",
        id: "msg-shared-1",
        role: "assistant",
        content: [{ type: "output_text", text: "Done." }],
      }),
    ).toBe(true);
  });

  it("uses first non-empty raw call id and tool fields", () => {
    const call = parseRawDynamicToolCall({
      type: "function_call",
      call_id: "",
      callId: "call-camel-1",
      name: "",
      tool: "codex_monitor.generate_image",
      arguments: JSON.stringify({
        prompt: "Fallback field image",
      }),
    });

    expect(call).toEqual({
      id: "call-camel-1",
      namespace: null,
      tool: "generate_image",
      arguments: {
        prompt: "Fallback field image",
      },
    });
    expect(
      getRawFunctionCallId({
        type: "function_call_output",
        call_id: "",
        callId: "call-camel-1",
        id: "ignored-id",
      }),
    ).toBe("call-camel-1");
  });

  it("does not infer uncached raw tool image outputs as generated images without generated image artifact metadata", () => {
    const output = {
      type: "function_call_output",
      call_id: "call-unrelated-image",
      output: [
        {
          type: "input_text",
          text: JSON.stringify({
            saved_path: "/tmp/uploads/diagram.png",
            status: "completed",
          }),
        },
        { type: "input_image", image_url: "data:image/png;base64,DIAGRAM" },
      ],
    };

    expect(buildRawDynamicToolOutputItem(output)).toBeNull();
  });

  it("does not infer uncached raw image outputs from another thread as generated images", () => {
    const output = {
      type: "function_call_output",
      call_id: "call-other-thread-image",
      output: [
        {
          type: "input_text",
          text: JSON.stringify({
            saved_path:
              "/tmp/codex-home/generated_images/thread-other/019_call_other_thread.png",
            status: "generated",
          }),
        },
      ],
    };

    expect(
      buildRawDynamicToolOutputItem(output, undefined, { threadId: "thread-1" }),
    ).toBeNull();
  });

  it("defaults web search items to completed status", () => {
    const item = buildConversationItem({
      type: "webSearch",
      id: "web-1",
      query: "codex monitor",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("webSearch");
      expect(item.status).toBe("completed");
      expect(item.detail).toBe("codex monitor");
    }
  });

  it("merges thread items preferring non-empty remote tool output", () => {
    const remote: ConversationItem = {
      id: "tool-2",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "ok",
      output: "short",
    };
    const local: ConversationItem = {
      id: "tool-2",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      output: "much longer output",
    };
    const merged = mergeThreadItems([remote], [local]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("tool");
    if (merged[0].kind === "tool") {
      expect(merged[0].output).toBe("short");
      expect(merged[0].status).toBe("ok");
    }
  });

  it("keeps local tool output when remote output is empty", () => {
    const remote: ConversationItem = {
      id: "tool-3",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "completed",
      output: " ",
    };
    const local: ConversationItem = {
      id: "tool-3",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      output: "streamed output",
    };
    const merged = mergeThreadItems([remote], [local]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("tool");
    if (merged[0].kind === "tool") {
      expect(merged[0].output).toBe("streamed output");
      expect(merged[0].status).toBe("completed");
    }
  });

  it("keeps local tool status when remote status is empty", () => {
    const remote: ConversationItem = {
      id: "tool-remote-status",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "",
      output: "",
    };
    const local: ConversationItem = {
      id: "tool-remote-status",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "completed",
      output: "",
    };
    const merged = mergeThreadItems([remote], [local]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("tool");
    if (merged[0].kind === "tool") {
      expect(merged[0].status).toBe("completed");
    }
  });

  it("keeps local generated image fields when remote thread data is partial", () => {
    const remote: ConversationItem = {
      id: "image-remote-partial",
      kind: "imageGeneration",
      status: "completed",
      prompt: "A seaside portrait",
      revisedPrompt: null,
      model: "gpt-image-2",
      size: "1024x1536",
      assetId: null,
      savedPath: null,
      imageSrc: null,
      error: null,
    };
    const local: ConversationItem = {
      id: "image-remote-partial",
      kind: "imageGeneration",
      status: "completed",
      prompt: "A seaside portrait",
      revisedPrompt: null,
      model: "gpt-image-2",
      size: "1024x1536",
      assetId: null,
      savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_1.png",
      imageSrc: "/tmp/codex-home/generated_images/thread-1/019_call_1.png",
      error: null,
    };

    const merged = mergeThreadItems([remote], [local]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("imageGeneration");
    if (merged[0].kind === "imageGeneration") {
      expect(merged[0].assetId).toBeNull();
      expect(merged[0].savedPath).toBe(
        "/tmp/codex-home/generated_images/thread-1/019_call_1.png",
      );
      expect(merged[0].imageSrc).toBe(
        "/tmp/codex-home/generated_images/thread-1/019_call_1.png",
      );
    }
  });

  it("merges scoped and unscoped generated image ids without appending stale copies", () => {
    const remote: ConversationItem = {
      id: "turn-1:call-image-1",
      kind: "imageGeneration",
      status: "completed",
      prompt: "A seaside portrait",
      revisedPrompt: null,
      model: "gpt-image-2",
      size: "1024x1536",
      assetId: null,
      savedPath: null,
      imageSrc: null,
      error: null,
    };
    const local: ConversationItem = {
      id: "call-image-1",
      kind: "imageGeneration",
      status: "completed",
      prompt: "A seaside portrait",
      revisedPrompt: null,
      model: "gpt-image-2",
      size: "1024x1536",
      assetId: null,
      savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_image_1.png",
      imageSrc: "/tmp/codex-home/generated_images/thread-1/019_call_image_1.png",
      error: null,
    };

    const merged = mergeThreadItems([remote], [local]);

    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("imageGeneration");
    if (merged[0].kind === "imageGeneration") {
      expect(merged[0].id).toBe("turn-1:call-image-1");
      expect(merged[0].savedPath).toBe(
        "/tmp/codex-home/generated_images/thread-1/019_call_image_1.png",
      );
    }
  });

  it("preserves streamed plan output when completion item has empty output", () => {
    const existing: ConversationItem = {
      id: "plan-1",
      kind: "tool",
      toolType: "plan",
      title: "Plan",
      detail: "Generating plan...",
      status: "in_progress",
      output: "## Plan\n- Step 1\n- Step 2",
    };
    const completed: ConversationItem = {
      id: "plan-1",
      kind: "tool",
      toolType: "plan",
      title: "Plan",
      detail: "",
      status: "completed",
      output: "",
    };

    const next = upsertItem([existing], completed);
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("tool");
    if (next[0].kind === "tool") {
      expect(next[0].output).toBe(existing.output);
      expect(next[0].status).toBe("completed");
    }
  });

  it("uses incoming tool output even when shorter than existing output", () => {
    const existing: ConversationItem = {
      id: "tool-4",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "in_progress",
      output: "verbose streamed output that will be replaced",
    };
    const incoming: ConversationItem = {
      id: "tool-4",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "completed",
      output: "final",
    };

    const next = upsertItem([existing], incoming);
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("tool");
    if (next[0].kind === "tool") {
      expect(next[0].output).toBe("final");
      expect(next[0].status).toBe("completed");
    }
  });

  it("preserves streamed reasoning content when completion item is empty", () => {
    const existing: ConversationItem = {
      id: "reasoning-1",
      kind: "reasoning",
      summary: "Thinking",
      content: "More detail",
    };
    const completed: ConversationItem = {
      id: "reasoning-1",
      kind: "reasoning",
      summary: "",
      content: "",
    };

    const next = upsertItem([existing], completed);
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("reasoning");
    if (next[0].kind === "reasoning") {
      expect(next[0].summary).toBe("Thinking");
      expect(next[0].content).toBe("More detail");
    }
  });

  it("preserves existing userInput answers when incoming payload has equal question count and no answers", () => {
    const existing: ConversationItem = {
      id: "user-input-1",
      kind: "userInput",
      status: "answered",
      questions: [
        {
          id: "q1",
          header: "Confirm",
          question: "Proceed?",
          answers: ["Yes"],
        },
      ],
    };
    const incoming: ConversationItem = {
      id: "user-input-1",
      kind: "userInput",
      status: "answered",
      questions: [
        {
          id: "q1",
          header: "Confirm",
          question: "Proceed?",
          answers: [],
        },
      ],
    };

    const next = upsertItem([existing], incoming);
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("userInput");
    if (next[0].kind === "userInput") {
      expect(next[0].questions[0]?.answers).toEqual(["Yes"]);
    }
  });

  it("preserves existing generated image fields during partial upserts", () => {
    const existing: ConversationItem = {
      id: "image-upsert-partial",
      kind: "imageGeneration",
      status: "completed",
      prompt: "A seaside portrait",
      revisedPrompt: null,
      model: "gpt-image-2",
      size: "1024x1536",
      assetId: null,
      savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_1.png",
      imageSrc: "/tmp/codex-home/generated_images/thread-1/019_call_1.png",
      error: null,
    };
    const incoming: ConversationItem = {
      id: "image-upsert-partial",
      kind: "imageGeneration",
      status: "completed",
      prompt: "A seaside portrait",
      revisedPrompt: null,
      model: "gpt-image-2",
      size: "1024x1536",
      assetId: null,
      savedPath: null,
      imageSrc: null,
      error: null,
    };

    const next = upsertItem([existing], incoming);
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("imageGeneration");
    if (next[0].kind === "imageGeneration") {
      expect(next[0].assetId).toBeNull();
      expect(next[0].savedPath).toBe(
        "/tmp/codex-home/generated_images/thread-1/019_call_1.png",
      );
      expect(next[0].imageSrc).toBe(
        "/tmp/codex-home/generated_images/thread-1/019_call_1.png",
      );
    }
  });

  it("keeps imageSrc pinned to savedPath when a raw base64 update arrives (no flicker)", () => {
    // Native item/completed: has the local artifact path.
    const existing: ConversationItem = {
      id: "ig_flicker",
      kind: "imageGeneration",
      status: "completed",
      prompt: "A seaside portrait",
      revisedPrompt: null,
      model: "gpt-image-2",
      size: "1024x1536",
      assetId: null,
      savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_flicker.png",
      imageSrc: "/tmp/codex-home/generated_images/thread-1/019_call_flicker.png",
      error: null,
    };
    // Runtime refresh for the same id may include a base64 data URL without
    // savedPath. It must not override the stable artifact path.
    const incoming: ConversationItem = {
      id: "ig_flicker",
      kind: "imageGeneration",
      status: "completed",
      prompt: "A seaside portrait",
      revisedPrompt: null,
      model: "gpt-image-2",
      size: "1024x1536",
      assetId: null,
      savedPath: null,
      imageSrc: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
      error: null,
    };

    const next = upsertItem([existing], incoming);
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("imageGeneration");
    if (next[0].kind === "imageGeneration") {
      expect(next[0].savedPath).toBe(
        "/tmp/codex-home/generated_images/thread-1/019_call_flicker.png",
      );
      expect(next[0].imageSrc).toBe(
        "/tmp/codex-home/generated_images/thread-1/019_call_flicker.png",
      );
    }
  });

  it("preserves existing answers for questions that are empty in a partial userInput upsert", () => {
    const existing: ConversationItem = {
      id: "user-input-2",
      kind: "userInput",
      status: "answered",
      questions: [
        {
          id: "q1",
          header: "Question 1",
          question: "Choose release mode",
          answers: ["Safe"],
        },
        {
          id: "q2",
          header: "Question 2",
          question: "Choose deployment time",
          answers: ["Tonight"],
        },
      ],
    };
    const incoming: ConversationItem = {
      id: "user-input-2",
      kind: "userInput",
      status: "answered",
      questions: [
        {
          id: "q1",
          header: "Question 1",
          question: "Choose release mode",
          answers: ["Fast"],
        },
        {
          id: "q2",
          header: "Question 2",
          question: "Choose deployment time",
          answers: [],
        },
      ],
    };

    const next = upsertItem([existing], incoming);
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("userInput");
    if (next[0].kind === "userInput") {
      expect(next[0].questions).toHaveLength(2);
      expect(next[0].questions[0]?.answers).toEqual(["Fast"]);
      expect(next[0].questions[1]?.answers).toEqual(["Tonight"]);
    }
  });

  it("preserves answered questions missing from a partial userInput upsert", () => {
    const existing: ConversationItem = {
      id: "user-input-3",
      kind: "userInput",
      status: "answered",
      questions: [
        {
          id: "q1",
          header: "Question 1",
          question: "Primary answer",
          answers: ["A"],
        },
        {
          id: "q2",
          header: "Question 2",
          question: "Secondary answer",
          answers: ["B"],
        },
      ],
    };
    const incoming: ConversationItem = {
      id: "user-input-3",
      kind: "userInput",
      status: "answered",
      questions: [
        {
          id: "q1",
          header: "Question 1",
          question: "Primary answer",
          answers: ["A2"],
        },
      ],
    };

    const next = upsertItem([existing], incoming);
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("userInput");
    if (next[0].kind === "userInput") {
      expect(next[0].questions).toHaveLength(2);
      expect(next[0].questions[0]?.id).toBe("q1");
      expect(next[0].questions[0]?.answers).toEqual(["A2"]);
      expect(next[0].questions[1]?.id).toBe("q2");
      expect(next[0].questions[1]?.answers).toEqual(["B"]);
    }
  });

  it("builds user message text from mixed inputs", () => {
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-1",
      content: [
        { type: "text", text: "Please" },
        { type: "skill", name: "Review" },
        { type: "image", url: "https://example.com/image.png" },
      ],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("user");
      expect(item.text).toBe("Please $Review");
      expect(item.images).toEqual(["https://example.com/image.png"]);
    }
  });

  it("keeps image-only user messages without placeholder text", () => {
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-2",
      content: [{ type: "image", url: "https://example.com/only.png" }],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("user");
      expect(item.text).toBe("");
      expect(item.images).toEqual(["https://example.com/only.png"]);
    }
  });

  it("preserves message creation timestamps from thread history", () => {
    const userItem = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-created-user",
      created_at: "2025-05-07T06:05:00Z",
      content: [{ type: "text", text: "Hello" }],
    });
    const assistantItem = buildConversationItemFromThreadItem({
      type: "agentMessage",
      id: "msg-created-assistant",
      timestamp: 1_746_599_400,
      text: "Hi",
    });

    expect(userItem).not.toBeNull();
    expect(assistantItem).not.toBeNull();
    if (userItem && userItem.kind === "message") {
      expect(userItem.createdAt).toBe(Date.parse("2025-05-07T06:05:00Z"));
    }
    if (assistantItem && assistantItem.kind === "message") {
      expect(assistantItem.createdAt).toBe(1_746_599_400_000);
    }
  });

  it("drops empty assistant messages from thread history", () => {
    const item = buildConversationItemFromThreadItem({
      type: "agentMessage",
      id: "msg-empty-assistant",
      text: "   ",
    });

    expect(item).toBeNull();
  });

  it("uses the turn timestamp for history messages without item timestamps", () => {
    const items = buildItemsFromThread({
      turns: [
        {
          created_at: "2025-05-07T07:30:00Z",
          items: [
            {
              type: "userMessage",
              id: "msg-turn-user",
              content: [{ type: "text", text: "From turn" }],
            },
            {
              type: "agentMessage",
              id: "msg-turn-assistant",
              text: "Reply from turn",
            },
          ],
        },
      ],
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "msg-turn-user",
      kind: "message",
      createdAt: Date.parse("2025-05-07T07:30:00Z"),
    });
    expect(items[1]).toMatchObject({
      id: "msg-turn-assistant",
      kind: "message",
      createdAt: Date.parse("2025-05-07T07:30:00Z"),
    });
  });

  it("formats collab tool calls with receivers and agent states", () => {
    const item = buildConversationItem({
      type: "collabToolCall",
      id: "collab-1",
      tool: "handoff",
      status: "ok",
      senderThreadId: "thread-a",
      receiverThreadIds: ["thread-b"],
      newThreadId: "thread-c",
      prompt: "Coordinate work",
      agentStatus: { "agent-1": { status: "running" } },
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.title).toBe("Collab: handoff");
      expect(item.detail).toContain("From thread-a");
      expect(item.detail).toContain("thread-b");
      expect(item.detail).toContain("thread-c");
      expect(item.output).toBe("Coordinate work\n\nagent-1: running");
    }
  });

  it("captures rich collab metadata from receiver_agents and agent_statuses", () => {
    const item = buildConversationItem({
      type: "collabToolCall",
      id: "collab-rich-1",
      tool: "wait",
      status: "completed",
      sender_thread_id: "thread-parent",
      receiver_agents: [
        {
          thread_id: "thread-child-1",
          agent_nickname: "Robie",
          agent_role: "explorer",
        },
      ],
      agent_statuses: [
        {
          thread_id: "thread-child-1",
          status: "completed",
          agent_nickname: "Robie",
          agent_role: "explorer",
        },
      ],
      prompt: "Wait for workers",
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.collabSender).toEqual({ threadId: "thread-parent" });
      expect(item.collabReceiver).toEqual({
        threadId: "thread-child-1",
        nickname: "Robie",
        role: "explorer",
      });
      expect(item.collabReceivers).toEqual([
        {
          threadId: "thread-child-1",
          nickname: "Robie",
          role: "explorer",
        },
      ]);
      expect(item.collabStatuses).toEqual([
        {
          threadId: "thread-child-1",
          nickname: "Robie",
          role: "explorer",
          status: "completed",
        },
      ]);
      expect(item.detail).toContain("Robie [explorer]");
      expect(item.output).toContain("Robie [explorer]: completed");
    }
  });

  it("builds context compaction items", () => {
    const item = buildConversationItem({
      type: "contextCompaction",
      id: "compact-1",
      status: "inProgress",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("contextCompaction");
      expect(item.title).toBe("Context compaction");
      expect(item.status).toBe("inProgress");
    }
  });

  it("builds context compaction items from thread history", () => {
    const item = buildConversationItemFromThreadItem({
      type: "contextCompaction",
      id: "compact-2",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("contextCompaction");
      expect(item.title).toBe("Context compaction");
      expect(item.status).toBe("completed");
    }
  });

  it("builds upstream image generation items", () => {
    const item = buildConversationItem({
      type: "imageGeneration",
      id: "image-1",
      status: "completed",
      model: "gpt-image-2",
      size: "1024x1536",
      revisedPrompt: "A polished blue rocket icon",
      result: "/tmp/codex-home/generated_images/thread-1/019_call_rocket.png",
      savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_rocket.png",
    });

    expect(item).toEqual({
      id: "image-1",
      kind: "imageGeneration",
      status: "completed",
      prompt: "",
      revisedPrompt: "A polished blue rocket icon",
      model: "gpt-image-2",
      size: "1024x1536",
      assetId: null,
      savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_rocket.png",
      imageSrc: "/tmp/codex-home/generated_images/thread-1/019_call_rocket.png",
      error: null,
      createdAt: undefined,
    });
  });

  it("builds upstream snake_case image generation response items", () => {
    const result =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJiVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ";
    const item = buildConversationItem(
      {
        type: "image_generation_call",
        id: "image-native-1",
        status: "completed",
        model: "gpt-image-1",
        size: "1024x1024",
        revised_prompt: "A polished local app screenshot",
        result,
      },
      { imageGenerationModel: "gpt-image-2" },
    );

    expect(item).toMatchObject({
      id: "image-native-1",
      kind: "imageGeneration",
      status: "completed",
      revisedPrompt: "A polished local app screenshot",
      model: "gpt-image-2",
      imageSrc: `data:image/png;base64,${result}`,
    });
  });

  it("uses the configured image model for upstream image generation items", () => {
    const item = buildConversationItem(
      {
        type: "imageGeneration",
        id: "call-image-1",
        status: "generating",
        model: "qihang-ultra-5.5",
        size: "1024x1536",
      },
      { imageGenerationModel: "gpt-image-2" },
    );

    expect(item).toMatchObject({
      id: "call-image-1",
      kind: "imageGeneration",
      model: "gpt-image-2",
      size: "1024x1536",
    });
  });

  it("completes upstream image generation items when the end payload has a saved image", () => {
    const item = buildConversationItem({
      type: "imageGeneration",
      id: "call-image-1",
      status: "generating",
      revisedPrompt: "A polished original short-video cover",
      result: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
      savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_image_1.png",
    });

    expect(item).toEqual({
      id: "call-image-1",
      kind: "imageGeneration",
      status: "completed",
      prompt: "",
      revisedPrompt: "A polished original short-video cover",
      model: "",
      size: "",
      assetId: null,
      savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_image_1.png",
      imageSrc: "/tmp/codex-home/generated_images/thread-1/019_call_image_1.png",
      error: null,
      createdAt: undefined,
    });
  });

  it("normalizes raw assistant response messages during thread replay", () => {
    const item = buildConversationItem({
      type: "message",
      id: "msg-raw-1",
      role: "assistant",
      created_at: "2026-06-14T08:00:00Z",
      content: [
        { type: "output_text", text: "我先帮你生成一张图。" },
        { type: "output_text", text: "\n生成时会优先保留你描述里的主体。" },
      ],
    });

    expect(item).toEqual({
      id: "msg-raw-1",
      kind: "message",
      role: "assistant",
      text: "我先帮你生成一张图。\n生成时会优先保留你描述里的主体。",
      createdAt: Date.parse("2026-06-14T08:00:00Z"),
    });
  });

  it("keeps raw assistant response messages before image generation cards", () => {
    const items = buildItemsFromThread(
      {
        turns: [
          {
            id: "turn-1",
            started_at: "2026-06-14T08:00:00Z",
            items: [
              {
                type: "message",
                id: "msg-raw-1",
                role: "assistant",
                content: [{ type: "output_text", text: "我先帮你生成一张图。" }],
              },
              {
                type: "function_call",
                call_id: "call-image-1",
                name: "generate_image",
                arguments: JSON.stringify({
                  prompt: "A generated image",
                }),
              },
              {
                type: "function_call_output",
                call_id: "call-image-1",
                output: [
                  {
                    type: "input_text",
                    text: JSON.stringify({
                      status: "generated",
                      model: "gpt-image-2",
                      saved_path: "/tmp/codex-home/generated_images/thread-1/019_call_image_1.png",
                    }),
                  },
                ],
              },
            ],
          },
        ],
      },
      { imageGenerationModel: "gpt-image-2" },
    );

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.kind)).toEqual(["message", "imageGeneration"]);
    expect(items[0]).toMatchObject({
      id: "msg-raw-1",
      kind: "message",
      role: "assistant",
      text: "我先帮你生成一张图。",
      createdAt: Date.parse("2026-06-14T08:00:00Z"),
    });
    expect(items[1]).toMatchObject({
      id: "call-image-1",
      kind: "imageGeneration",
      model: "gpt-image-2",
    });
  });

  it("coalesces duplicate image generation records during thread replay", () => {
    const result =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJiVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ";
    const items = buildItemsFromThread(
      {
        turns: [
          {
            items: [
              {
                type: "imageGeneration",
                id: "call-dupe",
                status: "completed",
                size: "1024x1536",
                savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_dupe.png",
              },
              {
                type: "function_call",
                call_id: "call-dupe",
                name: "generate_image",
                arguments: JSON.stringify({
                  prompt: "A tokusatsu-inspired original light hero in space",
                  size: "1024x1536",
                }),
              },
              {
                type: "function_call_output",
                call_id: "call-dupe",
                output: [
                  {
                    type: "input_text",
                    text: JSON.stringify({
                      status: "generated",
                      model: "gpt-image-2",
                      size: "1024x1536",
                      saved_path: "/tmp/codex-home/generated_images/thread-1/019_call_dupe.png",
                    }),
                  },
                  { type: "input_image", image_url: `data:image/png;base64,${result}` },
                ],
              },
            ],
          },
        ],
      },
      { imageGenerationModel: "gpt-image-2" },
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "call-dupe",
      kind: "imageGeneration",
      status: "completed",
      model: "gpt-image-2",
      size: "1024x1536",
      savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_dupe.png",
    });
  });

  it("uses the configured image model during thread replay", () => {
    const items = buildItemsFromThread(
      {
        turns: [
          {
            items: [
              {
                type: "imageGeneration",
                id: "call-image-replay",
                status: "generating",
                model: "qihang-ultra-5.5",
                size: "1024x1536",
              },
            ],
          },
        ],
      },
      { imageGenerationModel: "gpt-image-2" },
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "call-image-replay",
      kind: "imageGeneration",
      model: "gpt-image-2",
    });
  });

  it("normalizes runtime generate_image tool calls into image generation items", () => {
    const item = buildConversationItem({
      type: "dynamicToolCall",
      id: "call-1",
      namespace: "",
      tool: "generate_image",
      status: "completed",
      arguments: {
        prompt: "A small blue rocket icon",
        size: "1024x1024",
      },
      contentItems: [
        {
          type: "inputText",
          text: JSON.stringify({
            status: "generated",
            model: "gpt-image-2",
            saved_path: "/tmp/codex-home/generated_images/thread-1/019_call_1.png",
          }),
        },
        { type: "inputImage", imageUrl: "data:image/png;base64,AAA" },
      ],
      success: true,
    });

    expect(item).toEqual({
      id: "call-1",
      kind: "imageGeneration",
      status: "completed",
      prompt: "A small blue rocket icon",
      revisedPrompt: null,
      model: "gpt-image-2",
      size: "1024x1024",
      assetId: null,
      savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_1.png",
      imageSrc: "data:image/png;base64,AAA",
      error: null,
      createdAt: undefined,
    });
  });

  it("normalizes legacy codex_monitor.generate_image calls during thread replay", () => {
    const items = buildItemsFromThread({
      turns: [
        {
          id: "turn-legacy",
          started_at: "2026-06-18T02:08:24Z",
          items: [
            {
              type: "message",
              id: "assistant-intro",
              role: "assistant",
              content: [{ type: "output_text", text: "开始生成第一张。" }],
            },
            {
              type: "function_call",
              call_id: "call-legacy-image",
              namespace: "codex_monitor",
              name: "generate_image",
              arguments: JSON.stringify({ prompt: "A restored image" }),
            },
            {
              type: "function_call_output",
              call_id: "call-legacy-image",
              output: [
                {
                  type: "input_text",
                  text: JSON.stringify({
                    status: "generated",
                    saved_path:
                      "/tmp/codex-home/generated_images/thread-1/019_call_legacy_image.png",
                    model: "gpt-image-1",
                  }),
                },
              ],
            },
            {
              type: "message",
              id: "assistant-summary",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text:
                    "图片已生成：/tmp/codex-home/generated_images/thread-1/019_call_legacy_image.png",
                },
              ],
            },
          ],
        },
      ],
    });

    expect(items.map((item) => item.id)).toEqual([
      "assistant-intro",
      "call-legacy-image",
      "assistant-summary",
    ]);
    expect(items[1]).toMatchObject({
      kind: "imageGeneration",
      status: "completed",
      savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_legacy_image.png",
      createdAt: Date.parse("2026-06-18T02:08:24Z"),
    });
  });

  it("keeps id-less raw assistant messages as ordering anchors during thread replay", () => {
    const items = buildItemsFromThread({
      turns: [
        {
          id: "turn-actual",
          started_at: "2026-06-18T02:08:24Z",
          items: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "开始开麦生成。" }],
            },
            {
              type: "function_call",
              call_id: "call-actual-image",
              name: "generate_image",
              arguments: JSON.stringify({ prompt: "A restored rollout image" }),
            },
            {
              type: "function_call_output",
              call_id: "call-actual-image",
              output: [
                {
                  type: "input_text",
                  text: JSON.stringify({
                    status: "generated",
                    saved_path:
                      "/tmp/codex-home/generated_images/thread-1/019_call_actual_image.png",
                  }),
                },
              ],
            },
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "图片已生成。" }],
            },
          ],
        },
      ],
    });

    expect(items.map((item) => item.id)).toEqual([
      "turn-actual:raw-message:0",
      "call-actual-image",
      "turn-actual:raw-message:3",
    ]);
    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "imageGeneration",
      "message",
    ]);
  });

  it("renders saved_path outputs as images even when the function call is missing", () => {
    const items = buildItemsFromThread({
      id: "thread-1",
      turns: [
        {
          id: "turn-output-only",
          items: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "开始生成。" }],
            },
            {
              type: "function_call_output",
              call_id: "call-output-only",
              output: [
                {
                  type: "input_text",
                  text: JSON.stringify({
                    status: "generated",
                    saved_path:
                      "/tmp/codex-home/generated_images/thread-1/019_call_output_only.png",
                    model: "gpt-image-2",
                  }),
                },
              ],
            },
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "生成完成。" }],
            },
          ],
        },
      ],
    });

    expect(items.map((item) => item.id)).toEqual([
      "turn-output-only:raw-message:0",
      "call-output-only",
      "turn-output-only:raw-message:2",
    ]);
    expect(items[1]).toMatchObject({
      kind: "imageGeneration",
      status: "completed",
      savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_output_only.png",
      imageSrc: "/tmp/codex-home/generated_images/thread-1/019_call_output_only.png",
    });
  });

  it("normalizes raw runtime generate_image function calls during thread replay", () => {
    const items = buildItemsFromThread({
      turns: [
        {
          items: [
            {
              type: "function_call",
              call_id: "call-1",
              name: "generate_image",
              arguments: JSON.stringify({
                prompt: "A seaside portrait",
                size: "1024x1536",
              }),
            },
            {
              type: "function_call_output",
              call_id: "call-1",
              output: [
                {
                  type: "input_text",
                  text: JSON.stringify({
                    status: "generated",
                    model: "gpt-image-2",
                    size: "1024x1536",
                    saved_path: "/tmp/codex-home/generated_images/thread-1/019_call_1.png",
                  }),
                },
                {
                  type: "input_image",
                  image_url: "data:image/png;base64,AAA",
                  detail: "high",
                },
              ],
            },
          ],
        },
      ],
    });

    expect(items).toEqual([
      {
        id: "call-1",
        kind: "imageGeneration",
        status: "completed",
        prompt: "A seaside portrait",
        revisedPrompt: null,
        model: "gpt-image-2",
        size: "1024x1536",
        assetId: null,
        savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_1.png",
        imageSrc: "/tmp/codex-home/generated_images/thread-1/019_call_1.png",
        error: null,
        createdAt: undefined,
      },
    ]);
  });

  it("anchors runtime generate_image function calls before the final assistant message", () => {
    const items = buildItemsFromThread({
      turns: [
        {
          started_at: "2026-06-14T08:00:00Z",
          items: [
            {
              type: "userMessage",
              id: "msg-user-1",
              content: [{ type: "text", text: "Generate an image" }],
            },
            {
              type: "function_call",
              call_id: "call-anchor-1",
              name: "generate_image",
              arguments: JSON.stringify({
                prompt: "A runtime generated image",
              }),
            },
            {
              type: "agentMessage",
              id: "msg-assistant-1",
              text: "Image generated.",
            },
          ],
        },
      ],
    });

    expect(items.map((item) => item.id)).toEqual([
      "msg-user-1",
      "call-anchor-1",
      "msg-assistant-1",
    ]);
    expect(items[1]).toMatchObject({
      id: "call-anchor-1",
      kind: "imageGeneration",
      status: "in_progress",
      prompt: "A runtime generated image",
      createdAt: Date.parse("2026-06-14T08:00:00Z"),
    });
  });

  it("unwraps historical response_item payloads before anchoring runtime images", () => {
    const items = buildItemsFromThread({
      turns: [
        {
          started_at: "2026-06-14T08:00:00Z",
          items: [
            {
              type: "userMessage",
              id: "msg-user-history",
              content: [{ type: "text", text: "Generate an image" }],
            },
            {
              type: "response_item",
              payload: {
                type: "function_call",
                call_id: "call-history-image",
                name: "generate_image",
                arguments: JSON.stringify({
                  prompt: "A historical rollout image",
                }),
              },
            },
            {
              type: "response_item",
              payload: {
                type: "function_call_output",
                call_id: "call-history-image",
                output: [
                  {
                    type: "input_text",
                    text: JSON.stringify({
                      status: "generated",
                      model: "gpt-image-2",
                      saved_path:
                        "/tmp/codex-home/generated_images/thread-1/019_call_history_image.png",
                    }),
                  },
                ],
              },
            },
            {
              type: "agentMessage",
              id: "msg-assistant-history",
              text: "Image generated.",
            },
          ],
        },
      ],
    });

    expect(items.map((item) => item.id)).toEqual([
      "msg-user-history",
      "call-history-image",
      "msg-assistant-history",
    ]);
    expect(items[1]).toMatchObject({
      id: "call-history-image",
      kind: "imageGeneration",
      status: "completed",
      prompt: "A historical rollout image",
      model: "gpt-image-2",
      savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_history_image.png",
      imageSrc: "/tmp/codex-home/generated_images/thread-1/019_call_history_image.png",
      createdAt: Date.parse("2026-06-14T08:00:00Z"),
    });
  });

  it("normalizes bare raw generate_image function calls into image generation items", () => {
    const items = buildItemsFromThread({
      turns: [
        {
          items: [
            {
              type: "function_call",
              call_id: "call-bare-1",
              name: "generate_image",
              arguments: JSON.stringify({
                prompt: "A neon city poster",
                size: "1024x1024",
              }),
            },
            {
              type: "function_call_output",
              call_id: "call-bare-1",
              output: [
                {
                  type: "input_text",
                  text: JSON.stringify({
                    status: "generated",
                    model: "gpt-image-2",
                    saved_path: "/tmp/codex-home/generated_images/thread-1/019_call_bare_1.png",
                  }),
                },
                {
                  type: "input_image",
                  image_url: "data:image/png;base64,BBB",
                },
              ],
            },
          ],
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "call-bare-1",
      kind: "imageGeneration",
      prompt: "A neon city poster",
      assetId: null,
      savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_bare_1.png",
      imageSrc: "/tmp/codex-home/generated_images/thread-1/019_call_bare_1.png",
    });
  });

  it("normalizes gateway generate_image outputs that only include saved_path metadata", () => {
    const items = buildItemsFromThread({
      turns: [
        {
          items: [
            {
              type: "function_call",
              call_id: "call-gateway-1",
              name: "generate_image",
              arguments: JSON.stringify({
                prompt: "An Ultraman style hero in a city battle",
                size: "1024x1024",
              }),
            },
            {
              type: "function_call_output",
              call_id: "call-gateway-1",
              output: [
                {
                  type: "input_text",
                  text: JSON.stringify({
                    status: "generated",
                    saved_path: "/tmp/codex-home/generated_images/thread-1/019_call_gateway_1.png",
                    model: "gpt-image-2",
                    size: "1024x1024",
                  }),
                },
                {
                  type: "input_image",
                  image_url: "data:image/png;base64,CCC",
                },
              ],
            },
          ],
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "call-gateway-1",
      kind: "imageGeneration",
      status: "completed",
      prompt: "An Ultraman style hero in a city battle",
      assetId: null,
      savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_gateway_1.png",
      imageSrc: "/tmp/codex-home/generated_images/thread-1/019_call_gateway_1.png",
      model: "gpt-image-2",
      size: "1024x1024",
    });
  });

  it("parses ISO timestamps for thread updates", () => {
    const timestamp = getThreadTimestamp({ updated_at: "2025-01-01T00:00:00Z" });
    expect(timestamp).toBe(Date.parse("2025-01-01T00:00:00Z"));
  });

  it("returns 0 for invalid thread timestamps", () => {
    const timestamp = getThreadTimestamp({ updated_at: "not-a-date" });
    expect(timestamp).toBe(0);
  });

  it("parses created timestamps", () => {
    const timestamp = getThreadCreatedTimestamp({ created_at: "2025-01-01T00:00:00Z" });
    expect(timestamp).toBe(Date.parse("2025-01-01T00:00:00Z"));
  });

});
