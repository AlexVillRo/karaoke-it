#!/usr/bin/env python3
"""
High-precision karaoke preprocessing pipeline.

Input (stdin JSON):
{
  "song_id": "...",
  "title": "...",
  "artist": "...",
  "audio_url": "/uploads/....mp3",
  "audio_file_path": "C:\\...\\public\\uploads\\....mp3",
  "provided_lyrics": ".... optional ..."
}

Output (stdout JSON):
{
  "song": {
    "id": "...",
    "title": "...",
    "artist": "...",
    "audioUrl": "...",
    "bpm": 90,
    "notes": [...]
  },
  "metrics": {...}
}
"""

from __future__ import annotations

import json
import math
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import librosa
import numpy as np
import pyphen
import requests

MIN_WORD_DURATION = 0.35
MIN_NOTE_DURATION = 0.22
DEFAULT_TARGET_SECONDS = 63.0   # fallback when audio_duration is invalid
MAX_TARGET_SECONDS    = 360.0   # hard cap: 6 min (longer songs hit this)
SAMPLE_RATE = 22050
HOP_LENGTH = 256
FRAME_LENGTH = 2048


@dataclass
class LyricsWord:
    word: str
    line_idx: int


@dataclass
class TimedWord:
    word: str
    start: float
    end: float


def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr)


def clean_token(word: str) -> str:
    word = re.sub(r"\s+", " ", word or "").strip()
    word = re.sub(r"[^\w'\-]+", "", word, flags=re.UNICODE)
    return word.strip()


def normalize_for_match(word: str) -> str:
    raw = clean_token(word).lower()
    raw = unicodedata.normalize("NFD", raw)
    raw = "".join(ch for ch in raw if unicodedata.category(ch) != "Mn")
    return raw


def parse_lyrics_words(lyrics: str) -> list[LyricsWord]:
    out: list[LyricsWord] = []
    lines = [ln.strip() for ln in (lyrics or "").splitlines() if ln.strip()]
    for line_idx, line in enumerate(lines):
        for raw in re.split(r"\s+", line):
            tok = clean_token(raw)
            if tok:
                out.append(LyricsWord(tok, line_idx))
    return out


def fetch_online_lyrics(title: str, artist: str) -> str:
    title = (title or "").strip()
    artist = (artist or "").strip()
    if not title:
        return ""

    params = {"track_name": title}
    if artist:
        params["artist_name"] = artist

    # lrclib first
    try:
        resp = requests.get("https://lrclib.net/api/search", params=params, timeout=10)
        if resp.ok:
            items = resp.json()
            if isinstance(items, list):
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    synced = (item.get("syncedLyrics") or "").strip()
                    plain = (item.get("plainLyrics") or "").strip()
                    if synced:
                        # Remove [mm:ss.xx] tags and keep line breaks.
                        text = re.sub(r"\[\d{1,2}:\d{2}(?:\.\d{1,2})?\]", "", synced)
                        text = "\n".join(ln.strip() for ln in text.splitlines() if ln.strip())
                        if text:
                            return text
                    if plain:
                        return plain
    except Exception:
        pass

    # lyrics.ovh fallback
    if artist:
        try:
            url = f"https://api.lyrics.ovh/v1/{requests.utils.quote(artist)}/{requests.utils.quote(title)}"
            resp = requests.get(url, timeout=10)
            if resp.ok:
                data = resp.json()
                if isinstance(data, dict):
                    lyrics = (data.get("lyrics") or "").strip()
                    if lyrics:
                        return lyrics
        except Exception:
            pass

    return ""


