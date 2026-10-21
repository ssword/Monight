use serde::Deserialize;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager, Wry,
};

// Import for opening URLs in browser
use tauri_plugin_opener::OpenerExt;

#[cfg(target_os = "macos")]
fn build_file_menu(app: &AppHandle) -> Result<Submenu<Wry>, tauri::Error> {
    Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "open", "Open...", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(
                app,
                "save-as",
                "Save As...",
                true,
                Some("CmdOrCtrl+Shift+S"),
            )?,
            &MenuItem::with_id(app, "print", "Print", true, Some("CmdOrCtrl+P"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("Close"))?,
        ],
    )
}

#[cfg(not(target_os = "macos"))]
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
            &MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(
                app,
                "save-as",
                "Save As...",
                true,
                Some("CmdOrCtrl+Shift+S"),
            )?,
            &MenuItem::with_id(app, "print", "Print", true, Some("CmdOrCtrl+P"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "settings",
                settings_label,
                true,
                Some(settings_shortcut),
            )?,
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
            &MenuItem::with_id(app, "quit", "Quit", true, Some("Cmd+Q"))?,
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

/// One entry of the reader menus (View, Go, Tools). Ids are the reader command
/// ids of src/app/reader-commands.ts; their enabled, checked, title and
/// accelerator state is set from TypeScript through `set_menu_item_states`, so
/// accelerators always show the reader's effective keybinds.
#[derive(Clone, Copy, Debug)]
enum ReaderMenuEntry {
    Command {
        id: &'static str,
        text: &'static str,
    },
    Check {
        id: &'static str,
        text: &'static str,
    },
    /// A submenu whose items TypeScript fills from its own lists
    /// (`set_menu_submenu_items`): the filter presets and the verified tools.
    Listed {
        id: &'static str,
        text: &'static str,
    },
    /// Items TypeScript lists inline at the end of the menu, after a separator,
    /// with `set_menu_submenu_items`; empty until TypeScript fills it. Used for
    /// Rotate Left and Right, which exist only once Page Rotation is verified
    /// (PAGE_ROTATION_VERIFIED in src/app/markup-tools.ts).
    Section {
        id: &'static str,
    },
    Separator,
}

use ReaderMenuEntry::{Check, Command, Listed, Section, Separator};

const fn command(id: &'static str, text: &'static str) -> ReaderMenuEntry {
    Command { id, text }
}

const fn check(id: &'static str, text: &'static str) -> ReaderMenuEntry {
    Check { id, text }
}

const VIEW_MENU: &[ReaderMenuEntry] = &[
    command("view.tab-bar", "Show Tab Bar"),
    Separator,
    check("view.sidebar.hidden", "Hide Sidebar"),
    check("view.sidebar.thumbnails", "Thumbnails"),
    check("view.sidebar.tableOfContents", "Table of Contents"),
    check("view.sidebar.annotations", "Highlights and Notes"),
    Separator,
    check("view.mode.continuous", "Continuous Scroll"),
    check("view.mode.single", "Single Page"),
    check("view.mode.spread", "Two Pages"),
    Separator,
    command("view.zoom.actual-size", "Actual Size"),
    command("view.zoom.fit", "Zoom to Fit"),
    command("view.zoom.width", "Zoom to Width"),
    command("view.zoom.in", "Zoom In"),
    command("view.zoom.out", "Zoom Out"),
    Separator,
    command("view.markup-toolbar", "Show Markup Toolbar"),
    Listed {
        id: "view.appearance",
        text: "Appearance",
    },
    Separator,
    command("view.slideshow", "Slideshow"),
    command("view.full-screen", "Enter Full Screen"),
];

const GO_MENU: &[ReaderMenuEntry] = &[
    command("go.previous-page", "Previous Page"),
    command("go.next-page", "Next Page"),
    Separator,
    command("go.page", "Go to Page\u{2026}"),
    Separator,
    command("go.back", "Back"),
    command("go.forward", "Forward"),
];

const TOOLS_MENU: &[ReaderMenuEntry] = &[
    check("tools.text-selection", "Text Selection"),
    Listed {
        id: "tools.annotate",
        text: "Annotate",
    },
    Section { id: "tools.rotate" },
];

const READER_MENUS: [&[ReaderMenuEntry]; 3] = [VIEW_MENU, GO_MENU, TOOLS_MENU];

/// Reader commands are forwarded to the WebView, which owns reader state.
const READER_COMMAND_PREFIXES: [&str; 3] = ["view.", "go.", "tools."];

fn reader_command(event_id: &str) -> Option<&str> {
    READER_COMMAND_PREFIXES
        .iter()
        .any(|prefix| event_id.starts_with(prefix))
        .then_some(event_id)
}

/// Full screen applies without a Document; every other reader item starts
/// disabled until the WebView reports the reader's state.
fn initially_enabled(id: &str) -> bool {
    id == "view.full-screen"
}

fn build_reader_menu(
    app: &AppHandle,
    text: &str,
    entries: &[ReaderMenuEntry],
) -> Result<Submenu<Wry>, tauri::Error> {
    let submenu = Submenu::new(app, text, true)?;
    for entry in entries {
        match *entry {
            Command { id, text } => submenu.append(&MenuItem::with_id(
                app,
                id,
                text,
                initially_enabled(id),
                None::<&str>,
            )?)?,
            Check { id, text } => submenu.append(&CheckMenuItem::with_id(
                app,
                id,
                text,
                initially_enabled(id),
                false,
                None::<&str>,
            )?)?,
            Listed { id, text } => submenu.append(&Submenu::with_id(app, id, text, true)?)?,
            Section { .. } => {}
            Separator => submenu.append(&PredefinedMenuItem::separator(app)?)?,
        }
    }
    Ok(submenu)
}

fn build_view_menu(app: &AppHandle) -> Result<Submenu<Wry>, tauri::Error> {
    build_reader_menu(app, "View", VIEW_MENU)
}

fn build_go_menu(app: &AppHandle) -> Result<Submenu<Wry>, tauri::Error> {
    build_reader_menu(app, "Go", GO_MENU)
}

fn build_tools_menu(app: &AppHandle) -> Result<Submenu<Wry>, tauri::Error> {
    build_reader_menu(app, "Tools", TOOLS_MENU)
}

/// A native menu item's state as reported by the WebView; absent fields are kept.
#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MenuItemState {
    id: String,
    enabled: Option<bool>,
    checked: Option<bool>,
    text: Option<String>,
    /// Absent: kept; `null`: removed; a string: shown (a Tauri accelerator).
    #[serde(default, deserialize_with = "present")]
    accelerator: Option<Option<String>>,
}

