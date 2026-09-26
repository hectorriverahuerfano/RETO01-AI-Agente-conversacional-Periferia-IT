# Agente conversacional "Registro como Proveedor"

Reto técnico 01 · Periferia IT Group. Un agente de chat que lee la solicitud de un cliente, llena el formulario desde el repositorio maestro, arma el paquete para firma y **nunca envía nada sin confirmación humana**.

- **Link de prueba:** https://reto01-registro-proveedor.onrender.com
- **Clave de acceso al link:** `periferia-reto01`

> Render (plan gratuito) puede tardar unos 50 s en responder la primera vez si el servicio estaba dormido. Un workflow de GitHub Actions lo mantiene despierto con un ping cada 5 minutos.

## Requisitos

- Node.js 20 o superior (probado con Node 24). Bun también funciona.
- Una clave de Anthropic, u Ollama corriendo en local.

## Levantar en local (un comando)

```bash
cp .env.example .env   # completa ANTHROPIC_API_KEY y ACCESS_KEY
npm install && npm start
```

Abre http://localhost:3000 e ingresa tu `ACCESS_KEY`. Con `npm run dev` el servidor se recarga al guardar cambios.

## Verificación sin modelo

```bash
npm run demo          # equivalente: bun run demo.ts
```

Limpia `out/`, procesa los 4 casos de `fixtures/reto-01/casos/` llamando directamente a las herramientas y ejecuta 39 verificaciones: conteos por caso, vigencias, datos bancarios fuera del borrador, errores (caso inexistente, path traversal, plantilla corrupta, envío sin confirmación) y sincronía del módulo. Sale con código distinto de 0 si algo falla. No necesita clave.

## Variables de entorno

| Variable | Uso |
|---|---|
| `LLM_PROVIDER` | `anthropic` (por defecto) u `ollama` |
| `LLM_MODEL` | `claude-sonnet-5`, o por ejemplo `qwen2.5-coder:7b` con Ollama |
| `ANTHROPIC_API_KEY` | Clave del modelo. Solo vive en el backend |
| `OLLAMA_URL` | URL de Ollama (local) |
| `ACCESS_KEY` | Protege `/api/chat` y `/api/sessions`. Obligatoria |
| `FECHA_EJECUCION` | Fecha para evaluar vigencias (`2026-09-25`). Vacía = hoy |
| `MAX_ITER` | Tope de iteraciones herramienta → modelo por turno (25) |
| `MAX_TOKENS_SESION` | Tope de tokens por sesión (150000) |
| `RATE_LIMIT_POR_MIN` | Peticiones por minuto por IP (10) |
| `LLM_TIMEOUT_MS` | Timeout al proveedor (60000) |

## Copia real por correo (opcional, HU-7)

Extensión fuera del PRD, apagada por defecto. Tras el envío simulado, el chat ofrece enviar el paquete (formulario sin datos bancarios, checklist y soportes) al correo que la persona escriba.

1. En Google Cloud: habilita Gmail API y crea un cliente OAuth tipo **App de escritorio** (usa `http://localhost` sin registrar URIs).
2. Pon `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` y `GMAIL_FROM` en `.env` y ejecuta `npm run gmail-auth` una vez.
3. Copia el refresh token impreso en `GMAIL_REFRESH_TOKEN` y activa `GMAIL_ENABLED=true`.

Topes: 3 correos por sesión y 10 por día (`CORREO_MAX_SESION`, `CORREO_MAX_DIA`); lista opcional de dominios (`EMAIL_DOMINIOS_PERMITIDOS`). `/api/health` indica `correo: true` cuando está activo.

## API

La clave de acceso se envía en el header `x-access-key`.

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | Historial completo de la sesión |
| `DELETE` | `/api/sessions/:id` | Borra la conversación del servidor (204 exista o no) |
| `GET` | `/api/health` | `{ ok: true, provider, model }` (sin clave de acceso) |

## Estructura

```
agent/prompt.md                  comportamiento (system prompt)
src/knowledge/                   conocimiento: proceso y reglas de negocio (reglas.json)
src/tools/proveedor.ts           ejecución: las 5 herramientas proveedor_*
src/domain/                      lógica pura que usan las herramientas
src/llm/                         adaptador propio + Anthropic + Ollama
src/agent/                       ciclo del agente y sesiones
src/server.ts                    API HTTP y front estático
web/                             chat (HTML + JS sin framework)
modulo/                          bonus: agente empaquetado (generado con npm run sync-modulo)
demo.ts                          verificación sin modelo
.claude/                         agentes y skills de Claude Code usados para construir
hojaruta.md                      hoja de ruta del reto
```

## Prompt de prueba

```
Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles
faltan, si el paquete está listo para firma y qué soportes debo actualizar.
No envíes nada todavía.
```

Luego escribe `envía` (o usa el botón **Confirmar envío**) y se genera solo `out/ec-corp-andina/ENVIO-SIMULADO.md`.
