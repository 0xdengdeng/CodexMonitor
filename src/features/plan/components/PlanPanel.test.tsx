// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanPanel } from "./PlanPanel";

afterEach(() => {
  cleanup();
});

describe("PlanPanel", () => {
  it("shows a waiting label while processing without a plan", () => {
    render(<PlanPanel plan={null} isProcessing />);

    expect(screen.getByText("Waiting on a plan...")).toBeTruthy();
  });

  it("shows an empty label when idle without a plan", () => {
    render(<PlanPanel plan={null} isProcessing={false} />);

    expect(screen.getByText("No active plan.")).toBeTruthy();
  });

  it("summarizes progress, background tasks, and generated images", () => {
    render(
      <PlanPanel
        plan={{
          turnId: "turn-1",
          explanation: "Implementation checklist",
          steps: [
            { step: "Map current UI", status: "completed" },
            { step: "Build overview", status: "inProgress" },
            { step: "Verify behavior", status: "pending" },
          ],
        }}
        isProcessing
        backgroundTasks={[
          { id: "terminal-1", title: "npm run tauri:dev", status: "running" },
        ]}
        generatedImages={[
          {
            id: "image-1",
            kind: "imageGeneration",
            status: "completed",
            prompt: "wide banner",
            revisedPrompt: null,
            model: "gpt-image-2",
            size: "1792x768",
            assetId: null,
            savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_1.png",
            imageSrc: "data:image/png;base64,AAA",
            error: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("Progress")).toBeTruthy();
    expect(screen.getByText("1/3")).toBeTruthy();
    expect(screen.getByText("Background tasks")).toBeTruthy();
    expect(screen.getByText("npm run tauri:dev")).toBeTruthy();
    expect(screen.getByText("Generated images")).toBeTruthy();
    expect(screen.getByText("gpt-image-2")).toBeTruthy();
    expect(screen.getByText("1792x768")).toBeTruthy();
    expect(screen.queryByText("/tmp/codex-home/generated_images")).toBeNull();
  });

  it("opens background tasks from the overview", async () => {
    const onOpenBackgroundTask = vi.fn();

    render(
      <PlanPanel
        plan={null}
        isProcessing={false}
        backgroundTasks={[
          { id: "terminal-1", title: "npm run tauri:dev", status: "running" },
        ]}
        onOpenBackgroundTask={onOpenBackgroundTask}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /npm run tauri:dev/ }));

    expect(onOpenBackgroundTask).toHaveBeenCalledWith("terminal-1");
  });

  it("opens generated images from the overview", () => {
    const onOpenGeneratedImage = vi.fn();

    render(
      <PlanPanel
        plan={null}
        isProcessing={false}
        generatedImages={[
          {
            id: "image-1",
            kind: "imageGeneration",
            status: "completed",
            prompt: "wide banner",
            revisedPrompt: null,
            model: "gpt-image-2",
            size: "1792x768",
            assetId: null,
            savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_1.png",
            imageSrc: "data:image/png;base64,AAA",
            error: null,
          },
        ]}
        onOpenGeneratedImage={onOpenGeneratedImage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open generated image/ }));

    expect(onOpenGeneratedImage).toHaveBeenCalledWith("image-1");
  });

  it("anchors the generated image preview close button to the image content", () => {
    render(
      <PlanPanel
        plan={null}
        isProcessing={false}
        generatedImages={[
          {
            id: "image-1",
            kind: "imageGeneration",
            status: "completed",
            prompt: "wide banner",
            revisedPrompt: null,
            model: "gpt-image-2",
            size: "1792x768",
            assetId: null,
            savedPath: "/tmp/codex-home/generated_images/thread-1/019_call_1.png",
            imageSrc: "data:image/png;base64,AAA",
            error: null,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open generated image/ }));

    const closeButton = screen.getByRole("button", { name: "Close image preview" });
    expect(closeButton.closest(".message-image-lightbox-content")).toBeTruthy();
  });

  it("shows a readable label for in-progress generated images", () => {
    render(
      <PlanPanel
        plan={null}
        isProcessing
        generatedImages={[
          {
            id: "image-1",
            kind: "imageGeneration",
            status: "in_progress",
            prompt: "portrait cover",
            revisedPrompt: null,
            model: "gpt-image-2",
            size: "1024x1536",
            assetId: null,
            savedPath: null,
            imageSrc: null,
            error: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("processing")).toBeTruthy();
    expect(screen.queryByText("messages.status.in_progress")).toBeNull();
  });
});
