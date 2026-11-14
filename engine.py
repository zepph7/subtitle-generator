"""
Crash-safe subtitle generator using faster-whisper.

Usage:
    python engine.py video1.mp4 video2.mkv
    python engine.py "D:\\Videos" --language sw
    python engine.py video.mp4 --overwrite     (regenerate even if .srt exists)
    python engine.py video.mp4 --restart       (discard saved progress, start at 0)

Crash safety, per video ("movie.mp4"):
    movie.partial.jsonl  one JSON line per finished segment {"start","end","text"},
                         flushed and fsynced immediately, so a crash (e.g. an
                         mkl_malloc out-of-memory abort) loses at most the
                         segment being decoded.
    movie.state.json     {"status": pending|running|done|failed, "last_time",
                         "duration", "model", "language", ...}
    movie.srt            built from the .partial.jsonl when the video is
                         finished; the partial file is then deleted.

When a .partial.jsonl exists, transcription continues from the end of its last
segment (via clip_timestamps), keeping the segment numbering.

The Electron app (main.js) runs this once per file and parses its stdout lines
("[i/n] name - ...", "progress: x%", "saved ...", "FAILED: ...").
Keep that output format in sync with main.js if you change it.
"""

import argparse
import gc
import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

import av
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
from faster_whisper.vad import VadOptions, get_speech_timestamps

VIDEO_EXTS = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v",
              ".mpg", ".mpeg", ".ts", ".mp3", ".wav", ".m4a", ".flac", ".ogg"}

DEVICE = "cpu"
COMPUTE_TYPE = "int8"
SAMPLE_RATE = 16000


class SettingsMismatch(Exception):
    pass


class MediaError(Exception):
    """The file can't be transcribed (empty, damaged, no audio). Message is user-facing."""


def human_size(n: int) -> str:
    if n < 1024:
        return f"{n} bytes"
    if n < 1024 ** 2:
        return f"{n / 1024:.0f} KB"
    if n < 1024 ** 3:
        return f"{n / 1024 ** 2:.1f} MB"
    return f"{n / 1024 ** 3:.2f} GB"


def damaged_message(video: Path) -> str:
    try:
        size = video.stat().st_size
    except OSError:
        return "The file can't be opened. It may have been moved, renamed or deleted."
    if size == 0:
        return ("The file is empty (0 KB). It was probably not fully downloaded or copied. "
                "Download or copy it again, then try again.")
    if size < 1024 ** 2:
        return (f"The file is only {human_size(size)}, so it's incomplete or damaged and has no "
                "playable video. Download or copy it again, then try again.")
    return (f"The file ({human_size(size)}) is damaged or isn't a supported video/audio format, "
            "so it can't be read. Check that it plays in a video player, or download it again.")


def check_media(video: Path) -> None:
    """Fail fast with a clear message before loading the Whisper model."""
    try:
        size = video.stat().st_size
    except OSError:
        raise MediaError(damaged_message(video)) from None
    if size == 0:
        raise MediaError(damaged_message(video))
    try:
        with av.open(str(video)) as container:
            if not container.streams.audio:
                raise MediaError("This video has no audio track, so there is nothing to "
                                 "turn into subtitles.")
    except av.error.FFmpegError:
        raise MediaError(damaged_message(video)) from None


