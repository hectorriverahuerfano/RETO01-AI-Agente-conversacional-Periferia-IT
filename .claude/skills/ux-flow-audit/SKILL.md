---
name: ux-flow-audit
description: Auditoría de Flujos de Usuario, Matriz de Puntos de Entrada (Entry Points) y Navegabilidad Integral para Charlotte y Kira.
---

# UX Flow & Navigation Integrity Audit Skill

Esta skill establece las directivas y el marco de auditoría de Experiencia de Usuario y Arquitectura de Información para evitar la creación de pantallas aisladas ("islas huérfanas") y asegurar que todo elemento sea navegable de forma natural y visual por cualquier usuario.

---

## 1. Regla de Oro: Prohibición de Pantallas Aisladas
Ninguna vista, formulario, panel o recurso puede darse por aprobado en diseño o arquitectura sin verificar y documentar explícitamente sus **Puntos de Entrada (Entry Points)** en las vistas principales correspondientes (tablas, tarjetas, barras de navegación o botones de acción).

---

## 2. Matriz Obligatoria de Auditoría de Flujo (User Journey Matrix)

Para cada nueva pantalla o funcionalidad, el diseñador debe verificar:

| Dimensión | Pregunta de Control | Validación Requerida |
| :--- | :--- | :--- |
| **Punto de Entrada en Listados** | ¿Existe un botón, icono o menú contextual en la vista de tabla y tarjetas para acceder a esta pantalla? | Enlace directo con tooltip descriptivo y diseño coherente con la paleta definida en el sistema de diseño del proyecto. |
| **Punto de Entrada en Perfiles** | ¿En la vista detallada del recurso padre (`show.blade.php`) existe un botón o tarjeta de navegación hacia esta funcionalidad? | Botón de acción en la cabecera o widget interactivo en el dashboard del recurso. |
| **Flujo de Retorno (Breadcrumbs / Back)** | ¿El usuario puede volver fácilmente a la vista anterior sin perder el estado o filtros? | Botón `← Volver` y migas de pan semánticas. |
| **Feedback y Estados Vacíos** | ¿Si no hay datos, la pantalla ofrece un Call to Action (CTA) claro para crearlos? | Estado vacío ilustrado con botón de acción. |

---

## 3. Checklist Pre-Aprobación de Diseño (Charlotte)
- [ ] ¿Identifiqué todas las pantallas padre donde el usuario espera encontrar el acceso a este nuevo módulo?
- [ ] ¿Diseñé el botón de acción para la vista de tabla (`table-view`)?
- [ ] ¿Diseñé el botón de acción para la vista de cuadrícula/tarjetas (`cards-view`)?
- [ ] ¿Diseñé el botón de acción para la cabecera de la ficha detallada (`show.blade.php`)?
- [ ] ¿Documenté el flujo de clics completo en el informe de diseño dentro de `PRDS/informe_diseno/`?
