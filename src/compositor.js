const CORNERS = Object.freeze(['br', 'bl', 'tr', 'tl']);

// Place une source dans un cadre en conservant ses proportions (bandes noires).
export function fitRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (!sourceWidth || !sourceHeight) return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  return { x: Math.round((targetWidth - width) / 2), y: Math.round((targetHeight - height) / 2), width, height };
}

// Remplit le cadre en recadrant la source (pas de bandes noires dans la vignette).
export function coverRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (!sourceWidth || !sourceHeight) return { sx: 0, sy: 0, sw: targetWidth, sh: targetHeight, x: 0, y: 0, width: targetWidth, height: targetHeight };
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const sw = Math.round(targetWidth / scale);
  const sh = Math.round(targetHeight / scale);
  return {
    sx: Math.round((sourceWidth - sw) / 2),
    sy: Math.round((sourceHeight - sh) / 2),
    sw,
    sh,
    x: 0,
    y: 0,
    width: targetWidth,
    height: targetHeight,
  };
}

export function overlayRect(targetWidth, targetHeight, corner = 'br', scale = 0.22) {
  const ratio = Math.min(Math.max(Number(scale) || 0.22, 0.1), 0.5);
  const width = Math.round(targetWidth * ratio);
  const height = Math.round(width * (9 / 16));
  const margin = Math.round(targetWidth * 0.02);
  const spot = CORNERS.includes(corner) ? corner : 'br';
  const x = spot === 'br' || spot === 'tr' ? targetWidth - width - margin : margin;
  const y = spot === 'br' || spot === 'bl' ? targetHeight - height - margin : margin;
  return { x: Math.max(0, x), y: Math.max(0, y), width, height, margin };
}

function mountVideo(document, stream) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = stream;
  const played = video.play?.();
  if (played && typeof played.catch === 'function') played.catch(() => {});
  return video;
}

// Compose la source principale et, si demandée, une caméra en incrustation.
// La sortie est un flux canvas : une seule piste vidéo pour tout le reste.
export function createCompositor({
  width,
  height,
  fps = 30,
  document: doc = globalThis.document,
  canvasFactory = null,
} = {}) {
  const canvas = canvasFactory ? canvasFactory(width, height) : doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  let mainVideo = null;
  let overlayVideo = null;
  let overlayOptions = { corner: 'br', scale: 0.22 };
  let overlayEnabled = true;
  let frameHandle = null;
  let fadeFrom = null;
  let fadeStartedAt = 0;
  let fadeDuration = 0;
  let disposed = false;

  function drawSource(video, rect) {
    if (!video || video.readyState < 2) return false;
    try {
      context.drawImage(video, rect.x, rect.y, rect.width, rect.height);
      return true;
    } catch {
      return false;
    }
  }

  function paint() {
    context.save();
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    const sourceWidth = mainVideo?.videoWidth || width;
    const sourceHeight = mainVideo?.videoHeight || height;
    drawSource(mainVideo, fitRect(sourceWidth, sourceHeight, width, height));

    if (overlayEnabled && overlayVideo && overlayVideo.readyState >= 2) {
      const spot = overlayRect(width, height, overlayOptions.corner, overlayOptions.scale);
      const crop = coverRect(overlayVideo.videoWidth || 16, overlayVideo.videoHeight || 9, spot.width, spot.height);
      context.save();
      context.beginPath();
      context.roundRect?.(spot.x, spot.y, spot.width, spot.height, Math.round(spot.width * 0.06));
      context.clip();
      context.drawImage(
        overlayVideo,
        crop.sx, crop.sy, crop.sw, crop.sh,
        spot.x, spot.y, spot.width, spot.height,
      );
      context.restore();
    }
    context.restore();
  }

  function startLoop() {
    if (frameHandle !== null || disposed) return;
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback) => setTimeout(() => callback(Date.now()), 1000 / fps);
    const loop = (now) => {
      if (disposed) return;
      paint();
      if (fadeFrom && fadeDuration > 0) {
        const progress = Math.min(1, (now - fadeStartedAt) / fadeDuration);
        context.save();
        context.globalAlpha = 1 - progress;
        context.drawImage(fadeFrom, 0, 0, width, height);
        context.restore();
        if (progress >= 1) {
          fadeFrom = null;
          fadeDuration = 0;
        }
      }
      frameHandle = raf(loop);
    };
    frameHandle = raf(loop);
  }

  function stopLoop() {
    if (frameHandle === null) return;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameHandle);
    else clearTimeout(frameHandle);
    frameHandle = null;
  }

  const stream = canvas.captureStream ? canvas.captureStream(fps) : new MediaStream();

  return {
    stream,
    canvas,
    setMain(sourceStream) {
      mainVideo = sourceStream ? mountVideo(doc, sourceStream) : null;
    },
    setOverlay(sourceStream, options = {}) {
      overlayVideo = sourceStream ? mountVideo(doc, sourceStream) : null;
      overlayOptions = { ...overlayOptions, ...options };
    },
    setOverlayEnabled(enabled) {
      overlayEnabled = Boolean(enabled);
    },
    async transition(durationMs = 500) {
      if (!durationMs) return;
      try {
        const snapshot = doc.createElement('canvas');
        snapshot.width = width;
        snapshot.height = height;
        snapshot.getContext('2d').drawImage(canvas, 0, 0);
        fadeFrom = snapshot;
        fadeStartedAt = performance?.now?.() ?? Date.now();
        fadeDuration = durationMs;
      } catch {
        fadeFrom = null;
      }
    },
    start: startLoop,
    stop: stopLoop,
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    },
    dispose() {
      disposed = true;
      stopLoop();
      stream.getTracks().forEach((track) => track.stop());
      if (mainVideo) mainVideo.srcObject = null;
      if (overlayVideo) overlayVideo.srcObject = null;
    },
  };
}
