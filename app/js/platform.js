// Detecta si la app corre dentro del APK (Capacitor) o como PWA en el navegador.
// Capacitor inyecta window.Capacitor en el WebView antes de cargar la página,
// así que no hace falta importar @capacitor/core (la PWA sigue sin dependencias).

export function isNativeApp() {
  const cap = globalThis.Capacitor;
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
}
