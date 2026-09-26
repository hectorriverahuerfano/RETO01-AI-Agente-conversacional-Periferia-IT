// Front de chat sin framework: historial, tool calls visibles y confirmación resaltada.

const CASOS = ["co-industrias-delta", "ec-corp-andina", "hn-agroexport-sula", "pa-logistica-istmo"]
const $ = (id) => document.getElementById(id)

let sesionId = nuevaSesionId()
let ocupado = false

function nuevaSesionId() {
  return "s-" + crypto.randomUUID().replace(/-/g, "").slice(0, 24)
}

// --- Markdown mínimo y seguro (escapa primero, luego da formato) ---
function escapar(t) {
  return t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
}
function enLinea(t) {
  return t.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>")
}
function markdown(texto) {
  const lineas = escapar(texto).split("\n")
  const html = []
  let lista = false
  let tabla = []
  const cerrarLista = () => { if (lista) { html.push("</ul>"); lista = false } }
  const cerrarTabla = () => {
    if (!tabla.length) return
    const filas = tabla.filter((f) => !/^\|\s*-+/.test(f)).map((f) => f.replace(/^\||\|$/g, "").split("|").map((c) => enLinea(c.trim())))
    html.push("<table>" + filas.map((f, i) => "<tr>" + f.map((c) => (i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join("") + "</tr>").join("") + "</table>")
    tabla = []
  }
  for (const l of lineas) {
    if (/^\s*\|/.test(l)) { cerrarLista(); tabla.push(l.trim()); continue }
    cerrarTabla()
    const item = l.match(/^\s*[-*]\s+(.*)/)
    if (item) { if (!lista) { html.push("<ul>"); lista = true } html.push(`<li>${enLinea(item[1])}</li>`); continue }
    cerrarLista()
    const titulo = l.match(/^#{1,4}\s+(.*)/)
    if (titulo) html.push(`<p><strong>${enLinea(titulo[1])}</strong></p>`)
    else if (l.trim() === "---") html.push("<hr>")
    else if (l.trim()) html.push(`<p>${enLinea(l)}</p>`)
  }
  cerrarLista(); cerrarTabla()
  return html.join("")
}

// --- Render ---
function agregar(el) {
  $("historial").appendChild(el)
  el.scrollIntoView({ block: "end", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
}

function tarjetaTool(t) {
  const d = document.createElement("details")
  d.className = "tool" + (t.ok ? "" : " falla")
  d.innerHTML = `<summary><span>${t.ok ? "✓" : "✗"}</span><span class="nombre">${escapar(t.nombre)}</span><span class="sutil">${escapar(t.resumen)}</span></summary>` +
    `<pre>argumentos: ${escapar(JSON.stringify(t.args, null, 2))}\nresultado: ${escapar(t.resumen)}</pre>`
  return d
}

function mensaje(rol, texto, toolCalls = [], pideConfirmacion = false) {
  const div = document.createElement("div")
  div.className = `msg ${rol}${pideConfirmacion ? " pide-confirmacion" : ""}`
  if (toolCalls.length) {
    const tools = document.createElement("div")
    tools.className = "tools"
    toolCalls.forEach((t) => tools.appendChild(tarjetaTool(t)))
    div.appendChild(tools)
  }
  const contenido = document.createElement("div")
  contenido.className = "contenido"
  contenido.innerHTML = rol === "usuario" ? `<p>${escapar(texto)}</p>` : markdown(texto)
  div.appendChild(contenido)
  agregar(div)
}

function error(texto, reintentar) {
  const div = document.createElement("div")
  div.className = "msg sistema"
  div.textContent = texto + " "
  if (reintentar) {
    const b = document.createElement("button")
    b.type = "button"; b.textContent = "Reintentar"
    b.onclick = () => { div.remove(); enviar(reintentar, false) }
    div.appendChild(b)
  }
  agregar(div)
}

function setOcupado(valor) {
  ocupado = valor
  $("enviar").disabled = valor
  $("mensaje").disabled = valor
  document.querySelectorAll("#banner button, #chips button, #formCorreo button").forEach((b) => (b.disabled = valor))
  $("historial").setAttribute("aria-busy", String(valor))
}

// --- API ---
async function enviar(texto, mostrar = true) {
  if (ocupado || !texto.trim()) return
  if (mostrar) mensaje("usuario", texto)
  registrarConversacion(texto)
  $("banner").hidden = true
  $("formCorreo").hidden = true
  setOcupado(true)
  const pensando = document.createElement("div")
  pensando.className = "pensando"
  pensando.textContent = "Pensando"
  agregar(pensando)
  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: sesionId, message: texto }),
    })
    const datos = await r.json().catch(() => ({}))
    if (r.status === 401) { pensando.remove(); mostrarAcceso(SESION_EXPIRADA); return }
    if (r.status === 429) return error("Demasiadas peticiones. Espera un minuto.", texto)
    if (!r.ok) return error(datos.error || `Error ${r.status}.`, texto)
    mensaje("agente", datos.reply, datos.toolCalls || [], datos.needsConfirmation)
    $("banner").hidden = !datos.needsConfirmation
    $("formCorreo").hidden = !datos.pideCorreo
  } catch {
    error("No hay conexión con el servidor.", texto)
  } finally {
    pensando.remove()
    setOcupado(false)
    // Si la sesión expiró, el foco ya está en la clave: no se lo quitamos.
    if (!$("app").hidden) ($("formCorreo").hidden ? $("mensaje") : $("correo")).focus()
  }
}

