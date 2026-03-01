'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { use } from 'react'
import { useRouter } from 'next/navigation'
import usePartySocket from 'partysocket/react'
import { useGameStore } from '@/stores/gameStore'
import { Lobby } from '@/components/game/Lobby'
import { LyricDisplay } from '@/components/game/LyricDisplay'
import { ScoreBoard } from '@/components/game/ScoreBoard'
import { NoteGraph } from '@/components/game/NoteGraph'
import type { ClientMessage, ServerMessage, Song } from '@/lib/types'
import { getPartyHost } from '@/lib/partyHost'
import { SONGS_CATALOG } from '@/lib/songsCatalog'

const HOST_NAME = 'Host'
const PLAY_DURATION_MS = 63_000 // 1 minuto y 3 s, luego va a resultados

export default function HostPage({ params }: { params: Promise<{ roomCode: string }> }) {
  const { roomCode } = use(params)
  const router = useRouter()
  const { roomState, setRoomState, setIsHost } = useGameStore()
  const [songs, setSongs] = useState<Song[]>(SONGS_CATALOG)
  const audioRef = useRef<HTMLAudioElement>(null)
  const playingTimeStartRef = useRef(0)
  const accumulatedPlayingTimeRef = useRef(0)
  const endGameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const savedPausedAtRef = useRef<number>(0) // segundos donde se pausÃ³ (para reanudar audio)
  const prevPhaseRef = useRef<string>('')
  const restartRequestedRef = useRef(false)

  const socket = usePartySocket({
    host: getPartyHost(),
    room: roomCode,
    onOpen() {
      setIsHost(true)
      void loadSongs()
      const msg: ClientMessage = { type: 'JOIN', name: HOST_NAME, isHost: true }
      socket.send(JSON.stringify(msg))
    },
    onMessage(evt) {
      const msg: ServerMessage = JSON.parse(evt.data)
      if (msg.type === 'STATE') setRoomState(msg.state)
      if (msg.type === 'ROOM_CLOSED') router.push('/')
    },
  })

  const loadSongs = useCallback(async () => {
    try {
      const res = await fetch('/api/songs', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json() as { songs?: Song[] }
      if (Array.isArray(data.songs)) setSongs(data.songs)
    } catch {
      // Keep previous song list if catalog fetch fails.
    }
  }, [])

  // Reproducir / pausar audio segÃºn fase
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (!roomState?.currentSong) {
      audio.pause()
      return
    }
    const resolvedAudioUrl = new URL(roomState.currentSong.audioUrl, window.location.origin).toString()

    if (roomState.phase === 'PLAYING') {
      if (restartRequestedRef.current) {
        audio.currentTime = 0
        restartRequestedRef.current = false
        savedPausedAtRef.current = 0
      } else if (!audio.src || audio.src !== resolvedAudioUrl) {
        audio.src = resolvedAudioUrl
        audio.currentTime = 0
        savedPausedAtRef.current = 0
      } else if (savedPausedAtRef.current > 0) {
        audio.currentTime = savedPausedAtRef.current
        savedPausedAtRef.current = 0
      }
      audio.play().catch(console.error)
      audio.onended = () => {
        socket.send(JSON.stringify({ type: 'SONG_ENDED' } satisfies ClientMessage))
      }
    } else if (roomState.phase === 'PAUSED' && roomState.pausedAtSeconds != null) {
      savedPausedAtRef.current = roomState.pausedAtSeconds
      audio.pause()
    } else {
      audio.pause()
    }
  }, [roomState?.phase, roomState?.songStartTime, roomState?.currentSong?.audioUrl, roomState?.pausedAtSeconds, socket])

  // Timer 20 s: solo cuenta tiempo en PLAYING (no durante PAUSED)
  useEffect(() => {
    const phase = roomState?.phase ?? ''

    if (phase === 'PLAYING') {
      if (prevPhaseRef.current !== 'PAUSED') accumulatedPlayingTimeRef.current = 0
      prevPhaseRef.current = 'PLAYING'
      playingTimeStartRef.current = Date.now()
      endGameTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - playingTimeStartRef.current
        if (accumulatedPlayingTimeRef.current + elapsed >= PLAY_DURATION_MS) {
          if (endGameTimerRef.current) clearInterval(endGameTimerRef.current)
          endGameTimerRef.current = null
          socket.send(JSON.stringify({ type: 'SONG_ENDED' } satisfies ClientMessage))
        }
      }, 500)
      return () => {
        if (endGameTimerRef.current) clearInterval(endGameTimerRef.current)
        endGameTimerRef.current = null
      }
    }
    if (phase === 'PAUSED') {
      prevPhaseRef.current = 'PAUSED'
      accumulatedPlayingTimeRef.current += Date.now() - playingTimeStartRef.current
      if (endGameTimerRef.current) clearInterval(endGameTimerRef.current)
      endGameTimerRef.current = null
    }
    if (phase === 'RESULTS' || phase === 'LOBBY' || phase === 'COUNTDOWN') {
      prevPhaseRef.current = phase
      accumulatedPlayingTimeRef.current = 0
      if (endGameTimerRef.current) clearInterval(endGameTimerRef.current)
      endGameTimerRef.current = null
    }
  }, [roomState?.phase, socket])

  const handleStartGame = useCallback((song: Song) => {
    const msg: ClientMessage = { type: 'START_GAME', song }
    socket.send(JSON.stringify(msg))
  }, [socket])

  const handleRestart = useCallback(() => {
    restartRequestedRef.current = true
    socket.send(JSON.stringify({ type: 'RESTART_SONG' } satisfies ClientMessage))
  }, [socket])

  const handlePause = useCallback(() => {
    socket.send(JSON.stringify({ type: 'PAUSE' } satisfies ClientMessage))
  }, [socket])

  const handleResume = useCallback(() => {
    socket.send(JSON.stringify({ type: 'RESUME' } satisfies ClientMessage))
  }, [socket])

  const handleBackToLobby = useCallback(() => {
    socket.send(JSON.stringify({ type: 'BACK_TO_LOBBY' } satisfies ClientMessage))
  }, [socket])

  const handleCloseLobby = useCallback(() => {
    socket.send(JSON.stringify({ type: 'CLOSE_ROOM' } satisfies ClientMessage))
  }, [socket])


  if (!roomState) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-white/40">
        Conectando...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col overflow-hidden">
      <audio ref={audioRef} />

      {/* â”€â”€ LOBBY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {roomState.phase === 'LOBBY' && (
        <Lobby
          roomCode={roomCode}
          players={roomState.players}
          isHost={true}
          songs={songs}
          onStartGame={handleStartGame}
          onSongsChanged={loadSongs}
          onCloseLobby={handleCloseLobby}
        />
      )}

      {/* â”€â”€ COUNTDOWN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {roomState.phase === 'COUNTDOWN' && (
        <div className="flex-1 flex items-center justify-center">
          <div
            className="text-[20rem] font-black text-violet-400 leading-none animate-ping"
            style={{ fontFamily: 'system-ui, sans-serif' }}
          >
            {roomState.countdown}
          </div>
        </div>
      )}

      {/* â”€â”€ PLAYING / PAUSED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {(roomState.phase === 'PLAYING' || roomState.phase === 'PAUSED') && roomState.currentSong && (
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="flex justify-between items-center px-8 pt-6 pb-2">
            <div>
              <p className="text-white/40 text-sm">
                {roomState.phase === 'PAUSED' ? 'Pausado' : 'Tocando'}
              </p>
              <p className="font-bold text-xl">{roomState.currentSong.title}</p>
              <p className="text-white/40 text-sm">{roomState.currentSong.artist}</p>
            </div>
            <div className="flex items-center gap-3">
              {roomState.phase === 'PLAYING' ? (
                <button
                  onClick={handlePause}
                  className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-400 text-xs font-bold px-3 py-2 rounded-lg transition-all"
                >
                  â¸ Pausar
                </button>
              ) : (
                <button
                  onClick={handleResume}
                  className="bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-400 text-xs font-bold px-3 py-2 rounded-lg transition-all"
                >
                  â–¶ Reanudar
                </button>
              )}
              <button
                onClick={handleRestart}
                className="bg-white/10 hover:bg-amber-500/20 border border-white/10 hover:border-amber-500/50 text-white/60 hover:text-amber-400 text-xs font-bold px-3 py-2 rounded-lg transition-all"
              >
                â†º Reiniciar
              </button>
              <button
                onClick={handleBackToLobby}
                className="bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-300 text-xs font-bold px-3 py-2 rounded-lg transition-all"
              >
                Salir al lobby
              </button>
              <div className="bg-white/5 rounded-xl px-4 py-2 font-mono text-white/40 text-sm">
                {roomCode.toUpperCase()}
              </div>
            </div>
          </div>

          {/* Piano roll de notas */}
          <div className="px-8 py-2">
            <NoteGraph
              notes={roomState.currentSong.notes}
              songStartTime={roomState.songStartTime ?? 0}
              players={roomState.players}
              frozenTime={roomState.phase === 'PAUSED' ? (roomState.pausedAtSeconds ?? undefined) : undefined}
              lyricsOffset={roomState.currentSong.lyricsOffsetSeconds ?? 0}
            />
          </div>

          {/* Leyenda de jugadores */}
          <div className="flex gap-4 px-8 py-1">
            {roomState.players.filter(p => !p.isHost).map(p => (
              <div key={p.id} className="flex items-center gap-1.5 text-xs">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                <span style={{ color: p.color }}>{p.name}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 text-xs text-white/30 ml-2">
              <div className="w-2.5 h-0.5 bg-red-400 opacity-60" />
              <span>Desafinado</span>
            </div>
          </div>

          {/* Lyrics */}
          <div className="flex-1 flex items-center justify-center relative">
            {roomState.phase === 'PAUSED' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-10 rounded-xl">
                <span className="text-2xl font-bold text-white/90">Pausado</span>
              </div>
            )}
            <LiveLyrics
              notes={roomState.currentSong.notes}
              songStartTime={roomState.songStartTime ?? 0}
              pausedAtSeconds={roomState.phase === 'PAUSED' ? roomState.pausedAtSeconds ?? 0 : undefined}
              lyricsOffset={roomState.currentSong.lyricsOffsetSeconds ?? 0}
            />
          </div>

          {/* Scoreboard inferior */}
          <div className="px-8 pb-8">
            <ScoreBoard
              players={roomState.players.filter(p => !p.isHost)}
              showPitch
            />
          </div>
        </div>
      )}

      {/* â”€â”€ RESULTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {roomState.phase === 'RESULTS' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-8 p-8">
          <h2 className="text-5xl font-black" style={{ fontFamily: 'system-ui, sans-serif' }}>
            Resultados
          </h2>
          <div className="w-full max-w-md">
            <ScoreBoard players={roomState.players.filter(p => !p.isHost)} />
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleRestart}
              className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 font-bold py-3 px-6 rounded-xl transition-colors"
            >
              â†º Repetir canciÃ³n
            </button>
            <button
              onClick={handleBackToLobby}
              className="bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-300 font-bold py-3 px-6 rounded-xl transition-colors"
            >
              Salir al lobby
            </button>
            <button
              onClick={() => window.location.reload()}
              className="bg-violet-600 hover:bg-violet-500 text-white font-bold py-3 px-6 rounded-xl transition-colors"
            >
              Jugar otra vez
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function LiveLyrics({
  notes,
  songStartTime,
  pausedAtSeconds,
  lyricsOffset = 0,
}: {
  notes: Parameters<typeof LyricDisplay>[0]['notes']
  songStartTime: number
  pausedAtSeconds?: number
  lyricsOffset?: number
}) {
  const [adjustedTime, setAdjustedTime] = useState(() =>
    (Date.now() - songStartTime) / 1000 - lyricsOffset
  )
  useEffect(() => {
    if (pausedAtSeconds !== undefined) {
      setAdjustedTime(pausedAtSeconds - lyricsOffset)
      return
    }
    const id = setInterval(
      () => setAdjustedTime((Date.now() - songStartTime) / 1000 - lyricsOffset),
      50,
    )
    return () => clearInterval(id)
  }, [songStartTime, pausedAtSeconds, lyricsOffset])
  const displayTime = Math.max(0, adjustedTime)
  const isInIntro = adjustedTime < 0
  if (isInIntro) {
    return (
      <div className="flex items-center justify-center h-24 text-white/30">
        {adjustedTime > -5 ? (
          <span className="text-7xl font-black text-violet-400 tabular-nums">{Math.ceil(-adjustedTime)}</span>
        ) : (
          <span className="text-sm tracking-widest">♪</span>
        )}
      </div>
    )
  }
  return <LyricDisplay notes={notes} currentTime={displayTime} />
}

