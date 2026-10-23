import { Router } from 'express';
import { syncKommoContactWithGHL } from '../services/sync.js';
import { config } from '../config.js';

export const webhookRouter = Router();

/**
 * Middleware para validar secreto de webhook si está configurado en .env
 */
function verifySecret(req, res, next) {
  if (!config.webhookSecret) {
    return next();
  }

  const providedSecret = req.query.secret || req.headers['x-webhook-secret'] || req.body?.secret;
  if (providedSecret !== config.webhookSecret) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'El secreto del webhook es inválido o no fue proporcionado.'
    });
  }

  next();
}

/**
 * Extrae los IDs de contactos o leads del payload recibido de Kommo
 * Soporta formato estándar de Webhooks de Kommo (PHP style arrays) y formato JSON de Salesbot.
 */
import * as kommoService from '../services/kommo.js';
import { recordSyncEvent } from '../services/history.js';

function getFirstEntity(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val[0] || null;
  if (typeof val === 'object') {
    const firstKey = Object.keys(val)[0];
    return val[firstKey] || val;
  }
  return null;
}

/**
 * Extrae los IDs de contactos o leads del payload recibido de Kommo.
 * Soporta eventos de chat (WhatsApp, Telegram), mensajes entrantes, leads sin clasificar,
 * arrays indexados PHP (como contacts[add][0][id] o {'0': {id: ...}}) y llamadas JSON.
 */
async function extractKommoIdentifiers(req) {
  const body = req.body || {};
  const query = req.query || {};

  // 1. Directo por JSON o Query (ej: Salesbot en WhatsApp/Telegram)
  let contactId = body.contact_id || body.contactId || query.contact_id || query.contactId || null;
  let leadId = body.lead_id || body.leadId || query.lead_id || query.leadId || null;
  let directPhone = body.phone || query.phone || null;

  // 2. Formato nativo de Webhooks de Kommo: contacts[add] o contacts[update]
  if (!contactId && body.contacts) {
    const addEntity = getFirstEntity(body.contacts.add);
    const updateEntity = getFirstEntity(body.contacts.update);
    if (addEntity?.id) contactId = addEntity.id;
    else if (updateEntity?.id) contactId = updateEntity.id;

    const entity = addEntity || updateEntity;
    if (entity?.custom_fields) {
      const cfs = Array.isArray(entity.custom_fields) ? entity.custom_fields : Object.values(entity.custom_fields);
      for (const cf of cfs) {
        if (cf.values) {
          const vals = Array.isArray(cf.values) ? cf.values : Object.values(cf.values);
          for (const v of vals) {
            const rawVal = v.value || v;
            const digits = String(rawVal).replace(/\D/g, '');
            if (digits.length >= 10 && digits.length <= 15) {
              if (!directPhone) directPhone = String(rawVal);
            }
          }
        }
      }
    }
  }

  // 3. Formato nativo de Leads: leads[add] o leads[status]
  if (!leadId && body.leads) {
    const addEntity = getFirstEntity(body.leads.add);
    const statusEntity = getFirstEntity(body.leads.status);
    if (addEntity?.id) leadId = addEntity.id;
    else if (statusEntity?.id) leadId = statusEntity.id;
  }

  // 4. Eventos de Mensajes de Chat (WhatsApp / Telegram entrante)
  if (body.message) {
    const msgEntity = getFirstEntity(body.message.add);
    if (msgEntity) {
      if (!contactId) contactId = msgEntity.contact_id || msgEntity.element_id || null;
      if (!directPhone && msgEntity.chat_id) {
        const cleanChat = String(msgEntity.chat_id).replace(/\D/g, '');
        if (cleanChat.length >= 10) directPhone = `+${cleanChat}`;
      }
      if (!directPhone && msgEntity.author_id) {
        const cleanAuth = String(msgEntity.author_id).replace(/\D/g, '');
        if (cleanAuth.length >= 10) directPhone = `+${cleanAuth}`;
      }
    }
  }

  // 5. Eventos de Conversaciones / Talks (talk[add])
  if (body.talk) {
    const talkEntity = getFirstEntity(body.talk.add);
    if (talkEntity) {
      if (!contactId) contactId = talkEntity.contact_id || talkEntity.element_id || null;
      if (!directPhone && talkEntity.chat_id) {
        const cleanChat = String(talkEntity.chat_id).replace(/\D/g, '');
        if (cleanChat.length >= 10) directPhone = `+${cleanChat}`;
      }
    }
  }

  // 6. Eventos de Leads "Sin clasificar" (unsorted[add][0][uid] - típico de WhatsApp/Telegram entrante)
  let unsortedUid = null;
  if (body.unsorted) {
    const unsortedEntity = getFirstEntity(body.unsorted.add);
    if (unsortedEntity?.uid) {
      unsortedUid = unsortedEntity.uid;
    }
  }
  if (!unsortedUid) {
    const flatUnsortedKey = Object.keys(body).find(k => k.startsWith('unsorted[') && k.endsWith('[uid]'));
    if (flatUnsortedKey) unsortedUid = body[flatUnsortedKey];
  }

  if (unsortedUid && (!contactId && !leadId)) {
    try {
      console.log(`[Webhook] Detectado lead sin clasificar (Unsorted UID: ${unsortedUid}) de WhatsApp/Telegram`);
      const unsortedData = await kommoService.getUnsorted(unsortedUid);
      const embeddedContacts = unsortedData?._embedded?.contacts;
      const embeddedLeads = unsortedData?._embedded?.leads;
      if (Array.isArray(embeddedContacts) && embeddedContacts[0]?.id) {
        contactId = embeddedContacts[0].id;
      }
      if (Array.isArray(embeddedLeads) && embeddedLeads[0]?.id) {
        leadId = embeddedLeads[0].id;
      }
    } catch (err) {
      console.warn(`[Webhook] No se pudo resolver Unsorted UID ${unsortedUid}:`, err.message);
    }
  }

  // 7. Formato plano si el parser no expandió corchetes (ej: body['contacts[add][0][id]'])
  if (!contactId) {
    const flatContactKey = Object.keys(body).find(k => 
      (k.startsWith('contacts[') && k.endsWith('[id]')) ||
      (k.startsWith('message[') && (k.endsWith('[contact_id]') || k.endsWith('[element_id]'))) ||
      (k.startsWith('talk[') && (k.endsWith('[contact_id]') || k.endsWith('[element_id]')))
    );
    if (flatContactKey) {
      contactId = body[flatContactKey];
    }
  }

  if (!leadId) {
    const flatLeadKey = Object.keys(body).find(k => k.startsWith('leads[') && k.endsWith('[id]'));
    if (flatLeadKey) {
      leadId = body[flatLeadKey];
    }
  }

  // 8. Búsqueda profunda en todo el payload por si viene un número telefónico (10 a 15 dígitos)
  if (!contactId && !leadId && !directPhone) {
    const findPhoneInObject = (obj) => {
      if (!obj) return null;
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (typeof val === 'string' || typeof val === 'number') {
          const str = String(val).trim();
          const digits = str.replace(/\D/g, '');
          if (digits.length >= 10 && digits.length <= 15) {
            const isTimestamp = digits.length === 10 && (digits.startsWith('17') || digits.startsWith('16'));
            if (!isTimestamp) {
              return str;
            }
          }
        } else if (typeof val === 'object') {
          const res = findPhoneInObject(val);
          if (res) return res;
        }
      }
      return null;
    };

    const foundPhone = findPhoneInObject(body);
    if (foundPhone) {
      directPhone = foundPhone;
      console.log(`[Webhook] Teléfono detectado en payload profundo: ${directPhone}`);
    }
  }

  return { contactId, leadId, directPhone };
}

