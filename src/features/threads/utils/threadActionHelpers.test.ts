import { describe, expect, it } from "vitest";
import type { ConversationItem } from "@/types";
import {
  buildGeneratedImageRecoveryDecision,
  buildResumeHydrationPlan,
} from "./threadActionHelpers";

describe("threadActionHelpers", () => {
  it("does not resume when generated images are already present and anchored", () => {
    const localItems: ConversationItem[] = [
      {
        id: "assistant-summary",
        kind: "message",
        role: "assistant",
        text: "图片都生成好了。",
      },
      {
        id: "call-image-1",
        kind: "imageGeneration",
        status: "completed",
        prompt: "",
        revisedPrompt: null,
        model: "",
        size: "",
        assetId: null,
        savedPath: "/tmp/generated_images/thread-1/call-image-1.png",
        imageSrc: "/tmp/generated_images/thread-1/call-image-1.png",
        error: null,
      },
    ];

    expect(localItems.some((item) => item.kind === "imageGeneration")).toBe(true);
    expect(
      buildGeneratedImageRecoveryDecision({
        assetCount: 1,
        missingAnchorIds: [],
        isThreadProcessing: false,
      }),
    ).toEqual({
      shouldResume: false,
      replaceLocal: false,
      reason: "none",
    });
  });

  it("replaces local text-only fallback when generated image anchors are missing", () => {
    expect(
      buildGeneratedImageRecoveryDecision({
        assetCount: 1,
        missingAnchorIds: ["call-image-1"],
        isThreadProcessing: false,
      }),
    ).toEqual({
      shouldResume: true,
      replaceLocal: true,
      reason: "missing-image-anchor",
    });
  });

  it("uses resumed rollout image order instead of stale cached image placement", () => {
    const staleCachedItems: ConversationItem[] = [
      {
        id: "assistant-intro",
        kind: "message",
        role: "assistant",
        text: "我按顺序生成。",
      },
      {
        id: "assistant-progress",
        kind: "message",
        role: "assistant",
        text: "第一张好了，第二张继续。",
      },
      {
        id: "assistant-summary",
        kind: "message",
        role: "assistant",
        text: "五张图片都在这里。",
      },
      {
        id: "call-image-1",
        kind: "imageGeneration",
        status: "completed",
        prompt: "first image",
        revisedPrompt: "",
        model: "gpt-image-2",
        size: "",
        assetId: null,
        savedPath: "/tmp/codex-home/generated_images/thread-1/call-image-1.png",
        imageSrc: "/tmp/codex-home/generated_images/thread-1/call-image-1.png",
        error: null,
      },
      {
        id: "call-image-2",
        kind: "imageGeneration",
        status: "completed",
        prompt: "second image",
        revisedPrompt: "",
        model: "gpt-image-2",
        size: "",
        assetId: null,
        savedPath: "/tmp/codex-home/generated_images/thread-1/call-image-2.png",
        imageSrc: "/tmp/codex-home/generated_images/thread-1/call-image-2.png",
        error: null,
      },
    ];

    const plan = buildResumeHydrationPlan({
      getCustomName: () => undefined,
      localActiveTurnId: null,
      localItems: staleCachedItems,
      localStatus: undefined,
      replaceLocal: false,
      thread: {
        id: "thread-1",
        preview: "生成五张图片",
        updated_at: 123,
        turns: [
          {
            id: "turn-1",
            started_at: "2026-06-18T10:00:00Z",
            items: [
              {
                type: "message",
                id: "assistant-intro",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: "我按顺序生成。",
                  },
                ],
              },
              {
                type: "function_call",
                call_id: "call-image-1",
                name: "generate_image",
                arguments: JSON.stringify({ prompt: "first image" }),
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
                      saved_path:
                        "/tmp/codex-home/generated_images/thread-1/call-image-1.png",
                    }),
                  },
                ],
              },
              {
                type: "message",
                id: "assistant-progress",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: "第一张好了，第二张继续。",
                  },
                ],
              },
              {
                type: "function_call",
                call_id: "call-image-2",
                name: "generate_image",
                arguments: JSON.stringify({ prompt: "second image" }),
              },
              {
                type: "function_call_output",
                call_id: "call-image-2",
                output: [
                  {
                    type: "input_text",
                    text: JSON.stringify({
                      status: "generated",
                      model: "gpt-image-2",
                      saved_path:
                        "/tmp/codex-home/generated_images/thread-1/call-image-2.png",
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
                    text: "五张图片都在这里。",
                  },
                ],
              },
            ],
          },
        ],
      },
      threadId: "thread-1",
      workspaceId: "ws-1",
      imageGenerationModel: "gpt-image-2",
    });

    expect(plan.shouldHydrate).toBe(true);
    expect(plan.mergedItems.map((item) => item.id)).toEqual([
      "assistant-intro",
      "call-image-1",
      "assistant-progress",
      "call-image-2",
      "assistant-summary",
    ]);
  });

  it("does not append stale local summary messages after reconstructed image history", () => {
    const imagePath =
      "/tmp/codex-home/generated_images/thread-1/019ed87c_call_call-image-1.png";
    const plan = buildResumeHydrationPlan({
      getCustomName: () => undefined,
      localActiveTurnId: null,
      localItems: [
        {
          id: "old-local-summary",
          kind: "message",
          role: "assistant",
          text: `图片已生成：\n\n${imagePath}`,
        },
        {
          id: "call-image-1",
          kind: "imageGeneration",
          status: "completed",
          prompt: "",
          revisedPrompt: null,
          model: "",
          size: "",
          assetId: null,
          savedPath: imagePath,
          imageSrc: imagePath,
          error: null,
        },
      ],
      localStatus: undefined,
      replaceLocal: false,
      thread: {
        id: "thread-1",
        preview: "生成图片",
        updated_at: 123,
        turns: [
          {
            id: "turn-1",
            items: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "开始生成。" }],
              },
              {
                type: "function_call_output",
                call_id: "call-image-1",
                output: [
                  {
                    type: "input_text",
                    text: JSON.stringify({
                      status: "generated",
                      saved_path: imagePath,
                    }),
                  },
                ],
              },
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: `图片已生成：\n\n${imagePath}` }],
              },
            ],
          },
        ],
      },
      threadId: "thread-1",
      workspaceId: "ws-1",
      imageGenerationModel: "gpt-image-2",
    });

    expect(plan.mergedItems.map((item) => item.id)).toEqual([
      "turn-1:raw-message:0",
      "call-image-1",
      "turn-1:raw-message:2",
    ]);
  });

  it("uses reconstructed image history as authoritative order and drops unmatched stale local messages", () => {
    const imagePath =
      "/tmp/codex-home/generated_images/thread-1/019ed87c_call_call-image-1.png";
    const plan = buildResumeHydrationPlan({
      getCustomName: () => undefined,
      localActiveTurnId: null,
      localItems: [
        {
          id: "stale-local-progress",
          kind: "message",
          role: "assistant",
          text: "旧内存里的进度文案，不应该追加到恢复结果后面。",
        },
        {
          id: "call-image-1",
          kind: "imageGeneration",
          status: "completed",
          prompt: "",
          revisedPrompt: null,
          model: "",
          size: "",
          assetId: null,
          savedPath: imagePath,
          imageSrc: imagePath,
          error: null,
        },
      ],
      localStatus: undefined,
      replaceLocal: false,
      thread: {
        id: "thread-1",
        preview: "生成图片",
        updated_at: 123,
        turns: [
          {
            id: "turn-1",
            items: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "开始生成。" }],
              },
              {
                type: "function_call_output",
                call_id: "call-image-1",
                output: [
                  {
                    type: "input_text",
                    text: JSON.stringify({
                      status: "generated",
                      saved_path: imagePath,
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
      },
      threadId: "thread-1",
      workspaceId: "ws-1",
      imageGenerationModel: "gpt-image-2",
    });

    expect(plan.mergedItems.map((item) => item.id)).toEqual([
      "turn-1:raw-message:0",
      "call-image-1",
      "turn-1:raw-message:2",
    ]);
  });

  it("keeps unmatched local images while dropping unmatched stale local messages", () => {
    const imagePath =
      "/tmp/codex-home/generated_images/thread-1/019ed87c_call_call-image-1.png";
    const localOnlyImagePath =
      "/tmp/codex-home/generated_images/thread-1/019ed87c_call_call-local-only.png";
    const plan = buildResumeHydrationPlan({
      getCustomName: () => undefined,
      localActiveTurnId: null,
      localItems: [
        {
          id: "stale-local-progress",
          kind: "message",
          role: "assistant",
          text: "旧内存里的进度文案，不应该追加到恢复结果后面。",
        },
        {
          id: "call-local-only",
          kind: "imageGeneration",
          status: "completed",
          prompt: "",
          revisedPrompt: null,
          model: "",
          size: "",
          assetId: null,
          savedPath: localOnlyImagePath,
          imageSrc: localOnlyImagePath,
          error: null,
        },
      ],
      localStatus: undefined,
      replaceLocal: false,
      thread: {
        id: "thread-1",
        preview: "生成图片",
        updated_at: 123,
        turns: [
          {
            id: "turn-1",
            items: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "开始生成。" }],
              },
              {
                type: "function_call_output",
                call_id: "call-image-1",
                output: [
                  {
                    type: "input_text",
                    text: JSON.stringify({
                      status: "generated",
                      saved_path: imagePath,
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
      },
      threadId: "thread-1",
      workspaceId: "ws-1",
      imageGenerationModel: "gpt-image-2",
    });

    expect(plan.mergedItems.map((item) => item.id)).toEqual([
      "turn-1:raw-message:0",
      "call-image-1",
      "turn-1:raw-message:2",
      "call-local-only",
    ]);
  });
});
