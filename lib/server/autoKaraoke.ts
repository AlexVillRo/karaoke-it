import 'server-only'

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import path from 'node:path'
import type { Song } from '@/lib/types'

export interface BuildSongParams {
  title: string
  artist: string
  audioUrl: string
  audioFilePath: string
  providedLyrics?: string
}

interface PipelinePayload {
  song_id: string
  title: string
  artist: string
  audio_url: string
  audio_file_path: string
  provided_lyrics?: string
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function getDefaultPythonPath(): string {
  if (process.platform === 'win32') {
    return path.join(process.cwd(), '.venv311', 'Scripts', 'python.exe')
  }
  return path.join(process.cwd(), '.venv311', 'bin', 'python3')
}

async function runPythonPipeline(payload: PipelinePayload): Promise<Song> {
  const pythonPath = process.env.KARAOKE_PYTHON_PATH || getDefaultPythonPath()
  const scriptPath = path.join(process.cwd(), 'scripts', 'karaoke_pipeline.py')

  return await new Promise((resolve, reject) => {
    const proc = spawn(pythonPath, [scriptPath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const timeoutMs = Number(process.env.KARAOKE_PIPELINE_TIMEOUT_MS ?? 15 * 60 * 1000)
    const timeout = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('Karaoke pipeline timeout.'))
    }, timeoutMs)

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    proc.stderr.on('data', chunk => {
      stderr += String(chunk)
    })

    proc.on('error', err => {
      clearTimeout(timeout)
      reject(new Error(`No se pudo ejecutar pipeline python: ${err.message}`))
    })

    proc.on('close', code => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(new Error(`Pipeline fallo (code ${code}).\n${stderr.slice(-3000)}`))
        return
      }

      try {
        const parsed = JSON.parse(stdout) as { song?: Song; metrics?: unknown }
        if (!parsed.song) {
          reject(new Error('Pipeline no devolvio song valida.'))
          return
        }
        resolve(parsed.song)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error JSON desconocido'
        reject(new Error(`Salida invalida del pipeline: ${msg}.\nSTDERR:\n${stderr.slice(-1200)}`))
      }
    })

    proc.stdin.write(JSON.stringify(payload))
    proc.stdin.end()
  })
}

export async function buildAutoKaraokeSong(params: BuildSongParams): Promise<Song> {
  const idBase = slugify(params.title) || 'song'
  const songId = `${idBase}-${randomUUID().slice(0, 8)}`

  return await runPythonPipeline({
    song_id: songId,
    title: params.title,
    artist: params.artist,
    audio_url: params.audioUrl,
    audio_file_path: params.audioFilePath,
    provided_lyrics: params.providedLyrics,
  })
}
