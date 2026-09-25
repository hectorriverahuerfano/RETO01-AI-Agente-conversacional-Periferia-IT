# Registro como proveedor: conocimiento del proceso

## Qué es
Los clientes piden a Periferia IT Group registrarse como proveedor. Llega un correo con una plantilla (Excel, PDF o portal web) y una lista de soportes. Los datos salen del repositorio maestro; los soportes, de `repositorio/soportes/`.

## Estados de un campo
- **lleno:** existe en el maestro (sinónimo exacto del glosario o similitud ≥ 0.8). Se reporta la ruta del dato.
- **requiere_confirmacion:** similitud entre 0.5 y 0.8, o regla de país (identificador tributario).
- **faltante:** no hay fuente en el maestro. Nunca se inventa: una persona lo completa.

## Identificador tributario por país (RN1)
| País | Identificador |
|---|---|
| Colombia (CO) | NIT |
| Ecuador (EC) | RUC |
| Perú (PE) | RUC |
| Panamá (PA) | RUC |
| Honduras (HN) | RTN |

Periferia solo tiene NIT colombiano. Para clientes de otros países el campo se llena con el NIT y queda **por confirmar** con la nota "identificador extranjero".

## Datos bancarios (RN2)
Se llenan solo si la plantilla los pide. Nunca van en el borrador de correo ni se repiten en el chat.

## Soportes (RN3)
- **vencido:** `vigencia_hasta` anterior a la fecha de ejecución. Bloquea "listo para firma".
- **ausente:** exigido pero no está en el repositorio. Bloquea "listo para firma".
- **por vencer:** vence en 7 días o menos. No bloquea, pero se advierte.
- Un campo faltante **no** bloquea la firma, pero aparece en el checklist.
- Algunos clientes piden la Cámara de Comercio "no mayor a 30 días": si está por vencer, recomienda pedir una nueva.

## Acciones externas (RN4)
Enviar, firmar o cargar a un portal siempre requiere confirmación explícita del usuario en el mensaje inmediatamente anterior. En este sistema "enviar" solo escribe `out/<caso>/ENVIO-SIMULADO.md`.

## Portal web
No se automatiza. Se generan los valores en `valores-portal.md`. Las credenciales las ingresa una persona, y el clic en "Enviar" del portal también es humano.

## Qué hay en out/<caso>/
- `formulario.xlsx`, `formulario.pdf` o `valores-portal.md`
- `mapeo.json` con el estado de cada campo
- `paquete/` con el formulario, `soportes/`, `checklist.md` y `borrador-correo.md`
- `log.jsonl` con cada llamada a herramienta
