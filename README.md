# KaraokeIT

Juego de karaoke en tiempo real con pantalla host (TV/PC) y jugadores desde celular.

## Stack

- Next.js 16 (App Router)
- React 19
- PartyKit + PartySocket (estado en tiempo real por sala)
- Zustand (estado cliente)
- Pitchy + Web Audio API (detección de pitch en dispositivo)

## Estructura de rutas

- `/` landing para crear sala o unirse
- `/host/[roomCode]` pantalla host (controla partida y audio)
- `/play/[roomCode]` vista jugador (micrófono, letras, afinación)

## Flujo de juego actual

Fases:

`LOBBY -> COUNTDOWN -> PLAYING <-> PAUSED -> RESULTS`

Mensajes cliente -> servidor:

- `JOIN`
- `START_GAME`
- `PITCH`
- `RESTART_SONG`
- `SONG_ENDED`
- `PAUSE`
- `RESUME`

Notas importantes:

- El host puede pausar/reanudar y reiniciar canción.
- La canción termina al finalizar audio o por timer del host (`PLAY_DURATION_MS = 63000`).

## Desarrollo local

Desde esta carpeta (`karaoke-game/`):

```bash
npm install
npm run dev:all
```

También puedes levantar por separado:

```bash
npm run dev     # Next.js :3000
npm run party   # PartyKit :1999
```

Comandos útiles:

```bash
npm run build
npm run lint
```

## Variables de entorno

```bash
# Endpoint PartyKit (producción/túnel)
NEXT_PUBLIC_PARTYKIT_HOST=...

# Host público de la app para generar QR de unión
# Ej: abc123.ngrok-free.app
NEXT_PUBLIC_APP_HOST=...

# Opcional: habilita transcripción automática real al subir audios
OPENAI_API_KEY=...

# Opcional: modelo de transcripción (default: whisper-1)
OPENAI_TRANSCRIBE_MODEL=whisper-1

# Opcional: ruta explícita del python del pipeline
# default: .venv311/Scripts/python.exe (Windows)
KARAOKE_PYTHON_PATH=...

# Opcional: timeout pipeline en ms (default 900000)
KARAOKE_PIPELINE_TIMEOUT_MS=900000
```

Resolución de host PartyKit (`lib/partyHost.ts`):

- Usa `NEXT_PUBLIC_PARTYKIT_HOST` si está definida y no es `localhost:1999`.
- En dev, usa `${window.location.hostname}:1999`.
- Fallback: `localhost:1999`.

## Micrófono y dispositivos móviles

- El micrófono requiere contexto seguro (`HTTPS`) en móviles.
- En iPhone/Safari, abrir por IP local en HTTP bloquea `getUserMedia`.
- Para pruebas reales en celular, usar URL HTTPS (ngrok/Cloudflare Tunnel o despliegue).

## Catálogo de canciones (actual)

Fuente: `lib/songsCatalog.ts`

Activas en `SONGS_CATALOG`:

- `las-mananitas`
- `noche-de-paz`

Definidas pero desactivadas (audio placeholder compartido):

- `cielito-lindo`
- `de-colores`

Canciones subidas por usuarios:

- El host puede subir audio desde el lobby.
- El backend guarda el archivo en `public/uploads/`.
- El catálogo generado se persiste en `data/user-songs.json`.
- El procesamiento usa `scripts/karaoke_pipeline.py`:
  - separación vocal (`demucs`)
  - detección de pitch real (`librosa.pyin`)
  - alineación de letra al tiempo de la canción
- Si hay `OPENAI_API_KEY`, mejora la sincronía con timestamps de palabras.
- Si no hay letra adjunta, se intenta buscar online (lrclib / lyrics.ovh).

## Setup del pipeline (Windows)

El repo ya quedó preparado para usar `Python 3.11` en `./.venv311`.

Dependencias instaladas:

- `demucs`
- `librosa`
- `soundfile`
- `pyphen`
- `requests`
- `torch` / `torchaudio`

Requisito del sistema:

- `ffmpeg` instalado y disponible (se instaló via winget en este entorno).

Nota:

- El primer procesamiento puede tardar más por descarga/caché de modelo de separación vocal.

## Scoring

Fuente: `lib/scoring.ts` + `lib/types.ts`

- Conversión: `hzToMidi`
- Ventanas:
  - `PERFECT`: <= 1 semitono
  - `GOOD`: <= 2 semitonos
  - `OK`: <= 3 semitonos
  - `MISS`: fuera de rango
- Tick de puntuación: `SCORING.TICK_MS = 50`

## Archivos clave

- `party/game.ts`: estado de sala, transiciones de fase, scoring y broadcast
- `app/host/[roomCode]/page.tsx`: UI host, reproducción de audio y controles de partida
- `app/play/[roomCode]/page.tsx`: unión de jugador, micrófono, envío de pitch
- `stores/gameStore.ts`: estado compartido cliente
- `components/game/Lobby.tsx`: lobby, QR y selección de canción
- `components/game/LyricDisplay.tsx`: render sincronizado de sílabas
- `components/game/NoteGraph.tsx`: visualización de notas y afinación de jugadores

## Estado del repositorio

- Proyecto activo: `karaoke-game/`
- Prototipo legado (referencia): `../karaoke-editor_2.html`
