'use client'

import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import type { Player, Song } from '@/lib/types'

interface Props {
  roomCode: string
  players: Player[]
  isHost: boolean
  onStartGame: (song: Song) => void
}

export function Lobby({ roomCode, players, isHost, onStartGame }: Props) {
  const [qrUrl, setQrUrl] = useState('')

  // La URL que los jugadores deben visitar
  const joinUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/play/${roomCode}`
    : ''

  useEffect(() => {
    if (!joinUrl) return
    // QR generado por qr-server.com (sin dependencia extra)
    setQrUrl(`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(joinUrl)}`)
  }, [joinUrl])

  const connectedPlayers = players.filter(p => p.connected && !p.isHost)

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 p-8">
      <div className="text-center">
        <h1 className="text-6xl font-black tracking-tight" style={{ fontFamily: "'Syne', sans-serif" }}>
          Karaoke<span className="text-violet-400">IT</span>
        </h1>
        <p className="text-white/40 mt-2">Sala de espera</p>
      </div>

      <div className="flex gap-12 items-start">
        {/* QR Code */}
        <div className="flex flex-col items-center gap-3">
          <div className="bg-white p-3 rounded-2xl">
            {qrUrl && <img src={qrUrl} alt="QR" width={180} height={180} />}
          </div>
          <p className="text-white/50 text-sm text-center">
            Escanea para unirte
          </p>
          <div className="bg-white/10 px-4 py-2 rounded-lg font-mono text-xl tracking-widest text-white">
            {roomCode.toUpperCase()}
          </div>
        </div>

        {/* Players */}
        <div className="flex flex-col gap-4 min-w-[200px]">
          <div className="flex items-center gap-2 text-white/50 text-sm">
            <Users size={14} />
            <span>{connectedPlayers.length} jugador{connectedPlayers.length !== 1 ? 'es' : ''}</span>
          </div>

          <div className="flex flex-col gap-2">
            {connectedPlayers.map(p => (
              <div
                key={p.id}
                className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3 border border-white/10"
              >
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: p.color, boxShadow: `0 0 8px ${p.color}` }}
                />
                <span className="font-bold text-white">{p.name}</span>
              </div>
            ))}

            {connectedPlayers.length === 0 && (
              <p className="text-white/30 text-sm">Esperando jugadores...</p>
            )}
          </div>

          {isHost && connectedPlayers.length > 0 && (
            <button
              onClick={() => {
                // Por ahora siempre usa la canción demo
                import('@/lib/demoSong').then(m => onStartGame(m.DEMO_SONG))
              }}
              className="mt-4 bg-violet-600 hover:bg-violet-500 text-white font-bold py-3 px-6 rounded-xl transition-colors"
            >
              ▶ Comenzar juego
            </button>
          )}

          {!isHost && (
            <p className="text-white/30 text-sm mt-2">
              Esperando que el host inicie...
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
