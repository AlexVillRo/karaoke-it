import { SCORING, type SongNote } from './types'

/** Convierte frecuencia Hz a nota MIDI (69 = A4 = 440 Hz) */
export function hzToMidi(hz: number): number {
  return Math.round(12 * Math.log2(hz / 440) + 69)
}

/** Convierte MIDI a Hz */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Calcula la diferencia en semitonos entre dos notas MIDI */
export function semitoneDiff(a: number, b: number): number {
  return Math.abs(a - b)
}

export type PitchAccuracy = 'PERFECT' | 'GOOD' | 'OK' | 'MISS'

/** Evalúa qué tan afinado está el jugador respecto a la nota esperada */
export function evaluatePitch(
  playerMidi: number | null,
  expectedNote: SongNote | null
): { accuracy: PitchAccuracy; points: number } {
  if (!playerMidi || !expectedNote) return { accuracy: 'MISS', points: 0 }

  const diff = semitoneDiff(playerMidi, expectedNote.pitch)

  if (diff <= SCORING.PERFECT_WINDOW_SEMITONES) return { accuracy: 'PERFECT', points: SCORING.POINTS_PERFECT }
  if (diff <= SCORING.GOOD_WINDOW_SEMITONES)    return { accuracy: 'GOOD',    points: SCORING.POINTS_GOOD }
  if (diff <= SCORING.OK_WINDOW_SEMITONES)      return { accuracy: 'OK',      points: SCORING.POINTS_OK }
  return { accuracy: 'MISS', points: 0 }
}

/** Encuentra la nota activa en un momento dado */
export function getActiveNote(notes: SongNote[], currentTime: number): SongNote | null {
  return notes.find(
    n => currentTime >= n.startTime && currentTime < n.startTime + n.duration
  ) ?? null
}

/** Nombres de notas MIDI */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export function midiToName(midi: number): string {
  return NOTE_NAMES[midi % 12] + Math.floor(midi / 12 - 1)
}
