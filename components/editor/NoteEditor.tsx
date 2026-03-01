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
const MIDI_RANGE = MIDI_MAX - MIDI_MIN

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

interface OrigPos { idx: number; startTime: number; pitch: number; duration: number }

interface DragState {
  type: 'move' | 'resize' | 'draw' | 'box-select' | 'ruler-scrub'
  idx: number          // nota principal afectada (-1 si no hay)
  originX: number      // clientX al inicio
  originY: number      // clientY al inicio
  origStart: number    // startTime original (nota principal)
  origDur: number      // duration original (nota principal)
  origPitch: number    // pitch original (nota principal)
  origPositions: OrigPos[]  // todas las notas seleccionadas (para multi-move)
}

interface SelRect { x1: number; y1: number; x2: number; y2: number }

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

      if (prevV && !curV && nextV) breaks.push(i)
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
  const [notes,        setNotes]        = useState<SongNote[]>(() => [...song.notes])
  const [history,      setHistory]      = useState<SongNote[][]>([])
  const [selectedIdxs, setSelectedIdxs] = useState<number[]>([])
  const [selectionRect, setSelectionRect] = useState<SelRect | null>(null)
  const [tool,         setTool]         = useState<Tool>('select')
  const [zoom,         setZoom]         = useState(80)
  const [scrollLeft,   setScrollLeft]   = useState(0)
  const [currentTime,  setCurrentTime]  = useState(0)
  const [isPlaying,    setIsPlaying]    = useState(false)
  const [duration,     setDuration]     = useState(0)
  const [bpm,          setBpm]          = useState(song.bpm)
  const [lyricsOffset, setLyricsOffset] = useState(song.lyricsOffsetSeconds ?? 0)
  const [syllables,    setSyllables]    = useState<string[]>(() => song.notes.map(n => n.syllable))
  const [lyricsText,   setLyricsText]   = useState('')
  const [saving,       setSaving]       = useState(false)
  const [savedOk,      setSavedOk]      = useState(false)
  const [editSyllable, setEditSyllable] = useState('')
  const [durScale,     setDurScale]     = useState('0.5')
  const [timeShift,    setTimeShift]    = useState('0')

  const nextSyllableIdx = useMemo(() => Math.min(syllables.length - 1, notes.length), [syllables.length, notes.length])

  // ── Refs sincronizados ───────────────────────────────────────────────
  const notesRef         = useRef(notes)
  const selectedIdxsRef  = useRef(selectedIdxs)
  const selectionRectRef = useRef(selectionRect)
  const zoomRef          = useRef(zoom)
  const scrollLeftRef    = useRef(scrollLeft)
  const durationRef      = useRef(duration)
  const lyricsOffsetRef  = useRef(lyricsOffset)
  notesRef.current         = notes
  selectedIdxsRef.current  = selectedIdxs
  selectionRectRef.current = selectionRect
  zoomRef.current          = zoom
  scrollLeftRef.current    = scrollLeft
  durationRef.current      = duration
  lyricsOffsetRef.current  = lyricsOffset

  // ── Conversiones coordenadas ─────────────────────────────────────────
  const timeToX = useCallback((t: number) => KEY_W + (t - scrollLeft) * zoom, [zoom, scrollLeft])
  const xToTime = useCallback((x: number) => scrollLeft + (x - KEY_W) / zoom,  [zoom, scrollLeft])
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
    const relY   = y - RULER_H
    const totalH = H - RULER_H
    const rawMidi = MIDI_MIN + (1 - relY / totalH) * MIDI_RANGE
    return Math.max(MIDI_MIN, Math.min(MIDI_MAX, Math.round(rawMidi)))
  }, [])

  // ── Historia ─────────────────────────────────────────────────────────
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
      setSelectedIdxs([])
      return h.slice(0, h.length - 1)
    })
  }, [])

  // ── Guardar ──────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaving(true)
    await onSave(recomputeLineIdx(notes), bpm, lyricsOffset)
    setSaving(false)
    setSavedOk(true)
    setTimeout(() => setSavedOk(false), 2000)
  }, [notes, bpm, lyricsOffset, onSave])

  // ── Ajuste global de notas ───────────────────────────────────────────
  const applyDurScale = useCallback(() => {
    const scale = parseFloat(durScale)
    if (!isFinite(scale) || scale <= 0) return
    pushHistory(notes)
    setNotes(ns => ns.map(n => ({ ...n, duration: Math.max(MIN_DURATION, n.duration * scale) })))
  }, [notes, durScale, pushHistory])

  // Encadena las notas para eliminar huecos: cada nota empieza justo donde termina la anterior.
  // Notas de diferente lineIdx reciben un pequeño gap de frase (0.25 s) entre ellas.
  const compactNotes = useCallback(() => {
    if (notes.length === 0) return
    pushHistory(notes)
    const sorted = [...notes].sort((a, b) => a.startTime - b.startTime)
    const INLINE_GAP = 0.02   // gap entre notas de la misma línea (20 ms)
    const LINE_GAP   = 0.25   // gap entre líneas distintas (pausa de frase)
    const result: SongNote[] = [sorted[0]]
    for (let i = 1; i < sorted.length; i++) {
      const prev = result[i - 1]
      const note = sorted[i]
      const gap  = note.lineIdx !== prev.lineIdx ? LINE_GAP : INLINE_GAP
      result.push({ ...note, startTime: prev.startTime + prev.duration + gap })
    }
    setNotes(result)
  }, [notes, pushHistory])

  const applyTimeShift = useCallback(() => {
    const shift = parseFloat(timeShift)
    if (!isFinite(shift)) return
    pushHistory(notes)
    setNotes(ns => ns.map(n => ({ ...n, startTime: Math.max(0, n.startTime + shift) })))
  }, [notes, timeShift, pushHistory])

  // ── Audio ─────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) { audio.play(); setIsPlaying(true) }
    else              { audio.pause(); setIsPlaying(false) }
  }, [])

  const seekTo = useCallback((t: number) => {
    const clamped = Math.max(0, Math.min(durationRef.current || 999, t))
    if (audioRef.current) audioRef.current.currentTime = clamped
    setCurrentTime(clamped)
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onEnded  = () => setIsPlaying(false)
    const onLoaded = () => setDuration(audio.duration)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('loadedmetadata', onLoaded)
    return () => { audio.removeEventListener('ended', onEnded); audio.removeEventListener('loadedmetadata', onLoaded) }
  }, [])

  // RAF playhead
  useEffect(() => {
    function tick() {
      const audio = audioRef.current
      if (audio && !audio.paused) setCurrentTime(audio.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // ── Teclado ──────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.code === 'Space') { e.preventDefault(); togglePlay() }
      if (e.key === 'd' || e.key === 'D') setTool('draw')
      if (e.key === 's' || e.key === 'S') setTool('select')

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdxsRef.current.length > 0) {
        e.preventDefault()
        const toDelete = new Set(selectedIdxsRef.current)
        pushHistory(notesRef.current)
        setNotes(ns => ns.filter((_, i) => !toDelete.has(i)))
        setSelectedIdxs([])
      }

      if (e.ctrlKey && e.key === 'a') {
        e.preventDefault()
        setSelectedIdxs(notesRef.current.map((_, i) => i))
      }

      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo() }

      if (e.key === 'Escape') {
        setSelectedIdxs([])
        setSelectionRect(null)
        dragRef.current = null
      }

      // Estirar / acortar notas seleccionadas
      if ((e.key === ']' || e.key === '[') && selectedIdxsRef.current.length > 0) {
        e.preventDefault()
        const delta = e.key === ']' ? 0.05 : -0.05
        pushHistory(notesRef.current)
        setNotes(ns => {
          const u = [...ns]
          for (const i of selectedIdxsRef.current) {
            u[i] = { ...u[i], duration: Math.max(MIN_DURATION, u[i].duration + delta) }
          }
          return u
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, undo, pushHistory])

  // ── Sincronizar sílaba del input ─────────────────────────────────────
  useEffect(() => {
    const lastIdx = selectedIdxs[selectedIdxs.length - 1]
    if (lastIdx !== undefined && notes[lastIdx]) setEditSyllable(notes[lastIdx].syllable)
  }, [selectedIdxs, notes])

  // ── Canvas: resize observer ──────────────────────────────────────────
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

  // ── Canvas: dibujo ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio
    const W   = canvas.width  / dpr
    const H   = canvas.height / dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const DW     = W - KEY_W
    const totalH = H - RULER_H
    const selectedSet = new Set(selectedIdxs)

    const tX = (t: number) => KEY_W + (t - scrollLeft) * zoom
    const mY = (midi: number) => RULER_H + totalH - ((midi - MIDI_MIN + 1) / MIDI_RANGE) * totalH

    // Fondo
    ctx.fillStyle = '#0d0d14'
    ctx.fillRect(0, 0, W, H)

    // Grid horizontal (semitonos)
    for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
      const y = mY(m)
      ctx.fillStyle = isBlackKey(m) ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)'
      ctx.fillRect(KEY_W, y, DW, NOTE_H)
      ctx.fillStyle = 'rgba(255,255,255,0.05)'
      ctx.fillRect(KEY_W, y + NOTE_H, DW, 1)
    }

    // Resaltar Do de cada octava
    for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
      if (m % 12 === 0) {
        ctx.fillStyle = 'rgba(167,139,250,0.08)'
        ctx.fillRect(KEY_W, mY(m), DW, NOTE_H)
      }
    }

    // Grid vertical (tiempo)
    const secVisible = DW / zoom
    const gridStep   = secVisible > 20 ? 5 : secVisible > 8 ? 2 : secVisible > 3 ? 1 : 0.5
    const startSec   = Math.floor(scrollLeft / gridStep) * gridStep
    for (let t = startSec; t < scrollLeft + secVisible + gridStep; t += gridStep) {
      const x = tX(t)
      if (x < KEY_W || x > W) continue
      ctx.fillStyle = t % 5 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)'
      ctx.fillRect(x, RULER_H, 1, totalH)
    }

    // Ruler
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

    // Teclas del piano
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

    // Notas
    notes.forEach((note, i) => {
      const absStart = note.startTime + lyricsOffset   // tiempo absoluto en el audio
      const x1 = tX(absStart)
      const x2 = tX(absStart + note.duration)
      if (x2 < KEY_W || x1 > W) return

      const x1c = Math.max(x1, KEY_W)
      const w   = Math.max(2, x2 - x1c - 1)
      const y   = mY(note.pitch)
      const isSel = selectedSet.has(i)

      ctx.beginPath()
      ctx.roundRect(x1c, y, w, NOTE_H, 3)
      ctx.fillStyle = isSel ? '#c4b5fd' : 'rgba(167,139,250,0.75)'
      ctx.fill()

      if (isSel) {
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.stroke()
        // Handle de resize (borde derecho)
        const x2clamped = tX(absStart + note.duration)
        ctx.fillStyle = '#fff'
        ctx.fillRect(x2clamped - 4, y + 2, 3, NOTE_H - 4)
      }

      if (w > 14) {
        ctx.fillStyle = isSel ? '#1e0e3e' : 'rgba(255,255,255,0.9)'
        ctx.font = `bold ${Math.min(11, NOTE_H * 0.75)}px system-ui`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(note.syllable.trim(), x1c + Math.min(w / 2, 40), y + NOTE_H / 2)
      }
    })

    // Rectángulo de selección (rubber band)
    if (selectionRect) {
      const { x1, y1, x2, y2 } = selectionRect
      const rx = Math.min(x1, x2)
      const ry = Math.min(y1, y2)
      const rw = Math.abs(x2 - x1)
      const rh = Math.abs(y2 - y1)
      ctx.fillStyle = 'rgba(167,139,250,0.08)'
      ctx.fillRect(rx, ry, rw, rh)
      ctx.setLineDash([4, 3])
      ctx.strokeStyle = 'rgba(167,139,250,0.8)'
      ctx.lineWidth = 1.5
      ctx.strokeRect(rx, ry, rw, rh)
      ctx.setLineDash([])
    }

    // Playhead
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

    // Fondo del piano corner (sobre todo)
    ctx.fillStyle = '#0d0d14'
    ctx.fillRect(0, 0, KEY_W, RULER_H)

  }, [notes, selectedIdxs, zoom, scrollLeft, currentTime, selectionRect, lyricsOffset])

  // ── Helpers mouse ─────────────────────────────────────────────────────
  function getCanvasPos(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // Hit detection por bounding box en píxeles (más confiable que comparar MIDI).
  // Las notas se muestran en tiempo absoluto (startTime + lyricsOffset), así que
  // convertimos la posición X del cursor al mismo sistema de coordenadas.
  function getNoteAtPos(x: number, y: number): { idx: number; zone: 'body' | 'resize' } | null {
    const tAbs    = xToTime(x)                        // tiempo absoluto del cursor
    const offset  = lyricsOffsetRef.current
    const TOLERANCE = 2
    for (let i = notes.length - 1; i >= 0; i--) {
      const n      = notes[i]
      const absStart = n.startTime + offset
      if (tAbs < absStart || tAbs > absStart + n.duration) continue
      const ny = midiToY(n.pitch)
      if (y < ny - TOLERANCE || y > ny + NOTE_H + TOLERANCE) continue
      const x2 = timeToX(absStart + n.duration)
      return { idx: i, zone: x > x2 - RESIZE_ZONE ? 'resize' : 'body' }
    }
    return null
  }

  // ── Mouse down ────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return
    const { x, y } = getCanvasPos(e)

    // — Click cerca del playhead (línea roja) en cualquier parte del canvas → arrastrar
    const playheadX = timeToX(currentTime)
    if (x > KEY_W && Math.abs(x - playheadX) <= 8) {
      dragRef.current = { type: 'ruler-scrub', idx: -1, originX: e.clientX, originY: e.clientY, origStart: 0, origDur: 0, origPitch: 0, origPositions: [] }
      return
    }

    // — Ruler (clic fuera del playhead) → seek directo
    if (y < RULER_H && x > KEY_W) {
      seekTo(xToTime(x))
      dragRef.current = { type: 'ruler-scrub', idx: -1, originX: e.clientX, originY: e.clientY, origStart: 0, origDur: 0, origPitch: 0, origPositions: [] }
      return
    }

    if (tool === 'select') {
      const hit = getNoteAtPos(x, y)

      if (hit) {
        // Determinar selección resultante
        let newSel: number[]
        if (e.shiftKey) {
          // Shift: toggle esta nota en la selección
          newSel = selectedIdxs.includes(hit.idx)
            ? selectedIdxs.filter(i => i !== hit.idx)
            : [...selectedIdxs, hit.idx]
        } else if (!selectedIdxs.includes(hit.idx)) {
          // Click en nota no seleccionada → reemplazar selección
          newSel = [hit.idx]
        } else {
          // Click en nota ya seleccionada → mantener selección para drag
          newSel = selectedIdxs
        }
        setSelectedIdxs(newSel)

        if (hit.zone === 'resize') {
          const n = notes[hit.idx]
          // Si la nota clickeada está dentro de la selección, resize aplica a todas
          const resizeSel = newSel.includes(hit.idx) ? newSel : [hit.idx]
          dragRef.current = { type: 'resize', idx: hit.idx, originX: e.clientX, originY: e.clientY, origStart: n.startTime, origDur: n.duration, origPitch: n.pitch, origPositions: resizeSel.map(i => ({ idx: i, startTime: notes[i].startTime, pitch: notes[i].pitch, duration: notes[i].duration })) }
        } else {
          // Multi-move: guardar posiciones originales de todas las seleccionadas
          dragRef.current = {
            type: 'move', idx: hit.idx, originX: e.clientX, originY: e.clientY,
            origStart: notes[hit.idx].startTime, origDur: notes[hit.idx].duration, origPitch: notes[hit.idx].pitch,
            origPositions: newSel.map(i => ({ idx: i, startTime: notes[i].startTime, pitch: notes[i].pitch, duration: notes[i].duration })),
          }
        }
      } else {
        // Área vacía → iniciar rubber band (NO borramos selección aún)
        setSelectionRect({ x1: x, y1: y, x2: x, y2: y })
        dragRef.current = { type: 'box-select', idx: -1, originX: e.clientX, originY: e.clientY, origStart: 0, origDur: 0, origPitch: 0, origPositions: [] }
      }
    } else {
      // Modo Draw → crear nota nueva
      // El cursor está en tiempo absoluto; guardamos startTime en tiempo relativo (lyric time)
      const tAbs = xToTime(x)
      const tRel = Math.max(0, tAbs - lyricsOffsetRef.current)
      const m    = yToMidi(y)
      const syl  = syllables[nextSyllableIdx] ?? ''
      const newNote: SongNote = { startTime: tRel, duration: MIN_DURATION, pitch: m, syllable: syl, lineIdx: 0 }
      pushHistory(notes)
      const newIdx = notes.length
      setNotes(ns => [...ns, newNote])
      setSelectedIdxs([newIdx])
      dragRef.current = { type: 'draw', idx: newIdx, originX: e.clientX, originY: e.clientY, origStart: tRel, origDur: MIN_DURATION, origPitch: m, origPositions: [] }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, notes, selectedIdxs, xToTime, yToMidi, timeToX, syllables, nextSyllableIdx, pushHistory, seekTo, currentTime])

  // ── Mouse move ────────────────────────────────────────────────────────
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag) return
    if (!canvasRef.current) return

    const dxPx  = e.clientX - drag.originX
    const dyPx  = e.clientY - drag.originY
    const dxSec = dxPx / zoomRef.current
    const dyMidi = Math.round(-dyPx / NOTE_H)

    if (drag.type === 'ruler-scrub') {
      const { x } = getCanvasPos(e)
      seekTo(xToTime(x))
      return
    }

    if (drag.type === 'box-select') {
      const { x, y } = getCanvasPos(e)
      setSelectionRect(sr => sr ? { ...sr, x2: x, y2: y } : null)
      return
    }

    if (drag.type === 'move') {
      setNotes(ns => {
        const updated = [...ns]
        for (const op of drag.origPositions) {
          const n = { ...updated[op.idx] }
          n.startTime = Math.max(0, op.startTime + dxSec)
          n.pitch     = Math.max(MIDI_MIN, Math.min(MIDI_MAX, op.pitch + dyMidi))
          updated[op.idx] = n
        }
        return updated
      })
      return
    }

    if (drag.type === 'resize') {
      setNotes(ns => {
        const updated = [...ns]
        // Aplicar el mismo delta de duración a todas las notas seleccionadas
        for (const op of drag.origPositions) {
          updated[op.idx] = { ...updated[op.idx], duration: Math.max(MIN_DURATION, op.duration + dxSec) }
        }
        return updated
      })
    }

    if (drag.type === 'draw') {
      setNotes(ns => {
        const updated = [...ns]
        const n = { ...updated[drag.idx] }
        n.duration = Math.max(MIN_DURATION, drag.origDur + dxSec)
        updated[drag.idx] = n
        return updated
      })
    }
  }, [xToTime, seekTo])

  // ── Mouse up ──────────────────────────────────────────────────────────
  const onMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null

    if (drag.type === 'box-select') {
      const sr = selectionRectRef.current
      const hasDrag = sr && (Math.abs(sr.x2 - sr.x1) > 5 || Math.abs(sr.y2 - sr.y1) > 5)

      if (hasDrag && sr) {
        // Rubber-band real → seleccionar notas dentro del rect (por bounding box pixel)
        const rxMin = Math.min(sr.x1, sr.x2)
        const rxMax = Math.max(sr.x1, sr.x2)
        const ryMin = Math.min(sr.y1, sr.y2)
        const ryMax = Math.max(sr.y1, sr.y2)
        const t1 = xToTime(rxMin)   // tiempo absoluto
        const t2 = xToTime(rxMax)
        const off = lyricsOffsetRef.current
        const inside = notesRef.current
          .map((n, i) => ({ n, i }))
          .filter(({ n }) => {
            // Comparar en tiempo absoluto
            const absStart = n.startTime + off
            if (absStart + n.duration < t1 || absStart > t2) return false
            const ny = midiToY(n.pitch)
            return ny + NOTE_H >= ryMin && ny <= ryMax
          })
          .map(({ i }) => i)
        setSelectedIdxs(prev => e.shiftKey ? [...new Set([...prev, ...inside])] : inside)
      } else if (!e.shiftKey) {
        // Simple click en vacío sin arrastrar → deseleccionar todo
        setSelectedIdxs([])
      }
      setSelectionRect(null)
      return
    }

    if (drag.type === 'move' || drag.type === 'resize') {
      pushHistory(notesRef.current)
    }
  }, [xToTime, yToMidi, pushHistory])

  const onMouseLeave = useCallback(() => {
    const drag = dragRef.current
    if (!drag) return
    if (drag.type === 'box-select') {
      setSelectionRect(null)
      dragRef.current = null
    }
    if (drag.type === 'ruler-scrub') {
      dragRef.current = null
    }
  }, [])

  // Scroll con rueda
  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      setZoom(z => Math.max(20, Math.min(400, z * (e.deltaY < 0 ? 1.1 : 0.9))))
    } else {
      setScrollLeft(s => Math.max(0, s + e.deltaY / 3 / zoomRef.current * 10))
    }
  }, [])

  // ── Helpers UI ────────────────────────────────────────────────────────
  function fmtTime(s: number) {
    const m  = Math.floor(s / 60)
    const ss = (s % 60).toFixed(1)
    return `${m}:${ss.padStart(4, '0')}`
  }

  const zoomIn  = () => setZoom(z => Math.min(400, Math.round(z * 1.5)))
  const zoomOut = () => setZoom(z => Math.max(20,  Math.round(z / 1.5)))

  const lastSelected = selectedIdxs.length > 0 ? notes[selectedIdxs[selectedIdxs.length - 1]] : null

  // Cursor dinámico: col-resize cuando el mouse está sobre el playhead
  const [canvasCursor, setCanvasCursor] = useState('crosshair')
  const onMouseMoveForCursor = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragRef.current) return
    const { x } = getCanvasPos(e)
    const phX = timeToX(currentTime)
    setCanvasCursor(x > KEY_W && Math.abs(x - phX) <= 8 ? 'col-resize' : 'crosshair')
  }, [timeToX, currentTime])

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[#0a0a0f] text-white select-none">

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#12121e] border-b border-white/10 flex-wrap">
        <div className="flex gap-1">
          {(['select', 'draw'] as Tool[]).map(t => (
            <button key={t} onClick={() => setTool(t)}
              className={`px-3 py-1 rounded text-xs font-bold transition-colors ${tool === t ? 'bg-violet-600 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'}`}>
              {t === 'select' ? 'S — Mover' : 'D — Dibujar'}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-white/10" />

        <div className="flex items-center gap-1">
          <button onClick={zoomOut} className="w-6 h-6 rounded bg-white/10 hover:bg-white/20 text-sm">−</button>
          <span className="text-xs text-white/40 w-12 text-center">{zoom}px/s</span>
          <button onClick={zoomIn}  className="w-6 h-6 rounded bg-white/10 hover:bg-white/20 text-sm">+</button>
        </div>

        <div className="w-px h-5 bg-white/10" />

        <div className="flex items-center gap-1">
          <span className="text-xs text-white/40">BPM</span>
          <input type="number" min={40} max={300} value={bpm} onChange={e => setBpm(Number(e.target.value))}
            className="w-16 bg-black/30 border border-white/10 rounded px-2 py-0.5 text-sm text-white text-center focus:outline-none focus:border-violet-500" />
        </div>

        <div className="flex items-center gap-1">
          <span className="text-xs text-white/40">Offset</span>
          <input type="number" min={0} max={120} step={0.1} value={lyricsOffset} onChange={e => setLyricsOffset(Number(e.target.value))}
            className="w-16 bg-black/30 border border-white/10 rounded px-2 py-0.5 text-sm text-white text-center focus:outline-none focus:border-violet-500" />
          <span className="text-xs text-white/30">s</span>
        </div>

        <div className="w-px h-5 bg-white/10" />

        <button onClick={undo} disabled={history.length === 0}
          className="px-3 py-1 rounded text-xs font-bold bg-white/10 hover:bg-white/20 disabled:opacity-30 transition-colors">
          ↩ Ctrl+Z
        </button>

        <button onClick={() => setSelectedIdxs(notes.map((_, i) => i))}
          className="px-3 py-1 rounded text-xs font-bold bg-white/10 hover:bg-white/20 transition-colors">
          Ctrl+A
        </button>

        <div className="w-px h-5 bg-white/10" />

        {/* Dur × — escala la duración de todas las notas */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-white/40">Dur×</span>
          <input type="number" min={0.05} max={10} step={0.05} value={durScale}
            onChange={e => setDurScale(e.target.value)}
            className="w-14 bg-black/30 border border-white/10 rounded px-2 py-0.5 text-sm text-white text-center focus:outline-none focus:border-amber-500" />
          <button onClick={applyDurScale}
            className="px-2 py-1 rounded text-xs font-bold bg-amber-600/80 hover:bg-amber-500 transition-colors text-white">
            ↻ Todas
          </button>
          <button onClick={compactNotes}
            title="Encadena notas eliminando huecos. Notas de distinta línea conservan 0.25 s de pausa."
            className="px-2 py-1 rounded text-xs font-bold bg-amber-800/80 hover:bg-amber-700 transition-colors text-white">
            ⇒ Compactar
          </button>
        </div>

        {/* Shift — desplaza el startTime de todas las notas */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-white/40">Shift</span>
          <input type="number" step={0.1} value={timeShift}
            onChange={e => setTimeShift(e.target.value)}
            className="w-16 bg-black/30 border border-white/10 rounded px-2 py-0.5 text-sm text-white text-center focus:outline-none focus:border-amber-500" />
          <span className="text-xs text-white/30">s</span>
          <button onClick={applyTimeShift}
            className="px-2 py-1 rounded text-xs font-bold bg-amber-600/80 hover:bg-amber-500 transition-colors text-white">
            ↻ Todas
          </button>
        </div>

        <div className="flex-1" />

        {/* Sílaba de la nota seleccionada */}
        {lastSelected && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-white/40">Sílaba:</span>
            <input value={editSyllable} onChange={e => setEditSyllable(e.target.value)}
              onBlur={() => {
                const lastIdx = selectedIdxs[selectedIdxs.length - 1]
                if (lastIdx === undefined) return
                pushHistory(notes)
                setNotes(ns => { const u = [...ns]; u[lastIdx] = { ...u[lastIdx], syllable: editSyllable }; return u })
              }}
              className="w-20 bg-black/30 border border-violet-500/60 rounded px-2 py-0.5 text-sm text-white focus:outline-none focus:border-violet-400" />
          </div>
        )}

        {selectedIdxs.length > 1 && (
          <span className="text-xs text-violet-300/60">{selectedIdxs.length} seleccionadas</span>
        )}

        <button onClick={handleSave} disabled={saving}
          className={`px-4 py-1 rounded text-xs font-bold transition-colors ${savedOk ? 'bg-emerald-600 text-white' : 'bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50'}`}>
          {saving ? 'Guardando...' : savedOk ? '✓ Guardado' : 'Guardar'}
        </button>
      </div>

      {/* ── Canvas ──────────────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">
        <canvas ref={canvasRef} className="w-full h-full block"
          style={{ cursor: canvasCursor }}
          onMouseDown={onMouseDown}
          onMouseMove={e => { onMouseMove(e); onMouseMoveForCursor(e) }}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          onWheel={onWheel}
        />
      </div>

      {/* ── Player ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-[#12121e] border-t border-white/10">
        <audio ref={audioRef} src={song.audioUrl} preload="metadata" />

        <button onClick={togglePlay}
          className="w-8 h-8 rounded-full bg-violet-600 hover:bg-violet-500 flex items-center justify-center text-sm transition-colors">
          {isPlaying ? '⏸' : '▶'}
        </button>

        <span className="text-xs font-mono text-white/60 w-24">{fmtTime(currentTime)} / {fmtTime(duration)}</span>

        <div className="flex-1 h-2 bg-white/10 rounded-full cursor-pointer relative"
          onClick={e => { const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); seekTo((e.clientX - r.left) / r.width * duration) }}>
          <div className="h-full bg-violet-500 rounded-full" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
        </div>

        <span className="text-xs text-white/25 hidden sm:block">Scroll: rueda · Zoom: Ctrl+rueda · Arrastrar ruler = scrubbing</span>
      </div>

      {/* ── Sílabas ─────────────────────────────────────────────────── */}
      <div className="px-4 py-3 bg-[#0d0d18] border-t border-white/10">
        <div className="flex gap-2 items-start">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-white/40 font-bold">Letra / sílabas</span>
              <button onClick={() => setSyllables(splitSyllables(lyricsText))}
                className="px-2 py-0.5 rounded text-xs bg-cyan-700/60 hover:bg-cyan-600/60 text-white transition-colors">
                Auto-dividir
              </button>
              <span className="text-xs text-white/25">{notes.length} notas · {syllables.length} sílabas</span>
            </div>
            <textarea value={lyricsText} onChange={e => setLyricsText(e.target.value)}
              placeholder="Pega la letra aquí y presiona Auto-dividir..."
              rows={2}
              className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-violet-500 resize-none" />
          </div>

          <div className="flex flex-wrap gap-1 max-w-[50%] max-h-24 overflow-y-auto">
            {syllables.map((s, i) => (
              <span key={i} className={`px-1.5 py-0.5 rounded text-xs font-mono transition-colors ${
                i < notes.length ? 'bg-white/10 text-white/30'
                : i === nextSyllableIdx ? 'bg-violet-600 text-white ring-1 ring-violet-300'
                : 'bg-white/5 text-white/50'
              }`}>{s}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
