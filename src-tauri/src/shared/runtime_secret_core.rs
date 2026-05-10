use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub(crate) const RUNTIME_API_KEY_ENV_KEY: &str = "AGENTDESK_RUNTIME_API_KEY";

const KEY_FILE_NAME: &str = "runtime-secret.key";
const SECRET_FILE_NAME: &str = "runtime-secret.json";
const SECRET_FILE_VERSION: u8 = 1;

static RUNTIME_SECRET_DIR: OnceLock<PathBuf> = OnceLock::new();
static RUNTIME_API_KEY_CACHE: OnceLock<Mutex<Option<String>>> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize)]
struct RuntimeSecretFile {
    version: u8,
    nonce: String,
    ciphertext: String,
}

fn cached_runtime_api_key() -> &'static Mutex<Option<String>> {
    RUNTIME_API_KEY_CACHE.get_or_init(|| Mutex::new(None))
}

fn normalize_secret(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn runtime_api_key_from_env() -> Option<String> {
    std::env::var(RUNTIME_API_KEY_ENV_KEY)
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

fn secret_path() -> Result<PathBuf, String> {
    Ok(secret_dir()?.join(SECRET_FILE_NAME))
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

pub(crate) fn get_runtime_api_key() -> Result<Option<String>, String> {
    if let Some(value) = runtime_api_key_from_env() {
        return Ok(Some(value));
    }
    if let Some(value) = cached_runtime_api_key()
        .lock()
        .map_err(|_| "Runtime API key cache is unavailable.".to_string())?
        .clone()
    {
        return Ok(Some(value));
    }

    let path = secret_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let Some(key) = read_existing_key()? else {
        return Err("AgentDesk runtime secret key is missing.".to_string());
    };
    let file: RuntimeSecretFile = serde_json::from_slice(&fs::read(&path).map_err(|err| {
        format!(
            "Failed to read AgentDesk runtime secret at {}: {err}",
            path.display()
        )
    })?)
    .map_err(|err| {
        format!(
            "Failed to parse AgentDesk runtime secret at {}: {err}",
            path.display()
        )
    })?;
    if file.version != SECRET_FILE_VERSION {
        return Err("AgentDesk runtime secret file version is unsupported.".to_string());
    }
    let nonce_bytes: [u8; 12] = STANDARD
        .decode(file.nonce)
        .map_err(|err| {
            format!(
                "Failed to decode AgentDesk runtime secret nonce at {}: {err}",
                path.display()
            )
        })?
        .try_into()
        .map_err(|_| "AgentDesk runtime secret nonce has invalid length.".to_string())?;
    let ciphertext = STANDARD.decode(file.ciphertext).map_err(|err| {
        format!(
            "Failed to decode AgentDesk runtime secret payload at {}: {err}",
            path.display()
        )
    })?;
    let plaintext = Aes256Gcm::new_from_slice(&key)
        .map_err(|err| format!("Failed to initialize AgentDesk runtime secret cipher: {err}"))?
        .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
        .map_err(|_| "Failed to decrypt AgentDesk runtime secret.".to_string())?;
    let value = String::from_utf8(plaintext)
        .map_err(|_| "AgentDesk runtime secret is not valid UTF-8.".to_string())?;
    let Some(value) = normalize_secret(&value) else {
        return Ok(None);
    };
    *cached_runtime_api_key()
        .lock()
        .map_err(|_| "Runtime API key cache is unavailable.".to_string())? = Some(value.clone());
    Ok(Some(value))
}

pub(crate) fn runtime_api_key_exists() -> Result<bool, String> {
    if runtime_api_key_from_env().is_some() {
        return Ok(true);
    }
    if cached_runtime_api_key()
        .lock()
        .map_err(|_| "Runtime API key cache is unavailable.".to_string())?
        .is_some()
    {
        return Ok(true);
    }
    Ok(secret_path()?.exists())
}

pub(crate) fn set_runtime_api_key(value: &str) -> Result<(), String> {
    let Some(trimmed) = normalize_secret(value) else {
        return Err("Runtime API key cannot be empty.".to_string());
    };
    let key = read_or_create_key()?;
    let nonce = random_bytes::<12>();
    let ciphertext = Aes256Gcm::new_from_slice(&key)
        .map_err(|err| format!("Failed to initialize AgentDesk runtime secret cipher: {err}"))?
        .encrypt(Nonce::from_slice(&nonce), trimmed.as_bytes())
        .map_err(|_| "Failed to encrypt AgentDesk runtime API key.".to_string())?;
    let file = RuntimeSecretFile {
        version: SECRET_FILE_VERSION,
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
    };
    let bytes = serde_json::to_vec_pretty(&file)
        .map_err(|err| format!("Failed to encode AgentDesk runtime secret: {err}"))?;
    let path = secret_path()?;
    write_secret_file(&path, &String::from_utf8_lossy(&bytes))?;
    *cached_runtime_api_key()
        .lock()
        .map_err(|_| "Runtime API key cache is unavailable.".to_string())? = Some(trimmed);
    Ok(())
}

pub(crate) fn clear_runtime_api_key() -> Result<(), String> {
    let path = secret_path()?;
    match fs::remove_file(&path) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => {
            return Err(format!(
                "Failed to clear AgentDesk runtime API key at {}: {err}",
                path.display()
            ));
        }
    }
    *cached_runtime_api_key()
        .lock()
        .map_err(|_| "Runtime API key cache is unavailable.".to_string())? = None;
    Ok(())
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
