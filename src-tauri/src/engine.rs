//! The engine process: `modkeel serve --stdio` as a child, its stdout relayed line by line.
//!
//! Nothing here knows Tauri or the protocol: lib.rs turns lines into window events and
//! window commands into lines. That keeps this part testable with any program (tests below
//! use `sh`).

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::thread;

/// Which command runs the engine, first match wins:
/// 1. `MODKEEL_ENGINE` (whitespace-separated), for development:
///    `python3 -m modkeel.cli serve --stdio`
/// 2. an engine bundled next to the app's executable (`modkeel-engine[.exe]`, built with
///    PyInstaller; packaging is the next step)
/// 3. `modkeel serve --stdio` from PATH (a pipx/pip install of the CLI)
pub fn engine_command(env_override: Option<String>, exe_dir: Option<&Path>) -> Vec<String> {
    if let Some(cmd) = env_override.filter(|c| !c.trim().is_empty()) {
        return cmd.split_whitespace().map(String::from).collect();
    }
    let bundled: Option<PathBuf> = exe_dir.map(|d| {
        d.join(if cfg!(windows) { "modkeel-engine.exe" } else { "modkeel-engine" })
    });
    match bundled {
        Some(path) if path.is_file() => {
            vec![path.to_string_lossy().into_owned(), "serve".into(), "--stdio".into()]
        }
        _ => vec!["modkeel".into(), "serve".into(), "--stdio".into()],
    }
}

/// A running engine: write lines to it, kill it when the app closes.
pub struct Engine {
    child: Child,
    stdin: ChildStdin,
}

impl Engine {
    /// Start `command`; every stdout line goes to `on_line`, and `on_exit` runs once when
    /// stdout closes (the engine exited or crashed). stderr is inherited: the engine's log.
    pub fn spawn<L, E>(command: &[String], on_line: L, on_exit: E) -> std::io::Result<Engine>
    where
        L: Fn(String) + Send + 'static,
        E: FnOnce(String) + Send + 'static,
    {
        let (program, args) = command
            .split_first()
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "empty command"))?;
        let mut child = Command::new(program)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;
        let stdin = child.stdin.take().expect("stdin is piped");
        let stdout = child.stdout.take().expect("stdout is piped");
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) if !line.trim().is_empty() => on_line(line),
                    Ok(_) => {}
                    Err(e) => return on_exit(format!("could not read the engine: {e}")),
                }
            }
            on_exit("the engine stopped".into());
        });
        Ok(Engine { child, stdin })
    }

    /// Send one protocol line (a newline is added).
    pub fn send(&mut self, line: &str) -> std::io::Result<()> {
        self.stdin.write_all(line.trim_end().as_bytes())?;
        self.stdin.write_all(b"\n")?;
        self.stdin.flush()
    }

    pub fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn sh(script: &str) -> Vec<String> {
        vec!["sh".into(), "-c".into(), script.into()]
    }

    #[test]
    fn relays_each_line_then_the_exit() {
        let (tx, rx) = mpsc::channel();
        let exit_tx = tx.clone();
        let _engine = Engine::spawn(
            &sh("printf 'one\\n\\ntwo\\n'"),
            move |l| tx.send(l).unwrap(),
            move |why| exit_tx.send(format!("exit: {why}")).unwrap(),
        )
        .unwrap();
        let got: Vec<String> = (0..3).map(|_| rx.recv_timeout(Duration::from_secs(5)).unwrap()).collect();
        assert_eq!(got, ["one", "two", "exit: the engine stopped"]);
    }

    #[test]
    fn sends_lines_to_the_engine() {
        let (tx, rx) = mpsc::channel();
        let mut engine = Engine::spawn(&sh("read line; echo \"got $line\""), move |l| tx.send(l).unwrap(), |_| {})
            .unwrap();
        engine.send("{\"type\":\"request\"}\n").unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), "got {\"type\":\"request\"}");
        engine.kill();
    }

    #[test]
    fn a_missing_program_is_an_error_not_a_panic() {
        assert!(Engine::spawn(&["/nonexistent/modkeel".into()], |_| {}, |_| {}).is_err());
        assert!(Engine::spawn(&[], |_| {}, |_| {}).is_err());
    }

    #[test]
    fn picks_the_command() {
        let dev = engine_command(Some("python3 -m modkeel.cli serve --stdio".into()), None);
        assert_eq!(dev, ["python3", "-m", "modkeel.cli", "serve", "--stdio"]);
        // blank override and no bundled engine: the CLI from PATH
        assert_eq!(engine_command(Some("  ".into()), None), ["modkeel", "serve", "--stdio"]);
        let dir = std::env::temp_dir().join(format!("modkeel-app-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(engine_command(None, Some(&dir))[0], "modkeel");
        let name = if cfg!(windows) { "modkeel-engine.exe" } else { "modkeel-engine" };
        std::fs::write(dir.join(name), b"").unwrap();
        assert!(engine_command(None, Some(&dir))[0].ends_with(name));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