def ts(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def partial_path(video: Path) -> Path:
    return video.with_suffix(".partial.jsonl")


def state_path(video: Path) -> Path:
    return video.with_suffix(".state.json")


# ---------------------------------------------------------------- state file

def read_state(video: Path) -> dict:
    try:
        return json.loads(state_path(video).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write_state(video: Path, **fields) -> dict:
    """Merge fields into the state file, replacing it atomically."""
    state = read_state(video)
    state.update(fields, updated=now())
    path = state_path(video)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    for _ in range(5):                      # antivirus/indexers can briefly lock files
        try:
            os.replace(tmp, path)
            break
        except PermissionError:
            time.sleep(0.1)
    return state


# -------------------------------------------------------------- partial file

def load_partial(video: Path) -> list[dict]:
    """Read finished segments; drop (and truncate away) a torn last line."""
    path = partial_path(video)
    if not path.exists():
        return []
    data = path.read_bytes()
    segments, good = [], 0
    for line in data.splitlines(keepends=True):
        if not line.endswith(b"\n"):
            break
        try:
            s = json.loads(line)
            segments.append({"start": float(s["start"]), "end": float(s["end"]),
                             "text": str(s["text"])})
        except (ValueError, KeyError, TypeError):
            break
        good += len(line)
    if good < len(data):
        with open(path, "r+b") as f:
            f.truncate(good)
            f.flush()
            os.fsync(f.fileno())
    return segments


def build_srt(segments: list[dict], out: Path) -> None:
    tmp = out.with_name(out.name + ".part")
    with open(tmp, "w", encoding="utf-8") as f:
        for n, s in enumerate(segments, 1):
            f.write(f"{n}\n{ts(s['start'])} --> {ts(s['end'])}\n{s['text']}\n\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, out)


def remaining_speech(audio, start: float) -> list[float]:
    """VAD speech regions after `start`, flattened for clip_timestamps.

    faster-whisper ignores vad_filter when clip_timestamps is given, so VAD is
    run here and only the remaining speech is passed as clips."""
    clips: list[float] = []
    for chunk in get_speech_timestamps(audio, VadOptions(), sampling_rate=SAMPLE_RATE):
        s, e = chunk["start"] / SAMPLE_RATE, chunk["end"] / SAMPLE_RATE
        if e <= start:
            continue
        clips += [round(max(s, start), 3), round(e, 3)]
    return clips


# ---------------------------------------------------------------- transcribe

def transcribe_one(model: WhisperModel, model_name: str, video: Path, out: Path,
                   lang_setting: str, resume_mismatch: str) -> tuple[int, int]:
    """Returns (total segments, segments reused from a previous run)."""
    segments_done = load_partial(video)
    state = read_state(video)
    resume_from = segments_done[-1]["end"] if segments_done else 0.0

    if segments_done and state.get("model") and \
            (state.get("model"), state.get("language")) != (model_name, lang_setting):
        old = f"model {state.get('model')}, language {state.get('language')}"
        new = f"model {model_name}, language {lang_setting}"
        choice = resume_mismatch
        if choice == "ask":
            try:
                if not sys.stdin or not sys.stdin.isatty():
                    raise EOFError
                ans = input(f"    Saved progress used {old}; you chose {new}.\n"
                            f"    [c]ontinue anyway, [r]estart from beginning, [s]kip? ").strip().lower()
            except EOFError:             # no terminal to ask (e.g. run from the app)
                raise SettingsMismatch(f"saved progress used {old}, now {new}") from None
            choice = {"c": "continue", "r": "restart"}.get(ans[:1], "skip")
        if choice == "skip":
            raise SettingsMismatch(f"skipped: saved progress used {old}")
        if choice == "restart":
            partial_path(video).unlink(missing_ok=True)
            segments_done, resume_from = [], 0.0

    reused = len(segments_done)
    language = None if lang_setting == "auto" else lang_setting
    # Keep auto-detected language stable across resumes.
    if reused and language is None and state.get("detected_language"):
        language = state["detected_language"]

    write_state(video, status="running", model=model_name, language=lang_setting,
                last_time=resume_from, error=None,
                started=state.get("started") if reused else now())

    audio = segments = info = None
    try:
        if resume_from > 0:
            audio = decode_audio(str(video), sampling_rate=SAMPLE_RATE)
            duration = len(audio) / SAMPLE_RATE
            clips = remaining_speech(audio, resume_from)
            print(f"    resuming from {ts(resume_from)} "
                  f"({min(resume_from / (duration or 1) * 100, 100):.1f}%, {reused} segments kept)",
                  flush=True)
            if clips:
                segments, info = model.transcribe(audio, language=language,
                                                  clip_timestamps=clips)
        else:
            segments, info = model.transcribe(str(video), language=language, vad_filter=True)
            duration = info.duration

        duration = duration or 1
        if info is not None:
            write_state(video, duration=duration,
                        detected_language=info.language if language is None else language)
            if language is None:
                print(f"    detected language: {info.language} ({info.language_probability:.0%})",
                      flush=True)
        else:
            write_state(video, duration=duration)

        if segments is not None:
            with open(partial_path(video), "a", encoding="utf-8", newline="\n") as f:
                for seg in segments:
                    if seg.end <= resume_from + 0.01:      # overlap with saved work
                        continue
                    f.write(json.dumps({"start": round(seg.start, 3), "end": round(seg.end, 3),
                                        "text": seg.text.strip()}, ensure_ascii=False) + "\n")
                    f.flush()
                    os.fsync(f.fileno())
                    write_state(video, last_time=seg.end)
                    pct = min(seg.end / duration * 100, 100)
                    print(f"\r    progress: {pct:5.1f}%", end="", flush=True)
        print(f"\r    progress: 100.0%", flush=True)

        final = load_partial(video)
        build_srt(final, out)
        write_state(video, status="done", last_time=duration, finished=now())
        partial_path(video).unlink(missing_ok=True)
        return len(final), reused
    finally:
        del audio, segments, info
        gc.collect()


def main() -> int:
    # Avoid UnicodeEncodeError on Windows consoles when printing non-ASCII filenames.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError:
            pass

    parser = argparse.ArgumentParser(description="Generate .srt subtitles with faster-whisper.")
    parser.add_argument("inputs", nargs="+", help="Video files and/or folders")
    parser.add_argument("-l", "--language", default="auto",
                        help="Language code (e.g. en, sw) or 'auto' to detect (default: auto)")
    parser.add_argument("-m", "--model", default="small", help="Whisper model size (default: small)")
    parser.add_argument("--overwrite", action="store_true",
                        help="Regenerate subtitles even if an .srt already exists")
    parser.add_argument("--restart", action="store_true",
                        help="Discard saved progress and start from the beginning")
    parser.add_argument("--resume-mismatch", choices=["ask", "continue", "restart", "skip"],
                        default="ask",
                        help="What to do when saved progress used another model/language "
                             "(default: ask; fails the file when not run in a terminal)")
    args = parser.parse_args()
    lang_setting = args.language.lower()

    videos = collect_videos(args.inputs)
    if not videos:
        print("No video files found.", flush=True)
        return 1

    total = len(videos)
    print(f"Found {total} file(s).", flush=True)

    model = None
    done = skipped = failed = 0
    failures: list[tuple[Path, str]] = []

    for i, video in enumerate(videos, 1):
        out = video.with_suffix(".srt")
        prefix = f"[{i}/{total}] {video.name}"

        if args.restart:
            partial_path(video).unlink(missing_ok=True)
            state_path(video).unlink(missing_ok=True)

        has_partial = partial_path(video).exists()
        state = read_state(video)
        if not args.restart and not has_partial and out.exists() and (
                state.get("status") == "done" or not args.overwrite):
            print(f"{prefix} - skipped (subtitle already exists)", flush=True)
            skipped += 1
            continue

        print(f"{prefix} - transcribing...", flush=True)
        try:
            check_media(video)
        except MediaError as e:
            print(f"    FAILED: {e}", flush=True)
            failures.append((video, str(e)))
            failed += 1
            continue

        if not state or args.restart:
            write_state(video, status="pending", model=args.model, language=lang_setting)

        start = time.perf_counter()
        try:
            if model is None:
                print(f"    loading model '{args.model}' ({DEVICE}, {COMPUTE_TYPE})...", flush=True)
                model = WhisperModel(args.model, device=DEVICE, compute_type=COMPUTE_TYPE)
            n, reused = transcribe_one(model, args.model, video, out, lang_setting,
                                       args.resume_mismatch)
            elapsed = time.perf_counter() - start
            extra = f", {reused} reused from earlier run" if reused else ""
            print(f"    saved {out.name} ({n} segments{extra}, {elapsed:.0f}s)", flush=True)
            done += 1
        except KeyboardInterrupt:
            print("\nInterrupted by user. Progress is saved; run again to resume.", flush=True)
            break
        except SettingsMismatch as e:
            print(f"\n    FAILED: {e}", flush=True)
            failures.append((video, str(e)))
            failed += 1
        except Exception as e:
            if isinstance(e, av.error.FFmpegError):      # damaged part found mid-file
                msg = damaged_message(video)
                if partial_path(video).exists():
                    msg += " Progress so far is saved."
            else:
                msg = f"{type(e).__name__}: {e}"
            print(f"\n    FAILED: {msg}", flush=True)
            traceback.print_exc(file=sys.stderr)
            try:
                write_state(video, status="failed", error=msg)
            except OSError:
                pass
            failures.append((video, msg))
            failed += 1
        finally:
            gc.collect()

    print(f"\nFinished: {done} done, {skipped} skipped, {failed} failed.", flush=True)
    for video, err in failures:
        print(f"  - {video}: {err}", flush=True)

    return 1 if failed else 0


def collect_videos(inputs: list[str]) -> list[Path]:
    videos: list[Path] = []
    seen: set[Path] = set()
    for item in inputs:
        p = Path(item).expanduser()
        if p.is_dir():
            candidates = sorted(f for f in p.iterdir()
                                if f.is_file() and f.suffix.lower() in VIDEO_EXTS)
        elif p.is_file():
            candidates = [p]
        else:
            print(f"WARNING: not found, skipping: {p}", flush=True)
            continue
        for f in candidates:
            key = f.resolve()
            if key not in seen:
                seen.add(key)
                videos.append(f)
    return videos


if __name__ == "__main__":
    sys.exit(main())
