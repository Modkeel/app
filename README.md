# Modkeel for desktop

Get Minecraft mods for the version you play. Modkeel finds a build of a mod that runs on your
Minecraft version, checks it, and tells you how it knows. It can also move a whole pack (a
mods folder or a launcher instance) to another Minecraft version.

**[Download the latest release](https://github.com/Modkeel/app/releases/latest)**

| System | File |
|---|---|
| Windows 10/11 (64-bit) | `Modkeel_<version>_windows_x64-setup.exe` |
| macOS (Apple Silicon) | `Modkeel_<version>_macos_aarch64.dmg` |
| Linux (64-bit) | `Modkeel_<version>_linux_amd64.AppImage` or `.deb` |

Once installed, the app tells you when a new version is out and updates itself in one click.
Updates are signed: the app refuses a download whose signature does not match its own key.

## Opening it the first time

The installers are not signed by Microsoft or Apple yet, so the system warns you once:

- **Windows**: "Windows protected your PC" -> **More info** -> **Run anyway**.
- **macOS**: open the .dmg, drag Modkeel to Applications, then open it. If macOS says it
  "cannot be opened" or "is damaged", go to **System Settings -> Privacy & Security** and
  click **Open Anyway** next to Modkeel. If no such button appears, run once in Terminal:
  `xattr -dr com.apple.quarantine /Applications/Modkeel.app`
- **Linux**: `chmod +x Modkeel_*.AppImage` and run it, or install the .deb.

## Checking what you downloaded

Each release lists `SHA256SUMS`. On Windows (PowerShell):
`Get-FileHash .\Modkeel_<version>_windows_x64-setup.exe`; on macOS or Linux:
`shasum -a 256 Modkeel_*`. The value must match the line for that file.

## What it does on your computer

- Files it gets go to `Downloads/Modkeel`. Your launcher instances and mods folders are only
  read; a moved pack becomes a new instance beside the old one, never written over it.
- It talks to Modrinth and GitHub to find mods, and to `api.modkeel.com` for CurseForge lookups.
- "Sign in with GitHub" is optional (it lets Modkeel search more community forks). It asks for
  no extra permissions: only what is public anyway.

## More

- Command-line version: [Modkeel/modkeel](https://github.com/Modkeel/modkeel)
  (`pip install modkeel`), the same engine the app runs.
- In-game crash help: [Modkeel Companion](https://github.com/Modkeel/companion).
- Website: [modkeel.com](https://modkeel.com)

Problems or ideas: [open an issue](https://github.com/Modkeel/app/issues).