// La sesión vive en una cookie HttpOnly: este JS nunca ve la clave guardada ni el token.
const SESION_EXPIRADA = "Tu sesión expiró. Ingresa la clave para continuar."

async function haySesion() {
  try {
    const r = await fetch("/api/sesion")
    if (!r.ok) return false
    const datos = await r.json()
    return datos.autenticado === true
  } catch { return false }
}

function errorAcceso(motivo = "", invalido = false) {
  $("errorAcceso").hidden = !motivo
  $("errorAcceso").textContent = motivo
  if (invalido) $("clave").setAttribute("aria-invalid", "true")
  else $("clave").removeAttribute("aria-invalid")
}

function mostrarAcceso(motivo = "") {
  $("app").hidden = true
  $("acceso").hidden = false
  errorAcceso(motivo)
  $("clave").value = ""
  $("clave").focus()
}

function mostrarApp() {
  $("acceso").hidden = true
  $("app").hidden = false
  $("mensaje").focus()
}

// --- Eventos ---
$("formAcceso").addEventListener("submit", async (e) => {
  e.preventDefault()
  const form = $("formAcceso")
  if (form.getAttribute("aria-busy") === "true") return
  const boton = form.querySelector('button[type="submit"]')
  const textoBoton = boton.textContent
  const clave = $("clave").value.trim()
  form.setAttribute("aria-busy", "true")
  boton.disabled = true
  boton.textContent = "Verificando…"
  let motivo = ""
  try {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clave }),
    })
    if (r.ok) { $("clave").value = ""; errorAcceso(); mostrarApp(); return }
    motivo = r.status === 401 ? "Clave incorrecta. Revísala e inténtalo de nuevo."
      : r.status === 429 ? "Demasiados intentos. Espera 1 minuto y vuelve a intentarlo."
      : `Error ${r.status}. Inténtalo de nuevo.`
  } catch {
    motivo = "No hay conexión con el servidor."
  } finally {
    form.removeAttribute("aria-busy")
    boton.disabled = false
    boton.textContent = textoBoton
  }
  errorAcceso(motivo, true)
  $("clave").focus()
  $("clave").select()
})
$("formChat").addEventListener("submit", (e) => {
  e.preventDefault()
  const texto = $("mensaje").value
  $("mensaje").value = ""
  enviar(texto)
})
$("mensaje").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("formChat").requestSubmit() }
})
$("banner").addEventListener("click", (e) => {
  const texto = e.target.closest("button")?.dataset.texto
  if (texto) enviar(texto)
})
$("formCorreo").addEventListener("submit", (e) => {
  e.preventDefault()
  const correo = $("correo").value.trim()
  if (!$("correo").checkValidity()) { $("correo").setAttribute("aria-invalid", "true"); return }
  $("correo").removeAttribute("aria-invalid")
  // El correo va literal en el mensaje: el servidor solo acepta el destinatario que escribió el usuario.
  enviar(`Envíame el paquete a ${correo}`)
})
$("cerrarSesion").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" }).catch(() => null)
  // El historial local (ids y títulos) se conserva; solo se limpia la pantalla.
  nuevaConversacion()
  mostrarAcceso("Sesión cerrada.")
})
$("nuevaSesion").addEventListener("click", nuevaConversacion)

// --- Historial de conversaciones (HU-8) ---
// En este navegador solo se guarda { id, título, fecha }; el contenido vive en el servidor.
const CLAVE_CONVERSACIONES = "reto01-conversaciones"
const MAX_CONVERSACIONES = 20

function leerConversaciones() {
  try { return JSON.parse(localStorage.getItem(CLAVE_CONVERSACIONES) || "[]") } catch { return [] }
}
function guardarConversaciones(lista) {
  try { lista.length ? localStorage.setItem(CLAVE_CONVERSACIONES, JSON.stringify(lista)) : localStorage.removeItem(CLAVE_CONVERSACIONES) } catch { /* sin almacenamiento */ }
}

