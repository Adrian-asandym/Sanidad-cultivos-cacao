---
name: "cacao-disease-ui"
description: "Construye la interfaz móvil de BioPlant AI, app web offline que diagnostica Moniliasis, Fitoftora y Escoba de bruja en frutos de cacao. Úsala al crear o modificar sus pantallas."
---

# BioPlant AI — interfaz de diagnóstico de cacao

Esta skill define SOLO la interfaz. El modelo de IA es externo y se conecta mediante un contrato fijo (ver "Contrato con el modelo"). Basada en un diseño de Stitch (pantalla de resultado, móvil), adaptado de una planta genérica a frutos de cacao.

## Principios
- Mobile-first: contenedor máximo 430 px, centrado en pantallas grandes. Pensada para usarse en campo con una mano.
- Todo funciona sin internet: nada de CDN. Fuentes, iconos e imágenes van empaquetados localmente (self-hosted). Incluir manifest y service worker (PWA) para cachear la interfaz.
- Idioma de la interfaz: español.
- Framework: el que indique el usuario; si no indica ninguno, HTML + CSS + JavaScript vanilla.
- No inventar datos que el modelo no produce (ver "Lo que NO se muestra").

## Sistema visual (valores aproximados leídos del diseño; si el usuario tiene los tokens exactos de Stitch, usar esos)
- Tipografía: sans geométrica redondeada tipo Outfit (autoalojada). Títulos 700, texto 400/500, eyebrows en mayúsculas 10–11 px con tracking amplio.
- Colores:
  - Primario (botón, marca, iconos activos): verde oscuro `#0B6B45`
  - Acento de confianza (insignia del anillo): menta `#6EF2B0` con texto verde oscuro
  - Fondo de pantalla: blanco lavanda `#F8F7FC`
  - Superficies de tarjeta: blanco `#FFFFFF`; bloques secundarios y chips: lavanda claro `#ECEBF6`
  - Texto principal `#1B1B24`, secundario `#5E5E6B`
- Forma: tarjetas con radio 16–20 px y sombra muy suave; chips totalmente redondeados; botón principal con radio 14 px.
- Espaciado: rejilla de 4 px; márgenes laterales de pantalla 16 px; separación entre secciones 16–20 px.
- Iconos: línea fina, estilo outline (Material Symbols Outlined u otro set en SVG local).

## Estructura de la pantalla de resultado (de arriba hacia abajo)
1. **Barra superior**: logo + "BioPlant AI" en verde oscuro y subtítulo "Diagnóstico" debajo; a la derecha icono de ayuda (?). El logo debe ser un SVG local con `alt` válido; nunca dejar una imagen rota.
2. **Tarjeta de diagnóstico** (blanca, destacada):
   - Eyebrow: `DIAGNÓSTICO PATOLÓGICO`
   - Nombre de la enfermedad en 22–24 px, negrita, hasta 2 líneas.
   - Arriba a la derecha: insignia cuadrada redondeada menta con anillo de progreso circular, porcentaje en negrita (ej. `94.8%`) y la palabra `Confianza` debajo.
   - Fila de chips: (a) tipo de agente, ej. `Hongo · Moniliophthora roreri`; (b) tiempo de inferencia con icono de reloj/nube, ej. `Inferencia: 0.42 s`.
   - Dos mini bloques lavanda en 2 columnas: `Síntoma principal` y `Agente causal` (etiqueta pequeña gris arriba, valor en negrita abajo).
3. **Sección "Tratamiento y recomendaciones"**: contenedor lavanda muy claro con icono circular verde oscuro (documento/lista) y título. Dentro, 3 tarjetas blancas apiladas; cada una con icono a la izquierda, título `Paso N: …` en negrita y descripción de 2–3 líneas.
4. **Botón principal** ancho completo: `Guardar en Historial`, fondo verde oscuro, texto blanco, icono de guardar a la izquierda; altura mínima 52 px.
5. **Barra de navegación inferior** fija con 2 pestañas: `Diagnóstico` (icono de escáner/cámara) e `Historial` (icono de reloj). La activa va en verde oscuro, la inactiva en gris.

