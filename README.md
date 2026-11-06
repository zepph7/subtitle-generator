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
    <img src="https://img.shields.io/badge/Download-Windows%20Installer-3b82f6?style=for-the-badge&logo=windows" alt="Download for Windows">
  </a>
</p>

<p align="center">
  <a href="https://github.com/zepph7/subtitle-generator/releases/latest">
    <img src="https://img.shields.io/github/v/release/zepph7/subtitle-generator?label=latest%20version" alt="Latest version">
  </a>
  <a href="https://github.com/zepph7/subtitle-generator/releases">
    <img src="https://img.shields.io/github/downloads/zepph7/subtitle-generator/total" alt="Downloads">
  </a>
</p>

---

## Download and install

1. **[Download Subtitle-Generator-Setup.exe](https://github.com/zepph7/subtitle-generator/releases/latest/download/Subtitle-Generator-Setup.exe)**. All versions are on the [Releases page](https://github.com/zepph7/subtitle-generator/releases).
2. Run the installer.
   > Windows may show **"Windows protected your PC"** because the installer is not code-signed.
   > Click **More info → Run anyway**.
3. Choose **Only for me** or **All users**, then the install folder.
4. The installer **checks your PC for the required components** and offers to install any that are missing:

   | Component | Why it's needed | Size |
   |---|---|---|
   | Python 3.10+ (3.12 is installed if missing) | Runs the transcription engine | ~25 MB |
   | faster-whisper (installed with `pip`) | The speech-to-text engine | ~300 MB |
   | Microsoft Visual C++ Runtime x64 | Needed by faster-whisper | ~25 MB |

   Keep them ticked and click **Install**. An internet connection is needed.

## Using the app

1. Add videos: **Select videos**, **Select folder**, or **drag and drop** files or folders onto the window.
2. Choose the **model** (`tiny`, `base`, `small`, `medium`) and the **language** (English, Swahili or Auto-detect).
3. Click **Start**. Each `.srt` is saved **next to its video, with the same name**.

The first time you use a model it downloads automatically, and only once:

| Model | Download | RAM needed | Speed / accuracy |
|---|---|---|---|
| tiny | ~75 MB | ~1 GB | fastest, least accurate |
| base | ~145 MB | ~1 GB | fast |
| small *(default)* | ~460 MB | ~2 GB | good balance |
| medium | ~1.5 GB | ~5 GB | slow, most accurate |

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

- Windows 10 or 11, 64-bit
- 4 GB RAM or more (8 GB recommended for the `medium` model)
- No graphics card needed: everything runs on the CPU

## Troubleshooting

| Problem | Fix |
|---|---|
| Every file fails with *"python" not found* | Install Python from [python.org](https://www.python.org/downloads/) and tick **Add python.exe to PATH**, then reinstall the app. |
| `No module named 'faster_whisper'` | Open a terminal and run `python -m pip install faster-whisper`. |
| *Out of memory* / `mkl_malloc` errors | Use a smaller model (`small` or `base`). Progress is kept: select the file again to resume. |
| A file shows *Failed: InvalidDataError* | The file is damaged or isn't a real video or audio file. |

## Build from source

You need [Node.js](https://nodejs.org/) (LTS), plus Python 3.10+ with `pip install faster-whisper`.

```bash
git clone https://github.com/zepph7/subtitle-generator.git
cd subtitle-generator
npm install
npm start          # run the app
npm run dist       # build the installer -> dist/Subtitle-Generator-Setup.exe
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
3. GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)) builds the installer and attaches it to a new Release. The download link above always points to the latest version.

## Project structure

| File | Purpose |
|---|---|
| `main.js` | Electron main process: file dialogs, runs `engine.py` once per file, the queue |
| `preload.js` | Secure bridge between the window and the main process |
| `index.html` | The user interface |
| `engine.py` | Transcription with faster-whisper, crash-safe resume, `.srt` output |
| `build/installer.nsh` | Installer page that checks for and installs the required components |
| `build/icon.png`, `build/icon.ico` | App icon |
