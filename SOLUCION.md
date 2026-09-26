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

**Costo estimado por caso:** un caso completo usa unas 5 llamadas al modelo, cada una con el system prompt más el historial más los resultados de las herramientas. Eso da unos 25–35 mil tokens de entrada y unos 1.5 mil de salida, es decir **del orden de USD 0.10–0.15 por caso** a precios de Sonnet. Para 8–12 casos al mes, el costo es menor a USD 2 al mes. `MAX_TOKENS_SESION` corta en 150 mil: el flujo completo (procesar, confirmar y pedir la copia por correo) usa unos 60–90 mil tokens porque cada turno reenvía el historial; 50 mil resultó corto en la prueba real.

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

## 6.1 Extensión HU-7: copia real del paquete por correo (desviación consciente del PRD)

El PRD excluye la integración real con correo (§3.2) y define "enviar" como escribir `ENVIO-SIMULADO.md`. **Eso no cambió:** "envía" sigue produciendo solo ese archivo (§11). Como extra opcional, Hector pidió que quien pruebe pueda recibir el paquete en su correo.

- **Cuándo:** solo después de un envío simulado confirmado **en la misma sesión**, el chat ofrece un campo "¿Quieres recibir el paquete en tu correo?".
- **A quién:** únicamente al correo que la persona escribió en su **último mensaje**. El servidor lo extrae del texto y otorga un permiso de un solo uso; el modelo no puede inventar ni redirigir el destinatario, aunque un documento se lo pida.
- **Qué:** contenido fijo que el modelo no controla: asunto con el cliente, cuerpo con el borrador (sin banco), el formulario **con los datos bancarios ocultos** (RN2), el checklist y los soportes.
- **Cómo:** Gmail API por `fetch`, sin dependencias nuevas, con OAuth de scope único `gmail.send`. El refresh token se obtiene una vez con `npm run gmail-auth` y solo vive en `.env` y en Render.
- **Topes:** 3 correos por sesión y 10 por día, reservados antes de enviar para no duplicar. Opcionalmente, una lista de dominios permitidos (`EMAIL_DOMINIOS_PERMITIDOS`). Todo apagado salvo `GMAIL_ENABLED=true`.
- **Seguridad del MIME:** se rechazan saltos de línea, comas y punto y coma en destinatario y asunto (inyección de cabeceras); nombres de adjuntos saneados.
- **Riesgo aceptado:** el link es público, así que alguien con la clave de acceso podría usar la cuenta para enviar hasta el tope diario. Mitigado con los topes, la lista de dominios y el interruptor.

## 6.2 Extensión HU-8: historial de conversaciones

Cada ingreso abre una conversación nueva. Las anteriores aparecen en el botón **Conversaciones**:
- **Dónde vive la lista:** en el navegador (`localStorage`), solo `{ id, título, fecha }`. El título se recorta a 40 caracteres y se le quitan los correos. El contenido vive en la memoria del servidor y se pide con `GET /api/sessions/:id`. Como la clave de acceso es compartida y no hay usuarios, una lista en el servidor mezclaría las conversaciones de todos los evaluadores.
- **Solo lectura primero:** una conversación vieja se abre en solo lectura, con el botón "Continuar esta conversación", para no confirmar pasos viejos sin querer.
- **Confirmaciones con vencimiento:** una confirmación pendiente vence a los 10 minutos. Un "sí" en una conversación retomada horas después no confirma un envío viejo.
- **Borrar historial:** borra la lista local y las conversaciones del servidor (`DELETE /api/sessions/:id`, con clave de acceso, límite de peticiones y validación del id). Responde 204 exista o no la sesión, para no revelar qué ids existen, y 409 si hay un mensaje en curso.
- **Si el servidor se reinició:** la conversación aparece como "ya no disponible" y se quita de la lista.

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
| **HU-7 Copia real por correo** (extensión fuera del PRD) | Hecho, apagado por defecto (`GMAIL_ENABLED`) | Cuenta Gmail dedicada; cola persistente de envíos |
| **HU-8 Historial de conversaciones** (extensión) | Hecho | Persistencia real con identidad de usuario |
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

### Ronda 3: extensión HU-7 (copia por correo)

Hector pidió usar todos los agentes. Cada uno participó en el momento en que su rol aportaba más:

