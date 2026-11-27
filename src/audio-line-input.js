// Entrée audio « ligne » pour Camton Live : accepte une entrée Windows comme piste du son du PC,
// à la manière de la capture d’entrée audio d’OBS. Usage typique : un câble audio virtuel
// (VB-Cable, Voicemeeter…) ou « Mixage stéréo ».
//
// Pourquoi ce module plutôt que la piste « micro » :
//  - un micro est ouvert avec réduction de bruit, annulation d’écho et contrôle automatique du
//    gain, ce qui déforme la musique et le son d’un jeu. Ici, ces trois traitements sont coupés.
//  - on demande de la stéréo en 48 kHz, ce que le flux envoyé à FFmpeg attend.
//
// Branchement dans le mélangeur : le flux renvoyé par openLineInput() se donne tel quel à
// mixer.attachStream(idPiste, stream), comme pour un micro.
//
// Aucune dépendance : fonctionne dans le moteur de rendu (Vite) et sous Node pour les tests.

export const LINE_INPUT_PROCESSING_OFF = Object.freeze({
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
});

// Noms d’appareils qui ressemblent à un câble virtuel ou à une boucle du son du PC.
const CABLE_PATTERN = /cable|vb-audio|voicemeeter|virtual|mixage|stereo mix|stéréo mix|loopback|vac\b/i;
// Entrées « fantômes » que Windows ajoute en doublon dans Chromium.
const ALIAS_IDS = new Set(['default', 'communications']);

export function isVirtualCableLabel(label) {
  return CABLE_PATTERN.test(String(label || ''));
}

export class LineInputError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'LineInputError';
    this.code = code;
    this.cause = cause;
  }
}

function describeFailure(error) {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new LineInputError('permission', 'L’accès à l’audio est refusé. Vérifie la confidentialité du microphone dans Windows (applications de bureau autorisées).', error);
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new LineInputError('not-found', 'Cette entrée audio est introuvable (débranchée, renommée ou désactivée). Actualise la liste des appareils.', error);
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return new LineInputError('busy', 'Windows n’a pas pu ouvrir cette entrée. Une autre application l’utilise peut-être en mode exclusif.', error);
  }
  return new LineInputError('unknown', `L’entrée audio n’a pas pu être ouverte${name ? ` (${name})` : ''}.`, error);
}

// Liste les entrées audio, câbles virtuels en premier. Les libellés sont vides tant que
// l’autorisation audio n’a pas été accordée une fois : needsPermission le signale.
export async function listLineInputs(mediaDevices = globalThis.navigator?.mediaDevices) {
  if (!mediaDevices?.enumerateDevices) return [];
  const devices = (await mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput');
  const entries = devices.map((device, index) => {
    const label = device.label || '';
    return {
      deviceId: device.deviceId,
      groupId: device.groupId || '',
      label: label || `Entrée audio ${index + 1}`,
      likelyCable: isVirtualCableLabel(label),
      isAlias: ALIAS_IDS.has(device.deviceId),
      needsPermission: !label,
    };
  });
  return entries.sort((a, b) => Number(b.likelyCable) - Number(a.likelyCable) || Number(a.isAlias) - Number(b.isAlias));
}

// Ouvre une entrée audio sans aucun traitement de micro. Renvoie le flux, la piste et les
// réglages réellement appliqués. processingActive est vrai si le navigateur a quand même
// laissé un traitement actif (à signaler à l’utilisateur).
export async function openLineInput(deviceId, { mediaDevices = globalThis.navigator?.mediaDevices } = {}) {
  if (!mediaDevices?.getUserMedia) {
    throw new LineInputError('unavailable', 'La capture audio n’est pas disponible dans cet environnement.');
  }
  if (typeof deviceId !== 'string' || !deviceId) {
    throw new LineInputError('no-device', 'Choisis d’abord une entrée audio dans la liste.');
  }

  const base = { deviceId: { exact: deviceId }, ...LINE_INPUT_PROCESSING_OFF };
  const attempts = [
    { audio: { ...base, channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 } }, video: false },
    // Certains pilotes refusent les contraintes de format : on réessaie avec le strict nécessaire.
    { audio: base, video: false },
  ];

  let lastError = null;
  for (const constraints of attempts) {
    try {
      const stream = await mediaDevices.getUserMedia(constraints);
      const [track] = stream.getAudioTracks();
      if (!track) {
        stream.getTracks().forEach((item) => item.stop());
        throw new LineInputError('no-track', 'Cette entrée n’a fourni aucune piste audio.');
      }
      const settings = track.getSettings?.() || {};
      return {
        stream,
        track,
        label: track.label || '',
        settings,
        processingActive: Boolean(settings.echoCancellation || settings.noiseSuppression || settings.autoGainControl),
        stop() { stream.getTracks().forEach((item) => item.stop()); },
      };
    } catch (error) {
      if (error instanceof LineInputError) throw error;
      lastError = error;
      // Seule une contrainte de format justifie un second essai ; le reste est définitif.
      if (!['OverconstrainedError', 'TypeError'].includes(error?.name)) break;
    }
  }
  throw describeFailure(lastError);
}

// Écoute la piste quelques secondes et dit s’il y passe du son : sert au bouton « Tester ».
// Sans signal, la cause est presque toujours que Windows n’envoie rien vers le câble.
export function watchSignal(track, {
  durationMs = 4000,
  intervalMs = 100,
  threshold = 0.003,
  createContext = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
  createStream = (tracks) => new MediaStream(tracks),
} = {}) {
  return new Promise((resolve, reject) => {
    let context;
    try {
      context = createContext();
      const source = context.createMediaStreamSource(createStream([track]));
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let peak = 0;
      const startedAt = Date.now();
      const timer = setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const value of samples) {
          const centered = (value - 128) / 128;
          sum += centered * centered;
        }
        peak = Math.max(peak, Math.sqrt(sum / samples.length));
        if (Date.now() - startedAt >= durationMs) {
          clearInterval(timer);
          try { source.disconnect(); } catch { /* déjà déconnecté */ }
          Promise.resolve(context.close?.()).catch(() => {});
          resolve({ hasSignal: peak >= threshold, peak });
        }
      }, intervalMs);
    } catch (error) {
      try { context?.close?.(); } catch { /* contexte déjà fermé */ }
      reject(error);
    }
  });
}

// Texte du guide de câblage, affichable tel quel dans une fenêtre d’aide.
export const WIRING_STEPS = Object.freeze([
  'Installe un câble audio virtuel (par exemple VB-Cable) puis redémarre Windows.',
  'Dans Windows, envoie le son du jeu ou de l’application vers « CABLE Input » (Paramètres › Système › Son › Mixeur de volume).',
  'Dans Camton Live, choisis « CABLE Output » comme entrée du son du PC puis clique sur Tester.',
  'Pour continuer à entendre le son : Panneau de configuration › Son › Enregistrement › CABLE Output › Propriétés › Écouter › « Écouter cet appareil », puis choisis ton casque ou tes enceintes.',
  'Ne choisis jamais « CABLE Input » comme appareil d’écoute : le son tournerait en boucle.',
]);
