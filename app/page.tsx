'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Tv, Smartphone } from 'lucide-react'

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toLowerCase()
}

export default function Home() {
  const router = useRouter()
  const [joinCode, setJoinCode] = useState('')

  function handleCreateRoom() {
    const code = generateRoomCode()
    router.push(`/host/${code}`)
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    const code = joinCode.trim().toLowerCase()
    if (code) router.push(`/play/${code}`)
  }

  return (
    <main className="min-h-screen bg-[#0a0a0f] text-white flex flex-col items-center justify-center gap-12 p-8">
      <div className="text-center">
        <h1
          className="text-7xl font-black tracking-tight"
          style={{ fontFamily: 'system-ui, sans-serif' }}
        >
          Karaoke<span className="text-violet-400">IT</span>
        </h1>
        <p className="text-white/40 mt-3 text-lg">Canta, puntúa, gana</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-6">
        {/* Crear sala */}
        <button
          onClick={handleCreateRoom}
          className="group flex flex-col items-center gap-4 bg-white/5 hover:bg-violet-600/20 border border-white/10 hover:border-violet-500/50 rounded-2xl p-8 transition-all duration-200 min-w-[220px] cursor-pointer"
        >
          <Tv size={40} className="text-violet-400 group-hover:scale-110 transition-transform" />
          <div className="text-center">
            <p className="font-bold text-lg">Crear sala</p>
            <p className="text-white/40 text-sm mt-1">Para la pantalla grande<br />(PC / TV)</p>
          </div>
        </button>

        {/* Unirse */}
        <form
          onSubmit={handleJoin}
          className="flex flex-col items-center gap-4 bg-white/5 border border-white/10 rounded-2xl p-8 min-w-[220px]"
        >
          <Smartphone size={40} className="text-cyan-400" />
          <div className="text-center">
            <p className="font-bold text-lg">Unirse</p>
            <p className="text-white/40 text-sm mt-1">Para el celular del jugador</p>
          </div>
          <input
            value={joinCode}
            onChange={e => setJoinCode(e.target.value)}
            type="text"
            placeholder="Código de sala"
            maxLength={8}
            className="bg-black/40 border border-white/20 rounded-lg px-4 py-2 text-center font-mono text-lg tracking-widest uppercase w-full focus:outline-none focus:border-cyan-500 text-white placeholder:text-white/20"
          />
          <button
            type="submit"
            className="w-full bg-cyan-600 hover:bg-cyan-500 text-black font-bold py-2 rounded-lg transition-colors"
          >
            Entrar
          </button>
        </form>
      </div>
    </main>
  )
}
