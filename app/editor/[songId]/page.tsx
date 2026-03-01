'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NoteEditor } from '@/components/editor/NoteEditor'
import { SONGS_CATALOG } from '@/lib/songsCatalog'
import type { Song, SongNote } from '@/lib/types'

const BUILTIN_IDS = new Set(SONGS_CATALOG.map(s => s.id))

export default function EditorPage({ params }: { params: Promise<{ songId: string }> }) {
  const { songId } = use(params)
  const router = useRouter()
  const [song, setSong]       = useState<Song | null>(null)
  const [error, setError]     = useState('')

  useEffect(() => {
    fetch('/api/songs', { cache: 'no-store' })
      .then(r => r.json())
      .then((data: { songs?: Song[] }) => {
        const found = data.songs?.find(s => s.id === songId)
        if (!found) { setError('Canción no encontrada.'); return }
        if (BUILTIN_IDS.has(found.id)) { setError('Las canciones predefinidas no se pueden editar.'); return }
        setSong(found)
      })
      .catch(() => setError('Error cargando la canción.'))
  }, [songId])

  const handleSave = useCallback(async (
    notes: SongNote[],
    bpm: number,
    lyricsOffsetSeconds: number,
  ) => {
    await fetch(`/api/songs/${encodeURIComponent(songId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes, bpm, lyricsOffsetSeconds }),
    })
  }, [songId])

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center gap-4 text-white">
        <p className="text-red-400">{error}</p>
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm"
        >
          ← Volver al inicio
        </button>
      </div>
    )
  }

  if (!song) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-white/30">
        Cargando editor...
      </div>
    )
  }

  return (
    <div className="min-h-screen h-screen bg-[#0a0a0f] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-[#0d0d18] border-b border-white/10">
        <button
          onClick={() => router.push('/')}
          className="text-white/40 hover:text-white text-sm transition-colors"
        >
          ←
        </button>
        <div>
          <h1 className="font-bold text-white leading-none">{song.title}</h1>
          <p className="text-xs text-white/40">{song.artist} · editor de notas</p>
        </div>
        <div className="flex-1" />
        <p className="text-xs text-white/25 hidden sm:block">
          Space=play  D=dibujar  S=mover  Del=borrar  Ctrl+Z=undo
        </p>
      </div>

      {/* Editor ocupa el resto de la pantalla */}
      <div className="flex-1 min-h-0">
        <NoteEditor song={song} onSave={handleSave} />
      </div>
    </div>
  )
}
