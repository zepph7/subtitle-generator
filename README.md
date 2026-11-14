<p align="center">
  <img src="build/icon.png" width="120" alt="Subtitle Generator icon">
</p>

<h1 align="center">Subtitle Generator</h1>

<p align="center">
  Create <code>.srt</code> subtitles for your videos automatically, on your own PC, with
  <a href="https://github.com/SYSTRAN/faster-whisper">faster-whisper</a>.
</p>

<p align="center">
  <a href="https://github.com/zepph7/subtitle-generator/releases/latest/download/Subtitle-Generator-Setup.exe">
    <img src="https://img.shields.io/badge/Windows-Download-3b82f6?style=for-the-badge&logo=windows" alt="Download for Windows">
  </a>
  <a href="#linux">
    <img src="https://img.shields.io/badge/Linux-Download-f59e0b?style=for-the-badge&logo=linux&logoColor=white" alt="Download for Linux">
  </a>
  <a href="#macos">
    <img src="https://img.shields.io/badge/macOS-Download-64748b?style=for-the-badge&logo=apple" alt="Download for macOS">
  </a>
</p>

<p align="center">
  <a href="https://github.com/zepph7/subtitle-generator/releases/latest">
    <img src="https://img.shields.io/github/v/release/zepph7/subtitle-generator?label=latest%20version" alt="Latest version">
  </a>
  <a href="https://github.com/zepph7/subtitle-generator/releases">
    <img src="https://img.shields.io/github/downloads/zepph7/subtitle-generator/total" alt="Downloads">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License: Apache 2.0">
  </a>
</p>

---

## Download and install

