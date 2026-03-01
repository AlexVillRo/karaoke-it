import { NextResponse } from 'next/server'
import { listAllSongs } from '@/lib/server/songRepository'

export const runtime = 'nodejs'

export async function GET() {
  const songs = await listAllSongs()
  return NextResponse.json({ songs })
}
