use tauri::Manager;
use std::process::Command;
use std::time::Duration;
use std::sync::{Arc, Mutex};
use std::thread;

/// Check whether Ollama is reachable on localhost:11434.
#[tauri::command]
pub fn check_ollama() -> bool {
    Command::new("curl")
        .args(["-s", "-o", "/dev/null", "-w", "%{http_code}", "http://localhost:11434"])
        .output()
        .map(|o| o.stdout.starts_with(b"200"))
        .unwrap_or(false)
}

/// Install Ollama via winget (fire-and-forget).
#[tauri::command]
pub fn install_ollama() {
    let _ = Command::new("winget")
        .args(["install", "-e", "--id", "Ollama.Ollama"])
        .spawn();
}

/// Payload emitted for every line of stdout/stderr from a tool command.
#[derive(Clone, serde::Serialize)]
pub struct ToolOutputEvent {
    pub run_id: String,
    pub line: String,
    pub stream: String, // "stdout" | "stderr"
}

/// Payload emitted when a tool command finishes.
#[derive(Clone, serde::Serialize)]
pub struct ToolDoneEvent {
    pub run_id: String,
    pub exit_code: i32,
    pub error: Option<String>,
}

/// Execute a whitelisted shell command.
/// `allowed` must match exactly one entry in the agent's `allowed_commands` list
/// (validated on the TypeScript side before this call is made).
///
/// Emits `tool://output` events per line and a final `tool://done` event.
/// Kills the child process if `timeout_secs` elapses.
#[tauri::command]
pub async fn run_tool_command(
    app: tauri::AppHandle,
    run_id: String,
    command: String,
    args: Vec<String>,
    cwd: String,
    timeout_secs: u64,
) -> Result<(), String> {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;

    let mut child = Command::new(&command)
        .args(&args)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn '{}': {}", command, e))?;

    let child_id = child.id();
    let app_handle = app.clone();
    let run_id_clone = run_id.clone();

    // Timeout watchdog
    if timeout_secs > 0 {
        let app_wdog = app.clone();
        let run_id_wdog = run_id.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(timeout_secs));
            // Best-effort kill; ignore errors
            #[cfg(windows)]
            let _ = Command::new("taskkill")
                .args(["/PID", &child_id.to_string(), "/F"])
                .output();
            #[cfg(not(windows))]
            let _ = Command::new("kill")
                .args(["-9", &child_id.to_string()])
                .output();
            let _ = app_wdog.emit("tool://done", ToolDoneEvent {
                run_id: run_id_wdog,
                exit_code: -1,
                error: Some(format!("Killed after {}s timeout", timeout_secs)),
            });
        });
    }

    // Stream stdout
    let stdout = child.stdout.take().unwrap();
    let app_out = app.clone();
    let run_id_out = run_id.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().flatten() {
            let _ = app_out.emit("tool://output", ToolOutputEvent {
                run_id: run_id_out.clone(),
                line,
                stream: "stdout".into(),
            });
        }
    });

    // Stream stderr
    let stderr = child.stderr.take().unwrap();
    let app_err = app.clone();
    let run_id_err = run_id.clone();
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            let _ = app_err.emit("tool://output", ToolOutputEvent {
                run_id: run_id_err.clone(),
                line,
                stream: "stderr".into(),
            });
        }
    });

    // Wait for exit
    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = app_handle.emit("tool://done", ToolDoneEvent {
        run_id: run_id_clone,
        exit_code: status.code().unwrap_or(-1),
        error: None,
    });

    Ok(())
}

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
