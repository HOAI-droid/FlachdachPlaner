// Reiner Webview-Wrapper: Die gesamte Logik liegt im TypeScript-Frontend, Daten bleiben lokal.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("Fehler beim Start von Flachdachplaner");
}
