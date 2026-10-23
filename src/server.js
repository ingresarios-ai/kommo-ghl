import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, validateConfig } from './config.js';
import { webhookRouter } from './routes/webhook.js';
import { apiRouter } from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '../public');

const app = express();

// Soporte para JSON y x-www-form-urlencoded (vital para webhooks nativos de Kommo)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir la interfaz gráfica web desde public/
app.use(express.static(PUBLIC_DIR));

// Log de peticiones entrantes
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.originalUrl.startsWith('/health') && !req.originalUrl.includes('.')) {
      console.log(`[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Endpoint de salud (Health Check)
app.get('/health', (req, res) => {
  const validation = validateConfig();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    configStatus: validation.valid ? 'configured' : 'missing_variables',
    missingVars: validation.missing
  });
});

// Rutas API para la UI
app.use('/api', apiRouter);

// Registrar rutas de webhook (soporta tanto /webhook/kommo-lead como /kommo-lead)
app.use('/webhook', webhookRouter);
app.use('/', webhookRouter);


// Manejador fallback para SPA (si no es API o webhook, entrega index.html)
app.get('*', (req, res, next) => {
  if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/webhook')) {
    return next();
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Manejador de rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

// Iniciar servidor local si no estamos en entorno serverless (Vercel)
if (!process.env.VERCEL) {
  const server = app.listen(config.port, () => {
    console.log(`\n========================================================`);
    console.log(`🚀 Servicio Kommo <-> GoHighLevel sincronizador activo`);
    console.log(`🖥️  Panel Gráfico (UI): http://localhost:${config.port}`);
    console.log(`🔗 Endpoint Webhook:    http://localhost:${config.port}/webhook/kommo-lead`);
    console.log(`🧪 Endpoint API Test:   http://localhost:${config.port}/api/sync/execute`);
    console.log(`❤️  Healthcheck:         http://localhost:${config.port}/health`);
    console.log(`========================================================`);

    const validation = validateConfig();
    if (!validation.valid) {
      console.warn(`\n⚠️  ATENCIÓN: Aún faltan variables por configurar en tu archivo .env:`);
      validation.missing.forEach(m => console.warn(`   - ${m}`));
      console.warn(`   (Puedes configurarlas visualmente abriendo http://localhost:${config.port})\n`);
    } else {
      console.log(`✅ Configuración validada correctamente:`);
      console.log(`   - Kommo Subdomain: ${config.kommo.subdomain}.kommo.com`);
      console.log(`   - GHL Location ID: ${config.ghl.locationId}`);
      console.log(`========================================================\n`);
    }
  });

  // Cierre elegante
  process.on('SIGTERM', () => {
    console.log('Cerrando servidor ordenadamente...');
    server.close(() => process.exit(0));
  });
}

export default app;

