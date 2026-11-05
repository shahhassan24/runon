//! PDF export. Lays the entry out in a hidden page, then:
//! - on macOS, WebKit draws each page directly, so no printer is needed;
//! - on Windows, the system print dialog opens, where "Microsoft Print to PDF" saves it.

use crate::entry_path;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{async_runtime::{channel, Sender}, AppHandle, State, WebviewUrl, WebviewWindowBuilder};

const PRINT_WINDOW: &str = "print";

#[derive(Clone, Serialize)]
pub struct Job { text: String, font_family: String, font_size: f64 }

#[derive(Default)]
pub struct Jobs { job: Mutex<Option<Job>>, layout: Mutex<Option<Sender<u32>>> }

/// Up to four words from the entry, or a dated name when it's empty.
#[cfg_attr(any(feature = "selftest", not(target_os = "macos")), allow(dead_code))]
pub fn pdf_title(content: &str) -> String {
    let edge = |c: char| ".,!?;:\"'()[]{}<>".contains(c);
    let words: Vec<String> = content.split_whitespace()
        .map(|word| word.trim_matches(edge).to_lowercase().replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "-"))
        .filter(|word| !word.is_empty())
        .take(4)
        .collect();
    if words.is_empty() { "Entry".into() } else { words.join("-") }
}

#[tauri::command]
pub fn pdf_job(jobs: State<Jobs>) -> Option<Job> { jobs.job.lock().unwrap().clone() }

#[tauri::command]
pub fn pdf_layout(jobs: State<Jobs>, pages: u32) {
    if let Some(sender) = jobs.layout.lock().unwrap().take() { let _ = sender.try_send(pages); }
}

#[tauri::command]
pub async fn export_pdf(app: AppHandle, jobs: State<'_, Jobs>, filename: String, font_family: String, font_size: f64) -> Result<bool, String> {
    let content = std::fs::read_to_string(entry_path(&app, &filename)?).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    let target = match choose_path(&app, &content) { Some(path) => path, None => return Ok(false) };

    let (sender, mut receiver) = channel::<u32>(1);
    *jobs.job.lock().unwrap() = Some(Job { text: content.trim().to_string(), font_family, font_size });
    *jobs.layout.lock().unwrap() = Some(sender);

    let window = WebviewWindowBuilder::new(&app, PRINT_WINDOW, WebviewUrl::App("print.html".into()))
        .visible(false)
        .inner_size(612.0, 792.0)
        .build()
        .map_err(|e| e.to_string())?;
    let pages = receiver.recv().await.ok_or("The page could not be laid out")?;

    #[cfg(target_os = "macos")]
    let result = macos::write_pdf(&window, pages, target).await;
    #[cfg(not(target_os = "macos"))]
    let result = { let _ = pages; window.print().map_err(|e| e.to_string()) };

    #[cfg(target_os = "macos")]
    let _ = window.destroy();
    result.map(|_| true)
}

#[cfg(target_os = "macos")]
fn choose_path(app: &AppHandle, content: &str) -> Option<std::path::PathBuf> {
    #[cfg(feature = "selftest")]
    { let _ = (app, content); return std::env::var("RUNON_PDF_PATH").ok().map(Into::into); }
    #[cfg(not(feature = "selftest"))]
    {
        use tauri::Manager;
        use tauri_plugin_dialog::DialogExt;
        let mut dialog = app.dialog().file().set_file_name(format!("{}.pdf", pdf_title(content))).add_filter("PDF", &["pdf"]);
        if let Some(main) = app.get_webview_window("main") { dialog = dialog.set_parent(&main); }
        dialog.blocking_save_file()?.into_path().ok()
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use block2::RcBlock;
    use objc2::{class, msg_send, rc::{Allocated, Retained}, runtime::AnyObject};
    use objc2_foundation::{NSData, NSPoint, NSRect, NSSize, NSString};
    use std::path::PathBuf;
    use tauri::{async_runtime::channel, WebviewWindow};

    const PAGE_WIDTH: f64 = 612.0;
    const PAGE_HEIGHT: f64 = 792.0;

    #[link(name = "PDFKit", kind = "framework")]
    extern "C" {}

    async fn draw_page(window: &WebviewWindow, page: u32) -> Result<Vec<u8>, String> {
        let (sender, mut receiver) = channel::<Vec<u8>>(1);
        window.with_webview(move |webview| unsafe {
            let web_view = webview.inner() as *mut AnyObject;
            let config: Retained<AnyObject> = msg_send![class!(WKPDFConfiguration), new];
            let rect = NSRect::new(NSPoint::new(0.0, page as f64 * PAGE_HEIGHT), NSSize::new(PAGE_WIDTH, PAGE_HEIGHT));
            let _: () = msg_send![&*config, setRect: rect];
            let block = RcBlock::new(move |data: *mut NSData, _error: *mut AnyObject| {
                let bytes = data.as_ref().map(|data| data.to_vec()).unwrap_or_default();
                let _ = sender.try_send(bytes);
            });
            let _: () = msg_send![web_view, createPDFWithConfiguration: &*config, completionHandler: &*block];
        }).map_err(|e| e.to_string())?;
        let bytes = receiver.recv().await.unwrap_or_default();
        if bytes.is_empty() { Err("WebKit could not draw the page".into()) } else { Ok(bytes) }
    }

    fn merge(pages: Vec<Vec<u8>>, target: PathBuf) -> bool {
        unsafe {
            let mut document: Option<Retained<AnyObject>> = None;
            for bytes in &pages {
                let data = NSData::with_bytes(bytes);
                let allocated: Allocated<AnyObject> = msg_send![class!(PDFDocument), alloc];
                let Some(current): Option<Retained<AnyObject>> = msg_send![allocated, initWithData: &*data] else { return false };
                match &document {
                    None => document = Some(current),
                    Some(first) => {
                        let count: usize = msg_send![&**first, pageCount];
                        let page: *mut AnyObject = msg_send![&*current, pageAtIndex: 0usize];
                        let _: () = msg_send![&**first, insertPage: page, atIndex: count];
                    }
                }
            }
            let Some(document) = document else { return false };
            let path = NSString::from_str(&target.to_string_lossy());
            msg_send![&*document, writeToFile: &*path]
        }
    }

    pub async fn write_pdf(window: &WebviewWindow, pages: u32, target: PathBuf) -> Result<(), String> {
        let mut drawn = Vec::new();
        for page in 0..pages.max(1) { drawn.push(draw_page(window, page).await?); }
        let (sender, mut receiver) = channel::<bool>(1);
        window.run_on_main_thread(move || { let _ = sender.try_send(merge(drawn, target)); }).map_err(|e| e.to_string())?;
        if receiver.recv().await.unwrap_or(false) { Ok(()) } else { Err("The PDF could not be saved".into()) }
    }
}

#[cfg(test)]
mod tests {
    use super::pdf_title;

    #[test]
    fn titles_use_the_first_four_clean_words() {
        assert_eq!(pdf_title("  Hello, (big) WORLD! this/that again"), "hello-big-world-this-that");
        assert_eq!(pdf_title("a/b c:d"), "a-b-c-d");
        assert_eq!(pdf_title("\n\n"), "Entry");
    }
}
