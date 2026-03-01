'use client'

import { useMemo } from 'react'
import clsx from 'clsx'
import type { SongNote } from '@/lib/types'

interface Props {
  notes: SongNote[]
  currentTime: number
  /** Modo compacto para la vista mobile */
  compact?: boolean
}

export function LyricDisplay({ notes, currentTime, compact = false }: Props) {
  // Agrupa notas por línea
  const lines = useMemo(() => {
    const map = new Map<number, SongNote[]>()
    for (const note of notes) {
      if (!map.has(note.lineIdx)) map.set(note.lineIdx, [])
      map.get(note.lineIdx)!.push(note)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b)
  }, [notes])

  // Qué línea está activa ahora
  const activeLineIdx = useMemo(() => {
    const active = notes.find(
      n => currentTime >= n.startTime && currentTime < n.startTime + n.duration
    )
    if (active) return active.lineIdx

    // Si no hay nota activa, mostrar la línea de la próxima nota
    const next = notes.find(n => n.startTime > currentTime)
    return next?.lineIdx ?? 0
  }, [notes, currentTime])

  // Mostrar línea activa y la siguiente
  const visibleLines = lines.filter(
    ([idx]) => idx === activeLineIdx || idx === activeLineIdx + 1
  )

  return (
    <div className={clsx('flex flex-col items-center gap-2', compact ? 'px-4' : 'px-8')}>
      {visibleLines.map(([lineIdx, lineNotes]) => {
        const isActive = lineIdx === activeLineIdx
        return (
          <div
            key={lineIdx}
            className={clsx(
              'flex flex-wrap justify-center gap-x-0.5 transition-all duration-300',
              isActive
                ? compact ? 'text-2xl font-bold' : 'text-4xl font-bold'
                : compact ? 'text-lg text-white/40' : 'text-2xl text-white/40'
            )}
            style={{ fontFamily: "'Syne', sans-serif" }}
          >
            {lineNotes.map((note, i) => {
              const isPast    = currentTime >= note.startTime + note.duration
              const isCurrent = currentTime >= note.startTime && currentTime < note.startTime + note.duration
              const progress  = isCurrent
                ? (currentTime - note.startTime) / note.duration
                : 0

              return (
                <span key={i} className="relative inline-block">
                  {/* Texto base */}
                  <span className={clsx(
                    isActive ? 'text-white/30' : 'text-white/20'
                  )}>
                    {note.syllable}
                  </span>

                  {/* Overlay de progreso (como un fill de izquierda a derecha) */}
                  {isActive && (isPast || isCurrent) && (
                    <span
                      className="absolute inset-0 overflow-hidden text-white"
                      style={{ clipPath: `inset(0 ${100 - (isPast ? 100 : progress * 100)}% 0 0)` }}
                    >
                      {note.syllable}
                    </span>
                  )}
                </span>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