/**
 * Endpoint principal para recibir alertas de Kommo cuando llega o se crea un lead/contacto.
 * Ruta: POST /webhook/kommo-lead
 */
webhookRouter.post('/kommo-lead', verifySecret, async (req, res) => {
  console.log(`[Webhook] Petición recibida en /webhook/kommo-lead`);
  console.log(`[Webhook] Body:`, JSON.stringify(req.body));

  const identifiers = await extractKommoIdentifiers(req);
  console.log(`[Webhook] Identificadores extraídos:`, identifiers);

  if (!identifiers.contactId && !identifiers.leadId && !identifiers.directPhone) {
    console.warn(`[Webhook] Payload recibido no contiene identificadores válidos.`);
    recordSyncEvent({
      success: false,
      status: 'no_identifiers_found',
      contactId: null,
      leadId: null,
      source: 'webhook',
      message: 'Webhook recibido pero no se encontraron IDs ni teléfono en el cuerpo.',
      rawPayload: req.body,
      steps: [{
        time: new Date().toLocaleTimeString(),
        title: 'Webhook Recibido Sin Identificadores',
        status: 'warning',
        detail: 'Kommo envió una petición pero no se reconoció contact_id, lead_id ni teléfono en el payload.',
        data: req.body
      }]
    });
    return res.status(200).json({
      received: true,
      processed: false,
      message: 'No se encontraron IDs de contacto o lead en el cuerpo del webhook.'
    });
  }

  // IMPORTANTE EN VERCEL SERVERLESS:
  // Es OBLIGATORIO usar await aquí para que la función Lambda no se congele antes de terminar la llamada a GHL y Kommo.
  try {
    const result = await syncKommoContactWithGHL({
      ...identifiers,
      source: 'webhook'
    });

    return res.status(200).json({
      received: true,
      processed: true,
      result
    });
  } catch (err) {
    console.error(`[Webhook Error] Error sincronizando contacto:`, err);
    return res.status(200).json({
      received: true,
      processed: false,
      error: err.message
    });
  }
});

/**
 * Endpoint para pruebas directas y síncronas (espera la respuesta de GHL y Kommo).
 * Ruta: POST /api/sync-test
 */
webhookRouter.post('/api/sync-test', verifySecret, async (req, res) => {
  try {
    const identifiers = await extractKommoIdentifiers(req);
    const result = await syncKommoContactWithGHL(identifiers);

    return res.status(200).json(result);
  } catch (err) {
    console.error(`[Sync Test Error]:`, err);
    return res.status(500).json({
      success: false,
      error: err.message,
      details: err.response?.data || null
    });
  }
});
