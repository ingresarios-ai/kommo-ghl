import { Router } from 'express';
import { config, getSafeConfig, saveConfigToEnv, reloadConfig } from '../config.js';

import * as kommoService from '../services/kommo.js';
import * as ghlService from '../services/ghl.js';
import { syncKommoContactWithGHL } from '../services/sync.js';
import { getSyncHistory, getSyncStats, clearSyncHistory } from '../services/history.js';
import { startPolling, stopPolling, getPollingStatus } from '../services/polling.js';

export const apiRouter = Router();

// ==========================================
// AUTENTICACIÓN DEL PANEL
// ==========================================
apiRouter.post('/auth/login', (req, res) => {
  reloadConfig();
  const { password } = req.body || {};
  if (!config.dashboardPassword) {
    return res.json({ success: true, token: 'no_password_required' });
  }
  if (password === config.dashboardPassword) {
    const token = Buffer.from(config.dashboardPassword).toString('base64');
    return res.json({ success: true, token });
  }
  return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
});

apiRouter.get('/auth/check', (req, res) => {
  reloadConfig();
  if (!config.dashboardPassword) {
    return res.json({ protectionEnabled: false, authenticated: true });
  }
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || req.headers['x-dashboard-password'];
  const expectedToken = Buffer.from(config.dashboardPassword).toString('base64');
  const isAuthenticated = token === expectedToken || token === config.dashboardPassword;
  return res.json({ protectionEnabled: true, authenticated: isAuthenticated });
});

// Middleware de protección para el resto de rutas /api/*
apiRouter.use((req, res, next) => {
  if (!config.dashboardPassword) {
    return next();
  }
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || req.headers['x-dashboard-password'];
  const expectedToken = Buffer.from(config.dashboardPassword).toString('base64');
  if (token === expectedToken || token === config.dashboardPassword) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized', requireAuth: true, message: 'Se requiere contraseña para acceder al panel' });
});

// Rutas de Polling (Sondeo Automático por API)
apiRouter.get('/polling/status', (req, res) => {
  res.json(getPollingStatus());
});

apiRouter.post('/polling/start', (req, res) => {
  const interval = parseInt(req.body.interval || '10', 10);
  const status = startPolling(interval);
  res.json({ success: true, status });
});

apiRouter.post('/polling/stop', (req, res) => {
  const status = stopPolling();
  res.json({ success: true, status });
});



// 1. Obtener configuración actual
apiRouter.get('/config', (req, res) => {
  reloadConfig();
  res.json(getSafeConfig());
});

// 2. Guardar o actualizar configuración (.env)
apiRouter.post('/config', (req, res) => {
  try {
    const updated = saveConfigToEnv(req.body);
    res.json({
      success: true,
      message: 'Configuración guardada exitosamente en .env',
      config: updated
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error guardando configuración: ' + error.message
    });
  }
});

// 3. Probar conexión con Kommo
apiRouter.post('/test/kommo', async (req, res) => {
  try {
    const result = await kommoService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 4. Probar conexión con GoHighLevel
apiRouter.post('/test/ghl', async (req, res) => {
  try {
    const result = await ghlService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 5. Ejecutar sincronización manual desde la UI
apiRouter.post('/sync/execute', async (req, res) => {
  try {
    const { contactId, leadId, directPhone } = req.body;
    const result = await syncKommoContactWithGHL({
      contactId: contactId ? String(contactId).trim() : null,
      leadId: leadId ? String(leadId).trim() : null,
      directPhone: directPhone ? String(directPhone).trim() : null,
      source: 'ui_test'
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || null
    });
  }
});

// 6. Obtener historial y estadísticas
apiRouter.get('/history', (req, res) => {
  const limit = parseInt(req.query.limit || '30', 10);
  res.json({
    stats: getSyncStats(),
    items: getSyncHistory(limit)
  });
});

// 7. Limpiar historial
apiRouter.delete('/history', (req, res) => {
  clearSyncHistory();
  res.json({ success: true, message: 'Historial eliminado.' });
});
