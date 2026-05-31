use tauri_plugin_shell::ShellExt;

/// Check if Ollama is installed and accessible
#[tauri::command]
async fn check_ollama(app: tauri::AppHandle) -> Result<bool, String> {
    let output = app
        .shell()
        .command("ollama")
        .args(["list"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    Ok(output.status.success())
}

/// Trigger Ollama installation via winget (Windows Package Manager)
#[tauri::command]
async fn install_ollama(app: tauri::AppHandle) -> Result<(), String> {
    app.shell()
        .command("winget")
        .args(["install", "--id", "Ollama.Ollama", "-e"])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![check_ollama, install_ollama])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
