'use client'

import { useEffect, useRef, useState } from 'react'
import { Users, Music } from 'lucide-react'
import type { Player, Song } from '@/lib/types'
import { SONGS_CATALOG } from '@/lib/songsCatalog'

const BUILTIN_SONG_IDS = new Set(SONGS_CATALOG.map(song => song.id))

interface Props {
  roomCode: string
  players: Player[]
  isHost: boolean
  songs: Song[]
  onStartGame: (song: Song) => void
  onSongsChanged?: () => Promise<void> | void
  onCloseLobby?: () => void
}

export function Lobby({ roomCode, players, isHost, songs, onStartGame, onSongsChanged, onCloseLobby }: Props) {
  const [qrUrl, setQrUrl] = useState('')
  const [selectedSongId, setSelectedSongId] = useState<string>(songs[0]?.id ?? '')
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadArtist, setUploadArtist] = useState('')
  const [uploadLyrics, setUploadLyrics] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [pollingJobId, setPollingJobId] = useState<string | null>(null)
  const [deletingSongId, setDeletingSongId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [offsetSeconds, setOffsetSeconds] = useState<number>(0)

  // Ref para evitar que el effect de polling se re-registre al cambiar onSongsChanged
  const onSongsChangedRef = useRef(onSongsChanged)
  useEffect(() => { onSongsChangedRef.current = onSongsChanged }, [onSongsChanged])

  const appHost = process.env.NEXT_PUBLIC_APP_HOST
  const joinUrl = typeof window !== 'undefined'
    ? appHost
      ? `https://${appHost}/play/${roomCode}`
      : `${window.location.origin}/play/${roomCode}`
    : ''

  useEffect(() => {
    if (!joinUrl) return
    setQrUrl(`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(joinUrl)}`)
  }, [joinUrl])

  useEffect(() => {
    if (songs.length === 0) {
      setSelectedSongId('')
      return
    }
    if (!songs.some(song => song.id === selectedSongId)) {
      setSelectedSongId(songs[0].id)
    }
  }, [songs, selectedSongId])

  // Sincronizar offset cuando cambia la canción seleccionada
  useEffect(() => {
    const song = songs.find(s => s.id === selectedSongId)
    setOffsetSeconds(song?.lyricsOffsetSeconds ?? 0)
  }, [selectedSongId, songs])

  // Polling: consulta el estado del job cada 3 segundos
  useEffect(() => {
    if (!pollingJobId) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/songs/jobs/${pollingJobId}`)
        if (!res.ok) return // sigue intentando
        const job = await res.json()

        if (job.status === 'done') {
          clearInterval(interval)
          setPollingJobId(null)
          setIsUploading(false)
          setSelectedSongId(job.song.id)
          await onSongsChangedRef.current?.()
        } else if (job.status === 'error') {
          clearInterval(interval)
          setPollingJobId(null)
          setIsUploading(false)
          setUploadError(job.error ?? 'Error procesando la cancion.')
        }
        // status === 'processing': sigue esperando
      } catch {
        // Error de red durante polling — sigue intentando
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [pollingJobId])

  const connectedPlayers = players.filter(p => p.connected && !p.isHost)
  const selectedSong = songs.find(s => s.id === selectedSongId) ?? songs[0]

  // Guarda el offset en el servidor (solo para canciones custom)
  async function saveOffset(songId: string, value: number) {
    if (BUILTIN_SONG_IDS.has(songId)) return
    try {
      await fetch(`/api/songs/${encodeURIComponent(songId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyricsOffsetSeconds: value }),
      })
    } catch {
      // No bloquear la UI si falla el guardado
    }
  }

  async function handleOffsetBlur() {
    if (selectedSong) await saveOffset(selectedSong.id, offsetSeconds)
  }

  function handleStartWithOffset() {
    if (!selectedSong) return
    onStartGame({ ...selectedSong, lyricsOffsetSeconds: offsetSeconds })
  }

  async function handleUploadSong(e: React.FormEvent) {
    e.preventDefault()
    if (!uploadTitle.trim() || !uploadFile) return

    setUploadError('')
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append('title', uploadTitle.trim())
      formData.append('artist', uploadArtist.trim())
      formData.append('lyrics', uploadLyrics.trim())
      formData.append('file', uploadFile)

      const res = await fetch('/api/songs/upload', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        setUploadError(data?.error ?? 'No se pudo procesar la cancion.')
        setIsUploading(false)
        return
      }

      // Limpiar formulario y arrancar polling
      setUploadTitle('')
      setUploadArtist('')
      setUploadLyrics('')
      setUploadFile(null)
      setPollingJobId(data.jobId)
      // isUploading queda en true hasta que el polling termine
    } catch {
      setUploadError('Error de red al subir la cancion.')
      setIsUploading(false)
    }
  }

  async function handleDeleteSong(song: Song) {
    if (BUILTIN_SONG_IDS.has(song.id)) return
    if (!window.confirm(`Borrar "${song.title}"? Esta accion no se puede deshacer.`)) return

    setUploadError('')
    setDeletingSongId(song.id)
    try {
      const res = await fetch(`/api/songs/${encodeURIComponent(song.id)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        setUploadError(data?.error ?? 'No se pudo borrar la cancion.')
        return
      }
      await onSongsChanged?.()
    } catch {
      setUploadError('Error de red al borrar la cancion.')
    } finally {
      setDeletingSongId(null)
    }
  }

  function uploadButtonLabel() {
    if (!isUploading) return 'Subir y generar'
    if (pollingJobId) return 'Procesando audio... (puede tardar minutos)'
    return 'Subiendo...'
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 p-8">
      <div className="text-center">
        <h1 className="text-6xl font-black tracking-tight" style={{ fontFamily: "'Syne', sans-serif" }}>
          Karaoke<span className="text-violet-400">IT</span>
        </h1>
        <p className="text-white/40 mt-2">Sala de espera</p>
      </div>

      <div className="flex flex-wrap gap-12 items-start justify-center max-w-4xl">
        <div className="flex flex-col items-center gap-3">
          <div className="bg-white p-3 rounded-2xl">
            {qrUrl && <img src={qrUrl} alt="QR" width={180} height={180} />}
          </div>
          <p className="text-white/50 text-sm text-center">Escanea para unirte</p>
          <div className="bg-white/10 px-4 py-2 rounded-lg font-mono text-xl tracking-widest text-white">
            {roomCode.toUpperCase()}
          </div>
        </div>

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

          {!isHost && (
            <p className="text-white/30 text-sm mt-2">Esperando que el host inicie...</p>
          )}
        </div>

        {isHost && (
          <div className="flex flex-col gap-3 min-w-[280px]">
            <div className="flex items-center gap-2 text-white/50 text-sm">
              <Music size={14} />
              <span>Elige la cancion</span>
            </div>
            <div className="flex flex-col gap-2 max-h-[260px] overflow-y-auto pr-1">
              {songs.map(song => (
                <div
                  key={song.id}
                  className={`
                    flex items-center gap-2 rounded-xl px-2 py-2 border transition-all
                    ${selectedSongId === song.id
                      ? 'bg-violet-600/30 border-violet-500/60 text-white'
                      : 'bg-white/5 border-white/10 text-white/80 hover:bg-white/10 hover:border-white/20'
                    }
                  `}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedSongId(song.id)}
                    className="flex flex-1 flex-col items-start gap-0.5 text-left rounded-lg px-2 py-1"
                  >
                    <span className="font-bold">{song.title}</span>
                    <span className="text-xs opacity-70">{song.artist}</span>
                  </button>
                  {!BUILTIN_SONG_IDS.has(song.id) && (
                    <div className="flex gap-1 shrink-0">
                      <a
                        href={`/editor/${encodeURIComponent(song.id)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-2 py-1 text-[11px] font-bold text-cyan-300 hover:bg-cyan-500/25"
                      >
                        Editar
                      </a>
                      <button
                        type="button"
                        onClick={() => handleDeleteSong(song)}
                        disabled={deletingSongId === song.id}
                        className="rounded-lg border border-red-400/40 bg-red-500/15 px-2 py-1 text-[11px] font-bold text-red-300 hover:bg-red-500/25 disabled:opacity-50"
                      >
                        {deletingSongId === song.id ? 'Borrando...' : 'Borrar'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <form onSubmit={handleUploadSong} className="mt-1 flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-white/60 font-bold tracking-wide">Subir cancion (auto karaoke)</p>
              <input
                value={uploadTitle}
                onChange={e => setUploadTitle(e.target.value)}
                placeholder="Titulo"
                className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500"
              />
              <input
                value={uploadArtist}
                onChange={e => setUploadArtist(e.target.value)}
                placeholder="Artista (opcional)"
                className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500"
              />
              <textarea
                value={uploadLyrics}
                onChange={e => setUploadLyrics(e.target.value)}
                placeholder="Letra (opcional, recomendado). Si la omites se intentara buscar online."
                rows={4}
                className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500 resize-y"
              />
              <input
                type="file"
                accept="audio/*"
                onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
                className="text-xs text-white/60 file:mr-2 file:rounded file:border-0 file:bg-violet-600/80 file:px-2 file:py-1 file:text-xs file:font-bold file:text-white hover:file:bg-violet-500"
              />
              {uploadError && <p className="text-[11px] text-red-400">{uploadError}</p>}
              <button
                type="submit"
                disabled={isUploading || !uploadTitle.trim() || !uploadFile}
                className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold py-2 rounded-lg text-sm transition-colors"
              >
                {uploadButtonLabel()}
              </button>
            </form>

            {/* ── Ajuste de offset de letra ─────────────────── */}
            {selectedSong && (
              <div className="flex flex-col gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/50 flex-1">Inicio de letra</span>
                  <button
                    type="button"
                    onClick={() => {
                      const v = Math.max(0, offsetSeconds - 0.5)
                      setOffsetSeconds(v)
                      saveOffset(selectedSong.id, v)
                    }}
                    className="w-6 h-6 rounded bg-white/10 hover:bg-white/20 text-white font-bold text-sm flex items-center justify-center"
                  >−</button>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    step={0.5}
                    value={offsetSeconds}
                    onChange={e => setOffsetSeconds(Number(e.target.value))}
                    onBlur={handleOffsetBlur}
                    className="w-16 bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-sm text-white text-center focus:outline-none focus:border-violet-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const v = offsetSeconds + 0.5
                      setOffsetSeconds(v)
                      saveOffset(selectedSong.id, v)
                    }}
                    className="w-6 h-6 rounded bg-white/10 hover:bg-white/20 text-white font-bold text-sm flex items-center justify-center"
                  >+</button>
                  <span className="text-xs text-white/30">s</span>
                </div>
                <p className="text-[10px] text-white/25 leading-tight">
                  Si la letra aparece antes que el audio, aumenta este valor.
                </p>
              </div>
            )}

            {connectedPlayers.length > 0 && selectedSong && (
              <button
                onClick={handleStartWithOffset}
                className="mt-1 bg-violet-600 hover:bg-violet-500 text-white font-bold py-3 px-6 rounded-xl transition-colors w-full"
              >
                {'>'} Comenzar con «{selectedSong.title}»
              </button>
            )}

            {onCloseLobby && (
              <button
                onClick={() => {
                  if (window.confirm('¿Cerrar la sala? Todos los jugadores serán redirigidos al inicio.')) {
                    onCloseLobby()
                  }
                }}
                className="mt-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-bold py-2 px-6 rounded-xl transition-colors w-full text-sm"
              >
                Cerrar sala
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
