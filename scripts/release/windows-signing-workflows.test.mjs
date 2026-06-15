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
      expect(workflow).toMatch(
        /npm run (?:tauri:build:win -- --bundles nsis --config src-tauri\/tauri\.windows\.signing\.conf\.json|tauri -- build --config src-tauri\/tauri\.windows\.conf\.json --bundles nsis --config src-tauri\/tauri\.windows\.signing\.conf\.json)/,
      );
      expect(workflow).toContain("Verify Windows installer Authenticode signature");
      expect(workflow).toContain("Get-AuthenticodeSignature");
    });
  }
});

describe("release workflow Git sidecars", () => {
  it("builds macOS targets on matching GitHub runner architectures", () => {
    const workflow = readWorkflow(".github/workflows/release.yml");

    expect(workflow).toContain("runs-on: ${{ matrix.os }}");
    expect(workflow).toContain("target: aarch64-apple-darwin");
    expect(workflow).toContain("os: macos-latest");
    expect(workflow).toContain("target: x86_64-apple-darwin");
    expect(workflow).toContain("os: macos-15-intel");
  });

  it("prepares target-specific bundled Git resources before release builds", () => {
    const workflow = readWorkflow(".github/workflows/release.yml");

    expect(workflow).toContain("Prepare macOS bundled Git");
    expect(workflow).toContain("AGENTDESK_GIT_TARGET: ${{ matrix.target }}");
    expect(workflow).toContain("npm run sync:git-sidecar");
    expect(workflow).toContain("Remove-Item -Path $resourcesRoot -Recurse -Force");
    expect(workflow).toContain("Join-Path $resourcesRoot $target");
    expect(workflow).toContain("$unusedLaunchers = @(");
    expect(workflow).toContain('"git-bash.exe"');
    expect(workflow).toContain("Remove-Item -Path (Join-Path $resourceDir $pattern)");
  });

  it("prints notarization rejection logs before stapling macOS apps", () => {
    const workflow = readWorkflow(".github/workflows/release.yml");

    expect(workflow).toContain("--output-format json");
    expect(workflow).toContain('notary_status=$(python3 -c');
    expect(workflow).toContain('[ "$notary_status" != "Accepted" ]');
    expect(workflow).toContain("xcrun notarytool log");
    expect(workflow.indexOf("xcrun notarytool log")).toBeLessThan(
      workflow.indexOf("xcrun stapler staple"),
    );
  });
});

describe("macOS release signing script", () => {
  it("re-signs embedded Git Mach-O resources before signing the app bundle", () => {
    const script = readFileSync(
      join(repoRoot.pathname, "scripts/macos-fix-openssl.sh"),
      "utf8",
    );

    expect(script).toContain("sign_embedded_macho_tree");
    expect(script).toContain('${app_path}/Contents/Resources/resources/git');
    expect(script.indexOf("sign_embedded_macho_tree")).toBeLessThan(
      script.indexOf('codesign --force --options runtime --timestamp --sign "${identity}" "${codesign_entitlements[@]}" "${app_path}"'),
    );
  });
});
