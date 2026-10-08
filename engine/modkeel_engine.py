"""Entry point of the bundled engine (PyInstaller): the `modkeel` CLI, run by the app as
`modkeel-engine serve --stdio`. Any other command works too (`modkeel-engine --version`)."""

from modkeel.cli import app

if __name__ == "__main__":
    app()
