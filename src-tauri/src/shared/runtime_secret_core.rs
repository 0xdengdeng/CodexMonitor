use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub(crate) const RUNTIME_API_KEY_ENV_KEY: &str = "AGENTDESK_RUNTIME_API_KEY";
pub(crate) const ADG_DEPLOY_TOKEN_ENV_KEY: &str = "AGENTDESK_ADG_DEPLOY_TOKEN";

const KEY_FILE_NAME: &str = "runtime-secret.key";
const RUNTIME_SECRET_FILE_NAME: &str = "runtime-secret.json";
const DEPLOY_TOKEN_FILE_NAME: &str = "adg-deploy-token.json";
const SECRET_FILE_VERSION: u8 = 1;

static RUNTIME_SECRET_DIR: OnceLock<PathBuf> = OnceLock::new();
static RUNTIME_API_KEY_CACHE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static ADG_DEPLOY_TOKEN_CACHE: OnceLock<Mutex<Option<String>>> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize)]
struct RuntimeSecretFile {
    version: u8,
    nonce: String,
    ciphertext: String,
}

fn cache_cell(cell: &'static OnceLock<Mutex<Option<String>>>) -> &'static Mutex<Option<String>> {
    cell.get_or_init(|| Mutex::new(None))
}

fn normalize_secret(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn secret_from_env(env_key: &str) -> Option<String> {
    std::env::var(env_key)
        .ok()
        .and_then(|value| normalize_secret(&value))
}

pub(crate) fn configure_runtime_secret_store(data_dir: &Path) -> Result<(), String> {
    let secret_dir = data_dir.join("secrets");
    fs::create_dir_all(&secret_dir).map_err(|err| {
        format!(
            "Failed to create AgentDesk runtime secret directory at {}: {err}",
            secret_dir.display()
        )
    })?;
    restrict_directory_permissions(&secret_dir)?;
    let _ = RUNTIME_SECRET_DIR.set(secret_dir);
    Ok(())
}

fn secret_dir() -> Result<PathBuf, String> {
    if let Some(path) = RUNTIME_SECRET_DIR.get() {
        return Ok(path.clone());
    }
    let fallback = std::env::current_dir()
        .map_err(|err| format!("Failed to resolve current directory: {err}"))?
        .join(".agentdesk")
        .join("secrets");
    fs::create_dir_all(&fallback).map_err(|err| {
        format!(
            "Failed to create AgentDesk runtime secret fallback directory at {}: {err}",
            fallback.display()
        )
    })?;
    restrict_directory_permissions(&fallback)?;
    Ok(fallback)
}

fn key_path() -> Result<PathBuf, String> {
    Ok(secret_dir()?.join(KEY_FILE_NAME))
}

fn named_secret_path(file_name: &str) -> Result<PathBuf, String> {
    Ok(secret_dir()?.join(file_name))
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut out = [0_u8; N];
    let mut offset = 0;
    while offset < N {
        let bytes = *Uuid::new_v4().as_bytes();
        let len = (N - offset).min(bytes.len());
        out[offset..offset + len].copy_from_slice(&bytes[..len]);
        offset += len;
    }
    out
}

fn read_or_create_key() -> Result<[u8; 32], String> {
    let path = key_path()?;
    if path.exists() {
        let encoded = fs::read_to_string(&path).map_err(|err| {
            format!(
                "Failed to read AgentDesk runtime secret key at {}: {err}",
                path.display()
            )
        })?;
        let bytes = STANDARD.decode(encoded.trim()).map_err(|err| {
            format!(
                "Failed to decode AgentDesk runtime secret key at {}: {err}",
                path.display()
            )
        })?;
        return bytes
            .try_into()
            .map_err(|_| "AgentDesk runtime secret key has invalid length.".to_string());
    }

    let key = random_bytes::<32>();
    write_secret_file(&path, &STANDARD.encode(key))?;
    Ok(key)
}

fn read_existing_key() -> Result<Option<[u8; 32]>, String> {
    let path = key_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let encoded = fs::read_to_string(&path).map_err(|err| {
        format!(
            "Failed to read AgentDesk runtime secret key at {}: {err}",
            path.display()
        )
    })?;
    let bytes = STANDARD.decode(encoded.trim()).map_err(|err| {
        format!(
            "Failed to decode AgentDesk runtime secret key at {}: {err}",
            path.display()
        )
    })?;
    Ok(Some(bytes.try_into().map_err(|_| {
        "AgentDesk runtime secret key has invalid length.".to_string()
    })?))
}

/// Decrypt a single named secret file (no env/cache layering). Returns Ok(None) when the
/// file is absent. Shared by the runtime API key and the ADG deploy token — they reuse the
/// same AES key file but live in separate ciphertext files.
fn read_named_secret(file_name: &str) -> Result<Option<String>, String> {
    let path = named_secret_path(file_name)?;
    if !path.exists() {
        return Ok(None);
    }
    let Some(key) = read_existing_key()? else {
        return Err("AgentDesk runtime secret key is missing.".to_string());
    };
    let file: RuntimeSecretFile = serde_json::from_slice(&fs::read(&path).map_err(|err| {
        format!("Failed to read AgentDesk secret at {}: {err}", path.display())
    })?)
    .map_err(|err| {
        format!(
            "Failed to parse AgentDesk secret at {}: {err}",
            path.display()
        )
    })?;
    if file.version != SECRET_FILE_VERSION {
        return Err("AgentDesk secret file version is unsupported.".to_string());
    }
    let nonce_bytes: [u8; 12] = STANDARD
        .decode(file.nonce)
        .map_err(|err| {
            format!(
                "Failed to decode AgentDesk secret nonce at {}: {err}",
                path.display()
            )
        })?
        .try_into()
        .map_err(|_| "AgentDesk secret nonce has invalid length.".to_string())?;
    let ciphertext = STANDARD.decode(file.ciphertext).map_err(|err| {
        format!(
            "Failed to decode AgentDesk secret payload at {}: {err}",
            path.display()
        )
    })?;
    let plaintext = Aes256Gcm::new_from_slice(&key)
        .map_err(|err| format!("Failed to initialize AgentDesk secret cipher: {err}"))?
        .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
        .map_err(|_| "Failed to decrypt AgentDesk secret.".to_string())?;
    let value = String::from_utf8(plaintext)
        .map_err(|_| "AgentDesk secret is not valid UTF-8.".to_string())?;
    Ok(normalize_secret(&value))
}

/// Encrypt and persist a single named secret file (overwrites). The plaintext is assumed
/// already validated/trimmed by the caller.
fn write_named_secret(file_name: &str, value: &str) -> Result<(), String> {
    let key = read_or_create_key()?;
    let nonce = random_bytes::<12>();
    let ciphertext = Aes256Gcm::new_from_slice(&key)
        .map_err(|err| format!("Failed to initialize AgentDesk secret cipher: {err}"))?
        .encrypt(Nonce::from_slice(&nonce), value.as_bytes())
        .map_err(|_| "Failed to encrypt AgentDesk secret.".to_string())?;
    let file = RuntimeSecretFile {
        version: SECRET_FILE_VERSION,
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
    };
    let bytes = serde_json::to_vec_pretty(&file)
        .map_err(|err| format!("Failed to encode AgentDesk secret: {err}"))?;
    let path = named_secret_path(file_name)?;
    write_secret_file(&path, &String::from_utf8_lossy(&bytes))
}

fn clear_named_secret(file_name: &str) -> Result<(), String> {
    let path = named_secret_path(file_name)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!(
            "Failed to clear AgentDesk secret at {}: {err}",
            path.display()
        )),
    }
}

