// Webview-Wrapper: Die gesamte Logik liegt im TypeScript-Frontend, Daten bleiben lokal.
// Rust baut nur das native Menü (gleiche IDs wie src/ui/menue.ts) und meldet Klicks als Ereignis "menu" ans Frontend.
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Gleiche IDs wie die Menüleiste im Browser (src/ui/menue.ts); Klicks gehen als Ereignis "menu" ans Frontend.
            let punkt = |id: &str, label: &str, kurz: Option<&str>| -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
                let mut b = MenuItemBuilder::with_id(id, label);
                if let Some(k) = kurz {
                    b = b.accelerator(k);
                }
                b.build(app)
            };
            let datei = SubmenuBuilder::new(app, "Datei")
                .item(&punkt("neu", "Neu", Some("CmdOrCtrl+N"))?)
                .item(&punkt("oeffnen", "Öffnen …", Some("CmdOrCtrl+O"))?)
                .item(&punkt("speichern", "Speichern …", Some("CmdOrCtrl+S"))?)
                .separator()
                .item(&punkt("unterlage-laden", "Unterlage laden …", None)?)
                .item(&punkt("unterlage-einbetten", "Unterlage einbetten …", None)?)
                .separator()
                .item(&punkt("export-pdf", "Plan als PDF …", None)?)
                .item(&punkt("export-dxf", "Plan als DXF …", None)?)
                .separator()
                .close_window()
                .build()?;
            // Eigene Rückgängig-/Wiederholen-Einträge: die vordefinierten würden Cmd+Z als Text-Undo schlucken.
            let bearbeiten = SubmenuBuilder::new(app, "Bearbeiten")
                .item(&punkt("undo", "Rückgängig", Some("CmdOrCtrl+Z"))?)
                .item(&punkt("redo", "Wiederholen", Some("CmdOrCtrl+Shift+Z"))?)
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .separator()
                .item(&punkt("auswahl-loeschen", "Auswahl löschen", None)?)
                .build()?;
            let projekt = SubmenuBuilder::new(app, "Projekt")
                .item(&punkt("angaben", "Plankopfdaten …", None)?)
                .item(&punkt("standort", "Standort & Regenspende …", None)?)
                .item(&punkt("varianten", "Varianten …", None)?)
                .build()?;
            let ansicht = SubmenuBuilder::new(app, "Ansicht")
                .item(&punkt("modus-2d", "2D", None)?)
                .item(&punkt("modus-3d", "3D", None)?)
                .separator()
                .item(&punkt("ansicht-gefaelle", "Gefälleplan", None)?)
                .item(&punkt("ansicht-daemmplan", "Gefälledämmplan", None)?)
                .separator()
                .item(&punkt("thema", "Hell / Dunkel umschalten", None)?)
                .build()?;
            let fenster = SubmenuBuilder::new(app, "Fenster").minimize().maximize().build()?;
            let hilfe = SubmenuBuilder::new(app, "Hilfe")
                .item(&punkt("update", "Softwareupdate …", None)?)
                .build()?;
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
            let menue = menue
                .item(&datei)
                .item(&bearbeiten)
                .item(&projekt)
                .item(&ansicht)
                .item(&fenster)
                .item(&hilfe)
                .build()?;
            app.set_menu(menue)?;
            Ok(())
        })
        .on_menu_event(|app, ereignis| {
            let _ = app.emit("menu", ereignis.id().0.clone());
        })
        .run(tauri::generate_context!())
        .expect("Fehler beim Start von Flachdachplaner");
}
