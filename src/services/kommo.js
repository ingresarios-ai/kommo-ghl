import axios from 'axios';
import { config } from '../config.js';

/**
 * Cliente HTTP configurado para la API v4 de Kommo CRM
 */
function getKommoClient() {
  if (!config.kommo.baseUrl || !config.kommo.accessToken) {
    throw new Error('Credenciales de Kommo no configuradas. Revisa tu archivo .env');
  }

  return axios.create({
    baseURL: config.kommo.baseUrl,
    headers: {
      Authorization: `Bearer ${config.kommo.accessToken}`,
      'Content-Type': 'application/json'
    },
    timeout: 10000
  });
}

/**
 * Prueba la conexión con la API de Kommo consultando los datos de la cuenta
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
export async function testConnection() {
  try {
    const client = getKommoClient();
    const response = await client.get('/account');
    return {
      success: true,
      accountName: response.data?.name || 'Cuenta Kommo',
      accountId: response.data?.id,
      country: response.data?.country,
      currency: response.data?.currency
    };
  } catch (error) {
    const message = error.response?.data?.['detail'] || error.response?.data?.title || error.message;
    return {
      success: false,
      error: `Error de conexión con Kommo (${error.response?.status || 'Network'}): ${message}`,
      status: error.response?.status
    };
  }
}

export async function getContact(contactId) {
  const client = getKommoClient();
  const response = await client.get(`/contacts/${contactId}?with=leads`);
  return response.data;
}

/**
 * Obtiene los contactos más recientes creados o modificados en Kommo
 * @param {number} [limit=15]
 * @returns {Promise<Array>}
 */
export async function getRecentContacts(limit = 15) {
  const client = getKommoClient();
  const response = await client.get(`/contacts`, {
    params: {
      'order[updated_at]': 'desc',
      limit: limit,
      with: 'leads'
    }
  });
  return response.data?._embedded?.contacts || [];
}


/**
 * Obtiene un Lead por su ID (útil si el webhook dispara con lead_id)
 * @param {string|number} leadId
 * @returns {Promise<object>}
 */
export async function getLead(leadId) {
  const client = getKommoClient();
  const response = await client.get(`/leads/${leadId}?with=contacts`);
  return response.data;
}

/**
 * Obtiene un lead de la sección "Sin clasificar" (leads entrantes por chat de WhatsApp/Telegram)
 * @param {string} uid
 * @returns {Promise<object>}
 */
export async function getUnsorted(uid) {
  const client = getKommoClient();
  const response = await client.get(`/leads/unsorted/${uid}`);
  return response.data;
}


/**
 * Busca contactos en Kommo por texto o teléfono
 * @param {string} query
 * @returns {Promise<Array>}
 */
export async function searchContacts(query) {
  try {
    const client = getKommoClient();
    const response = await client.get('/contacts', {
      params: {
        query: query,
        with: 'leads'
      }
    });
    return response.data?._embedded?.contacts || [];
  } catch (error) {
    return [];
  }
}

/**
 * Extrae los números de teléfono del objeto contacto de Kommo
 * @param {object} contact
 * @returns {string[]}
 */
export function extractPhonesFromContact(contact) {
  if (!contact) return [];

  const phones = [];

  // 1. Extraer desde custom_fields_values (campo PHONE estándar de Kommo)
  if (Array.isArray(contact.custom_fields_values)) {
    for (const field of contact.custom_fields_values) {
      const isPhoneField = 
        field.field_code === 'PHONE' || 
        /tel[eé]fono|phone|celular|m[oó]vil|whatsapp/i.test(field.field_name || '');

      if (isPhoneField && Array.isArray(field.values)) {
        for (const valObj of field.values) {
          if (valObj && valObj.value) {
            phones.push(String(valObj.value).trim());
          }
        }
      }
    }
  }

  // 2. Extraer desde el nombre del contacto (típico cuando WhatsApp crea el contacto con el teléfono como nombre)
  if (contact.name) {
    const digits = String(contact.name).replace(/\D/g, '');
    if (digits.length >= 10) {
      phones.push(String(contact.name).trim());
    }
  }

  if (contact.first_name) {
    const digits = String(contact.first_name).replace(/\D/g, '');
    if (digits.length >= 10 && !phones.includes(contact.first_name)) {
      phones.push(String(contact.first_name).trim());
    }
  }

  return Array.from(new Set(phones));
}


/**
 * Actualiza los datos de un contacto en Kommo (Nombre, Email, Etiquetas, etc.)
 * @param {string|number} contactId
 * @param {object} updateData
 * @param {string} [updateData.name]
 * @param {string} [updateData.firstName]
 * @param {string} [updateData.lastName]
 * @param {string} [updateData.email]
 * @param {string[]} [updateData.tags]
 * @param {Array} [updateData.customFields]
 * @returns {Promise<object>}
 */
export async function updateContact(contactId, updateData) {
  const client = getKommoClient();
  const payload = {};

  // Actualizar nombre
  if (updateData.name) {
    payload.name = updateData.name;
  }
  if (updateData.firstName) {
    payload.first_name = updateData.firstName;
  }
  if (updateData.lastName) {
    payload.last_name = updateData.lastName;
  }

  // Actualizar campos personalizados (por ejemplo EMAIL)
  const customFieldsValues = [];

  if (updateData.email) {
    customFieldsValues.push({
      field_code: 'EMAIL',
      values: [
        {
          value: updateData.email,
          enum_code: 'WORK'
        }
      ]
    });
  }

  // Actualizar Teléfono si se proporciona
  if (updateData.phone) {
    customFieldsValues.push({
      field_code: 'PHONE',
      values: [
        {
          value: updateData.phone,
          enum_code: 'WORK'
        }
      ]
    });
  }


  if (Array.isArray(updateData.customFields) && updateData.customFields.length > 0) {
    customFieldsValues.push(...updateData.customFields);
  }

  if (customFieldsValues.length > 0) {
    payload.custom_fields_values = customFieldsValues;
  }

  // Agregar etiquetas (tags_to_add no borra las existentes, solo suma las nuevas)
  if (Array.isArray(updateData.tags) && updateData.tags.length > 0) {
    payload.tags_to_add = updateData.tags.map(t => ({
      name: typeof t === 'string' ? t.trim() : t.name
    })).filter(t => t.name.length > 0);
  }

  const response = await client.patch(`/contacts/${contactId}`, payload);
  return response.data;
}

/**
 * Agrega una nota interna en la línea de tiempo del contacto en Kommo
 * @param {string|number} contactId
 * @param {string} text
 * @returns {Promise<object>}
 */
export async function addContactNote(contactId, text) {
  try {
    const client = getKommoClient();
    const payload = [
      {
        note_type: 'common',
        params: {
          text: text
        }
      }
    ];
    const response = await client.post(`/contacts/${contactId}/notes`, payload);
    return response.data;
  } catch (error) {
    // Si falla agregar la nota, no rompemos el flujo principal
    console.warn(`[Kommo] No se pudo agregar la nota al contacto ${contactId}:`, error.message);
    return null;
  }
}
