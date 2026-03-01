/**
 * Calcula el host de PartyKit dinámicamente.
 * - En dev, usa el mismo hostname que el navegador + puerto 1999
 *   → funciona tanto en localhost como desde un celular en la misma red
 * - En producción, usa la variable de entorno NEXT_PUBLIC_PARTYKIT_HOST
 */
export function getPartyHost(): string {
  // Env var siempre tiene prioridad (túneles, producción, etc.)
  const envHost = process.env.NEXT_PUBLIC_PARTYKIT_HOST
  if (envHost && envHost !== 'localhost:1999') return envHost

  // En dev sin env var configurado: mismo hostname que el navegador + puerto 1999
  // Funciona en red local (IP) y en localhost
  if (typeof window !== 'undefined') {
    return `${window.location.hostname}:1999`
  }
  return 'localhost:1999'
}
