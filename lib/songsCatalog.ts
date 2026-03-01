import type { Song } from './types'
import { DEMO_SONG } from './demoSong'

/**
 * Catálogo de canciones en español para elegir en el lobby.
 * Todas son canciones conocidas; algunas comparten audio temporalmente.
 */

// Reutilizamos Las Mañanitas como primera entrada del catálogo
const LAS_MANANITAS: Song = DEMO_SONG

// Cielito Lindo — tradicional mexicana (Quirino Mendoza, 1882)
// Audio: mismo que Las Mañanitas por ahora; reemplazar audioUrl cuando haya fuente específica
// Notas en G mayor, letra primera estrofa + estribillo
const CIELITO_LINDO: Song = {
  id: 'cielito-lindo',
  title: 'Cielito Lindo',
  artist: 'Tradicional mexicana',
  audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/b2/Las_Mananitas.ogg',
  bpm: 90,
  notes: [
    { startTime: 0.3,  duration: 0.6, pitch: 74, syllable: 'De ',   lineIdx: 0 },
    { startTime: 0.9,  duration: 0.6, pitch: 71, syllable: 'la ',   lineIdx: 0 },
    { startTime: 1.5,  duration: 0.6, pitch: 69, syllable: 'sie-',  lineIdx: 0 },
    { startTime: 2.1,  duration: 0.6, pitch: 71, syllable: 'rra ',  lineIdx: 0 },
    { startTime: 2.7,  duration: 0.6, pitch: 74, syllable: 'mo-',   lineIdx: 0 },
    { startTime: 3.3,  duration: 0.6, pitch: 71, syllable: 're-',   lineIdx: 0 },
    { startTime: 3.9,  duration: 0.6, pitch: 69, syllable: 'na, ',  lineIdx: 0 },
    { startTime: 4.5,  duration: 0.6, pitch: 67, syllable: 'cie-',  lineIdx: 0 },
    { startTime: 5.1,  duration: 0.6, pitch: 69, syllable: 'li-',   lineIdx: 0 },
    { startTime: 5.7,  duration: 1.2, pitch: 71, syllable: 'to lindo', lineIdx: 0 },
    { startTime: 6.9,  duration: 0.6, pitch: 71, syllable: 'vie-',  lineIdx: 1 },
    { startTime: 7.5,  duration: 0.6, pitch: 72, syllable: 'nen ',  lineIdx: 1 },
    { startTime: 8.1,  duration: 0.6, pitch: 74, syllable: 'ba-',   lineIdx: 1 },
    { startTime: 8.7,  duration: 0.6, pitch: 71, syllable: 'jan-',  lineIdx: 1 },
    { startTime: 9.3,  duration: 1.2, pitch: 69, syllable: 'do',    lineIdx: 1 },
    { startTime: 10.5, duration: 0.6, pitch: 67, syllable: 'Ay, ',  lineIdx: 2 },
    { startTime: 11.1, duration: 0.6, pitch: 69, syllable: 'ay, ',  lineIdx: 2 },
    { startTime: 11.7, duration: 0.6, pitch: 71, syllable: 'ay ',   lineIdx: 2 },
    { startTime: 12.3, duration: 0.6, pitch: 67, syllable: 'can-',  lineIdx: 2 },
    { startTime: 12.9, duration: 0.6, pitch: 69, syllable: 'ta ',   lineIdx: 2 },
    { startTime: 13.5, duration: 0.6, pitch: 71, syllable: 'y no ', lineIdx: 2 },
    { startTime: 14.1, duration: 1.2, pitch: 69, syllable: 'llores', lineIdx: 2 },
    { startTime: 15.3, duration: 0.6, pitch: 67, syllable: 'Por ',  lineIdx: 3 },
    { startTime: 15.9, duration: 0.6, pitch: 69, syllable: 'e-',    lineIdx: 3 },
    { startTime: 16.5, duration: 0.6, pitch: 71, syllable: 'so ',   lineIdx: 3 },
    { startTime: 17.1, duration: 0.6, pitch: 74, syllable: 'cie-',  lineIdx: 3 },
    { startTime: 17.7, duration: 0.6, pitch: 71, syllable: 'li-',   lineIdx: 3 },
    { startTime: 18.3, duration: 1.2, pitch: 69, syllable: 'to lindo', lineIdx: 3 },
    { startTime: 19.5, duration: 0.6, pitch: 71, syllable: 'e-',    lineIdx: 4 },
    { startTime: 20.1, duration: 0.6, pitch: 72, syllable: 'chan ', lineIdx: 4 },
    { startTime: 20.7, duration: 0.6, pitch: 74, syllable: 'sus ',  lineIdx: 4 },
    { startTime: 21.3, duration: 1.2, pitch: 71, syllable: 'cantos', lineIdx: 4 },
    { startTime: 22.5, duration: 0.6, pitch: 67, syllable: 'Ay, ',  lineIdx: 5 },
    { startTime: 23.1, duration: 0.6, pitch: 69, syllable: 'ay, ',  lineIdx: 5 },
    { startTime: 23.7, duration: 0.6, pitch: 71, syllable: 'ay ',   lineIdx: 5 },
    { startTime: 24.3, duration: 0.6, pitch: 67, syllable: 'can-',  lineIdx: 5 },
    { startTime: 24.9, duration: 0.6, pitch: 69, syllable: 'ta ',   lineIdx: 5 },
    { startTime: 25.5, duration: 0.6, pitch: 71, syllable: 'y no ', lineIdx: 5 },
    { startTime: 26.1, duration: 1.5, pitch: 69, syllable: 'llores', lineIdx: 5 },
  ],
}

