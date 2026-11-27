// Iconos de línea (outline), dibujados en una rejilla de 24 px.
// Locales: la app no carga nada de internet.
const P = {
  consult: '<path d="M20.5 11.5a8.5 8.5 0 0 1-8.5 8.5 9.4 9.4 0 0 1-3.3-.6L4 21l1.4-4.4a8.5 8.5 0 1 1 15.1-5.1z"/><path d="M9.9 9a2.3 2.3 0 0 1 4.5.8c0 1.6-2.4 2.2-2.4 3.5m0 2.8h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6"/><path d="M12 17.2h.01"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.1l1.4-2h6l1.4 2h2.1A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
  gallery: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.6"/><path d="m4 17 4.8-4.6 3.4 3.2 2.6-2.4L20 18"/>',
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M7.5 12h9"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4.5V8H7"/><path d="M12 7.5V12l3 2"/>',
  save: '<path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M8 4v4.5h7V4"/><rect x="8" y="13" width="8" height="7"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.8L16.3 9.5"/>',
  alert: '<path d="M10.3 4.3 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4"/><path d="M12 17h.01"/>',
  timer: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.2 1.6M9.5 2.8h5"/>',
  microbe: '<circle cx="12" cy="12" r="5"/><path d="M12 4.5V7M12 17v2.5M4.5 12H7M17 12h2.5M6.7 6.7l1.8 1.8M15.5 15.5l1.8 1.8M17.3 6.7l-1.8 1.8M8.5 15.5l-1.8 1.8"/><circle cx="10.5" cy="11" r=".6"/><circle cx="13.5" cy="13.2" r=".6"/>',
  doc: '<path d="M6.5 3.5h7l4 4V20a.5.5 0 0 1-.5.5H7a.5.5 0 0 1-.5-.5z"/><path d="M13.5 3.5V8h4M9.5 12.5h5M9.5 16h3.5"/>',
  basket: '<path d="M4 10h16l-1.6 8.4a2 2 0 0 1-2 1.6H7.6a2 2 0 0 1-2-1.6z"/><path d="m8.5 10 3-6M15.5 10l-3-6"/><path d="M9.5 13.5v3M14.5 13.5v3"/>',
  scissors: '<circle cx="6.5" cy="6.5" r="2.5"/><circle cx="6.5" cy="17.5" r="2.5"/><path d="M8.6 8 20 18.5M8.6 16 20 5.5"/>',
  drop: '<path d="M12 3.5s6 6.3 6 10.5a6 6 0 0 1-12 0c0-4.2 6-10.5 6-10.5z"/><path d="M9.2 14.6a2.9 2.9 0 0 0 2.6 2.4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M5.6 18.4l1.3-1.3M17.1 6.9l1.3-1.3"/>',
  shovel: '<path d="M14.5 9.5 20 4"/><path d="m18.5 2.5 3 3"/><path d="M13.6 8.6 6 16.2a3 3 0 0 0 0 4.2 3 3 0 0 0 4.2 0l7.6-7.6z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  trash: '<path d="M4.5 7h15M10 4h4M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/><path d="M10 11v5.5M14 11v5.5"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v4h-4"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  offline: '<path d="M3 3l18 18"/><path d="M8.5 5.6A6 6 0 0 1 17.6 10 4 4 0 0 1 20 17.2M16 19H7a4.5 4.5 0 0 1-1.4-8.8"/>',
  shutter: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none"/>',
  pod: '<path d="M12 3c4 0 6 4.5 6 9s-2 9-6 9-6-4.5-6-9 2-9 6-9z"/><path d="M12 3v18M9 4.2c-1 2.3-1.4 5-1.4 7.8s.4 5.5 1.4 7.8M15 4.2c1 2.3 1.4 5 1.4 7.8s-.4 5.5-1.4 7.8"/>',
};

/** Devuelve el SVG del icono. Decorativo por defecto (aria-hidden). */
export function icon(name, { size = 24, label } = {}) {
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true" focusable="false"';
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${P[name] || ''}</svg>`;
}
