//! lib.rs — AgentForge Tauri backend
//!
//! All Tauri commands live here.  The file is intentionally kept as a
//! single module; split into sub-modules once it grows beyond ~400 lines.
//!
//! Commands
//! ────────
//!  Ollama helpers    check_ollama · install_ollama
//!  Downloads         download_gguf · cancel_download · import_gguf_to_ollama
//!  Tool execution    run_tool_command

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager};

// ═══════════════════════════════════════════════════════════════════════════
// Cancellation registry
// ═══════════════════════════════════════════════════════════════════════════

/// A map of download_id → cancellation flag.
/// Stored as Tauri app state so any command can reach it.
type CancelMap = Arc<Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>>;

// ═══════════════════════════════════════════════════════════════════════════
// Ollama helpers
// ═══════════════════════════════════════════════════════════════════════════

/// Returns true when the Ollama daemon responds on localhost:11434.
#[tauri::command]
fn check_ollama() -> bool {
    Command::new("curl")
        .args([
            "-s",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            "http://localhost:11434",
        ])
        .output()
        .map(|o| o.stdout.starts_with(b"200"))
        .unwrap_or(false)
}

/// Launches `winget install Ollama.Ollama` in a detached process.
#[tauri::command]
fn install_ollama() {
    let _ = Command::new("winget")
        .args(["install", "-e", "--id", "Ollama.Ollama"])
        .spawn();
}

// ═══════════════════════════════════════════════════════════════════════════
// Downloads
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressEvent {
    pub download_id: String,
    pub bytes_received: u64,
    pub total_bytes: u64,
    /// 0–100
    pub percent: u8,
    /// Bytes per second (updated every ~500 ms)
    pub speed: u64,
    /// "downloading" | "verifying" | "done" | "error" | "cancelled"
    pub status: String,
    pub done: bool,
    pub error: Option<String>,
}

/// Download a GGUF file from Hugging Face and save it to `dest_path`.
///
/// - Emits `download://progress` events every ~256 KiB.
/// - Respects a per-download cancellation flag (see `cancel_download`).
/// - Verifies SHA-256 when `expected_sha256` is non-empty.
#[tauri::command]
async fn download_gguf(
    app: tauri::AppHandle,
    download_id: String,
    url: String,
    dest_path: String,
    expected_sha256: Option<String>,
    cancel_map: tauri::State<'_, CancelMap>,
) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::sync::atomic::AtomicBool;

    // Register a cancellation flag for this download.
    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = cancel_map.lock().unwrap();
        map.insert(download_id.clone(), flag.clone());
    }

    let emit = |status: &str, received: u64, total: u64, speed: u64, err: Option<String>| {
        let percent = if total > 0 {
            ((received as f64 / total as f64) * 100.0) as u8
        } else {
            0
        };
        let done = status == "done" || status == "error" || status == "cancelled";
        let _ = app.emit(
            "download://progress",
            DownloadProgressEvent {
                download_id: download_id.clone(),
                bytes_received: received,
                total_bytes: total,
                percent,
                speed,
                status: status.to_string(),
                done,
                error: err,
            },
        );
    };

    // ── HTTP streaming ───────────────────────────────────────────────────
    let response = ureq::get(&url)
        .header("User-Agent", "AgentForge/1.0")
        .call()
        .map_err(|e| format!("HTTP error: {e}"))?;

    let total: u64 = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    if let Some(parent) = std::path::Path::new(&dest_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = std::fs::File::create(&dest_path).map_err(|e| e.to_string())?;

    let mut reader = response.into_body().into_reader();
    let mut buf = vec![0u8; 65_536];
    let mut received: u64 = 0;
    let mut last_emit_bytes: u64 = 0;
    let mut last_speed_check = std::time::Instant::now();
    let mut bytes_since_speed: u64 = 0;
    let mut speed: u64 = 0;
    let mut hasher = Sha256::new();

    loop {
        // Check cancellation flag.
        if flag.load(std::sync::atomic::Ordering::Relaxed) {
            drop(file);
            let _ = std::fs::remove_file(&dest_path);
            emit("cancelled", received, total, 0, None);
            let mut map = cancel_map.lock().unwrap();
            map.remove(&download_id);
            return Ok(String::new());
        }

        match std::io::Read::read(&mut reader, &mut buf) {
            Ok(0) => break,
            Ok(n) => {
                file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
                if expected_sha256.is_some() {
                    hasher.update(&buf[..n]);
                }
                received += n as u64;
                bytes_since_speed += n as u64;

                let elapsed = last_speed_check.elapsed();
                if elapsed.as_millis() >= 500 {
                    speed = (bytes_since_speed as f64 / elapsed.as_secs_f64()) as u64;
                    bytes_since_speed = 0;
                    last_speed_check = std::time::Instant::now();
                }

                // Emit at most every 256 KiB.
                if received - last_emit_bytes >= 262_144 || (total > 0 && received == total) {
                    last_emit_bytes = received;
                    emit("downloading", received, total, speed, None);
                }
            }
            Err(e) => {
                drop(file);
                let _ = std::fs::remove_file(&dest_path);
                emit("error", received, total, 0, Some(e.to_string()));
                return Err(e.to_string());
            }
        }
    }
    drop(file);

    // ── SHA-256 verification ─────────────────────────────────────────────
    if let Some(expected) = expected_sha256 {
        if !expected.is_empty() {
            emit("verifying", received, total, 0, None);
            let actual = format!("{:x}", hasher.finalize());
            if actual != expected {
                let _ = std::fs::remove_file(&dest_path);
                let msg = format!("SHA-256 mismatch — expected {expected}, got {actual}");
                emit("error", received, total, 0, Some(msg.clone()));
                return Err(msg);
            }
        }
    }

    // Clean up registry and signal done.
    {
        let mut map = cancel_map.lock().unwrap();
        map.remove(&download_id);
    }
    emit("done", received, total, 0, None);
    Ok(dest_path)
}

