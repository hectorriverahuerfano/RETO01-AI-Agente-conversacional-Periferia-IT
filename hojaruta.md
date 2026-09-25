# Hoja de ruta — Reto 01 · Registro como Proveedor

Checklist de recursos a conseguir **antes** de iniciar el reloj de 2 horas, más el plan de ejecución.

> ⚠️ **Nunca escribas aquí tu API key ni contraseñas.** Solo marca si ya las tienes listas. La clave va en tu `.env` local y en el panel de Render.

---

## Checklist de arranque

### 1 · Proveedor de LLM y API key — *Obligatorio*
Sin clave no hay agente en el link. Recomendado: **Anthropic**.

- Proveedor: `__________` (Anthropic · OpenAI · Google · Azure OpenAI · Mistral · Local)
- Modelo: `__________` (ej. `claude-sonnet-5`)
- [ ] Tengo la API key generada y con saldo
- [ ] Configuré un tope de gasto en la consola del proveedor *(opcional, recomendado)*

### 2 · GitHub y Render — *Obligatorio*
Render mantiene un proceso vivo, así que las sesiones en memoria y la carpeta `out/` funcionan. Sin link: **−10 puntos**.

- Usuario de GitHub: `__________`
- URL del repo (si ya existe): `__________`
- [ ] Puedo hacer `git push` desde esta máquina (credenciales HTTPS listas)
- [ ] Cuenta de Render creada y verificada
- [ ] Render autorizado para leer mis repos de GitHub

### 3 · Runtime local — *Obligatorio*
Detectado: Node v24.15, npm 11.12, git 2.54. **Bun no está instalado.**

- [ ] Node + tsx *(recomendado)*
- [ ] Instalar Bun (el PRD usa `bun run`)
- [ ] Verifiqué en la terminal: `node --version` (o `bun --version`) responde

### 4 · Fecha de referencia de vigencias — *Obligatorio*
La Cámara de Comercio vence el **2026-09-30**. Si la defensa es después y usamos la fecha real, todos los casos quedan bloqueados y `demo.ts` deja de dar el mismo resultado en cada corrida.

- `FECHA_EJECUCION`: `2026-09-25`
- Fecha de la defensa (si la sabes): `__________`

### 5 · Protección del link — *Decisión*
Un link público gasta tu clave. Una clave de acceso simple, documentada en el README, cuesta unos 10 min.

- [x] Sí, proteger con clave de acceso *(recomendado)*
- [ ] No, link abierto (solo topes de tokens e iteraciones)

| Tope | Valor propuesto |
|---|---|
| Iteraciones por turno | 25 |
| Tokens por sesión | 50 000 |
| Peticiones por minuto por IP | 10 |

### 6 · Alcance — *Decisión*
Si el tiempo aprieta, se recorta primero el bonus y luego el PDF. El xlsx, el paquete, la confirmación y el link no se tocan.

- [x] Incluir PDF (P1)
- [x] Incluir `simular_envio` con confirmación (P1)
- [ ] Intentar el bonus `modulo/` (+10) si sobran los últimos 10 min

### 7 · Forma de entrega — *Obligatorio*
- Apellido (para el zip): `__________` → `reto-01-<apellido>.zip`
- Formato:
  - [x] Repo Git con commits + zip de respaldo *(recomendado)*
  - [ ] Solo repo Git
  - [ ] Solo zip
- [x] Haré commits por hito (5–6 commits)

### 8 · Reloj de 2 horas — *Obligatorio*
Lo ideal es tener los pasos 1 a 3 listos **antes** de iniciar el reloj.

- [ ] Aún no he iniciado el reloj
- [ ] Ya inicié el reloj → hora de inicio: `__:__` · hora límite: `__:__` (+2 h)

### 9 · Validación
Todo listo cuando estén marcados:

- [ ] Proveedor LLM elegido
- [ ] Modelo definido
- [ ] API key lista (fuera de este documento)
- [ ] Usuario GitHub
- [ ] `git push` funciona
- [ ] Cuenta Render
- [ ] Render conectado a GitHub
- [ ] Runtime verificado
- [ ] `FECHA_EJECUCION` fijada
- [ ] Apellido para el zip
- [ ] Reloj definido (no iniciado, o iniciado con hora)

Cuando esté completo, pega este resumen en el chat para arrancar:

```
Hoja de ruta Reto 01 — estado: LISTO PARA ARRANCAR
1. LLM: <proveedor> / <modelo> · key lista: sí · tope gasto: <sí/no>
2. GitHub: <usuario> · push: sí · Render: sí · Render↔GitHub: sí
3. Runtime: <Node + tsx / Bun> · verificado: sí
4. FECHA_EJECUCION: 2026-09-25 · defensa: <fecha>
5. Clave de acceso al link: <sí/no> · topes: 25 iter/turno, 50000 tokens/sesión, 10 req/min
6. Alcance: PDF sí · simular_envio sí · bonus modulo/ <sí/no>
7. Entrega: <formato> · apellido: <apellido> · commits por hito: sí
8. Reloj: <no iniciado / iniciado HH:MM → límite HH:MM>
```