/// Tells a field sent as `null` apart from an absent one.
fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

/// An item of a submenu filled from a TypeScript list.
#[derive(Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ListedMenuItem {
    id: String,
    text: String,
}

fn find_menu_item(items: Vec<MenuItemKind<Wry>>, id: &str) -> Option<MenuItemKind<Wry>> {
    for item in items {
        if item.id().0 == id {
            return Some(item);
        }
        if let Some(submenu) = item.as_submenu() {
            if let Some(found) = find_menu_item(submenu.items().unwrap_or_default(), id) {
                return Some(found);
            }
        }
    }
    None
}

fn app_menu_item(app: &AppHandle, id: &str) -> Option<MenuItemKind<Wry>> {
    find_menu_item(app.menu()?.items().ok()?, id)
}

fn apply_menu_item_state(item: &MenuItemKind<Wry>, state: &MenuItemState) {
    match item {
        MenuItemKind::MenuItem(item) => {
            if let Some(enabled) = state.enabled {
                item.set_enabled(enabled).ok();
            }
            if let Some(text) = &state.text {
                item.set_text(text).ok();
            }
            if let Some(accelerator) = &state.accelerator {
                item.set_accelerator(accelerator.as_deref()).ok();
            }
        }
        MenuItemKind::Check(item) => {
            if let Some(enabled) = state.enabled {
                item.set_enabled(enabled).ok();
            }
            if let Some(checked) = state.checked {
                item.set_checked(checked).ok();
            }
            if let Some(text) = &state.text {
                item.set_text(text).ok();
            }
            if let Some(accelerator) = &state.accelerator {
                item.set_accelerator(accelerator.as_deref()).ok();
            }
        }
        MenuItemKind::Submenu(item) => {
            if let Some(enabled) = state.enabled {
                item.set_enabled(enabled).ok();
            }
            if let Some(text) = &state.text {
                item.set_text(text).ok();
            }
        }
        _ => {}
    }
}

