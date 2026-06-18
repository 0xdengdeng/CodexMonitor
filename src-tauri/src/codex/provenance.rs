//! Provenance of the bundled `codex-runtime`, embedded at build time by
//! `build.rs` from the sync manifest. Logged at startup so packaging/path drift
//! (a stale, dirty, or mismatched runtime) is visible instead of silent.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProvenanceLevel {
    Info,
    Warn,
}

pub(crate) struct CodexRuntimeProvenance {
    pub commit: &'static str,
    pub dirty: &'static str,
    pub profile: &'static str,
    pub generated_at: &'static str,
    pub triple: &'static str,
}

/// The provenance baked into this binary. `option_env!` degrades to "unknown"
/// rather than failing to compile if an older build.rs didn't emit a field.
pub(crate) fn embedded_provenance() -> CodexRuntimeProvenance {
    CodexRuntimeProvenance {
        commit: option_env!("AGENTDESK_CODEX_RUNTIME_COMMIT").unwrap_or("unknown"),
        dirty: option_env!("AGENTDESK_CODEX_RUNTIME_DIRTY").unwrap_or("unknown"),
        profile: option_env!("AGENTDESK_CODEX_RUNTIME_PROFILE").unwrap_or("unknown"),
        generated_at: option_env!("AGENTDESK_CODEX_RUNTIME_GENERATED_AT").unwrap_or("unknown"),
        triple: option_env!("AGENTDESK_CODEX_RUNTIME_TRIPLE").unwrap_or("unknown"),
    }
}

/// Classify the embedded provenance into a log level + message. Pure so the
/// drift rules are unit-tested without a build. `app_is_release` is the AgentDesk
/// build profile, not the runtime's: a release app that shipped an unknown,
/// dirty, or non-release runtime is a packaging-drift smell worth a loud warning,
/// while a dev build is expected to bundle a dirty/debug runtime.
pub(crate) fn provenance_report(
    provenance: &CodexRuntimeProvenance,
    app_is_release: bool,
) -> (ProvenanceLevel, String) {
    let base = format!(
        "codex-runtime provenance: commit={} dirty={} profile={} triple={} generated_at={}",
        provenance.commit,
        provenance.dirty,
        provenance.profile,
        provenance.triple,
        provenance.generated_at
    );

    if provenance.commit == "unknown" {
        return (
            ProvenanceLevel::Warn,
            format!(
                "{base} — manifest was missing at build time; the bundled runtime is unverifiable. Run `npm run sync:codex-runtime` before building."
            ),
        );
    }

    if app_is_release {
        if provenance.dirty == "true" {
            return (
                ProvenanceLevel::Warn,
                format!("{base} — RELEASE app bundled a runtime built from a DIRTY Codex tree."),
            );
        }
        if provenance.profile != "release" {
            return (
                ProvenanceLevel::Warn,
                format!(
                    "{base} — RELEASE app bundled a NON-release ({}) runtime.",
                    provenance.profile
                ),
            );
        }
    }

    (ProvenanceLevel::Info, base)
}

/// Print the bundled runtime provenance at startup. `debug_assertions` is the
/// app's own build profile, so release bundles are held to the stricter rules.
pub(crate) fn log_codex_runtime_provenance() {
    let provenance = embedded_provenance();
    let app_is_release = !cfg!(debug_assertions);
    let (level, message) = provenance_report(&provenance, app_is_release);
    match level {
        ProvenanceLevel::Info => log::info!(target: "agentdesk::runtime", "{message}"),
        ProvenanceLevel::Warn => log::warn!(target: "agentdesk::runtime", "{message}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provenance(commit: &'static str, dirty: &'static str, profile: &'static str) -> CodexRuntimeProvenance {
        CodexRuntimeProvenance {
            commit,
            dirty,
            profile,
            generated_at: "2026-06-18T00:00:00Z",
            triple: "aarch64-apple-darwin",
        }
    }

    #[test]
    fn clean_release_runtime_in_release_app_is_info() {
        let (level, _) = provenance_report(&provenance("abc123", "false", "release"), true);
        assert_eq!(level, ProvenanceLevel::Info);
    }

    #[test]
    fn unknown_provenance_is_warn_even_in_dev() {
        let (level, message) = provenance_report(&provenance("unknown", "unknown", "unknown"), false);
        assert_eq!(level, ProvenanceLevel::Warn);
        assert!(message.contains("sync:codex-runtime"));
    }

    #[test]
    fn dirty_runtime_in_release_app_is_warn() {
        let (level, message) = provenance_report(&provenance("abc123", "true", "release"), true);
        assert_eq!(level, ProvenanceLevel::Warn);
        assert!(message.contains("DIRTY"));
    }

    #[test]
    fn debug_runtime_in_release_app_is_warn() {
        let (level, message) = provenance_report(&provenance("abc123", "false", "debug"), true);
        assert_eq!(level, ProvenanceLevel::Warn);
        assert!(message.contains("NON-release"));
    }

    #[test]
    fn dirty_debug_runtime_in_dev_app_is_info() {
        // Dev builds legitimately bundle a dirty/debug runtime; do not cry wolf.
        let (level, _) = provenance_report(&provenance("abc123", "true", "debug"), false);
        assert_eq!(level, ProvenanceLevel::Info);
    }
}
