# BioPlant AI en Android (Capacitor)

La PWA de `app/` se empaqueta tal cual como APK con Capacitor. Este documento recoge cómo está montado, los cambios del 27-11-2026 (icono, pantalla de inicio y permiso de cámara) y cómo se verificaron en un dispositivo real.

## Entorno verificado

| Componente | Versión |
|---|---|
| @capacitor/core, @capacitor/android, @capacitor/cli | 8.6.3 |
| Android Gradle Plugin / Gradle | 8.13.0 / 8.14.3 |
| JDK | Temurin 21.0.13 |
| compileSdk / targetSdk / minSdk | 36 / 36 / 24 |
| Node / npm | 22.23.4 / 10.9.9 |
| ADB (platform-tools) | 37.0.3 |
| Dispositivo de prueba | Honor Magic 7 Lite (BRP-NX3), Android 16 (API 36), WebView 157 |

## Compilar e instalar

```bash
npm install
npm run android:debug     # cap sync android + gradlew.bat assembleDebug (Windows)
npm run android:install   # adb install -r …/app-debug.apk  (adb debe estar en el PATH)
```

`adb` está en `%LOCALAPPDATA%\Android\Sdk\platform-tools`. En macOS/Linux, usa `./gradlew assembleDebug` dentro de `android/`. `install -r` conserva los datos de la app (historial en IndexedDB).

`android/app/src/main/assets/public/` se genera con `cap sync` y está en `.gitignore`. Cualquier cambio en `app/` necesita volver a sincronizar y compilar.

## Cambios

### 1. Icono adaptativo y pantalla de inicio

Todos los iconos salen de `app/icons/logo.svg` con `python tools/make_icons.py` (o `npm run icons`). El script rasteriza el SVG con el Edge o Chrome instalado a través de Playwright, sin descargar navegadores. Así se conservan exactamente el degradado y los recortes del circuito. Después, Pillow compone cada tamaño ajustando el logo al **círculo** que lo envuelve, para que quepa en la zona segura de cualquier máscara de launcher.

| Recurso | Contenido |
|---|---|
| `mipmap-anydpi-v26/ic_launcher*.xml` | Icono adaptativo: fondo blanco + primer plano + **monocromo** (iconos temáticos de Android 13+) |
| `mipmap-*/ic_launcher_foreground.png` | 108 dp; el logo cabe en un círculo de radio 30 dp (zona segura: 33 dp) |
| `mipmap-*/ic_launcher_monochrome.png` | La misma silueta en blanco (solo cuenta el canal alfa) |
| `mipmap-*/ic_launcher.png`, `ic_launcher_round.png` | Iconos heredados (Android < 8) |
| `drawable-*/splash_icon.png` | Splash de Android 12+: 288 dp, con el logo dentro del círculo de 192 dp |
| `drawable*/splash.png` | Splash heredada (Android < 12), mismos tamaños que generó Capacitor |
| `app/icons/*.png` | Iconos de la PWA (`any`, `maskable`, `apple-touch-icon`), regenerados con el logo nuevo |

`values/styles.xml` → `AppTheme.NoActionBarLaunch` define `windowSplashScreenBackground` (`#F8F7FC`, el fondo de la app, para que la splash funda con la primera pantalla) y `windowSplashScreenAnimatedIcon`. Se eliminaron los vectores del robot de Capacitor (`drawable/ic_launcher_background.xml`, `drawable-v24/ic_launcher_foreground.xml`), que nada usaba.

### 2. Cámara: se mantiene `getUserMedia`

**Causa del fallo:** el manifiesto solo declaraba `INTERNET`. Cuando la web llama a `getUserMedia`, `BridgeWebChromeClient.onPermissionRequest` de Capacitor solicita el permiso runtime `CAMERA`. Si el permiso no está declarado, Android lo deniega al instante, sin diálogo, y la web recibe `NotAllowedError`.

**Arreglo:** `AndroidManifest.xml` declara `android.permission.CAMERA` y `<uses-feature android:name="android.hardware.camera" android:required="false"/>`, para no excluir dispositivos sin cámara, que pueden usar la galería.

**Por qué no `@capacitor/camera`:**

- La app tiene un visor en vivo con guía de encuadre. El plugin abre la app de cámara del sistema y devuelve la foto, así que se perdería el visor.
- Con `getUserMedia`, la PWA y el APK comparten exactamente el mismo código. El plugin obligaría a bifurcar por plataforma y a añadir una dependencia nativa.
- El plugin también necesita declarar `CAMERA`, porque Capacitor rechaza la cámara si el permiso está en el manifiesto pero no concedido. No ahorra configuración.
- La galería ya funciona con `<input type="file">`, que abre el selector de fotos del sistema sin pedir permisos de almacenamiento.

Otros ajustes de la cámara:

