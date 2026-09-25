import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { asegurarArchivoReal, dirCaso, dirFixtures } from "./rutas.ts"

// Esquemas de los archivos de entrada. Validarlos convierte una plantilla corrupta en un error claro.

export const Solicitud = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  pais: z.string(),
  cliente: z.string(),
  cuerpo: z.string(),
  formato: z.enum(["xlsx", "pdf", "portal"]),
  adjuntos: z.array(z.string()),
})
export type Solicitud = z.infer<typeof Solicitud>

export const Celda = z.object({
  hoja: z.string(),
  celda_etiqueta: z.string().regex(/^[A-Z]{1,3}\d{1,5}$/),
  etiqueta: z.string(),
  celda_valor: z.string().regex(/^[A-Z]{1,3}\d{1,5}$/),
})
export type Celda = z.infer<typeof Celda>

export const CampoPdf = z.object({ etiqueta: z.string(), obligatorio: z.boolean() })
export type CampoPdf = z.infer<typeof CampoPdf>

export const Soporte = z.object({
  tipo: z.string(),
  archivo: z.string(),
  vigencia_hasta: z.string().nullable(),
  pais_emisor: z.string(),
  descripcion: z.string(),
})
export type Soporte = z.infer<typeof Soporte>

export type Maestro = Record<string, unknown>
export type Glosario = Record<string, string>

async function leerJson(ruta: string, nombre: string): Promise<unknown> {
  await asegurarArchivoReal(ruta)
  const texto = await readFile(ruta, "utf8")
  try {
    return JSON.parse(texto)
  } catch {
    throw new Error(`${nombre} está corrupto (JSON inválido)`)
  }
}

async function leerValidado<T>(ruta: string, nombre: string, esquema: z.ZodType<T>): Promise<T> {
  const datos = await leerJson(ruta, nombre)
  const r = esquema.safeParse(datos)
  if (!r.success) throw new Error(`${nombre} no tiene la estructura esperada`)
  return r.data
}

async function existe(ruta: string): Promise<boolean> {
  try {
    await asegurarArchivoReal(ruta)
    return true
  } catch {
    return false
  }
}

export async function leerSolicitud(raiz: string, caso: string): Promise<Solicitud> {
  const ruta = path.join(dirCaso(raiz, caso), "solicitud.json")
  if (!(await existe(ruta))) throw new Error(`el caso "${caso}" no existe`)
  return leerValidado(ruta, "solicitud.json", Solicitud)
}

export type Plantilla =
  | { tipo: "celdas"; celdas: Celda[] }
  | { tipo: "campos"; campos: CampoPdf[] }

/** Lee la plantilla que tenga el caso: celdas (xlsx) o campos (pdf/portal). */
export async function leerPlantilla(raiz: string, caso: string): Promise<Plantilla> {
  const dir = dirCaso(raiz, caso)
  const rutaCeldas = path.join(dir, "plantilla-celdas.json")
  if (await existe(rutaCeldas)) {
    return { tipo: "celdas", celdas: await leerValidado(rutaCeldas, "plantilla-celdas.json", z.array(Celda)) }
  }
  const rutaCampos = path.join(dir, "plantilla-campos.json")
  if (await existe(rutaCampos)) {
    return { tipo: "campos", campos: await leerValidado(rutaCampos, "plantilla-campos.json", z.array(CampoPdf)) }
  }
  throw new Error(`el caso "${caso}" no trae plantilla`)
}

export function etiquetasDe(plantilla: Plantilla): string[] {
  return plantilla.tipo === "celdas" ? plantilla.celdas.map((c) => c.etiqueta) : plantilla.campos.map((c) => c.etiqueta)
}

export async function leerSoportesExigidos(raiz: string, caso: string): Promise<string[]> {
  const ruta = path.join(dirCaso(raiz, caso), "soportes-exigidos.json")
  return leerValidado(ruta, "soportes-exigidos.json", z.array(z.string()))
}

export async function leerMaestro(raiz: string): Promise<Maestro> {
  const ruta = path.join(dirFixtures(raiz), "repositorio", "maestro.json")
  return leerValidado(ruta, "maestro.json", z.record(z.string(), z.unknown()))
}

export async function leerGlosario(raiz: string): Promise<Glosario> {
  const ruta = path.join(dirFixtures(raiz), "glosario-campos.json")
  return leerValidado(ruta, "glosario-campos.json", z.record(z.string(), z.string()))
}

export async function leerIndiceSoportes(raiz: string): Promise<Soporte[]> {
  const ruta = path.join(dirFixtures(raiz), "repositorio", "soportes", "index.json")
  return leerValidado(ruta, "soportes/index.json", z.array(Soporte))
}

export function rutaSoporte(raiz: string, archivo: string): string {
  return path.join(dirFixtures(raiz), "repositorio", "soportes", path.basename(archivo))
}