| Fase | Agente | Pregunta o tarea | Resultado |
|---|---|---|---|
| Diseño | **Simon** | ¿Rompe el PRD? Redacta HU-7 | GO con ajustes: ofrecer el correo solo tras el envío simulado; excluir datos bancarios; interruptor por variable de entorno; publicar la app de Google en producción (el token de "Testing" caduca en 7 días) |
| Diseño | **Kira** | ¿Dónde vive cada pieza? ¿Cómo generalizar la guarda? | NO-GO con ajustes: nada que no sea herramienta puede exportarse en `proveedor.ts`; generalizar confirmaciones a permisos de un solo uso; inyectar el remitente para que la demo nunca toque la red |
| Diseño | **Max** | Modelo de amenazas | GO con ajustes: cuenta usada para spam, inyección de destinatario, inyección de cabeceras MIME, fuga del token. Exigió tope diario persistente, lista de dominios y bloquear saltos de línea |
| Diseño | **Charlotte** | ¿Cómo pedir el correo? | Campo dedicado que envía el correo como mensaje literal; textos de privacidad, éxito y error |
| Diseño | **Oreo** | Google Cloud y Render | APPROVED_WITH_WARNINGS: cliente OAuth tipo Escritorio; app en producción; escaneo de patrones de secretos antes del push; recomienda una Gmail dedicada |
| Construcción | **Luna** | Escribir `src/domain/correo.ts` | Cliente Gmail y MIME con defensas contra inyección de cabeceras |
| Construcción | **Salen** | Escribir `scripts/gmail-auth.ts` | Flujo OAuth local de una vez, con `state` anti-CSRF; no guarda el token en disco |
| Revisión | **Lucy** | Revisar el código | APROBADO CON CAMBIOS: consumir el permiso justo antes de enviar; exigir envío simulado de la misma sesión; registrar la causa de errores; reservar cupo antes de enviar; volver a mostrar el campo si falla |
| Revisión | **Coco** | Probar el comportamiento | PASA CON OBSERVACIONES: 33 pruebas propias sin red. Detectó que la verificación de datos bancarios de la demo no probaba nada (buscaba texto en un binario comprimido); se reemplazó por lectura celda por celda y se agregaron 5 casos más |

**Desacuerdos resueltos:**
- **Lista de dominios** (Max la exigía): quedó configurable. Hector decide si la activa.
- **Adjuntar el formulario con datos bancarios** (Simon lo prohibía por RN2): se adjunta una copia con esos valores ocultos.
- **Tope persistente** (Kira y Max): archivo en `out/`, que sobrevive reinicios del proceso pero no un redespliegue en Render; queda declarado.

### Ronda 4: historial de conversaciones (HU-8)

Pregunta a los agentes: ¿cada ingreso debe borrar la conversación anterior, mostrarla como historial (B) o mostrarla con opción de borrarla del servidor (C)?

| Agente | Recomendación | Aporte que quedó |
|---|---|---|
| **Simon** | B, con "Limpiar lista" solo local | Criterios de aceptación: título y fecha, "ya no disponible" tras reinicio, aislamiento por navegador |
| **Charlotte** | B, borrado solo local | Botón "Conversaciones" con panel lateral (pantalla completa en móvil), solo lectura con "Continuar", textos y accesibilidad |
| **Kira** | B + C | La lista en el navegador; `DELETE` que responde 204 siempre y 409 si hay mensaje en curso. Detectó que una confirmación vieja podía aplicarse en una conversación retomada: se agregó vencimiento de 10 minutos |
| **Max** | C con condiciones | Límite de peticiones también en `/api/sessions`; no guardar contenido ni correos en el navegador; título sin correos; actualizar la Política de Privacidad |

**Desacuerdo resuelto:** Simon y Charlotte preferían borrar solo la lista local; Kira y Max, borrar también en el servidor. Se eligió borrar en el servidor, porque las conversaciones pueden contener correos, con las protecciones de Kira y Max. El historial tiene su propio contador de peticiones, para que abrir varias conversaciones no bloquee el chat.

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

---

## Anexo A. Bitácora del trabajo con los subagentes

### A.1 Cómo se trabajó

Los 9 agentes (`.claude/agents/`) venían de otro proyecto con stack PHP/Laravel. Antes de usarlos se limpiaron las referencias a ese proyecto y a cada uno se le indicó aplicar su disciplina al stack TypeScript del reto.

