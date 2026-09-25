import { copyFile, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { rutaSoporte, type Maestro, type Soporte, type Solicitud } from "./fixtures.ts"
import type { Mapeo } from "./mapeo.ts"
import { valorPorRuta } from "./mapeo.ts"

export type EstadoSoporte = "vigente" | "por_vencer" | "vencido" | "ausente"

export interface ItemChecklist {
  tipo: string
  estado: EstadoSoporte
  archivo?: string
  vigencia_hasta?: string | null
  nota?: string
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000)
}

/** RN3: vencido o ausente bloquea la firma. vigencia null = no vence. */
export function evaluarSoportes(exigidos: string[], indice: Soporte[], fecha: string, diasAlerta: number): ItemChecklist[] {
  return exigidos.map((tipo) => {
    const soporte = indice.find((s) => s.tipo === tipo)
    if (!soporte) return { tipo, estado: "ausente", nota: "No existe en repositorio/soportes." }
    const base = { tipo, archivo: soporte.archivo, vigencia_hasta: soporte.vigencia_hasta }
    if (!soporte.vigencia_hasta) return { ...base, estado: "vigente", nota: "Sin fecha de vencimiento." }
    const dias = diasEntre(fecha, soporte.vigencia_hasta)
    if (dias < 0) return { ...base, estado: "vencido", nota: `Venció el ${soporte.vigencia_hasta}. Debe actualizarse.` }
    if (dias <= diasAlerta) return { ...base, estado: "por_vencer", nota: `Vence en ${dias} días.` }
    return { ...base, estado: "vigente" }
  })
}

export function bloquea(item: ItemChecklist): boolean {
  return item.estado === "vencido" || item.estado === "ausente"
}

export async function copiarSoportes(raiz: string, dirPaquete: string, items: ItemChecklist[]): Promise<void> {
  const destino = path.join(dirPaquete, "soportes")
  await rm(destino, { recursive: true, force: true })
  await mkdir(destino, { recursive: true })
  for (const item of items) {
    if (item.archivo && item.estado !== "ausente") {
      await copyFile(rutaSoporte(raiz, item.archivo), path.join(destino, path.basename(item.archivo)))
    }
  }
}

const ICONO: Record<EstadoSoporte, string> = { vigente: "✅", por_vencer: "⚠️", vencido: "❌", ausente: "❌" }

export function checklistMd(solicitud: Solicitud, items: ItemChecklist[], mapeo: Mapeo, formulario: string | null, listo: boolean, fecha: string): string {
  const soportes = items.map((i) => `- ${ICONO[i.estado]} **${i.tipo}** — ${i.estado}${i.vigencia_hasta ? ` (vigencia ${i.vigencia_hasta})` : ""}${i.nota ? `. ${i.nota}` : ""}`)
  const faltantes = mapeo.faltantes.map((c) => `- ${c.etiqueta}: ${c.nota ?? "sin fuente"}`)
  const confirmar = mapeo.requiere_confirmacion.map((c) => `- ${c.etiqueta}: ${c.nota ?? "revisar"}`)
  return [
    `# Checklist — ${solicitud.cliente}`,
    "",
    `Fecha de evaluación: ${fecha}`,
    `Estado: **${listo ? "LISTO PARA FIRMA" : "NO LISTO PARA FIRMA"}**`,
    "",
    "## Formulario",
    formulario ? `- ✅ ${formulario}` : "- ❌ No se ha generado el formulario.",
    "",
    "## Soportes exigidos",
    ...soportes,
    "",
    `## Campos faltantes (${faltantes.length}) — no bloquean, deben completarse a mano`,
    ...(faltantes.length ? faltantes : ["- Ninguno."]),
    "",
    `## Campos por confirmar (${confirmar.length})`,
    ...(confirmar.length ? confirmar : ["- Ninguno."]),
    "",
  ].join("\n")
}

/** RN2: el borrador nunca incluye datos bancarios. Se arma con plantilla fija, no con texto del modelo. */
export function borradorCorreoMd(solicitud: Solicitud, maestro: Maestro, items: ItemChecklist[], formulario: string | null): string {
  const razon = valorPorRuta(maestro, "razon_social") ?? "Periferia IT Group"
  const firmante = valorPorRuta(maestro, "representante_legal.nombre") ?? "Representante legal"
  const adjuntos = [formulario ? path.basename(formulario) : null, ...items.filter((i) => i.archivo && !bloquea(i)).map((i) => i.archivo)]
    .filter((a): a is string => Boolean(a))
    .map((a) => `- ${a}`)
  return [
    `**Para:** ${solicitud.de}`,
    `**Asunto:** RE: ${solicitud.asunto}`,
    "",
    "Buen día,",
    "",
    `En atención a su solicitud, remitimos la documentación de ${razon} para el registro como proveedor de ${solicitud.cliente}.`,
    "",
    "Adjuntos:",
    ...adjuntos,
    "",
    "Quedamos atentos a cualquier información adicional.",
    "",
    "Cordialmente,",
    "",
    firmante,
    razon,
    "",
    "---",
    "_Borrador generado por el agente. Requiere revisión y firma humana antes de enviarse._",
    "",
  ].join("\n")
}

export async function escribir(ruta: string, contenido: string): Promise<void> {
  await mkdir(path.dirname(ruta), { recursive: true })
  await writeFile(ruta, contenido, "utf8")
}