/// Resolve a secret with precedence env > in-memory cache > encrypted file (then cache it).
fn get_secret(
    env_key: &str,
    file_name: &str,
    cache: &'static OnceLock<Mutex<Option<String>>>,
) -> Result<Option<String>, String> {
    if let Some(value) = secret_from_env(env_key) {
        return Ok(Some(value));
    }
    if let Some(value) = cache_cell(cache)
        .lock()
        .map_err(|_| "AgentDesk secret cache is unavailable.".to_string())?
        .clone()
    {
        return Ok(Some(value));
    }
    let Some(value) = read_named_secret(file_name)? else {
        return Ok(None);
    };
    *cache_cell(cache)
        .lock()
        .map_err(|_| "AgentDesk secret cache is unavailable.".to_string())? = Some(value.clone());
    Ok(Some(value))
}

fn secret_exists(
    env_key: &str,
    file_name: &str,
    cache: &'static OnceLock<Mutex<Option<String>>>,
) -> Result<bool, String> {
    if secret_from_env(env_key).is_some() {
        return Ok(true);
    }
    if cache_cell(cache)
        .lock()
        .map_err(|_| "AgentDesk secret cache is unavailable.".to_string())?
        .is_some()
    {
        return Ok(true);
    }
    Ok(named_secret_path(file_name)?.exists())
}