def separate_vocals(audio_file_path: str) -> str:
    """
    Returns path to vocals file.
    Falls back to original file when separation fails.
    """
    use_demucs = os.getenv("KARAOKE_USE_DEMUCS", "1").strip() not in {"0", "false", "False"}
    if not use_demucs:
        return audio_file_path

    with tempfile.TemporaryDirectory(prefix="karaokit_demucs_") as tmpdir:
        out_dir = Path(tmpdir) / "out"
        ffmpeg_bin = find_ffmpeg_bin_dir()
        env = os.environ.copy()
        if ffmpeg_bin:
            env["PATH"] = f"{ffmpeg_bin}{os.pathsep}{env.get('PATH', '')}"
        cmd = [
            sys.executable,
            "-m",
            "demucs",
            "--two-stems=vocals",
            "-n",
            os.getenv("KARAOKE_DEMUCS_MODEL", "htdemucs"),
            "-o",
            str(out_dir),
            audio_file_path,
        ]
        try:
            proc = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=False,
                env=env,
            )
            if proc.returncode != 0:
                eprint("demucs failed, fallback to original audio")
                eprint(proc.stderr[-2000:])
                return audio_file_path

            matches = list(out_dir.rglob("vocals.wav"))
            if not matches:
                return audio_file_path

            # Persist vocals into sibling temp file because TemporaryDirectory is about to close.
            keep_dir = Path(tempfile.mkdtemp(prefix="karaokit_vocals_"))
            dst = keep_dir / "vocals.wav"
            dst.write_bytes(matches[0].read_bytes())
            return str(dst)
        except Exception as exc:
            eprint(f"demucs exception: {exc}")
            return audio_file_path


def find_ffmpeg_bin_dir() -> str:
    candidates = [
        Path(r"C:\Users\junio\AppData\Local\Microsoft\WinGet\Packages"),
        Path(r"C:\Program Files"),
    ]
    for root in candidates:
        if not root.exists():
            continue
        try:
            for exe in root.rglob("ffmpeg.exe"):
                return str(exe.parent)
        except Exception:
            continue
    return ""


def transcribe_with_openai(audio_path: str) -> list[TimedWord]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return []

    model = os.getenv("OPENAI_TRANSCRIBE_MODEL", "whisper-1")
    url = "https://api.openai.com/v1/audio/transcriptions"

    try:
        with open(audio_path, "rb") as f:
            files = {"file": (Path(audio_path).name, f, "audio/mpeg")}
            data = {
                "model": model,
                "language": "es",
                "response_format": "verbose_json",
                "timestamp_granularities[]": "word",
            }
            headers = {"Authorization": f"Bearer {api_key}"}
            resp = requests.post(url, files=files, data=data, headers=headers, timeout=300)

        if not resp.ok:
            eprint(f"openai transcription failed: {resp.status_code}")
            eprint(resp.text[:1000])
            return []

        payload = resp.json()
        words = payload.get("words", []) if isinstance(payload, dict) else []
        out: list[TimedWord] = []
        for w in words:
            if not isinstance(w, dict):
                continue
            tok = clean_token(str(w.get("word", "")))
            try:
                start = float(w.get("start", 0.0))
                end = float(w.get("end", start + MIN_WORD_DURATION))
            except Exception:
                continue
            if not tok:
                continue
            out.append(TimedWord(tok, max(0.0, start), max(start + MIN_WORD_DURATION, end)))
        return out
    except Exception as exc:
        eprint(f"openai transcription exception: {exc}")
        return []


def needleman_wunsch_map(lyrics: list[LyricsWord], transcribed: list[TimedWord]) -> list[int | None]:
    m = len(lyrics)
    n = len(transcribed)
    if m == 0:
        return []
    if n == 0:
        return [None] * m

    l_norm = [normalize_for_match(x.word) for x in lyrics]
    t_norm = [normalize_for_match(x.word) for x in transcribed]

    def score(a: str, b: str) -> int:
        if not a or not b:
            return -2
        if a == b:
            return 3
        if a in b or b in a:
            return 1
        return -2

    gap = -1
    dp = np.zeros((m + 1, n + 1), dtype=np.int32)
    ptr = np.zeros((m + 1, n + 1), dtype=np.int8)  # 1=diag, 2=up, 3=left

    for i in range(1, m + 1):
        dp[i, 0] = dp[i - 1, 0] + gap
        ptr[i, 0] = 2
    for j in range(1, n + 1):
        dp[0, j] = dp[0, j - 1] + gap
        ptr[0, j] = 3

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            diag = dp[i - 1, j - 1] + score(l_norm[i - 1], t_norm[j - 1])
            up = dp[i - 1, j] + gap
            left = dp[i, j - 1] + gap
            best = max(diag, up, left)
            dp[i, j] = best
            if best == diag:
                ptr[i, j] = 1
            elif best == up:
                ptr[i, j] = 2
            else:
                ptr[i, j] = 3

    mapping: list[int | None] = [None] * m
    i, j = m, n
    while i > 0 or j > 0:
        p = ptr[i, j]
        if p == 1 and i > 0 and j > 0:
            a = l_norm[i - 1]
            b = t_norm[j - 1]
            if a and b and (a == b or a in b or b in a):
                mapping[i - 1] = j - 1
            i -= 1
            j -= 1
        elif p == 2 and i > 0:
            i -= 1
        elif p == 3 and j > 0:
            j -= 1
        else:
            break

    return mapping


