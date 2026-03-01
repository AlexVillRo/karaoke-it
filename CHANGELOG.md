# Changelog

All notable changes to KaraokIT are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [Unreleased]

> Changes on `develop` not yet merged to `master`.

---

## [0.3.0] - 2026-03-01

### Added
- **Vocal stem re-use**: pipeline accepts optional `vocals_file_path` in JSON input to skip Demucs when a pre-separated stem already exists, saving significant processing time.
- **Architecture documentation**: `docs/architecture.md` with ASCII diagrams covering system topology, upload flow, timing priority chain, game state machine, WebSocket data flow, NoteEditor layout, SOLID analysis, and known technical debt.
- **Song: Me And You (from Let It Shine)** — Coco Jones & Tyler Williams, 489 notes, generated from pre-separated Demucs stem + word-level LRC (Musixmatch).

### Changed
- **Pipeline timing chain updated**: Priority 1b now uses `detect_vocal_word_segments` (onset + pyin voiced_flag) instead of the previous `lrc_lines_with_onsets_to_timed_words` approach. Gives accurate word-level start+end times anchored to real audio energy.
- **Module-level tuning constants**: `WORD_END_SILENCE_FRAMES` (4 frames, ~46 ms) and `WORD_END_TAIL_S` (0.12 s) moved from inside the function to top-level for easy tuning.
- **`BuildSongParams` cleanup**: removed unused fields `originalFilename`, `mimeType`, `audioBuffer` — these were passed in but never forwarded to the Python pipeline.
- **CLAUDE.md updated**: added Song editor section, Karaoke pipeline documentation with timing chain detail, and pipeline env vars.
- **`.gitignore` updated**: added `data/jobs/`, `scripts/__pycache__/`, `*.pyc`, and `pipeline_*.{json,log}` debug outputs.

### Fixed
- **`party/game.ts`**: `JSON.parse(message)` in `onMessage` now wrapped in try/catch — malformed WebSocket messages no longer crash the handler silently.

### Removed
- **`detect_voiced_segments()`**: dead code — replaced by `detect_vocal_word_segments()` which combines onset detection + pyin voiced_flag for word-level precision.
- **`lrc_lines_with_onsets_to_timed_words()`**: dead code — replaced by `lrc_lines_with_segments_to_timed_words()` which uses (start, end) segments instead of onset-only timestamps.

---

## [0.2.0] - 2026-02-28

### Added
- **Song editor** (`/editor/[songId]`): interactive piano roll (C2–C7) for manually correcting auto-generated notes.
  - Tools: Draw (D) to create notes, Select (S) to move/resize/change pitch.
  - Undo stack (50 states) via Ctrl+Z.
  - Zoom (Ctrl+scroll), horizontal scroll, red playhead with RAF animation.
  - Syllable workflow: textarea → auto-split chips → new notes take next syllable.
  - Save → `PUT /api/songs/[songId]` (recomputes `lineIdx` server-side).
  - Access: "Editar" button (cyan) on custom songs in the Lobby.
- **Upload pipeline** (`POST /api/songs/upload`): fire-and-forget with job polling.
  - Vocal separation via Demucs (`htdemucs`, `--two-stems=vocals`).
  - Pitch extraction via `librosa.pyin` (C2–C7 range).
  - Onset detection + pyin `voiced_flag` for vocal word segment detection.
  - Timing priority chain: LRC word-level → LRC line + Whisper → Whisper → vocal segments → pyin uniform.
  - Spanish syllabification via `pyphen` (es_ES).
  - Needleman-Wunsch sequence alignment between canonical lyrics and timed words.
  - `syncedlyrics` integration for fetching synced LRC from Musixmatch/NetEase/Lrclib.
  - Auto-detection of `lyricsOffsetSeconds` from LRC/Whisper/vocal_start.
- **API routes**:
  - `PUT /api/songs/[songId]` — save full song (notes, bpm, lyricsOffsetSeconds) from editor.
  - `PATCH /api/songs/[songId]` — patch only lyricsOffsetSeconds.
  - `DELETE /api/songs/[songId]` — delete custom song + audio file (built-ins protected with 403).
  - `GET /api/songs/jobs/[jobId]` — poll pipeline job status (processing / done / error).
- **Song catalog**: added Noche de Paz (Kevin MacLeod) as second built-in song.
- **`lib/server/songRepository.ts`**: `saveUserSong()`, `patchUserSong()`, `deleteUserSong()` with built-in protection.
- **`lib/server/jobRepository.ts`**: filesystem-based job persistence (`data/jobs/`).
- **`lib/server/autoKaraoke.ts`**: orchestrates Python pipeline spawn with configurable timeout.
- **RESULTS screen**: olympic podium (2nd | 1st | 3rd) with height-proportional blocks; current player highlighted with white ring; 4th+ in simple list.
- **Hold-to-exit button** (1.2 s hold) on mobile to return to lobby from RESULTS.
- **`LyricDisplay`**: animated syllable fill; `compact` prop for mobile.
- **`PitchMeter`**: vertical pitch bar with color-coded precision (miss/ok/good/perfect).
- **`BACK_TO_LOBBY` / `CLOSE_ROOM`** WebSocket messages.

### Changed
- `lyricsOffsetSeconds` applied in server scoring (`handlePitch`) and client rendering.
- Host page timer auto-ends round at 63 s (pauses during PAUSED phase).
- Lobby redesigned: QR code, player list, song picker with offset slider, upload form with job progress.

---

## [0.1.1] - 2026-02-27

### Added
- **Restart song button** for host — resets scores and playhead, goes directly to PLAYING (no countdown).

---

## [0.1.0] - 2026-02-27

### Added
- Initial KaraokIT implementation.
- **Game server** (`party/game.ts`): PartyKit WebSocket room with full game lifecycle.
  - Phases: LOBBY → COUNTDOWN (3 s) → PLAYING ↔ PAUSED → RESULTS.
  - Scoring: `hzToMidi` → `evaluatePitch` → PERFECT/GOOD/OK/MISS windows; points scaled by tick rate (50 ms).
  - Pause/resume with `pausedAtSeconds` bookkeeping.
  - Up to 4 players, each with unique color.
- **Host screen** (`/host/[roomCode]`): `NoteGraph` piano roll canvas, `LyricDisplay`, `ScoreBoard`; audio playback control.
- **Player screen** (`/play/[roomCode]`): microphone capture via Web Audio API + `pitchy`; pitch sent to server every 50 ms.
- **Lobby** (`/`): create or join room; QR code for mobile join.
- **Built-in songs**: Las Mañanitas (Wikimedia Commons, ~33 s).
- **`lib/scoring.ts`**: `hzToMidi`, `evaluatePitch`, `getActiveNote`, `midiToName`.
- **`lib/types.ts`**: shared types (`Song`, `SongNote`, `Player`, `RoomState`, `ClientMessage`, `ServerMessage`, `SCORING`).
- **`stores/gameStore.ts`**: Zustand v5 client store with `currentTime()` derived from `songStartTime`.
- **`lib/partyHost.ts`**: dynamic PartyKit host resolution (env var → window.hostname → localhost fallback).

### Fixed
- Multi-player stuck loading screen — reconnection flow in `handleJoin`.
- iPhone microphone blocked on HTTP — requires `window.isSecureContext`; added user-facing error.

---

[Unreleased]: https://github.com/AlexVillRo/karaoke-it/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/AlexVillRo/karaoke-it/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/AlexVillRo/karaoke-it/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/AlexVillRo/karaoke-it/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/AlexVillRo/karaoke-it/releases/tag/v0.1.0
