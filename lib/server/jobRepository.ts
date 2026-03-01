import 'server-only'

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Song } from '@/lib/types'

const JOBS_DIR = path.join(process.cwd(), 'data', 'jobs')

export interface Job {
  id: string
  status: 'processing' | 'done' | 'error'
  song?: Song
  error?: string
  createdAt: string
}

async function ensureJobsDir() {
  await mkdir(JOBS_DIR, { recursive: true })
}

export async function createJob(id: string): Promise<Job> {
  await ensureJobsDir()
  const job: Job = { id, status: 'processing', createdAt: new Date().toISOString() }
  await writeFile(path.join(JOBS_DIR, `${id}.json`), JSON.stringify(job, null, 2), 'utf8')
  return job
}

export async function readJob(id: string): Promise<Job | null> {
  await ensureJobsDir()
  try {
    const raw = await readFile(path.join(JOBS_DIR, `${id}.json`), 'utf8')
    return JSON.parse(raw) as Job
  } catch {
    return null
  }
}

export async function updateJob(id: string, update: Partial<Omit<Job, 'id' | 'createdAt'>>): Promise<void> {
  const job = await readJob(id)
  if (!job) return
  const updated = { ...job, ...update }
  await writeFile(path.join(JOBS_DIR, `${id}.json`), JSON.stringify(updated, null, 2), 'utf8')
}
