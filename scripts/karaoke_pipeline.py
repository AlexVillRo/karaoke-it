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

# detect_vocal_word_segments tuning
# MIN_SILENCE_FRAMES: frames consecutivos sin pitch para declarar fin de palabra (~46ms a hop=256/sr=22050)
# VOICED_TAIL_S: extensión del extremo de la nota para compensar atenuación del stem vocal de Demucs
WORD_END_SILENCE_FRAMES = 4
WORD_END_TAIL_S = 0.12


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


# ---------------------------------------------------------------------------
# Synced-lyrics helpers (syncedlyrics library — optional, graceful fallback)
# ---------------------------------------------------------------------------

# LRC timestamp regex: [mm:ss.xx] or [mm:ss.xxx]
_LRC_TS_RE = re.compile(r"\[(\d{1,2}):(\d{2})\.(\d{1,3})\]")
# Word-level timestamp inside an enhanced LRC line: <mm:ss.xx>
_LRC_WORD_RE = re.compile(r"<(\d{1,2}):(\d{2})\.(\d{1,3})>([^<\[\]\n]*)")


def _lrc_ts(m: str, s: str, frac: str) -> float:
    """Convert LRC timestamp strings (mins, secs, fractional) to seconds."""
    # LRC fractional part can be 2 digits (centiseconds) or 3 (milliseconds)
    frac_ms = int(frac.ljust(3, "0")[:3])
    return int(m) * 60 + int(s) + frac_ms / 1000.0


def fetch_synced_lyrics(title: str, artist: str) -> tuple[str | None, bool]:
    """
    Try to fetch synchronized LRC lyrics from online databases via syncedlyrics.
    Returns (lrc_content, is_word_level).
    - lrc_content: raw LRC string, or None if unavailable.
    - is_word_level: True when the LRC contains per-word <mm:ss.xx> timestamps.
    Falls back silently on import error or network issues.
    """
    use_sl = os.getenv("KARAOKE_USE_SYNCEDLYRICS", "1").strip() not in {"0", "false", "False"}
    if not use_sl:
        return None, False

    try:
        import syncedlyrics  # type: ignore[import]
    except ImportError:
        eprint("syncedlyrics not installed — skipping synced-lyrics fetch")
        return None, False

    query = f"{title} {artist}".strip() if artist else title.strip()
    if not query:
        return None, False

    # 1. Try enhanced (word-level) first — Musixmatch is the main source
    try:
        lrc = syncedlyrics.search(
            query, enhanced=True, providers=["Musixmatch", "NetEase", "Lrclib"]
        )
        if lrc:
            is_enhanced = bool(_LRC_WORD_RE.search(lrc))
            eprint(f"syncedlyrics: {'word-level' if is_enhanced else 'line-level'} LRC found (enhanced=True)")
            return lrc, is_enhanced
    except Exception as exc:
        eprint(f"syncedlyrics enhanced search error: {exc}")

    # 2. Fall back to standard line-level LRC
    try:
        lrc = syncedlyrics.search(
            query, enhanced=False, providers=["Musixmatch", "NetEase", "Lrclib"]
        )
        if lrc:
            eprint("syncedlyrics: line-level LRC found (enhanced=False)")
            return lrc, False
    except Exception as exc:
        eprint(f"syncedlyrics standard search error: {exc}")

    return None, False


def parse_lrc_words(lrc_content: str) -> list[TimedWord]:
    """
    Parse an enhanced (karaoke) LRC string into a list of TimedWord.
    Enhanced format: [mm:ss.xx] <mm:ss.xx>word1 <mm:ss.xx>word2 ...
    Each word's end time = next word's start time (or word start + MIN_WORD_DURATION*2).
    """
    out: list[TimedWord] = []
    for line in lrc_content.splitlines():
        line = line.strip()
        lm = _LRC_TS_RE.match(line)
        if not lm:
            continue
        word_matches = _LRC_WORD_RE.findall(line)
        if not word_matches:
            continue
        parsed: list[tuple[float, str]] = []
        for wm, ws, wf, wtext in word_matches:
            t = _lrc_ts(wm, ws, wf)
            tok = clean_token(wtext)
            if tok:
                parsed.append((t, tok))
        for i, (t, tok) in enumerate(parsed):
            next_t = parsed[i + 1][0] if i + 1 < len(parsed) else t + MIN_WORD_DURATION * 3
            out.append(TimedWord(tok, t, max(t + MIN_WORD_DURATION, next_t - 0.02)))
    return out


