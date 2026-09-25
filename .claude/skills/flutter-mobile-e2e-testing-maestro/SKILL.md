---
name: flutter-mobile-e2e-testing-maestro
description: Capacidad técnica avanzada para aprovisionar herramientas de pruebas móviles, configurar entornos de ejecución headless (Android/iOS) y diseñar/ejecutar suites funcionales automatizadas con Maestro sobre aplicaciones Flutter.
---

# Skill: Flutter Mobile E2E Functional Testing with Maestro

### Description
Capacidad técnica avanzada para aprovisionar herramientas de pruebas móviles, configurar entornos de ejecución headless (Android/iOS) y diseñar/ejecutar suites funcionales automatizadas con Maestro sobre aplicaciones Flutter.

---

### Capabilities & Setup Instructions

#### 1. Toolchain Provisioning & Verification
- **Instalación de Maestro CLI:**
  ```bash
  # Instalación en macOS / Linux
  curl -fsSL "https://get.maestro.mobile.dev" | bash
  
  # Exportar variable de entorno si no está en el PATH
  export PATH="$PATH:$HOME/.maestro/bin"
  
  # Verificar versión y estado
  maestro --version
  ```

#### 2. Test Suite Execution & Integration
- Pruebas E2E de interfaz gráfica basadas en flujos declarativos YAML (`maestro test .maestro/flow.yaml`).
- Simulación completa de interacciones nativas en Android/iOS (taps, swipes, inputs, asserts de pantalla).
