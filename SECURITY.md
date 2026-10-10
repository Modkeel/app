# Security

## Reporting a problem

If you find a security problem in Modkeel for desktop, please report it privately:
[open a security advisory](https://github.com/Modkeel/app/security/advisories/new) on this
repo. Do not open a public issue for it.

You get an answer within 7 days. Once a fix is released, the advisory is published with credit
to you, unless you prefer otherwise.

Supported: the latest release. Installed apps offer each new release themselves.

## What the app does on your computer

- It reads your launchers' instances and mods folders, never writing to them. A moved pack
  becomes a new instance beside the old one; files it gets go to `Downloads/Modkeel`.
- It talks to Modrinth and GitHub to find mods, to `api.modkeel.com` for CurseForge lookups,
  and to this repo's latest release to see whether there is a new version.
- "Sign in with GitHub" is optional and asks for no permissions on your account; the token is
  saved in `.modkeel/config.toml` in your home folder, like the command-line tool's.
- An update is installed only when you click "Update and restart", and only if its signature
  matches the updater key built into the app.

## How releases are made

Every release is built by GitHub Actions from this repo's tagged code (`release.yml`), with
the engine from PyPI at the version `engine/requirements.txt` pins. Each file carries a signed
build provenance (`gh attestation verify <file> -R Modkeel/app`) and a SHA-256 in
`SHA256SUMS`, and the release notes link its VirusTotal report. The repo's whole history is
public, one commit per change, each signed. See "Checking what you downloaded" in the
[README](README.md#checking-what-you-downloaded).
