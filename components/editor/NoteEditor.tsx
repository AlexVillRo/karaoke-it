'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Song, SongNote } from '@/lib/types'

// ── Constantes visuales ────────────────────────────────────────────────────
const KEY_W        = 48   // ancho de las teclas del piano (px)
const RULER_H      = 28   // alto del ruler de tiempo (px)
const NOTE_H       = 16   // alto fijo de cada nota (px, ≈ 1 semitono)
const RESIZE_ZONE  = 8    // px del borde derecho que activan resize
const MIN_DURATION = 0.05 // duración mínima de una nota (s)
const UNDO_LIMIT   = 50

// MIDI visible: C2 (36) a C7 (84)
const MIDI_MIN = 36
const MIDI_MAX = 84
const MIDI_RANGE = MIDI_MAX - MIDI_MIN  // 48 semitonos

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const NATURALS   = new Set([0, 2, 4, 5, 7, 9, 11])

function midiName(midi: number) {
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[midi % 12]}${octave}`
}

function isBlackKey(midi: number) {
  return !NATURALS.has(midi % 12)
}

// ── Tipos internos ────────────────────────────────────────────────────────
type Tool = 'draw' | 'select'

interface DragState {
  type: 'move' | 'resize' | 'draw'
  idx: number        // índice de la nota afectada (-1 durante draw antes de crear)
  originX: number    // clientX al inicio del drag
  originY: number    // clientY al inicio del drag
  origStart: number  // startTime original
  origDur: number    // duration original
  origPitch: number  // pitch original
}

// ── Syllable helpers ──────────────────────────────────────────────────────
function splitSyllables(text: string): string[] {
  const vowels = 'aeiouáéíóúüAEIOUÁÉÍÓÚÜ'
  const words = text
    .replace(/[^\w\sáéíóúüñÁÉÍÓÚÜÑ'-]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean)

  const syllables: string[] = []

  for (const word of words) {
    if (word.length <= 2) { syllables.push(word + ' '); continue }

    const chars = [...word]
    const breaks: number[] = []

    for (let i = 1; i < chars.length - 1; i++) {
      const prev = chars[i - 1]
      const cur  = chars[i]
      const next = chars[i + 1]
      const prevV = vowels.includes(prev)
      const curV  = vowels.includes(cur)
      const nextV = vowels.includes(next)

      if (prevV && !curV && nextV) breaks.push(i)       // VC V
      if (prevV && !curV && !nextV && vowels.includes(chars[i + 2] ?? '')) breaks.push(i)
    }

    if (breaks.length === 0) { syllables.push(word + ' '); continue }

    let last = 0
    for (const b of breaks) {
      syllables.push(word.slice(last, b) + '-')
      last = b
    }
    syllables.push(word.slice(last) + ' ')
  }

  return syllables
}

function recomputeLineIdx(notes: SongNote[], gapThreshold = 1.5): SongNote[] {
  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime)
  let lineIdx = 0
  return sorted.map((n, i) => {
    if (i > 0) {
      const prev = sorted[i - 1]
      if (n.startTime - (prev.startTime + prev.duration) > gapThreshold) lineIdx++
    }
    return { ...n, lineIdx }
  })
}

// ── Props ─────────────────────────────────────────────────────────────────
interface Props {
  song: Song
  onSave: (notes: SongNote[], bpm: number, lyricsOffsetSeconds: number) => Promise<void>
}

// ── Componente ────────────────────────────────────────────────────────────
export function NoteEditor({ song, onSave }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const audioRef   = useRef<HTMLAudioElement>(null)
  const rafRef     = useRef<number>(0)
  const dragRef    = useRef<DragState | null>(null)

  // Estado del editor
  const [notes,       setNotes]       = useState<SongNote[]>(() => [...song.notes])
  const [history,     setHistory]     = useState<SongNote[][]>([])
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [tool,        setTool]        = useState<Tool>('select')
  const [zoom,        setZoom]        = useState(80)         // px/segundo
  const [scrollLeft,  setScrollLeft]  = useState(0)         // segundos desplazados
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying,   setIsPlaying]   = useState(false)
  const [duration,    setDuration]    = useState(0)
  const [bpm,         setBpm]         = useState(song.bpm)
  const [lyricsOffset, setLyricsOffset] = useState(song.lyricsOffsetSeconds ?? 0)
  const [syllables,   setSyllables]   = useState<string[]>(() =>
    song.notes.map(n => n.syllable)
  )
  const [lyricsText,  setLyricsText]  = useState('')
  const [saving,      setSaving]      = useState(false)
  const [savedOk,     setSavedOk]     = useState(false)
  // Sílaba del input de edición de nota seleccionada
  const [editSyllable, setEditSyllable] = useState('')

  // Índice de la siguiente sílaba libre (para modo draw)
  const nextSyllableIdx = useMemo(() => {
    return Math.min(syllables.length - 1, notes.length)
  }, [syllables.length, notes.length])

  // ── Refs para el loop RAF ────────────────────────────────────────────
  const notesRef       = useRef(notes)
  const selectedIdxRef = useRef(selectedIdx)
  const zoomRef        = useRef(zoom)
  const scrollLeftRef  = useRef(scrollLeft)
  const currentTimeRef = useRef(currentTime)
  notesRef.current       = notes
  selectedIdxRef.current = selectedIdx
  zoomRef.current        = zoom
  scrollLeftRef.current  = scrollLeft
  currentTimeRef.current = currentTime

  // ── Conversiones coordenadas ─────────────────────────────────────────
  const timeToX = useCallback((t: number) => KEY_W + (t - scrollLeft) * zoom, [zoom, scrollLeft])
  const xToTime = useCallback((x: number) => scrollLeft + (x - KEY_W) / zoom, [zoom, scrollLeft])
  const midiToY = useCallback((midi: number) => {
    const canvas = canvasRef.current
    if (!canvas) return 0
    const H = canvas.height / window.devicePixelRatio
    return RULER_H + (H - RULER_H) - ((midi - MIDI_MIN + 1) / MIDI_RANGE) * (H - RULER_H)
  }, [])
  const yToMidi = useCallback((y: number) => {
    const canvas = canvasRef.current
    if (!canvas) return 60
    const H = canvas.height / window.devicePixelRatio
    const relY = y - RULER_H
    const totalH = H - RULER_H
    const rawMidi = MIDI_MIN + (1 - relY / totalH) * MIDI_RANGE
    return Math.max(MIDI_MIN, Math.min(MIDI_MAX, Math.round(rawMidi)))
  }, [])

  // ── Historia (undo) ──────────────────────────────────────────────────
  const pushHistory = useCallback((prev: SongNote[]) => {
    setHistory(h => {
      const next = [...h, prev]
      return next.length > UNDO_LIMIT ? next.slice(next.length - UNDO_LIMIT) : next
    })
  }, [])

  const undo = useCallback(() => {
    setHistory(h => {
      if (h.length === 0) return h
      const prev = h[h.length - 1]
      setNotes(prev)
      setSelectedIdx(null)
      return h.slice(0, h.length - 1)
    })
  }, [])

  // ── Guardar ──────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaving(true)
    const finalNotes = recomputeLineIdx(notes)
    await onSave(finalNotes, bpm, lyricsOffset)
    setSaving(false)
    setSavedOk(true)
    setTimeout(() => setSavedOk(false), 2000)
  }, [notes, bpm, lyricsOffset, onSave])

  // ── Audio controls ───────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) { audio.play(); setIsPlaying(true) }
    else              { audio.pause(); setIsPlaying(false) }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onEnded = () => setIsPlaying(false)
    const onLoaded = () => setDuration(audio.duration)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('loadedmetadata', onLoaded)
    return () => {
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('loadedmetadata', onLoaded)
    }
  }, [])

  // RAF para el playhead
  useEffect(() => {
    function tick() {
      const audio = audioRef.current
      if (audio && !audio.paused) {
        setCurrentTime(audio.currentTime)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // ── Keyboard shortcuts ───────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.code === 'Space') { e.preventDefault(); togglePlay() }
      if (e.key === 'd' || e.key === 'D') setTool('draw')
      if (e.key === 's' || e.key === 'S') setTool('select')
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdxRef.current !== null) {
        e.preventDefault()
        const idx = selectedIdxRef.current
        pushHistory(notesRef.current)
        setNotes(ns => ns.filter((_, i) => i !== idx))
        setSelectedIdx(null)
      }
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, undo, pushHistory])

  // ── Sincronizar sílaba del input con la nota seleccionada ────────────
  useEffect(() => {
    if (selectedIdx !== null && notes[selectedIdx]) {
      setEditSyllable(notes[selectedIdx].syllable)
    }
  }, [selectedIdx, notes])

  // ── Dibujo del canvas ────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        canvas.width  = rect.width  * window.devicePixelRatio
        canvas.height = rect.height * window.devicePixelRatio
        canvas.style.width  = `${rect.width}px`
        canvas.style.height = `${rect.height}px`
      }
    }
    updateSize()
    const ro = new ResizeObserver(updateSize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // Redibuja cuando cambia cualquier estado relevante
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio
    const W   = canvas.width  / dpr
    const H   = canvas.height / dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const DW = W - KEY_W  // ancho del área de notas
    const totalH = H - RULER_H

    // Helper locales (usando el estado actual del closure)
    const tX  = (t: number) => KEY_W + (t - scrollLeft) * zoom
    const mY  = (midi: number) => RULER_H + totalH - ((midi - MIDI_MIN + 1) / MIDI_RANGE) * totalH

    // ── Fondo ──────────────────────────────────────────────────────────
    ctx.fillStyle = '#0d0d14'
    ctx.fillRect(0, 0, W, H)

    // ── Grid horizontal (semitonos) ────────────────────────────────────
    for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
      const y = mY(m)
      ctx.fillStyle = isBlackKey(m)
        ? 'rgba(255,255,255,0.02)'
        : 'rgba(255,255,255,0.05)'
      ctx.fillRect(KEY_W, y, DW, NOTE_H)
      // línea de separación
      ctx.fillStyle = 'rgba(255,255,255,0.05)'
      ctx.fillRect(KEY_W, y + NOTE_H, DW, 1)
    }

    // ── Resaltar Do de cada octava ─────────────────────────────────────
    for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
      if (m % 12 === 0) {
        const y = mY(m)
        ctx.fillStyle = 'rgba(167,139,250,0.08)'
        ctx.fillRect(KEY_W, y, DW, NOTE_H)
      }
    }

    // ── Grid vertical (tiempo) ─────────────────────────────────────────
    const secVisible = DW / zoom
    const gridStep = secVisible > 20 ? 5 : secVisible > 8 ? 2 : secVisible > 3 ? 1 : 0.5
    const startSec  = Math.floor(scrollLeft / gridStep) * gridStep

    for (let t = startSec; t < scrollLeft + secVisible + gridStep; t += gridStep) {
      const x = tX(t)
      if (x < KEY_W || x > W) continue
      ctx.fillStyle = t % 5 === 0
        ? 'rgba(255,255,255,0.08)'
        : 'rgba(255,255,255,0.03)'
      ctx.fillRect(x, RULER_H, 1, totalH)
    }

    // ── Ruler (fila superior) ──────────────────────────────────────────
    ctx.fillStyle = '#161624'
    ctx.fillRect(KEY_W, 0, DW, RULER_H)
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.fillRect(KEY_W, RULER_H - 1, DW, 1)

    ctx.font = 'bold 10px system-ui'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    for (let t = startSec; t < scrollLeft + secVisible + gridStep; t += gridStep) {
      const x = tX(t)
      if (x < KEY_W || x > W) continue
      const mins = Math.floor(t / 60)
      const secs = (t % 60).toFixed(gridStep < 1 ? 1 : 0)
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillText(`${mins}:${String(secs).padStart(4, '0')}`, x + 3, RULER_H / 2)
    }

    // ── Teclas del piano ───────────────────────────────────────────────
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, RULER_H, KEY_W, totalH)
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.fillRect(KEY_W - 1, RULER_H, 1, totalH)

    ctx.font = 'bold 9px system-ui'
    ctx.textAlign = 'right'
    for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
      const y = mY(m)
      const isBlack = isBlackKey(m)
      ctx.fillStyle = isBlack ? '#111' : '#2a2a3e'
      ctx.fillRect(isBlack ? KEY_W * 0.55 : 0, y + 0.5, isBlack ? KEY_W * 0.4 : KEY_W - 2, NOTE_H - 1)

      if (!isBlack && m % 12 === 0) {
        ctx.fillStyle = 'rgba(167,139,250,0.7)'
        ctx.textBaseline = 'middle'
        ctx.fillText(midiName(m), KEY_W - 4, y + NOTE_H / 2)
      }
    }

    // ── Notas ──────────────────────────────────────────────────────────
    notes.forEach((note, i) => {
      const x1 = tX(note.startTime)
      const x2 = tX(note.startTime + note.duration)
      if (x2 < KEY_W || x1 > W) return

      const x1c = Math.max(x1, KEY_W)
      const w   = Math.max(2, x2 - x1c - 1)
      const y   = mY(note.pitch)
      const isSel = i === selectedIdx

      // Fondo de la nota
      ctx.beginPath()
      ctx.roundRect(x1c, y, w, NOTE_H, 3)
      ctx.fillStyle = isSel
        ? '#c4b5fd'
        : 'rgba(167,139,250,0.75)'
      ctx.fill()

      // Borde selección
      if (isSel) {
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.stroke()
        // Handle de resize
        ctx.fillStyle = '#fff'
        ctx.fillRect(x2 - 4, y + 2, 3, NOTE_H - 4)
      }

      // Sílaba
      if (w > 14) {
        ctx.fillStyle = isSel ? '#1e0e3e' : 'rgba(255,255,255,0.9)'
        ctx.font = `bold ${Math.min(11, NOTE_H * 0.75)}px system-ui`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(note.syllable.trim(), x1c + Math.min(w / 2, 40), y + NOTE_H / 2)
      }
    })

    // ── Playhead ───────────────────────────────────────────────────────
    const phX = tX(currentTime)
    if (phX >= KEY_W && phX <= W) {
      ctx.setLineDash([4, 3])
      ctx.strokeStyle = '#f87171'
      ctx.lineWidth   = 1.5
      ctx.beginPath()
      ctx.moveTo(phX, RULER_H)
      ctx.lineTo(phX, H)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // ── Fondo del piano (sobre todo) ───────────────────────────────────
    ctx.fillStyle = '#0d0d14'
    ctx.fillRect(0, 0, KEY_W, RULER_H)

  }, [notes, selectedIdx, zoom, scrollLeft, currentTime])

  // ── Mouse events ──────────────────────────────────────────────────────
  function getNoteAtPos(x: number, y: number): { idx: number; zone: 'body' | 'resize' } | null {
    const t  = xToTime(x)
    const m  = yToMidi(y)
    // Iterar en reversa para seleccionar la nota "encima"
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i]
      if (n.pitch !== m) continue
      if (t < n.startTime || t > n.startTime + n.duration) continue
      const x2 = timeToX(n.startTime + n.duration)
      const zone = x > x2 - RESIZE_ZONE ? 'resize' : 'body'
      return { idx: i, zone }
    }
    return null
  }

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Click en ruler → seek
    if (y < RULER_H && x > KEY_W) {
      const t = xToTime(x)
      if (audioRef.current) {
        audioRef.current.currentTime = Math.max(0, t)
        setCurrentTime(Math.max(0, t))
      }
      return
    }

    if (tool === 'select') {
      const hit = getNoteAtPos(x, y)
      if (hit) {
        setSelectedIdx(hit.idx)
        const n = notes[hit.idx]
        dragRef.current = {
          type: hit.zone === 'resize' ? 'resize' : 'move',
          idx: hit.idx,
          originX: e.clientX,
          originY: e.clientY,
          origStart: n.startTime,
          origDur: n.duration,
          origPitch: n.pitch,
        }
      } else {
        setSelectedIdx(null)
      }
    } else {
      // Draw mode
      const t = xToTime(x)
      const m = yToMidi(y)
      const syl = syllables[nextSyllableIdx] ?? ''
      const newNote: SongNote = {
        startTime: Math.max(0, t),
        duration: MIN_DURATION,
        pitch: m,
        syllable: syl,
        lineIdx: 0,
      }
      pushHistory(notes)
      const newIdx = notes.length
      setNotes(ns => [...ns, newNote])
      setSelectedIdx(newIdx)
      dragRef.current = {
        type: 'draw',
        idx: newIdx,
        originX: e.clientX,
        originY: e.clientY,
        origStart: newNote.startTime,
        origDur: MIN_DURATION,
        origPitch: m,
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, notes, xToTime, yToMidi, timeToX, syllables, nextSyllableIdx, pushHistory])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const canvas = canvasRef.current
    if (!canvas) return

    const dxPx = e.clientX - drag.originX
    const dyPx = e.clientY - drag.originY
    const dxSec = dxPx / zoomRef.current
    const dyMidi = Math.round(-dyPx / NOTE_H)

    setNotes(ns => {
      const updated = [...ns]
      const n = { ...updated[drag.idx] }

      if (drag.type === 'move') {
        n.startTime = Math.max(0, drag.origStart + dxSec)
        n.pitch     = Math.max(MIDI_MIN, Math.min(MIDI_MAX, drag.origPitch + dyMidi))
      } else if (drag.type === 'resize' || drag.type === 'draw') {
        n.duration = Math.max(MIN_DURATION, drag.origDur + dxSec)
      }

      updated[drag.idx] = n
      return updated
    })
  }, [])

  const onMouseUp = useCallback(() => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    // Guardar en historial solo si hubo movimiento real (no en mouseDown)
    // El historial ya se guardó en draw; para move/resize lo hacemos aquí
    if (drag.type === 'move' || drag.type === 'resize') {
      pushHistory(notesRef.current)
    }
  }, [pushHistory])

  // Scroll con rueda del mouse
  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      // Zoom
      setZoom(z => Math.max(20, Math.min(400, z * (e.deltaY < 0 ? 1.1 : 0.9))))
    } else {
      // Scroll horizontal
      setScrollLeft(s => Math.max(0, s + e.deltaY / 3 / zoomRef.current * 10))
    }
  }, [])

  // ── Formato de tiempo ────────────────────────────────────────────────
  function fmtTime(s: number) {
    const m = Math.floor(s / 60)
    const ss = (s % 60).toFixed(1)
    return `${m}:${ss.padStart(4, '0')}`
  }

  // ── Botones de zoom ──────────────────────────────────────────────────
  const zoomIn  = () => setZoom(z => Math.min(400, Math.round(z * 1.5)))
  const zoomOut = () => setZoom(z => Math.max(20,  Math.round(z / 1.5)))

  // ── Render ────────────────────────────────────────────────────────────
  const selectedNote = selectedIdx !== null ? notes[selectedIdx] : null

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f] text-white select-none">

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#12121e] border-b border-white/10 flex-wrap">
        {/* Herramientas */}
        <div className="flex gap-1">
          {(['select', 'draw'] as Tool[]).map(t => (
            <button
              key={t}
              onClick={() => setTool(t)}
              className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
                tool === t
                  ? 'bg-violet-600 text-white'
                  : 'bg-white/10 text-white/60 hover:bg-white/20'
              }`}
            >
              {t === 'select' ? 'S — Mover' : 'D — Dibujar'}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-white/10" />

        {/* Zoom */}
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} className="w-6 h-6 rounded bg-white/10 hover:bg-white/20 text-sm">−</button>
          <span className="text-xs text-white/40 w-12 text-center">{zoom}px/s</span>
          <button onClick={zoomIn}  className="w-6 h-6 rounded bg-white/10 hover:bg-white/20 text-sm">+</button>
        </div>

        <div className="w-px h-5 bg-white/10" />

        {/* BPM */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-white/40">BPM</span>
          <input
            type="number" min={40} max={300} value={bpm}
            onChange={e => setBpm(Number(e.target.value))}
            className="w-16 bg-black/30 border border-white/10 rounded px-2 py-0.5 text-sm text-white text-center focus:outline-none focus:border-violet-500"
          />
        </div>

        {/* Offset */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-white/40">Offset</span>
          <input
            type="number" min={0} max={120} step={0.1} value={lyricsOffset}
            onChange={e => setLyricsOffset(Number(e.target.value))}
            className="w-16 bg-black/30 border border-white/10 rounded px-2 py-0.5 text-sm text-white text-center focus:outline-none focus:border-violet-500"
          />
          <span className="text-xs text-white/30">s</span>
        </div>

        <div className="w-px h-5 bg-white/10" />

        {/* Undo */}
        <button
          onClick={undo}
          disabled={history.length === 0}
          className="px-3 py-1 rounded text-xs font-bold bg-white/10 hover:bg-white/20 disabled:opacity-30 transition-colors"
        >
          ↩ Ctrl+Z
        </button>

        <div className="flex-1" />

        {/* Nota seleccionada — editar sílaba */}
        {selectedNote && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-white/40">Sílaba:</span>
            <input
              value={editSyllable}
              onChange={e => setEditSyllable(e.target.value)}
              onBlur={() => {
                if (selectedIdx === null) return
                pushHistory(notes)
                setNotes(ns => {
                  const updated = [...ns]
                  updated[selectedIdx] = { ...updated[selectedIdx], syllable: editSyllable }
                  return updated
                })
              }}
              className="w-20 bg-black/30 border border-violet-500/60 rounded px-2 py-0.5 text-sm text-white focus:outline-none focus:border-violet-400"
            />
          </div>
        )}

        {/* Guardar */}
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-4 py-1 rounded text-xs font-bold transition-colors ${
            savedOk
              ? 'bg-emerald-600 text-white'
              : 'bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50'
          }`}
        >
          {saving ? 'Guardando...' : savedOk ? '✓ Guardado' : 'Guardar'}
        </button>
      </div>

      {/* ── Canvas principal ─────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-full block cursor-crosshair"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
        />
      </div>

      {/* ── Player de audio ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-[#12121e] border-t border-white/10">
        <audio ref={audioRef} src={song.audioUrl} preload="metadata" />

        <button
          onClick={togglePlay}
          className="w-8 h-8 rounded-full bg-violet-600 hover:bg-violet-500 flex items-center justify-center text-sm transition-colors"
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        <span className="text-xs font-mono text-white/60 w-24">
          {fmtTime(currentTime)} / {fmtTime(duration)}
        </span>

        {/* Progress bar clickable */}
        <div
          className="flex-1 h-2 bg-white/10 rounded-full cursor-pointer relative"
          onClick={e => {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
            const ratio = (e.clientX - rect.left) / rect.width
            const t = ratio * duration
            if (audioRef.current) {
              audioRef.current.currentTime = t
              setCurrentTime(t)
            }
          }}
        >
          <div
            className="h-full bg-violet-500 rounded-full"
            style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
          />
        </div>

        <span className="text-xs text-white/30">Scroll: rueda · Zoom: Ctrl+rueda</span>
      </div>

      {/* ── Panel de sílabas ─────────────────────────────────────────── */}
      <div className="px-4 py-3 bg-[#0d0d18] border-t border-white/10">
        <div className="flex gap-2 items-start">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-white/40 font-bold">Letra / sílabas</span>
              <button
                onClick={() => {
                  const syls = splitSyllables(lyricsText)
                  setSyllables(syls)
                }}
                className="px-2 py-0.5 rounded text-xs bg-cyan-700/60 hover:bg-cyan-600/60 text-white transition-colors"
              >
                Auto-dividir
              </button>
              <span className="text-xs text-white/25">
                {notes.length} notas · {syllables.length} sílabas
              </span>
            </div>
            <textarea
              value={lyricsText}
              onChange={e => setLyricsText(e.target.value)}
              placeholder="Pega la letra aquí y presiona Auto-dividir..."
              rows={2}
              className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-violet-500 resize-none"
            />
          </div>

          {/* Chips de sílabas */}
          <div className="flex flex-wrap gap-1 max-w-[50%] max-h-24 overflow-y-auto">
            {syllables.map((s, i) => (
              <span
                key={i}
                className={`px-1.5 py-0.5 rounded text-xs font-mono transition-colors ${
                  i < notes.length
                    ? 'bg-white/10 text-white/30'
                    : i === nextSyllableIdx
                      ? 'bg-violet-600 text-white ring-1 ring-violet-300'
                      : 'bg-white/5 text-white/50'
                }`}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
