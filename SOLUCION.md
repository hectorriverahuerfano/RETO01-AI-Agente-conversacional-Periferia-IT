# SOLUCION.md — Agente "Registro como Proveedor"

## 1. Problema en una frase

El área administrativa transcribe a mano, cada mes, entre 8 y 12 formularios de registro como proveedor con datos que ya existen. Eso produce retrabajo, errores en datos sensibles (NIT, cuenta bancaria), dependencia de una sola persona y días de espera para empezar a facturar. **A quién le duele:** a la analista administrativa, que carga con el trabajo, y a Periferia, que factura tarde.

## 2. Arquitectura

```
┌──────────────┐ HTTP  ┌──────────────────────────────── Backend (Node + Hono) ─┐
│ web/ (chat)  │──────▶│ server.ts  → clave de acceso, límite por IP, límite    │
│ - historial  │◀──────│              de tamaño                                 │
│ - tool calls │       │ agent/ciclo.ts → prompt → LLM → tools → respuesta      │
│ - confirmar  │       │ llm/adapter.ts ← anthropic.ts | ollama.ts              │
└──────────────┘       │ tools/proveedor.ts (zod) → domain/* (lógica pura)      │
                       └───────┬──────────────────────────────┬─────────────────┘
                               │ solo lectura                 │ escritura
                        fixtures/reto-01/                    out/<caso>/
```

| Pieza | Dónde vive | Qué cambia ahí |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Tono, orden de pasos, reglas del agente |
| **Conocimiento** | `src/knowledge/registro-proveedor.md` (lo lee el modelo) y `src/knowledge/reglas.json` (lo leen las herramientas) | Identificador tributario por país, umbrales, días de alerta. **Un cambio de regla de negocio no toca el código.** |
| **Ejecución** | `src/tools/proveedor.ts`, con lógica en `src/domain/` | Cómo se lee, mapea, genera y empaqueta |

## 3. Ciclo del agente

`src/agent/ciclo.ts`, un turno:

1. Se revisa el tope de tokens de la sesión y se procesa la confirmación (ver abajo).
2. Bucle de hasta `MAX_ITER` (25) iteraciones: se envían al modelo el system prompt y la conversación → si pide herramientas, cada llamada se valida con zod y se ejecuta, y su resultado vuelve al modelo → si no pide ninguna, ese texto es la respuesta.
3. **Tope alcanzado:** el agente responde con lo que logró (cada herramienta con su resumen) y qué falta (CA1).
4. **Error del proveedor o timeout:** mensaje claro en el chat; la sesión sigue viva (CA5).
5. Cada llamada queda en la respuesta (`toolCalls`), en el historial y en `out/log.jsonl` y `out/<caso>/log.jsonl` (CA4, RN5).

**Confirmación humana (CA3 / RN4) en el servidor, no en el prompt:**
- Cuando `proveedor_armar_paquete` termina bien, la sesión marca el caso como *pendiente de confirmación* y la API responde `needsConfirmation: true`. El front muestra un banner ámbar.
- Solo el **mensaje siguiente** del usuario puede confirmar, y únicamente con una frase afirmativa de una lista cerrada ("sí", "confirmo", "envía", …) y sin negaciones. Si lo hace, el servidor otorga una confirmación **de un solo uso**, atada a la sesión y al caso.
- `proveedor_simular_envio` exige esa confirmación. Si el modelo manda `confirmado: true` sin que el usuario haya confirmado, la herramienta responde `requiere confirmación explícita`. La demo lo verifica.

**El modelo no puede meter valores (CA2):** `proveedor_generar_formulario` recibe el `mapeo` por contrato, pero **recalcula todos los valores desde `maestro.json`**. Si el modelo mandó valores distintos, los ignora y lo reporta en `valores_del_modelo_ignorados`.

## 4. Elección del modelo

| | Proveedor | Modelo | Uso |
|---|---|---|---|
| Link (Render) | Anthropic | `claude-sonnet-5` | Producción del reto |
| Local | Ollama | `qwen2.5-coder:7b` | Desarrollo sin costo |

**Por qué Sonnet 5:** en la prueba de la sección 11 llamó las 4 herramientas en el orden correcto, respetó "no envíes nada todavía", no repitió datos bancarios y cerró con la pregunta de confirmación. **qwen2.5-coder:7b llamó solo la primera herramienta e inventó el resto**: es la evidencia de por qué CA2 debe garantizarse en el diseño y no en el prompt. Con un modelo débil, las herramientas siguen generando archivos correctos, pero el texto del chat no es confiable.

**Costo estimado por caso:** un caso completo usa unas 5 llamadas al modelo, cada una con el system prompt más el historial más los resultados de las herramientas. Eso da unos 25–35 mil tokens de entrada y unos 1.5 mil de salida, es decir **del orden de USD 0.10–0.15 por caso** a precios de Sonnet. Para 8–12 casos al mes, el costo es menor a USD 2 al mes. `MAX_TOKENS_SESION` corta en 50 mil.

