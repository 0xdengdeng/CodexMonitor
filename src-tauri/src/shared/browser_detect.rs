//! No-Chrome detection (docs/browser-no-chrome-design.md §2).
//!
//! Pure OS-path probe of the **standard locations `@playwright/mcp`'s channel resolver checks**, so
//! "found here" ⟺ "`--browser <channel>` will actually launch" — no false positive/negative vs the
//! real launch. No subprocess, no node spawn. Decisions locked 2026-06-25: Rust probe (not a node
//! spawn); channels chrome → msedge only; no managed-Chromium download (guide the user to install
//! Chrome when neither is present). The fallback/guide UX lives in the settings + SPA layers; this
//! module only answers "which channel, if any".

use std::path::{Path, PathBuf};

/// Which browser the managed Playwright MCP should launch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum BrowserReadiness {
    /// A system Chromium-family browser is installed → launch with `--browser <channel>`.
    SystemChannel(&'static str),
    /// Neither chrome nor msedge is installed → guide the user to install Chrome; do not enable.
    NoBrowser,
}

/// Probe order, first hit wins: system chrome → system msedge → none.
pub(crate) fn detect_browser_readiness() -> BrowserReadiness {
    detect_with(|p| p.exists(), path_has_any)
}

/// Core detection with injectable predicates so unit tests stay hermetic (no real FS / `PATH`).
/// `exists` answers "is this absolute executable path present?"; `on_path` answers "is any of these
/// binary names on `PATH`?" (the Linux install shape, where Chrome is usually just `google-chrome`).
fn detect_with(
    exists: impl Fn(&Path) -> bool,
    on_path: impl Fn(&[&str]) -> bool,
) -> BrowserReadiness {
    if chrome_paths().iter().any(|p| exists(p))
        || on_path(&["google-chrome", "google-chrome-stable"])
    {
        BrowserReadiness::SystemChannel("chrome")
    } else if msedge_paths().iter().any(|p| exists(p))
        || on_path(&["microsoft-edge", "microsoft-edge-stable"])
    {
        BrowserReadiness::SystemChannel("msedge")
    } else {
        BrowserReadiness::NoBrowser
    }
}

#[cfg(target_os = "macos")]
fn chrome_paths() -> Vec<PathBuf> {
    vec![PathBuf::from(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    )]
}
#[cfg(target_os = "macos")]
fn msedge_paths() -> Vec<PathBuf> {
    vec![PathBuf::from(
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    )]
}

#[cfg(target_os = "windows")]
fn windows_roots() -> Vec<PathBuf> {
    // Playwright probes chrome AND msedge under the same three roots.
    ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(|k| std::env::var_os(k))
        .map(PathBuf::from)
        .collect()
}
#[cfg(target_os = "windows")]
fn chrome_paths() -> Vec<PathBuf> {
    windows_roots()
        .into_iter()
        .map(|r| r.join(r"Google\Chrome\Application\chrome.exe"))
        .collect()
}
#[cfg(target_os = "windows")]
fn msedge_paths() -> Vec<PathBuf> {
    windows_roots()
        .into_iter()
        .map(|r| r.join(r"Microsoft\Edge\Application\msedge.exe"))
        .collect()
}

#[cfg(target_os = "linux")]
fn chrome_paths() -> Vec<PathBuf> {
    vec![PathBuf::from("/opt/google/chrome/chrome")]
}
#[cfg(target_os = "linux")]
fn msedge_paths() -> Vec<PathBuf> {
    vec![PathBuf::from("/opt/microsoft/msedge/msedge")]
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn chrome_paths() -> Vec<PathBuf> {
    Vec::new()
}
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn msedge_paths() -> Vec<PathBuf> {
    Vec::new()
}

/// Real `$PATH` lookup: any of `names` present as a file in any `PATH` directory.
fn path_has_any(names: &[&str]) -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path).any(|dir| names.iter().any(|n| dir.join(n).exists()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn never_on_path(_: &[&str]) -> bool {
        false
    }

    #[test]
    fn no_browser_when_nothing_found() {
        assert_eq!(
            detect_with(|_| false, never_on_path),
            BrowserReadiness::NoBrowser
        );
    }

    #[test]
    fn chrome_when_a_chrome_path_exists() {
        let chrome = chrome_paths();
        let r = detect_with(|p| chrome.iter().any(|c| c == p), never_on_path);
        assert_eq!(r, BrowserReadiness::SystemChannel("chrome"));
    }

    #[test]
    fn msedge_when_only_edge_path_exists() {
        let edge = msedge_paths();
        let r = detect_with(|p| edge.iter().any(|c| c == p), never_on_path);
        assert_eq!(r, BrowserReadiness::SystemChannel("msedge"));
    }

    #[test]
    fn chrome_preferred_when_both_exist() {
        // every path "exists" → chrome is probed first and wins
        assert_eq!(
            detect_with(|_| true, never_on_path),
            BrowserReadiness::SystemChannel("chrome")
        );
    }

    #[test]
    fn chrome_detected_via_path_lookup_when_no_fixed_path() {
        let r = detect_with(|_| false, |names| names.contains(&"google-chrome"));
        assert_eq!(r, BrowserReadiness::SystemChannel("chrome"));
    }

    #[test]
    fn msedge_detected_via_path_lookup() {
        let r = detect_with(|_| false, |names| names.contains(&"microsoft-edge"));
        assert_eq!(r, BrowserReadiness::SystemChannel("msedge"));
    }

    #[test]
    fn real_detection_does_not_panic() {
        // Smoke: the real probe against this machine must not panic (result is machine-dependent).
        let _ = detect_browser_readiness();
    }
}