| System | Download |
|---|---|
| **Windows 10 / 11** (64-bit) | [Subtitle-Generator-Setup.exe](https://github.com/zepph7/subtitle-generator/releases/latest/download/Subtitle-Generator-Setup.exe) |
| **Linux** (any distro, 64-bit) | [Subtitle-Generator-x86_64.AppImage](https://github.com/zepph7/subtitle-generator/releases/latest/download/Subtitle-Generator-x86_64.AppImage) |
| **Ubuntu / Debian / Mint** | [Subtitle-Generator-amd64.deb](https://github.com/zepph7/subtitle-generator/releases/latest/download/Subtitle-Generator-amd64.deb) |
| **macOS**, Apple Silicon (M1–M4) | [Subtitle-Generator-mac-arm64.dmg](https://github.com/zepph7/subtitle-generator/releases/latest/download/Subtitle-Generator-mac-arm64.dmg) |
| **macOS**, Intel | [Subtitle-Generator-mac-x64.dmg](https://github.com/zepph7/subtitle-generator/releases/latest/download/Subtitle-Generator-mac-x64.dmg) |

All versions are on the [Releases page](https://github.com/zepph7/subtitle-generator/releases).

### Share the app

To share Subtitle Generator, send this link. It always opens the newest version, with downloads for Windows, Linux and macOS:

```
https://github.com/zepph7/subtitle-generator/releases/latest
```

The download links in the table above also always give the newest version, so they're safe to share too.

### Windows

1. Run `Subtitle-Generator-Setup.exe`.
   > Windows may show **"Windows protected your PC"** because the installer is not code-signed.
   > Click **More info → Run anyway**.
2. Accept the license, choose **Only for me** or **All users**, then the install folder.
3. The installer **checks your PC for the required components** and offers to install any that are missing:

   | Component | Why it's needed | Size |
   |---|---|---|
   | Python 3.10+ (3.12 is installed if missing) | Runs the transcription engine | ~25 MB |
   | faster-whisper (installed with `pip`) | The speech-to-text engine | ~300 MB |
   | Microsoft Visual C++ Runtime x64 | Needed by faster-whisper | ~25 MB |

   Keep them ticked and click **Install**. An internet connection is needed.

### Linux

**Ubuntu, Debian, Linux Mint (`.deb`):**
```bash
sudo apt install ./Subtitle-Generator-amd64.deb
```
This also installs Python 3 and its `venv` module. Start **Subtitle Generator** from the app menu.

**Any distro (`.AppImage`):**
```bash
chmod +x Subtitle-Generator-x86_64.AppImage
./Subtitle-Generator-x86_64.AppImage
```
- You need Python 3.9+ with the venv module: `sudo apt install python3 python3-venv` (Ubuntu/Debian), `sudo dnf install python3` (Fedora), `sudo pacman -S python` (Arch).
- If it doesn't start, install FUSE 2: `sudo apt install libfuse2` (on Ubuntu 24.04: `libfuse2t64`).
- On Ubuntu 24.04+, if it still doesn't open, start it with `./Subtitle-Generator-x86_64.AppImage --no-sandbox`, or use the `.deb` instead.

### macOS

1. Open the `.dmg` and drag **Subtitle Generator** into **Applications**.
2. The app isn't notarized by Apple, so the first time you open it macOS says it **"cannot be opened"** or **"cannot verify the developer"**:
   - Open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**, or
   - run once in Terminal: `xattr -cr "/Applications/Subtitle Generator.app"`
3. You need Python 3.9 or newer, from [python.org](https://www.python.org/downloads/macos/) or `brew install python`.

### First start on Linux and macOS (also Windows, if anything is missing)

When the app opens it checks for Python and faster-whisper. If faster-whisper is missing, a yellow panel shows an **Install faster-whisper** button. Click it and the app installs faster-whisper (about 300 MB) into **its own private Python environment**, so your system Python isn't touched:

| System | Location |
|---|---|
| Linux | `~/.config/Subtitle Generator/python-env` |
| macOS | `~/Library/Application Support/Subtitle Generator/python-env` |
| Windows | `%APPDATA%\Subtitle Generator\python-env` |

If Python itself is missing, the panel shows the command to install it for your system. Then click **Check again**.

## Using the app

1. Add videos: **Select videos**, **Select folder**, or **drag and drop** files or folders onto the window.
2. Choose the **model** and the **language** (English, Swahili or Auto-detect).
3. Optional: type **names and special words** the speaker uses, separated by commas (people, places, brands, technical terms), so they're recognised and spelled correctly.
4. Click **Start**. Each `.srt` is saved **next to its video, with the same name**.

The first time you use a model it downloads automatically, and only once:

| Model | Download | RAM needed | Speed / accuracy |
|---|---|---|---|
| tiny | ~75 MB | ~1 GB | fastest, least accurate |
| base | ~145 MB | ~1 GB | fast |
| small *(default)* | ~460 MB | ~2 GB | good balance |
| medium | ~1.5 GB | ~5 GB | slow, accurate |
| large-v3-turbo | ~1.6 GB | ~4 GB | most accurate, slower than small |

### Getting the most accurate subtitles

- **Pick the language** instead of Auto-detect. Auto-detect can guess wrong, especially for Swahili or mixed speech.
- **Use a bigger model.** `small` is fast, but `medium` or `large-v3-turbo` make far fewer mistakes, especially in Swahili.
- **Add names and special words** in the words box. Whisper doesn't know uncommon names or brands and writes something that sounds similar.
- **Clear audio helps most.** Loud music, background noise or several people talking at once cause most mistakes.
- To redo a file with better settings, untick **Skip files that already have an .srt**.

### Features

- **Batch processing:** add as many files as you like. Duplicates are skipped automatically.
- **Skips finished work:** files that already have an `.srt` are skipped (optional).
- **Crash-safe resume:** progress is saved after every subtitle line. If the PC runs out of memory or the app is closed, select the same files again: each one shows **"Resume from 42%"** and continues where it stopped.
- **Keeps going on errors:** if one file fails, it's marked as failed and the next one starts.
- **Restart from beginning:** a button on each file discards its saved progress.
- **Low memory use:** each video is processed in its own process, so memory is fully released after every file.
- **Summary when finished,** e.g. *"Finished: 5 done, 1 failed, 2 skipped."*

While a video is being processed, these files appear next to it and are removed when it's finished:
`video.partial.jsonl` (saved progress) and `video.state.json` (status).

## System requirements

- Windows 10 or 11 (64-bit), Linux (64-bit), or macOS 11 Big Sur or newer (Apple Silicon or Intel)
- Python 3.9 or newer (the Windows installer can install it for you)
- 4 GB RAM or more (8 GB recommended for the `medium` model)
- No graphics card needed: everything runs on the CPU

## Troubleshooting

| Problem | Fix |
|---|---|
| Yellow panel: *Python ... was not found* | Install Python (the panel shows the command for your system), then click **Check again**. On Windows, tick **Add python.exe to PATH** in the Python installer. |
| Yellow panel: *faster-whisper is not installed* | Click **Install faster-whisper** in the panel. |
| *Could not create the Python environment* (Linux) | Install the venv module: `sudo apt install python3-venv`, then click **Install faster-whisper** again. |
| Linux AppImage doesn't open | Install `libfuse2` (`libfuse2t64` on Ubuntu 24.04), or start it with `--no-sandbox`. |
| macOS: *"cannot be opened"* | System Settings → Privacy & Security → **Open Anyway**. |
| *Out of memory* / `mkl_malloc` errors | Use a smaller model (`small` or `base`). Progress is kept: select the file again to resume. |
| A file shows *Failed: InvalidDataError* | The file is damaged or isn't a real video or audio file. |

## Build from source

You need [Node.js](https://nodejs.org/) (LTS), plus Python 3.10+ with `pip install faster-whisper`.

```bash
git clone https://github.com/zepph7/subtitle-generator.git
cd subtitle-generator
npm install
npm start          # run the app
npm run dist       # Windows installer -> dist/Subtitle-Generator-Setup.exe
npm run dist:linux # on Linux: .AppImage and .deb
npm run dist:mac   # on macOS: .dmg
```

The transcription engine can also be used on its own:

```bash
python engine.py "D:\Videos" --model small --language en
python engine.py video.mp4 --restart      # ignore saved progress
```

### Publishing a new version

1. Update `"version"` in `package.json`.
2. Commit, then tag and push:
   ```bash
   git tag v1.0.1
   git push origin main --tags
   ```
3. GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)) builds the Windows, Linux and macOS versions on GitHub's machines and attaches them to a new Release. The download link above always points to the latest version.

## Project structure

| File | Purpose |
|---|---|
| `main.js` | Electron main process: file dialogs, runs `engine.py` once per file, the queue |
| `preload.js` | Secure bridge between the window and the main process |
| `index.html` | The user interface |
| `engine.py` | Transcription with faster-whisper, crash-safe resume, `.srt` output |
| `build/installer.nsh` | Installer page that checks for and installs the required components |
| `build/icon.png`, `build/icon.ico` | App icon |

## License

Copyright 2026 Zepphania.

Subtitle Generator is free and open-source software, licensed under the
[Apache License, Version 2.0](LICENSE). You may use, copy, modify and distribute it,
including commercially, as long as you keep the copyright and license notices and
mark any files you change. See [`NOTICE`](NOTICE) for the third-party components it uses.
