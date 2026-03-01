'use client'

import clsx from 'clsx'
import type { Player } from '@/lib/types'

interface Props {
  players: Player[]
  showPitch?: boolean
}

export function ScoreBoard({ players, showPitch = false }: Props) {
  const sorted = [...players].sort((a, b) => b.score - a.score)
  const maxScore = Math.max(...sorted.map(p => p.score), 1)

  return (
    <div className="flex flex-col gap-3 w-full">
      {sorted.map((player, rank) => (
        <div key={player.id} className="flex items-center gap-3">
          {/* Rank */}
          <span className="text-white/40 text-sm w-5 text-right font-mono">
            {rank + 1}
          </span>

          {/* Name + bar */}
          <div className="flex-1">
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-sm font-bold" style={{ color: player.color }}>
                {player.name}
                {!player.connected && <span className="text-white/30 text-xs ml-1">(desconectado)</span>}
              </span>
              <span className="text-white font-mono text-sm">
                {player.score.toLocaleString()}
              </span>
            </div>
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${(player.score / maxScore) * 100}%`,
                  backgroundColor: player.color,
                  boxShadow: `0 0 8px ${player.color}`,
                }}
              />
            </div>
          </div>

          {/* Pitch indicator (durante la canción) */}
          {showPitch && (
            <div
              className={clsx(
                'w-2 h-2 rounded-full transition-colors duration-100',
                player.currentPitch ? 'animate-pulse' : 'bg-white/20'
              )}
              style={player.currentPitch ? { backgroundColor: player.color } : {}}
            />
          )}
        </div>
      ))}
    </div>
  )
}
