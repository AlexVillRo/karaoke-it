import type { Song } from './types'

// Demo: "Cumpleaños Feliz" — canción de prueba con notas reales
// El audioUrl apunta a un archivo libre de derechos en Wikipedia
// Para producción, reemplázalo con tu propio audio

export const DEMO_SONG: Song = {
  id: 'cumpleanos-feliz',
  title: 'Cumpleaños Feliz',
  artist: 'Tradicional',
  audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/a0/Happy_Birthday_to_You.ogg',
  bpm: 90,
  notes: [
    // "Cum-" (0.5s)
    { startTime: 0.5,  duration: 0.4, pitch: 60, syllable: 'Cum-',    lineIdx: 0 },
    // "plea-" (0.9s)
    { startTime: 0.9,  duration: 0.4, pitch: 60, syllable: 'plea-',   lineIdx: 0 },
    // "ños" (1.3s)
    { startTime: 1.3,  duration: 0.8, pitch: 62, syllable: 'ños ',    lineIdx: 0 },
    // "fe-" (2.1s)
    { startTime: 2.1,  duration: 0.4, pitch: 60, syllable: 'fe-',     lineIdx: 0 },
    // "liz" (2.5s)
    { startTime: 2.5,  duration: 0.8, pitch: 65, syllable: 'liz,',    lineIdx: 0 },
    // "Cum-" (3.3s)
    { startTime: 3.3,  duration: 0.4, pitch: 64, syllable: 'Cum-',    lineIdx: 0 },
    // "plea-" (3.7s)
    { startTime: 3.7,  duration: 0.4, pitch: 64, syllable: 'plea-',   lineIdx: 0 },
    // "ños" (4.1s)
    { startTime: 4.1,  duration: 1.2, pitch: 62, syllable: 'ños ',    lineIdx: 0 },

    // "Cum-" (5.3s)
    { startTime: 5.3,  duration: 0.4, pitch: 60, syllable: 'Cum-',    lineIdx: 1 },
    // "plea-" (5.7s)
    { startTime: 5.7,  duration: 0.4, pitch: 60, syllable: 'plea-',   lineIdx: 1 },
    // "ños" (6.1s)
    { startTime: 6.1,  duration: 0.8, pitch: 67, syllable: 'ños ',    lineIdx: 1 },
    // "fe-" (6.9s)
    { startTime: 6.9,  duration: 0.4, pitch: 65, syllable: 'fe-',     lineIdx: 1 },
    // "liz" (7.3s)
    { startTime: 7.3,  duration: 1.2, pitch: 60, syllable: 'liz,',    lineIdx: 1 },

    // "Cum-" (8.5s)
    { startTime: 8.5,  duration: 0.4, pitch: 60, syllable: 'Cum-',    lineIdx: 2 },
    // "plea-" (8.9s)
    { startTime: 8.9,  duration: 0.4, pitch: 60, syllable: 'plea-',   lineIdx: 2 },
    // "ños" (9.3s)
    { startTime: 9.3,  duration: 0.8, pitch: 69, syllable: 'ños ',    lineIdx: 2 },
    // "a" (10.1s)
    { startTime: 10.1, duration: 0.4, pitch: 65, syllable: 'a ',      lineIdx: 2 },
    // "[nombre]" (10.5s)
    { startTime: 10.5, duration: 1.2, pitch: 64, syllable: '[nombre]',lineIdx: 2 },
    // "que" (11.7s)
    { startTime: 11.7, duration: 0.4, pitch: 62, syllable: 'que ',    lineIdx: 2 },

    // "Dios" (12.1s)
    { startTime: 12.1, duration: 0.4, pitch: 67, syllable: 'Dios ',   lineIdx: 3 },
    // "te" (12.5s)
    { startTime: 12.5, duration: 0.4, pitch: 65, syllable: 'te ',     lineIdx: 3 },
    // "ben-" (12.9s)
    { startTime: 12.9, duration: 0.4, pitch: 64, syllable: 'ben-',    lineIdx: 3 },
    // "di-" (13.3s)
    { startTime: 13.3, duration: 0.4, pitch: 60, syllable: 'di-',     lineIdx: 3 },
    // "ga" (13.7s)
    { startTime: 13.7, duration: 1.5, pitch: 62, syllable: 'ga',      lineIdx: 3 },
  ],
}
