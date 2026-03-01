// ─── Song ──────────────────────────────────────────────────────────────────

export interface SongNote {
  startTime: number   // segundos desde el inicio de la canción
  duration: number    // segundos
  pitch: number       // MIDI (60 = Do central / C4)
  syllable: string    // texto a mostrar
  lineIdx: number     // índice de línea de letra (para saltos)
}

export interface Song {
  id: string
  title: string
  artist: string
  audioUrl: string    // URL pública del audio
  bpm: number
  notes: SongNote[]
  lyricsOffsetSeconds?: number  // segundos desde el inicio del audio hasta la primera letra
}

// ─── Players ───────────────────────────────────────────────────────────────

export const PLAYER_COLORS = [
  '#7c3aed', // violeta
  '#06b6d4', // cyan
  '#f59e0b', // ámbar
  '#10b981', // verde
] as const

export interface Player {
  id: string
  name: string
  score: number
  currentPitch: number | null   // Hz detectado, null si no hay sonido
  currentMidi: number | null    // MIDI calculado desde Hz
  isHost: boolean
  color: string
  connected: boolean
}

// ─── Room ──────────────────────────────────────────────────────────────────

export type GamePhase = 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'PAUSED' | 'RESULTS'

export interface RoomState {
  roomCode: string
  phase: GamePhase
  players: Player[]
  currentSong: Song | null
  songStartTime: number | null  // Date.now() cuando empezó la canción (o reanudó)
  pausedAtSeconds: number | null  // cuando phase === 'PAUSED', tiempo en segundos donde se pausó
  countdown: number             // 3, 2, 1, 0
  round: number
}

// ─── WebSocket Messages: Cliente → Servidor ────────────────────────────────

export type ClientMessage =
  | { type: 'JOIN';         name: string; isHost: boolean }
  | { type: 'PITCH';        hz: number | null; timestamp: number }
  | { type: 'START_GAME';   song: Song }
  | { type: 'RESTART_SONG' }
  | { type: 'SONG_ENDED' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'BACK_TO_LOBBY' }
  | { type: 'CLOSE_ROOM' }

// ─── WebSocket Messages: Servidor → Cliente ────────────────────────────────

export type ServerMessage =
  | { type: 'STATE';       state: RoomState }
  | { type: 'ERROR';       message: string }
  | { type: 'ROOM_CLOSED' }

// ─── Scoring ───────────────────────────────────────────────────────────────

export const SCORING = {
  PERFECT_WINDOW_SEMITONES: 1,   // ±1 semitono = perfecto
  GOOD_WINDOW_SEMITONES: 2,      // ±2 semitonos = bien
  OK_WINDOW_SEMITONES: 3,        // ±3 semitonos = aceptable
  POINTS_PERFECT: 100,
  POINTS_GOOD: 60,
  POINTS_OK: 20,
  TICK_MS: 50,                   // cada cuántos ms se evalúa el pitch
} as const
