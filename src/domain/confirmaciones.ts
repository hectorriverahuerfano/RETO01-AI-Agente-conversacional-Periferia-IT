// Permisos humanos (RN4 / CA3) controlados fuera del modelo.
// El servidor otorga permisos de un solo uso, atados a la sesión, que solo nacen del mensaje
// del usuario inmediatamente posterior a la pregunta y se revocan al terminar ese turno.
//   - "envio":  clave = caso. Confirmación del envío simulado.
//   - "correo": clave = email. El destinatario debe estar escrito literalmente por el usuario.

export type TipoPermiso = "envio" | "correo"

const otorgados = new Map<string, Set<string>>()
const llave = (tipo: TipoPermiso, clave: string) => `${tipo}:${clave.toLowerCase()}`

export function otorgarPermiso(sessionId: string, tipo: TipoPermiso, clave: string): void {
  const permisos = otorgados.get(sessionId) ?? new Set<string>()
  permisos.add(llave(tipo, clave))
  otorgados.set(sessionId, permisos)
}

/** Consume el permiso: devuelve true solo una vez. */
export function consumirPermiso(sessionId: string, tipo: TipoPermiso, clave: string): boolean {
  return otorgados.get(sessionId)?.delete(llave(tipo, clave)) ?? false
}

/** Consulta sin consumir. */
export function tienePermiso(sessionId: string, tipo: TipoPermiso, clave: string): boolean {
  return otorgados.get(sessionId)?.has(llave(tipo, clave)) ?? false
}

// Envíos simulados hechos en cada sesión: la copia por correo solo se ofrece a quien confirmó.
const simulados = new Map<string, Set<string>>()
export function registrarEnvioSimulado(sessionId: string, caso: string): void {
  simulados.set(sessionId, (simulados.get(sessionId) ?? new Set<string>()).add(caso))
}
export function huboEnvioSimulado(sessionId: string, caso: string): boolean {
  return simulados.get(sessionId)?.has(caso) ?? false
}

/** Al borrar una sesión se olvida también lo que habilitó. */
export function olvidarSesion(sessionId: string): void {
  otorgados.delete(sessionId)
  simulados.delete(sessionId)
}

export function revocarPermisos(sessionId: string): void {
  otorgados.delete(sessionId)
}

export const otorgarConfirmacion = (sessionId: string, caso: string) => otorgarPermiso(sessionId, "envio", caso)
export const consumirConfirmacion = (sessionId: string, caso: string) => consumirPermiso(sessionId, "envio", caso)

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

/** Correos escritos por el usuario en su mensaje. Solo se acepta uno por mensaje. */
export function correoDelMensaje(mensaje: string): string | undefined {
  const encontrados = mensaje.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []
  const unicos = [...new Set(encontrados.map((c) => c.toLowerCase()))]
  return unicos.length === 1 ? unicos[0] : undefined
}
