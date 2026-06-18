fn main() {
    tauri_build::build();

    emit_codex_runtime_provenance();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        println!("cargo:rustc-link-lib=z");
        println!("cargo:rustc-link-lib=iconv");
    }
}

/// Embed the bundled codex-runtime's provenance (from the manifest that
/// `scripts/sync-codex-runtime.mjs` writes next to the binary) into the app
/// binary so the running app can report and validate which runtime it shipped
/// with. This turns packaging/path drift — a stale or mismatched runtime — into
/// something visible at startup instead of a silent behavior shift. Never fails
/// the build: a missing or unreadable manifest degrades every field to "unknown",
/// which the runtime side reports as a loud warning.
fn emit_codex_runtime_provenance() {
    let triple = std::env::var("TARGET").unwrap_or_default();
    let manifest_path = format!("binaries/codex-runtime-{triple}.json");
    println!("cargo:rerun-if-changed={manifest_path}");

    let contents = std::fs::read_to_string(&manifest_path).unwrap_or_default();
    let string_field =
        |key: &str| json_string_field(&contents, key).unwrap_or_else(|| "unknown".to_string());
    let dirty = json_bool_field(&contents, "sourceDirty")
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // A raw newline in a value would split the `cargo:rustc-env=KEY=VALUE`
    // directive and corrupt the build. The project's own manifest never produces
    // one, but strip CR/LF defensively so a hand-edited/external manifest can't
    // break compilation.
    let emit = |key: &str, value: &str| {
        let sanitized: String = value.chars().filter(|ch| *ch != '\n' && *ch != '\r').collect();
        println!("cargo:rustc-env={key}={sanitized}");
    };

    emit("AGENTDESK_CODEX_RUNTIME_COMMIT", &string_field("sourceCommit"));
    emit("AGENTDESK_CODEX_RUNTIME_DIRTY", &dirty);
    emit("AGENTDESK_CODEX_RUNTIME_PROFILE", &string_field("profile"));
    emit("AGENTDESK_CODEX_RUNTIME_GENERATED_AT", &string_field("generatedAt"));
    emit("AGENTDESK_CODEX_RUNTIME_TRIPLE", &string_field("targetTriple"));
}

/// Minimal `"key": "value"` extractor for the flat runtime manifest — avoids a
/// build-dependency on a JSON parser for five trusted, locally-generated fields.
fn json_string_field(contents: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let after_key = &contents[contents.find(&needle)? + needle.len()..];
    let after_colon = &after_key[after_key.find(':')? + 1..];
    let after_open_quote = &after_colon[after_colon.find('"')? + 1..];
    let end = after_open_quote.find('"')?;
    Some(after_open_quote[..end].to_string())
}

fn json_bool_field(contents: &str, key: &str) -> Option<bool> {
    let needle = format!("\"{key}\"");
    let after_key = &contents[contents.find(&needle)? + needle.len()..];
    let after_colon = after_key[after_key.find(':')? + 1..].trim_start();
    if after_colon.starts_with("true") {
        Some(true)
    } else if after_colon.starts_with("false") {
        Some(false)
    } else {
        None
    }
}