def parse_lrc_lines(lrc_content: str) -> list[tuple[float, str]]:
    """
    Parse a standard LRC string into a list of (start_seconds, line_text).
    Filters out empty lines and metadata tags like [ti:...].
    """
    META_RE = re.compile(r"^\[(?:ti|ar|al|by|offset|length|re|ve):", re.IGNORECASE)
    out: list[tuple[float, str]] = []
    for line in lrc_content.splitlines():
        line = line.strip()
        lm = _LRC_TS_RE.match(line)
        if not lm or META_RE.match(line):
            continue
        # Strip all leading [mm:ss.xx] tags (some lines have multiple)
        text = _LRC_TS_RE.sub("", line)
        # Strip word-level tags too
        text = _LRC_WORD_RE.sub(lambda m: m.group(4), text).strip()
        if text:
            out.append((_lrc_ts(lm.group(1), lm.group(2), lm.group(3)), text))
    out.sort(key=lambda x: x[0])
    return out


def lrc_to_plain_text(lrc_content: str) -> str:
    """Extract plain (unsynced) lyrics text from LRC content."""
    lines = parse_lrc_lines(lrc_content)
    return "\n".join(txt for _, txt in lines)


# Max duration assigned to a single word when distributing LRC line text proportionally.
# Prevents trailing silence (instrumental gap before next LRC line) from bloating durations.
_PER_WORD_MAX_SEC = 1.2


def lrc_lines_to_timed_words(
    line_timestamps: list[tuple[float, str]],
    target_duration: float,
) -> list[TimedWord]:
    """
    Convert LRC line-level timestamps into approximate per-word TimedWords.

    Strategy: for each line, tokenize the LRC line text and distribute the words
    proportionally by character count within the line's time window — but cap the
    total line duration at len(words) * _PER_WORD_MAX_SEC.  This prevents the
    trailing silence / instrumental gap before the next LRC line from being assigned
    to the last word of the current line.

    The resulting list is fed to the Needleman-Wunsch aligner (align_lyrics_to_timing)
    so it can match these approximate timestamps to the canonical lyrics words.
    """
    out: list[TimedWord] = []
    for i, (line_start, line_text) in enumerate(line_timestamps):
        line_end = (
            line_timestamps[i + 1][0] if i + 1 < len(line_timestamps) else target_duration
        )
        words = [clean_token(w) for w in re.split(r"\s+", line_text)]
        words = [w for w in words if w]
        if not words:
            continue

        # Cap the usable span: don't let the gap-to-next-line inflate durations.
        usable = min(line_end - line_start, len(words) * _PER_WORD_MAX_SEC)
        usable = max(usable, len(words) * MIN_WORD_DURATION)

        char_counts = [max(1, len(w)) for w in words]
        total_chars = sum(char_counts)

        t = line_start
        for word, chars in zip(words, char_counts):
            word_dur = max(MIN_WORD_DURATION, (chars / total_chars) * usable)
            out.append(TimedWord(word, t, min(line_end, t + word_dur * 0.92)))
            t += word_dur

    return out