fn set_secret(
    file_name: &str,
    cache: &'static OnceLock<Mutex<Option<String>>>,
    value: String,
) -> Result<(), String> {
    write_named_secret(file_name, &value)?;
    *cache_cell(cache)
        .lock()
        .map_err(|_| "AgentDesk secret cache is unavailable.".to_string())? = Some(value);
    Ok(())
}

fn clear_secret(
    file_name: &str,
    cache: &'static OnceLock<Mutex<Option<String>>>,
) -> Result<(), String> {
    clear_named_secret(file_name)?;
    *cache_cell(cache)
        .lock()
        .map_err(|_| "AgentDesk secret cache is unavailable.".to_string())? = None;
    Ok(())
}

// ---- Runtime API key (sk-adg_*, the LLM dispatch key) ----

pub(crate) fn get_runtime_api_key() -> Result<Option<String>, String> {
    get_secret(
        RUNTIME_API_KEY_ENV_KEY,
        RUNTIME_SECRET_FILE_NAME,
        &RUNTIME_API_KEY_CACHE,
    )
}

pub(crate) fn runtime_api_key_exists() -> Result<bool, String> {
    secret_exists(
        RUNTIME_API_KEY_ENV_KEY,
        RUNTIME_SECRET_FILE_NAME,
        &RUNTIME_API_KEY_CACHE,
    )
}

pub(crate) fn set_runtime_api_key(value: &str) -> Result<(), String> {
    let Some(trimmed) = normalize_secret(value) else {
        return Err("Runtime API key cannot be empty.".to_string());
    };
    set_secret(RUNTIME_SECRET_FILE_NAME, &RUNTIME_API_KEY_CACHE, trimmed)
}

pub(crate) fn clear_runtime_api_key() -> Result<(), String> {
    clear_secret(RUNTIME_SECRET_FILE_NAME, &RUNTIME_API_KEY_CACHE)
}

// ---- ADG deploy token (sk-adgd_*, the deploy plugin's Bearer credential) ----

/// Validate a deploy token's shape. Deliberately NOT reusing `ensure_adg_api_key`: the deploy
/// token prefix is `sk-adgd_` which does NOT match `sk-adg_` (7th char `d` vs `_`).
#[allow(dead_code)]
pub(crate) fn ensure_adg_deploy_token(token: &str) -> Result<&str, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("部署令牌不能为空。".to_string());
    }
    if !token.starts_with("sk-adgd_") {
        return Err("部署令牌须以 sk-adgd_ 开头（不是 sk-adg_）。".to_string());
    }
    Ok(token)
}

#[allow(dead_code)]
pub(crate) fn get_adg_deploy_token() -> Result<Option<String>, String> {
    get_secret(
        ADG_DEPLOY_TOKEN_ENV_KEY,
        DEPLOY_TOKEN_FILE_NAME,
        &ADG_DEPLOY_TOKEN_CACHE,
    )
}

#[allow(dead_code)]
pub(crate) fn adg_deploy_token_exists() -> Result<bool, String> {
    secret_exists(
        ADG_DEPLOY_TOKEN_ENV_KEY,
        DEPLOY_TOKEN_FILE_NAME,
        &ADG_DEPLOY_TOKEN_CACHE,
    )
}

