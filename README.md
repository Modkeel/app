# Modkeel for desktop

Get Minecraft mods for the version you play. Modkeel finds a build of a mod that runs on your
Minecraft version, checks it, and tells you how it knows. It can also move a whole pack (a
mods folder or a launcher instance) to another Minecraft version.

Open source (MIT): everything the app is made of is in this repository, and every release is
built from it by GitHub Actions, where you can watch the build and check its result.

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

Every file of a release is attested: GitHub records that it was built by this repository's
release workflow from a specific commit, and signs that record. With the
[GitHub CLI](https://cli.github.com):

    gh attestation verify Modkeel_<version>_windows_x64-setup.exe -R Modkeel/app

It answers with the commit and the workflow run that built the file. Without the GitHub CLI,
compare the file's hash with its line in the release's `SHA256SUMS`: on Windows (PowerShell)
`Get-FileHash .\Modkeel_<version>_windows_x64-setup.exe`, on macOS or Linux
`shasum -a 256 Modkeel_*`.

The engine inside the app is the [modkeel](https://pypi.org/project/modkeel/) command-line
tool from PyPI ([source](https://github.com/Modkeel/modkeel)), at the version pinned in
`engine/requirements.txt`.

## What it does on your computer

- Files it gets go to `Downloads/Modkeel`. Your launcher instances and mods folders are only
  read; a moved pack becomes a new instance beside the old one, never written over it.
- It talks to Modrinth and GitHub to find mods, and to `api.modkeel.com` for CurseForge lookups.
- "Sign in with GitHub" is optional (it lets Modkeel search more community forks). It asks for
  no extra permissions: only what is public anyway.

## Build it yourself

[DEVELOPING.md](DEVELOPING.md): how the app is put together, its tests, and how to build the
installers on your own machine.

## More

- Command-line version: [Modkeel/modkeel](https://github.com/Modkeel/modkeel)
  (`pip install modkeel`), the same engine the app runs.
- In-game crash help: [Modkeel Companion](https://github.com/Modkeel/companion).
- Website: [modkeel.com](https://modkeel.com)

Problems or ideas: [open an issue](https://github.com/Modkeel/app/issues).

## License

[MIT](LICENSE).
