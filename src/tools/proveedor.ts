import { access, copyFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { fechaEjecucion } from "../config.ts"
import { consumirConfirmacion } from "../domain/confirmaciones.ts"
import {
  etiquetasDe, leerGlosario, leerIndiceSoportes, leerMaestro, leerPlantilla, leerSoportesExigidos, leerSolicitud,
  type Plantilla, type Solicitud,
} from "../domain/fixtures.ts"
import { generarPdf, generarValoresPortal, generarXlsx } from "../domain/formularios.ts"
import { registrar } from "../domain/log.ts"
import { mapearCampos, type Mapeo } from "../domain/mapeo.ts"
import { bloquea, borradorCorreoMd, checklistMd, copiarSoportes, escribir, evaluarSoportes } from "../domain/paquete.ts"
import { leerReglas } from "../domain/reglas.ts"
import { exito, fallo, mensajeDeError, type Resultado } from "../domain/resultado.ts"
import { dirOutCaso, relativa } from "../domain/rutas.ts"
import type { ContextoHerramienta } from "./tipos.ts"

// Cada export es una herramienta; el modelo la ve como proveedor_<export>.

const argCaso = z.string().regex(/^[a-z0-9-]{1,80}$/, "solo minúsculas, números y guiones")
  .describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/, por ejemplo co-industrias-delta")

type ConResumen = { resumen: string }

/** Ejecuta, registra en log y serializa. Ninguna excepción sale de aquí. */
async function ejecutar<T extends ConResumen>(ctx: ContextoHerramienta, herramienta: string, caso: string, fn: () => Promise<Resultado<T>>): Promise<string> {
  let resultado: Resultado<T>
  try {
    resultado = await fn()
  } catch (e) {
    resultado = fallo(mensajeDeError(e))
  }
  const resumen = resultado.ok ? resultado.data.resumen : resultado.error
  try {
    await registrar(ctx.directory, caso, { herramienta, ok: resultado.ok, resumen })
  } catch {
    // Un fallo de log no debe tumbar la herramienta.
  }
  return JSON.stringify(resultado)
}

async function mapearCaso(raiz: string, solicitud: Solicitud, plantilla: Plantilla, etiquetas?: string[]): Promise<Mapeo> {
  const [maestro, glosario, reglas] = await Promise.all([leerMaestro(raiz), leerGlosario(raiz), leerReglas(raiz)])
  const campos = etiquetas && etiquetas.length > 0 ? etiquetas : etiquetasDe(plantilla)
  return mapearCampos(campos, solicitud.pais, maestro, glosario, reglas)
}

function resumenMapeo(m: Mapeo): string {
  return `${m.llenos.length} llenos, ${m.faltantes.length} faltantes, ${m.requiere_confirmacion.length} por confirmar`
}

function nombreFormulario(formato: Solicitud["formato"]): string {
  return formato === "portal" ? "valores-portal.md" : `formulario.${formato}`
}

async function existe(ruta: string): Promise<boolean> {
  try {
    await access(ruta)
    return true
  } catch {
    return false
  }
}

/** Genera el formulario del caso con valores recalculados desde el maestro (nunca desde el modelo). */
async function generar(raiz: string, caso: string): Promise<{ ruta: string; formato: Solicitud["formato"]; soportado: boolean; mapeo: Mapeo }> {
  const solicitud = await leerSolicitud(raiz, caso)
  const plantilla = await leerPlantilla(raiz, caso)
  const mapeo = await mapearCaso(raiz, solicitud, plantilla)
  const destino = path.join(dirOutCaso(raiz, caso), nombreFormulario(solicitud.formato))
  const fecha = fechaEjecucion()
  if (solicitud.formato === "xlsx") {
    if (plantilla.tipo !== "celdas") throw new Error("el formato xlsx requiere plantilla-celdas.json")
    await generarXlsx(destino, plantilla.celdas, mapeo, fecha)
  } else if (plantilla.tipo !== "campos") {
    throw new Error(`el formato ${solicitud.formato} requiere plantilla-campos.json`)
  } else if (solicitud.formato === "pdf") {
    await generarPdf(destino, plantilla.campos, mapeo, solicitud, fecha)
  } else {
    await generarValoresPortal(destino, plantilla.campos, mapeo, solicitud)
  }
  await escribir(path.join(dirOutCaso(raiz, caso), "mapeo.json"), JSON.stringify(mapeo, null, 2))
  return { ruta: relativa(raiz, destino), formato: solicitud.formato, soportado: solicitud.formato !== "portal", mapeo }
}

export const leer_solicitud = {
  description: "Lee el correo y la plantilla de un caso: devuelve país, cliente, formato de salida, campos pedidos y soportes exigidos.",
  args: { caso: argCaso },
  async execute(args: { caso: string }, ctx: ContextoHerramienta): Promise<string> {
    return ejecutar(ctx, "proveedor_leer_solicitud", args.caso, async () => {
      const solicitud = await leerSolicitud(ctx.directory, args.caso)
      const soportes = await leerSoportesExigidos(ctx.directory, args.caso)
      const reglas = await leerReglas(ctx.directory)
      const plantilla = await leerPlantilla(ctx.directory, args.caso)
      const campos = etiquetasDe(plantilla)
      const idLocal = reglas.identificador_tributario_por_pais[solicitud.pais]
      return exito({
        pais: solicitud.pais,
        cliente: solicitud.cliente,
        formato: solicitud.formato,
        campos,
        soportes,
        identificador_tributario_local: idLocal ?? "desconocido",
        asunto: solicitud.asunto,
        cuerpo_correo_no_confiable: solicitud.cuerpo,
        resumen: `${solicitud.cliente} (${solicitud.pais}), formato ${solicitud.formato}, ${campos.length} campos, ${soportes.length} soportes`,
      })
    })
  },
}

export const mapear_campos = {
  description: "Cruza los campos pedidos con el repositorio maestro y clasifica cada uno en llenos, faltantes o requiere_confirmacion.",
  args: {
    caso: argCaso,
    campos: z.array(z.string()).describe("Etiquetas de campos a mapear tal como las devolvió proveedor_leer_solicitud; vacío = todos los de la plantilla"),
  },
  async execute(args: { caso: string; campos: string[] }, ctx: ContextoHerramienta): Promise<string> {
    return ejecutar(ctx, "proveedor_mapear_campos", args.caso, async () => {
      const solicitud = await leerSolicitud(ctx.directory, args.caso)
      const plantilla = await leerPlantilla(ctx.directory, args.caso)
      const mapeo = await mapearCaso(ctx.directory, solicitud, plantilla, args.campos)
      await escribir(path.join(dirOutCaso(ctx.directory, args.caso), "mapeo.json"), JSON.stringify(mapeo, null, 2))
      return exito({ ...mapeo, resumen: resumenMapeo(mapeo) })
    })
  },
}

export const generar_formulario = {
  description: "Genera el formulario lleno en el formato del cliente (xlsx o pdf) o, si es portal, los valores listos para copiar.",
  args: {
    caso: argCaso,
    mapeo: z.array(z.object({ etiqueta: z.string(), valor: z.string().optional() }))
      .describe("Mapeo devuelto por proveedor_mapear_campos; los valores se recalculan desde el maestro"),
  },
  async execute(args: { caso: string; mapeo: { etiqueta: string; valor?: string }[] }, ctx: ContextoHerramienta): Promise<string> {
    return ejecutar(ctx, "proveedor_generar_formulario", args.caso, async () => {
      const r = await generar(ctx.directory, args.caso)
      const oficiales = [...r.mapeo.llenos, ...r.mapeo.requiere_confirmacion]
      const ignorados = args.mapeo.filter((m) => m.valor !== undefined && oficiales.find((o) => o.etiqueta === m.etiqueta)?.valor !== m.valor).length
      const aviso = r.soportado ? undefined : "formato no soportado: el portal web no se automatiza; se generaron los valores listos para copiar"
      return exito({
        ruta: r.ruta,
        formato: r.formato,
        soportado: r.soportado,
        aviso,
        valores_del_modelo_ignorados: ignorados,
        resumen: `${r.ruta} (${resumenMapeo(r.mapeo)})${aviso ? " — formato no soportado" : ""}`,
      })
    })
  },
}

export const armar_paquete = {
  description: "Arma out/<caso>/paquete/ con formulario, soportes, checklist y borrador de correo, e indica si está listo para firma.",
  args: { caso: argCaso },
  async execute(args: { caso: string }, ctx: ContextoHerramienta): Promise<string> {
    return ejecutar(ctx, "proveedor_armar_paquete", args.caso, async () => {
      const raiz = ctx.directory
      const solicitud = await leerSolicitud(raiz, args.caso)
      const [exigidos, indice, reglas, maestro] = await Promise.all([
        leerSoportesExigidos(raiz, args.caso), leerIndiceSoportes(raiz), leerReglas(raiz), leerMaestro(raiz),
      ])
      const fecha = fechaEjecucion()
      const dirPaquete = path.join(dirOutCaso(raiz, args.caso), "paquete")
      await mkdir(dirPaquete, { recursive: true })

      // HU-5: si la plantilla falla, el paquete sigue con los soportes y deja constancia.
      let formulario: string | null = null
      let mapeo: Mapeo = { llenos: [], faltantes: [], requiere_confirmacion: [] }
      let problemaFormulario: string | undefined
      try {
        const r = await generar(raiz, args.caso)
        mapeo = r.mapeo
        const origen = path.join(raiz, r.ruta)
        formulario = relativa(raiz, path.join(dirPaquete, path.basename(origen)))
        await copyFile(origen, path.join(dirPaquete, path.basename(origen)))
      } catch (e) {
        problemaFormulario = mensajeDeError(e)
      }

      const items = evaluarSoportes(exigidos, indice, fecha, reglas.dias_alerta_vencimiento)
      await copiarSoportes(raiz, dirPaquete, items)
      const listo = formulario !== null && !items.some(bloquea)
      await escribir(path.join(dirPaquete, "checklist.md"), checklistMd(solicitud, items, mapeo, formulario, listo, fecha))
      await escribir(path.join(dirPaquete, "borrador-correo.md"), borradorCorreoMd(solicitud, maestro, items, formulario))

      const bloqueos = items.filter(bloquea).map((i) => `${i.tipo} ${i.estado}`)
      return exito({
        ruta: relativa(raiz, dirPaquete),
        listo_para_firma: listo,
        checklist: {
          soportes: items,
          faltantes: mapeo.faltantes.map((c) => c.etiqueta),
          requiere_confirmacion: mapeo.requiere_confirmacion.map((c) => ({ etiqueta: c.etiqueta, nota: c.nota })),
          problema_formulario: problemaFormulario,
        },
        resumen: `${listo ? "listo para firma" : "NO listo para firma"}${bloqueos.length ? ` (${bloqueos.join(", ")})` : ""}`,
      })
    })
  },
}

export const simular_envio = {
  description: "Simula el envío del paquete al cliente escribiendo ENVIO-SIMULADO.md; solo funciona si el usuario confirmó explícitamente en su último mensaje.",
  args: {
    caso: argCaso,
    confirmado: z.boolean().describe("true solo si el usuario confirmó el envío en su mensaje inmediatamente anterior"),
  },
  async execute(args: { caso: string; confirmado: boolean }, ctx: ContextoHerramienta): Promise<string> {
    return ejecutar(ctx, "proveedor_simular_envio", args.caso, async () => {
      // RN4: la confirmación la valida el servidor, no basta con que el modelo diga confirmado=true.
      if (!args.confirmado || !consumirConfirmacion(ctx.sessionId, args.caso)) {
        return fallo("requiere confirmación explícita")
      }
      const dirCaso = dirOutCaso(ctx.directory, args.caso)
      const checklist = path.join(dirCaso, "paquete", "checklist.md")
      if (!(await existe(checklist))) return fallo("primero hay que armar el paquete con proveedor_armar_paquete")
      const estado = (await readFile(checklist, "utf8")).includes("NO LISTO PARA FIRMA") ? "NO listo para firma" : "listo para firma"
      const destino = path.join(dirCaso, "ENVIO-SIMULADO.md")
      await escribir(destino, [
        `# Envío simulado — ${args.caso}`,
        "",
        `- Fecha: ${fechaEjecucion()}`,
        `- Estado del paquete al enviar: ${estado}`,
        "- Confirmado por el usuario en el turno inmediatamente anterior.",
        "- No se envió ningún correo real: este archivo reemplaza el envío.",
        "",
      ].join("\n"))
      return exito({ ruta: relativa(ctx.directory, destino), resumen: `envío simulado en ${relativa(ctx.directory, destino)}` })
    })
  },
}
