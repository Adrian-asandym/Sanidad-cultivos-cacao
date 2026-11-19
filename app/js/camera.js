// Cámara en vivo (getUserMedia). Si no está disponible, la interfaz usa el
// selector nativo de fotos, que en móviles también abre la cámara.

let stream = null;

export function cameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
}

/** Enciende la cámara trasera y la muestra en <video>. */
export async function startCamera(video) {
  stopCamera();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } },
  });
  video.srcObject = stream;
  await video.play();
}

export function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

export function cameraActive() {
  return !!stream;
}

/** Captura el fotograma actual como JPEG. */
export function captureFrame(video) {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo capturar la foto.'))), 'image/jpeg', 0.92),
  );
}

/** Traduce los errores de getUserMedia a un mensaje para el usuario. */
export function cameraErrorMessage(err) {
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'No tenemos permiso para usar la cámara. Actívalo en los ajustes del navegador o elige una foto de la galería.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No encontramos una cámara en este dispositivo. Elige una foto de la galería.';
    case 'NotReadableError':
      return 'Otra aplicación está usando la cámara. Ciérrala y vuelve a intentarlo.';
    default:
      return 'No pudimos abrir la cámara. Vuelve a intentarlo o elige una foto de la galería.';
  }
}

/** Miniatura cuadrada (recorte centrado) para el historial. */
export async function makeThumbnail(blob, size = 240) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
}
