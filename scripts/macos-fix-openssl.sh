#!/usr/bin/env bash
set -euo pipefail

app_path="${1:-src-tauri/target/release/bundle/macos/启航AI智慧平台.app}"
identity="${CODESIGN_IDENTITY:-}"
entitlements_path="${ENTITLEMENTS_PATH:-src-tauri/Entitlements.plist}"

if [[ -z "${identity}" ]]; then
  echo "CODESIGN_IDENTITY is required. Example:"
  echo "  CODESIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)' $0"
  exit 1
fi

if [[ ! -d "${app_path}" ]]; then
  echo "App bundle not found: ${app_path}"
  exit 1
fi

codesign_entitlements=()
if [[ -f "${entitlements_path}" ]]; then
  echo "Using entitlements: ${entitlements_path}"
  codesign_entitlements=(--entitlements "${entitlements_path}")
else
  echo "Warning: entitlements file not found at ${entitlements_path}; signing without entitlements."
fi

# When cross-compiling (e.g. target=x86_64 on an arm64 runner), the brew openssl
# dylibs available locally are host-arch and won't match the target binary.
# Skip the openssl bundling in that case — current builds use rustls + vendored
# openssl, so nothing actually links libssl/libcrypto at runtime anyway.
host_arch_raw="$(uname -m)"
case "${host_arch_raw}" in
  arm64) host_arch="aarch64" ;;
  *) host_arch="${host_arch_raw}" ;;
esac
target_arch="${MAC_TARGET_ARCH:-${host_arch}}"
bundle_openssl=1
if [[ "${target_arch}" != "${host_arch}" ]]; then
  echo "Skipping system OpenSSL bundling (target=${target_arch}, host=${host_arch})."
  bundle_openssl=0
fi

openssl_prefix=""
if [[ "${bundle_openssl}" -eq 1 ]] && command -v brew >/dev/null 2>&1; then
  openssl_prefix="$(brew --prefix openssl@3 2>/dev/null || true)"
fi
if [[ "${bundle_openssl}" -eq 1 && -z "${openssl_prefix}" ]]; then
  if [[ -d "/opt/homebrew/opt/openssl@3" ]]; then
    openssl_prefix="/opt/homebrew/opt/openssl@3"
  elif [[ -d "/usr/local/opt/openssl@3" ]]; then
    openssl_prefix="/usr/local/opt/openssl@3"
  fi
fi

if [[ "${bundle_openssl}" -eq 1 && -z "${openssl_prefix}" ]]; then
  echo "OpenSSL@3 not found. Install it with Homebrew first."
  exit 1
fi

frameworks_dir="${app_path}/Contents/Frameworks"
bin_path="${app_path}/Contents/MacOS/agentdesk"
daemon_path="${app_path}/Contents/MacOS/agentdesk-daemon"
daemonctl_path="${app_path}/Contents/MacOS/agentdesk-daemonctl"
daemon_source="${DAEMON_BINARY_PATH:-src-tauri/target/release/agentdesk-daemon}"
daemonctl_source="${DAEMONCTL_BINARY_PATH:-src-tauri/target/release/agentdesk-daemonctl}"

sync_embedded_binary() {
  local source_path="$1"
  local destination_path="$2"
  local label="$3"

  if [[ -f "${source_path}" ]]; then
    cp -f "${source_path}" "${destination_path}"
    chmod +x "${destination_path}"
    echo "Bundled ${label} binary from ${source_path}"
  else
    echo "Warning: ${label} binary not found in app or at ${source_path}"
  fi
}

sync_embedded_binary "${daemon_source}" "${daemon_path}" "daemon"
sync_embedded_binary "${daemonctl_source}" "${daemonctl_path}" "daemonctl"

if [[ "${bundle_openssl}" -eq 1 ]]; then
  libssl="${openssl_prefix}/lib/libssl.3.dylib"
  libcrypto="${openssl_prefix}/lib/libcrypto.3.dylib"

  if [[ ! -f "${libssl}" || ! -f "${libcrypto}" ]]; then
    echo "OpenSSL dylibs not found at ${openssl_prefix}/lib"
    exit 1
  fi

  mkdir -p "${frameworks_dir}"
  cp -f "${libssl}" "${frameworks_dir}/"
  cp -f "${libcrypto}" "${frameworks_dir}/"

  install_name_tool -id "@rpath/libssl.3.dylib" "${frameworks_dir}/libssl.3.dylib"
  install_name_tool -id "@rpath/libcrypto.3.dylib" "${frameworks_dir}/libcrypto.3.dylib"
  for candidate in \
    "${libcrypto}" \
    "/opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib" \
    "/usr/local/opt/openssl@3/lib/libcrypto.3.dylib" \
    "/opt/homebrew/Cellar/openssl@3/3.6.0/lib/libcrypto.3.dylib" \
    "/usr/local/Cellar/openssl@3/3.6.0/lib/libcrypto.3.dylib"
  do
    install_name_tool -change "${candidate}" "@rpath/libcrypto.3.dylib" "${frameworks_dir}/libssl.3.dylib" 2>/dev/null || true
  done

  for candidate in \
    "${libssl}" \
    "/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib" \
    "/usr/local/opt/openssl@3/lib/libssl.3.dylib"
  do
    install_name_tool -change "${candidate}" "@rpath/libssl.3.dylib" "${bin_path}" 2>/dev/null || true
  done

  for candidate in \
    "${libcrypto}" \
    "/opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib" \
    "/usr/local/opt/openssl@3/lib/libcrypto.3.dylib"
  do
    install_name_tool -change "${candidate}" "@rpath/libcrypto.3.dylib" "${bin_path}" 2>/dev/null || true
  done

  if ! otool -l "${bin_path}" | { command -v rg >/dev/null 2>&1 && rg -q "@executable_path/../Frameworks" || grep -q "@executable_path/../Frameworks"; }; then
    install_name_tool -add_rpath "@executable_path/../Frameworks" "${bin_path}"
  fi

  codesign --force --options runtime --timestamp --sign "${identity}" "${frameworks_dir}/libcrypto.3.dylib"
  codesign --force --options runtime --timestamp --sign "${identity}" "${frameworks_dir}/libssl.3.dylib"
fi

# Codesign every executable under Contents/MacOS — Tauri doesn't auto-sign
# secondary binaries (codex-runtime, codex_monitor_daemon{,ctl} aliases),
# so notarize would reject the .app without these.
shopt -s nullglob
for macho in "${app_path}/Contents/MacOS"/*; do
  if [[ -f "${macho}" && -x "${macho}" ]]; then
    codesign --force --options runtime --timestamp --sign "${identity}" "${codesign_entitlements[@]}" "${macho}"
  fi
done
shopt -u nullglob
codesign --force --options runtime --timestamp --sign "${identity}" "${codesign_entitlements[@]}" "${app_path}"

if [[ "${bundle_openssl}" -eq 1 ]]; then
  echo "Bundled OpenSSL dylibs and re-signed ${app_path}"
else
  echo "Synced embedded binaries and re-signed ${app_path} (OpenSSL bundling skipped)"
fi