// De colores — canción tradicional (conocida en España y América)
const DE_COLORES: Song = {
  id: 'de-colores',
  title: 'De colores',
  artist: 'Tradicional',
  audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/b2/Las_Mananitas.ogg',
  bpm: 90,
  notes: [
    { startTime: 0.3,  duration: 0.6, pitch: 67, syllable: 'De ',   lineIdx: 0 },
    { startTime: 0.9,  duration: 0.6, pitch: 69, syllable: 'co-',  lineIdx: 0 },
    { startTime: 1.5,  duration: 0.6, pitch: 71, syllable: 'lo-',  lineIdx: 0 },
    { startTime: 2.1,  duration: 0.6, pitch: 69, syllable: 'res, ', lineIdx: 0 },
    { startTime: 2.7,  duration: 0.6, pitch: 67, syllable: 'de ',   lineIdx: 0 },
    { startTime: 3.3,  duration: 0.6, pitch: 69, syllable: 'co-',  lineIdx: 0 },
    { startTime: 3.9,  duration: 1.2, pitch: 71, syllable: 'lores', lineIdx: 0 },
    { startTime: 5.1,  duration: 0.6, pitch: 71, syllable: 'se ',   lineIdx: 1 },
    { startTime: 5.7,  duration: 0.6, pitch: 72, syllable: 'vis-',  lineIdx: 1 },
    { startTime: 6.3,  duration: 0.6, pitch: 71, syllable: 'ten ',  lineIdx: 1 },
    { startTime: 6.9,  duration: 0.6, pitch: 69, syllable: 'los ',  lineIdx: 1 },
    { startTime: 7.5,  duration: 0.6, pitch: 67, syllable: 'cam-',  lineIdx: 1 },
    { startTime: 8.1,  duration: 0.6, pitch: 69, syllable: 'pos ',  lineIdx: 1 },
    { startTime: 8.7,  duration: 0.6, pitch: 71, syllable: 'en ',   lineIdx: 1 },
    { startTime: 9.3,  duration: 1.2, pitch: 69, syllable: 'la primavera', lineIdx: 1 },
    { startTime: 10.5, duration: 0.6, pitch: 67, syllable: 'De ',   lineIdx: 2 },
    { startTime: 11.1, duration: 0.6, pitch: 69, syllable: 'co-',  lineIdx: 2 },
    { startTime: 11.7, duration: 0.6, pitch: 71, syllable: 'lo-',  lineIdx: 2 },
    { startTime: 12.3, duration: 0.6, pitch: 69, syllable: 'res ',  lineIdx: 2 },
    { startTime: 12.9, duration: 0.6, pitch: 67, syllable: 'son ',  lineIdx: 2 },
    { startTime: 13.5, duration: 0.6, pitch: 69, syllable: 'los ',  lineIdx: 2 },
    { startTime: 14.1, duration: 0.6, pitch: 71, syllable: 'pá-',  lineIdx: 2 },
    { startTime: 14.7, duration: 1.2, pitch: 69, syllable: 'jaros que vienen', lineIdx: 2 },
    { startTime: 15.9, duration: 0.6, pitch: 67, syllable: 'De ',   lineIdx: 3 },
    { startTime: 16.5, duration: 0.6, pitch: 69, syllable: 'co-',  lineIdx: 3 },
    { startTime: 17.1, duration: 0.6, pitch: 71, syllable: 'lo-',  lineIdx: 3 },
    { startTime: 17.7, duration: 0.6, pitch: 69, syllable: 'res ',  lineIdx: 3 },
    { startTime: 18.3, duration: 0.6, pitch: 67, syllable: 'es ',   lineIdx: 3 },
    { startTime: 18.9, duration: 0.6, pitch: 69, syllable: 'el ',   lineIdx: 3 },
    { startTime: 19.5, duration: 0.6, pitch: 71, syllable: 'ar-',   lineIdx: 3 },
    { startTime: 20.1, duration: 1.2, pitch: 69, syllable: 'coíris que vemos', lineIdx: 3 },
    { startTime: 21.3, duration: 0.6, pitch: 74, syllable: 'Y por ', lineIdx: 4 },
    { startTime: 21.9, duration: 0.6, pitch: 71, syllable: 'eso ',  lineIdx: 4 },
    { startTime: 22.5, duration: 0.6, pitch: 69, syllable: 'los ',  lineIdx: 4 },
    { startTime: 23.1, duration: 0.6, pitch: 71, syllable: 'gran-', lineIdx: 4 },
    { startTime: 23.7, duration: 0.6, pitch: 72, syllable: 'des ',  lineIdx: 4 },
    { startTime: 24.3, duration: 0.6, pitch: 71, syllable: 'a-',    lineIdx: 4 },
    { startTime: 24.9, duration: 0.6, pitch: 69, syllable: 'mo-',  lineIdx: 4 },
    { startTime: 25.5, duration: 1.2, pitch: 67, syllable: 'remos', lineIdx: 4 },
    { startTime: 26.7, duration: 0.6, pitch: 67, syllable: 'De ',   lineIdx: 5 },
    { startTime: 27.3, duration: 0.6, pitch: 69, syllable: 'co-',  lineIdx: 5 },
    { startTime: 27.9, duration: 0.6, pitch: 71, syllable: 'lo-',  lineIdx: 5 },
    { startTime: 28.5, duration: 0.6, pitch: 69, syllable: 'res ',  lineIdx: 5 },
    { startTime: 29.1, duration: 0.6, pitch: 67, syllable: 'y ',    lineIdx: 5 },
    { startTime: 29.7, duration: 0.6, pitch: 69, syllable: 'bril-', lineIdx: 5 },
    { startTime: 30.3, duration: 1.2, pitch: 71, syllable: 'larán', lineIdx: 5 },
  ],
}