---

## Resultado esperado por caso

| Caso | Formato | Llenos / Faltantes / Confirmar | Listo para firma |
|---|---|---|---|
| `co-industrias-delta` | xlsx | 17 / 0 / 0 | ✅ Sí — advertir que la Cámara debe tener ≤ 30 días |
| `ec-corp-andina` | pdf | 13 / 1 / 1 (RUC) | ❌ No — falta el certificado de cumplimiento tributario |
| `hn-agroexport-sula` | xlsx | 9 / 1 / 1 (RTN) | ❌ No — parafiscales vencidos el 31-ago |
| `pa-logistica-istmo` | portal | 8 / 0 / 1 (RUC) | N/A — solo `valores-portal.md` |

---

## Hoja de ruta (120 min)

| Min | Entregable | Agentes |
|---|---|---|
| 0–10 | Scaffold, `.gitignore`, `.env.example`, `/api/health` desplegado en Render | Salen · Oreo |
| 10–45 | 5 tools `proveedor_*`, reglas RN1–RN5, logs; conocimiento en `src/knowledge/` | Luna · Simon |
| 45–55 | `demo.ts` con verificaciones por caso, errores HU-5 y determinismo | Coco |
| 55–75 | Adaptador LLM, `agent/prompt.md`, ciclo con topes y `pendingConfirmation` | Kira · Luna |
| 75–90 | Front HTML: tarjetas de tools, banner de confirmación, botones de casos | Charlotte · Salen |
| 90–100 | Variables en Render, clave de acceso, prueba E2E con el prompt de la sección 11 | Oreo · Max |
| 100–115 | `SOLUCION.md` (10 secciones + diseño del portal) y README | Simon · Kira |
| 115–120 | Revisión final, `modulo/` si hay tiempo, entrega | Lucy · Oreo |

Lucy revisa en los minutos 25, 55, 85 y 105.

---

# Plan final v3 — validado por los 9 agentes

**Veredicto:** 8 × *GO con ajustes* (Simon, Kira, Charlotte, Luna, Salen, Lucy, Coco, Max) + Oreo *APPROVED_WITH_WARNINGS*.

## Recursos confirmados
| Recurso | Estado |
|---|---|
| Anthropic API key (link en Render) | ✅ |
| Ollama `qwen2.5-coder:7b` (pruebas locales) | ✅ |
| GitHub `hectorriverahuerfano/RETO01-AI-Agente-conversacional-Periferia-IT` (público, vacío) | ✅ (escritura se confirma en el primer push) |
| Render free + UptimeRobot (ping cada 5 min a `/api/health`) | ✅ |
| Commits como `Hector Rivera <hector58472@gmail.com>` · zip `reto-01-rivera.zip` | ✅ |
| Revocar token classic `ghp_…` | ❌ pendiente (Hector) |

## Stack
Node 24 + tsx (en `dependencies`) · TypeScript strict + `tsc --noEmit` · ESM · Hono + `@hono/node-server` (API + `web/` estático, `0.0.0.0:$PORT`) · zod (`z.toJSONSchema`) · exceljs · pdf-lib · `@anthropic-ai/sdk` · Ollama vía `fetch`.
Render: build `npm ci && npm run typecheck`, start `npm start`, `NODE_VERSION=24`, `LLM_PROVIDER=anthropic`, health `/api/health`. `package-lock.json` commiteado.