def lrc_lines_with_segments_to_timed_words(
    line_timestamps: list[tuple[float, str]],
    vocal_segments: list[tuple[float, float]],
    target_duration: float,
) -> list[TimedWord]:
    """
    Improved LRC line-level distribution that anchors words to vocal segments.

    For each LRC line:
      1. Find vocal segments that overlap with the line's time window.
      2. If segments are found: distribute the line's words across those segments
         proportionally by character count within each segment.
      3. If no segments overlap (e.g. purely instrumental intro): fall back to
         proportional char-count distribution across the full line window
         (same behaviour as lrc_lines_to_timed_words).

    This turns coarse line-level LRC timestamps into per-word timing that is
    grounded in actual audio energy rather than uniform character-count guesses.
    """
    out: list[TimedWord] = []

    for i, (line_start, line_text) in enumerate(line_timestamps):
        line_end = (
            line_timestamps[i + 1][0] if i + 1 < len(line_timestamps) else target_duration
        )
        words = [clean_token(w) for w in re.split(r"\s+", line_text)]
        words = [w for w in words if w]
        if not words:
            continue

        # Vocal segments that overlap with this line's time window
        line_segs = [
            (max(s, line_start), min(e, line_end))
            for s, e in vocal_segments
            if s < line_end and e > line_start
        ]
        line_segs = [(s, e) for s, e in line_segs if e - s >= 0.08]

        if line_segs:
            n_segs = len(line_segs)
            n_words = len(words)
            char_counts = [max(1, len(w)) for w in words]
            total_chars = sum(char_counts)

            if n_segs >= n_words:
                # More segments than words: assign each word to a proportional segment
                for j, word in enumerate(words):
                    si = min(int(j * n_segs / n_words), n_segs - 1)
                    s, e = line_segs[si]
                    out.append(TimedWord(word, s, max(s + MIN_WORD_DURATION, e * 0.95 + s * 0.05)))
            else:
                # Fewer segments than words: fill each segment with its word share
                words_by_seg: list[list[str]] = [[] for _ in range(n_segs)]
                char_cursor = 0
                for word, chars in zip(words, char_counts):
                    si = min(int(char_cursor / total_chars * n_segs), n_segs - 1)
                    words_by_seg[si].append(word)
                    char_cursor += chars

                for si, (s, e) in enumerate(line_segs):
                    sw = words_by_seg[si]
                    if not sw:
                        continue
                    seg_dur = e - s
                    sc = [max(1, len(w)) for w in sw]
                    tc = sum(sc)
                    t = s
                    for word, chars in zip(sw, sc):
                        wd = max(MIN_WORD_DURATION, (chars / tc) * seg_dur * 0.92)
                        out.append(TimedWord(word, t, min(e, t + wd)))
                        t += wd
        else:
            # Fallback: proportional by character count within line window
            usable = min(line_end - line_start, len(words) * _PER_WORD_MAX_SEC)
            usable = max(usable, len(words) * MIN_WORD_DURATION)
            char_counts = [max(1, len(w)) for w in words]
            total_chars = sum(char_counts)
            t = line_start
            for word, chars in zip(words, char_counts):
                word_dur = max(MIN_WORD_DURATION, (chars / total_chars) * usable)
                out.append(TimedWord(word, t, min(line_end, t + word_dur * 0.92)))
                t += word_dur

    return out


def vocal_segments_to_timed_words(
    segments: list[tuple[float, float]],
    lyrics_words: list[LyricsWord],
) -> list[TimedWord]:
    """
    Positional assignment of lyrics words to vocal segments (no text matching).

    Used as a fallback when neither LRC nor Whisper is available.
    Words are distributed across segments proportionally by cumulative character
    count; within each segment they are further split by character count.

    Better than uniform pyin distribution because it follows actual audio activity:
    words land where the singer is actually singing.
    """
    if not segments or not lyrics_words:
        return []

    n_segs = len(segments)
    char_counts = [max(1, len(lw.word)) for lw in lyrics_words]
    total_chars = sum(char_counts)

    words_by_seg: list[list[LyricsWord]] = [[] for _ in range(n_segs)]
    char_cursor = 0
    for lw, chars in zip(lyrics_words, char_counts):
        si = min(int(char_cursor / total_chars * n_segs), n_segs - 1)
        words_by_seg[si].append(lw)
        char_cursor += chars

    out: list[TimedWord] = []
    for si, (s, e) in enumerate(segments):
        sw = words_by_seg[si]
        if not sw:
            continue
        seg_dur = e - s
        sc = [max(1, len(lw.word)) for lw in sw]
        tc = sum(sc)
        t = s
        for lw, chars in zip(sw, sc):
            wd = max(MIN_WORD_DURATION, (chars / tc) * seg_dur * 0.92)
            out.append(TimedWord(lw.word, t, min(e, t + wd)))
            t += wd

    return out


