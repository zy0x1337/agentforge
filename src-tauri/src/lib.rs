use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::time::Duration;
use std::thread;
use tauri::Manager;

// ─── Ollama helpers ────────────────────────────────────────────────────────

#[tauri::command]
pub fn check_ollama() -> bool {
    Command::new("curl")
        .args(["-s", "-o", "/dev/null", "-w", "%{http_code}", "http://localhost:11434"])
        .output()
        .map(|o| o.stdout.starts_with(b"200"))
        .unwrap_or(false)
}

#[tauri::command]
pub fn install_ollama() {
    let _ = Command::new("winget")
        .args(["install", "-e", "--id", "Ollama.Ollama"])
        .spawn();
}

// ─── Direct GGUF download ─────────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
pub struct DownloadProgressEvent {
    pub download_id: String,
    pub bytes_received: u64,
    pub total_bytes: u64,   // 0 when unknown
    pub done: bool,
    pub error: Option<String>,
}

/// Download a file from `url` and save it to `dest_path`.
/// Emits `download://progress` events with byte counts.
/// Returns the final destination path on success.
#[tauri::command]
pub async fn download_gguf(
    app: tauri::AppHandle,
    download_id: String,
    url: String,
    dest_path: String,
) -> Result<String, String> {
    use std::fs;
    use std::io::Write;

    let response = ureq::get(&url)
        .call()
        .map_err(|e| format!("HTTP error: {e}"))?;

    let total: u64 = response
        .header("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    // Create parent directories if needed
    if let Some(parent) = std::path::Path::new(&dest_path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut file = fs::File::create(&dest_path).map_err(|e| e.to_string())?;
    let mut reader = response.into_reader();
    let mut buf = vec![0u8; 65_536]; // 64 KiB chunks
    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;

    loop {
        match std::io::Read::read(&mut reader, &mut buf) {
            Ok(0) => break,
            Ok(n) => {
                file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
                received += n as u64;
                // Emit at most every 256 KiB to avoid flooding the event bus
                if received - last_emit >= 262_144 || (total > 0 && received == total) {
                    last_emit = received;
                    let _ = app.emit("download://progress", DownloadProgressEvent {
                        download_id: download_id.clone(),
                        bytes_received: received,
                        total_bytes: total,
                        done: false,
                        error: None,
                    });
                }
            }
            Err(e) => {
                let _ = app.emit("download://progress", DownloadProgressEvent {
                    download_id: download_id.clone(),
                    bytes_received: received,
                    total_bytes: total,
                    done: false,
                    error: Some(e.to_string()),
                });
                return Err(e.to_string());
            }
        }
    }

    let _ = app.emit("download://progress", DownloadProgressEvent {
        download_id: download_id.clone(),
        bytes_received: received,
        total_bytes: total,
        done: true,
        error: None,
    });

    Ok(dest_path)
}

// ─── Ollama import (create from local GGUF) ───────────────────────────────

#[derive(Clone, serde::Serialize)]
pub struct OllamaImportEvent {
    pub import_id: String,
    pub status: String,   // line from Ollama stdout/stderr
    pub done: bool,
    pub error: Option<String>,
}

/// Calls `ollama create <model_name> --file <gguf_path>` and
/// streams progress lines as `ollama://import` events.
#[tauri::command]
pub async fn import_gguf_to_ollama(
    app: tauri::AppHandle,
    import_id: String,
    model_name: String,
    gguf_path: String,
) -> Result<(), String> {
    let mut child = Command::new("ollama")
        .args(["create", &model_name, "--file", &gguf_path])
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
        for line in BufReader::new(stdout).lines().flatten() {
            let _ = app_out.emit("ollama://import", OllamaImportEvent {
                import_id: id_out.clone(),
                status: line,
                done: false,
                error: None,
            });
        }
    });

    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            let _ = app_err.emit("ollama://import", OllamaImportEvent {
                import_id: id_err.clone(),
                status: line,
                done: false,
                error: None,
            });
        }
    });

    let status = child.wait().map_err(|e| e.to_string())?;
    let code = status.code().unwrap_or(-1);

    let _ = app.emit("ollama://import", OllamaImportEvent {
        import_id: import_id.clone(),
        status: format!("exit {code}"),
        done: true,
        error: if code == 0 { None } else { Some(format!("ollama create exited with code {code}")) },
    });

    if code == 0 { Ok(()) } else { Err(format!("ollama create failed (exit {code})")) }
}

// ─── tools.md shell execution ─────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
pub struct ToolOutputEvent {
    pub run_id: String,
    pub line: String,
    pub stream: String,
}

#[derive(Clone, serde::Serialize)]
pub struct ToolDoneEvent {
    pub run_id: String,
    pub exit_code: i32,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn run_tool_command(
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
            let _ = Command::new("taskkill").args(["/PID", &child_id.to_string(), "/F"]).output();
            #[cfg(not(windows))]
            let _ = Command::new("kill").args(["-9", &child_id.to_string()]).output();
            let _ = app_wdog.emit("tool://done", ToolDoneEvent {
                run_id: run_id_wdog,
                exit_code: -1,
                error: Some(format!("Killed after {}s timeout", timeout_secs)),
            });
        });
    }

    let stdout = child.stdout.take().unwrap();
    let app_out = app.clone();
    let run_id_out = run_id.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().flatten() {
            let _ = app_out.emit("tool://output", ToolOutputEvent {
                run_id: run_id_out.clone(), line, stream: "stdout".into(),
            });
        }
    });

    let stderr = child.stderr.take().unwrap();
    let app_err = app.clone();
    let run_id_err = run_id.clone();
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            let _ = app_err.emit("tool://output", ToolOutputEvent {
                run_id: run_id_err.clone(), line, stream: "stderr".into(),
            });
        }
    });

    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = app.emit("tool://done", ToolDoneEvent {
        run_id,
        exit_code: status.code().unwrap_or(-1),
        error: None,
    });

    Ok(())
}

// ─── App entry point ───────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            check_ollama,
            install_ollama,
            run_tool_command,
            download_gguf,
            import_gguf_to_ollama,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
