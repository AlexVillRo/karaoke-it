'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import usePartySocket from 'partysocket/react'
import { PitchDetector } from 'pitchy'
import { useGameStore } from '@/stores/gameStore'
import { LyricDisplay } from '@/components/game/LyricDisplay'
import { evaluatePitch, getActiveNote, hzToMidi } from '@/lib/scoring'
import type { ClientMessage, RoomState, Player, ServerMessage } from '@/lib/types'
import { getPartyHost } from '@/lib/partyHost'
import { Mic, MicOff, WifiOff } from 'lucide-react'
import clsx from 'clsx'

export default function PlayerPage({ params }: { params: Promise<{ roomCode: string }> }) {
  const { roomCode } = use(params)
  const { roomState, setRoomState, localPlayerId, setLocalPlayerId, localHz, setLocalHz } = useGameStore()

  const [name, setName] = useState('')
  const [joined, setJoined] = useState(false)
  const [micActive, setMicActive] = useState(false)
  const [micError, setMicError] = useState('')
  const [wsConnected, setWsConnected] = useState(false)

  // Refs para acceder a valores actuales dentro de callbacks del socket (evita closures stale)
  const nameRef  = useRef('')
  const joinedRef = useRef(false)
  useEffect(() => { nameRef.current = name },   [name])
  useEffect(() => { joinedRef.current = joined }, [joined])

  // Refs para el audio pipeline
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef      = useRef<number>(0)

  const socket = usePartySocket({
    host: getPartyHost(),
    room: roomCode,
    onOpen() {
      setWsConnected(true)
      setLocalPlayerId(socket.id)
      // Re-enviar JOIN en cada reconexión para que el servidor registre al jugador
      if (joinedRef.current && nameRef.current) {
        const msg: ClientMessage = { type: 'JOIN', name: nameRef.current, isHost: false }
        socket.send(JSON.stringify(msg))
      }
    },
    onClose() {
      setWsConnected(false)
    },
    onMessage(evt) {
      const msg: ServerMessage = JSON.parse(evt.data)
      if (msg.type === 'STATE') setRoomState(msg.state)
    },
  })

  // ── Micrófono ─────────────────────────────────────────────────────────

  const startMic = useCallback(async () => {
    // iOS Safari (y cualquier navegador) bloquea getUserMedia en contextos no seguros (HTTP sobre IP)
    if (!window.isSecureContext) {
      setMicError(
        'Tu navegador requiere HTTPS para usar el micrófono. ' +
        'Pídele al host la URL segura (ngrok) o conéctate desde localhost.'
      )
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('Este navegador no soporta acceso al micrófono.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      const ctx    = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)

      const detector = PitchDetector.forFloat32Array(analyser.fftSize)
      const buffer   = new Float32Array(detector.inputLength)

      audioCtxRef.current = ctx
      setMicActive(true)
      setMicError('')

      function tick() {
        analyser.getFloatTimeDomainData(buffer)
        const [pitch, clarity] = detector.findPitch(buffer, ctx.sampleRate)
        const hz = clarity > 0.85 && pitch > 60 && pitch < 1200 ? pitch : null
        setLocalHz(hz)
        socket.send(JSON.stringify({ type: 'PITCH', hz, timestamp: Date.now() } satisfies ClientMessage))
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)

    } catch (err) {
      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError') {
          setMicError('Permiso denegado. Ve a Ajustes > Safari > Micrófono y actívalo para este sitio.')
        } else if (err.name === 'NotFoundError') {
          setMicError('No se encontró micrófono en este dispositivo.')
        } else {
          setMicError(`Error de micrófono: ${err.message}`)
        }
      } else {
        setMicError('No se pudo acceder al micrófono.')
      }
    }
  }, [socket, setLocalHz])

  const stopMic = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    setMicActive(false)
    setLocalHz(null)
  }, [setLocalHz])

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
  const currentTime = roomState?.songStartTime ? (Date.now() - roomState.songStartTime) / 1000 : 0
  const activeNote  = roomState?.currentSong ? getActiveNote(roomState.currentSong.notes, currentTime) : null
  const playerMidi  = localHz ? hzToMidi(localHz) : null
  const { accuracy } = evaluatePitch(playerMidi, activeNote)

  // ── Render ─────────────────────────────────────────────────────────────

  if (!joined) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col items-center justify-center p-8 gap-6">
        <h1 className="text-4xl font-black text-violet-400">
          Karaoke<span className="text-white">IT</span>
        </h1>
        <p className="text-white/40">
          Sala: <span className="font-mono text-white">{roomCode.toUpperCase()}</span>
        </p>

        {/* Indicador de conexión WS */}
        <div className={clsx(
          'flex items-center gap-2 text-xs px-3 py-1 rounded-full',
          wsConnected ? 'text-emerald-400 bg-emerald-400/10' : 'text-white/30 bg-white/5'
        )}>
          <div className={clsx('w-1.5 h-1.5 rounded-full', wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-white/20')} />
          {wsConnected ? 'Conectado' : 'Conectando al servidor...'}
        </div>

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
            disabled={!wsConnected}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl text-lg transition-colors"
          >
            Unirme
          </button>
        </form>
      </div>
    )
  }

  // ── Lobby ─────────────────────────────────────────────────────────────

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

        {/* Aviso HTTPS si el mic no estará disponible */}
        {!window.isSecureContext && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-center max-w-xs">
            <p className="text-amber-400 text-xs font-bold mb-1">⚠ Micrófono no disponible</p>
            <p className="text-amber-400/70 text-xs">
              Para usar el mic desde iPhone, el host necesita compartir una URL HTTPS (usa ngrok).
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 mt-4">
          {roomState.players.filter(p => !p.isHost).map(p => (
            <div key={p.id} className="flex items-center gap-3 text-sm text-white/60">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
              {p.name}
              {!p.connected && <span className="text-white/20 text-xs">(desconectado)</span>}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Countdown ─────────────────────────────────────────────────────────

  if (roomState?.phase === 'COUNTDOWN') {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col items-center justify-center gap-6">
        <p className="text-white/40">¡Prepárate!</p>
        <div className="text-[8rem] font-black text-violet-400 leading-none">
          {roomState.countdown}
        </div>
        {!micActive && window.isSecureContext && (
          <button
            onClick={startMic}
            className="bg-cyan-600 hover:bg-cyan-500 text-black font-bold py-3 px-6 rounded-xl flex items-center gap-2"
          >
            <Mic size={18} /> Activar micrófono
          </button>
        )}
        {micError && <p className="text-red-400 text-xs text-center max-w-xs px-4">{micError}</p>}
      </div>
    )
  }

  // ── Playing ───────────────────────────────────────────────────────────

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

  // ── Results ───────────────────────────────────────────────────────────

  if (roomState?.phase === 'RESULTS') {
    const sorted  = [...(roomState.players.filter(p => !p.isHost))].sort((a, b) => b.score - a.score)
    const myRank  = sorted.findIndex(p => p.id === localPlayerId) + 1
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col items-center justify-center p-8 gap-6">
        <p className="text-white/40 text-sm">Tu resultado</p>
        <div className="text-7xl font-black" style={{ color: localPlayer?.color ?? '#7c3aed' }}>
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

  // ── Fallback: joined pero roomState aún no llegó ───────────────────────

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center gap-4 text-white/40">
      {wsConnected
        ? <><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /><p className="text-sm">Sincronizando sala...</p></>
        : <><WifiOff size={32} className="text-white/20" /><p className="text-sm">Sin conexión al servidor</p><p className="text-xs text-white/20">Verifica que el host esté corriendo</p></>
      }
    </div>
  )
}

// ── Vista durante la canción ───────────────────────────────────────────────

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
      if (roomState.songStartTime) setCurrentTime((Date.now() - roomState.songStartTime) / 1000)
    }, 50)
    return () => clearInterval(id)
  }, [roomState.songStartTime])

  const accuracyColors = { PERFECT: 'text-emerald-400', GOOD: 'text-cyan-400', OK: 'text-amber-400', MISS: 'text-white/20' }
  const accuracyBg     = { PERFECT: '#10b981', GOOD: '#06b6d4', OK: '#f59e0b', MISS: '#ef4444' }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
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
        <p className="text-amber-400 text-xs text-center px-6 pb-2 leading-relaxed">{micError}</p>
      )}

      <div className="flex-1 flex items-center justify-center py-4">
        <LyricDisplay notes={roomState.currentSong!.notes} currentTime={currentTime} compact />
      </div>

      <div className="flex flex-col items-center gap-3 px-8 pb-8">
        <p className={clsx('text-sm font-bold tracking-widest uppercase transition-colors', accuracyColors[accuracy])}>
          {micActive && localHz
            ? ({ PERFECT: '¡Perfecto!', GOOD: '¡Bien!', OK: '¡Cerca!', MISS: 'Desafinado' })[accuracy]
            : 'Canta...'}
        </p>

        <div className="w-full h-14 bg-white/5 rounded-2xl relative overflow-hidden border border-white/10">
          {activeNoteMidi && (
            <div className="absolute top-0 bottom-0 opacity-25" style={{ left: '35%', right: '35%', backgroundColor: localPlayer?.color ?? '#7c3aed' }} />
          )}
          {activeNoteMidi && (
            <div className="absolute top-0 bottom-0 w-0.5 bg-white/50" style={{ left: '50%', transform: 'translateX(-50%)' }} />
          )}
          {playerMidi && activeNoteMidi && (
            <div
              className="absolute top-2 bottom-2 w-8 rounded-xl transition-all duration-75"
              style={{
                left: `calc(50% + ${Math.max(-45, Math.min(45, (playerMidi - activeNoteMidi) * 8))}%)`,
                transform: 'translateX(-50%)',
                backgroundColor: accuracyBg[accuracy],
                boxShadow: `0 0 12px ${accuracyBg[accuracy]}`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
