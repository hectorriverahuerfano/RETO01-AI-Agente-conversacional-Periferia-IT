// Envío real de correo por la API de Gmail (HU-7, extensión fuera del PRD).
// Sin dependencias: MIME RFC 5322 construido a mano y OAuth2 con refresh token vía fetch.
// Seguridad: se rechaza cualquier CR/LF en encabezados (header injection) y ningún error
// expone tokens ni secretos.

import { randomBytes } from "node:crypto"
import path from "node:path"

export interface Adjunto {
  nombre: string
  contenido: Buffer
  tipo: string
}

export interface Correo {
  para: string
  asunto: string
  texto: string
  adjuntos: Adjunto[]
}

export interface Remitente {
  enviar(correo: Correo): Promise<{ id: string }>
}

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/
const SALTO = /[\r\n]/

/** Dirección simple (local@dominio): sin espacios, CR/LF, comas ni nombre visible; máx. 254. */
export function correoValido(email: string): boolean {
  if (email.length === 0 || email.length > 254) return false
  if (/[\s,;<>"]/.test(email)) return false
  const [local] = email.split("@")
  if (local === undefined || local.length > 64) return false
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false
  return EMAIL.test(email)
}

/** "hector@x.com" -> "h***@x.com". Nunca devuelve la parte local completa. */
export function enmascararCorreo(email: string): string {
  const arroba = email.lastIndexOf("@")
  if (arroba <= 0) return "***"
  return `${email[0]}***${email.slice(arroba)}`
}

function base64Lineas(datos: Buffer): string {
  const b64 = datos.toString("base64")
  const lineas: string[] = []
  for (let i = 0; i < b64.length; i += 76) lineas.push(b64.slice(i, i + 76))
  return lineas.join("\r\n")
}

function encabezadoRfc2047(texto: string): string {
  return `=?UTF-8?B?${Buffer.from(texto, "utf8").toString("base64")}?=`
}

function sanearNombre(nombre: string): string {
  const base = path.basename(nombre.replace(/\\/g, "/")).replace(/["\r\n\0]/g, "").trim()
  return base.length > 0 ? base : "adjunto"
}

function filenameRfc2231(nombre: string): string {
  const codificado = encodeURIComponent(nombre).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `UTF-8''${codificado}`
}

function tipoSeguro(tipo: string): string {
  return /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(tipo) ? tipo : "application/octet-stream"
}

/** Mensaje RFC 5322 multipart/mixed listo para codificar en base64url. */
export function construirMime(de: string, correo: Correo): string {
  if (SALTO.test(de) || SALTO.test(correo.para) || SALTO.test(correo.asunto)) {
    throw new Error("Encabezado de correo inválido: contiene saltos de línea")
  }
  if (!correoValido(correo.para)) throw new Error("Destinatario de correo inválido")

  const boundary = `=_reto01_${randomBytes(16).toString("hex")}`
  const partes: string[] = [
    `From: ${de}`,
    `To: ${correo.para}`,
    `Subject: ${encabezadoRfc2047(correo.asunto)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lineas(Buffer.from(correo.texto, "utf8")),
  ]

  for (const adjunto of correo.adjuntos) {
    const nombre = filenameRfc2231(sanearNombre(adjunto.nombre))
    partes.push(
      `--${boundary}`,
      `Content-Type: ${tipoSeguro(adjunto.tipo)}; name*=${nombre}`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename*=${nombre}`,
      "",
      base64Lineas(adjunto.contenido),
    )
  }

  partes.push(`--${boundary}--`, "")
  return partes.join("\r\n")
}

interface ConfigGmail {
  clientId: string
  clientSecret: string
  refreshToken: string
  de: string
}

const URL_TOKEN = "https://oauth2.googleapis.com/token"
const URL_ENVIO = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
const MARGEN_EXPIRACION_MS = 60_000

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null
}

async function leerJson(respuesta: Response): Promise<Record<string, unknown>> {
  try {
    const cuerpo: unknown = await respuesta.json()
    return esObjeto(cuerpo) ? cuerpo : {}
  } catch {
    return {}
  }
}

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.length > 0 ? valor.slice(0, 200) : undefined
}

function errorDeRed(error: unknown, operacion: string): Error {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new Error(`Tiempo de espera agotado al ${operacion}`)
  }
  return new Error(`Fallo de red al ${operacion}`)
}

export function crearRemitenteGmail(cfg: ConfigGmail, timeoutMs: number): Remitente {
  let cache: { token: string; expiraEn: number } | undefined

  async function obtenerToken(): Promise<string> {
    if (cache && Date.now() < cache.expiraEn) return cache.token

    let respuesta: Response
    try {
      respuesta = await fetch(URL_TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          refresh_token: cfg.refreshToken,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw errorDeRed(error, "obtener la autorización de Google")
    }

    const cuerpo = await leerJson(respuesta)
    if (!respuesta.ok) {
      const codigo = texto(cuerpo.error) ?? `HTTP ${respuesta.status}`
      if (codigo === "invalid_grant") {
        throw new Error("Google rechazó la autorización (invalid_grant): el refresh token caducó o fue revocado")
      }
      if (codigo === "invalid_client" || codigo === "unauthorized_client") {
        throw new Error(`Google rechazó la autorización (${codigo}): revisa GMAIL_CLIENT_ID y GMAIL_CLIENT_SECRET`)
      }
      throw new Error(`Google rechazó la autorización (${codigo})`)
    }

    const token = cuerpo.access_token
    if (typeof token !== "string" || token.length === 0) {
      throw new Error("Respuesta de autorización de Google sin access token")
    }
    const expiraS = typeof cuerpo.expires_in === "number" ? cuerpo.expires_in : 3600
    cache = { token, expiraEn: Date.now() + expiraS * 1000 - MARGEN_EXPIRACION_MS }
    return token
  }

  return {
    async enviar(correo: Correo): Promise<{ id: string }> {
      const raw = Buffer.from(construirMime(cfg.de, correo), "utf8").toString("base64url")
      const token = await obtenerToken()

      let respuesta: Response
      try {
        respuesta = await fetch(URL_ENVIO, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw }),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        throw errorDeRed(error, "enviar el correo por Gmail")
      }

      const cuerpo = await leerJson(respuesta)
      if (!respuesta.ok) {
        if (respuesta.status === 401) cache = undefined
        const detalle = esObjeto(cuerpo.error) ? texto(cuerpo.error.message) : undefined
        throw new Error(`Gmail rechazó el envío (HTTP ${respuesta.status})${detalle ? `: ${detalle}` : ""}`)
      }

      const id = cuerpo.id
      if (typeof id !== "string") throw new Error("Respuesta de Gmail sin id de mensaje")
      return { id }
    },
  }
}

/** Remitente de Gmail si las cuatro variables están definidas; undefined en otro caso. */
export function remitenteDesdeEntorno(timeoutMs: number): Remitente | undefined {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim()
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim()
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim()
  const de = process.env.GMAIL_FROM?.trim()
  if (!clientId || !clientSecret || !refreshToken || !de) return undefined
  return crearRemitenteGmail({ clientId, clientSecret, refreshToken, de }, timeoutMs)
}
