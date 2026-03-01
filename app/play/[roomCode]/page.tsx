'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import usePartySocket from 'partysocket/react'
import { PitchDetector } from 'pitchy'
import { useGameStore } from '@/stores/gameStore'
import { LyricDisplay } from '@/components/game/LyricDisplay'
import { PitchMeter } from '@/components/game/PitchMeter'
import { evaluatePitch, getActiveNote, hzToMidi } from '@/lib/scoring'
import type { ClientMessage, RoomState, Player, ServerMessage } from '@/lib/types'
import { Mic, MicOff } from 'lucide-react'
import clsx from 'clsx'

export default function PlayerPage({ params }: { params: Promise<{ roomCode: string }> }) {
  const { roomCode } = use(params)
  const { roomState, setRoomState, localPlayerId, setLocalPlayerId, localHz, setLocalHz } = useGameStore()

  const [name, setName] = useState('')
  const [joined, setJoined] = useState(false)
  const [micActive, setMicActive] = useState(false)
  const [micError, setMicError] = useState('')

  // Refs para el audio pipeline
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const detectorRef = useRef<PitchDetector<Float32Array> | null>(null)
  const rafRef = useRef<number>(0)

  const socket = usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? 'localhost:1999',
    room: roomCode,
    onOpen() {
      setLocalPlayerId(socket.id)
    },
    onMessage(evt) {
      const msg: ServerMessage = JSON.parse(evt.data)
      if (msg.type === 'STATE') setRoomState(msg.state)
    },
  })

  // ── Micrófono ─────────────────────────────────────────────────────────

  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      const ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)

      const detector = PitchDetector.forFloat32Array(analyser.fftSize)
      const buffer = new Float32Array(detector.inputLength)

      audioCtxRef.current = ctx
      analyserRef.current = analyser
      detectorRef.current = detector

      setMicActive(true)
      setMicError('')

      function tick() {
        analyser.getFloatTimeDomainData(buffer)
        const [pitch, clarity] = detector.findPitch(buffer, ctx.sampleRate)

        // Solo enviar si hay suficiente claridad (voz detectada, no ruido)
        const hz = clarity > 0.85 && pitch > 60 && pitch < 1200 ? pitch : null
        setLocalHz(hz)

        // Enviar al servidor
        const msg: ClientMessage = { type: 'PITCH', hz, timestamp: Date.now() }
        socket.send(JSON.stringify(msg))

        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch {
      setMicError('No se pudo acceder al micrófono. Revisa los permisos.')
    }
  }, [socket, setLocalHz])

  const stopMic = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    setMicActive(false)
    setLocalHz(null)
  }, [setLocalHz])

  // Parar el mic cuando la canción termine
  useEffect(() => {
    if (roomState?.phase === 'RESULTS') stopMic()
  }, [roomState?.phase, stopMic])

  useEffect(() => {
    return () => { cancelAnimationFrame(rafRef.current); audioCtxRef.current?.close() }
  }, [])

  // ── Join ──────────────────────────────────────────────────────────────

  function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    const msg: ClientMessage = { type: 'JOIN', name: name.trim(), isHost: false }
    socket.send(JSON.stringify(msg))
    setJoined(true)
  }

  // ── Derivados ─────────────────────────────────────────────────────────

  const localPlayer = roomState?.players.find(p => p.id === localPlayerId)
  const currentTime = roomState?.songStartTime
    ? (Date.now() - roomState.songStartTime) / 1000
    : 0
  const activeNote = roomState?.currentSong
    ? getActiveNote(roomState.currentSong.notes, currentTime)
    : null
  const playerMidi = localHz ? hzToMidi(localHz) : null
  const { accuracy } = evaluatePitch(playerMidi, activeNote)

  // ── Render ─────────────────────────────────────────────────────────────

  // Pantalla de nombre
  if (!joined) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col items-center justify-center p-8 gap-6">
        <h1 className="text-4xl font-black text-violet-400">
          Karaoke<span className="text-white">IT</span>
        </h1>
        <p className="text-white/40">Sala: <span className="font-mono text-white">{roomCode.toUpperCase()}</span></p>
        <form onSubmit={handleJoin} className="flex flex-col gap-4 w-full max-w-sm">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Tu nombre"
            maxLength={20}
            autoFocus
            className="bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-lg text-center text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500"
          />
          <button
            type="submit"
            className="bg-violet-600 hover:bg-violet-500 text-white font-bold py-3 rounded-xl text-lg transition-colors"
          >
            Unirme
          </button>
        </form>
      </div>
    )
  }

  // Lobby
  if (roomState?.phase === 'LOBBY') {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col items-center justify-center p-8 gap-6">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-black"
          style={{ backgroundColor: localPlayer?.color ?? '#7c3aed' }}
        >
          {name.charAt(0).toUpperCase()}
        </div>
        <p className="text-xl font-bold">{name}</p>
        <p className="text-white/40 text-center">Esperando que el host<br />inicie el juego...</p>

        {/* Lista de jugadores en sala */}
        <div className="flex flex-col gap-2 mt-4">
          {roomState.players.filter(p => !p.isHost).map(p => (
            <div key={p.id} className="flex items-center gap-3 text-sm text-white/60">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
              {p.name}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Countdown
  if (roomState?.phase === 'COUNTDOWN') {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col items-center justify-center gap-6">
        <p className="text-white/40">¡Prepárate!</p>
        <div className="text-[8rem] font-black text-violet-400 leading-none">
          {roomState.countdown}
        </div>
        {!micActive && (
          <button
            onClick={startMic}
            className="bg-cyan-600 hover:bg-cyan-500 text-black font-bold py-3 px-6 rounded-xl flex items-center gap-2"
          >
            <Mic size={18} /> Activar micrófono
          </button>
        )}
      </div>
    )
  }

  // Playing
  if (roomState?.phase === 'PLAYING' && roomState.currentSong) {
    return (
      <LivePlayerView
        roomState={roomState}
        localPlayer={localPlayer ?? null}
        micActive={micActive}
        micError={micError}
        localHz={localHz}
        playerMidi={playerMidi}
        activeNoteMidi={activeNote?.pitch ?? null}
        accuracy={accuracy}
        onStartMic={startMic}
        onStopMic={stopMic}
      />
    )
  }

  // Results
  if (roomState?.phase === 'RESULTS') {
    const sorted = [...(roomState?.players.filter(p => !p.isHost) ?? [])].sort((a, b) => b.score - a.score)
    const myRank = sorted.findIndex(p => p.id === localPlayerId) + 1
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col items-center justify-center p-8 gap-6">
        <p className="text-white/40 text-sm">Tu resultado</p>
        <div
          className="text-7xl font-black"
          style={{ color: localPlayer?.color ?? '#7c3aed' }}
        >
          #{myRank}
        </div>
        <p className="text-2xl font-bold">{localPlayer?.score.toLocaleString()} pts</p>
        <div className="flex flex-col gap-2 mt-4 w-full max-w-xs">
          {sorted.map((p, i) => (
            <div
              key={p.id}
              className={clsx(
                'flex justify-between items-center px-4 py-2 rounded-lg text-sm',
                p.id === localPlayerId ? 'bg-white/10' : 'bg-white/5'
              )}
            >
              <span className="text-white/40">#{i + 1}</span>
              <span style={{ color: p.color }}>{p.name}</span>
              <span className="font-mono">{p.score.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-white/40">
      Conectando...
    </div>
  )
}

// ── Vista durante la canción (se actualiza 20fps) ──────────────────────────

function LivePlayerView({
  roomState, localPlayer, micActive, micError, localHz,
  playerMidi, activeNoteMidi, accuracy, onStartMic, onStopMic,
}: {
  roomState: RoomState
  localPlayer: Player | null
  micActive: boolean
  micError: string
  localHz: number | null
  playerMidi: number | null
  activeNoteMidi: number | null
  accuracy: ReturnType<typeof evaluatePitch>['accuracy']
  onStartMic: () => void
  onStopMic: () => void
}) {
  const [currentTime, setCurrentTime] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      if (roomState.songStartTime) {
        setCurrentTime((Date.now() - roomState.songStartTime) / 1000)
      }
    }, 50)
    return () => clearInterval(id)
  }, [roomState.songStartTime])

  const accuracyColors = {
    PERFECT: 'text-emerald-400',
    GOOD: 'text-cyan-400',
    OK: 'text-amber-400',
    MISS: 'text-white/20',
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
      {/* Score y mic button */}
      <div className="flex justify-between items-center px-4 pt-4 pb-2">
        <div>
          <p className="text-white/40 text-xs">Puntos</p>
          <p className="font-mono font-bold text-xl" style={{ color: localPlayer?.color }}>
            {localPlayer?.score.toLocaleString() ?? 0}
          </p>
        </div>

        <button
          onClick={micActive ? onStopMic : onStartMic}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-colors',
            micActive
              ? 'bg-emerald-600/20 border border-emerald-500/50 text-emerald-400'
              : 'bg-white/10 border border-white/20 text-white/60'
          )}
        >
          {micActive ? <Mic size={14} /> : <MicOff size={14} />}
          {micActive ? 'Mic ON' : 'Mic OFF'}
        </button>
      </div>

      {micError && (
        <p className="text-red-400 text-xs text-center px-4">{micError}</p>
      )}

      {/* Lyrics */}
      <div className="flex-1 flex items-center justify-center py-4">
        <LyricDisplay
          notes={roomState.currentSong!.notes}
          currentTime={currentTime}
          compact
        />
      </div>

      {/* Pitch meter + accuracy */}
      <div className="flex flex-col items-center gap-3 px-8 pb-8">
        <p className={clsx('text-sm font-bold tracking-widest uppercase transition-colors', accuracyColors[accuracy])}>
          {micActive && localHz
            ? accuracy === 'MISS' ? 'Desafinado' : accuracy === 'OK' ? '¡Cerca!' : accuracy === 'GOOD' ? '¡Bien!' : '¡Perfecto!'
            : 'Canta...'}
        </p>

        {/* Barra horizontal de pitch */}
        <div className="w-full h-14 bg-white/5 rounded-2xl relative overflow-hidden border border-white/10">
          {/* Zona objetivo */}
          {activeNoteMidi && (
            <div
              className="absolute top-0 bottom-0 opacity-30 transition-all duration-200"
              style={{
                left: '35%',
                right: '35%',
                backgroundColor: localPlayer?.color ?? '#7c3aed',
              }}
            />
          )}
          {/* Nota objetivo */}
          {activeNoteMidi && (
            <div className="absolute top-0 bottom-0 w-1 bg-white/60" style={{ left: '50%', transform: 'translateX(-50%)' }} />
          )}
          {/* Voz del jugador */}
          {playerMidi && activeNoteMidi && (
            <div
              className="absolute top-2 bottom-2 w-8 rounded-xl transition-all duration-75"
              style={{
                left: `calc(50% + ${Math.max(-45, Math.min(45, (playerMidi - activeNoteMidi) * 8))}%)`,
                transform: 'translateX(-50%)',
                backgroundColor: { PERFECT: '#10b981', GOOD: '#06b6d4', OK: '#f59e0b', MISS: '#ef4444' }[accuracy],
                boxShadow: `0 0 12px ${{ PERFECT: '#10b981', GOOD: '#06b6d4', OK: '#f59e0b', MISS: '#ef4444' }[accuracy]}`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
