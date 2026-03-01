import 'server-only'

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Song } from '@/lib/types'
import { SONGS_CATALOG } from '@/lib/songsCatalog'

const DATA_DIR = path.join(process.cwd(), 'data')
const USER_SONGS_PATH = path.join(DATA_DIR, 'user-songs.json')
const BUILTIN_SONG_IDS = new Set(SONGS_CATALOG.map(song => song.id))

async function ensureStorage() {
  await mkdir(DATA_DIR, { recursive: true })
}

export async function readUserSongs(): Promise<Song[]> {
  await ensureStorage()

  try {
    const raw = await readFile(USER_SONGS_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as Song[]
  } catch {
    return []
  }
}

async function writeUserSongs(songs: Song[]) {
  await ensureStorage()
  await writeFile(USER_SONGS_PATH, JSON.stringify(songs, null, 2), 'utf8')
}

export async function listAllSongs(): Promise<Song[]> {
  const userSongs = await readUserSongs()
  return [...SONGS_CATALOG, ...userSongs]
}

export async function addUserSong(song: Song): Promise<void> {
  const songs = await readUserSongs()
  const withoutSameId = songs.filter(s => s.id !== song.id)
  withoutSameId.push(song)
  await writeUserSongs(withoutSameId)
}

export function isBuiltInSongId(songId: string): boolean {
  return BUILTIN_SONG_IDS.has(songId)
}

export async function saveUserSong(
  songId: string,
  patch: Pick<Partial<Song>, 'notes' | 'bpm' | 'lyricsOffsetSeconds'>,
): Promise<boolean> {
  if (isBuiltInSongId(songId)) return false
  const songs = await readUserSongs()
  const idx = songs.findIndex(s => s.id === songId)
  if (idx === -1) return false
  songs[idx] = { ...songs[idx], ...patch }
  await writeUserSongs(songs)
  return true
}

export async function patchUserSong(
  songId: string,
  patch: Pick<Partial<Song>, 'lyricsOffsetSeconds'>,
): Promise<boolean> {
  if (isBuiltInSongId(songId)) return false
  const songs = await readUserSongs()
  const idx = songs.findIndex(s => s.id === songId)
  if (idx === -1) return false
  songs[idx] = { ...songs[idx], ...patch }
  await writeUserSongs(songs)
  return true
}

export async function deleteUserSong(songId: string): Promise<boolean> {
  if (isBuiltInSongId(songId)) return false

  const songs = await readUserSongs()
  const target = songs.find(song => song.id === songId)
  if (!target) return false

  const remaining = songs.filter(song => song.id !== songId)
  await writeUserSongs(remaining)

  if (target.audioUrl.startsWith('/uploads/')) {
    const filename = target.audioUrl.replace('/uploads/', '')
    const filePath = path.join(process.cwd(), 'public', 'uploads', filename)
    try {
      await unlink(filePath)
    } catch {
      // Ignore missing/locked file; song index was already updated.
    }
  }

  return true
}
