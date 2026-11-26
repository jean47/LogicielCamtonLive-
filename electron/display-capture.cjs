const CAPTURE_SOURCE_OPTIONS = Object.freeze({
  types: ['screen', 'window'],
  thumbnailSize: { width: 480, height: 270 },
  fetchWindowIcons: false,
});

function createDisplayCaptureService({ desktopCapturer, session, isTrustedRequest }) {
  let selectedSourceId = '';

  function listSources() {
    return desktopCapturer.getSources(CAPTURE_SOURCE_OPTIONS);
  }

  async function selectSource(sourceId) {
    if (typeof sourceId !== 'string' || !sourceId || sourceId.length > 512) {
      throw new Error('La source d’écran choisie est invalide.');
    }
    const sources = await listSources();
    if (!sources.some((source) => source.id === sourceId)) {
      throw new Error('La source choisie n’est plus disponible. Actualise la liste puis réessaie.');
    }
    selectedSourceId = sourceId;
    return true;
  }

  session.setDisplayMediaRequestHandler(async (request, callback) => {
    const sourceId = selectedSourceId;
    selectedSourceId = '';
    if (!sourceId || !request?.videoRequested || !isTrustedRequest(request)) {
      try { callback(null); } catch {}
      return;
    }

    try {
      const source = (await listSources()).find((item) => item.id === sourceId);
      if (!source) {
        callback(null);
        return;
      }
      const streams = { video: source };
      if (request.audioRequested && process.platform === 'win32') streams.audio = 'loopback';
      callback(streams);
    } catch {
      try { callback(null); } catch {}
    }
  });

  return Object.freeze({ listSources, selectSource });
}

module.exports = { createDisplayCaptureService };
