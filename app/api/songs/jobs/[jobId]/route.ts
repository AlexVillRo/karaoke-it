import { NextResponse } from 'next/server'
import { readJob } from '@/lib/server/jobRepository'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params
  const job = await readJob(jobId)
  if (!job) {
    return NextResponse.json({ error: 'Job no encontrado.' }, { status: 404 })
  }
  return NextResponse.json(job)
}
