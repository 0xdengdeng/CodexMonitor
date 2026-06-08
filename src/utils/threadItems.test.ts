import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../types";
import {
  buildConversationItem,
  buildConversationItemFromThreadItem,
  buildItemsFromThread,
  getThreadCreatedTimestamp,
  getThreadTimestamp,
  mergeThreadItems,
  normalizeItem,
  prepareThreadItems,
  upsertItem,
} from "./threadItems";

describe("threadItems", () => {
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
      model: "adg-image",
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
      model: "adg-image",
      size: "1024x1536",
      assetId: "asset-1",
      savedPath: "/tmp/generated-images/asset-1.png",
      imageSrc: "/tmp/generated-images/asset-1.png",
      error: null,
    };

    const merged = mergeThreadItems([remote], [local]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("imageGeneration");
    if (merged[0].kind === "imageGeneration") {
      expect(merged[0].assetId).toBe("asset-1");
      expect(merged[0].savedPath).toBe("/tmp/generated-images/asset-1.png");
      expect(merged[0].imageSrc).toBe("/tmp/generated-images/asset-1.png");
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
      model: "adg-image",
      size: "1024x1536",
      assetId: "asset-1",
      savedPath: "/tmp/generated-images/asset-1.png",
      imageSrc: "/tmp/generated-images/asset-1.png",
      error: null,
    };
    const incoming: ConversationItem = {
      id: "image-upsert-partial",
      kind: "imageGeneration",
      status: "completed",
      prompt: "A seaside portrait",
      revisedPrompt: null,
      model: "adg-image",
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
      expect(next[0].assetId).toBe("asset-1");
      expect(next[0].savedPath).toBe("/tmp/generated-images/asset-1.png");
      expect(next[0].imageSrc).toBe("/tmp/generated-images/asset-1.png");
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
      result: "/tmp/generated-images/rocket.png",
      savedPath: "/tmp/generated-images/rocket.png",
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
      savedPath: "/tmp/generated-images/rocket.png",
      imageSrc: "/tmp/generated-images/rocket.png",
      error: null,
      createdAt: undefined,
    });
  });

  it("uses the configured image model for upstream image generation items", () => {
    const item = buildConversationItem(
      {
        type: "imageGeneration",
        id: "image-native-1",
        status: "generating",
        model: "qihang-ultra-5.5",
        size: "1024x1536",
      },
      { imageGenerationModel: "gpt-image-2" },
    );

    expect(item).toMatchObject({
      id: "image-native-1",
      kind: "imageGeneration",
      model: "gpt-image-2",
      size: "1024x1536",
    });
  });

  it("completes upstream image generation items when the end payload has a saved image", () => {
    const item = buildConversationItem({
      type: "imageGeneration",
      id: "ig-native-1",
      status: "generating",
      revisedPrompt: "A polished original short-video cover",
      result: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
      savedPath: "/tmp/generated-images/ig-native-1.png",
    });

    expect(item).toEqual({
      id: "ig-native-1",
      kind: "imageGeneration",
      status: "completed",
      prompt: "",
      revisedPrompt: "A polished original short-video cover",
      model: "",
      size: "",
      assetId: null,
      savedPath: "/tmp/generated-images/ig-native-1.png",
      imageSrc: "/tmp/generated-images/ig-native-1.png",
      error: null,
      createdAt: undefined,
    });
  });

  it("normalizes raw image_generation_call response items during thread replay", () => {
    const result =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJiVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ";
    const item = buildConversationItem(
      {
        type: "image_generation_call",
        id: "ig-native-raw",
        status: "generating",
        model: "qihang-ultra-5.5",
        size: "1024x1536",
        revised_prompt: "A tokusatsu-inspired original light hero in space",
        result,
      },
      { imageGenerationModel: "gpt-image-2" },
    );

    expect(item).toEqual({
      id: "ig-native-raw",
      kind: "imageGeneration",
      status: "completed",
      prompt: "",
      revisedPrompt: "A tokusatsu-inspired original light hero in space",
      model: "gpt-image-2",
      size: "1024x1536",
      assetId: null,
      savedPath: null,
      imageSrc: `data:image/png;base64,${result}`,
      error: null,
      createdAt: undefined,
    });
  });

  it("keeps same image generation call ids from different turns as separate items", () => {
    const items = buildItemsFromThread(
      {
        turns: [
          {
            id: "turn-1",
            items: [
              {
                type: "image_generation_call",
                id: "ig_1",
                status: "completed",
                result: "AAA",
              },
            ],
          },
          {
            id: "turn-2",
            items: [
              {
                type: "image_generation_call",
                id: "ig_1",
                status: "completed",
                result: "BBB",
              },
            ],
          },
        ],
      },
      { imageGenerationModel: "gpt-image-2" },
    );

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.id)).toEqual(["turn-1:ig_1", "turn-2:ig_1"]);
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
                id: "ig-native-dupe",
                status: "completed",
                size: "1024x1536",
                savedPath: "/tmp/generated-images/ig-native-dupe.png",
              },
              {
                type: "image_generation_call",
                id: "ig-native-dupe",
                status: "generating",
                model: "qihang-ultra-5.5",
                size: "1024x1536",
                revised_prompt: "A tokusatsu-inspired original light hero in space",
                result,
              },
            ],
          },
        ],
      },
      { imageGenerationModel: "gpt-image-2" },
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "ig-native-dupe",
      kind: "imageGeneration",
      status: "completed",
      model: "gpt-image-2",
      size: "1024x1536",
      savedPath: "/tmp/generated-images/ig-native-dupe.png",
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
                id: "ig-native-replay",
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
      id: "ig-native-replay",
      kind: "imageGeneration",
      model: "gpt-image-2",
    });
  });

  it("normalizes AgentDesk image dynamic tool calls into image generation items", () => {
    const item = buildConversationItem({
      type: "dynamicToolCall",
      id: "call-1",
      namespace: "codex_monitor",
      tool: "generate_image",
      status: "completed",
      arguments: {
        prompt: "A small blue rocket icon",
        size: "1024x1024",
      },
      contentItems: [
        { type: "inputText", text: "{\"assetId\":\"asset-1\",\"model\":\"adg-image\"}" },
        { type: "inputImage", imageUrl: "/tmp/generated-images/asset-1.png" },
      ],
      success: true,
    });

    expect(item).toEqual({
      id: "call-1",
      kind: "imageGeneration",
      status: "completed",
      prompt: "A small blue rocket icon",
      revisedPrompt: null,
      model: "adg-image",
      size: "1024x1024",
      assetId: "asset-1",
      savedPath: "/tmp/generated-images/asset-1.png",
      imageSrc: "/tmp/generated-images/asset-1.png",
      error: null,
      createdAt: undefined,
    });
  });

  it("normalizes raw response function calls into image generation items during thread replay", () => {
    const items = buildItemsFromThread({
      turns: [
        {
          items: [
            {
              type: "function_call",
              call_id: "call-1",
              namespace: "codex_monitor",
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
                    assetId: "asset-1",
                    model: "adg-image",
                    size: "1024x1536",
                    savedPath: "/tmp/generated-images/asset-1.png",
                    localPath: "/tmp/generated-images/asset-1.png",
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
        model: "adg-image",
        size: "1024x1536",
        assetId: "asset-1",
        savedPath: "/tmp/generated-images/asset-1.png",
        imageSrc: "data:image/png;base64,AAA",
        error: null,
        createdAt: undefined,
      },
    ]);
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
