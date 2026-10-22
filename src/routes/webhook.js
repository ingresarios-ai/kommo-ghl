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

/**
 * Extrae los IDs de contactos o leads del payload recibido de Kommo.
 * Soporta eventos de chat (WhatsApp, Telegram), mensajes entrantes, leads sin clasificar,
 * webhooks estándar de Kommo y llamadas JSON desde Salesbot.
 */
async function extractKommoIdentifiers(req) {
  const body = req.body || {};
  const query = req.query || {};

  // 1. Directo por JSON o Query (ej: Salesbot en WhatsApp/Telegram)
  let contactId = body.contact_id || body.contactId || query.contact_id || query.contactId || null;
  let leadId = body.lead_id || body.leadId || query.lead_id || query.leadId || null;
  let directPhone = body.phone || query.phone || null;

  // 2. Formato nativo de Webhooks de Kommo: contacts[add][0][id] o leads[add][0][id]
  if (!contactId && body.contacts) {
    const adds = body.contacts.add;
    const updates = body.contacts.update;
    if (Array.isArray(adds) && adds[0]?.id) contactId = adds[0].id;
    else if (Array.isArray(updates) && updates[0]?.id) contactId = updates[0].id;
  }

  if (!leadId && body.leads) {
    const adds = body.leads.add;
    const status = body.leads.status;
    if (Array.isArray(adds) && adds[0]?.id) leadId = adds[0].id;
    else if (Array.isArray(status) && status[0]?.id) leadId = status[0].id;
  }

  // 3. Eventos de Mensajes de Chat (WhatsApp / Telegram entrante)
  if (!contactId && body.message) {
    const msgAdds = body.message.add;
    if (Array.isArray(msgAdds) && msgAdds[0]) {
      contactId = msgAdds[0].contact_id || msgAdds[0].element_id || null;
      if (msgAdds[0].chat_id && !contactId) {
        // En WhatsApp a veces el chat_id es el propio teléfono
        const cleanChat = String(msgAdds[0].chat_id).replace(/\D/g, '');
        if (cleanChat.length >= 8) directPhone = `+${cleanChat}`;
      }
    }
  }

  // 4. Eventos de Conversaciones / Talks (talk[add][0])
  if (!contactId && body.talk) {
    const talkAdds = body.talk.add;
    if (Array.isArray(talkAdds) && talkAdds[0]) {
      contactId = talkAdds[0].contact_id || talkAdds[0].element_id || null;
    }
  }

  // 5. Eventos de Leads "Sin clasificar" (unsorted[add][0][uid] - típico de WhatsApp/Telegram entrante)
  let unsortedUid = null;
  if (body.unsorted && Array.isArray(body.unsorted.add) && body.unsorted.add[0]?.uid) {
    unsortedUid = body.unsorted.add[0].uid;
  } else {
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

  // 6. Formato plano si el parser no expandió corchetes (ej: body['contacts[add][0][id]'])
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

  return { contactId, leadId, directPhone };
}


/**
 * Endpoint principal para recibir alertas de Kommo cuando llega o se crea un lead/contacto.
 * Ruta: POST /webhook/kommo-lead
 */
webhookRouter.post('/kommo-lead', verifySecret, async (req, res) => {
  const identifiers = await extractKommoIdentifiers(req);

  console.log(`[Webhook] Petición recibida en /webhook/kommo-lead`);
  console.log(`[Webhook] Identificadores extraídos:`, identifiers);

  if (!identifiers.contactId && !identifiers.leadId && !identifiers.directPhone) {
    console.warn(`[Webhook] Payload recibido no contiene identificadores válidos.`);
    return res.status(200).json({
      received: true,
      processed: false,
      message: 'No se encontraron IDs de contacto o lead en el cuerpo del webhook.'
    });
  }

  // Responder inmediatamente 200 OK a Kommo para evitar timeouts de webhook
  // y procesar la sincronización en segundo plano de manera asíncrona.
  res.status(200).json({
    received: true,
    message: 'Evento recibido y puesto en proceso de sincronización con GHL.'
  });

  // Ejecución en segundo plano
  syncKommoContactWithGHL(identifiers).catch(err => {
    console.error(`[Webhook Background Error] Error sincronizando contacto:`, err.message);
  });
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
