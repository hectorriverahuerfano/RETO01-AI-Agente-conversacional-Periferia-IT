import { randomBytes } from "node:crypto"
import { Hono, type Context, type Next } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { config } from "../config.ts"
import { claveCorrecta, crearToken, DURACION_SESION_MS, verificarToken } from "../domain/sesion-web.ts"

// Inicio de sesión con la clave de acceso, sin base de datos: cookie firmada (HMAC) y sin estado.

/** En producción el prefijo __Host- obliga a Secure, Path=/ y sin Domain. */
const COOKIE = config.produccion ? "__Host-reto01_sesion" : "reto01_sesion"

/** Falla cerrado: en producción no se arranca sin un secreto de al menos 32 bytes. */
function secretoSesion(): string {
  const secreto = process.env.SESSION_SECRET ?? ""
  if (Buffer.byteLength(secreto) >= 32) return secreto
  if (config.produccion) throw new Error("SESSION_SECRET falta o tiene menos de 32 bytes: el servidor no arranca.")
  console.warn("SESSION_SECRET no definido: se usa uno aleatorio (las sesiones mueren al reiniciar).")
  return randomBytes(32).toString("base64url")
}
const SECRETO = secretoSesion()

// En producción el origen público es obligatorio: con el valor local, todo login daría 403.
if (config.produccion && config.origenesPermitidos.every((o) => o.includes("localhost") || o.includes("127.0.0.1"))) {
  throw new Error("ORIGEN_PUBLICO (o RENDER_EXTERNAL_URL) no está definido en producción: el servidor no arranca.")
}

/** IP del cliente según el proxy de Render (Cloudflare), no según lo que diga el cliente. */
export function ipCliente(c: Context): string {
  // Fuera de Render no hay proxy que escriba estas cabeceras: el cliente podría inventarlas.
  if (!config.produccion) return "local"
  const cadena = c.req.header("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []
  return c.req.header("cf-connecting-ip") ?? cadena.at(-1) ?? "local"
}

// Intentos fallidos por IP, compartidos entre /api/login y el header x-access-key.
// Además hay un tope global: aunque alguien falsifique la IP, no puede probar claves sin límite.
const MAX_FALLOS = 5
const MAX_FALLOS_GLOBAL = 30
const fallos = new Map<string, { inicio: number; cuenta: number }>()
const global = { inicio: 0, cuenta: 0 }

function bloqueada(ip: string): boolean {
  if (Date.now() - global.inicio <= 60_000 && global.cuenta >= MAX_FALLOS_GLOBAL) return true
  const f = fallos.get(ip)
  if (!f) return false
  if (Date.now() - f.inicio > 60_000) {
    fallos.delete(ip)
    return false
  }
  return f.cuenta >= MAX_FALLOS
}

function registrarFallo(ip: string): void {
  const ahora = Date.now()
  if (ahora - global.inicio > 60_000) Object.assign(global, { inicio: ahora, cuenta: 1 })
  else global.cuenta++
  const f = fallos.get(ip)
  if (!f || ahora - f.inicio > 60_000) fallos.set(ip, { inicio: ahora, cuenta: 1 })
  else f.cuenta++
  if (fallos.size > 5000) for (const [k, v] of fallos) if (ahora - v.inicio > 60_000) fallos.delete(k)
}

/** CSRF: las peticiones que cambian algo con cookie deben venir del propio sitio. */
function origenPermitido(c: Context): boolean {
  const origen = c.req.header("origin")
  return origen !== undefined && config.origenesPermitidos.includes(origen)
}

const sesionValida = (c: Context) => verificarToken(getCookie(c, COOKIE), SECRETO, config.accessKey, Date.now())

/** Protege la API: cookie de sesión válida, o header x-access-key para curl y scripts. */
export async function exigirSesion(c: Context, next: Next) {
  if (!config.accessKey) return c.json({ ok: false, error: "El servidor no tiene ACCESS_KEY configurada." }, 503)
  const header = c.req.header("x-access-key")
  // Quien ya tiene sesión válida no se ve afectado por bloqueos de fuerza bruta de otros.
  if (header === undefined && sesionValida(c)) {
    if (c.req.method !== "GET" && !origenPermitido(c)) return c.json({ ok: false, error: "Origen no permitido." }, 403)
    return next()
  }
  const ip = ipCliente(c)
  if (bloqueada(ip)) return c.json({ ok: false, error: "Demasiados intentos. Espera 1 minuto y vuelve a intentarlo." }, 429)
  if (header !== undefined) {
    if (!claveCorrecta(header, config.accessKey)) {
      registrarFallo(ip)
      return c.json({ ok: false, error: "Clave de acceso inválida." }, 401)
    }
    return next()
  }
  return c.json({ ok: false, error: "Tu sesión expiró. Ingresa la clave para continuar." }, 401)
}

export const rutasSesion = new Hono()

rutasSesion.get("/api/sesion", (c) => c.json({ autenticado: Boolean(config.accessKey) && sesionValida(c) }))

rutasSesion.post("/api/login", async (c) => {
  if (!config.accessKey) return c.json({ ok: false, error: "El servidor no tiene ACCESS_KEY configurada." }, 503)
  const ip = ipCliente(c)
  if (bloqueada(ip)) return c.json({ ok: false, error: "Demasiados intentos. Espera 1 minuto y vuelve a intentarlo." }, 429)
  if (!origenPermitido(c)) return c.json({ ok: false, error: "Origen no permitido." }, 403)
  const cuerpo = (await c.req.json().catch(() => null)) as { clave?: unknown } | null
  const clave = typeof cuerpo?.clave === "string" ? cuerpo.clave.slice(0, 256) : ""
  if (!claveCorrecta(clave, config.accessKey)) {
    registrarFallo(ip)
    return c.json({ ok: false, error: "Clave incorrecta." }, 401)
  }
  setCookie(c, COOKIE, crearToken(SECRETO, config.accessKey, Date.now()), {
    httpOnly: true,
    secure: config.produccion,
    sameSite: "Strict",
    path: "/",
    maxAge: Math.floor(DURACION_SESION_MS / 1000),
  })
  return c.body(null, 204)
})

rutasSesion.post("/api/logout", (c) => {
  if (!origenPermitido(c)) return c.json({ ok: false, error: "Origen no permitido." }, 403)
  deleteCookie(c, COOKIE, { path: "/", secure: config.produccion, httpOnly: true, sameSite: "Strict" })
  return c.body(null, 204)
})
