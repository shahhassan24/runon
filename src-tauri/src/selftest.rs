//! Hooks for `npm test`. Only compiled with the `selftest` feature, never in a release.

use std::sync::Mutex;
use tauri::{webview::{PageLoadEvent, PageLoadPayload}, Webview, WebviewWindow, Runtime};

static RECORDED: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub fn record(text: String) { RECORDED.lock().unwrap().push(text); }

pub fn on_page_load<R: Runtime>(webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
    if webview.label() == "main" && matches!(payload.event(), PageLoadEvent::Finished) {
        // Animations pause while a window is hidden behind others.
        let _ = webview.window().set_focus();
        let _ = webview.eval(include_str!("../../test/selftest.js"));
    }
}

#[tauri::command]
pub fn selftest_recorded() -> Vec<String> { RECORDED.lock().unwrap().clone() }

#[tauri::command]
pub fn selftest_phase() -> String { std::env::var("RUNON_SELFTEST_PHASE").unwrap_or_default() }

#[tauri::command]
pub fn selftest_report(report: String) -> Result<(), String> {
    std::fs::write(std::env::var("RUNON_SELFTEST").map_err(|e| e.to_string())?, report).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn snapshot(window: WebviewWindow, name: String) -> Result<(), String> {
    let path = format!("{}-{name}.tiff", std::env::var("RUNON_SELFTEST").map_err(|e| e.to_string())?);
    window.with_webview(move |webview| unsafe {
        use block2::RcBlock;
        use objc2::{msg_send, runtime::AnyObject};
        use objc2_foundation::NSString;
        let web_view = webview.inner() as *mut AnyObject;
        let block = RcBlock::new(move |image: *mut AnyObject, _error: *mut AnyObject| {
            if image.is_null() { return; }
            let tiff: *mut AnyObject = msg_send![image, TIFFRepresentation];
            let _: bool = msg_send![tiff, writeToFile: &*NSString::from_str(&path), atomically: true];
        });
        let _: () = msg_send![web_view, takeSnapshotWithConfiguration: std::ptr::null_mut::<AnyObject>(), completionHandler: &*block];
    }).map_err(|e| e.to_string())
}
