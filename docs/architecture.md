# KaraokIT — Arquitectura del Sistema

> Actualizado: 2026-03-01. Generado durante revisión de calidad de código.

---

## 1. Topología del sistema

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              KARAOKOIT                                      │
│                                                                             │
│  ┌────────────────┐  HTTP/WS   ┌───────────────────────┐                   │
│  │  Host (PC/TV)  │◄──────────►│  Next.js :3000        │                   │
│  │  /host/[room]  │            │  App Router            │                   │
│  └────────────────┘            │                        │                   │
│                                │  /                     │                   │
│  ┌────────────────┐  HTTP/WS   │  /host/[roomCode]      │                   │
│  │  Player (Móvil)│◄──────────►│  /play/[roomCode]      │                   │
│  │  /play/[room]  │            │  /editor/[songId]      │                   │
│  └────────────────┘            │                        │                   │
│                                │  /api/songs/*          │                   │
│                                └───────────┬───────────┘                   │
│                                            │                               │
│                   ┌────────────────────────┼────────────────────────┐      │
│                   │                        │                        │      │
│                   ▼ WebSocket              ▼ File I/O              ▼ Spawn │
│          ┌─────────────────┐   ┌──────────────────────┐  ┌──────────────┐ │
│          │  PartyKit :1999 │   │  File System         │  │  Python      │ │
│          │  party/game.ts  │   │  data/user-songs.json│  │  .venv311    │ │
│          │  (GameServer)   │   │  data/jobs/*.json    │  │  pipeline.py │ │
│          │                 │   │  public/uploads/     │  │              │ │
│          │  In-memory:     │   └──────────────────────┘  └──────┬───────┘ │
│          │  RoomState      │                                     │        │
│          │  Players[]      │                                     ▼        │
│          └─────────────────┘                            ┌──────────────┐  │
│                                                         │  Python deps │  │
│                                                         │  librosa     │  │
│                                                         │  pyphen      │  │
│                                                         │  demucs      │  │
│                                                         │  syncedlyrics│  │
│                                                         │  requests    │  │
│                                                         └──────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Comunicación:**
- Host ↔ Next.js: HTTP (carga de página, API de canciones)
- Player ↔ Next.js: HTTP (carga de página)
- Ambos ↔ PartyKit: WebSocket bidireccional (estado en tiempo real)
- Next.js → Python: stdin/stdout JSON via `child_process.spawn`
- Next.js → File System: lectura/escritura directa (canciones, jobs, uploads)

---

## 2. Flujo de subida de canción (Upload Pipeline)

```
  Browser (Lobby)           Next.js API              Python Pipeline
       │                        │                          │
       │── POST /api/songs/upload ──────────────────────►  │
       │   (title, artist, file) │                         │
       │                        │── writeFile(uploads/) ──►│
       │                        │── createJob(jobId)        │
       │                        │── spawn(python pipeline) ►│
       │◄── 202 { jobId } ──────│   (fire-and-forget)      │
       │                        │                          │── main()
       │ (polling cada 3s)      │                          │  ├─ fetch_synced_lyrics()
       │── GET /api/songs/jobs/ ─────────────────────────► │  ├─ fetch_online_lyrics()
       │   [jobId]              │                          │  ├─ separate_vocals()
       │◄── { status: "processing" } ◄────────────────────│  │  (Demucs htdemucs)
       │                        │                          │  ├─ extract_pitch_track()
       │ (después 30-180s)      │                          │  │  (librosa pyin)
       │── GET /api/songs/jobs/ ─────────────────────────► │  ├─ detect_vocal_word_segments()
       │   [jobId]              │                          │  │  (onset + voiced_flag)
       │◄── { status: "done",  ◄────────────────────────  │  ├─ [timing priority chain]
       │     song: {...} }      │── addUserSong(song)      │  └─ build_notes()
       │                        │── updateJob(done)        │
       │── GET /api/songs ──────────────────────────────►  │  (stdout: JSON)
       │◄── { songs: [...] } ◄──────────────────────────   │
```

---

## 3. Cadena de prioridad de timing (pipeline.py)

```
                          Audio + Vocals + LRC
                                  │
                ┌─────────────────┼──────────────────┐
                │                 │                  │
                ▼                 ▼                  ▼
         syncedlyrics      extract_pitch_track  fetch_online_lyrics
         (word-level LRC   (pyin → times[],       (fallback text)
          or line-level)    f0[], voiced_flag[])
                │                 │
                │          detect_vocal_word_segments()
                │          (onset detection + voiced_flag)
                │          → vocal_word_segs[(start,end),...]
                │
       ┌────────▼─────────────────────────────────────────────────┐
       │                TIMING PRIORITY CHAIN                      │
       │                                                           │
       │  1a ┌─ LRC word-level available? (Musixmatch enhanced)   │
       │     │    → parse_lrc_words() → NW align                  │
       │     │    Best accuracy (~50ms). Skips Whisper.            │
       │     │                                                     │
       │  1b ├─ LRC line-level available?                         │
       │     │    → parse_lrc_lines() + lrc_lines_with_segments() │
       │     │      (vocal_word_segs as per-word anchors)         │
       │     │    Enhancement: if OPENAI_API_KEY → Whisper within  │
       │     │    each LRC line window.                            │
       │     │    → NW align with lrc_first_t as lyric_start      │
       │     │                                                     │
       │   2 ├─ OPENAI_API_KEY available?                         │
       │     │    → transcribe_with_openai(vocals)                 │
       │     │    → NW align                                       │
       │     │                                                     │
       │ 2.5 ├─ vocal_segments from audio (any case)?             │
       │     │    → vocal_segments_to_timed_words()                │
       │     │      (positional: words land where singer sings)   │
       │     │    → NW align                                       │
       │     │                                                     │
       │   3 └─ pyin uniform (último recurso)                     │
       │          → uniform distribution over vocal_start..end    │
       └───────────────────────────────────────────────────────────┘
                                  │
                       align_lyrics_to_timing()
                       (Needleman-Wunsch sequence alignment)
                                  │
                           build_notes()
                       (syllabification via pyphen es_ES
                        + median pyin pitch per syllable)
                                  │
                              Song JSON
                          { notes[], bpm, ... }
```

**Variables de control del pipeline:**

| Env var | Default | Efecto |
|---|---|---|
| `KARAOKE_USE_SYNCEDLYRICS` | `1` | Permite fetch LRC online |
| `KARAOKE_USE_DEMUCS` | `1` | Separación vocal Demucs |
| `KARAOKE_DEMUCS_MODEL` | `htdemucs` | Modelo Demucs |
| `OPENAI_API_KEY` | unset | Habilita Whisper |
| `OPENAI_TRANSCRIBE_MODEL` | `whisper-1` | Modelo Whisper |
| `KARAOKE_PIPELINE_TIMEOUT_MS` | `900000` | Timeout (15 min) |

---

## 4. Máquina de estados del juego

```
                ┌──────────────────────────────────────────────┐
                │            GAME STATE MACHINE                │
                │           (party/game.ts server)             │
                └──────────────────────────────────────────────┘

 JOIN ──►  ┌─────────┐   START_GAME   ┌───────────┐  t=3s   ┌─────────┐
           │  LOBBY  ├───────────────►│ COUNTDOWN ├────────►│ PLAYING │
           └────┬────┘                └───────────┘  (1s/tick)└────┬────┘
                ▲                                                   │
                │ BACK_TO_LOBBY                            PAUSE    │
                │ (resetea scores,                          │       │
                │  song, players)                           ▼       │
           ┌────┴────┐  SONG_ENDED   ┌─────────┐  ┌──────────┐   │
           │(lobby   │◄──────────────┤ RESULTS │  │  PAUSED  │◄──┘
           │ state)  │               └─────────┘  └────┬─────┘
           └─────────┘                 ▲               │
                                       │               │ RESUME
                              RESTART_SONG             │ (ajusta songStartTime)
                              ──────────────────────────┘
                              (va directo a PLAYING,
                               sin countdown)
```

**Cronometraje distribuido:**
- Servidor almacena `songStartTime = Date.now()` al iniciar PLAYING
- Cliente calcula: `currentTime = (Date.now() - songStartTime) / 1000`
- Pausa: `pausedAtSeconds` congela el tiempo; RESUME ajusta `songStartTime`
- `lyricsOffsetSeconds` aplicado en servidor al evaluar pitch, y en cliente al renderizar notas

---

## 5. Flujo de datos en partida (WebSocket)

```
  Player (Móvil)               PartyKit (Servidor)            Host (PC/TV)
       │                             │                              │
       │── JOIN {name, isHost=F} ───►│                              │
       │                             │── handleJoin() ─────────────►│
       │◄── STATE {players,...} ─────│◄─ broadcast()                │
       │                             │                              │
       │                             │◄── START_GAME {song} ────────│
       │                             │   handleStartGame()          │
       │                             │   COUNTDOWN 3→2→1→PLAYING    │
       │◄── STATE {PLAYING,...} ─────│─── broadcast() ─────────────►│
       │                             │                              │
       │  (cada 50ms)                │                              │
       │── PITCH {hz, timestamp} ───►│                              │
       │                             │   handlePitch()              │
       │                             │   hzToMidi(hz)               │
       │                             │   getActiveNote(notes, t)    │
       │                             │   evaluatePitch(midi, note)  │
       │                             │   player.score += points     │
       │◄── STATE {players/scores} ──│─── broadcast() ─────────────►│
       │                             │                              │
       │                             │◄── SONG_ENDED ───────────────│
       │◄── STATE {RESULTS,...} ─────│─── broadcast() ─────────────►│
```

---

## 6. Arquitectura del NoteEditor (editor de notas)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     NoteEditor Component                                 │
│                  components/editor/NoteEditor.tsx                        │
│                                                                          │
│  Estado React:                                                           │
│  ┌────────────┐  ┌──────────────┐  ┌──────────┐  ┌────────────────────┐│
│  │ notes[]    │  │ history[][]  │  │ tool     │  │ syllableQueue[]    ││
│  │ SongNote[] │  │ (undo stack  │  │ draw|sel │  │ próximas sílabas   ││
│  └────────────┘  │  max 50)     │  └──────────┘  └────────────────────┘│
│                  └──────────────┘                                        │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Toolbar                                                          │   │
│  │  [Draw|Select] [Undo] [Zoom -/+] [BPM] [Offset] [Save] [Close] │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────┬───────────────────────────────────────────────────────────┐   │
│  │ Keys │ Ruler (0s ── 1s ── 2s ── 3s ── ...)                      │   │
│  │ 48px │─────────────────────────────────────────────────────────  │   │
│  │ C5   │  [━━━Ay━━━]  [━Fon━][━si━][━DY━]                         │   │
│  │ B4   │                        │ (playhead rojo)                  │   │
│  │ A4   │      [━━━oh━━━][━━oh━━━][━━oh━━━no━━━]                   │   │
│  │ G4   │                                                           │   │
│  │ ...  │  (C2–C7, scroll horizontal, zoom Ctrl+rueda)              │   │
│  └──────┴───────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Audio ▶/⏸ ──────●─────────────────── 1:23 / 3:45               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Sílabas: [Ay] [Fon-] [si] [DY] ...    [Auto-dividir]            │   │
│  │  ↑ gris=asignada  violeta=próxima  blanco=pendiente              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  Interacciones canvas:                                                   │
│  • Draw mode: mousedown vacío → nueva nota (pitch por Y, dur por drag)   │
│  • Select mode: drag nota → mover (tiempo+pitch); borde der. → resize    │
│  • Ctrl+Z → undo; D/S → cambiar tool; Space → play/pause                │
│  • Guardar → PUT /api/songs/[songId] → recomputa lineIdx automático      │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Organización de archivos

```
karaoke-game/
├── app/                           # Next.js App Router
│   ├── page.tsx                   # / — Landing (crear/unirse sala)
│   ├── host/[roomCode]/page.tsx   # Host screen (control + audio)
│   ├── play/[roomCode]/page.tsx   # Player screen (mic + pitch)
│   ├── editor/[songId]/page.tsx   # Song editor (custom songs only)
│   └── api/songs/
│       ├── route.ts               # GET /api/songs
│       ├── upload/route.ts        # POST /api/songs/upload
│       ├── [songId]/route.ts      # PUT / PATCH / DELETE
│       └── jobs/[jobId]/route.ts  # GET (job polling)
│
├── components/
│   ├── game/
│   │   ├── Lobby.tsx              # QR, jugadores, song picker, upload
│   │   ├── NoteGraph.tsx          # Piano roll canvas (host view)
│   │   ├── LyricDisplay.tsx       # Letras sincronizadas con fill animado
│   │   ├── PitchMeter.tsx         # Barra pitch jugador (móvil)
│   │   └── ScoreBoard.tsx         # Ranking + podio olímpico
│   └── editor/
│       └── NoteEditor.tsx         # Editor interactivo de notas
│
├── lib/
│   ├── types.ts                   # Tipos compartidos (Song, Player, RoomState, msgs)
│   ├── scoring.ts                 # hzToMidi, evaluatePitch, getActiveNote
│   ├── partyHost.ts               # Resolución dinámica del host WS
│   ├── demoSong.ts / songsCatalog.ts  # Canciones built-in
│   └── server/                    # Solo server-side (import 'server-only')
│       ├── songRepository.ts      # CRUD user-songs.json + protección built-ins
│       ├── autoKaraoke.ts         # Orquesta spawn del pipeline Python
│       └── jobRepository.ts       # Estado de jobs (processing/done/error)
│
├── party/
│   └── game.ts                    # PartyKit server (RoomState, handlers WS)
│
├── stores/
│   └── gameStore.ts               # Zustand v5 (estado cliente + currentTime())
│
├── scripts/
│   └── karaoke_pipeline.py        # Pipeline IA (Demucs + pyin + LRC + Whisper)
│
├── data/                          # Persistencia local (no versionada)
│   ├── user-songs.json
│   └── jobs/
│
└── public/uploads/                # Audio subidos (no versionados)
```

---

## 8. Análisis SOLID

### ✅ Bien aplicado

| Principio | Dónde | Evidencia |
|---|---|---|
| SRP | `lib/types.ts` | Solo tipos, sin lógica |
| SRP | `lib/scoring.ts` | Solo funciones de evaluación de pitch |
| SRP | `lib/server/songRepository.ts` | Solo CRUD de canciones |
| SRP | `party/game.ts` | Solo lógica del servidor de sala |
| OCP | `SONGS_CATALOG` | Extender catálogo sin tocar el repositorio |
| DIP | `lib/partyHost.ts` | Abstrae resolución del host por entorno |
| LSP | Mensajes WS | Union types bien discriminados |

### ⚠️ Áreas de mejora

| Principio | Archivo | Problema |
|---|---|---|
| SRP | `scripts/karaoke_pipeline.py` (1290 líneas) | Un único módulo maneja: separación vocal, detección de pitch, fetch LRC, Whisper API, NW alignment, silabificación, construcción de notas |
| SRP | `components/editor/NoteEditor.tsx` (~500 líneas) | Mezcla: canvas rendering, gestión de estado, interacciones, audio playback, serialización |
| OCP | `main()` en pipeline.py | La cadena de prioridad es un cascada if/elif — agregar una nueva fuente de timing requiere modificar `main()` |
| ISP | `BuildSongParams` en autoKaraoke.ts | Contiene `originalFilename`, `mimeType`, `audioBuffer` — recibidos pero nunca pasados al pipeline |
| ISP | `Player` interface | `currentPitch` y `currentMidi` se transmiten en TODOS los estados (incluyendo LOBBY/RESULTS) aunque solo son relevantes durante PLAYING |

---

## 9. Deuda técnica conocida

| Severidad | Área | Descripción |
|---|---|---|
| 🔴 Bug | `party/game.ts` | `JSON.parse(message)` sin try/catch — mensaje malformado crashea el handler |
| 🟡 Calidad | `karaoke_pipeline.py` | `MIN_SILENCE_FRAMES` y `VOICED_TAIL_S` definidos dentro del cuerpo de función (deberían ser constantes de módulo) |
| 🟡 Limpieza | `karaoke_pipeline.py` | Dos funciones dead code: `detect_voiced_segments` y `lrc_lines_with_onsets_to_timed_words` (reemplazadas en sesión anterior) |
| 🟡 Limpieza | `autoKaraoke.ts` | `BuildSongParams` expone campos que el pipeline no usa |
| 🟠 Escalabilidad | `party/game.ts` | Estado en RAM — sala se pierde si el servidor PartyKit reinicia |
| 🟠 Operacional | `data/jobs/` | Archivos de jobs se acumulan indefinidamente (sin limpieza automática) |
| 🔵 MVP | Sin tests | No hay tests unitarios, de integración ni E2E |
| 🔵 MVP | Autenticación | Cualquier persona con el código de sala puede unirse — sin PIN |

---

## 10. Métricas de salida del pipeline

El JSON de salida incluye métricas de diagnóstico:

```json
{
  "song": { ... },
  "metrics": {
    "timing_source": "lrc_word | lrc_line+segs(N) | lrc_line+whisper | whisper | vocal_segments | pyin_uniform",
    "lrc_found": true,
    "lrc_word_level": false,
    "vocal_word_segs_count": 607,
    "lyrics_words": 180,
    "transcribed_words": 0,
    "notes": 420,
    "audio_duration_sec": 252.5,
    "target_duration_sec": 252.5,
    "vocal_start_sec": 6.93,
    "auto_offset_sec": 6.9,
    "used_online_lyrics": true,
    "used_vocal_separation": true
  }
}
```