/// Set the cancellation flag for an in-flight download.
#[tauri::command]
fn cancel_download(
    download_id: String,
    cancel_map: tauri::State<'_, CancelMap>,
) -> Result<(), String> {
    let map = cancel_map.lock().unwrap();
    if let Some(flag) = map.get(&download_id) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

// ── Ollama import ────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaImportEvent {
    pub import_id: String,
    pub status: String,
    pub done: bool,
    pub error: Option<String>,
}

/// Create an Ollama model from a local GGUF file.
///
/// Writes a minimal `Modelfile` to the system temp directory, then
/// streams `ollama create` stdout/stderr as `ollama://import` events.
#[tauri::command]
async fn import_gguf_to_ollama(
    app: tauri::AppHandle,
    import_id: String,
    model_name: String,
    gguf_path: String,
) -> Result<(), String> {
    // Write a minimal Modelfile.
    let modelfile_path = std::env::temp_dir().join(format!("{import_id}.Modelfile"));
    std::fs::write(&modelfile_path, format!("FROM {gguf_path}\n")).map_err(|e| e.to_string())?;

    let mut child = Command::new("ollama")
        .args([
            "create",
            &model_name,
            "--file",
            modelfile_path.to_str().unwrap(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn ollama: {e}"))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let app_out = app.clone();
    let id_out = import_id.clone();
    let app_err = app.clone();
    let id_err = import_id.clone();

    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = app_out.emit(
                "ollama://import",
                OllamaImportEvent {
                    import_id: id_out.clone(),
                    status: line,
                    done: false,
                    error: None,
                },
            );
        }
    });
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = app_err.emit(
                "ollama://import",
                OllamaImportEvent {
                    import_id: id_err.clone(),
                    status: line,
                    done: false,
                    error: None,
                },
            );
        }
    });

    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&modelfile_path);
    let code = status.code().unwrap_or(-1);

    let _ = app.emit(
        "ollama://import",
        OllamaImportEvent {
            import_id: import_id.clone(),
            status: format!("exit {code}"),
            done: true,
            error: if code == 0 {
                None
            } else {
                Some(format!("ollama create exited with code {code}"))
            },
        },
    );

    if code == 0 {
        Ok(())
    } else {
        Err(format!("ollama create failed (exit {code})"))
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool execution  (tools.md shell commands)
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutputEvent {
    pub run_id: String,
    pub line: String,
    pub stream: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDoneEvent {
    pub run_id: String,
    pub exit_code: i32,
    pub error: Option<String>,
}

#[tauri::command]
async fn run_tool_command(
    app: tauri::AppHandle,
    run_id: String,
    command: String,
    args: Vec<String>,
    cwd: String,
    timeout_secs: u64,
) -> Result<(), String> {
    let mut child = Command::new(&command)
        .args(&args)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn '{}': {}", command, e))?;

    let child_id = child.id();

    if timeout_secs > 0 {
        let app_wdog = app.clone();
        let run_id_wdog = run_id.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(timeout_secs));
            #[cfg(windows)]
            let _ = Command::new("taskkill")
                .args(["/PID", &child_id.to_string(), "/F"])
                .output();
            #[cfg(not(windows))]
            let _ = Command::new("kill")
                .args(["-9", &child_id.to_string()])
                .output();
            let _ = app_wdog.emit(
                "tool://done",
                ToolDoneEvent {
                    run_id: run_id_wdog,
                    exit_code: -1,
                    error: Some(format!("Killed after {timeout_secs}s timeout")),
                },
            );
        });
    }

    let stdout = child.stdout.take().unwrap();
    let app_out = app.clone();
    let run_id_out = run_id.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = app_out.emit(
                "tool://output",
                ToolOutputEvent {
                    run_id: run_id_out.clone(),
                    line,
                    stream: "stdout".into(),
                },
            );
        }
    });

    let stderr = child.stderr.take().unwrap();
    let app_err = app.clone();
    let run_id_err = run_id.clone();
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = app_err.emit(
                "tool://output",
                ToolOutputEvent {
                    run_id: run_id_err.clone(),
                    line,
                    stream: "stderr".into(),
                },
            );
        }
    });

    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = app.emit(
        "tool://done",
        ToolDoneEvent {
            run_id,
            exit_code: status.code().unwrap_or(-1),
            error: None,
        },
    );
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
// App entry point
// ═══════════════════════════════════════════════════════════════════════════

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Register the per-download cancellation map as app state.
            app.manage(Arc::new(Mutex::new(HashMap::<
                String,
                Arc<std::sync::atomic::AtomicBool>,
            >::new())) as CancelMap);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_ollama,
            install_ollama,
            download_gguf,
            cancel_download,
            import_gguf_to_ollama,
            run_tool_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
