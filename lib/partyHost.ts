/**
 * Calcula el host de PartyKit dinámicamente.
 * - En dev, usa el mismo hostname que el navegador + puerto 1999
 *   → funciona tanto en localhost como desde un celular en la misma red
 * - En producción, usa la variable de entorno NEXT_PUBLIC_PARTYKIT_HOST
 */
export function getPartyHost(): string {
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? 'karaoke-it.alexvillro.partykit.dev'
  }
  if (typeof window !== 'undefined') {
    return `${window.location.hostname}:1999`
  }
  return 'localhost:1999'
}
