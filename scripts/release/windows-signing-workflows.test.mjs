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
    expect(workflow).toContain('normalized="${normalized//启航AI智慧平台/QihangAI}"');
    expect(workflow).toContain("find release-artifacts -type f -print0");
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

describe("release manifest gate", () => {
  it("does not publish the stable OTA manifest from package release workflows", () => {
    for (const workflowPath of workflowPaths) {
      const workflow = readWorkflow(workflowPath);

      expect(workflow).not.toContain("npm run ota:publish:tos");
      expect(workflow).not.toContain("Publish latest.json to TOS");
      expect(workflow).not.toContain("Publish to TOS");
    }
  });

  it("provides a dedicated workflow for switching the stable OTA manifest", () => {
    const workflow = readWorkflow(".github/workflows/publish-ota-manifest.yml");

    expect(workflow).toContain("name: Publish OTA Manifest");
    expect(workflow).toContain("workflow_dispatch");
    expect(workflow).toContain("gh release download");
    expect(workflow).toContain("npm run ota:publish:tos");
    expect(workflow).toContain("TOS_UPLOAD_REFERENCED_ARTIFACTS: \"false\"");
  });

  it("keeps test and stable builds on the same updater endpoint", () => {
    const baseConfig = JSON.parse(readWorkflow("src-tauri/tauri.conf.json"));
    const betaConfig = JSON.parse(readWorkflow("src-tauri/tauri.beta.conf.json"));

    expect(betaConfig.plugins?.updater?.endpoints).toBeUndefined();
    expect(baseConfig.plugins.updater.endpoints).toEqual([
      "https://qihang-ai.tos-cn-beijing.volces.com/codexmonitor/latest.json",
    ]);
  });

  it("does not publish a separate beta OTA manifest", () => {
    const workflow = readWorkflow(".github/workflows/publish-ota-manifest.yml");

    expect(workflow).toContain('gh release download "v${RELEASE_TAG}"');
    expect(workflow).toContain('EXPECTED_MANIFEST_VERSION="${VERSION%-beta}"');
    expect(workflow).toContain("OTA_PREFIX: codexmonitor");
    expect(workflow).not.toContain("codexmonitor/beta");
    expect(workflow).not.toContain("TAG_SUFFIX");
    expect(workflow).not.toContain("channel:");
  });

  it("marks beta GitHub releases as prereleases", () => {
    const workflow = readWorkflow(".github/workflows/release.yml");

    expect(workflow).toContain('if [ "${CHANNEL}" = "beta" ]; then');
    expect(workflow).toContain("release_flags+=(--prerelease)");
  });

  it("builds beta releases with a beta identity instead of local dev identity", () => {
    const workflow = readWorkflow(".github/workflows/release.yml");

    expect(workflow).toContain("启航AI智慧平台 Beta");
    expect(workflow).toContain("--config src-tauri/tauri.beta.conf.json");
    expect(workflow).not.toContain("inputs.channel == 'beta' && '--config src-tauri/tauri.dev.conf.json'");
  });

  it("adds an Applications shortcut to macOS DMG images", () => {
    const workflow = readWorkflow(".github/workflows/release.yml");
    const shortcutCommand = 'ln -s /Applications "release-artifacts/dmg-root/Applications"';

    expect(workflow).toContain(shortcutCommand);
    expect(workflow.indexOf(shortcutCommand)).toBeLessThan(
      workflow.indexOf('hdiutil create -volname "${PRODUCT_NAME}"'),
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