**Los agentes no conversaron directamente entre sí.** Claude Code actuó como orquestador: le hizo a cada agente las mismas preguntas en paralelo, consolidó las respuestas, detectó los desacuerdos y llevó a Hector las decisiones que solo él podía tomar.

| Fase | Qué se hizo | Resultado |
|---|---|---|
| 1. Descubrimiento | Los 9 agentes leyeron el PRD y los fixtures en modo solo lectura | Preguntas para Hector, riesgos y aporte a la hoja de ruta |
| 2. Decisiones | Hector respondió las preguntas consolidadas | Plan final v2 |
| 3. Validación | Los 9 agentes revisaron el plan final | 8 × "GO con ajustes" + 1 × "APPROVED_WITH_WARNINGS"; 11 ajustes (A1–A11) |
| 4. Consulta puntual | Simon evaluó un requerimiento nuevo de Hector (selección de modelo) | Se descartó por contradecir el PRD |
| 5. Construcción | Claude Code escribió el código aplicando los ajustes | 28 verificaciones de `demo.ts` en verde y link desplegado |

### A.2 Ronda 1: las preguntas que se le hicieron a cada agente

Cada agente respondió estas cuatro preguntas, enfocadas en su especialidad:

1. **¿Qué entendiste?** Desde su especialidad.
2. **¿Qué necesitas de Hector?** Decisiones o insumos que solo él puede dar.
3. **¿Cuál es tu aporte a la hoja de ruta?** Pasos concretos con minutos, dentro de un total de 2 horas.
4. **¿Qué riesgos o trampas ves** en el PRD o en los fixtures?

Además, a cada uno se le pidió revisar un foco concreto:

| Agente | Foco pedido |
|---|---|
| Simon (PO) | Alcance, prioridad P0/P1/P2, criterios de aceptación, supuestos para `SOLUCION.md` |
| Kira (Arquitectura) | Runtime, framework HTTP, librerías xlsx/pdf, adaptador LLM, ciclo con tope, confirmación, `modulo/` sin copias |
| Charlotte (Diseño) | UI mínima del chat, tarjetas de tool calls, estado de confirmación, accesibilidad, framework más barato en tiempo |
| Luna (Desarrollo) | Orden de implementación, lógica de mapeo, vencimientos, log; qué hay instalado en la máquina; trampas por caso |
| Salen (Full stack) | Reparto del trabajo en paralelo, API, un solo comando de arranque, bonus |
| Lucy (Code review) | Checklist derivado del PRD y momentos de revisión |
| Coco (QA) | Resultado esperado por caso, pruebas de errores, determinismo, E2E |
| Max (Seguridad) | Clave del modelo, path traversal, inyección de prompt, datos bancarios, topes, confirmación en código |
| Oreo (Producción) | Plataforma de despliegue, variables de entorno, health check, checklist de entrega |

### A.3 Lo que respondió cada agente en la ronda 1