/** Título corto y sin correos a partir del primer mensaje. */
function tituloDe(texto) {
  const limpio = texto.replace(/\S+@\S+/g, "[correo]").replace(/\s+/g, " ").trim()
  return limpio.length > 40 ? limpio.slice(0, 40) + "…" : limpio
}

function registrarConversacion(texto) {
  const lista = leerConversaciones()
  if (lista.some((c) => c.id === sesionId)) return
  lista.unshift({ id: sesionId, titulo: tituloDe(texto), fecha: new Date().toISOString() })
  guardarConversaciones(lista.slice(0, MAX_CONVERSACIONES))
}

function limpiarChat() {
  document.querySelectorAll("#historial .msg, #historial .pensando").forEach((n) => n.remove())
  $("banner").hidden = true
  $("formCorreo").hidden = true
}

function modoLectura(activo) {
  $("lectura").hidden = !activo
  $("formChat").hidden = activo
  $("chips").hidden = activo
}

function nuevaConversacion() {
  sesionId = nuevaSesionId()
  limpiarChat()
  modoLectura(false)
  $("mensaje").focus()
}

function pintarConversaciones() {
  const lista = leerConversaciones()
  const ul = $("listaConversaciones")
  ul.innerHTML = ""
  $("sinConversaciones").hidden = lista.length > 0
  $("borrarHistorial").hidden = lista.length === 0
  for (const c of lista) {
    const li = document.createElement("li")
    const b = document.createElement("button")
    b.type = "button"
    b.className = "secundario"
    const fecha = new Date(c.fecha).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })
    b.innerHTML = `<span>${escapar(c.titulo || "Sin título")}</span><span class="fecha">${escapar(fecha)}</span>`
    b.onclick = () => abrirConversacion(c.id)
    li.appendChild(b)
    ul.appendChild(li)
  }
}

function abrirPanel() {
  $("avisoConversacion").hidden = true
  pintarConversaciones()
  $("conversaciones").showModal()
  $("abrirConversaciones").setAttribute("aria-expanded", "true")
}

function cerrarPanel() {
  $("conversaciones").close()
}

async function abrirConversacion(id) {
  const r = await fetch(`/api/sessions/${id}`).catch(() => null)
  if (!r || r.status === 404) {
    guardarConversaciones(leerConversaciones().filter((c) => c.id !== id))
    pintarConversaciones()
    $("avisoConversacion").textContent = "Esta conversación ya no está disponible porque el servidor se reinició."
    $("avisoConversacion").hidden = false
    return
  }
  if (r.status === 401) { cerrarPanel(); mostrarAcceso(SESION_EXPIRADA); return }
  const datos = await r.json()
  cerrarPanel()
  limpiarChat()
  for (const e of datos.historial || []) {
    mensaje(e.rol === "user" ? "usuario" : "agente", e.texto, e.toolCalls || [], false)
  }
  // Solo lectura hasta que la persona decida continuar: evita confirmar pasos viejos sin querer.
  sesionId = id
  modoLectura(true)
  $("continuarConversacion").focus()
}

async function borrarHistorial() {
  if (!confirm("¿Borrar todo el historial? No se puede deshacer.")) return
  const lista = leerConversaciones()
  // También se borran del servidor: pueden contener el correo que escribió la persona.
  const respuestas = await Promise.all(lista.map((c) =>
    fetch(`/api/sessions/${c.id}`, { method: "DELETE" }).catch(() => null)))
  // Sin sesión no se borró nada en el servidor: se conserva la lista local para reintentar.
  if (respuestas.some((r) => r?.status === 401)) { cerrarPanel(); mostrarAcceso(SESION_EXPIRADA); return }
  guardarConversaciones([])
  pintarConversaciones()
  nuevaConversacion()
  cerrarPanel()
}

$("abrirConversaciones").addEventListener("click", abrirPanel)
$("cerrarConversaciones").addEventListener("click", cerrarPanel)
$("conversaciones").addEventListener("close", () => {
  $("abrirConversaciones").setAttribute("aria-expanded", "false")
  if ($("lectura").hidden) $("abrirConversaciones").focus()
})
$("borrarHistorial").addEventListener("click", borrarHistorial)
$("continuarConversacion").addEventListener("click", () => { modoLectura(false); $("mensaje").focus() })
$("salirLectura").addEventListener("click", nuevaConversacion)

for (const caso of CASOS) {
  const b = document.createElement("button")
  b.type = "button"
  b.textContent = caso
  b.onclick = () => enviar(`Procesa el caso "${caso}". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.`)
  $("chips").appendChild(b)
}

fetch("/api/health").then((r) => r.json()).then((h) => { $("modelo").textContent = `· ${h.provider} / ${h.model}` }).catch(() => {})

;(async () => {
  if (await haySesion()) mostrarApp()
  else mostrarAcceso()
})()
