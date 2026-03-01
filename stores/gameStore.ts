import { create } from 'zustand'
import type { RoomState, Player, Song } from '@/lib/types'

interface GameStore {
  // Estado del servidor (sincronizado por WebSocket)
  roomState: RoomState | null
  setRoomState: (state: RoomState) => void

  // Estado local del jugador
  localPlayerId: string | null
  setLocalPlayerId: (id: string) => void

  localPlayerName: string
  setLocalPlayerName: (name: string) => void

  isHost: boolean
  setIsHost: (v: boolean) => void

  // Pitch local (detectado en el cliente, antes de enviarlo al servidor)
  localHz: number | null
  setLocalHz: (hz: number | null) => void

  // Helpers derivados
  localPlayer: () => Player | null
  currentTime: () => number   // segundos desde que empezó la canción
}

export const useGameStore = create<GameStore>((set, get) => ({
  roomState: null,
  setRoomState: (state) => set({ roomState: state }),

  localPlayerId: null,
  setLocalPlayerId: (id) => set({ localPlayerId: id }),

  localPlayerName: '',
  setLocalPlayerName: (name) => set({ localPlayerName: name }),

  isHost: false,
  setIsHost: (v) => set({ isHost: v }),

  localHz: null,
  setLocalHz: (hz) => set({ localHz: hz }),

  localPlayer: () => {
    const { roomState, localPlayerId } = get()
    if (!roomState || !localPlayerId) return null
    return roomState.players.find(p => p.id === localPlayerId) ?? null
  },

  currentTime: () => {
    const { roomState } = get()
    if (!roomState?.songStartTime) return 0
    return (Date.now() - roomState.songStartTime) / 1000
  },
}))
