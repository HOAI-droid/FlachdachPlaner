// Webview-Wrapper: Die gesamte Logik liegt im TypeScript-Frontend, Daten bleiben lokal.
// Rust baut nur das native Menü (Datei → Neu/Öffnen/Speichern) und meldet Klicks als Ereignis "menu" ans Frontend.
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let neu = MenuItemBuilder::with_id("neu", "Neu").build(app)?;
            let oeffnen = MenuItemBuilder::with_id("oeffnen", "Öffnen …").build(app)?;
            let speichern = MenuItemBuilder::with_id("speichern", "Speichern …").build(app)?;
            let datei = SubmenuBuilder::new(app, "Datei")
                .item(&neu)
                .item(&oeffnen)
                .item(&speichern)
                .separator()
                .close_window()
                .build()?;
            let bearbeiten = SubmenuBuilder::new(app, "Bearbeiten")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let fenster = SubmenuBuilder::new(app, "Fenster").minimize().maximize().build()?;
            let mut menue = MenuBuilder::new(app);
            #[cfg(target_os = "macos")]
            {
                let programm = SubmenuBuilder::new(app, "Flachdachplaner")
                    .about(None)
                    .separator()
                    .hide()
                    .hide_others()
                    .separator()
                    .quit()
                    .build()?;
                menue = menue.item(&programm);
            }
            let menue = menue.item(&datei).item(&bearbeiten).item(&fenster).build()?;
            app.set_menu(menue)?;
            Ok(())
        })
        .on_menu_event(|app, ereignis| {
            let _ = app.emit("menu", ereignis.id().0.clone());
        })
        .run(tauri::generate_context!())
        .expect("Fehler beim Start von Flachdachplaner");
}