## Pantallas complementarias (extrapoladas con el mismo sistema; no vienen del diseño original)
- **Diagnóstico / captura**: vista de cámara o botón "Tomar foto" y "Elegir de galería", guía de encuadre ("Centra la mazorca y evita sombras fuertes"), botón primario "Analizar". Mostrar un estado de carga con el mismo anillo mientras se infiere.
- **Historial**: lista de tarjetas con miniatura de la foto, enfermedad, % de confianza y fecha/hora; tocar abre la pantalla de resultado guardada; opción de eliminar. Estado vacío con ilustración simple y texto "Aún no tienes diagnósticos guardados". Guardado local (IndexedDB), nunca en servidor.

## Contrato con el modelo (para poder reemplazarlo sin tocar la interfaz)
La interfaz solo consume una función asíncrona:
```
predict(imagen: Blob | ImageBitmap) -> Promise<{
  label: "moniliasis" | "fitoftora" | "escoba_de_bruja" | "sano",
  confidence: number,        // 0 a 1
  inferenceMs: number
}>
```
- Mantener esta función en un único módulo (`model-adapter`). Cuando el usuario entregue un modelo mejorado, solo se cambia ese módulo y el archivo del modelo.
- Los textos por enfermedad viven en un archivo de datos aparte (`diseases.json`), no dentro de los componentes.
- La etiqueta `sano` es opcional: usarla solo si el modelo la produce.

## Estados obligatorios
- **Confianza baja (< 0.60)**: no presentar el resultado como definitivo. Mostrar el nombre con la insignia en tono ámbar y el aviso "Resultado poco confiable. Toma otra foto con mejor luz y enfoque"; ofrecer botón "Repetir foto". Esto es importante porque el modelo actual tiene exactitud moderada.
- **Cargando**: anillo animado con el texto "Analizando mazorca…".
- **Sin conexión**: la app NO debe mostrar errores por falta de internet; opcionalmente un chip discreto "Modo sin conexión" en la barra superior.
- **Error de cámara o permisos**: mensaje claro con acción para reintentar o elegir de galería.

## Lo que NO se muestra
- No incluir chip de "Severidad" ni "Fase" a menos que el modelo realmente las prediga; el clasificador actual solo devuelve la enfermedad. No inventar valores.
- No prometer cura ni dosis de productos químicos. Las recomendaciones son de manejo cultural.

## Contenido base por enfermedad (validar con un técnico agrónomo antes de publicar)
- **Moniliasis** — agente: *Moniliophthora roreri* (hongo). Síntoma principal: manchas o abultamientos irregulares y maduración despareja; luego mancha marrón con capa blanca-crema que pasa a ceniza con esporas. Pasos: 1) Retira semanalmente los frutos enfermos. 2) Poda para dar aireación y entrada de luz. 3) Mejora el drenaje y entierra o cubre los frutos retirados.
- **Fitoftora (mazorca negra)** — agente: *Phytophthora* spp. (oomiceto). Síntoma principal: mancha marrón chocolate de borde definido que avanza rápido hasta cubrir el fruto, con vello blanco en alta humedad. Pasos: 1) Retira y aparta los frutos afectados. 2) Regula la sombra y poda para bajar la humedad. 3) Mejora el drenaje y evita acumulación de agua.
- **Escoba de bruja** — agente: *Moniliophthora perniciosa* (hongo). Síntoma principal: deformaciones del fruto (forma de zanahoria o fresa), manchas negras duras y pudrición seca; en brotes, ramas con crecimiento en "escoba". Pasos: 1) Realiza poda fitosanitaria de escobas, cortando por debajo del tejido afectado. 2) Retira los frutos enfermos. 3) Aleja o entierra el material cortado.
- **Sano** (si existe): mensaje positivo "No se detectaron signos de enfermedad", sin pasos de tratamiento; mostrar solo recomendaciones de vigilancia periódica.

## Accesibilidad y rendimiento
- Contraste mínimo 4.5:1 en texto; el verde sobre menta y el blanco sobre verde oscuro deben cumplirlo.
- Áreas táctiles de al menos 44×44 px.
- No depender solo del color: el estado de confianza baja usa también texto e icono.
- Respetar `prefers-reduced-motion` en la animación del anillo.
- Optimizar la foto antes de inferir (redimensionar al tamaño de entrada del modelo) y guardar en el historial una miniatura, no la imagen completa.