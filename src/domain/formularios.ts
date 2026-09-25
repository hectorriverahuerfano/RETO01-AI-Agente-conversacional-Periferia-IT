import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import ExcelJS from "exceljs"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import type { Celda, CampoPdf, Solicitud } from "./fixtures.ts"
import { valorParaFormulario, type Mapeo } from "./mapeo.ts"

/** Fecha fija de metadatos para que los archivos sean deterministas. */
function fechaFija(fecha: string): Date {
  return new Date(`${fecha}T00:00:00Z`)
}

/** HU-3 P0: escribe etiqueta y valor exactamente en la hoja y celda de la plantilla. */
export async function generarXlsx(destino: string, celdas: Celda[], mapeo: Mapeo, fecha: string): Promise<void> {
  const libro = new ExcelJS.Workbook()
  libro.creator = "Agente Registro Proveedor"
  libro.created = fechaFija(fecha)
  libro.modified = fechaFija(fecha)
  for (const celda of celdas) {
    const hoja = libro.getWorksheet(celda.hoja) ?? libro.addWorksheet(celda.hoja)
    hoja.getCell(celda.celda_etiqueta).value = celda.etiqueta
    hoja.getCell(celda.celda_etiqueta).font = { bold: true }
    hoja.getCell(celda.celda_valor).value = valorParaFormulario(mapeo, celda.etiqueta)
  }
  libro.eachSheet((hoja) => {
    hoja.columns.forEach((col) => (col.width = 38))
  })
  await mkdir(path.dirname(destino), { recursive: true })
  await libro.xlsx.writeFile(destino)
}

/** Las fuentes estándar de PDF usan WinAnsi: se reemplazan los caracteres que no puede dibujar. */
export function sanearWinAnsi(texto: string): string {
  return texto
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?")
}

/** HU-3 P1: PDF generado con todos los campos, etiqueta y valor, en el orden de la plantilla. */
export async function generarPdf(destino: string, campos: CampoPdf[], mapeo: Mapeo, solicitud: Solicitud, fecha: string): Promise<void> {
  const doc = await PDFDocument.create()
  doc.setCreationDate(fechaFija(fecha))
  doc.setModificationDate(fechaFija(fecha))
  doc.setTitle(sanearWinAnsi(`Formulario de proveedor - ${solicitud.cliente}`))
  const normal = await doc.embedFont(StandardFonts.Helvetica)
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold)
  let pagina = doc.addPage([595, 842])
  let y = 790
  const escribir = (texto: string, tam: number, fuente = normal, color = rgb(0, 0, 0)) => {
    if (y < 60) {
      pagina = doc.addPage([595, 842])
      y = 790
    }
    pagina.drawText(sanearWinAnsi(texto), { x: 50, y, size: tam, font: fuente, color, maxWidth: 495 })
    y -= tam + 10
  }
  escribir(`Formulario de registro de proveedor`, 16, negrita)
  escribir(`Cliente: ${solicitud.cliente} (${solicitud.pais})`, 10, normal, rgb(0.3, 0.3, 0.3))
  y -= 8
  for (const campo of campos) {
    const marca = campo.obligatorio ? " *" : ""
    escribir(`${campo.etiqueta}${marca}`, 10, negrita)
    escribir(valorParaFormulario(mapeo, campo.etiqueta) || "(sin dato)", 11)
    y -= 4
  }
  escribir("* Campo obligatorio. Documento preparado para firma del representante legal.", 8, normal, rgb(0.4, 0.4, 0.4))
  await mkdir(path.dirname(destino), { recursive: true })
  await writeFile(destino, await doc.save({ useObjectStreams: false }))
}

/** HU-3 P2: el portal no se automatiza; se dejan los valores listos para copiar. */
export async function generarValoresPortal(destino: string, campos: CampoPdf[], mapeo: Mapeo, solicitud: Solicitud): Promise<void> {
  const filas = campos.map((c) => {
    const valor = valorParaFormulario(mapeo, c.etiqueta) || "_(faltante)_"
    const confirmar = mapeo.requiere_confirmacion.some((r) => r.etiqueta === c.etiqueta) ? " ⚠️ confirmar" : ""
    return `| ${c.etiqueta}${c.obligatorio ? " *" : ""} | ${valor}${confirmar} |`
  })
  const contenido = [
    `# Valores para el portal de ${solicitud.cliente}`,
    "",
    "> Formato no soportado para automatización: el portal lo opera una persona.",
    "> Las credenciales las ingresa el humano; este agente no las pide ni las guarda.",
    "",
    "| Campo | Valor |",
    "|---|---|",
    ...filas,
    "",
    "\\* Campo obligatorio.",
    "",
  ].join("\n")
  await mkdir(path.dirname(destino), { recursive: true })
  await writeFile(destino, contenido, "utf8")
}