# ---------------------------------------------------------------------------


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


def detect_vocal_word_segments(
    vocals_path: str,
    times: np.ndarray,
    voiced_flag: np.ndarray,
    *,
    onset_delta: float = 0.07,
    onset_min_gap: float = 0.08,
    voiced_window: float = 0.12,
    max_word_dur: float = 3.0,
) -> list[tuple[float, float]]:
    """
    Detect vocal word segments (start, end) by combining two signals:

      1. Onset detection → word STARTS (robust attack transients).
      2. pyin voiced_flag → word ENDS (when pitch stops after each onset).

    The voiced_flag is key: pyin detects periodic pitch (= actual singing),
    NOT just energy. Demucs residue from instruments is mostly aperiodic, so
    pyin correctly reports it as unvoiced. This lets us:
      a) Filter residue onsets (those where no pitch is detected nearby).
      b) Find accurate word end times (first unvoiced frame after the onset).

    Example for "Ay Fonsi DY" intro at 6.9 / 9.0 / 10.6 s:
      - Onset at 6.9 s → pyin voiced until 7.5 s → segment (6.9, 7.5)  = 0.6 s ✓
      - Residue onset at 7.3 s → no pitch nearby → SKIPPED ✓
      - Onset at 9.0 s → pyin voiced until 9.25 s → segment (9.0, 9.25) = 0.25 s ✓
      - Onset at 10.6 s → pyin voiced until 10.85 s → segment            = 0.25 s ✓

    Returns a sorted list of (start_s, end_s) pairs representing actual sung notes.
    """
    try:
        y, sr = librosa.load(vocals_path, sr=SAMPLE_RATE, mono=True)
    except Exception as exc:
        eprint(f"detect_vocal_word_segments: load error: {exc}")
        return []

    # Step 1: detect onsets (attack transients)
    raw_onsets = librosa.onset.onset_detect(
        y=y, sr=sr, hop_length=HOP_LENGTH,
        units="time", backtrack=True,
        delta=onset_delta,
    )
    if len(raw_onsets) == 0:
        return []

    # Merge onsets that are very close (same syllable)
    merged: list[float] = [float(raw_onsets[0])]
    for t in raw_onsets[1:]:
        if float(t) - merged[-1] >= onset_min_gap:
            merged.append(float(t))

    if len(times) < 2:
        return []
    hop_sec = float(times[1] - times[0])

    segments: list[tuple[float, float]] = []

    for onset_t in merged:
        # Step 2a: Filter — require pitch detected near onset (onset is real singing)
        idx = int(np.searchsorted(times, onset_t))
        win_frames = max(1, int(voiced_window / hop_sec))
        lo = max(0, idx - 1)
        hi = min(len(voiced_flag), idx + win_frames)
        if not np.any(voiced_flag[lo:hi]):
            continue  # no pitch near this onset → residue, skip

        # Step 2b: Find when pitch stops after the onset.
        # Require WORD_END_SILENCE_FRAMES consecutive unvoiced frames before calling it
        # the end — avoids cutting off mid-vowel at brief devoicing moments (e.g.
        # plosive releases within "Ay"). Also adds a short tail to compensate for
        # Demucs vocal-stem attenuation at word boundaries.
        word_end = onset_t + MIN_WORD_DURATION
        found_voiced = False
        consecutive_unvoiced = 0
        max_frames = int(max_word_dur / hop_sec)
        for i in range(idx, min(len(times), idx + max_frames)):
            if voiced_flag[i]:
                found_voiced = True
                consecutive_unvoiced = 0
            else:
                consecutive_unvoiced += 1
                if found_voiced and consecutive_unvoiced >= WORD_END_SILENCE_FRAMES:
                    word_end = float(times[i]) + WORD_END_TAIL_S
                    break
        else:
            if found_voiced:
                word_end = float(times[min(len(times) - 1, idx + max_frames)]) + WORD_END_TAIL_S

        segments.append((onset_t, max(onset_t + MIN_WORD_DURATION, word_end)))

    eprint(
        f"detect_vocal_word_segments: {len(merged)} onsets → "
        f"{len(segments)} vocal segments after voiced filter"
    )
    return segments


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
    # Optional: path to a pre-separated vocals stem (skips Demucs entirely).
    # Useful when Demucs output has already been generated for the audio.
    preset_vocals_path = str(payload.get("vocals_file_path") or "").strip()

    if not title:
        raise ValueError("Missing title")
    if not audio_file_path:
        raise ValueError("Missing audio_file_path")
    if not Path(audio_file_path).exists():
        raise ValueError(f"Audio file not found: {audio_file_path}")

    # Fetch synced LRC early — fast network call; provides timing and text fallback.
    lrc_content, lrc_is_word_level = fetch_synced_lyrics(title, artist)

    lyrics = provided_lyrics or fetch_online_lyrics(title, artist)
    # Last-resort: extract plain text from synced LRC when all other lyrics sources fail.
    if not lyrics.strip() and lrc_content:
        lyrics = lrc_to_plain_text(lrc_content)
        eprint("Using LRC plain text as lyrics source")
    if not lyrics.strip():
        raise ValueError("No lyrics available. Provide lyrics manually or use a song with online lyrics.")

    lyrics_words = parse_lyrics_words(lyrics)
    if len(lyrics_words) < 4:
        raise ValueError("Lyrics too short for karaoke generation.")

    if preset_vocals_path and Path(preset_vocals_path).exists():
        eprint(f"Using pre-separated vocals: {preset_vocals_path}")
        vocals_path = preset_vocals_path
    else:
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

    # Detect vocal word segments: onset detection filtered by pyin voiced_flag.
    # Each segment = (start, end) where the singer is actually producing pitched sound.
    # Used in Priority 1b (LRC line + audio anchors) and Priority 2.5 (positional fallback).
    vocal_word_segs = detect_vocal_word_segments(vocals_path, times, voiced_flag)
    vocal_segments = vocal_word_segs  # alias for Priority 2.5 positional fallback

    # -----------------------------------------------------------------------
    # Timing priority chain
    # 1a. syncedlyrics word-level  → most accurate, skips Whisper entirely
    # 1b. syncedlyrics line-level  → line anchors + optional Whisper within
    # 2.  Whisper API              → existing word-level fallback
    # 3.  pyin uniform             → last resort (no network, no API key)
    # -----------------------------------------------------------------------
    timing_source = "pyin_uniform"
    transcribed_words: list[TimedWord] = []
    aligned_words: list[TimedWord] | None = None
    lrc_first_t: float | None = None

    # --- Priority 1a: enhanced (word-level) LRC ---
    if lrc_content and lrc_is_word_level:
        lrc_words = [w for w in parse_lrc_words(lrc_content) if w.start < target_duration]
        if len(lrc_words) >= 5:
            aligned_words = align_lyrics_to_timing(lyrics_words, lrc_words, target_duration)
            timing_source = "lrc_word"
            lrc_first_t = lrc_words[0].start if lrc_words else None
            eprint(f"Timing source: enhanced LRC word-level ({len(lrc_words)} timestamps)")

    # --- Priority 1b: line-level LRC ---
    # Strategy: extract words from the LRC line text itself and distribute them
    # proportionally within each line's time window (capped at _PER_WORD_MAX_SEC/word).
    # This produces approximate per-word TimedWords that are fed to the NW aligner.
    # If Whisper is available it replaces the LRC-derived words (higher accuracy).
    if aligned_words is None and lrc_content:
        line_ts = [(t, txt) for t, txt in parse_lrc_lines(lrc_content) if t < target_duration]
        if len(line_ts) >= 3:
            lrc_first_t = line_ts[0][0] if line_ts else None

            # Base: LRC line anchors + vocal word segments (onset+pyin) for per-word timing.
            # vocal_word_segs are short (word-duration) segments grounded in audio.
            if vocal_word_segs:
                lrc_timed = lrc_lines_with_segments_to_timed_words(line_ts, vocal_word_segs, target_duration)
            else:
                lrc_timed = lrc_lines_to_timed_words(line_ts, target_duration)

            # Enhancement: if Whisper is available, prefer its word timestamps
            raw_whisper: list[TimedWord] = []
            if os.getenv("OPENAI_API_KEY"):
                raw_whisper = transcribe_with_openai(vocals_path)
            whisper_words = [
                TimedWord(
                    word=w.word,
                    start=max(0.0, min(target_duration, w.start)),
                    end=max(
                        min(target_duration, w.end),
                        min(target_duration, w.start + MIN_WORD_DURATION),
                    ),
                )
                for w in raw_whisper
                if w.start < target_duration
            ]

            # Use Whisper if it produced enough words, else fall back to LRC-derived
            effective_timed = whisper_words if len(whisper_words) >= 5 else lrc_timed
            aligned_words = align_lyrics_to_timing(
                lyrics_words, effective_timed, target_duration,
                lyric_start=lrc_first_t or 0.0,
            )
            seg_label = f"+segs({len(vocal_word_segs)})" if vocal_word_segs and not whisper_words else ""
            timing_source = "lrc_line+whisper" if whisper_words else f"lrc_line{seg_label}"
            transcribed_words = whisper_words  # expose for metrics
            eprint(
                f"Timing source: LRC line-level ({len(line_ts)} lines) → "
                f"{'Whisper' if whisper_words else (f'word-segs({len(vocal_word_segs)})' if vocal_word_segs else 'proportional')} "
                f"({len(effective_timed)} words)"
            )

    # --- Priority 2: Whisper API ---
    if aligned_words is None:
        raw_whisper2 = transcribe_with_openai(vocals_path)
        transcribed_words = [
            TimedWord(
                word=w.word,
                start=max(0.0, min(target_duration, w.start)),
                end=max(
                    min(target_duration, w.end),
                    min(target_duration, w.start + MIN_WORD_DURATION),
                ),
            )
            for w in raw_whisper2
            if w.start < target_duration
        ]
        lyric_start = 0.0 if transcribed_words else vocal_start
        aligned_words = align_lyrics_to_timing(
            lyrics_words, transcribed_words, target_duration, lyric_start=lyric_start
        )
        timing_source = "whisper" if transcribed_words else "pyin_uniform"
        eprint(
            f"Timing source: {'Whisper API' if transcribed_words else 'pyin uniform (tentative)'} "
            f"({len(transcribed_words)} words)"
        )

    # --- Priority 2.5: Vocal segments positional ---
    # No LRC, no Whisper, but Demucs segments give us real audio activity.
    # Better than uniform pyin distribution: words land where the singer sings.
    if timing_source == "pyin_uniform" and vocal_segments:
        seg_timed = vocal_segments_to_timed_words(vocal_segments, lyrics_words)
        if seg_timed:
            aligned_words = align_lyrics_to_timing(
                lyrics_words, seg_timed, target_duration, lyric_start=vocal_start
            )
            timing_source = "vocal_segments"
            eprint(f"Timing source: vocal segments positional ({len(vocal_segments)} segments)")

    notes = build_notes(lyrics_words, aligned_words, times, f0, target_duration)

    # Auto-detect lyricsOffsetSeconds — use the earliest reliable timestamp.
    if lrc_first_t is not None:
        auto_offset = round(lrc_first_t, 1) if lrc_first_t >= 1.0 else 0.0
    elif transcribed_words:
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
            "timing_source": timing_source,
            "lrc_found": lrc_content is not None,
            "lrc_word_level": lrc_is_word_level,
            "vocal_word_segs_count": len(vocal_word_segs),
            "used_online_lyrics": not bool(provided_lyrics),
            "used_vocal_separation": (
                bool(preset_vocals_path and Path(preset_vocals_path).exists())
                or (Path(vocals_path).suffix.lower() == ".wav" and vocals_path != audio_file_path)
            ),
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