## 5. Diseño del portal web (sección 7.4)

**Estrategia:** un navegador controlado (Playwright) en modo **asistido**, no autónomo:
1. El agente genera `valores-portal.md`. Esto ya está implementado.
2. Una fase posterior abre el portal en un navegador visible, y **la persona ingresa usuario y contraseña** (y MFA o CAPTCHA si los hay).
3. Con la sesión iniciada, el agente llena los campos por etiqueta visible (no por selectores frágiles) y adjunta los soportes.
4. El agente se detiene antes de enviar: **el clic en "Enviar" es humano**, igual que el ingreso de credenciales.

**Límites:** CAPTCHA y MFA siempre los resuelve una persona. Un cambio de diseño del portal rompe el llenado: por eso se mapea por etiquetas y, si un campo no se encuentra, se reporta como faltante en vez de adivinar. Portales con límite de sesión pueden pedir reintentos.

**Credenciales:** nunca en el repo, el prompt, los logs ni el chat. La persona las escribe directamente en el portal. Si más adelante se automatiza el inicio de sesión, irían en un gestor de secretos (Azure Key Vault o 1Password) con acceso por caso, y el agente solo recibiría una sesión ya iniciada, nunca la contraseña.

| Agente | Humano |
|---|---|
| Preparar valores, llenar campos, adjuntar soportes | Ingresar credenciales, resolver MFA o CAPTCHA, revisar, hacer clic en "Enviar" |

## 6. Decisiones y trade-offs

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| El servidor controla la confirmación (confirmación de un solo uso por sesión y caso) | Confiar en `confirmado: true` del modelo | Un modelo débil o una inyección de prompt podría "confirmar" solo. RN4 debe cumplirse aunque el modelo falle. |
| `generar_formulario` recalcula los valores desde el maestro | Usar los valores del `mapeo` que manda el modelo | Garantiza CA2 por diseño: el modelo no puede meter un valor inventado en el formulario. |
| Reglas de negocio en `reglas.json` | Constantes en el código | Cambiar un país o un umbral no toca el servidor ni las herramientas. |
| Node + `tsx`, sin compilar | Bun (el PRD lo sugiere) o compilar con `tsc` | Bun no estaba instalado. `tsx` ejecuta TypeScript directo y en Render corre igual que en local. `tsc --noEmit` valida tipos. |
| HTML + JS sin framework | React o Vue | Sin paso de build ni segundo proceso: un solo servidor sirve API y front, y arranca en segundos. |
| PDF generado con pdf-lib | Rellenar un AcroForm | No hay PDF original del cliente en los fixtures; el PRD acepta un PDF generado. |
| Similitud por palabras (Jaccard) para etiquetas desconocidas | Embeddings o que el LLM decida el mapeo | Es determinista, explicable y no gasta tokens. El glosario resuelve los sinónimos conocidos. |

## 7. Supuestos

1. **Fecha de ejecución:** `FECHA_EJECUCION=2026-09-25` fija la evaluación de vigencias. La Cámara de Comercio vence el 2026-09-30; con la fecha real, una defensa posterior bloquearía todos los casos.
2. `vigencia_hasta: null` significa que el soporte no vence (el RUT).
3. **Confianza:** sinónimo exacto del glosario (normalizado, sin tildes) = 1.0 → `lleno`. Similitud de palabras ≥ 0.8 → `lleno`; entre 0.5 y 0.8 → `requiere_confirmacion`; menor a 0.5 → `faltante`. El PRD no define cómo se calcula la confianza.
4. **"Turno inmediatamente anterior" (RN4):** es el mensaje del usuario que llega justo después de la pregunta de confirmación.
5. Un soporte que vence en 7 días o menos se marca **por vencer**. No bloquea, pero se advierte (la Cámara de `co-industrias-delta` debe tener máximo 30 días).
6. El caso portal puede quedar `listo_para_firma` si sus soportes están bien: el "formulario" son los valores para copiar.
7. `simular_envio` se permite aunque el paquete no esté listo para firma, si el usuario lo confirma. `ENVIO-SIMULADO.md` registra el estado del paquete.
8. La "rúbrica de la sección 10" que cita el PRD no existe (la sección 10 es de riesgos). Se priorizó el contrato de herramientas y las reglas.
9. **Determinismo:** `demo.ts` produce los mismos archivos salvo timestamps. Los `.xlsx` cambian solo por las fechas internas del zip; el contenido de las celdas es idéntico.

## 8. Cobertura

