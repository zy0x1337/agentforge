//! download.rs
//! Tauri commands for downloading GGUF files from Hugging Face
//! with progress streaming and cancellation support.
//!
//! Commands exposed:
//!   - `download_gguf`     — start a download
//!   - `cancel_download`   — cancel by ID
//!   - `ollama_import_gguf` — one-click Ollama import

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::{
    fs,
    io::AsyncWriteExt,
    sync::CancelToken,
};

// ---------------------------------------------------------------------------
// Shared cancellation registry
// ---------------------------------------------------------------------------

pub type CancelRegistry = Arc<Mutex<HashMap<String, CancelToken>>>;

/// Initialise a cancel registry — store in `app.manage()` at startup.
pub fn new_cancel_registry() -> CancelRegistry {
    Arc::new(Mutex::new(HashMap::new()))
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub filename: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: u8,
    pub speed: u64, // bytes/sec
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadGgufArgs {
    pub id: String,
    pub repo_id: String,
    pub filename: String,
    pub dest_folder: String,
    pub expected_sha256: Option<String>,
}

// ---------------------------------------------------------------------------
// download_gguf
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn download_gguf(
    app: AppHandle,
    args: DownloadGgufArgs,
    registry: tauri::State<'_, CancelRegistry>,
) -> Result<(), String> {
    let token = CancelToken::new();
    {
        let mut reg = registry.lock().unwrap();
        reg.insert(args.id.clone(), token.clone());
    }

    let event_key = format!("download://progress/{}", args.id);
    let dest_path = PathBuf::from(&args.dest_folder).join(&args.filename);
    let url = format!(
        "https://huggingface.co/{}/resolve/main/{}",
        args.repo_id, args.filename
    );

    let emit_progress = |app: &AppHandle, p: DownloadProgress| {
        let _ = app.emit(&event_key, p);
    };

    // ------------------------------------------------------------------
    // Stream download
    // ------------------------------------------------------------------
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("User-Agent", "AgentForge/1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let total_bytes = response.content_length().unwrap_or(0);
    let mut stream = response.bytes_stream();

    // Create parent dir if needed
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }

    let mut file = fs::File::create(&dest_path)
        .await
        .map_err(|e| e.to_string())?;

    let mut downloaded: u64 = 0;
    let mut last_tick = std::time::Instant::now();
    let mut bytes_since_tick: u64 = 0;
    let mut speed: u64 = 0;

    use futures_util::StreamExt;
    loop {
        tokio::select! {
            _ = token.cancelled() => {
                drop(file);
                let _ = fs::remove_file(&dest_path).await;
                emit_progress(&app, DownloadProgress {
                    filename: args.filename.clone(),
                    downloaded_bytes: downloaded,
                    total_bytes,
                    percent: 0,
                    speed: 0,
                    status: "cancelled".into(),
                    error_message: None,
                });
                return Ok(());
            }
            chunk = stream.next() => {
                match chunk {
                    None => break,
                    Some(Err(e)) => {
                        emit_progress(&app, DownloadProgress {
                            filename: args.filename.clone(),
                            downloaded_bytes: downloaded,
                            total_bytes,
                            percent: 0,
                            speed: 0,
                            status: "error".into(),
                            error_message: Some(e.to_string()),
                        });
                        return Err(e.to_string());
                    }
                    Some(Ok(bytes)) => {
                        file.write_all(&bytes).await.map_err(|e| e.to_string())?;
                        downloaded += bytes.len() as u64;
                        bytes_since_tick += bytes.len() as u64;

                        let elapsed = last_tick.elapsed();
                        if elapsed.as_millis() >= 500 {
                            speed = (bytes_since_tick as f64 / elapsed.as_secs_f64()) as u64;
                            bytes_since_tick = 0;
                            last_tick = std::time::Instant::now();
                        }

                        let percent = if total_bytes > 0 {
                            ((downloaded as f64 / total_bytes as f64) * 100.0) as u8
                        } else { 0 };

                        emit_progress(&app, DownloadProgress {
                            filename: args.filename.clone(),
                            downloaded_bytes: downloaded,
                            total_bytes,
                            percent,
                            speed,
                            status: "downloading".into(),
                            error_message: None,
                        });
                    }
                }
            }
        }
    }

    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    // ------------------------------------------------------------------
    // Optional SHA256 verification
    // ------------------------------------------------------------------
    if let Some(expected) = args.expected_sha256 {
        emit_progress(&app, DownloadProgress {
            filename: args.filename.clone(),
            downloaded_bytes: downloaded,
            total_bytes,
            percent: 99,
            speed: 0,
            status: "verifying".into(),
            error_message: None,
        });
        let data = fs::read(&dest_path).await.map_err(|e| e.to_string())?;
        use sha2::{Digest, Sha256};
        let hash = format!("{:x}", Sha256::digest(&data));
        if hash != expected {
            let _ = fs::remove_file(&dest_path).await;
            let msg = format!("SHA256 mismatch. Expected {expected}, got {hash}");
            emit_progress(&app, DownloadProgress {
                filename: args.filename.clone(),
                downloaded_bytes: downloaded,
                total_bytes,
                percent: 0,
                speed: 0,
                status: "error".into(),
                error_message: Some(msg.clone()),
            });
            return Err(msg);
        }
    }

    // Clean up registry
    {
        let mut reg = registry.lock().unwrap();
        reg.remove(&args.id);
    }

    emit_progress(&app, DownloadProgress {
        filename: args.filename.clone(),
        downloaded_bytes: downloaded,
        total_bytes,
        percent: 100,
        speed: 0,
        status: "done".into(),
        error_message: None,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// cancel_download
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cancel_download(
    id: String,
    registry: tauri::State<'_, CancelRegistry>,
) -> Result<(), String> {
    let reg = registry.lock().unwrap();
    if let Some(token) = reg.get(&id) {
        token.cancel();
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// ollama_import_gguf
// ---------------------------------------------------------------------------

/// Writes a minimal Modelfile and runs `ollama create <name> -f <path>`.
#[tauri::command]
pub async fn ollama_import_gguf(
    local_path: String,
    model_name: String,
) -> Result<(), String> {
    // Write a temp Modelfile
    let modelfile_path = std::env::temp_dir().join(format!("{}.Modelfile", model_name));
    let content = format!("FROM {}\n", local_path);
    fs::write(&modelfile_path, content)
        .await
        .map_err(|e| e.to_string())?;

    let output = tokio::process::Command::new("ollama")
        .args(["create", &model_name, "-f", modelfile_path.to_str().unwrap()])
        .output()
        .await
        .map_err(|e| format!("Failed to run ollama: {e}"))?;

    let _ = fs::remove_file(&modelfile_path).await;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("ollama create failed: {stderr}"));
    }

    Ok(())
}