def align_lyrics_to_timing(
    lyrics_words: list[LyricsWord],
    timed_words: list[TimedWord],
    target_duration: float,
    lyric_start: float = 0.0,
) -> list[TimedWord]:
    if not lyrics_words:
        return []

    if not timed_words:
        # Uniform distribution starting from detected vocal start
        available = max(MIN_WORD_DURATION * len(lyrics_words), target_duration - lyric_start)
        per = max(MIN_WORD_DURATION, available / max(1, len(lyrics_words)))
        out: list[TimedWord] = []
        for i, lw in enumerate(lyrics_words):
            st = lyric_start + i * per
            out.append(TimedWord(lw.word, st, st + per * 0.9))
        return out

    mapping = needleman_wunsch_map(lyrics_words, timed_words)
    out: list[TimedWord] = [TimedWord(lw.word, 0.0, MIN_WORD_DURATION) for lw in lyrics_words]

    # Assign anchors.
    for i, mapped in enumerate(mapping):
        if mapped is None:
            continue
        tw = timed_words[mapped]
        out[i].start = tw.start
        out[i].end = max(tw.start + MIN_WORD_DURATION, tw.end)

    # Fill gaps by interpolation between anchors.
    n = len(out)
    i = 0
    while i < n:
        if mapping[i] is not None:
            i += 1
            continue
        gap_start = i
        while i < n and mapping[i] is None:
            i += 1
        gap_end = i - 1

        left_idx = gap_start - 1
        right_idx = i

        left_t = 0.0
        if left_idx >= 0:
            left_t = out[left_idx].end

        right_t = target_duration
        if right_idx < n and mapping[right_idx] is not None:
            right_t = out[right_idx].start

        count = gap_end - gap_start + 1
        span = max(count * MIN_WORD_DURATION, right_t - left_t)
        each = span / count

        for k in range(count):
            idx = gap_start + k
            st = left_t + k * each
            out[idx].start = st
            out[idx].end = st + each * 0.9

    # Monotonic cleanup: cada palabra empieza después de que termina la anterior.
    out_sorted: list[TimedWord] = []
    cursor = 0.0
    for tw in out:
        st = max(cursor, tw.start)
        en = max(st + MIN_WORD_DURATION, tw.end)
        out_sorted.append(TimedWord(tw.word, st, en))
        cursor = en  # Bug fix: avanzar al FIN de la palabra, no al inicio

    return out_sorted