| Historia | Estado | Qué falta para producción |
|---|---|---|
| HU-1 Leer solicitud | Hecho | Leer correos reales (Graph API) y plantillas `.xlsx` y `.pdf` originales |
| HU-2 Mapear campos | Hecho | Revisar sinónimos con el negocio; un dueño del maestro |
| HU-3 Excel (P0) | Hecho | Escribir sobre el archivo del cliente para conservar su formato |
| HU-3 PDF (P1) | Hecho (PDF generado) | Rellenar el AcroForm original |
| HU-3 Portal (P2) | Hecho (valores + diseño) | Navegador asistido (sección 5) |
| HU-4 Paquete para firma | Hecho | Integración con firma electrónica |
| HU-5 Errores | Hecho | Alertas de operación |
| Bonus `modulo/` | Hecho | Generado desde las mismas fuentes; `demo.ts` verifica que no difieran |

## 9. Uso de IA

| Asistente | Para qué |
|---|---|
| **Claude Code (Claude Opus 5.5)** | Análisis del PRD, plan, código, pruebas y documentación |
| **9 subagentes de Claude Code** (definidos en `.claude/agents/`) | Dos rondas antes de programar: cada uno leyó el PRD y los fixtures y propuso riesgos y ajustes, y luego validó el plan final. Sus hallazgos están en `hojaruta.md` (ajustes A1–A11). El código lo escribió Claude Code directamente aplicando esos ajustes: delegar la construcción a subagentes habría multiplicado el consumo de tokens dentro de las 2 horas. |

**Aporte de cada subagente:**

| Agente | Rol | Aporte que quedó en la solución |
|---|---|---|
| **Simon** | Product Owner | Alcance P0/P1/P2; definir el umbral de confianza como supuesto; detectar que `generar_formulario` recibía valores del modelo (riesgo CA2) |
| **Kira** | Arquitectura | Formato interno único para Anthropic y Ollama; confirmación controlada por el servidor; `modulo/` generado sin copias divergentes |
| **Charlotte** | Diseño UX | Tarjetas plegables por herramienta, banner de confirmación, pantalla de clave de acceso, accesibilidad |
| **Luna** | Desarrollo | Mapeo con glosario normalizado; filtro de caracteres para pdf-lib; resultado esperado por caso |
| **Salen** | Full stack | Un solo proceso para API y front; contrato de la API definido antes del front |
| **Lucy** | Code review | Checklist del contrato §6.2–§6.4; log doble; detectar que la "rúbrica de la sección 10" no existe |
| **Coco** | QA | Tabla de conteos esperados para `demo.ts`; fijar `FECHA_EJECUCION` (la Cámara vence el 30-sep) |
| **Max** | Seguridad | Validación de `caso` contra path traversal; correo como dato no confiable; datos bancarios fuera del borrador; clave de acceso comparada en tiempo constante |
| **Oreo** | Producción | Render con proceso persistente (no serverless); `tsx` en `dependencies`; revisión de secretos antes del push |

**Descartado de lo que propusieron, y por qué:**
- **Aceptar la confirmación solo con un botón o un texto exacto** (seguridad y arquitectura): rompe la sección 11, que exige que escribir "envía" funcione. Se usó una lista cerrada de frases afirmativas, de un solo uso.
- **Nombres de API en español** (`mensaje`, `respuesta`): se mantuvieron los del PRD (`message`, `reply`, `needsConfirmation`).
- **Selector de modelo y clave del usuario en el front:** contradice la regla de que la clave nunca va en el front. Se dejó el proveedor por variable de entorno.
- **Symlinks para `modulo/`:** frágiles en Windows. Se generan con `npm run sync-modulo` y la demo verifica que coincidan.
- **Bun:** no estaba instalado. Se usó Node + tsx.

Hector revisó, dirigió y validó cada decisión y puede explicar cada línea.

## 10. Riesgos de producción y mitigación

| Riesgo | Mitigación |
|---|---|
| El modelo "completa" un campo faltante en el chat | Los valores del formulario solo salen de herramientas (CA2 por diseño); el prompt lo prohíbe; usar un modelo capaz (evidencia en la sección 4) |
| Inyección de prompt vía el correo del cliente | El cuerpo llega como `cuerpo_correo_no_confiable`; ninguna herramienta navega ni ejecuta comandos; la confirmación la controla el servidor |
| Gasto descontrolado de la clave | Clave de acceso al link, límite por IP, tope de iteraciones y de tokens por sesión, timeout |
| Filtración de datos bancarios | Borrador de correo con plantilla fija sin datos de banco (RN2); cuentas enmascaradas en el chat; los logs solo guardan resúmenes |
| Maestro desactualizado | Nombrar un dueño del dato y agregar fecha de última revisión al maestro |
| Disco efímero de Render: `out/` y las sesiones se pierden al reiniciar | Aceptable en el reto; en producción, almacenamiento de objetos y sesiones en Redis |
| Plan gratuito de Render: el servicio se duerme | Un workflow de GitHub Actions (`.github/workflows/keepalive.yml`) consulta `/api/health` cada 5 min; en producción, plan pago |
| Portales con CAPTCHA o MFA | Operación asistida por un humano (sección 5) |
