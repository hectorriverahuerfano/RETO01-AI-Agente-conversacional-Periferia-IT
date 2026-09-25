import { lstat } from "node:fs/promises"
import path from "node:path"

export const PATRON_CASO = /^[a-z0-9-]{1,80}$/

export function dirFixtures(raiz: string): string {
  return path.join(raiz, "fixtures", "reto-01")
}

export function dirOut(raiz: string): string {
  return path.join(raiz, "out")
}

/** Resuelve la carpeta de un caso garantizando que queda dentro de fixtures/reto-01/casos. */
export function dirCaso(raiz: string, caso: string): string {
  if (!PATRON_CASO.test(caso)) throw new Error(`nombre de caso inválido: "${caso}"`)
  const base = path.join(dirFixtures(raiz), "casos")
  const destino = path.resolve(base, caso)
  if (path.dirname(destino) !== base) throw new Error("ruta de caso fuera de fixtures")
  return destino
}

/** Carpeta de salida de un caso, siempre dentro de out/. */
export function dirOutCaso(raiz: string, caso: string): string {
  if (!PATRON_CASO.test(caso)) throw new Error(`nombre de caso inválido: "${caso}"`)
  return path.join(dirOut(raiz), caso)
}

/** Rechaza enlaces simbólicos para no leer fuera de fixtures. */
export async function asegurarArchivoReal(ruta: string): Promise<void> {
  const info = await lstat(ruta)
  if (info.isSymbolicLink()) throw new Error("no se permiten enlaces simbólicos en fixtures")
}

/** Ruta relativa a la raíz del proyecto, con separador "/", para mostrar al usuario. */
export function relativa(raiz: string, ruta: string): string {
  return path.relative(raiz, ruta).split(path.sep).join("/")
}
