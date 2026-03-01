'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { use } from 'react'
import usePartySocket from 'partysocket/react'
import { useGameStore } from '@/stores/gameStore'
import { Lobby } from '@/components/game/Lobby'
import { LyricDisplay } from '@/components/game/LyricDisplay'
import { ScoreBoard } from '@/components/game/ScoreBoard'
import type { ClientMessage, ServerMessage, Song } from '@/lib/types'

const HOST_NAME = 'Host'

export default function HostPage({ params }: { params: Promise<{ roomCode: string }> }) {
  const { roomCode } = use(params)
  const { roomState, setRoomState, isHost, setIsHost } = useGameStore()
  const audioRef = useRef<HTMLAudioElement>(null)
  const songStartedRef = useRef(false)

  const socket = usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? 'localhost:1999',
    room: roomCode,
    onOpen() {
      setIsHost(true)
      const msg: ClientMessage = { type: 'JOIN', name: HOST_NAME, isHost: true }
      socket.send(JSON.stringify(msg))
    },
    onMessage(evt) {
      const msg: ServerMessage = JSON.parse(evt.data)
      if (msg.type === 'STATE') setRoomState(msg.state)
    },
  })

  // Cuando el juego pasa a PLAYING, reproducir el audio
  useEffect(() => {
    if (roomState?.phase === 'PLAYING' && roomState.currentSong && !songStartedRef.current) {
      songStartedRef.current = true
      const audio = audioRef.current
      if (audio) {
        audio.src = roomState.currentSong.audioUrl
        audio.play().catch(console.error)
        audio.onended = () => {
          const msg: ClientMessage = { type: 'SONG_ENDED' }
          socket.send(JSON.stringify(msg))
          songStartedRef.current = false
        }
      }
    }
    if (roomState?.phase !== 'PLAYING') {
      songStartedRef.current = false
    }
  }, [roomState?.phase, roomState?.currentSong, socket])

  const handleStartGame = useCallback((song: Song) => {
    const msg: ClientMessage = { type: 'START_GAME', song }
    socket.send(JSON.stringify(msg))
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

      {/* ── LOBBY ────────────────────────────────────────── */}
      {roomState.phase === 'LOBBY' && (
        <Lobby
          roomCode={roomCode}
          players={roomState.players}
          isHost={true}
          onStartGame={handleStartGame}
        />
      )}

      {/* ── COUNTDOWN ────────────────────────────────────── */}
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

      {/* ── PLAYING ──────────────────────────────────────── */}
      {roomState.phase === 'PLAYING' && roomState.currentSong && (
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="flex justify-between items-center px-8 pt-6 pb-2">
            <div>
              <p className="text-white/40 text-sm">Tocando</p>
              <p className="font-bold text-xl">{roomState.currentSong.title}</p>
              <p className="text-white/40 text-sm">{roomState.currentSong.artist}</p>
            </div>
            <div className="bg-white/5 rounded-xl px-4 py-2 font-mono text-white/40 text-sm">
              {roomCode.toUpperCase()}
            </div>
          </div>

          {/* Lyrics — zona principal */}
          <div className="flex-1 flex items-center justify-center">
            <LiveLyrics
              notes={roomState.currentSong.notes}
              songStartTime={roomState.songStartTime!}
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

      {/* ── RESULTS ──────────────────────────────────────── */}
      {roomState.phase === 'RESULTS' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-8 p-8">
          <h2 className="text-5xl font-black" style={{ fontFamily: 'system-ui, sans-serif' }}>
            Resultados
          </h2>
          <div className="w-full max-w-md">
            <ScoreBoard players={roomState.players.filter(p => !p.isHost)} />
          </div>
          <button
            onClick={() => {
              const msg: ClientMessage = { type: 'JOIN', name: HOST_NAME, isHost: true }
              socket.send(JSON.stringify(msg))
              // Volver al lobby recargando
              window.location.reload()
            }}
            className="bg-violet-600 hover:bg-violet-500 text-white font-bold py-3 px-8 rounded-xl transition-colors"
          >
            Jugar otra vez
          </button>
        </div>
      )}
    </div>
  )
}

function LiveLyrics({ notes, songStartTime }: { notes: Parameters<typeof LyricDisplay>[0]['notes']; songStartTime: number }) {
  const [t, setT] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setT((Date.now() - songStartTime) / 1000), 50)
    return () => clearInterval(id)
  }, [songStartTime])
  return <LyricDisplay notes={notes} currentTime={t} />
}
