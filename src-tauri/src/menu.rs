use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Manager, Wry, Emitter,
};

/// Create the application menu
pub fn create_menu(app: &AppHandle) -> Result<Menu<Wry>, tauri::Error> {
    // Create menu with platform-specific Settings placement
    #[cfg(target_os = "macos")]
    {
        // On macOS, add settings with Cmd+, shortcut to File menu
        let file_menu = Submenu::with_items(
            app,
            "File",
            true,
            &[
                &MenuItem::with_id(app, "open", "Open...", true, Some("CmdOrCtrl+O"))?,
                &MenuItem::with_id(app, "print", "Print", true, Some("CmdOrCtrl+P"))?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "settings", "Settings...", true, Some("Cmd+,"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::close_window(app, Some("Close"))?,
            ],
        )?;

        // Edit menu
        let edit_menu = Submenu::with_items(
            app,
            "Edit",
            true,
            &[
                &PredefinedMenuItem::undo(app, None)?,
                &PredefinedMenuItem::redo(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                &PredefinedMenuItem::select_all(app, None)?,
            ],
        )?;

        // View menu
        let view_menu = Submenu::with_items(
            app,
            "View",
            true,
            &[
                &MenuItem::with_id(app, "zoom_in", "Zoom In", true, Some("CmdOrCtrl+Plus"))?,
                &MenuItem::with_id(app, "zoom_out", "Zoom Out", true, Some("CmdOrCtrl+-"))?,
                &MenuItem::with_id(app, "reset_zoom", "Reset Zoom", true, Some("CmdOrCtrl+0"))?,
            ],
        )?;

        // Window menu
        let window_menu = Submenu::with_items(
            app,
            "Window",
            true,
            &[
                &PredefinedMenuItem::minimize(app, None)?,
                &PredefinedMenuItem::maximize(app, None)?,
            ],
        )?;

        Menu::with_items(
            app,
            &[
                &file_menu,
                &edit_menu,
                &view_menu,
                &window_menu,
            ],
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        // On Windows/Linux, add settings with Alt+S to File menu
        let settings_item = MenuItem::with_id(app, "settings", "Settings", true, Some("Alt+S"))?;

        let file_menu_with_settings = Submenu::with_items(
            app,
            "File",
            true,
            &[
                &MenuItem::with_id(app, "open", "Open...", true, Some("CmdOrCtrl+O"))?,
                &MenuItem::with_id(app, "print", "Print", true, Some("CmdOrCtrl+P"))?,
                &PredefinedMenuItem::separator(app)?,
                &settings_item,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::close_window(app, Some("Close"))?,
            ],
        )?;

        Menu::with_items(
            app,
            &[
                &file_menu_with_settings,
                &edit_menu,
                &view_menu,
                &window_menu,
            ],
        )
    }
}

/// Handle menu events
pub fn handle_menu_event(app: &AppHandle, event_id: &str) {
    match event_id {
        "open" => {
            // Emit event to frontend to open file dialog
            if let Some(window) = app.get_webview_window("main") {
                window.emit("menu-open", ()).ok();
            }
        }
        "print" => {
            // Emit event to frontend to print
            if let Some(window) = app.get_webview_window("main") {
                window.emit("menu-print", ()).ok();
            }
        }
        "settings" => {
            // Open settings window using the command
            use crate::commands::open_settings;
            tauri::async_runtime::block_on(async {
                if let Err(e) = open_settings(app.clone()).await {
                    eprintln!("Error opening settings: {}", e);
                }
            });
        }
        "zoom_in" => {
            if let Some(window) = app.get_webview_window("main") {
                window.emit("menu-zoom-in", ()).ok();
            }
        }
        "zoom_out" => {
            if let Some(window) = app.get_webview_window("main") {
                window.emit("menu-zoom-out", ()).ok();
            }
        }
        "reset_zoom" => {
            if let Some(window) = app.get_webview_window("main") {
                window.emit("menu-reset-zoom", ()).ok();
            }
        }
        _ => {}
    }
}
