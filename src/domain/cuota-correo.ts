import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { dirOut } from "./rutas.ts"

// Tope de correos reales: por día (todo el servidor) y por sesión. Se guarda en disco para
// sobrevivir reinicios del proceso; en Render el disco se borra al redesplegar.

interface Cuota {
  fecha: string
  enviados: number
  porSesion: Record<string, number>
}

const hoy = () => new Date().toISOString().slice(0, 10)
const ruta = (raiz: string) => path.join(dirOut(raiz), "cuota-correo.json")

async function leer(raiz: string): Promise<Cuota> {
  try {
    const c = JSON.parse(await readFile(ruta(raiz), "utf8")) as Cuota
    if (c.fecha === hoy()) return c
  } catch {
    // Sin archivo o corrupto: cuota nueva.
  }
  return { fecha: hoy(), enviados: 0, porSesion: {} }
}

/** Devuelve el motivo del rechazo o undefined si todavía hay cupo. */
export async function motivoSinCupo(raiz: string, sessionId: string, maxDia: number, maxSesion: number): Promise<string | undefined> {
  const c = await leer(raiz)
  if (c.enviados >= maxDia) return "la demo alcanzó su límite de envíos de hoy"
  if ((c.porSesion[sessionId] ?? 0) >= maxSesion) return `alcanzaste el máximo de ${maxSesion} envíos en esta sesión`
  return undefined
}

export async function registrarEnvio(raiz: string, sessionId: string): Promise<void> {
  const c = await leer(raiz)
  c.enviados++
  c.porSesion[sessionId] = (c.porSesion[sessionId] ?? 0) + 1
  await mkdir(dirOut(raiz), { recursive: true })
  await writeFile(ruta(raiz), JSON.stringify(c), "utf8")
}
