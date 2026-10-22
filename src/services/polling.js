import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as kommoService from './kommo.js';
import { syncKommoContactWithGHL } from './sync.js';
import { validateConfig } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data');
const CACHE_FILE = path.join(DATA_DIR, 'processed-contacts.json');

// Cargar IDs de contactos ya procesados previamente
let processedContactIds = new Set();
try {
  if (fs.existsSync(CACHE_FILE)) {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      processedContactIds = new Set(arr);
    }
  }
} catch (e) {
  processedContactIds = new Set();
}

function persistCache() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    // Guardar solo los últimos 500 IDs para no saturar memoria
    const toSave = Array.from(processedContactIds).slice(-500);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(toSave, null, 2), 'utf8');
  } catch (e) {
    // Silencioso
  }
}

let pollingIntervalTimer = null;
let isPollingActive = false;
let pollingIntervalSeconds = 10;
let lastCheckTime = null;
let lastCheckStatus = 'Inactivo';
let isRunningCycle = false;

/**
 * Ejecuta un ciclo de sondeo en la API de Kommo
 */
async function runPollingCycle() {
  if (isRunningCycle) return;
  isRunningCycle = true;
  lastCheckTime = new Date().toISOString();

  try {
    const validation = validateConfig();
    if (!validation.valid) {
      lastCheckStatus = `Faltan credenciales: ${validation.missing.join(', ')}`;
      isRunningCycle = false;
      return;
    }

    // Consultar los contactos más recientes creados o actualizados en Kommo
    const client = kommoService.getContact ? null : null; // kommoService tiene su cliente interno
    // Usaremos llamada directa a /contacts de Kommo
    // Como kommoService expone funciones individuales, agregaremos getRecentContacts
    const recentContacts = await kommoService.getRecentContacts(15);

    if (!Array.isArray(recentContacts) || recentContacts.length === 0) {
      lastCheckStatus = 'Sin contactos nuevos';
      isRunningCycle = false;
      return;
    }

    let newlyProcessed = 0;

    for (const contact of recentContacts) {
      const contactId = String(contact.id);

      // Si ya fue procesado en este worker, no volver a procesar
      if (processedContactIds.has(contactId)) {
        continue;
      }

      console.log(`[Polling Worker] Nuevo contacto detectado en Kommo: #${contactId} (${contact.name || 'Sin nombre'})`);
      
      // Marcar como visto
      processedContactIds.add(contactId);
      persistCache();
      newlyProcessed++;

      // Ejecutar la sincronización hacia GHL
      try {
        await syncKommoContactWithGHL({
          contactId: contactId,
          source: 'polling_api'
        });
      } catch (err) {
        console.error(`[Polling Worker] Error procesando contacto #${contactId}:`, err.message);
      }
    }

    lastCheckStatus = newlyProcessed > 0 ? `Procesados ${newlyProcessed} nuevo(s)` : 'Al día (sin leads pendientes)';

  } catch (error) {
    lastCheckStatus = `Error en consulta: ${error.message}`;
    console.error(`[Polling Worker Error]:`, error.message);
  } finally {
    isRunningCycle = false;
  }
}

/**
 * Inicia el monitoreo automático de la API de Kommo
 * @param {number} [intervalSec=10]
 */
export function startPolling(intervalSec = 10) {
  if (isPollingActive) {
    stopPolling();
  }

  pollingIntervalSeconds = Math.max(5, intervalSec);
  isPollingActive = true;
  lastCheckStatus = 'Iniciando monitoreo...';

  console.log(`\n======================================================`);
  console.log(`🔄 [POLLING] Monitoreo automático por API activo (cada ${pollingIntervalSeconds}s)`);
  console.log(`   (Consultando Kommo API continuamente sin webhooks)`);
  console.log(`======================================================\n`);

  // Ejecutar el primer ciclo inmediatamente
  runPollingCycle();

  // Programar repetición
  pollingIntervalTimer = setInterval(runPollingCycle, pollingIntervalSeconds * 1000);

  return getPollingStatus();
}

/**
 * Detiene el monitoreo automático
 */
export function stopPolling() {
  if (pollingIntervalTimer) {
    clearInterval(pollingIntervalTimer);
    pollingIntervalTimer = null;
  }
  isPollingActive = false;
  lastCheckStatus = 'Monitoreo pausado';
  console.log(`⏸️ [POLLING] Monitoreo automático por API detenido.`);
  return getPollingStatus();
}

/**
 * Obtiene el estado actual del monitoreo
 */
export function getPollingStatus() {
  return {
    active: isPollingActive,
    intervalSeconds: pollingIntervalSeconds,
    lastCheckTime,
    lastCheckStatus,
    processedCount: processedContactIds.size
  };
}
