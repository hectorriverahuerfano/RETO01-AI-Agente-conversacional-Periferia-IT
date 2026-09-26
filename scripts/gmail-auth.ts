// Script de una sola vez: obtiene el refresh token de Gmail (scope gmail.send) con OAuth en loopback.
// El token solo se imprime en consola; nunca se escribe a disco.
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createServer, type ServerResponse } from "node:http"

const HOST = "127.0.0.1"
const PUERTO = 53682
const REDIRECT_URI = `http://${HOST}:${PUERTO}/callback`
const SCOPE = "https://www.googleapis.com/auth/gmail.send"
const TIMEOUT_MS = 5 * 60 * 1000

const clientId = process.env.GMAIL_CLIENT_ID ?? ""
const clientSecret = process.env.GMAIL_CLIENT_SECRET ?? ""
if (!clientId || !clientSecret) {
  console.error("Faltan GMAIL_CLIENT_ID y/o GMAIL_CLIENT_SECRET en .env. Agrégalos y vuelve a ejecutar `npm run gmail-auth`.")
  process.exit(1)
}

const state = randomBytes(24).toString("hex")

const urlConsentimiento = new URL("https://accounts.google.com/o/oauth2/v2/auth")
urlConsentimiento.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  scope: SCOPE,
  access_type: "offline",
  prompt: "consent",
  state,
}).toString()

const AYUDA_REDIRECT =
  `redirect_uri_mismatch: el cliente OAuth debe ser tipo Escritorio, o agrega esta redirect URI al cliente Web: ${REDIRECT_URI}`

interface RespuestaToken {
  refresh_token?: string
  error?: string
  error_description?: string
}

function responder(res: ServerResponse, estado: number, mensaje: string): void {
  res.writeHead(estado, { "Content-Type": "text/html; charset=utf-8" })
  res.end(`<!doctype html><meta charset="utf-8"><title>Gmail OAuth</title><p>${mensaje}</p>`)
}

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** Intenta abrir la URL en el navegador del sistema; si falla, basta con la URL impresa. */
function abrirNavegador(url: string): void {
  try {
    const hijo =
      process.platform === "win32"
        ? spawn("cmd", ["/c", `start "" "${url}"`], { windowsVerbatimArguments: true, stdio: "ignore", detached: true })
        : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore", detached: true })
    hijo.on("error", () => console.log("No se pudo abrir el navegador; abre la URL manualmente."))
    hijo.unref()
  } catch {
    console.log("No se pudo abrir el navegador; abre la URL manualmente.")
  }
}

async function intercambiarCodigo(code: string): Promise<RespuestaToken> {
  const respuesta = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  })
  return (await respuesta.json()) as RespuestaToken
}

let terminado = false

function terminar(codigo: number): void {
  if (terminado) return
  terminado = true
  clearTimeout(temporizador)
  servidor.close(() => process.exit(codigo))
  servidor.closeAllConnections()
}

const servidor = createServer((req, res) => {
  const url = new URL(req.url ?? "/", REDIRECT_URI)
  if (url.pathname !== "/callback") {
    responder(res, 404, "Ruta no encontrada.")
    return
  }
  if (terminado) {
    responder(res, 409, "El flujo ya terminó. Cierra esta pestaña.")
    return
  }

  const error = url.searchParams.get("error")
  if (error) {
    const mensaje =
      error === "access_denied"
        ? "Autorización denegada por el usuario."
        : error === "redirect_uri_mismatch"
          ? AYUDA_REDIRECT
          : `Google devolvió el error: ${error}`
    responder(res, 400, escapar(mensaje))
    console.error(mensaje)
    terminar(1)
    return
  }

  if (url.searchParams.get("state") !== state) {
    responder(res, 400, "Parámetro state inválido. Vuelve a ejecutar el script.")
    console.error("State inválido: posible solicitud ajena al flujo. Se aborta.")
    terminar(1)
    return
  }

  const code = url.searchParams.get("code")
  if (!code) {
    responder(res, 400, "Falta el parámetro code.")
    console.error("Google no devolvió el parámetro code.")
    terminar(1)
    return
  }

  intercambiarCodigo(code)
    .then((token) => {
      if (token.error || !token.refresh_token) {
        const detalle =
          token.error === "redirect_uri_mismatch"
            ? AYUDA_REDIRECT
            : token.error
              ? `${token.error}${token.error_description ? `: ${token.error_description}` : ""}`
              : "Google no devolvió refresh_token. Revoca el acceso de la app en tu cuenta de Google y vuelve a intentarlo."
        responder(res, 400, escapar(`No se pudo obtener el token. ${detalle}`))
        console.error(`Error al intercambiar el código: ${detalle}`)
        terminar(1)
        return
      }
      responder(res, 200, "Autorización completa, puedes cerrar esta pestaña.")
      console.log("\nCopia este valor en .env como GMAIL_REFRESH_TOKEN y en Render. No lo compartas.\n")
      console.log(token.refresh_token)
      console.log("")
      terminar(0)
    })
    .catch((e: unknown) => {
      responder(res, 502, "Error de red al contactar a Google.")
      console.error(`Error de red al intercambiar el código: ${e instanceof Error ? e.message : String(e)}`)
      terminar(1)
    })
})

const temporizador = setTimeout(() => {
  console.error("Tiempo agotado (5 min) sin completar la autorización. Vuelve a ejecutar el script.")
  terminar(1)
}, TIMEOUT_MS)

servidor.on("error", (e: NodeJS.ErrnoException) => {
  console.error(
    e.code === "EADDRINUSE"
      ? `El puerto ${PUERTO} está ocupado. Libéralo y vuelve a ejecutar el script.`
      : `No se pudo iniciar el servidor local: ${e.message}`,
  )
  clearTimeout(temporizador)
  process.exit(1)
})

servidor.listen(PUERTO, HOST, () => {
  console.log(`Esperando la autorización en ${REDIRECT_URI} (máx. 5 min).`)
  console.log("Abre esta URL si el navegador no se abre solo:\n")
  console.log(urlConsentimiento.toString())
  console.log("")
  abrirNavegador(urlConsentimiento.toString())
})
