import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_FILE = path.join(__dirname, '../.env');

dotenv.config();

function parseSubdomain(raw) {
  return (raw || '').trim()
    .replace(/^https?:\/\//, '')
    .replace(/\.kommo\.com.*$/, '')
    .replace(/\.amocrm\.com.*$/, '');
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  kommo: {
    subdomain: parseSubdomain(process.env.KOMMO_SUBDOMAIN),
    accessToken: (process.env.KOMMO_ACCESS_TOKEN || '').trim(),
    baseUrl: ''
  },
  ghl: {
    locationId: (process.env.GHL_LOCATION_ID || '').trim(),
    accessToken: (process.env.GHL_ACCESS_TOKEN || '').trim(),
    baseUrl: 'https://services.leadconnectorhq.com'
  },
  webhookSecret: (process.env.WEBHOOK_SECRET || '').trim()
};

config.kommo.baseUrl = config.kommo.subdomain ? `https://${config.kommo.subdomain}.kommo.com/api/v4` : '';

/**
 * Recarga la configuración desde el archivo .env
 */
export function reloadConfig() {
  if (fs.existsSync(ENV_FILE)) {
    const envConfig = dotenv.parse(fs.readFileSync(ENV_FILE));
    for (const k in envConfig) {
      process.env[k] = envConfig[k];
    }
  }

  config.port = parseInt(process.env.PORT || '3000', 10);
  config.kommo.subdomain = parseSubdomain(process.env.KOMMO_SUBDOMAIN);
  config.kommo.accessToken = (process.env.KOMMO_ACCESS_TOKEN || '').trim();
  config.kommo.baseUrl = config.kommo.subdomain ? `https://${config.kommo.subdomain}.kommo.com/api/v4` : '';

  config.ghl.locationId = (process.env.GHL_LOCATION_ID || '').trim();
  config.ghl.accessToken = (process.env.GHL_ACCESS_TOKEN || '').trim();

  config.webhookSecret = (process.env.WEBHOOK_SECRET || '').trim();
  return config;
}

/**
 * Valida que las variables esenciales estén presentes.
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validateConfig() {
  const missing = [];
  if (!config.kommo.subdomain) missing.push('KOMMO_SUBDOMAIN');
  if (!config.kommo.accessToken) missing.push('KOMMO_ACCESS_TOKEN');
  if (!config.ghl.locationId) missing.push('GHL_LOCATION_ID');
  if (!config.ghl.accessToken) missing.push('GHL_ACCESS_TOKEN');

  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * Obtiene la configuración segura para mostrar en la interfaz (ocultando tokens)
 */
export function getSafeConfig() {
  const mask = (token) => {
    if (!token) return '';
    if (token.length <= 10) return '••••••••';
    return `${token.slice(0, 6)}••••••••${token.slice(-4)}`;
  };

  return {
    port: config.port,
    kommoSubdomain: config.kommo.subdomain,
    kommoTokenConfigured: Boolean(config.kommo.accessToken),
    kommoTokenMasked: mask(config.kommo.accessToken),
    ghlLocationId: config.ghl.locationId,
    ghlTokenConfigured: Boolean(config.ghl.accessToken),
    ghlTokenMasked: mask(config.ghl.accessToken),
    webhookSecret: config.webhookSecret,
    validation: validateConfig()
  };
}

/**
 * Guarda o actualiza variables en el archivo .env
 * @param {object} updates
 */
export function saveConfigToEnv(updates) {
  let existingEnv = '';
  if (fs.existsSync(ENV_FILE)) {
    existingEnv = fs.readFileSync(ENV_FILE, 'utf8');
  }

  const lines = existingEnv.split('\n');
  const envMap = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.substring(0, idx).trim();
        const val = trimmed.substring(idx + 1).trim();
        envMap[key] = val;
      }
    }
  }

  // Aplicar actualizaciones si tienen valor
  if (updates.kommoSubdomain !== undefined) {
    envMap['KOMMO_SUBDOMAIN'] = updates.kommoSubdomain.trim();
  }
  if (updates.kommoAccessToken && !updates.kommoAccessToken.includes('••••')) {
    envMap['KOMMO_ACCESS_TOKEN'] = updates.kommoAccessToken.trim();
  }
  if (updates.ghlLocationId !== undefined) {
    envMap['GHL_LOCATION_ID'] = updates.ghlLocationId.trim();
  }
  if (updates.ghlAccessToken && !updates.ghlAccessToken.includes('••••')) {
    envMap['GHL_ACCESS_TOKEN'] = updates.ghlAccessToken.trim();
  }
  if (updates.webhookSecret !== undefined) {
    envMap['WEBHOOK_SECRET'] = updates.webhookSecret.trim();
  }

  const newContent = Object.entries(envMap)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n';

  fs.writeFileSync(ENV_FILE, newContent, 'utf8');
  reloadConfig();
  return getSafeConfig();
}
