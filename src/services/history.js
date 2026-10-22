import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

// Crear directorio de datos si no existe
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    // Si falla, usaremos solo memoria
  }
}

// Cargar historial previo o iniciar vacío
let syncHistory = [];
try {
  if (fs.existsSync(HISTORY_FILE)) {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    syncHistory = JSON.parse(raw);
  }
} catch (e) {
  syncHistory = [];
}

function persistHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(syncHistory.slice(0, 100), null, 2), 'utf8');
  } catch (e) {
    // Ignorar errores de persistencia en disco
  }
}

/**
 * Registra un evento de sincronización en el historial
 * @param {object} event
 */
export function recordSyncEvent(event) {
  const item = {
    id: `sync_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...event
  };

  syncHistory.unshift(item);
  // Mantener solo los últimos 100 eventos
  if (syncHistory.length > 100) {
    syncHistory = syncHistory.slice(0, 100);
  }

  persistHistory();
  return item;
}

/**
 * Obtiene el historial de sincronizaciones
 * @param {number} [limit=20]
 * @returns {Array}
 */
export function getSyncHistory(limit = 30) {
  return syncHistory.slice(0, limit);
}

/**
 * Limpia el historial de sincronizaciones
 */
export function clearSyncHistory() {
  syncHistory = [];
  persistHistory();
  return true;
}

/**
 * Obtiene estadísticas agregadas de sincronización
 * @returns {object}
 */
export function getSyncStats() {
  const total = syncHistory.length;
  let successful = 0;
  let notFound = 0;
  let errors = 0;

  for (const item of syncHistory) {
    if (item.status === 'synced') successful++;
    else if (item.status === 'not_found_in_ghl') notFound++;
    else errors++;
  }

  return {
    total,
    successful,
    notFound,
    errors,
    lastSync: syncHistory[0]?.timestamp || null
  };
}