// Noche de paz — villancico (misma melodía que Silent Night)
// Audio: Kevin MacLeod, piano, CC-BY 3.0 — 2:11, 72 BPM
const NOCHE_DE_PAZ: Song = {
  id: 'noche-de-paz',
  title: 'Noche de paz',
  artist: 'Villancico tradicional',
  audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/2/24/Silent_Night_%28Kevin_MacLeod%29_%28ISRC_USUAN1100075%29.oga',
  bpm: 72,
  // Letra empieza ~12 s (intro de piano antes)
  notes: [
    { startTime: 12,   duration: 0.8, pitch: 67, syllable: 'No-',   lineIdx: 0 },
    { startTime: 12.8, duration: 0.8, pitch: 67, syllable: 'che ',  lineIdx: 0 },
    { startTime: 13.6, duration: 0.8, pitch: 69, syllable: 'de ',   lineIdx: 0 },
    { startTime: 14.4, duration: 0.8, pitch: 71, syllable: 'paz, ',  lineIdx: 0 },
    { startTime: 15.2, duration: 0.8, pitch: 71, syllable: 'no-',   lineIdx: 0 },
    { startTime: 16.0, duration: 1.6, pitch: 69, syllable: 'che de amor', lineIdx: 0 },
    { startTime: 17.6, duration: 0.8, pitch: 67, syllable: 'To-',   lineIdx: 1 },
    { startTime: 18.4, duration: 0.8, pitch: 72, syllable: 'do ',   lineIdx: 1 },
    { startTime: 19.2, duration: 0.8, pitch: 71, syllable: 'duer-', lineIdx: 1 },
    { startTime: 20.0, duration: 0.8, pitch: 69, syllable: 'me ',   lineIdx: 1 },
    { startTime: 20.8, duration: 0.8, pitch: 71, syllable: 'en ',   lineIdx: 1 },
    { startTime: 21.6, duration: 1.6, pitch: 67, syllable: 'derredor', lineIdx: 1 },
    { startTime: 23.2, duration: 0.8, pitch: 67, syllable: 'Es-',   lineIdx: 2 },
    { startTime: 24.0, duration: 0.8, pitch: 69, syllable: 'tre-',  lineIdx: 2 },
    { startTime: 24.8, duration: 0.8, pitch: 71, syllable: 'lla ',  lineIdx: 2 },
    { startTime: 25.6, duration: 0.8, pitch: 71, syllable: 'que ',  lineIdx: 2 },
    { startTime: 26.4, duration: 0.8, pitch: 69, syllable: 're-',   lineIdx: 2 },
    { startTime: 27.2, duration: 1.6, pitch: 67, syllable: 'fulge',  lineIdx: 2 },
    { startTime: 28.8, duration: 0.8, pitch: 67, syllable: 'Es-',   lineIdx: 3 },
    { startTime: 29.6, duration: 0.8, pitch: 69, syllable: 'tre-',  lineIdx: 3 },
    { startTime: 30.4, duration: 0.8, pitch: 71, syllable: 'lla ',  lineIdx: 3 },
    { startTime: 31.2, duration: 0.8, pitch: 71, syllable: 'de ',   lineIdx: 3 },
    { startTime: 32.0, duration: 0.8, pitch: 69, syllable: 'lu-',   lineIdx: 3 },
    { startTime: 32.8, duration: 1.6, pitch: 67, syllable: 'zor',   lineIdx: 3 },
    { startTime: 34.4, duration: 0.8, pitch: 74, syllable: 'Bri-',   lineIdx: 4 },
    { startTime: 35.2, duration: 0.8, pitch: 74, syllable: 'lla ',  lineIdx: 4 },
    { startTime: 36.0, duration: 0.8, pitch: 76, syllable: 'la ',   lineIdx: 4 },
    { startTime: 36.8, duration: 0.8, pitch: 74, syllable: 'es-',   lineIdx: 4 },
    { startTime: 37.6, duration: 0.8, pitch: 71, syllable: 'pe-',   lineIdx: 4 },
    { startTime: 38.4, duration: 1.6, pitch: 69, syllable: 'ranza',  lineIdx: 4 },
    { startTime: 40.0, duration: 0.8, pitch: 67, syllable: 'No-',   lineIdx: 5 },
    { startTime: 40.8, duration: 0.8, pitch: 69, syllable: 'che ',  lineIdx: 5 },
    { startTime: 41.6, duration: 0.8, pitch: 71, syllable: 'de ',   lineIdx: 5 },
    { startTime: 42.4, duration: 0.8, pitch: 69, syllable: 'paz, ', lineIdx: 5 },
    { startTime: 43.2, duration: 1.0, pitch: 67, syllable: 'no-',   lineIdx: 5 },
    { startTime: 44.2, duration: 1.2, pitch: 67, syllable: 'che de amor', lineIdx: 5 },
  ],
}

/**
 * Lista de canciones disponibles para elegir en el lobby.
 * Solo incluimos canciones con su propio audio; Cielito Lindo y De colores
 * pueden volver a añadirse cuando tengamos URLs de audio para ellas.
 */
export const SONGS_CATALOG: Song[] = [
  LAS_MANANITAS,
  NOCHE_DE_PAZ,
  // CIELITO_LINDO y DE_COLORES comparten audio con Las Mañanitas; desactivados hasta tener audio propio
  // CIELITO_LINDO,
  // DE_COLORES,
]

/** Obtiene una canción por id */
export function getSongById(id: string): Song | undefined {
  return SONGS_CATALOG.find(s => s.id === id)
}
