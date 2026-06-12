# OTA Release Runbook

This app uses the Tauri updater so installed desktop clients can update in app without asking users to download a new installer manually.

## Current Contract

- Update manifest endpoint: `https://qihang-ai.tos-cn-beijing.volces.com/codexmonitor/latest.json`
- Update artifact root: `https://qihang-ai.tos-cn-beijing.volces.com/codexmonitor/releases/<version>/`
- Release workflow: `.github/workflows/release.yml`
- Local TOS publish script: `scripts/ota/publish-tos.mjs`
- Client updater config: `src-tauri/tauri.conf.json`
- Updater public key: `src-tauri/tauri.conf.json > plugins.updater.pubkey`
- Updater artifacts: enabled with `bundle.createUpdaterArtifacts`

The release build creates signed updater artifacts and `latest.json`. The TOS publish script rewrites `latest.json` platform URLs to the public TOS release path, uploads all release artifacts under the versioned release prefix, and uploads the manifest to the stable `codexmonitor/latest.json` key. Installed clients read that manifest on update checks.

## Required Signing Secrets

Repository or release-environment secrets:

- `TAURI_SIGNING_PRIVATE_KEY_B64`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `WINDOWS_CERTIFICATE_B64`
- `WINDOWS_CERTIFICATE_PASSWORD`
- `WINDOWS_CERTIFICATE_THUMBPRINT`
- `APPLE_CERTIFICATE_P12`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER_ID`
- `APPLE_API_PRIVATE_KEY_B64`

Repository or release-environment variables:

- `CODESIGN_IDENTITY`
- `NOTARY_PROFILE_NAME`
- `APPLE_TEAM_ID`

`GITHUB_TOKEN` is provided by GitHub Actions.

## TOS Publish Environment

Set these environment variables locally or in the release environment before publishing:

```bash
export TOS_ACCESS_KEY_ID="..."
export TOS_SECRET_ACCESS_KEY="..."
export TOS_REGION="cn-beijing"
export TOS_ENDPOINT="tos-cn-beijing.volces.com"
export TOS_BUCKET="qihang-ai"
export TOS_PUBLIC_BASE_URL="https://qihang-ai.tos-cn-beijing.volces.com"
export OTA_PREFIX="codexmonitor"
export OTA_ARTIFACTS_DIR="release-artifacts"
```

The script also accepts the SDK aliases `TOS_ACCESS_KEY` and `TOS_SECRET_KEY`.

## One-Time Signing Setup

Generate the Tauri updater signing key once and keep the private key secret:

```bash
npm run tauri signer generate -- -w ~/.tauri/agentdesk.key
```

The public key printed by the command must match `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. Store the base64-encoded private key in GitHub:

```bash
base64 < ~/.tauri/agentdesk.key
```

Set that output as `TAURI_SIGNING_PRIVATE_KEY_B64`, and set the generation password as `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

For Windows release builds, export the Authenticode code signing certificate as
a password-protected `.pfx`, base64-encode it, and store it as
`WINDOWS_CERTIFICATE_B64`. Store the `.pfx` password in
`WINDOWS_CERTIFICATE_PASSWORD`, and store the certificate thumbprint without
spaces in `WINDOWS_CERTIFICATE_THUMBPRINT`. The Windows release job imports the
certificate into the current user's certificate store, writes a temporary Tauri
signing config, signs the NSIS installer with SHA-256 and a timestamp, and then
fails the workflow if `Get-AuthenticodeSignature` does not report a valid
signature from the expected certificate.

## Release Flow

1. Merge the release branch into `main`.
2. Confirm `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` have the same version.
3. Build the production release artifacts.
4. Place the artifacts, signatures, `latest.json`, and `release-notes.md` in `release-artifacts/`.
5. Run `npm run ota:publish:tos`.
6. Confirm `https://qihang-ai.tos-cn-beijing.volces.com/codexmonitor/latest.json` returns the published manifest.
7. Install the previous version locally, then use `Check for Updates...` to verify the app downloads, installs, and relaunches into `vX.Y.Z`.
8. Open a follow-up PR that bumps the repo to the next patch version after a successful release.

## Smoke Test Checklist

- `latest.json` is available at the configured TOS endpoint.
- Every `latest.json.platforms.*.url` points to `qihang-ai.tos-cn-beijing.volces.com/codexmonitor/releases/<version>/`.
- Every platform artifact referenced by `latest.json` has a matching signature.
- `release-notes.md` is available at `codexmonitor/releases/<version>/release-notes.md`.
- macOS app is signed, notarized, and stapled.
- Windows NSIS installer has a valid Authenticode signature from the expected
  certificate thumbprint.
- Existing installed client updates without visiting the download page.

## Important Notes

- Do not rotate the updater signing key casually. Existing installed clients trust the public key compiled into their app bundle.
- If the TOS bucket, prefix, or public domain changes, update `src-tauri/tauri.conf.json`, `src/features/update/utils/postUpdateRelease.ts`, and the publish environment.
- Tauri updater downloads a signed replacement package. The user experience is OTA even when the package is a full updater artifact rather than a binary diff.
- Keep TOS access keys outside the repo. Store them in local environment variables or release-environment secrets.
