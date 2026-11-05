#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod pdf;
#[cfg(feature = "selftest")]
mod selftest;

use serde::Serialize;
use std::{fs, path::{Path, PathBuf}, sync::atomic::{AtomicBool, Ordering}, thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Theme, WebviewWindow, WindowEvent};
#[cfg(not(feature = "selftest"))]
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

const CHAT_URLS: [&str; 2] = ["https://chatgpt.com/?q=", "https://claude.ai/new?q="];

static READY_TO_EXIT: AtomicBool = AtomicBool::new(false);
static WAS_FULLSCREEN: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
struct RawEntry { filename: String, content: String, folder: Option<String> }

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(feature = "selftest")]
    if let Ok(path) = std::env::var("RUNON_DATA_DIR") { return Ok(PathBuf::from(path)); }
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("Runon");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Entries are named [UUID]-[yyyy-MM-dd-HH-mm-ss].md. Anything else is refused,
/// so the interface can never reach a file outside the entries folder.
pub fn is_entry_filename(name: &str) -> bool {
    const SHAPE: &str = "[HHHHHHHH-HHHH-HHHH-HHHH-HHHHHHHHHHHH]-[DDDD-DD-DD-DD-DD-DD].md";
    name.len() == SHAPE.len() && name.bytes().zip(SHAPE.bytes()).all(|(c, want)| match want {
        b'H' => c.is_ascii_hexdigit(),
        b'D' => c.is_ascii_digit(),
        other => c == other,
    })
}

/// Folders are ordinary folders inside the entries folder, and can hold more folders.
/// Each part of a folder path has to be a plain name, so it can never point anywhere else.
pub fn is_folder_name(name: &str) -> bool {
    !name.is_empty()
        && name == name.trim()
        && name.chars().count() <= 60
        && !name.starts_with('.')
        && !name.ends_with('.')
        && !name.chars().any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
}

const MAX_FOLDER_DEPTH: usize = 32;

/// Folder paths always use "/" between parts, on every platform.
fn folder_path(root: &Path, folder: &str) -> Result<PathBuf, String> {
    let parts: Vec<&str> = folder.split('/').collect();
    if parts.len() > MAX_FOLDER_DEPTH || !parts.iter().all(|part| is_folder_name(part)) {
        return Err("Folder names can't use / \\ : * ? \" < > | or start with a dot".into());
    }
    Ok(parts.iter().fold(root.to_path_buf(), |path, part| path.join(part)))
}

/// Every folder under `dir`, as paths relative to the entries folder.
/// Links to other folders are skipped, so a loop can't trap the walk.
fn collect_folders(dir: &Path, prefix: Option<&str>, depth: usize, out: &mut Vec<String>) -> Result<(), String> {
    if depth >= MAX_FOLDER_DEPTH { return Ok(()); }
    for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let is_dir = item.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        let name = item.file_name().to_string_lossy().into_owned();
        if !is_dir || !is_folder_name(&name) { continue; }
        let relative = match prefix { Some(parent) => format!("{parent}/{name}"), None => name };
        collect_folders(&item.path(), Some(&relative), depth + 1, out)?;
        out.push(relative);
    }
    Ok(())
}

fn all_folders(root: &Path) -> Result<Vec<String>, String> {
    let mut folders = Vec::new();
    collect_folders(root, None, 0, &mut folders)?;
    Ok(folders)
}

/// Filenames are unique, so an entry is found wherever it lives. A new entry starts at the top.
pub fn entry_path(app: &AppHandle, filename: &str) -> Result<PathBuf, String> {
    if !is_entry_filename(filename) { return Err("Invalid entry filename".into()); }
    let root = data_dir(app)?;
    let top = root.join(filename);
    if top.exists() { return Ok(top); }
    for folder in all_folders(&root)? {
        let nested = folder_path(&root, &folder)?.join(filename);
        if nested.exists() { return Ok(nested); }
    }
    Ok(top)
}

#[tauri::command]
fn folder(app: AppHandle) -> Result<String, String> {
    Ok(data_dir(&app)?.to_string_lossy().into_owned())
}

fn read_entries(dir: &Path, folder: Option<&str>, entries: &mut Vec<RawEntry>) -> Result<(), String> {
    for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let path = item.map_err(|e| e.to_string())?.path();
        let filename = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
        if is_entry_filename(&filename) {
            entries.push(RawEntry {
                filename,
                content: fs::read_to_string(&path).map_err(|e| e.to_string())?,
                folder: folder.map(str::to_owned),
            });
        }
    }
    Ok(())
}

#[tauri::command]
fn list_entries(app: AppHandle) -> Result<Vec<RawEntry>, String> {
    let root = data_dir(&app)?;
    let mut entries = Vec::new();
    read_entries(&root, None, &mut entries)?;
    for folder in all_folders(&root)? {
        read_entries(&folder_path(&root, &folder)?, Some(&folder), &mut entries)?;
    }
    Ok(entries)
}

#[tauri::command]
fn list_folders(app: AppHandle) -> Result<Vec<String>, String> {
    all_folders(&data_dir(&app)?)
}

