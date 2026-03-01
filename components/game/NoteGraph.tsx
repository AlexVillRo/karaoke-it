'use client'

import { useEffect, useRef } from 'react'
import type { SongNote, Player } from '@/lib/types'
import { getActiveNote } from '@/lib/scoring'

interface PitchPoint {
  time: number
  midi: number | null
  onNote: boolean
}

interface Props {
  notes: SongNote[]
  songStartTime: number
  players: Player[]
  /** Si se define, el playhead usa este tiempo (p. ej. cuando está pausado) */
  frozenTime?: number
  /** Segundos de intro antes de la primera letra (mismo valor que lyricsOffsetSeconds) */
  lyricsOffset?: number
}

const TIME_BEFORE   = 2   // segundos antes del playhead
const TIME_AFTER    = 5   // segundos después del playhead
const TOTAL_TIME    = TIME_BEFORE + TIME_AFTER
const HIT_TOLERANCE = 2   // semitonos para contar como acierto

// Solfège español — índice = MIDI % 12
const NOTE_ES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si']
const NATURAL  = new Set([0, 2, 4, 5, 7, 9, 11]) // notas naturales (sin sostenido)

export function NoteGraph({ notes, songStartTime, players, frozenTime, lyricsOffset = 0 }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const historyRef = useRef<Map<string, PitchPoint[]>>(new Map())

  // Refs para que el loop RAF siempre lea datos frescos sin reiniciarse
  const notesRef   = useRef(notes)
  const playersRef = useRef(players)
  const startRef   = useRef(songStartTime)
  const frozenRef  = useRef(frozenTime)
  const offsetRef  = useRef(lyricsOffset)
  notesRef.current   = notes
  playersRef.current = players
  startRef.current   = songStartTime
  frozenRef.current  = frozenTime
  offsetRef.current  = lyricsOffset

  // Rango MIDI de la canción (con padding)
  const pitches     = notes.map(n => n.pitch)
  const minMidiBase = Math.min(...pitches) - 3
  const maxMidiBase = Math.max(...pitches) + 3
  const midiRangeRef = useRef({ min: minMidiBase, max: maxMidiBase })
  midiRangeRef.current = { min: minMidiBase, max: maxMidiBase }

  useEffect(() => {
    const maybeCanvas = canvasRef.current
    if (!maybeCanvas) return
    const canvas: HTMLCanvasElement = maybeCanvas
    let rafId: number

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        canvas.width  = rect.width  * window.devicePixelRatio
        canvas.height = rect.height * window.devicePixelRatio
      }
    }
    updateSize()
    const ro = new ResizeObserver(updateSize)
    ro.observe(canvas)

    function draw() {
      const ctx = canvas.getContext('2d')
      if (!ctx || canvas.width === 0) { rafId = requestAnimationFrame(draw); return }

      const W = canvas.width
      const H = canvas.height
      const notes   = notesRef.current
      const players = playersRef.current
      const { min: minMidi, max: maxMidi } = midiRangeRef.current
      const midiRange  = maxMidi - minMidi || 1
      const rawTime = frozenRef.current !== undefined
        ? frozenRef.current
        : (Date.now() - startRef.current) / 1000
      const currentTime = Math.max(0, rawTime - offsetRef.current)

      // Ancho reservado para etiquetas de nota
      const LW = Math.round(W * 0.055)   // ~5.5 % del ancho
      const DW = W - LW                  // ancho del área de dibujo

      // ── Helpers ────────────────────────────────────────────────────────
      const timeToX   = (t: number) => LW + ((t - currentTime + TIME_BEFORE) / TOTAL_TIME) * DW
      const midiToY   = (m: number) => H - ((m - minMidi) / midiRange) * H
      const playheadX = timeToX(currentTime)
      const noteH     = Math.max(8, (H / midiRange) * 0.68)

      // ── Actualizar historial ───────────────────────────────────────────
      const activeNote = getActiveNote(notes, currentTime)
      players.filter(p => !p.isHost).forEach(p => {
        if (!historyRef.current.has(p.id)) historyRef.current.set(p.id, [])
        const hist = historyRef.current.get(p.id)!
        const onNote = !!p.currentMidi && !!activeNote
          && Math.abs(p.currentMidi - activeNote.pitch) <= HIT_TOLERANCE
        hist.push({ time: currentTime, midi: p.currentMidi, onNote })
        const cutoff = currentTime - 10
        while (hist.length > 0 && hist[0].time < cutoff) hist.shift()
      })

      // ── Fondo ─────────────────────────────────────────────────────────
      ctx.fillStyle = '#0d0d14'
      ctx.fillRect(0, 0, W, H)

      // ── Columna de etiquetas ──────────────────────────────────────────
      ctx.fillStyle = 'rgba(255,255,255,0.04)'
      ctx.fillRect(0, 0, LW, H)

      // Separador
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.fillRect(LW - 1, 0, 1, H)

      // ── Grid + etiquetas de notas ─────────────────────────────────────
      const fontSize = Math.max(9, Math.round(H / midiRange * 0.5))
      ctx.font = `bold ${fontSize}px system-ui`
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'

      for (let m = Math.floor(minMidi); m <= Math.ceil(maxMidi); m++) {
        const y        = midiToY(m)
        const isNatural = NATURAL.has(m % 12)
        const name     = NOTE_ES[m % 12]

        // Línea de grid
        ctx.fillStyle = isNatural
          ? 'rgba(255,255,255,0.06)'
          : 'rgba(255,255,255,0.02)'
        ctx.fillRect(LW, y - 0.5, DW, 1)

        // Etiqueta solo para notas naturales
        if (isNatural) {
          ctx.fillStyle = 'rgba(255,255,255,0.45)'
          ctx.fillText(name, LW - 5, y)
        }
      }

      // ── Zona pasada (overlay oscuro) ──────────────────────────────────
      ctx.fillStyle = 'rgba(0,0,0,0.22)'
      ctx.fillRect(LW, 0, playheadX - LW, H)

      // ── Notas de la canción ───────────────────────────────────────────
      notes.forEach(note => {
        const x1 = timeToX(note.startTime)
        const x2 = timeToX(note.startTime + note.duration)
        if (x2 < LW || x1 > W) return

        const x1c = Math.max(x1, LW)
        const w   = Math.max(2, x2 - x1c - 1)
        const y   = midiToY(note.pitch) - noteH / 2

        const isPast = note.startTime + note.duration < currentTime
        const isNow  = note.startTime <= currentTime && currentTime < note.startTime + note.duration

        ctx.beginPath()
        ctx.roundRect(x1c, y, w, noteH, 3)
        ctx.fillStyle = isNow
          ? 'rgba(167,139,250,0.95)'
          : isPast
            ? 'rgba(167,139,250,0.14)'
            : 'rgba(167,139,250,0.45)'
        ctx.fill()

        if (isNow) {
          ctx.strokeStyle = 'rgba(221,214,254,0.8)'
          ctx.lineWidth = 1
          ctx.stroke()
          ctx.shadowColor = '#a78bfa'
          ctx.shadowBlur  = 14
          ctx.fill()
          ctx.shadowBlur  = 0
        }

        // Sílaba (solo activa y futuras con espacio)
        if (!isPast && w > 18) {
          ctx.fillStyle = isNow ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.45)'
          ctx.font = `bold ${Math.round(Math.max(9, noteH * 0.7))}px system-ui`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(note.syllable.trim(), x1c + Math.min(w / 2, 50), y + noteH / 2)
        }
      })

      // ── Trails de pitch ───────────────────────────────────────────────
      players.filter(p => !p.isHost).forEach(p => {
        const hist = historyRef.current.get(p.id) ?? []
        ctx.lineCap  = 'round'
        ctx.lineJoin = 'round'

        for (let i = 1; i < hist.length; i++) {
          const a = hist[i - 1]
          const b = hist[i]
          if (!a.midi || !b.midi) continue
          const x1 = timeToX(a.time)
          const x2 = timeToX(b.time)
          if (x2 < LW || x1 > W) continue

          ctx.globalAlpha  = b.onNote ? 0.85 : 0.5
          ctx.strokeStyle  = b.onNote ? p.color : '#f87171'
          ctx.lineWidth    = 2.5
          ctx.beginPath()
          ctx.moveTo(Math.max(x1, LW), midiToY(a.midi))
          ctx.lineTo(x2, midiToY(b.midi))
          ctx.stroke()
        }
        ctx.globalAlpha = 1

        // Punto actual
        const last = hist[hist.length - 1]
        if (last?.midi) {
          const y = midiToY(last.midi)
          ctx.beginPath()
          ctx.arc(playheadX, y, 6, 0, Math.PI * 2)
          ctx.fillStyle   = p.color
          ctx.fill()
          ctx.strokeStyle = 'white'
          ctx.lineWidth   = 2
          ctx.stroke()

          ctx.fillStyle    = p.color
          ctx.font         = 'bold 11px system-ui'
          ctx.textAlign    = 'left'
          ctx.textBaseline = 'middle'
          ctx.fillText(p.name, playheadX + 10, y)
        }
      })

      // ── Playhead ──────────────────────────────────────────────────────
      ctx.setLineDash([5, 4])
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'
      ctx.lineWidth   = 1.5
      ctx.beginPath()
      ctx.moveTo(playheadX, 0)
      ctx.lineTo(playheadX, H)
      ctx.stroke()
      ctx.setLineDash([])

      rafId = requestAnimationFrame(draw)
    }

    rafId = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(rafId)
      ro.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-xl block"
      style={{ height: 180 }}
    />
  )
}
