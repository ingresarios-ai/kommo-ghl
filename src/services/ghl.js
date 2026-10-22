import axios from 'axios';
import { config } from '../config.js';
import { getPhoneSearchVariants } from '../utils/phone.js';

/**
 * Cliente HTTP configurado para GoHighLevel API v2
 */
function getGhlClient() {
  if (!config.ghl.accessToken || !config.ghl.locationId) {
    throw new Error('Credenciales de GoHighLevel no configuradas. Revisa tu archivo .env');
  }

  return axios.create({
    baseURL: config.ghl.baseUrl,
    headers: {
      Authorization: `Bearer ${config.ghl.accessToken}`,
      Version: '2021-07-28',
      Accept: 'application/json'
    },
    timeout: 10000
  });
}

/**
 * Prueba la conexión con la API de GoHighLevel consultando la subcuenta (Location)
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
export async function testConnection() {
  try {
    const client = getGhlClient();
    const response = await client.get(`/locations/${config.ghl.locationId}`);
    const loc = response.data?.location || response.data;
    return {
      success: true,
      locationName: loc?.name || loc?.business?.name || 'Subcuenta GHL',
      locationId: config.ghl.locationId,
      email: loc?.email,
      phone: loc?.phone
    };
  } catch (error) {
    const message = error.response?.data?.message || error.response?.data?.error || error.message;
    return {
      success: false,
      error: `Error de conexión con GHL (${error.response?.status || 'Network'}): ${message}`,
      status: error.response?.status
    };
  }
}

async function searchDuplicateByPhone(phone) {
  const client = getGhlClient();
  try {
    const response = await client.get('/contacts/search/duplicate', {
      params: {
        locationId: config.ghl.locationId,
        phone: phone
      }
    });

    if (response.data && response.data.contact) {
      return response.data.contact;
    }
    return null;
  } catch (error) {
    // Si la API retorna 404 significa que no existe duplicado con ese teléfono
    if (error.response && error.response.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Búsqueda fallback usando el endpoint general de contactos con filtro query
 * @param {string} phone
 * @returns {Promise<object|null>}
 */
async function searchContactsByQuery(phone) {
  const client = getGhlClient();
  try {
    const response = await client.get('/contacts/', {
      params: {
        locationId: config.ghl.locationId,
        query: phone,
        limit: 5
      }
    });

    const contacts = response.data?.contacts;
    if (Array.isArray(contacts) && contacts.length > 0) {
      // Retornar el primer contacto coincidente
      return contacts[0];
    }
    return null;
  } catch (error) {
    console.warn(`[GHL] Error en búsqueda fallback de contacto para ${phone}:`, error.message);
    return null;
  }
}

/**
 * Busca exhaustivamente si un teléfono existe en GoHighLevel probando variantes
 * (+52, 52, con/sin 1 de WhatsApp, etc.)
 * @param {string} rawPhone
 * @returns {Promise<{ found: boolean, contact: object|null, matchedPhone: string|null }>}
 */
export async function findContactByPhone(rawPhone) {
  const variants = getPhoneSearchVariants(rawPhone);

  if (variants.length === 0) {
    return { found: false, contact: null, matchedPhone: null };
  }

  // 1. Probar cada variante con el endpoint de duplicados (el más preciso)
  for (const variant of variants) {
    try {
      const contact = await searchDuplicateByPhone(variant);
      if (contact) {
        return {
          found: true,
          contact: contact,
          matchedPhone: variant
        };
      }
    } catch (err) {
      console.warn(`[GHL] Error buscando variante ${variant}:`, err.message);
    }
  }

  // 2. Si no lo encontró con duplicados, intentar con el endpoint general de consulta
  for (const variant of variants) {
    try {
      const contact = await searchContactsByQuery(variant);
      if (contact) {
        return {
          found: true,
          contact: contact,
          matchedPhone: variant
        };
      }
    } catch (err) {
      // Continuar con la siguiente variante
    }
  }

  return { found: false, contact: null, matchedPhone: null };
}

/**
 * Obtiene los detalles completos de un contacto en GHL por su ID
 * @param {string} contactId
 * @returns {Promise<object>}
 */
export async function getContactById(contactId) {
  const client = getGhlClient();
  const response = await client.get(`/contacts/${contactId}`);
  return response.data?.contact || response.data;
}
