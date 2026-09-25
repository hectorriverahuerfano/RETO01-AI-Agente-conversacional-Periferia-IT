// Confirmación humana (RN4 / CA3) controlada fuera del modelo.
// El servidor otorga una confirmación de un solo uso, atada a sesión y caso, solo cuando el
// mensaje del usuario inmediatamente posterior a la pregunta es afirmativo.

const otorgadas = new Map<string, Set<string>>()

export function otorgarConfirmacion(sessionId: string, caso: string): void {
  const casos = otorgadas.get(sessionId) ?? new Set<string>()
  casos.add(caso)
  otorgadas.set(sessionId, casos)
}

/** Consume la confirmación: devuelve true solo una vez. */
export function consumirConfirmacion(sessionId: string, caso: string): boolean {
  const casos = otorgadas.get(sessionId)
  if (!casos?.has(caso)) return false
  casos.delete(caso)
  return true
}

export function revocarConfirmaciones(sessionId: string): void {
  otorgadas.delete(sessionId)
}

const AFIRMATIVO = /^(si|confirmo|confirmado|envia|envialo|enviar|adelante|procede|autorizo|de acuerdo|ok|dale|hazlo)\b/
const NEGATIVO = /\b(no|todavia no|aun no|cancela|espera|detente)\b/

/** Frase afirmativa cerrada; cualquier negación la invalida. */
export function esConfirmacion(mensaje: string): boolean {
  const texto = mensaje
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .trim()
  return AFIRMATIVO.test(texto) && !NEGATIVO.test(texto)
}