/// `name` is the full path of the new folder, so "Work/Ideas" makes Ideas inside Work.
#[tauri::command]
fn create_folder(app: AppHandle, name: String) -> Result<(), String> {
    fs::create_dir(folder_path(&data_dir(&app)?, &name)?).map_err(|e| e.to_string())
}

/// Renames the last part of the path. The folder stays where it is.
#[tauri::command]
fn rename_folder(app: AppHandle, name: String, new_name: String) -> Result<(), String> {
    if !is_folder_name(&new_name) { return Err("Folder names can't use / \\ : * ? \" < > | or start with a dot".into()); }
    let source = folder_path(&data_dir(&app)?, &name)?;
    let target = source.with_file_name(&new_name);
    let old_name = source.file_name().unwrap_or_default().to_string_lossy().into_owned();
    // Changing only the capitals is fine, even though Mac and Windows see the same folder.
    if target.exists() && old_name.to_lowercase() != new_name.to_lowercase() {
        return Err("A folder with that name already exists".into());
    }
    fs::rename(source, target).map_err(|e| e.to_string())
}

/// Files the system leaves behind, which are safe to throw away with a folder.
fn is_clutter(name: &str) -> bool {
    name.starts_with('.') || name.ends_with(".md.tmp") || name.eq_ignore_ascii_case("Thumbs.db") || name.eq_ignore_ascii_case("desktop.ini")
}

/// Finds the first file in `dir` that isn't an entry or clutter, looking inside subfolders too.
fn other_file(dir: &Path) -> Result<Option<String>, String> {
    for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let name = item.file_name().to_string_lossy().into_owned();
        let kind = item.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() {
            if let Some(found) = other_file(&item.path())? { return Ok(Some(found)); }
        } else if !is_entry_filename(&name) && !is_clutter(&name) {
            return Ok(Some(name));
        }
    }
    Ok(None)
}

