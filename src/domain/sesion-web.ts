// Sesión web firmada (sin estado en servidor).
// Token = "v1." + base64url(JSON {exp}) + "." + base64url(HMAC-SHA256(llave, "v1." + payloadB64)).
//   - llave = HMAC-SHA256(secreto, clave): cambiar la clave invalida todas las sesiones previas.
//   - La cookie no lleva nada derivado de la clave, así no permite fuerza bruta offline sobre ella.

import { createHash, createHmac, timingSafeEqual } from "node:crypto"

export const DURACION_SESION_MS = 8 * 60 * 60 * 1000

const VERSION = "v1"
const LONGITUD_FIRMA = 43 // 32 bytes de SHA-256 en base64url sin relleno

interface CargaToken {
  exp: number
}

function firmar(cuerpo: string, secreto: string, clave: string): string {
  const llave = createHmac("sha256", secreto).update(clave, "utf8").digest()
  return createHmac("sha256", llave).update(cuerpo, "utf8").digest("base64url")
}

function esCarga(valor: unknown): valor is CargaToken {
  if (typeof valor !== "object" || valor === null) return false
  const { exp } = valor as Record<string, unknown>
  return typeof exp === "number" && Number.isFinite(exp)
}

export function crearToken(secreto: string, clave: string, ahoraMs: number, duracionMs: number = DURACION_SESION_MS): string {
  if (!secreto || !clave) throw new Error("Secreto y clave son obligatorios para crear la sesión")
  const carga: CargaToken = { exp: ahoraMs + duracionMs }
  const cuerpo = `${VERSION}.${Buffer.from(JSON.stringify(carga), "utf8").toString("base64url")}`
  return `${cuerpo}.${firmar(cuerpo, secreto, clave)}`
}

/** Valida versión, firma y vencimiento. Nunca lanza: ante cualquier duda devuelve false. */
export function verificarToken(token: string | undefined, secreto: string, clave: string, ahoraMs: number): boolean {
  try {
    if (!token || !secreto || !clave) return false
    const partes = token.split(".")
    if (partes.length !== 3) return false
    const [version, payloadB64, firmaB64] = partes as [string, string, string]
    if (version !== VERSION || !payloadB64 || firmaB64.length !== LONGITUD_FIRMA) return false

    // Firma en tiempo constante sobre el texto base64url (evita firmas maleables); el payload
    // solo se interpreta después de autenticarlo.
    const esperada = Buffer.from(firmar(`${version}.${payloadB64}`, secreto, clave), "utf8")
    const recibida = Buffer.from(firmaB64, "utf8")
    if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return false

    const carga: unknown = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"))
    return esCarga(carga) && carga.exp > ahoraMs
  } catch {
    return false
  }
}

/** Comparación en tiempo constante: se comparan los SHA-256 para no filtrar la longitud. */
export function claveCorrecta(recibida: string, esperada: string): boolean {
  const a = createHash("sha256").update(recibida, "utf8").digest()
  const b = createHash("sha256").update(esperada, "utf8").digest()
  return timingSafeEqual(a, b)
}