def extract_pitch_track(audio_path: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    y, sr = librosa.load(audio_path, sr=SAMPLE_RATE, mono=True)
    f0, voiced_flag, _ = librosa.pyin(
        y,
        fmin=librosa.note_to_hz("C2"),
        fmax=librosa.note_to_hz("C7"),
        sr=sr,
        frame_length=FRAME_LENGTH,
        hop_length=HOP_LENGTH,
    )
    times = librosa.times_like(f0, sr=sr, hop_length=HOP_LENGTH)
    if voiced_flag is None:
        voiced_flag = np.zeros(len(f0), dtype=bool)
    f0 = np.where(voiced_flag, f0, np.nan)
    return times, f0, voiced_flag


def detect_vocal_start(times: np.ndarray, voiced_flag: np.ndarray) -> float:
    """Return the estimated start time (seconds) of sustained vocal activity."""
    if len(times) == 0 or len(voiced_flag) == 0:
        return 0.0
    hop_sec = float(times[1] - times[0]) if len(times) > 1 else HOP_LENGTH / SAMPLE_RATE
    win_frames = max(4, int(0.5 / hop_sec))  # 0.5-second window
    voiced = voiced_flag.astype(float)
    n = len(voiced)
    for i in range(n - win_frames + 1):
        if voiced[i : i + win_frames].mean() >= 0.5:
            return float(times[max(0, i)])
    return 0.0


def hz_to_midi(hz: float) -> int:
    if hz <= 0:
        return 60
    midi = int(round(69 + 12 * math.log2(hz / 440.0)))
    return max(36, min(92, midi))


def median_midi_for_window(times: np.ndarray, f0: np.ndarray, start: float, end: float) -> int | None:
    mask = (times >= start) & (times <= end) & np.isfinite(f0)
    vals = f0[mask]
    if vals.size == 0:
        # widen search
        pad = 0.15
        mask = (times >= start - pad) & (times <= end + pad) & np.isfinite(f0)
        vals = f0[mask]
    if vals.size == 0:
        return None
    return hz_to_midi(float(np.median(vals)))


def split_syllables(word: str, dic: pyphen.Pyphen) -> list[str]:
    tok = clean_token(word)
    if not tok:
        return []
    hyph = dic.inserted(tok)
    if not hyph:
        return [tok]
    parts = [p.strip() for p in hyph.split("-") if p.strip()]
    return parts or [tok]


def build_notes(
    lyrics_words: list[LyricsWord],
    aligned_words: list[TimedWord],
    times: np.ndarray,
    f0: np.ndarray,
    target_duration: float,
) -> list[dict[str, Any]]:
    dic = pyphen.Pyphen(lang="es")
    notes: list[dict[str, Any]] = []
    prev_midi = 60

    for i, (lw, aw) in enumerate(zip(lyrics_words, aligned_words, strict=False)):
        syllables = split_syllables(lw.word, dic)
        if not syllables:
            syllables = [lw.word]

        word_start = max(0.0, min(target_duration, aw.start))
        word_end = max(word_start + MIN_WORD_DURATION, min(target_duration, aw.end))
        word_dur = word_end - word_start
        each = max(MIN_NOTE_DURATION, word_dur / max(1, len(syllables)))

        for k, syl in enumerate(syllables):
            st = word_start + k * each
            en = min(word_end, st + each * 0.95)
            if en <= st:
                en = st + MIN_NOTE_DURATION

            midi = median_midi_for_window(times, f0, st, en)
            if midi is None:
                midi = prev_midi
            prev_midi = midi

            is_last_syl = k == len(syllables) - 1
            notes.append(
                {
                    "startTime": round(st, 3),
                    "duration": round(max(MIN_NOTE_DURATION, en - st), 3),
                    "pitch": int(midi),
                    # Última sílaba de cada palabra lleva espacio (word boundary marker).
                    # Sílabas intermedias llevan guion para indicar continuación.
                    "syllable": f"{syl} " if is_last_syl else f"{syl}-",
                    "lineIdx": int(lw.line_idx),
                }
            )

    # Ordenar y eliminar notas que se solapan (la anterior no terminó antes de que empiece la siguiente)
    notes.sort(key=lambda n: n["startTime"])
    filtered: list[dict] = []
    last_end = -1.0
    for n in notes:
        if n["startTime"] >= last_end - 0.01:  # tolerancia de 10ms
            filtered.append(n)
            last_end = n["startTime"] + n["duration"]

    return [n for n in filtered if n["startTime"] < target_duration]


def estimate_bpm(notes: list[dict[str, Any]]) -> int:
    if len(notes) < 4:
        return 90
    durs = sorted(float(n["duration"]) for n in notes)
    med = durs[len(durs) // 2]
    bpm = int(round(60.0 / max(0.2, med)))
    return max(60, min(170, bpm))


def main() -> int:
    payload = json.load(sys.stdin)

    song_id = str(payload.get("song_id") or "").strip()
    title = str(payload.get("title") or "").strip()
    artist = str(payload.get("artist") or "").strip()
    audio_url = str(payload.get("audio_url") or "").strip()
    audio_file_path = str(payload.get("audio_file_path") or "").strip()
    provided_lyrics = str(payload.get("provided_lyrics") or "").strip()

    if not title:
        raise ValueError("Missing title")
    if not audio_file_path:
        raise ValueError("Missing audio_file_path")
    if not Path(audio_file_path).exists():
        raise ValueError(f"Audio file not found: {audio_file_path}")

    lyrics = provided_lyrics or fetch_online_lyrics(title, artist)
    if not lyrics.strip():
        raise ValueError("No lyrics available. Provide lyrics manually or use a song with online lyrics.")

    lyrics_words = parse_lyrics_words(lyrics)
    if len(lyrics_words) < 4:
        raise ValueError("Lyrics too short for karaoke generation.")

    vocals_path = separate_vocals(audio_file_path)
    y_tmp, sr_tmp = librosa.load(vocals_path, sr=SAMPLE_RATE, mono=True)
    audio_duration = float(librosa.get_duration(y=y_tmp, sr=sr_tmp))
    if not np.isfinite(audio_duration) or audio_duration <= 0:
        audio_duration = DEFAULT_TARGET_SECONDS
    # Use the full audio duration (not capped at 63 s) so lyrics are correctly spaced.
    target_duration = min(audio_duration, MAX_TARGET_SECONDS)

    times, f0, voiced_flag = extract_pitch_track(vocals_path)
    vocal_start = detect_vocal_start(times, voiced_flag)
    eprint(f"vocal_start detected: {vocal_start:.2f}s  target_duration: {target_duration:.2f}s")

    transcribed_words = transcribe_with_openai(vocals_path)
    transcribed_words = [
        TimedWord(
            word=w.word,
            start=max(0.0, min(target_duration, w.start)),
            end=max(min(target_duration, w.end), min(target_duration, w.start + MIN_WORD_DURATION)),
        )
        for w in transcribed_words
        if w.start < target_duration
    ]

    # lyric_start: for uniform distribution (no Whisper) start at vocal_start.
    # For Whisper-aligned words the timestamps already reflect the actual audio.
    lyric_start = 0.0 if transcribed_words else vocal_start
    aligned_words = align_lyrics_to_timing(lyrics_words, transcribed_words, target_duration, lyric_start=lyric_start)

    notes = build_notes(lyrics_words, aligned_words, times, f0, target_duration)

    # Auto-detect lyricsOffsetSeconds: use vocal_start if meaningful, else 0.
    # With Whisper, use the first transcribed word's start time.
    if transcribed_words:
        auto_offset = round(transcribed_words[0].start, 1) if transcribed_words[0].start >= 1.0 else 0.0
    else:
        auto_offset = round(vocal_start, 1) if vocal_start >= 1.0 else 0.0

    if len(notes) < 8:
        raise ValueError("Generated notes are insufficient. Try better quality audio or provide clearer lyrics.")

    song = {
        "id": song_id or f"song-{randomUUID()}",
        "title": title,
        "artist": artist or "Usuario",
        "audioUrl": audio_url,
        "bpm": estimate_bpm(notes),
        "notes": notes,
        "lyricsOffsetSeconds": auto_offset,
    }
    out = {
        "song": song,
        "metrics": {
            "lyrics_words": len(lyrics_words),
            "transcribed_words": len(transcribed_words),
            "notes": len(notes),
            "audio_duration_sec": round(audio_duration, 2),
            "target_duration_sec": round(target_duration, 2),
            "vocal_start_sec": round(vocal_start, 2),
            "auto_offset_sec": auto_offset,
            "used_online_lyrics": not bool(provided_lyrics),
            "used_vocal_separation": Path(vocals_path).suffix.lower() == ".wav" and vocals_path != audio_file_path,
        },
    }
    print(json.dumps(out, ensure_ascii=False))
    return 0


def randomUUID() -> str:
    # Fallback in python for song id when not provided.
    import uuid

    return str(uuid.uuid4())


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        eprint(f"pipeline error: {exc}")
        raise
