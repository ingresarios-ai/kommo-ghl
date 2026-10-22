/**
 * Cliente JavaScript para la Interfaz de Kommo ↔ GHL Bridge
 */

// Estado global de la aplicación
const state = {
  config: null,
  history: [],
  stats: { total: 0, successful: 0, notFound: 0, errors: 0 },
  autoRefreshInterval: null
};

// Elementos DOM
const dom = {
  // Tabs
  tabs: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),

  // Header & Status
  serverPort: document.getElementById('serverPort'),
  kommoSubdomainLabel: document.getElementById('kommoSubdomainLabel'),
  kommoStatusBadge: document.getElementById('kommoStatusBadge'),
  ghlLocationLabel: document.getElementById('ghlLocationLabel'),
  ghlStatusBadge: document.getElementById('ghlStatusBadge'),
  btnTestKommo: document.getElementById('btnTestKommo'),
  btnTestGhl: document.getElementById('btnTestGhl'),

  // Metrics
  statTotal: document.getElementById('statTotal'),
  statSuccess: document.getElementById('statSuccess'),
  statNotFound: document.getElementById('statNotFound'),
  statErrors: document.getElementById('statErrors'),

  // Webhook
  webhookDisplayUrl: document.getElementById('webhookDisplayUrl'),
  guideWebhookUrl: document.getElementById('guideWebhookUrl'),
  btnCopyWebhook: document.getElementById('btnCopyWebhook'),

  // Polling por API
  pollingStatusBadge: document.getElementById('pollingStatusBadge'),
  btnTogglePolling: document.getElementById('btnTogglePolling'),
  pollingLastTime: document.getElementById('pollingLastTime'),
  pollingCycleStatus: document.getElementById('pollingCycleStatus'),
  pollingCount: document.getElementById('pollingCount'),


  // History Table
  historyTableBody: document.getElementById('historyTableBody'),
  btnRefreshHistory: document.getElementById('btnRefreshHistory'),
  btnClearHistory: document.getElementById('btnClearHistory'),

  // Simulator
  simulatorForm: document.getElementById('simulatorForm'),
  simContactId: document.getElementById('simContactId'),
  simLeadId: document.getElementById('simLeadId'),
  simPhone: document.getElementById('simPhone'),
  btnRunSimulator: document.getElementById('btnRunSimulator'),
  simulatorStatus: document.getElementById('simulatorStatus'),
  simulatorPipelineContainer: document.getElementById('simulatorPipelineContainer'),
  pipelineSteps: document.getElementById('pipelineSteps'),
  simulatorRawJson: document.getElementById('simulatorRawJson'),

  // Config Form
  configForm: document.getElementById('configForm'),
  cfgKommoSubdomain: document.getElementById('cfgKommoSubdomain'),
  cfgKommoToken: document.getElementById('cfgKommoToken'),
  cfgGhlLocationId: document.getElementById('cfgGhlLocationId'),
  cfgGhlToken: document.getElementById('cfgGhlToken'),
  cfgWebhookSecret: document.getElementById('cfgWebhookSecret'),
  btnSaveConfig: document.getElementById('btnSaveConfig'),
  btnReloadConfig: document.getElementById('btnReloadConfig'),

  // Modal
  detailModal: document.getElementById('detailModal'),
  modalTitle: document.getElementById('modalTitle'),
  modalBody: document.getElementById('modalBody'),
  modalCloseBtn: document.getElementById('modalCloseBtn'),
  modalCloseBtnFooter: document.getElementById('modalCloseBtnFooter'),

  // Toast
  toastContainer: document.getElementById('toastContainer')
};

// ==========================================
// TOAST NOTIFICATIONS
// ==========================================
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';

  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  dom.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==========================================
// TABS HANDLING
// ==========================================
function initTabs() {
  dom.tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTabId = btn.getAttribute('data-tab');

      dom.tabs.forEach(b => b.classList.remove('active'));
      dom.tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetContent = document.getElementById(targetTabId);
      if (targetContent) {
        targetContent.classList.add('active');
      }
    });
  });
}