/// Applies enabled, checked and title state to native menu items by id,
/// searching every submenu. Unknown ids are ignored.
#[tauri::command]
pub fn set_menu_item_states(app: AppHandle, items: Vec<MenuItemState>) {
    for state in &items {
        if let Some(item) = app_menu_item(&app, &state.id) {
            apply_menu_item_state(&item, state);
        }
    }
}

fn is_listed_submenu(id: &str) -> bool {
    READER_MENUS
        .iter()
        .flat_map(|entries| entries.iter())
        .any(|entry| matches!(entry, Listed { id: listed, .. } if *listed == id))
}

/// For an inline section: how many native items precede it in its menu (every
/// entry before it builds exactly one item; sections end their menu).
fn section_start(id: &str) -> Option<usize> {
    READER_MENUS.iter().find_map(|entries| {
        entries
            .iter()
            .position(|entry| matches!(entry, Section { id: section } if *section == id))
    })
}

/// The reader menu holding a section, found through its first entry's item.
fn section_menu(app: &AppHandle, id: &str) -> Option<Submenu<Wry>> {
    let entries = READER_MENUS.iter().find(|entries| {
        entries
            .iter()
            .any(|entry| matches!(entry, Section { id: section } if *section == id))
    })?;
    let first = entries.iter().find_map(|entry| match *entry {
        Command { id, .. } | Check { id, .. } | Listed { id, .. } => Some(id),
        Section { .. } | Separator => None,
    })?;
    app.menu()?.items().ok()?.into_iter().find_map(|item| {
        let submenu = item.as_submenu()?.clone();
        submenu
            .items()
            .ok()?
            .iter()
            .any(|child| child.id().0 == first)
            .then_some(submenu)
    })
}

