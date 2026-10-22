import * as kommoService from './kommo.js';
import * as ghlService from './ghl.js';
import { recordSyncEvent } from './history.js';

/**
 * Orquesta la sincronización entre Kommo CRM y GoHighLevel.
 * @param {object} params
 * @param {string|number} [params.contactId] - ID del contacto en Kommo
 * @param {string|number} [params.leadId] - ID del lead en Kommo (si el webhook envió lead_id)
 * @param {string} [params.directPhone] - Opcional: teléfono directo para pruebas
 * @param {string} [params.source] - Origen: 'webhook', 'ui_test', 'cli'
 * @returns {Promise<object>}
 */
export async function syncKommoContactWithGHL({ contactId, leadId, directPhone, source = 'webhook' }) {
  console.log(`\n======================================================`);
  console.log(`[SYNC INICIO] ContactID: ${contactId || 'N/A'}, LeadID: ${leadId || 'N/A'}, Phone: ${directPhone || 'N/A'}`);
  console.log(`======================================================`);

  const steps = [];
  const addStep = (title, status, detail, data = null) => {
    steps.push({
      time: new Date().toLocaleTimeString(),
      title,
      status, // 'success', 'warning', 'info', 'error'
      detail,
      data
    });
  };

  let resolvedContactId = contactId;

  try {
    // 1. Si sólo se proporcionó leadId, buscar el contacto principal asociado al lead
    if (!resolvedContactId && leadId) {
      addStep('Consultar Lead en Kommo', 'info', `Buscando contacto asociado al Lead #${leadId}`);
      const lead = await kommoService.getLead(leadId);
      const embeddedContacts = lead?._embedded?.contacts;
      if (Array.isArray(embeddedContacts) && embeddedContacts.length > 0) {
        resolvedContactId = embeddedContacts[0].id;
        addStep('Contacto Encontrado en Lead', 'success', `Contacto principal asociado ID #${resolvedContactId}`);
      } else {
        const errorResult = {
          success: false,
          status: 'no_contact_in_lead',
          contactId: null,
          leadId,
          steps,
          message: `El lead #${leadId} no tiene ningún contacto asociado.`
        };
        recordSyncEvent({ ...errorResult, source });
        return errorResult;
      }
    }

    if (!resolvedContactId && !directPhone) {
      const errorResult = {
        success: false,
        status: 'missing_identifier',
        contactId: null,
        leadId,
        steps,
        message: 'Se requiere contactId, leadId o directPhone para sincronizar.'
      };
      recordSyncEvent({ ...errorResult, source });
      return errorResult;
    }

    // 2. Obtener datos actuales del contacto en Kommo
    let kommoContact = null;
    let phonesToSearch = [];

    if (resolvedContactId) {
      addStep('Consultar Contacto en Kommo API v4', 'info', `Leyendo datos completos del contacto #${resolvedContactId}`);
      kommoContact = await kommoService.getContact(resolvedContactId);
      phonesToSearch = kommoService.extractPhonesFromContact(kommoContact);
      addStep('Extracción de Teléfonos', 'info', `Detectados ${phonesToSearch.length} número(s)`, { phones: phonesToSearch });
    }

    if (directPhone) {
      phonesToSearch.unshift(directPhone);
    }

    if (phonesToSearch.length === 0) {
      addStep('Sin Teléfono Registrado', 'warning', `El contacto #${resolvedContactId} no tiene número telefónico en Kommo.`);
      const noPhoneResult = {
        success: false,
        status: 'no_phone',
        contactId: resolvedContactId,
        leadId,
        steps,
        message: 'El contacto en Kommo no posee número de teléfono.'
      };
      recordSyncEvent({ ...noPhoneResult, source });
      return noPhoneResult;
    }

    // 3. Buscar en GoHighLevel por cada teléfono hasta hallar coincidencia
    addStep('Búsqueda en GoHighLevel API v2', 'info', `Buscando coincidencias para: ${phonesToSearch.join(', ')}`);
    let ghlResult = null;
    let matchedPhone = null;

    for (const phone of phonesToSearch) {
      const searchResult = await ghlService.findContactByPhone(phone);
      if (searchResult.found && searchResult.contact) {
        ghlResult = searchResult.contact;
        matchedPhone = searchResult.matchedPhone;
        break;
      }
    }

    // 4. Si NO existe en GHL -> "si no está, entonces no hace nada"
    if (!ghlResult) {
      addStep('No Existe en GHL', 'info', `El teléfono ${phonesToSearch[0]} no está registrado en GHL. Ninguna acción realizada en Kommo.`);
      const notFoundResult = {
        success: true,
        status: 'not_found_in_ghl',
        contactId: resolvedContactId,
        leadId,
        phonesSearched: phonesToSearch,
        steps,
        message: 'El contacto no existe en GoHighLevel. No se realizó ninguna acción ni modificación en Kommo.'
      };
      recordSyncEvent({ ...notFoundResult, source, phone: phonesToSearch[0] });
      return notFoundResult;
    }

    // 5. SI EXISTE en GHL -> Extraer datos para enriquecer a Kommo: Nombre, Email, Teléfono, Etiquetas
    const ghlFirstName = ghlResult.firstName?.trim();
    const ghlLastName = ghlResult.lastName?.trim();
    const ghlFullName = (ghlResult.name || `${ghlFirstName || ''} ${ghlLastName || ''}`).trim();
    const ghlEmail = ghlResult.email?.trim();
    const ghlPhone = ghlResult.phone?.trim() || matchedPhone;
    const ghlTags = Array.isArray(ghlResult.tags) ? ghlResult.tags : [];

    addStep('Contacto Encontrado en GHL', 'success', `Contacto ID: ${ghlResult.id} (${ghlFullName || 'Sin nombre'})`, {
      name: ghlFullName,
      email: ghlEmail,
      phone: ghlPhone,
      tags: ghlTags,
      matchedPhone
    });

    const updateData = {};
    const updatedFieldNames = [];

    // A) Nombre / Apellidos desde GHL
    if (ghlFullName) {
      updateData.name = ghlFullName;
      if (ghlFirstName) updateData.firstName = ghlFirstName;
      if (ghlLastName) updateData.lastName = ghlLastName;
      updatedFieldNames.push(`Nombre: ${ghlFullName}`);
    }

    // B) Email desde GHL
    if (ghlEmail) {
      updateData.email = ghlEmail;
      updatedFieldNames.push(`Email: ${ghlEmail}`);
    }

    // C) Teléfono desde GHL (asegurar formato limpio en campo de teléfono de Kommo)
    if (ghlPhone) {
      updateData.phone = ghlPhone;
      updatedFieldNames.push(`Teléfono: ${ghlPhone}`);
    }

    // D) Etiquetas (Tags) desde GHL
    if (ghlTags.length > 0) {
      updateData.tags = ghlTags;
      updatedFieldNames.push(`Etiquetas: [${ghlTags.join(', ')}]`);
    }

    // 6. Actualizar en Kommo si hay datos para enriquecer
    if (resolvedContactId && (updateData.name || updateData.email || updateData.phone || updateData.tags)) {
      addStep('Actualización en Kommo API v4', 'info', `Actualizando: ${updatedFieldNames.join(' | ')}`);
      await kommoService.updateContact(resolvedContactId, updateData);

      // Agregar nota en el feed de Kommo para trazabilidad del vendedor
      const noteText = [
        `🔄 Datos sincronizados automáticamente desde GoHighLevel (GHL):`,
        ghlFullName ? `• Nombre: ${ghlFullName}` : null,
        ghlEmail ? `• Email: ${ghlEmail}` : null,
        ghlPhone ? `• Teléfono: ${ghlPhone}` : null,
        ghlTags.length ? `• Etiquetas GHL: ${ghlTags.join(', ')}` : null,
        `• Teléfono coincidente: ${matchedPhone}`
      ].filter(Boolean).join('\n');

      await kommoService.addContactNote(resolvedContactId, noteText);
      addStep('Nota en Feed de Kommo', 'success', `Nota agregada para que el equipo comercial vea la información.`);
    }

    addStep('Sincronización Completada', 'success', `Contacto #${resolvedContactId} enriquecido con éxito con datos de GHL.`);

    const successResult = {
      success: true,
      status: 'synced',
      contactId: resolvedContactId,
      leadId,
      phone: ghlPhone,
      ghlContactId: ghlResult.id,
      matchedPhone,
      updatedFields: updatedFieldNames,
      steps,
      ghlData: {
        name: ghlFullName,
        email: ghlEmail,
        phone: ghlPhone,
        tags: ghlTags
      }
    };
    recordSyncEvent({ ...successResult, source });
    return successResult;


  } catch (error) {
    const errorMsg = error.response?.data?.['detail'] || error.response?.data?.message || error.message;
    addStep('Error en el Proceso', 'error', `Fallo: ${errorMsg}`);
    
    const failedResult = {
      success: false,
      status: 'error',
      contactId: resolvedContactId,
      leadId,
      error: errorMsg,
      steps,
      message: `Error durante la sincronización: ${errorMsg}`
    };
    recordSyncEvent({ ...failedResult, source });
    throw error;
  }
}
