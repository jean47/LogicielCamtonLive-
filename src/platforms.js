export const LIVE_PROFILES = Object.freeze({
  smooth: Object.freeze({ width: 1280, height: 720, fps: 30, bitrate: 3000, label: 'Fluide' }),
  balanced: Object.freeze({ width: 1280, height: 720, fps: 60, bitrate: 4500, label: 'Équilibré' }),
  sharp: Object.freeze({ width: 1920, height: 1080, fps: 60, bitrate: 6000, label: 'Très net' }),
});

export const PLATFORM_DETAILS = Object.freeze({
  youtube: Object.freeze({
    name: 'YouTube',
    title: 'Configurer YouTube',
    instruction: 'Dans YouTube Studio, crée ou ouvre ton événement de diffusion. Copie l’adresse du serveur et la clé de diffusion. Camton Live ne crée pas l’événement et peut ne pas pouvoir le démarrer à ta place.',
  }),
  twitch: Object.freeze({
    name: 'Twitch',
    title: 'Configurer Twitch',
    instruction: 'Dans ton tableau de bord créateur Twitch, ouvre les paramètres de diffusion et copie ta clé de stream. Ne saisis jamais ton mot de passe Twitch dans Camton Live.',
  }),
});

export const PLATFORM_IDS = Object.freeze(['twitch', 'youtube']);