fn move_entries_out(dir: &Path, to: &Path) -> Result<(), String> {
    for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let path = item.path();
        let filename = item.file_name().to_string_lossy().into_owned();
        if item.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            move_entries_out(&path, to)?;
        } else if is_entry_filename(&filename) {
            fs::rename(&path, to.join(&filename)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Entries anywhere inside go up to the folder that held this one, so deleting a
/// folder never deletes writing. A folder holding files Runon didn't make is left alone.
#[tauri::command]
fn delete_folder(app: AppHandle, name: String) -> Result<(), String> {
    let dir = folder_path(&data_dir(&app)?, &name)?;
    let parent = dir.parent().ok_or("That folder has no parent")?.to_path_buf();
    if let Some(found) = other_file(&dir)? {
        return Err(format!("This folder also holds \u{201c}{found}\u{201d}, which isn't a Runon entry, so it was left in place. Move that file out in Finder first."));
    }
    move_entries_out(&dir, &parent)?;
    #[cfg(feature = "selftest")]
    return fs::remove_dir_all(dir).map_err(|e| e.to_string());
    #[cfg(not(feature = "selftest"))]
    trash::delete(dir).map_err(|e| e.to_string())
}

/// Moves an entry into a folder, or back to the top when there's no folder.
#[tauri::command]
fn move_entry(app: AppHandle, filename: String, folder: Option<String>) -> Result<(), String> {
    let source = entry_path(&app, &filename)?;
    let root = data_dir(&app)?;
    let dir = match folder {
        Some(name) => folder_path(&root, &name)?,
        None => root,
    };
    if !dir.is_dir() { return Err("That folder no longer exists".into()); }
    fs::rename(source, dir.join(&filename)).map_err(|e| e.to_string())
}

/// Moves a folder, with everything in it, into another folder or back to the top.
#[tauri::command]
fn move_folder(app: AppHandle, name: String, into: Option<String>) -> Result<(), String> {
    if let Some(target) = &into {
        if target == &name || target.starts_with(&format!("{name}/")) {
            return Err("A folder can't go inside itself".into());
        }
    }
    let root = data_dir(&app)?;
    let source = folder_path(&root, &name)?;
    let dir = match &into {
        Some(target) => folder_path(&root, target)?,
        None => root,
    };
    if !dir.is_dir() { return Err("That folder no longer exists".into()); }
    let target = dir.join(source.file_name().ok_or("Invalid folder")?);
    if target.exists() { return Err("A folder with that name is already there".into()); }
    fs::rename(source, target).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_entry(app: AppHandle, filename: String) -> Result<String, String> {
    fs::read_to_string(entry_path(&app, &filename)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_entry(app: AppHandle, filename: String, text: String) -> Result<(), String> {
    let target = entry_path(&app, &filename)?;
    let temp = target.with_extension("md.tmp");
    fs::write(&temp, text).map_err(|e| e.to_string())?;
    fs::rename(&temp, &target).map_err(|e| e.to_string())
}

#[tauri::command]
fn trash_entry(app: AppHandle, filename: String) -> Result<(), String> {
    let path = entry_path(&app, &filename)?;
    #[cfg(feature = "selftest")]
    return fs::remove_file(path).map_err(|e| e.to_string());
    #[cfg(not(feature = "selftest"))]
    trash::delete(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_folder(app: AppHandle) -> Result<(), String> {
    let path = data_dir(&app)?.to_string_lossy().into_owned();
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_chat(app: AppHandle, url: String) -> Result<(), String> {
    if !CHAT_URLS.iter().any(|prefix| url.starts_with(prefix)) { return Err("Not allowed".into()); }
    #[cfg(feature = "selftest")]
    { let _ = &app; selftest::record(url); return Ok(()); }
    #[cfg(not(feature = "selftest"))]
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn copy_text(app: AppHandle, text: String) -> Result<(), String> {
    #[cfg(feature = "selftest")]
    { let _ = &app; selftest::record(text); return Ok(()); }
    #[cfg(not(feature = "selftest"))]
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_fonts() -> Result<Vec<String>, String> {
    font_kit::source::SystemSource::new().all_families().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_theme(window: WebviewWindow, dark: bool) -> Result<(), String> {
    window.set_theme(Some(if dark { Theme::Dark } else { Theme::Light })).map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_fullscreen(window: WebviewWindow) -> Result<(), String> {
    let next = !window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_fullscreen(next).map_err(|e| e.to_string())
}

#[tauri::command]
fn exit_now(app: AppHandle) {
    READY_TO_EXIT.store(true, Ordering::SeqCst);
    app.exit(0);
}

/// Asks the page to finish saving, then quits. Quits anyway if the page doesn't answer.
fn request_flush(app: &AppHandle) {
    let _ = app.emit("flush", ());
    let handle = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(2));
        READY_TO_EXIT.store(true, Ordering::SeqCst);
        handle.exit(0);
    });
}

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(pdf::Jobs::default());

    #[cfg(feature = "selftest")]
    let builder = builder.on_page_load(selftest::on_page_load);

    builder
        .invoke_handler(tauri::generate_handler![
        folder, list_entries, list_folders, create_folder, rename_folder, delete_folder, move_entry, move_folder,
        read_entry, write_entry, trash_entry, open_folder, open_chat, copy_text,
        list_fonts, set_theme, toggle_fullscreen, exit_now,
        pdf::export_pdf, pdf::pdf_job, pdf::pdf_layout,
        #[cfg(feature = "selftest")] selftest::selftest_report,
        #[cfg(feature = "selftest")] selftest::selftest_recorded,
        #[cfg(feature = "selftest")] selftest::selftest_phase,
        #[cfg(feature = "selftest")] selftest::snapshot,
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" { return; }
            match event {
                WindowEvent::CloseRequested { api, .. } if !READY_TO_EXIT.load(Ordering::SeqCst) => {
                    api.prevent_close();
                    request_flush(window.app_handle());
                }
                WindowEvent::Resized(_) => {
                    let now = window.is_fullscreen().unwrap_or(false);
                    if now != WAS_FULLSCREEN.swap(now, Ordering::SeqCst) {
                        let _ = window.emit("fullscreen", now);
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("could not start Runon")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                if !READY_TO_EXIT.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    request_flush(app);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{folder_path, is_entry_filename, is_folder_name};

    #[test]
    fn folder_names_stay_inside_the_entries_folder() {
        for name in ["Work", "Book notes 2", "Café"] {
            assert!(is_folder_name(name), "{name}");
        }
        for name in ["", " ", " Work", "..", ".hidden", "a/b", "a\\b", "../Work", "Work.", "a:b"] {
            assert!(!is_folder_name(name), "{name}");
        }
    }

    #[test]
    fn only_system_leftovers_count_as_clutter() {
        for name in [".DS_Store", "._note", "Thumbs.db", "[6910BBDE-75FC-415C-ABB9-C76644B037B2]-[2026-02-20-08-01-04].md.tmp"] {
            assert!(super::is_clutter(name), "{name}");
        }
        for name in ["photo.jpg", "notes.md", "plan.pdf"] {
            assert!(!super::is_clutter(name), "{name}");
        }
    }

    #[test]
    fn folder_paths_nest_but_never_climb_out() {
        let root = std::path::Path::new("/entries");
        assert_eq!(folder_path(root, "Work/Ideas").unwrap(), root.join("Work").join("Ideas"));
        for path in ["Work/../..", "Work//Ideas", "/Work", "Work/", "Work/.hidden"] {
            assert!(folder_path(root, path).is_err(), "{path}");
        }
    }

    #[test]
    fn accepts_real_entry_names() {
        assert!(is_entry_filename("[6910BBDE-75FC-415C-ABB9-C76644B037B2]-[2026-02-20-08-01-04].md"));
    }

    #[test]
    fn refuses_anything_else() {
        for name in [
            "../../etc/hosts",
            "notes.md",
            "[6910BBDE-75FC-415C-ABB9-C76644B037B2]-[2026-02-20-08-01-04].md.tmp",
            "[../../../../../../../../../etc/passwd]-[2026-02-20-08-01-04].md",
            "[ZZZZZZZZ-75FC-415C-ABB9-C76644B037B2]-[2026-02-20-08-01-04].md",
            "",
        ] {
            assert!(!is_entry_filename(name), "{name}");
        }
    }
}