// ==========================================
// CONFIGURATION LOGIC
// ==========================================
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    state.config = data;

    // Actualizar UI
    dom.serverPort.textContent = data.port || '3000';
    
    // Actualizar URL del webhook basada en el host actual
    const origin = window.location.origin;
    const webhookUrl = `${origin}/webhook/kommo-lead${data.webhookSecret ? `?secret=${data.webhookSecret}` : ''}`;
    dom.webhookDisplayUrl.textContent = webhookUrl;
    if (dom.guideWebhookUrl) dom.guideWebhookUrl.textContent = webhookUrl;

    // Badges y textos en banner
    if (data.kommoSubdomain) {
      dom.kommoSubdomainLabel.innerHTML = `Subdominio: <strong>${data.kommoSubdomain}.kommo.com</strong>`;
    } else {
      dom.kommoSubdomainLabel.innerHTML = `Subdominio: <em style="color:#ef4444">No configurado</em>`;
    }

    if (data.ghlLocationId) {
      dom.ghlLocationLabel.innerHTML = `Location: <strong>${data.ghlLocationId.slice(0, 10)}...</strong>`;
    } else {
      dom.ghlLocationLabel.innerHTML = `Location: <em style="color:#ef4444">No configurado</em>`;
    }

    // Llenar formulario de configuración
    dom.cfgKommoSubdomain.value = data.kommoSubdomain || '';
    dom.cfgKommoToken.value = data.kommoTokenConfigured ? data.kommoTokenMasked : '';
    dom.cfgGhlLocationId.value = data.ghlLocationId || '';
    dom.cfgGhlToken.value = data.ghlTokenConfigured ? data.ghlTokenMasked : '';
    dom.cfgWebhookSecret.value = data.webhookSecret || '';

  } catch (err) {
    showToast('Error al cargar la configuración: ' + err.message, 'error');
  }
}

