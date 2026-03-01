import type { Song } from './types'

// Demo: "Las Mañanitas" — canción tradicional mexicana
// Audio: Wikimedia Commons (CC-BY-SA 3.0) — ~33 s, aprox. 90 BPM en 3/4
// Notas en G mayor: G4=67 A4=69 B4=71 C5=72 D5=74 E5=76

export const DEMO_SONG: Song = {
  id: 'las-mananitas',
  title: 'Las Mañanitas',
  artist: 'Tradicional mexicana',
  audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/b2/Las_Mananitas.ogg',
  bpm: 90,
  notes: [
    // ── "Estas son las mañanitas" ──────────────────────── lineIdx: 0
    { startTime: 0.3,  duration: 0.6, pitch: 67, syllable: 'Es-',    lineIdx: 0 },
    { startTime: 0.9,  duration: 0.6, pitch: 67, syllable: 'tas ',   lineIdx: 0 },
    { startTime: 1.5,  duration: 0.6, pitch: 67, syllable: 'son ',   lineIdx: 0 },
    { startTime: 2.1,  duration: 0.6, pitch: 74, syllable: 'las ',   lineIdx: 0 },
    { startTime: 2.7,  duration: 0.6, pitch: 71, syllable: 'ma-',    lineIdx: 0 },
    { startTime: 3.3,  duration: 0.6, pitch: 67, syllable: 'ña-',    lineIdx: 0 },
    { startTime: 3.9,  duration: 0.6, pitch: 74, syllable: 'ni-',    lineIdx: 0 },
    { startTime: 4.5,  duration: 1.2, pitch: 71, syllable: 'tas',    lineIdx: 0 },

    // ── "que cantaba el rey David" ─────────────────────── lineIdx: 1
    { startTime: 5.7,  duration: 0.6, pitch: 71, syllable: 'que ',   lineIdx: 1 },
    { startTime: 6.3,  duration: 0.6, pitch: 72, syllable: 'can-',   lineIdx: 1 },
    { startTime: 6.9,  duration: 0.6, pitch: 71, syllable: 'ta-',    lineIdx: 1 },
    { startTime: 7.5,  duration: 0.6, pitch: 69, syllable: 'ba ',    lineIdx: 1 },
    { startTime: 8.1,  duration: 0.6, pitch: 67, syllable: 'el ',    lineIdx: 1 },
    { startTime: 8.7,  duration: 0.6, pitch: 74, syllable: 'rey ',   lineIdx: 1 },
    { startTime: 9.3,  duration: 0.6, pitch: 71, syllable: 'Da-',    lineIdx: 1 },
    { startTime: 9.9,  duration: 1.2, pitch: 69, syllable: 'vid',    lineIdx: 1 },

    // ── "a las muchachas bonitas" ──────────────────────── lineIdx: 2
    { startTime: 11.1, duration: 0.6, pitch: 67, syllable: 'a ',     lineIdx: 2 },
    { startTime: 11.7, duration: 0.6, pitch: 67, syllable: 'las ',   lineIdx: 2 },
    { startTime: 12.3, duration: 0.6, pitch: 69, syllable: 'mu-',    lineIdx: 2 },
    { startTime: 12.9, duration: 0.6, pitch: 71, syllable: 'cha-',   lineIdx: 2 },
    { startTime: 13.5, duration: 0.6, pitch: 71, syllable: 'chas ',  lineIdx: 2 },
    { startTime: 14.1, duration: 0.6, pitch: 72, syllable: 'bo-',    lineIdx: 2 },
    { startTime: 14.7, duration: 0.6, pitch: 71, syllable: 'ni-',    lineIdx: 2 },
    { startTime: 15.3, duration: 1.2, pitch: 69, syllable: 'tas',    lineIdx: 2 },

    // ── "se las cantamos aquí" ─────────────────────────── lineIdx: 3
    { startTime: 16.5, duration: 0.6, pitch: 71, syllable: 'se ',    lineIdx: 3 },
    { startTime: 17.1, duration: 0.6, pitch: 72, syllable: 'las ',   lineIdx: 3 },
    { startTime: 17.7, duration: 0.6, pitch: 71, syllable: 'can-',   lineIdx: 3 },
    { startTime: 18.3, duration: 0.6, pitch: 69, syllable: 'ta-',    lineIdx: 3 },
    { startTime: 18.9, duration: 0.6, pitch: 69, syllable: 'mos ',   lineIdx: 3 },
    { startTime: 19.5, duration: 0.6, pitch: 67, syllable: 'a-',     lineIdx: 3 },
    { startTime: 20.1, duration: 1.5, pitch: 67, syllable: 'quí',    lineIdx: 3 },

    // ── "Despierta mi bien, despierta" ────────────────── lineIdx: 4
    { startTime: 21.6, duration: 0.6, pitch: 74, syllable: 'Des-',   lineIdx: 4 },
    { startTime: 22.2, duration: 0.6, pitch: 74, syllable: 'pier-',  lineIdx: 4 },
    { startTime: 22.8, duration: 0.6, pitch: 74, syllable: 'ta ',    lineIdx: 4 },
    { startTime: 23.4, duration: 0.6, pitch: 76, syllable: 'mi ',    lineIdx: 4 },
    { startTime: 24.0, duration: 0.6, pitch: 74, syllable: 'bien, ', lineIdx: 4 },
    { startTime: 24.6, duration: 0.6, pitch: 71, syllable: 'des-',   lineIdx: 4 },
    { startTime: 25.2, duration: 0.6, pitch: 74, syllable: 'pier-',  lineIdx: 4 },
    { startTime: 25.8, duration: 1.2, pitch: 71, syllable: 'ta',     lineIdx: 4 },

    // ── "mira que ya amaneció" ────────────────────────── lineIdx: 5
    { startTime: 27.0, duration: 0.6, pitch: 67, syllable: 'mi-',    lineIdx: 5 },
    { startTime: 27.6, duration: 0.6, pitch: 69, syllable: 'ra ',    lineIdx: 5 },
    { startTime: 28.2, duration: 0.6, pitch: 71, syllable: 'que ',   lineIdx: 5 },
    { startTime: 28.8, duration: 0.6, pitch: 74, syllable: 'ya ',    lineIdx: 5 },
    { startTime: 29.4, duration: 0.6, pitch: 71, syllable: 'a-',     lineIdx: 5 },
    { startTime: 30.0, duration: 0.6, pitch: 69, syllable: 'ma-',    lineIdx: 5 },
    { startTime: 30.6, duration: 0.6, pitch: 67, syllable: 'ne-',    lineIdx: 5 },
    { startTime: 31.2, duration: 1.5, pitch: 67, syllable: 'ció',    lineIdx: 5 },
  ],
}
