'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
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
  const router = useRouter()
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
  const rafRef = useRef<number>(0)
  const visibilityCleanupRef = useRef<(() => void) | null>(null)

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
      if (msg.type === 'ROOM_CLOSED') router.push('/')
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

      // Reanudar AudioContext si el navegador lo suspendió (p. ej. al cambiar de pestaña)
      const resumeIfSuspended = () => {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      }
      document.addEventListener('visibilitychange', resumeIfSuspended)

      function tick() {
        resumeIfSuspended()
        if (ctx.state !== 'running') {
          rafRef.current = requestAnimationFrame(tick)
          return
        }
        analyser.getFloatTimeDomainData(buffer)
        const [pitch, clarity] = detector.findPitch(buffer, ctx.sampleRate)
        const hz = clarity > 0.85 && pitch > 60 && pitch < 1200 ? pitch : null
        setLocalHz(hz)
        socket.send(JSON.stringify({ type: 'PITCH', hz, timestamp: Date.now() } satisfies ClientMessage))
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)

      visibilityCleanupRef.current = () => {
        document.removeEventListener('visibilitychange', resumeIfSuspended)
      }
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
    visibilityCleanupRef.current?.()
    visibilityCleanupRef.current = null
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

  const handleBackToLobby = useCallback(() => {
    socket.send(JSON.stringify({ type: 'BACK_TO_LOBBY' } satisfies ClientMessage))
  }, [socket])

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

  if ((roomState?.phase === 'PLAYING' || roomState?.phase === 'PAUSED') && roomState.currentSong) {
    const currentTime = roomState.phase === 'PAUSED' && roomState.pausedAtSeconds != null
      ? roomState.pausedAtSeconds
      : (roomState.songStartTime ? (Date.now() - roomState.songStartTime) / 1000 : 0)
    const activeNotePaused = roomState.currentSong ? getActiveNote(roomState.currentSong.notes, currentTime) : null
    return (
      <LivePlayerView
        roomState={roomState}
        localPlayer={localPlayer ?? null}
        micActive={micActive}
        micError={micError}
        localHz={localHz}
        playerMidi={playerMidi}
        activeNoteMidi={(roomState.phase === 'PAUSED' ? activeNotePaused : activeNote)?.pitch ?? null}
        accuracy={accuracy}
        onStartMic={startMic}
        onStopMic={stopMic}
        onBackToLobby={handleBackToLobby}
        isPaused={roomState.phase === 'PAUSED'}
      />
    )
  }

  // ── Results ───────────────────────────────────────────────────────────

  if (roomState?.phase === 'RESULTS') {
    const sorted = [...(roomState.players.filter(p => !p.isHost))].sort((a, b) => b.score - a.score)
    const myRank = sorted.findIndex(p => p.id === localPlayerId) + 1
    const [first, second, third] = sorted
    const rest = sorted.slice(3)
    const rankLabel = ['1er lugar', '2do lugar', '3er lugar']
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col items-center justify-center p-6 gap-8">
        <div className="text-center">
          <p className="text-white/40 text-sm uppercase tracking-widest">Resultados</p>
          {myRank > 0 && (
            <p className="text-lg font-bold mt-1" style={{ color: localPlayer?.color }}>
              {rankLabel[myRank - 1] ?? `#${myRank}`}
            </p>
          )}
        </div>

        {/* Podio: 2do | 1ro | 3ro */}
        <div className="flex items-end gap-2 w-full max-w-xs justify-center">
          {[
            { player: second, rank: 2, blockH: 80 },
            { player: first,  rank: 1, blockH: 116 },
            { player: third,  rank: 3, blockH: 56 },
          ].map(({ player, rank, blockH }) =>
            player ? (
              <div key={player.id} className="flex flex-col items-center gap-1 flex-1">
                {/* Avatar */}
                <div
                  className={clsx(
                    'w-12 h-12 rounded-full flex items-center justify-center text-lg font-black shrink-0',
                    player.id === localPlayerId && 'ring-2 ring-white ring-offset-2 ring-offset-[#0a0a0f]'
                  )}
                  style={{ backgroundColor: player.color }}
                >
                  {player.name.charAt(0).toUpperCase()}
                </div>
                {/* Nombre */}
                <p className="text-xs font-bold text-center w-full truncate px-1">
                  {player.name}
                </p>
                {/* Puntos */}
                <p className="text-[10px] text-white/50 font-mono leading-none mb-1">
                  {player.score.toLocaleString()}
                </p>
                {/* Bloque del podio */}
                <div
                  className="w-full rounded-t-xl flex items-center justify-center font-black text-2xl"
                  style={{
                    height: blockH,
                    backgroundColor: player.color + '22',
                    borderTop: `3px solid ${player.color}`,
                    borderLeft: `1px solid ${player.color}44`,
                    borderRight: `1px solid ${player.color}44`,
                    color: player.color,
                  }}
                >
                  {rank}
                </div>
              </div>
            ) : (
              <div key={rank} className="flex-1" />
            )
          )}
        </div>

        {/* 4to en adelante */}
        {rest.length > 0 && (
          <div className="flex flex-col gap-2 w-full max-w-xs">
            {rest.map((p, i) => (
              <div
                key={p.id}
                className={clsx(
                  'flex items-center gap-3 px-4 py-2 rounded-xl text-sm',
                  p.id === localPlayerId ? 'bg-white/10 border border-white/20' : 'bg-white/5'
                )}
              >
                <span className="text-white/40 w-4 shrink-0">#{i + 4}</span>
                <span style={{ color: p.color }} className="font-bold flex-1 truncate">{p.name}</span>
                <span className="font-mono text-xs">{p.score.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
        <HoldToLobbyButton onConfirm={handleBackToLobby} />
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
  playerMidi, activeNoteMidi, accuracy, onStartMic, onStopMic, onBackToLobby, isPaused,
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
  onBackToLobby: () => void
  isPaused?: boolean
}) {
  const lyricsOffset = roomState.currentSong?.lyricsOffsetSeconds ?? 0
  const [adjustedTime, setAdjustedTime] = useState(() =>
    roomState.songStartTime
      ? (Date.now() - roomState.songStartTime) / 1000 - lyricsOffset
      : -lyricsOffset
  )

  useEffect(() => {
    if (isPaused && roomState.pausedAtSeconds != null) {
      setAdjustedTime(roomState.pausedAtSeconds - lyricsOffset)
      return
    }
    const id = setInterval(() => {
      if (roomState.songStartTime)
        setAdjustedTime((Date.now() - roomState.songStartTime) / 1000 - lyricsOffset)
    }, 50)
    return () => clearInterval(id)
  }, [roomState.songStartTime, isPaused, roomState.pausedAtSeconds, lyricsOffset])

  const isInIntro = adjustedTime < 0
  const displayTime = Math.max(0, adjustedTime)

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

      <div className="flex-1 flex items-center justify-center py-4 relative">
        {isPaused && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-10">
            <span className="text-xl font-bold text-white/90">Pausado</span>
          </div>
        )}
        {isInIntro ? (
          <div className="flex flex-col items-center gap-2 text-white/30">
            <p className="text-sm tracking-widest">♪</p>
            {adjustedTime > -5 && (
              <p className="text-6xl font-black text-violet-400 tabular-nums">{Math.ceil(-adjustedTime)}</p>
            )}
          </div>
        ) : (
          <LyricDisplay notes={roomState.currentSong!.notes} currentTime={displayTime} compact />
        )}
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
        <HoldToLobbyButton onConfirm={onBackToLobby} />
      </div>
    </div>
  )
}

function HoldToLobbyButton({ onConfirm }: { onConfirm: () => void }) {
  const HOLD_MS = 1200
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [holding, setHolding] = useState(false)
  const [progress, setProgress] = useState(0)

  const clearHold = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setHolding(false)
    setProgress(0)
  }, [])

  const startHold = useCallback(() => {
    if (timerRef.current) return
    setHolding(true)
    const start = Date.now()
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - start
      const pct = Math.min(1, elapsed / HOLD_MS)
      setProgress(pct)
      if (pct >= 1) {
        clearHold()
        onConfirm()
      }
    }, 30)
  }, [clearHold, onConfirm])

  useEffect(() => clearHold, [clearHold])

  return (
    <button
      type="button"
      onMouseDown={startHold}
      onMouseUp={clearHold}
      onMouseLeave={clearHold}
      onTouchStart={startHold}
      onTouchEnd={clearHold}
      onTouchCancel={clearHold}
      className="w-full max-w-xs relative overflow-hidden border border-red-500/40 rounded-xl px-4 py-3 text-sm font-bold text-red-300 bg-red-500/10"
    >
      <span
        className="absolute inset-y-0 left-0 bg-red-500/30"
        style={{ width: `${Math.round(progress * 100)}%`, transition: holding ? 'none' : 'width 120ms ease-out' }}
      />
      <span className="relative z-10">
        {holding ? 'Sigue presionando...' : 'Mantener oprimido para salir al lobby'}
      </span>
    </button>
  )
}