| Agente | Lo que le preguntó a Hector | Hallazgos principales |
|---|---|---|
| **Simon** | Proveedor y clave del LLM; dónde desplegar; fecha de referencia de vigencias; ¿bonus sí o no?; ¿PDF sí o no? | Los 4 casos cubren variantes a propósito (limpio, faltantes, vencido, portal). Inconsistencias del PRD: la "rúbrica de la sección 10" no existe; CA4 y RN5 piden logs distintos; "confianza < 0.8" no está definida. Riesgo CA2: `generar_formulario` recibe el mapeo desde el modelo. |
| **Kira** | Proveedor y modelo; plataforma; bonus; fecha de ejecución; ¿link público o con clave?; apellido para el zip | La nota depende de las herramientas, no del modelo. El mapeo que envía el modelo debe recalcularse. La confirmación debe exigirla el servidor. `armar_paquete` depende de que exista el formulario. |
| **Charlotte** | Nivel de pulido, idioma, streaming, colores, botones de ejemplo por caso | HTML plano servido por el backend. Tarjetas `<details>`. Bloque ámbar de confirmación con botones que envían texto explícito. Enmascarar datos bancarios. Estados "vencido" visibles con texto, no solo color. |
| **Luna** | Instalar Bun o usar Node; clave LLM; cuenta de despliegue; librerías | Bun **no** estaba instalado (sí Node 24, npm, git). Conteos por caso. La Cámara de Comercio exige "no mayor a 30 días". No hay fixtures de plantilla corrupta ni de caso inexistente: hay que simularlos. |
| **Salen** | Clave LLM; plataforma con cuenta activa; confirmar Bun; repo o zip; apellido | Vercel serverless no sirve (se pierden sesiones y `out/`). Confirmación con un flag `pendingConfirmation` en el servidor. Reparto en dos frentes paralelos. |
| **Lucy** | ¿Commits por hito?; nivel de revisión dado el tiempo; fecha de ejecución | Checklist de contrato (sin `any`, `.describe()`, `{ok,data}`, nombres `proveedor_<export>`). Olvidos probables: log doble y `modulo/` sin copias. |
| **Coco** | ¿Solo `demo.ts` con asserts o también tests?; fecha de vigencias; ¿el caso portal puede quedar listo para firma? | Tabla de conteos esperados: 17/0/0, 13/1/1, 9/1/1, 8/0/1. La Cámara vence el 30-sep: con la fecha real el caso limpio pasa a "no listo". El xlsx incluye fechas internas: comparar celdas, no bytes. |
| **Max** | ¿Proteger el link con clave?; ¿dónde va la API key en el despliegue?; topes | No hay inyección de prompt explícita en los fixtures, pero `pa-logistica-istmo` trae una URL externa y habla de credenciales: el agente no debe navegar ni pedirlas. En EC, HN y PA el identificador apunta al NIT colombiano. |
| **Oreo** | Cuenta de Render y GitHub; forma de entrega; clave cargada por Hector en el panel | Veredicto provisional BLOCKED hasta tener insumos. No había `bun`, `gh` ni `docker`. Render con Node nativo, deploy temprano de "hola mundo". El plan gratuito se duerme: hay que despertarlo antes de la defensa. |

### A.4 Preguntas consolidadas a Hector y sus respuestas

| # | Pregunta | Respuesta de Hector |
|---|---|---|
| 1 | Proveedor LLM y clave | Claude (Anthropic) en el link; Ollama local (`qwen2.5-coder:7b`) para pruebas |
| 2 | Plataforma de despliegue | Render gratuito + GitHub; ping periódico para que no se duerma |
| 3 | Runtime | Node + tsx (Bun no instalado) |
| 4 | Fecha de referencia | `FECHA_EJECUCION=2026-09-25` |
| 5 | Proteger el link | Sí, con clave de acceso documentada en el README |
| 6 | Alcance | PDF sí; bonus `modulo/` si queda tiempo |
| 7 | Entrega | Repo `RETO01-AI-Agente-conversacional-Periferia-IT` con commits a nombre de Hector Rivera |
| 8 | Agentes y skills | Incluirlos en el repo (`.claude/`) junto con `hojaruta.md` |
| 9 | Selección de modelo por el usuario | Descartada tras la consulta a Simon (A.7): se cumple el PRD al pie de la letra |

### A.5 Ronda 2: validación del plan final

A cada agente se le preguntó: **"¿Das GO, GO con ajustes o NO-GO al plan final? ¿Qué ajustes son obligatorios?"**

| Agente | Veredicto | Ajustes obligatorios que pidió |
|---|---|---|
| Simon | GO con ajustes | Definir el caso de confianza < 0.8; verificar que HU-5 continúe tras una plantilla corrupta; lista de supuestos; medir tokens para el costo por caso |
| Kira | GO con ajustes | Formato interno único de mensajes; un solo registro de herramientas (`z.toJSONSchema`); adelantar el contrato del adaptador al minuto 10–20 para probar pronto el 7B; confirmación con texto exacto |
| Charlotte | GO con ajustes | Pantalla de clave de acceso (password, sessionStorage, nunca en la URL); banner `role="alert"`; estados de error de red, 429 y timeout con reintento; prueba con teclado y a 360 px |
| Luna | GO con ajustes | PDF plano "etiqueta: valor"; filtro de caracteres WinAnsi antes de `drawText`; normalizar también las claves del glosario (tienen tildes); ESM con versiones fijadas |
| Salen | GO con ajustes | Contrato de API fijo antes del minuto 55; front sobre un mock mientras tanto; `tsx` aceptable en producción si va en `dependencies` |
| Lucy | GO con ajustes | Contratos exactos del PRD (§6.2, §6.4); respuesta al llegar al tope de iteraciones; excluir los archivos de secretos del zip |
| Coco | GO con ajustes | `demo.ts` sin red ni modelo; assert de "envío sin confirmar" tras implementar la confirmación; con el 7B, validar archivos en `out/` y no texto |
| Max | GO con ajustes | Confirmación de un solo uso atada al caso; sin symlinks; `out/` no servido; clave en header con comparación en tiempo constante y falla cerrado; secretos en `.gitignore` antes del primer `git add`; token nunca en la URL del remote |
| Oreo | APPROVED_WITH_WARNINGS | Escuchar en `0.0.0.0:$PORT`; `NODE_VERSION`; `package-lock.json` commiteado; `tsx` en `dependencies`; adelantar la revisión de entrega al minuto 100 |

