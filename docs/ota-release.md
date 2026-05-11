# OTA Release Runbook

This app uses the Tauri updater so installed desktop clients can update in app without asking users to download a new installer manually.

## Current Contract

- Update manifest endpoint: `https://github.com/0xdengdeng/CodexMonitor/releases/latest/download/latest.json`
- Release workflow: `.github/workflows/release.yml`
- Client updater config: `src-tauri/tauri.conf.json`
- Updater public key: `src-tauri/tauri.conf.json > plugins.updater.pubkey`
- Updater artifacts: enabled with `bundle.createUpdaterArtifacts`

The release workflow builds signed artifacts, creates `latest.json`, uploads it to the GitHub Release, and the installed client reads that manifest on update checks.

## Required GitHub Release Secrets

Repository or release-environment secrets:

- `TAURI_SIGNING_PRIVATE_KEY_B64`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
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

## Release Flow

1. Merge the release branch into `main`.
2. Confirm `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` have the same version.
3. Run the GitHub Actions `Release` workflow manually from `main`.
4. Confirm the workflow publishes a GitHub Release named `vX.Y.Z`.
5. Confirm the Release contains `latest.json` and signed platform artifacts.
6. Install the previous version locally, then use `Check for Updates...` to verify the app downloads, installs, and relaunches into `vX.Y.Z`.

The workflow opens a follow-up PR that bumps the repo to the next patch version after a successful release.

## Smoke Test Checklist

- `latest.json` is available at the configured `/releases/latest/download/latest.json` endpoint.
- Every `latest.json.platforms.*.url` points to `0xdengdeng/CodexMonitor`.
- Every platform artifact referenced by `latest.json` has a matching signature.
- macOS app is signed, notarized, and stapled.
- Existing installed client updates without visiting the download page.

## Important Notes

- Do not rotate the updater signing key casually. Existing installed clients trust the public key compiled into their app bundle.
- If the release repository changes, update both `src-tauri/tauri.conf.json` and `.github/workflows/release.yml`.
- Tauri updater downloads a signed replacement package. The user experience is OTA even when the package is a full updater artifact rather than a binary diff.