/// Replaces an inline section's items: a separator and plain items, or nothing.
fn set_section_items(
    app: &AppHandle,
    section_id: &str,
    start: usize,
    items: &[&ListedMenuItem],
) -> Result<(), String> {
    let Some(menu) = section_menu(app, section_id) else {
        return Err(format!("{section_id} is not in the menu"));
    };
    for item in menu
        .items()
        .map_err(|e| e.to_string())?
        .into_iter()
        .skip(start)
    {
        menu.remove(&item).map_err(|e| e.to_string())?;
    }
    if items.is_empty() {
        return Ok(());
    }
    menu.append(&PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    for item in items {
        let entry = MenuItem::with_id(app, &item.id, &item.text, false, None::<&str>)
            .map_err(|e| e.to_string())?;
        menu.append(&entry).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Items of a listed submenu must carry its id as their prefix, so they are
/// forwarded as reader commands and cannot shadow other items.
fn listed_items<'a>(
    submenu_id: &str,
    items: &'a [ListedMenuItem],
) -> Result<Vec<&'a ListedMenuItem>, String> {
    if !is_listed_submenu(submenu_id) && section_start(submenu_id).is_none() {
        return Err(format!("{submenu_id} is not a listed submenu"));
    }
    let prefix = format!("{submenu_id}.");
    Ok(items
        .iter()
        .filter(|item| item.id.len() > prefix.len() && item.id.starts_with(&prefix))
        .collect())
}

/// Replaces a listed submenu's items with check items, so the menu always
/// shows exactly the TypeScript list (filter presets, verified tools), or an
/// inline section's items with plain items (Rotate).
#[tauri::command]
pub fn set_menu_submenu_items(
    app: AppHandle,
    submenu_id: String,
    items: Vec<ListedMenuItem>,
) -> Result<(), String> {
    let items = listed_items(&submenu_id, &items)?;
    if let Some(start) = section_start(&submenu_id) {
        return set_section_items(&app, &submenu_id, start, &items);
    }
    let Some(MenuItemKind::Submenu(submenu)) = app_menu_item(&app, &submenu_id) else {
        return Err(format!("{submenu_id} is not in the menu"));
    };
    for item in submenu.items().map_err(|e| e.to_string())? {
        submenu.remove(&item).map_err(|e| e.to_string())?;
    }
    for item in items {
        let check = CheckMenuItem::with_id(&app, &item.id, &item.text, false, false, None::<&str>)
            .map_err(|e| e.to_string())?;
        submenu.append(&check).map_err(|e| e.to_string())?;
    }
    Ok(())
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

fn quit_lifecycle_event(event_id: &str) -> Option<&'static str> {
    (event_id == "quit").then_some("application-quit-requested")
}

fn help_url(event_id: &str) -> Option<&'static str> {
    match event_id {
        "learn_more" => Some("https://github.com/ssword/Monight"),
        "license" => Some("https://github.com/ssword/Monight#license"),
        "bugs" => Some("https://github.com/ssword/Monight/issues/new"),
        "contact" => Some("https://github.com/ssword"),
        _ => None,
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
        let go_menu = build_go_menu(app)?;
        let tools_menu = build_tools_menu(app)?;
        let window_menu = build_window_menu(app)?;
        let help_menu = build_help_menu(app)?;

        Menu::with_items(
            app,
            &[
                &app_menu,
                &file_menu,
                &edit_menu,
                &view_menu,
                &go_menu,
                &tools_menu,
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
        let go_menu = build_go_menu(app)?;
        let tools_menu = build_tools_menu(app)?;
        let window_menu = build_window_menu(app)?;
        let help_menu = build_help_menu(app)?;

        Menu::with_items(
            app,
            &[
                &file_menu_with_settings,
                &edit_menu,
                &view_menu,
                &go_menu,
                &tools_menu,
                &window_menu,
                &help_menu,
            ],
        )
    }
}

/// Handle menu events
pub fn handle_menu_event(app: &AppHandle, event_id: &str) {
    if let Some(event) = quit_lifecycle_event(event_id) {
        debug_assert_eq!(event, "application-quit-requested");
        crate::request_application_quit(app);
        return;
    }

    if let Some(command) = reader_command(event_id) {
        if let Some(window) = app.get_webview_window("main") {
            window.emit("menu-command", command).ok();
        }
        return;
    }

    match event_id {
        "open" => {
            // Emit event to frontend to open file dialog
            emit_to_main(app, "menu-open");
        }
        "save" => emit_to_main(app, "menu-save"),
        "save-as" => emit_to_main(app, "menu-save-as"),
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
        "close_tab" => {
            emit_to_main(app, "menu-close-tab");
        }
        "learn_more" | "license" | "bugs" | "contact" => {
            if let Some(url) = help_url(event_id) {
                let _ = app.opener().open_url(url, None::<&str>);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn help_destinations_use_the_real_project_pages() {
        assert_eq!(
            help_url("learn_more"),
            Some("https://github.com/ssword/Monight")
        );
        assert_eq!(
            help_url("license"),
            Some("https://github.com/ssword/Monight#license")
        );
        assert_eq!(
            help_url("bugs"),
            Some("https://github.com/ssword/Monight/issues/new")
        );
        assert_eq!(help_url("contact"), Some("https://github.com/ssword"));
    }

    fn reader_menu_tables() -> &'static str {
        let source = include_str!("menu.rs");
        let start = source.find("const VIEW_MENU").unwrap();
        let end = source.find("const READER_MENUS").unwrap();
        &source[start..end]
    }

    fn titles(entries: &[ReaderMenuEntry]) -> Vec<&'static str> {
        entries
            .iter()
            .map(|entry| match *entry {
                Command { text, .. } | Check { text, .. } | Listed { text, .. } => text,
                Section { .. } => "[section]",
                Separator => "-",
            })
            .collect()
    }

    fn ids() -> Vec<&'static str> {
        READER_MENUS
            .iter()
            .flat_map(|entries| entries.iter())
            .filter_map(|entry| match *entry {
                Command { id, .. } | Check { id, .. } | Listed { id, .. } | Section { id } => {
                    Some(id)
                }
                Separator => None,
            })
            .collect()
    }

    #[test]
    fn view_menu_is_structured_like_preview() {
        assert_eq!(
            titles(VIEW_MENU),
            [
                "Show Tab Bar",
                "-",
                "Hide Sidebar",
                "Thumbnails",
                "Table of Contents",
                "Highlights and Notes",
                "-",
                "Continuous Scroll",
                "Single Page",
                "Two Pages",
                "-",
                "Actual Size",
                "Zoom to Fit",
                "Zoom to Width",
                "Zoom In",
                "Zoom Out",
                "-",
                "Show Markup Toolbar",
                "Appearance",
                "-",
                "Slideshow",
                "Enter Full Screen",
            ]
        );
        assert_eq!(
            titles(GO_MENU),
            [
                "Previous Page",
                "Next Page",
                "-",
                "Go to Page\u{2026}",
                "-",
                "Back",
                "Forward"
            ]
        );
        assert_eq!(
            titles(TOOLS_MENU),
            ["Text Selection", "Annotate", "[section]"]
        );
    }

    #[test]
    fn sidebar_view_mode_and_tool_items_show_check_marks() {
        let checks: Vec<_> = READER_MENUS
            .iter()
            .flat_map(|entries| entries.iter())
            .filter_map(|entry| match *entry {
                Check { id, .. } => Some(id),
                _ => None,
            })
            .collect();
        assert_eq!(
            checks,
            [
                "view.sidebar.hidden",
                "view.sidebar.thumbnails",
                "view.sidebar.tableOfContents",
                "view.sidebar.annotations",
                "view.mode.continuous",
                "view.mode.single",
                "view.mode.spread",
                "tools.text-selection",
            ]
        );
    }

    #[test]
    fn reader_menu_accelerators_come_from_the_effective_keybinds() {
        // Accelerators follow the reader's keybinds, which the WebView sends
        // through set_menu_item_states; the menu tables fix none of their own.
        assert!(!reader_menu_tables().contains("Some(\"CmdOrCtrl"));
        assert!(!reader_menu_tables().contains("Some(\"F11\")"));
    }

    #[test]
    fn every_reader_menu_item_is_forwarded_as_a_reader_command() {
        let ids = ids();
        let unique: std::collections::BTreeSet<_> = ids.iter().collect();
        assert_eq!(unique.len(), ids.len(), "menu ids must be unique");
        for id in ids {
            assert_eq!(reader_command(id), Some(id));
        }
        assert_eq!(
            reader_command("tools.annotate.highlight"),
            Some("tools.annotate.highlight")
        );
        assert_eq!(reader_command("print"), None);
        assert_eq!(reader_command("close_tab"), None);
    }

    #[test]
    fn only_full_screen_applies_before_the_webview_reports_state() {
        let enabled: Vec<_> = ids()
            .into_iter()
            .filter(|id| initially_enabled(id))
            .collect();
        assert_eq!(enabled, ["view.full-screen"]);
    }

    #[test]
    fn reads_menu_item_states_from_the_webview() {
        let states: Vec<MenuItemState> = serde_json::from_value(serde_json::json!([
            { "id": "view.mode.single", "enabled": true, "checked": false },
            { "id": "view.full-screen", "text": "Exit Full Screen" }
        ]))
        .unwrap();
        assert_eq!(
            states,
            [
                MenuItemState {
                    id: "view.mode.single".into(),
                    enabled: Some(true),
                    checked: Some(false),
                    text: None,
                    accelerator: None,
                },
                MenuItemState {
                    id: "view.full-screen".into(),
                    enabled: None,
                    checked: None,
                    text: Some("Exit Full Screen".into()),
                    accelerator: None,
                },
            ]
        );
    }

    #[test]
    fn reads_set_and_removed_accelerators_from_the_webview() {
        let states: Vec<MenuItemState> = serde_json::from_value(serde_json::json!([
            { "id": "view.mode.single", "accelerator": "CmdOrCtrl+2" },
            { "id": "view.mode.spread", "accelerator": null },
            { "id": "view.mode.continuous" }
        ]))
        .unwrap();
        let accelerators: Vec<_> = states.iter().map(|state| &state.accelerator).collect();
        assert_eq!(
            accelerators,
            [&Some(Some("CmdOrCtrl+2".into())), &Some(None), &None]
        );
    }

    #[test]
    fn listed_submenus_accept_only_their_own_items() {
        let items: Vec<ListedMenuItem> = serde_json::from_value(serde_json::json!([
            { "id": "tools.annotate.highlight", "text": "Highlight" },
            { "id": "print", "text": "Print" },
            { "id": "tools.annotate.", "text": "Empty" },
            { "id": "tools.annotate.textComment", "text": "Text Note" }
        ]))
        .unwrap();
        let accepted: Vec<_> = listed_items("tools.annotate", &items)
            .unwrap()
            .into_iter()
            .map(|item| item.id.as_str())
            .collect();
        assert_eq!(
            accepted,
            ["tools.annotate.highlight", "tools.annotate.textComment"]
        );
        assert!(listed_items("view.appearance", &[]).is_ok());
        assert!(listed_items("view.zoom.in", &items).is_err());
    }

    #[test]
    fn rotate_items_are_listed_inline_at_the_end_of_the_tools_menu() {
        // Rust cannot see PAGE_ROTATION_VERIFIED: TypeScript fills the section
        // only once Page Rotation is verified, so the menu has no Rotate item
        // until then.
        assert_eq!(section_start("tools.rotate"), Some(2));
        assert_eq!(section_start("tools.annotate"), None);
        assert_eq!(section_start("tools.text-selection"), None);
        let items: Vec<ListedMenuItem> = serde_json::from_value(serde_json::json!([
            { "id": "tools.rotate.left", "text": "Rotate Left" },
            { "id": "tools.annotate.highlight", "text": "Highlight" },
            { "id": "tools.rotate.right", "text": "Rotate Right" }
        ]))
        .unwrap();
        let accepted: Vec<_> = listed_items("tools.rotate", &items)
            .unwrap()
            .into_iter()
            .map(|item| item.id.as_str())
            .collect();
        assert_eq!(accepted, ["tools.rotate.left", "tools.rotate.right"]);
    }

    #[test]
    fn sections_end_their_menu() {
        for entries in READER_MENUS {
            if let Some(position) = entries
                .iter()
                .position(|entry| matches!(entry, Section { .. }))
            {
                assert_eq!(position, entries.len() - 1);
            }
        }
    }

    #[test]
    fn quit_menu_requests_the_frontend_lifecycle_handshake() {
        assert_eq!(
            quit_lifecycle_event("quit"),
            Some("application-quit-requested")
        );
        assert_eq!(quit_lifecycle_event("close_tab"), None);
    }
}