## Ajustes incorporados
| # | Ajuste | Pidió |
|---|---|---|
| A1 | **Formato interno único** de mensajes (`tool_call{id,nombre,args}` / `tool_result{id,contenido}`); cada adaptador traduce (Anthropic: `tool_use`/`tool_result` + system aparte; Ollama: `tool_calls`, id propio, `role:"tool"`, `temperature:0`). Un solo registro de tools. Conteo de tokens unificado. `AbortController` con `LLM_TIMEOUT_MS`. | Kira, Salen, Luna |
| A2 | **Contratos exactos del PRD**: tool = `{description, args, execute(args, ctx)}`, nombre `proveedor_<export>`, validación zod antes de ejecutar; API `POST /api/chat {sessionId, message} → {reply, toolCalls[], needsConfirmation}`; `/api/health → {ok, provider, model}`. | Lucy, Salen |
| A3 | **Confianza**: normalizar etiqueta **y** claves del glosario; exacta = 1.0 → `lleno`; similitud por tokens ≥ 0.8 → `lleno`, 0.5–0.8 → `requiere_confirmacion`, < 0.5 → `faltante`; RN1 → `requiere_confirmacion`. Se declara como supuesto. | Simon, Lucy, Luna |
| A4 | **Confirmación (RN4)**: el servidor emite `pendingConfirmation` de un solo uso atado al `caso`; el siguiente mensaje solo confirma si coincide con una lista cerrada de frases afirmativas (el botón envía "Confirmo, envía"). Así funciona escribir "envía" (§11) sin inferir de lenguaje libre. | Max, Kira, Charlotte |
| A5 | **HU-5**: con plantilla corrupta se sigue generando reporte de faltantes y checklist (assert). Al tocar el tope de iteraciones, responder con lo obtenido y lo que falta. | Simon, Lucy |
| A6 | **PDF**: texto "etiqueta: valor" con sanitizador WinAnsi antes de `drawText` (→, emoji, comillas raras rompen). | Luna |
| A7 | **Seguridad**: `caso` y nombres de salida con regex + sin symlinks; `out/` no servido como estático; ACCESS_KEY por header `x-access-key`, `timingSafeEqual`, falla cerrado; salidas de tools delimitadas en el prompt; cuentas bancarias enmascaradas en logs y tarjetas; límite de tamaño del body; `nosniff`. | Max, Oreo |
| A8 | **Secretos**: los 4 `.md` + `.env` en `.gitignore` **antes** del primer `git add`, verificado con `git check-ignore`; token nunca en la URL del remote; escaneo de secretos antes de cada push; excluidos del zip. | Max, Oreo, Lucy |
| A9 | **Front**: pantalla de acceso (password + "Entrar", sessionStorage, "Cambiar clave"); banner `role="alert"` con "Confirmar envío"/"Cancelar"; estados de error de red / 429 / timeout con reintentar; `aria-live`; probar con teclado y a 360 px. | Charlotte |
| A10 | **demo.ts**: sin LLM ni red; asserts de conteos, vigencias, RN2 (sin banco en borrador), errores; assert de "envío sin confirmar" tras la franja 55–75. E2E con 7B valida archivos en `out/`, no texto; si el 7B falla, E2E con Anthropic. | Coco |
| A11 | **SOLUCION.md**: supuestos (FECHA_EJECUCION, vigencia null, "turno inmediatamente anterior", PDF generado, tsx vs bun, umbral de confianza, disco efímero de Render); costo por caso medido en el E2E; bitácora de propuestas de IA descartadas desde el min 0. | Simon, Oreo |

## Cronograma ajustado (120 min)
| Min | Entregable | Agentes |
|---|---|---|
| 0–10 | git init + `.gitignore` verificado, scaffold, `/api/health` → push → Render → UptimeRobot | Salen · Oreo · Max |
| 10–20 | **Contratos**: tipos internos, `LlmAdapter`, registro de tools, API; smoke test de tool calling con qwen 7B | Kira · Salen |
| 20–45 | 5 tools + reglas + logs + knowledge; **demo mínimo al min 25** | Luna · Simon |
| 45–55 | `demo.ts` completo con asserts | Coco |
| 55–75 | Adaptadores Ollama/Anthropic, `agent/prompt.md`, ciclo con topes, confirmación en servidor | Kira · Luna |
| 75–90 | Front (acceso, tarjetas, banner, errores), sobre el contrato de la API | Charlotte · Salen |
| 90–100 | Env en Render, ACCESS_KEY, E2E §11 (local Ollama, link Anthropic), medir tokens | Oreo · Max · Coco |
| 100–105 | **Quality gate adelantado**: secretos, `.gitignore`, `npm run demo`, typecheck | Lucy · Oreo |
| 105–115 | `SOLUCION.md` (10 secciones) + README | Simon · Kira |
| 115–120 | `modulo/` si hay tiempo, zip `reto-01-rivera.zip`, entrega | Lucy · Oreo |

Revisiones de Lucy: min 25, 55, 85, 100. Recorte si falta tiempo: bonus → PDF. El portal (P2) se mantiene.

## Decisiones cerradas con Hector
- **Modelo y credenciales:** se cumple el PRD al pie de la letra. La clave vive solo en variables de entorno del backend. No hay selector de modelo en el front ni "usa tu propia clave".
- **Proveedor por entorno:** `LLM_PROVIDER=anthropic` en Render (Claude por defecto) · `LLM_PROVIDER=ollama` en local (`qwen2.5-coder:7b`, `OLLAMA_URL=http://localhost:11434`).
- **Repo:** `hectorriverahuerfano/RETO01-AI-Agente-conversacional-Periferia-IT`. Incluye `.claude/agents`, `.claude/skills` y `hojaruta.md`.
- **Agentes:** limpiados de referencias a LucyApp; única copia en `.claude/`.
- **Token classic de GitHub:** revocado ✅.
