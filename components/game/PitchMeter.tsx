'use client'

import { useEffect, useRef } from 'react'
import { midiToName, type PitchAccuracy } from '@/lib/scoring'

interface Props {
  playerMidi: number | null
  expectedMidi: number | null
  accuracy: PitchAccuracy
  color: string
}

export function PitchMeter({ playerMidi, expectedMidi, accuracy, color }: Props) {
  // Rango de pitches que mostramos (MIDI 48–72 = C3–C5)
  const MIN_MIDI = 48
  const MAX_MIDI = 72
  const RANGE = MAX_MIDI - MIN_MIDI

  const toPercent = (midi: number) =>
    100 - ((midi - MIN_MIDI) / RANGE) * 100

  const accuracyColor: Record<PitchAccuracy, string> = {
    PERFECT: '#10b981',
    GOOD:    '#06b6d4',
    OK:      '#f59e0b',
    MISS:    '#ef4444',
  }

  return (
    <div className="relative w-12 h-full bg-white/5 rounded-lg overflow-hidden border border-white/10">
      {/* Nota esperada (línea blanca) */}
      {expectedMidi && (
        <div
          className="absolute left-0 right-0 h-0.5 bg-white/40 transition-all duration-100"
          style={{ top: `${toPercent(expectedMidi)}%` }}
        />
      )}

      {/* Zona de puntuación alrededor de la nota esperada */}
      {expectedMidi && (
        <div
          className="absolute left-0 right-0 opacity-20 transition-all duration-100"
          style={{
            top: `${toPercent(expectedMidi + 3)}%`,
            height: `${(6 / RANGE) * 100}%`,
            backgroundColor: color,
          }}
        />
      )}

      {/* Pitch del jugador */}
      {playerMidi && (
        <div
          className="absolute left-1 right-1 h-3 rounded-full transition-all duration-50"
          style={{
            top: `${toPercent(playerMidi)}%`,
            transform: 'translateY(-50%)',
            backgroundColor: accuracyColor[accuracy],
            boxShadow: `0 0 12px ${accuracyColor[accuracy]}`,
          }}
        />
      )}

      {/* Etiqueta de nota */}
      {playerMidi && (
        <div className="absolute bottom-1 left-0 right-0 text-center text-[9px] text-white/60">
          {midiToName(playerMidi)}
        </div>
      )}
    </div>
  )
}
