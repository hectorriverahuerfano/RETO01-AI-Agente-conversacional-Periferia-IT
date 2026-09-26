// Front de chat sin framework: historial, tool calls visibles y confirmación resaltada.

const CASOS = ["co-industrias-delta", "ec-corp-andina", "hn-agroexport-sula", "pa-logistica-istmo"]
const CLAVE_ALMACEN = "reto01-clave"
const $ = (id) => document.getElementById(id)

let sesionId = nuevaSesionId()
let ocupado = false

function nuevaSesionId() {
  return "s-" + crypto.randomUUID().replace(/-/g, "").slice(0, 24)
}

function leerClave() {
  try { return sessionStorage.getItem(CLAVE_ALMACEN) || "" } catch { return "" }
}
function guardarClave(valor) {
  try { valor ? sessionStorage.setItem(CLAVE_ALMACEN, valor) : sessionStorage.removeItem(CLAVE_ALMACEN) } catch { /* sin almacenamiento */ }
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
      headers: { "content-type": "application/json", "x-access-key": leerClave() },
      body: JSON.stringify({ sessionId: sesionId, message: texto }),
    })
    const datos = await r.json().catch(() => ({}))
    if (r.status === 401) { pensando.remove(); mostrarAcceso("La clave de acceso ya no es válida."); return }
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
    ;($("formCorreo").hidden ? $("mensaje") : $("correo")).focus()
  }
}

async function validarClave(clave) {
  const r = await fetch(`/api/sessions/${sesionId}`, { headers: { "x-access-key": clave } })
  return r.status !== 401 && r.status !== 503
}

function mostrarAcceso(motivo = "") {
  $("app").hidden = true
  $("acceso").hidden = false
  $("errorAcceso").hidden = !motivo
  $("errorAcceso").textContent = motivo
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
  const clave = $("clave").value.trim()
  if (await validarClave(clave)) { guardarClave(clave); mostrarApp() }
  else mostrarAcceso("Clave incorrecta.")
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
$("cambiarClave").addEventListener("click", () => { guardarClave(""); mostrarAcceso() })
$("nuevaSesion").addEventListener("click", () => {
  sesionId = nuevaSesionId()
  document.querySelectorAll("#historial .msg, #historial .pensando").forEach((n) => n.remove())
  $("banner").hidden = true
  $("formCorreo").hidden = true
  $("mensaje").focus()
})

for (const caso of CASOS) {
  const b = document.createElement("button")
  b.type = "button"
  b.textContent = caso
  b.onclick = () => enviar(`Procesa el caso "${caso}". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.`)
  $("chips").appendChild(b)
}

fetch("/api/health").then((r) => r.json()).then((h) => { $("modelo").textContent = `· ${h.provider} / ${h.model}` }).catch(() => {})

;(async () => {
  const clave = leerClave()
  if (clave && (await validarClave(clave))) mostrarApp()
  else mostrarAcceso()
})()
