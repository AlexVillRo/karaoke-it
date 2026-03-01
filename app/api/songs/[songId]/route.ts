import { NextResponse } from 'next/server'
import { deleteUserSong, isBuiltInSongId, patchUserSong, saveUserSong } from '@/lib/server/songRepository'
import type { SongNote } from '@/lib/types'

export const runtime = 'nodejs'

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ songId: string }> },
) {
  const { songId } = await params
  if (isBuiltInSongId(songId)) {
    return NextResponse.json({ error: 'No se puede modificar una cancion predefinida.' }, { status: 403 })
  }
  const body = await req.json()
  const notes: SongNote[] | undefined = Array.isArray(body.notes) ? body.notes : undefined
  const bpm: number | undefined = typeof body.bpm === 'number' ? body.bpm : undefined
  const lyricsOffsetSeconds: number | undefined = typeof body.lyricsOffsetSeconds === 'number' ? body.lyricsOffsetSeconds : undefined
  const updated = await saveUserSong(songId, { notes, bpm, lyricsOffsetSeconds })
  if (!updated) {
    return NextResponse.json({ error: 'Cancion no encontrada.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ songId: string }> },
) {
  const { songId } = await params
  if (isBuiltInSongId(songId)) {
    return NextResponse.json({ error: 'No se puede modificar una cancion predefinida.' }, { status: 403 })
  }
  const body = await req.json()
  const lyricsOffsetSeconds = typeof body.lyricsOffsetSeconds === 'number' ? body.lyricsOffsetSeconds : undefined
  const updated = await patchUserSong(songId, { lyricsOffsetSeconds })
  if (!updated) {
    return NextResponse.json({ error: 'Cancion no encontrada.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ songId: string }> }
) {
  const { songId } = await params
  if (!songId) {
    return NextResponse.json({ error: 'songId requerido.' }, { status: 400 })
  }

  if (isBuiltInSongId(songId)) {
    return NextResponse.json(
      { error: 'Las canciones predefinidas no se pueden borrar.' },
      { status: 403 },
    )
  }

  const deleted = await deleteUserSong(songId)
  if (!deleted) {
    return NextResponse.json({ error: 'Cancion no encontrada.' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