- `app/js/platform.js` → `isNativeApp()` usa el `window.Capacitor` que inyecta el WebView, sin importar `@capacitor/core`. Si el permiso está denegado, el mensaje del APK indica *Ajustes > Aplicaciones > BioPlant AI > Permisos*; la PWA mantiene el mensaje del navegador.
- `<video poster="…">` transparente: sin él, el WebView de Android pinta un icono gris de "play" hasta que llega la primera imagen de la cámara.

### 3. Compatibilidad con la PWA y modo sin conexión

- **PWA:** registra `sw.js` como siempre. `VERSION` sube a `v11`, `?v=10` en `index.html`, y `platform.js` se añade al precache.
- **APK:** no registra el service worker. Capacitor sirve `app/` desde el APK en `https://localhost` sin red, así que el SW solo duplicaría unos 20 MB de caché y, tras actualizar el APK, podría servir archivos viejos. `setupServiceWorker()` en `app.js` da de baja el que registraron versiones anteriores, borra las cachés `bioplant-*` y recarga una vez si la página la había servido ese SW.

## Resultados de la verificación (27-11-2026, Honor Magic 7 Lite)

Herramientas: `adb exec-out screencap`, `uiautomator dump`, `logcat --pid` (solo el proceso de la app) y DevTools del WebView por `adb forward` (el build debug lo habilita). Antes de cada captura o volcado, un script de QA comprobaba que la ventana enfocada fuera BioPlant AI y, si no lo era, se negaba. No se capturó la imagen en vivo de la cámara ni el selector de fotos, y no se copió ningún archivo al teléfono.

| Prueba | Resultado |
|---|---|
| APK: permisos y features (`aapt dump badging`) | `INTERNET`, `CAMERA`; `android.hardware.camera` no obligatoria; icono `mipmap-anydpi-v26/ic_launcher.xml` |
| Splash (grabación de pantalla del arranque en frío) | Logo sobre `#F8F7FC` con fundido hacia la app; Logcat: ventana `Splash Screen com.bioplant.ai` |
| Arranque en frío | ~0,8 s (`am start -W`, `LaunchState: COLD`) |
| "Tomar foto" sin permiso | Aparece el diálogo de permiso del sistema (`GrantPermissionsActivity`). Antes: denegación silenciosa |
| Permiso concedido | `getUserMedia` activo: pista `video:live`, 1280×1280; el sistema registra `CONNECT device 0 … com.bioplant.ai` |
| Cancelar / salir del visor | La cámara se libera (`DISCONNECT device 0`) |
| Permiso denegado permanentemente | Mensaje nativo con la ruta de Ajustes + botón Reintentar; la galería sigue disponible |
| Póster del `<video>` | Transparente en modo en vivo (antes: icono gris de "play") |
| Inferencia en el teléfono (TF.js, backend WebGL) | 5/5 correctas; ~140 ms por imagen con los dos modelos; diferencia máxima con Keras en PC: 0,0011 |
| Recursos | 22 peticiones, todas a `https://localhost` (modelos, TF.js, fuentes); ninguna externa; `sw.js` no se pide |
| Consola JS (Logcat) | 0 mensajes. Los `E/` del proceso son del sistema Honor (VipSched, iGraphics, uniperf), no de la app |
| Service worker en el APK | 0 registros, 0 cachés tras actualizar desde la versión anterior |
| PWA en Edge (localhost) | SW `bioplant-v11` con 31 archivos; recarga **sin red** con "Modelos listos"; consola limpia |

Detalle de la inferencia (filtro = P(cacao), umbral 0,5):

| Imagen (dataset/) | Teléfono: filtro → estado | Keras (PC) |
|---|---|---|
| cacao_escoba_de_bruja_006 | 0,9368 → escoba_de_bruja 0,9471 | 0,9368 → 0,9467 |
| cacao_fitoftora_010 | 0,9826 → fitoftora 0,8292 | 0,9827 → 0,8294 |
| enfermo_moniliasis_m1_20241011_105403 | 0,5871 → moniliasis 0,9677 | 0,5871 → 0,9677 |
| sano_IMG_20240802_130044 | 0,9066 → sano 0,7996 | 0,9066 → 0,7997 |
| otros_carro_001 | 0,0438 → **no es cacao** | 0,0439 |

### Límites conocidos de la verificación

- MagicOS no expone a UI Automator la ventana del diálogo de permisos y la protege contra capturas. Su aparición se comprobó por la ventana enfocada y el resultado, por el estado del permiso (`dumpsys package`).
- El icono en el launcher no se capturó para no fotografiar la pantalla de inicio del usuario, que muestra otras apps. Hay que revisarlo a simple vista.
- La prueba sin conexión del APK se basa en que todas las peticiones fueron locales; no se activó el modo avión del teléfono.
