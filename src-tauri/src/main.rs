#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod pdf;
#[cfg(feature = "selftest")]
mod selftest;

use serde::Serialize;
use std::{fs, path::PathBuf, sync::atomic::{AtomicBool, Ordering}, thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Theme, WebviewWindow, WindowEvent};
#[cfg(not(feature = "selftest"))]
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

const CHAT_URLS: [&str; 2] = ["https://chatgpt.com/?q=", "https://claude.ai/new?q="];

static READY_TO_EXIT: AtomicBool = AtomicBool::new(false);
static WAS_FULLSCREEN: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
struct RawEntry { filename: String, content: String }

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

pub fn entry_path(app: &AppHandle, filename: &str) -> Result<PathBuf, String> {
    if !is_entry_filename(filename) { return Err("Invalid entry filename".into()); }
    Ok(data_dir(app)?.join(filename))
}

#[tauri::command]
fn folder(app: AppHandle) -> Result<String, String> {
    Ok(data_dir(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_entries(app: AppHandle) -> Result<Vec<RawEntry>, String> {
    let mut entries = Vec::new();
    for item in fs::read_dir(data_dir(&app)?).map_err(|e| e.to_string())? {
        let path = item.map_err(|e| e.to_string())?.path();
        let filename = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
        if is_entry_filename(&filename) {
            entries.push(RawEntry { filename, content: fs::read_to_string(&path).map_err(|e| e.to_string())? });
        }
    }
    Ok(entries)
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
        folder, list_entries, read_entry, write_entry, trash_entry, open_folder, open_chat, copy_text,
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
    use super::is_entry_filename;

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
