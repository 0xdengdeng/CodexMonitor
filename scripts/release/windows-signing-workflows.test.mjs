import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = new URL("../../", import.meta.url);

const workflowPaths = [
  ".github/workflows/release.yml",
  ".github/workflows/release-windows.yml",
];

function readWorkflow(path) {
  return readFileSync(join(repoRoot.pathname, path), "utf8");
}

describe("Windows release code signing workflows", () => {
  for (const workflowPath of workflowPaths) {
    it(`${workflowPath} imports and verifies an Authenticode certificate`, () => {
      const workflow = readWorkflow(workflowPath);

      expect(workflow).toContain(
        "WINDOWS_CERTIFICATE_B64: ${{ secrets.WINDOWS_CERTIFICATE_B64 }}",
      );
      expect(workflow).toContain(
        "WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}",
      );
      expect(workflow).toContain(
        "WINDOWS_CERTIFICATE_THUMBPRINT: ${{ secrets.WINDOWS_CERTIFICATE_THUMBPRINT }}",
      );
      expect(workflow).toContain("Import Windows code signing certificate");
      expect(workflow).toContain("Write Windows signing config");
      expect(workflow).toContain("tauri.windows.signing.conf.json");
      expect(workflow).toContain(
        "npm run tauri:build:win -- --bundles nsis --config src-tauri/tauri.windows.signing.conf.json",
      );
      expect(workflow).toContain("Verify Windows installer Authenticode signature");
      expect(workflow).toContain("Get-AuthenticodeSignature");
    });
  }
});