async function saveConfig(e) {
  e.preventDefault();
  dom.btnSaveConfig.disabled = true;
  dom.btnSaveConfig.innerHTML = `<span class="spinner"></span> Guardando...`;

  const payload = {
    kommoSubdomain: dom.cfgKommoSubdomain.value.trim(),
    kommoAccessToken: dom.cfgKommoToken.value.trim(),
    ghlLocationId: dom.cfgGhlLocationId.value.trim(),
    ghlAccessToken: dom.cfgGhlToken.value.trim(),
    webhookSecret: dom.cfgWebhookSecret.value.trim()
  };

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      showToast('¡Configuración guardada en archivo .env!', 'success');
      await loadConfig();
    } else {
      showToast(data.error || 'Error guardando configuración', 'error');
    }
  } catch (err) {
    showToast('Error de red al guardar: ' + err.message, 'error');
  } finally {
    dom.btnSaveConfig.disabled = false;
    dom.btnSaveConfig.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
      <span>Guardar en archivo .env</span>
    `;
  }
}

// Probar conexión con Kommo
async function testKommoConnection() {
  dom.btnTestKommo.disabled = true;
  dom.btnTestKommo.innerHTML = `<span class="spinner"></span> Verificando...`;

  try {
    const res = await fetch('/api/test/kommo', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      dom.kommoStatusBadge.className = 'conn-badge connected';
      dom.kommoStatusBadge.textContent = `Conectado (${data.accountName})`;
      showToast(`¡Conexión exitosa con Kommo! Cuenta: ${data.accountName}`, 'success');
    } else {
      dom.kommoStatusBadge.className = 'conn-badge disconnected';
      dom.kommoStatusBadge.textContent = 'Error de conexión';
      showToast(data.error || 'Error al conectar con Kommo', 'error');
    }
  } catch (err) {
    dom.kommoStatusBadge.className = 'conn-badge disconnected';
    dom.kommoStatusBadge.textContent = 'Fallo de red';
    showToast('Fallo al probar Kommo: ' + err.message, 'error');
  } finally {
    dom.btnTestKommo.disabled = false;
    dom.btnTestKommo.innerHTML = `<span>Probar API</span>`;
  }
}

// Probar conexión con GHL
async function testGhlConnection() {
  dom.btnTestGhl.disabled = true;
  dom.btnTestGhl.innerHTML = `<span class="spinner"></span> Verificando...`;

  try {
    const res = await fetch('/api/test/ghl', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      dom.ghlStatusBadge.className = 'conn-badge connected';
      dom.ghlStatusBadge.textContent = `Conectado (${data.locationName})`;
      showToast(`¡Conexión exitosa con GHL! Subcuenta: ${data.locationName}`, 'success');
    } else {
      dom.ghlStatusBadge.className = 'conn-badge disconnected';
      dom.ghlStatusBadge.textContent = 'Error de conexión';
      showToast(data.error || 'Error al conectar con GoHighLevel', 'error');
    }
  } catch (err) {
    dom.ghlStatusBadge.className = 'conn-badge disconnected';
    dom.ghlStatusBadge.textContent = 'Fallo de red';
    showToast('Fallo al probar GHL: ' + err.message, 'error');
  } finally {
    dom.btnTestGhl.disabled = false;
    dom.btnTestGhl.innerHTML = `<span>Probar API</span>`;
  }
}

// ==========================================
// HISTORY & STATS LOGIC
// ==========================================
async function loadHistory() {
  try {
    const res = await fetch('/api/history?limit=30');
    const data = await res.json();
    
    state.stats = data.stats || state.stats;
    state.history = data.items || [];

    // Actualizar Contadores Métricos
    dom.statTotal.textContent = state.stats.total;
    dom.statSuccess.textContent = state.stats.successful;
    dom.statNotFound.textContent = state.stats.notFound;
    dom.statErrors.textContent = state.stats.errors;

    // Renderizar Tabla
    renderHistoryTable(state.history);
  } catch (err) {
    console.error('Error al cargar historial:', err);
  }
}

function renderHistoryTable(items) {
  if (!items || items.length === 0) {
    dom.historyTableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">
          No hay sincronizaciones registradas aún. Ejecuta una en la pestaña <strong>Simulador</strong> o envía un lead en Kommo.
        </td>
      </tr>
    `;
    return;
  }

  dom.historyTableBody.innerHTML = items.map((item, index) => {
    const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    // Status Badge
    let statusBadge = '';
    if (item.status === 'synced') {
      statusBadge = `<span class="status-badge synced">✅ Sincronizado</span>`;
    } else if (item.status === 'not_found_in_ghl') {
      statusBadge = `<span class="status-badge not_found_in_ghl">⚠️ No en GHL</span>`;
    } else if (item.status === 'no_phone') {
      statusBadge = `<span class="status-badge no_phone">📞 Sin teléfono</span>`;
    } else {
      statusBadge = `<span class="status-badge error">❌ Error</span>`;
    }

    // Datos enriquecidos resumidos
    let enrichedSummary = '—';
    if (item.updatedFields && item.updatedFields.length > 0) {
      enrichedSummary = item.updatedFields.join(', ');
    } else if (item.ghlData?.name) {
      enrichedSummary = `Nombre: ${item.ghlData.name}`;
    }

    return `
      <tr>
        <td class="mono-cell">${timeStr}</td>
        <td>
          <strong>${item.contactId ? `#${item.contactId}` : (item.leadId ? `Lead #${item.leadId}` : 'Directo')}</strong>
        </td>
        <td class="mono-cell">${item.matchedPhone || item.phone || item.phonesSearched?.[0] || 'N/A'}</td>
        <td>${statusBadge}</td>
        <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${enrichedSummary}
        </td>
        <td>
          <button class="btn btn-secondary" onclick="viewHistoryDetail(${index})" style="padding: 4px 10px; font-size: 0.75rem;">
            Ver Detalle
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Ver detalle en modal
window.viewHistoryDetail = function(index) {
  const item = state.history[index];
  if (!item) return;

  dom.modalTitle.textContent = `Detalle: Evento #${item.id || index + 1}`;
  
  let stepsHtml = '';
  if (Array.isArray(item.steps) && item.steps.length > 0) {
    stepsHtml = `
      <div style="margin-top: 14px;">
        <h4 style="font-size: 0.9rem; margin-bottom: 8px;">Pasos de Ejecución:</h4>
        <div class="pipeline-steps">
          ${item.steps.map(s => `
            <div class="step-card ${s.status}">
              <div class="step-content">
                <div class="step-title-row">
                  <span class="step-title">${s.title}</span>
                  <span class="step-time">${s.time}</span>
                </div>
                <div class="step-detail">${s.detail}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  dom.modalBody.innerHTML = `
    <div style="font-size: 0.88rem; line-height: 1.8;">
      <p><strong>Fecha y Hora:</strong> ${new Date(item.timestamp).toLocaleString()}</p>
      <p><strong>Estado:</strong> <span class="status-badge ${item.status}">${item.status}</span></p>
      <p><strong>ID Contacto Kommo:</strong> ${item.contactId || 'N/A'}</p>
      <p><strong>Teléfono:</strong> <span class="mono-cell">${item.matchedPhone || item.phone || 'N/A'}</span></p>
      ${item.ghlContactId ? `<p><strong>ID GoHighLevel:</strong> <span class="mono-cell">${item.ghlContactId}</span></p>` : ''}
    </div>
    ${stepsHtml}
    <div style="margin-top: 16px;">
      <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600;">DATOS COMPLETOS (JSON):</span>
      <pre class="code-inspector" style="max-height: 180px;">${JSON.stringify(item, null, 2)}</pre>
    </div>
  `;

  dom.detailModal.classList.add('active');
};

// ==========================================
// SIMULATOR LOGIC
// ==========================================
async function runSimulator(e) {
  e.preventDefault();
  
  const contactId = dom.simContactId.value.trim();
  const leadId = dom.simLeadId.value.trim();
  const directPhone = dom.simPhone.value.trim();

  if (!contactId && !leadId && !directPhone) {
    showToast('Ingresa al menos un ID de contacto, lead o un teléfono de prueba.', 'error');
    return;
  }

  dom.btnRunSimulator.disabled = true;
  dom.btnRunSimulator.innerHTML = `<span class="spinner"></span> Ejecutando sincronización...`;
  dom.simulatorStatus.textContent = 'Consultando Kommo y GoHighLevel...';

  dom.simulatorPipelineContainer.style.display = 'block';
  dom.pipelineSteps.innerHTML = `
    <div class="step-card info">
      <div class="step-content">
        <div class="step-title">Iniciando proceso...</div>
        <div class="step-detail">Enviando solicitud a los servicios de Kommo y GHL...</div>
      </div>
    </div>
  `;
  dom.simulatorRawJson.textContent = '// Procesando...';

  try {
    const res = await fetch('/api/sync/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId, leadId, directPhone })
    });

    const result = await res.json();
    dom.simulatorRawJson.textContent = JSON.stringify(result, null, 2);

    // Renderizar pasos devueltos
    if (Array.isArray(result.steps) && result.steps.length > 0) {
      dom.pipelineSteps.innerHTML = result.steps.map(step => `
        <div class="step-card ${step.status}">
          <div class="step-icon">
            ${step.status === 'success' ? '✅' : step.status === 'warning' ? '⚠️' : step.status === 'error' ? '❌' : 'ℹ️'}
          </div>
          <div class="step-content">
            <div class="step-title-row">
              <span class="step-title">${step.title}</span>
              <span class="step-time">${step.time}</span>
            </div>
            <div class="step-detail">${step.detail}</div>
            ${step.data ? `<pre class="code-inspector" style="margin-top:6px; max-height:120px;">${JSON.stringify(step.data, null, 2)}</pre>` : ''}
          </div>
        </div>
      `).join('');
    }

    if (result.success && result.status === 'synced') {
      showToast('¡Contacto encontrado en GHL y enriquecido en Kommo!', 'success');
      dom.simulatorStatus.textContent = '✅ Sincronización exitosa.';
    } else if (result.status === 'not_found_in_ghl') {
      showToast('El teléfono no existe en GoHighLevel.', 'info');
      dom.simulatorStatus.textContent = '⚠️ No existe en GHL.';
    } else {
      showToast(result.message || 'Error en la sincronización', 'error');
      dom.simulatorStatus.textContent = '❌ Proceso completado con alertas.';
    }

    // Recargar historial
    await loadHistory();

  } catch (err) {
    showToast('Error ejecutando simulador: ' + err.message, 'error');
    dom.simulatorStatus.textContent = '❌ Error de red';
    dom.simulatorRawJson.textContent = `// Error: ${err.message}`;
  } finally {
    dom.btnRunSimulator.disabled = false;
    dom.btnRunSimulator.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      <span>Ejecutar Sincronización Ahora</span>
    `;
  }
}

// ==========================================
// POLLING LOGIC (SONDEO AUTOMÁTICO POR API)
// ==========================================
async function loadPollingStatus() {
  try {
    const res = await fetch('/api/polling/status');
    const data = await res.json();
    if (data.active) {
      dom.pollingStatusBadge.className = 'conn-badge connected';
      dom.pollingStatusBadge.textContent = `🟢 Activo (${data.intervalSeconds}s)`;
      dom.btnTogglePolling.className = 'btn btn-danger';
      dom.btnTogglePolling.innerHTML = '<span>Pausar Monitoreo</span>';
    } else {
      dom.pollingStatusBadge.className = 'conn-badge disconnected';
      dom.pollingStatusBadge.textContent = 'Pausado';
      dom.btnTogglePolling.className = 'btn btn-primary';
      dom.btnTogglePolling.innerHTML = '<span>Activar Monitoreo (10s)</span>';
    }

    if (dom.pollingLastTime) {
      dom.pollingLastTime.textContent = data.lastCheckTime ? new Date(data.lastCheckTime).toLocaleTimeString() : 'Nunca';
    }
    if (dom.pollingCycleStatus) {
      dom.pollingCycleStatus.textContent = data.lastCheckStatus || 'Pausado';
    }
    if (dom.pollingCount) {
      dom.pollingCount.textContent = data.processedCount || 0;
    }
  } catch (err) {
    // Silencioso
  }
}

async function togglePolling() {
  dom.btnTogglePolling.disabled = true;
  try {
    const resStatus = await fetch('/api/polling/status');
    const curr = await resStatus.json();
    const endpoint = curr.active ? '/api/polling/stop' : '/api/polling/start';

    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interval: 10 })
    });

    await loadPollingStatus();
    showToast(curr.active ? 'Monitoreo por API pausado.' : '¡Monitoreo por API activado! Consultando Kommo cada 10s.', curr.active ? 'info' : 'success');
  } catch (err) {
    showToast('Error al cambiar estado de sondeo: ' + err.message, 'error');
  } finally {
    dom.btnTogglePolling.disabled = false;
  }
}

// ==========================================
// INICIALIZACIÓN
// ==========================================
function init() {
  initTabs();

  // Listeners de Configuración
  dom.configForm.addEventListener('submit', saveConfig);
  dom.btnReloadConfig.addEventListener('click', () => {
    loadConfig();
    showToast('Configuración recargada', 'info');
  });

  // Tests de Conexión
  dom.btnTestKommo.addEventListener('click', testKommoConnection);
  dom.btnTestGhl.addEventListener('click', testGhlConnection);

  // Copiar Webhook
  dom.btnCopyWebhook.addEventListener('click', () => {
    const url = dom.webhookDisplayUrl.textContent;
    navigator.clipboard.writeText(url).then(() => {
      showToast('¡URL del Webhook copiada al portapapeles!', 'success');
    }).catch(() => {
      showToast('No se pudo copiar automáticamente. Cópialo manualmente.', 'warning');
    });
  });

  // Polling Toggle
  if (dom.btnTogglePolling) {
    dom.btnTogglePolling.addEventListener('click', togglePolling);
  }

  // Simulador
  dom.simulatorForm.addEventListener('submit', runSimulator);

  // Historial
  dom.btnRefreshHistory.addEventListener('click', () => {
    loadHistory();
    showToast('Historial actualizado', 'info');
  });

  dom.btnClearHistory.addEventListener('click', async () => {
    if (confirm('¿Seguro que deseas vaciar el historial de sincronizaciones?')) {
      await fetch('/api/history', { method: 'DELETE' });
      await loadHistory();
      showToast('Historial vaciado', 'info');
    }
  });

  // Modal
  dom.modalCloseBtn.addEventListener('click', () => dom.detailModal.classList.remove('active'));
  dom.modalCloseBtnFooter.addEventListener('click', () => dom.detailModal.classList.remove('active'));
  dom.detailModal.addEventListener('click', (e) => {
    if (e.target === dom.detailModal) dom.detailModal.classList.remove('active');
  });

  // Toggle de visualización de passwords en formulario
  document.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-toggle');
      const input = document.getElementById(targetId);
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
      }
    });
  });

  // Carga inicial
  loadConfig();
  loadHistory();
  loadPollingStatus();

  // Polling automático cada 4 segundos para mantener el feed y el monitor al día
  state.autoRefreshInterval = setInterval(() => {
    loadHistory();
    loadPollingStatus();
  }, 4000);
}

document.addEventListener('DOMContentLoaded', init);

