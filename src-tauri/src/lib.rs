//! The app's native side: one engine process for the window, lines relayed both ways.
//!
//!   engine_start   start the engine (once); a second call replays its hello, so a window
//!                  that reloads (or React's dev double-mount) reconnects instead of hanging
//!   engine_send    one protocol line to the engine
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

#[tauri::command]
fn engine_start(app: AppHandle, state: State<'_, EngineState>) -> Result<(), String> {
    let mut slot = state.engine.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        if let Some(hello) = state.hello.lock().map_err(|e| e.to_string())?.clone() {
            app.emit("engine-line", hello).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf()));
    let command = engine_command(std::env::var("MODKEEL_ENGINE").ok(), exe_dir.as_deref());
    let (line_app, exit_app, hello) = (app.clone(), app.clone(), state.hello.clone());
    let engine = Engine::spawn(
        &command,
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

pub fn run() {
    let app = tauri::Builder::default()
        .manage(EngineState::default())
        .invoke_handler(tauri::generate_handler![engine_start, engine_send])
        .build(tauri::generate_context!())
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
