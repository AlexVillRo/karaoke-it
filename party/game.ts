import type * as Party from 'partykit/server'
import type { ClientMessage, Player, RoomState, ServerMessage } from '../lib/types'
import { evaluatePitch, getActiveNote, hzToMidi } from '../lib/scoring'
import { PLAYER_COLORS, SCORING } from '../lib/types'

export default class GameServer implements Party.Server {
  state: RoomState
  countdownTimer: ReturnType<typeof setInterval> | null = null

  constructor(readonly room: Party.Room) {
    this.state = {
      roomCode: room.id,
      phase: 'LOBBY',
      players: [],
      currentSong: null,
      songStartTime: null,
      pausedAtSeconds: null,
      countdown: 3,
      round: 1,
    }
  }

  // ── Conexión de un jugador ─────────────────────────────────────────────

  onConnect(conn: Party.Connection) {
    // Enviar estado actual al nuevo cliente
    this.send(conn, { type: 'STATE', state: this.state })
  }

  onClose(conn: Party.Connection) {
    this.state.players = this.state.players.map(p =>
      p.id === conn.id ? { ...p, connected: false } : p
    )
    this.broadcast()
  }

  // ── Mensajes ──────────────────────────────────────────────────────────

  onMessage(message: string, sender: Party.Connection) {
    const msg: ClientMessage = JSON.parse(message)

    switch (msg.type) {
      case 'JOIN':
        this.handleJoin(sender, msg.name, msg.isHost)
        break
      case 'START_GAME':
        this.handleStartGame(sender, msg.song)
        break
      case 'PITCH':
        this.handlePitch(sender, msg.hz, msg.timestamp)
        break
      case 'RESTART_SONG':
        this.handleRestartSong(sender)
        break
      case 'SONG_ENDED':
        this.handleSongEnded()
        break
      case 'PAUSE':
        this.handlePause(sender)
        break
      case 'RESUME':
        this.handleResume(sender)
        break
      case 'BACK_TO_LOBBY':
        this.handleBackToLobby(sender)
        break
      case 'CLOSE_ROOM':
        this.handleCloseRoom(sender)
        break
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────

  private handleJoin(conn: Party.Connection, name: string, isHost: boolean) {
    const existing = this.state.players.find(p => p.id === conn.id)
    if (existing) {
      // Reconexión
      this.state.players = this.state.players.map(p =>
        p.id === conn.id ? { ...p, connected: true, name } : p
      )
    } else {
      const colorIdx = this.state.players.length % PLAYER_COLORS.length
      const player: Player = {
        id: conn.id,
        name,
        score: 0,
        currentPitch: null,
        currentMidi: null,
        isHost,
        color: PLAYER_COLORS[colorIdx],
        connected: true,
      }
      this.state.players.push(player)
    }
    this.broadcast()
  }

  private handleStartGame(conn: Party.Connection, song: typeof this.state.currentSong) {
    const player = this.state.players.find(p => p.id === conn.id)
    if (!player?.isHost) return

    if (this.countdownTimer) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = null
    }

    this.state.currentSong = song
    this.state.phase = 'COUNTDOWN'
    this.state.countdown = 3
    this.state.players = this.state.players.map(p => ({ ...p, score: 0 }))
    this.broadcast()

    // Countdown 3 → 2 → 1 → PLAYING
    let count = 3
    this.countdownTimer = setInterval(() => {
      count--
      if (count > 0) {
        this.state.countdown = count
        this.broadcast()
      } else {
        if (this.countdownTimer) {
          clearInterval(this.countdownTimer)
          this.countdownTimer = null
        }
        this.state.phase = 'PLAYING'
        this.state.songStartTime = Date.now()
        this.state.pausedAtSeconds = null
        this.state.countdown = 0
        this.broadcast()
      }
    }, 1000)
  }

  private handlePitch(conn: Party.Connection, hz: number | null, _timestamp: number) {
    if (this.state.phase !== 'PLAYING' || !this.state.currentSong || !this.state.songStartTime) return

    const lyricsOffset = this.state.currentSong.lyricsOffsetSeconds ?? 0
    const currentTime = Math.max(0, (Date.now() - this.state.songStartTime) / 1000 - lyricsOffset)
    const activeNote = getActiveNote(this.state.currentSong.notes, currentTime)
    const playerMidi = hz ? hzToMidi(hz) : null

    const { points } = evaluatePitch(playerMidi, activeNote)

    this.state.players = this.state.players.map(p => {
      if (p.id !== conn.id) return p
      return {
        ...p,
        currentPitch: hz,
        currentMidi: playerMidi,
        score: p.score + Math.round(points * (SCORING.TICK_MS / 1000)),
      }
    })

    this.broadcast()
  }

  private handleRestartSong(conn: Party.Connection) {
    const player = this.state.players.find(p => p.id === conn.id)
    if (!player?.isHost || !this.state.currentSong) return

    this.state.phase = 'PLAYING'
    this.state.songStartTime = Date.now()
    this.state.pausedAtSeconds = null
    this.state.players = this.state.players.map(p => ({ ...p, score: 0, currentPitch: null, currentMidi: null }))
    this.broadcast()
  }

  private handlePause(conn: Party.Connection) {
    const player = this.state.players.find(p => p.id === conn.id)
    if (!player?.isHost || this.state.phase !== 'PLAYING' || !this.state.songStartTime) return

    this.state.pausedAtSeconds = (Date.now() - this.state.songStartTime) / 1000
    this.state.phase = 'PAUSED'
    this.broadcast()
  }

  private handleResume(conn: Party.Connection) {
    const player = this.state.players.find(p => p.id === conn.id)
    if (!player?.isHost || this.state.phase !== 'PAUSED' || this.state.pausedAtSeconds == null) return

    this.state.phase = 'PLAYING'
    this.state.songStartTime = Date.now() - this.state.pausedAtSeconds * 1000
    this.state.pausedAtSeconds = null
    this.broadcast()
  }

  private handleSongEnded() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = null
    }
    this.state.phase = 'RESULTS'
    this.state.songStartTime = null
    this.state.pausedAtSeconds = null
    this.broadcast()
  }

  private handleBackToLobby(conn: Party.Connection) {
    const player = this.state.players.find(p => p.id === conn.id)
    if (!player) return

    if (this.countdownTimer) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = null
    }

    this.state.phase = 'LOBBY'
    this.state.currentSong = null
    this.state.songStartTime = null
    this.state.pausedAtSeconds = null
    this.state.countdown = 3
    this.state.players = this.state.players.map(p => ({
      ...p,
      score: 0,
      currentPitch: null,
      currentMidi: null,
    }))
    this.broadcast()
  }

  private handleCloseRoom(conn: Party.Connection) {
    const player = this.state.players.find(p => p.id === conn.id)
    if (!player?.isHost) return

    if (this.countdownTimer) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = null
    }

    const msg: ServerMessage = { type: 'ROOM_CLOSED' }
    this.room.broadcast(JSON.stringify(msg))
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private send(conn: Party.Connection, msg: ServerMessage) {
    conn.send(JSON.stringify(msg))
  }

  private broadcast() {
    const msg: ServerMessage = { type: 'STATE', state: this.state }
    this.room.broadcast(JSON.stringify(msg))
  }
}
