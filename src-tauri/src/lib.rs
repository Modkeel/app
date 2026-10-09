//! The app's native side: one engine process for the window, lines relayed both ways.
//!
//!   engine_start   start the engine (once); a second call replays its hello, so a window
//!                  that reloads (or React's dev double-mount) reconnects instead of hanging
//!   engine_send    one protocol line to the engine
//!   output_dir     where the player's files go (Downloads/Modkeel), created if missing; the
//!                  engine also runs there, so nothing is written next to the app itself
//!   "engine-line"  event: one line from the engine
//!   "engine-exit"  event: the engine stopped (with why)
//!
//! The screen (src/) speaks the protocol; this side never parses it, except to remember the
//! hello line.

mod engine;

use std::sync::{Arc, Mutex};

use engine::{engine_command, Engine};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

#[derive(Default)]
struct EngineState {
    engine: Mutex<Option<Engine>>,
    hello: Arc<Mutex<Option<String>>>,
}

/// Downloads/Modkeel (home/Modkeel when the system has no Downloads folder).
fn player_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| format!("no Downloads or home folder: {e}"))?;
    let dir = base.join("Modkeel");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

#[tauri::command]
fn output_dir(app: AppHandle) -> Result<String, String> {
    player_dir(&app).map(|d| d.to_string_lossy().into_owned())
}

#[tauri::command]
fn engine_start(app: AppHandle, state: State<'_, EngineState>) -> Result<(), String> {
    let mut slot = state.engine.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        if let Some(hello) = state.hello.lock().map_err(|e| e.to_string())?.clone() {
            app.emit("engine-line", hello).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));
    let command = engine_command(std::env::var("MODKEEL_ENGINE").ok(), exe_dir.as_deref());
    let (line_app, exit_app, hello) = (app.clone(), app.clone(), state.hello.clone());
    let work_dir = player_dir(&app)?;
    let engine = Engine::spawn(
        &command,
        &work_dir,
        move |line| {
            if line.contains("\"type\":\"hello\"") {
                if let Ok(mut h) = hello.lock() {
                    *h = Some(line.clone());
                }
            }
            let _ = line_app.emit("engine-line", line);
        },
        move |why| {
            if let Some(state) = exit_app.try_state::<EngineState>() {
                if let Ok(mut slot) = state.engine.lock() {
                    *slot = None;
                }
            }
            let _ = exit_app.emit("engine-exit", why);
        },
    )
    .map_err(|e| format!("could not start the engine ({}): {e}", command.join(" ")))?;
    *slot = Some(engine);
    Ok(())
}

#[tauri::command]
fn engine_send(line: String, state: State<'_, EngineState>) -> Result<(), String> {
    let mut slot = state.engine.lock().map_err(|e| e.to_string())?;
    let engine = slot.as_mut().ok_or("the engine is not running")?;
    engine.send(&line).map_err(|e| e.to_string())
}

/// Windows: the taskbar draws a window's big icon (WM_SETICON ICON_BIG). Tauri sets only the
/// small one (the title bar) and leaves the big one empty, so the taskbar fell back to the
/// generic app icon. The icon is the one tauri-build embeds in the exe (from icons/icon.ico),
/// loaded at the system's large icon size so Windows picks that entry instead of scaling one.
#[cfg(windows)]
fn set_taskbar_icon(window: &tauri::WebviewWindow) {
    use tauri::utils::platform::WINDOWS_APP_ICON_RESOURCE_ID;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, LoadImageW, SendMessageW, ICON_BIG, IMAGE_ICON, LR_DEFAULTCOLOR,
        SM_CXICON, SM_CYICON, WM_SETICON,
    };

    let Ok(hwnd) = window.hwnd() else { return };
    // SAFETY: plain Win32 calls on this process's module and a live window handle; the
    // icon handle is owned by the window from here on (kept for the app's lifetime).
    unsafe {
        let icon = LoadImageW(
            GetModuleHandleW(std::ptr::null()),
            WINDOWS_APP_ICON_RESOURCE_ID as usize as *const u16, // MAKEINTRESOURCE
            IMAGE_ICON,
            GetSystemMetrics(SM_CXICON),
            GetSystemMetrics(SM_CYICON),
            LR_DEFAULTCOLOR,
        );
        if !icon.is_null() {
            SendMessageW(hwnd.0 as _, WM_SETICON, ICON_BIG as usize, icon as isize);
        }
    }
}

/// Is this build signed for updates? Its tauri.conf.json carries the updater's public key
/// (plugins.updater) only in builds meant for players; without it the updater plugin would
/// fail to start, so it is left out and the screen never offers updates.
fn has_updater(plugins: &tauri::utils::config::PluginConfig) -> bool {
    plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .is_some_and(|k| !k.trim().is_empty())
}

pub fn run() {
    let context = tauri::generate_context!();
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init()) // the pack's mods folder picker
        .plugin(tauri_plugin_process::init()); // restart into an installed update
    if has_updater(&context.config().plugins) {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    let app = builder
        // The window starts hidden (tauri.conf.json) and is shown here, once its icons are
        // set: the taskbar takes a button's icon when the window first appears.
        .setup(|app| {
            for window in app.webview_windows().values() {
                #[cfg(windows)]
                set_taskbar_icon(window);
                window.show()?;
            }
            Ok(())
        })
        .manage(EngineState::default())
        .invoke_handler(tauri::generate_handler![
            engine_start,
            engine_send,
            output_dir
        ])
        .build(context)
        .expect("error while building the Modkeel app");
    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<EngineState>() {
                if let Ok(mut slot) = state.engine.lock() {
                    if let Some(mut engine) = slot.take() {
                        engine.kill();
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::has_updater;
    use tauri::utils::config::PluginConfig;

    fn plugins(json: serde_json::Value) -> PluginConfig {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn updater_only_with_a_public_key() {
        assert!(has_updater(&plugins(serde_json::json!({
            "updater": {"pubkey": "dW50cnVzdGVk", "endpoints": ["https://x/latest.json"]}
        }))));
        assert!(!has_updater(&plugins(serde_json::json!({}))));
        assert!(!has_updater(&plugins(serde_json::json!({"updater": {"pubkey": "  "}}))));
        assert!(!has_updater(&plugins(serde_json::json!({"updater": {"endpoints": []}}))));
    }
}
