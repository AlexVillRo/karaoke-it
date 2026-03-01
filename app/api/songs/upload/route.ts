import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { addUserSong } from '@/lib/server/songRepository'
import { buildAutoKaraokeSong } from '@/lib/server/autoKaraoke'
import { createJob, updateJob } from '@/lib/server/jobRepository'

export const runtime = 'nodejs'

const MAX_AUDIO_BYTES = 25 * 1024 * 1024

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^\w.-]+/g, '_')
}

function extensionFromName(name: string): string {
  const ext = path.extname(name).toLowerCase()
  return ext || '.mp3'
}

export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const title = String(form.get('title') ?? '').trim()
    const artist = String(form.get('artist') ?? '').trim()
    const lyrics = String(form.get('lyrics') ?? '').trim()
    const file = form.get('file')

    if (!title) {
      return NextResponse.json({ error: 'El titulo es obligatorio.' }, { status: 400 })
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Debes enviar un archivo de audio.' }, { status: 400 })
    }
    if (!file.type.startsWith('audio/')) {
      return NextResponse.json({ error: 'El archivo debe ser de audio.' }, { status: 400 })
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: 'El audio supera 25 MB.' }, { status: 400 })
    }

    const originalName = sanitizeFileName(file.name || 'song.mp3')
    const ext = extensionFromName(originalName)
    const outputName = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`

    const uploadDir = path.join(process.cwd(), 'public', 'uploads')
    await mkdir(uploadDir, { recursive: true })

    const buffer = Buffer.from(await file.arrayBuffer())
    const outputPath = path.join(uploadDir, outputName)
    await writeFile(outputPath, buffer)

    const audioUrl = `/uploads/${outputName}`
    const jobId = randomUUID()

    await createJob(jobId)

    // Fire-and-forget: no esperamos el pipeline, respondemos de inmediato
    const params = { title, artist, audioUrl, audioFilePath: outputPath, originalFilename: originalName, mimeType: file.type, audioBuffer: buffer, providedLyrics: lyrics }
    ;(async () => {
      try {
        const song = await buildAutoKaraokeSong(params)
        await addUserSong(song)
        await updateJob(jobId, { status: 'done', song })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido en el pipeline.'
        await updateJob(jobId, { status: 'error', error: message })
      }
    })()

    return NextResponse.json({ jobId }, { status: 202 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo procesar la cancion.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
