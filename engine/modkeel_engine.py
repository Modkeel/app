"""Entry point of the one-file engine on macOS and Linux (PyInstaller): the `modkeel` CLI, run
by the app as `modkeel-engine serve --stdio` (Windows runs `python -m modkeel.cli` instead).
Any other command works too (`modkeel-engine --version`)."""

from modkeel.cli import app

if __name__ == "__main__":
    app()
