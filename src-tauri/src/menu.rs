use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager, Wry,
};

// Import for opening URLs in browser
use tauri_plugin_opener::OpenerExt;

fn build_file_menu_with_settings(
    app: &AppHandle,
    settings_label: &str,
    settings_shortcut: &str,
) -> Result<Submenu<Wry>, tauri::Error> {
    Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "open", "Open...", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "print", "Print", true, Some("CmdOrCtrl+P"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", settings_label, true, Some(settings_shortcut))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("Close"))?,
        ],
    )
}

fn build_file_menu(app: &AppHandle) -> Result<Submenu<Wry>, tauri::Error> {
    Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "open", "Open...", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "print", "Print", true, Some("CmdOrCtrl+P"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("Close"))?,
        ],
    )
}

#[cfg(target_os = "macos")]
fn build_app_menu(app: &AppHandle) -> Result<Submenu<Wry>, tauri::Error> {
    let app_name = app.package_info().name.clone();
    Submenu::with_items(
        app,
        app_name,
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "Settings...", true, Some("Cmd+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )
}

fn build_edit_menu(app: &AppHandle) -> Result<Submenu<Wry>, tauri::Error> {
    Submenu::with_items(
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
    )
}

fn build_view_menu(app: &AppHandle) -> Result<Submenu<Wry>, tauri::Error> {
    Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, "zoom_in", "Zoom In", true, Some("CmdOrCtrl+Plus"))?,
            &MenuItem::with_id(app, "zoom_out", "Zoom Out", true, Some("CmdOrCtrl+-"))?,
            &MenuItem::with_id(app, "reset_zoom", "Reset Zoom", true, Some("CmdOrCtrl+0"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "toggle_fullscreen",
                "Toggle Fullscreen",
                true,
                Some("F11"),
            )?,
        ],
    )
}

fn build_window_menu(app: &AppHandle) -> Result<Submenu<Wry>, tauri::Error> {
    Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &MenuItem::with_id(app, "close_tab", "Close Tab", true, Some("CmdOrCtrl+W"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
        ],
    )
}

fn build_help_menu(app: &AppHandle) -> Result<Submenu<Wry>, tauri::Error> {
    Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, "learn_more", "Learn More", true, None::<&str>)?,
            &MenuItem::with_id(app, "license", "License", true, None::<&str>)?,
            &MenuItem::with_id(app, "bugs", "Report Bug", true, None::<&str>)?,
            &MenuItem::with_id(app, "contact", "Contact", true, None::<&str>)?,
        ],
    )
}

fn emit_to_main(app: &AppHandle, event: &str) {
    if let Some(window) = app.get_webview_window("main") {
        window.emit(event, ()).ok();
    }
}

/// Create the application menu
pub fn create_menu(app: &AppHandle) -> Result<Menu<Wry>, tauri::Error> {
    // Create menu with platform-specific Settings placement
    #[cfg(target_os = "macos")]
    {
        // On macOS, add settings with Cmd+, shortcut to the app menu
        let app_menu = build_app_menu(app)?;
        let file_menu = build_file_menu(app)?;
        let edit_menu = build_edit_menu(app)?;
        let view_menu = build_view_menu(app)?;
        let window_menu = build_window_menu(app)?;
        let help_menu = build_help_menu(app)?;

        Menu::with_items(
            app,
            &[
                &app_menu,
                &file_menu,
                &edit_menu,
                &view_menu,
                &window_menu,
                &help_menu,
            ],
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        // On Windows/Linux, add settings with Alt+S to File menu
        let file_menu_with_settings = build_file_menu_with_settings(app, "Settings", "Alt+S")?;
        let edit_menu = build_edit_menu(app)?;
        let view_menu = build_view_menu(app)?;
        let window_menu = build_window_menu(app)?;
        let help_menu = build_help_menu(app)?;

        Menu::with_items(
            app,
            &[
                &file_menu_with_settings,
                &edit_menu,
                &view_menu,
                &window_menu,
                &help_menu,
            ],
        )
    }
}

/// Handle menu events
pub fn handle_menu_event(app: &AppHandle, event_id: &str) {
    match event_id {
        "open" => {
            // Emit event to frontend to open file dialog
            emit_to_main(app, "menu-open");
        }
        "print" => {
            // Emit event to frontend to print
            emit_to_main(app, "menu-print");
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
            emit_to_main(app, "menu-zoom-in");
        }
        "zoom_out" => {
            emit_to_main(app, "menu-zoom-out");
        }
        "reset_zoom" => {
            emit_to_main(app, "menu-reset-zoom");
        }
        "toggle_fullscreen" => {
            emit_to_main(app, "menu-toggle-fullscreen");
        }
        "close_tab" => {
            emit_to_main(app, "menu-close-tab");
        }
        "learn_more" => {
            // Open GitHub repo in browser (placeholder URL)
            let _ = app.opener().open_url("https://github.com/yourusername/yourrepo", None::<&str>);
        }
        "license" => {
            // Open LICENSE file in browser (placeholder URL)
            let _ = app.opener().open_url(
                "https://github.com/yourusername/yourrepo/blob/master/LICENSE",
                None::<&str>,
            );
        }
        "bugs" => {
            // Open GitHub issues in browser (placeholder URL)
            let _ = app.opener().open_url(
                "https://github.com/yourusername/yourrepo/issues",
                None::<&str>,
            );
        }
        "contact" => {
            // Open email client (placeholder email)
            let _ = app.opener().open_url("mailto:your-email@example.com", None::<&str>);
        }
        _ => {}
    }
}
