#!/usr/bin/env node
import { syncKommoContactWithGHL } from '../src/services/sync.js';
import { validateConfig } from '../src/config.js';

async function main() {
  const args = process.argv.slice(2);
  let contactId = null;
  let leadId = null;
  let phone = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--contact' && args[i + 1]) {
      contactId = args[i + 1];
      i++;
    } else if (args[i] === '--lead' && args[i + 1]) {
      leadId = args[i + 1];
      i++;
    } else if (args[i] === '--phone' && args[i + 1]) {
      phone = args[i + 1];
      i++;
    }
  }

  console.log(`\n🧪 Iniciando prueba manual de sincronización...`);
  const validation = validateConfig();
  if (!validation.valid) {
    console.error(`❌ Faltan variables en el archivo .env:`, validation.missing);
    process.exit(1);
  }

  if (!contactId && !leadId && !phone) {
    console.log(`
Uso del script de prueba:
  node scripts/test-contact.js --contact <ID_CONTACTO_KOMMO>
  node scripts/test-contact.js --lead <ID_LEAD_KOMMO>
  node scripts/test-contact.js --phone "+525512345678" --contact <ID_CONTACTO_KOMMO>

Ejemplo:
  node scripts/test-contact.js --contact 24598123
`);
    process.exit(0);
  }

  try {
    const result = await syncKommoContactWithGHL({
      contactId,
      leadId,
      directPhone: phone
    });

    console.log(`\n📋 Resultado final:`);
    console.dir(result, { depth: null, colors: true });
  } catch (error) {
    console.error(`\n❌ Error ejecutando la sincronización:`, error.message);
    if (error.response?.data) {
      console.error(`Detalles del API:`, error.response.data);
    }
  }
}

main();