#[allow(dead_code)]
pub(crate) fn set_adg_deploy_token(value: &str) -> Result<(), String> {
    let token = ensure_adg_deploy_token(value)?.to_string();
    set_secret(DEPLOY_TOKEN_FILE_NAME, &ADG_DEPLOY_TOKEN_CACHE, token)
}

#[allow(dead_code)]
pub(crate) fn clear_adg_deploy_token() -> Result<(), String> {
    clear_secret(DEPLOY_TOKEN_FILE_NAME, &ADG_DEPLOY_TOKEN_CACHE)
}

fn write_secret_file(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            format!(
                "Failed to create AgentDesk runtime secret directory at {}: {err}",
                parent.display()
            )
        })?;
        restrict_directory_permissions(parent)?;
    }
    fs::write(path, contents).map_err(|err| {
        format!(
            "Failed to write AgentDesk runtime secret file at {}: {err}",
            path.display()
        )
    })?;
    restrict_file_permissions(path)
}

#[cfg(unix)]
fn restrict_file_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|err| {
        format!(
            "Failed to restrict AgentDesk runtime secret file permissions at {}: {err}",
            path.display()
        )
    })
}

#[cfg(not(unix))]
fn restrict_file_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn restrict_directory_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|err| {
        format!(
            "Failed to restrict AgentDesk runtime secret directory permissions at {}: {err}",
            path.display()
        )
    })
}

#[cfg(not(unix))]
fn restrict_directory_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_adg_deploy_token_accepts_only_deploy_prefix() {
        assert!(ensure_adg_deploy_token("sk-adgd_acme_abc123").is_ok());
        assert_eq!(
            ensure_adg_deploy_token("  sk-adgd_acme_abc123  ").unwrap(),
            "sk-adgd_acme_abc123"
        );
        // The LLM key prefix must be rejected (sk-adg_ != sk-adgd_).
        assert!(ensure_adg_deploy_token("sk-adg_acme_abc123").is_err());
        assert!(ensure_adg_deploy_token("").is_err());
        assert!(ensure_adg_deploy_token("   ").is_err());
        assert!(ensure_adg_deploy_token("nope").is_err());
    }

    // Single disk-backed test: configures the shared secret dir ONCE (OnceLock) and exercises
    // both named secrets in sequence to prove cache/file isolation + persistence round-trip.
    #[test]
    fn named_secrets_persist_and_stay_isolated() {
        let dir = std::env::temp_dir().join(format!("agentdesk-secret-test-{}", Uuid::new_v4()));
        configure_runtime_secret_store(&dir).expect("configure secret store");

        // Both unset initially.
        assert_eq!(get_runtime_api_key().unwrap(), None);
        assert_eq!(get_adg_deploy_token().unwrap(), None);

        set_runtime_api_key("sk-adg_acme_rkey").expect("set runtime key");
        set_adg_deploy_token("sk-adgd_acme_dtok").expect("set deploy token");

        // Round-trip through the encrypted files (clear caches would re-read; here caches are warm).
        assert_eq!(get_runtime_api_key().unwrap().as_deref(), Some("sk-adg_acme_rkey"));
        assert_eq!(get_adg_deploy_token().unwrap().as_deref(), Some("sk-adgd_acme_dtok"));
        assert!(runtime_api_key_exists().unwrap());
        assert!(adg_deploy_token_exists().unwrap());

        // Clearing one must NOT touch the other (isolation).
        clear_runtime_api_key().expect("clear runtime key");
        assert_eq!(get_runtime_api_key().unwrap(), None);
        assert!(!runtime_api_key_exists().unwrap());
        assert_eq!(get_adg_deploy_token().unwrap().as_deref(), Some("sk-adgd_acme_dtok"));
        assert!(adg_deploy_token_exists().unwrap());

        clear_adg_deploy_token().expect("clear deploy token");
        let _ = fs::remove_dir_all(&dir);
    }
}
