# TOS OTA Publish

This directory contains the local publish helper for Tauri updater artifacts.

## Environment

Copy `.env.ota.example` to ignored `.env.ota`, a local shell profile, or your preferred env tool. Do not commit filled credentials. If you use `.env.ota`, source it before running the publish command.

Required values:

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

`TOS_ACCESS_KEY` and `TOS_SECRET_KEY` are also accepted as aliases.

## Publish

Put signed release artifacts, `latest.json`, and `release-notes.md` in `release-artifacts/`, then run:

```bash
npm run ota:publish:tos
```

The script rewrites `latest.json` so platform URLs point to:

```text
https://qihang-ai.tos-cn-beijing.volces.com/codexmonitor/releases/<version>/<artifact>
```

It uploads the manifest to:

```text
https://qihang-ai.tos-cn-beijing.volces.com/codexmonitor/latest.json
```