### A.6 Desacuerdos entre agentes y cómo se resolvieron

| Tema | Posiciones | Decisión y motivo |
|---|---|---|
| Cómo se confirma el envío | Max y Kira: solo botón o texto exacto. Charlotte: botones que envían texto explícito. PRD §11: escribir "envía" debe funcionar | Lista cerrada de frases afirmativas, sin negaciones, válida solo en el mensaje siguiente y de un solo uso. Cumple §11 sin interpretar lenguaje libre. |
| Runtime | Kira: Bun + Hono. Oreo y Luna: Node + tsx porque Bun no estaba instalado | Node + tsx, código compatible con Bun. |
| Librería PDF | Luna (ronda 1): pdfkit. Kira: pdf-lib | pdf-lib, con el filtro WinAnsi que pidió Luna en la ronda 2. |
| Nombres de la API | Salen: `mensaje`, `respuesta`, `pendingConfirmation`. Lucy: los del PRD | Los del PRD: `message`, `reply`, `needsConfirmation`. |
| Prioridad del bonus | Simon: no, salvo que sobren 10 min. Kira: al final, generado por script | Se hizo al final, generado desde las fuentes y verificado por `demo.ts`. |
| Mantener el servicio despierto | Oreo: despertarlo a mano o pagar Starter. Plan inicial: UptimeRobot | La API de UptimeRobot rechazó el plan gratuito; se usó un workflow de GitHub Actions cada 5 min. |

### A.7 Consulta a Simon: ¿el usuario elige el modelo y pone su clave?

**Pregunta de Hector:** que el usuario seleccione el modelo en la app y proporcione sus credenciales, con Claude por defecto.

**Preguntas que se le hicieron a Simon:** ¿contradice el PRD? ¿Qué requerimiento cumple la intención sin violarlo? ¿Qué proveedores listar? Redacta la HU-6. ¿Qué debe confirmar Hector?

**Respuesta de Simon:**
- **Choque con el PRD:** §0 y §8 dicen que la clave "nunca aparece en el front". Hay además un riesgo de SSRF si Ollama acepta una URL desde el front, y unos 20 minutos que no estaban en el cronograma.
- **Propuesta:** Claude por defecto con la clave del servidor; selector de una lista fija; clave propia opcional, solo en memoria de la sesión; declarar la desviación en este documento.
- **Preguntas a Hector:** ¿la clave propia es obligatoria? ¿Aceptas prioridad P2? ¿Tienes clave de OpenAI? ¿Ollama solo en local?

**Decisión de Hector:** descartar el requerimiento y cumplir el PRD al pie de la letra. La clave vive solo en el backend y el proveedor se elige por variable de entorno.

### A.8 Lo que confirmó la construcción

| Hallazgo previsto por los agentes | Qué pasó al construir |
|---|---|
| Kira y Coco: el 7B puede fallar al llamar herramientas | qwen2.5-coder:7b llamó 1 de 4 herramientas e inventó el resto. Con Claude Sonnet 5 el flujo fue correcto. Evidencia de que CA2 debe garantizarse en el diseño. |
| Coco: conteos esperados por caso | `demo.ts` los reprodujo exactos a la primera: 17/0/0, 13/1/1, 9/1/1, 8/0/1. |
| Luna: plantilla corrupta y caso inexistente sin fixture | Se simularon en una copia temporal de los fixtures, sin modificar los originales. |
| Max: secretos en la carpeta del proyecto | `.gitignore` verificado con `git check-ignore` antes del primer commit; escaneo de secretos antes del push. Además se sacó del repo el documento del reto porque contenía un correo personal. |
| Oreo: Render en Node, no serverless | Servicio creado por API con runtime Node; deploy en menos de 1 minuto. Un servicio creado antes desde el panel se autodetectó como Go y falló. |
