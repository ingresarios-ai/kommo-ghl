/**
 * Utilidades para limpiar, normalizar y generar variantes de números telefónicos.
 */

/**
 * Limpia un número eliminando espacios, guiones, paréntesis y caracteres no numéricos.
 * Mantiene el '+' inicial si existe.
 * @param {string|number} phone 
 * @returns {string}
 */
export function cleanPhone(phone) {
  if (!phone) return '';
  const str = String(phone).trim();
  const hasPlus = str.startsWith('+');
  const digitsOnly = str.replace(/\D/g, '');
  
  if (!digitsOnly) return '';
  return hasPlus ? `+${digitsOnly}` : digitsOnly;
}

/**
 * Genera una lista de variantes de búsqueda para un número telefónico.
 * Esto asegura que si en GHL está guardado con o sin '+', o con el '1' de WhatsApp en México (+52 1 ...),
 * la búsqueda lo encuentre sin fallar.
 * @param {string} phone
 * @returns {string[]}
 */
export function getPhoneSearchVariants(phone) {
  const cleaned = cleanPhone(phone);
  if (!cleaned) return [];

  const variants = new Set();
  
  // 1. Formato con '+'
  const withPlus = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  // 2. Formato solo dígitos sin '+'
  const withoutPlus = cleaned.replace(/^\+/, '');

  variants.add(withPlus);
  variants.add(withoutPlus);

  // Caso especial Colombia (+57): móviles de 10 dígitos (ej: 300 264 4114)
  if (withPlus.startsWith('+57') && withPlus.length === 13) {
    const colLocal = withPlus.slice(3); // 3002644114
    variants.add(colLocal);
  } else if (withoutPlus.length === 10 && withoutPlus.startsWith('3')) {
    variants.add(`+57${withoutPlus}`);
    variants.add(`57${withoutPlus}`);
  }

  // Caso especial México: WhatsApp agrega un '1' después de '+52' (+52 1 55... -> +52155...)
  // Mientras que muchos CRMs en GHL guardan directamente +5255... o el número local de 10 dígitos (ej: 5554589524)
  if (withPlus.startsWith('+521') && withPlus.length === 14) {
    const mxWithoutOne = `+52${withPlus.slice(4)}`;
    const mxNational = withPlus.slice(4); // 10 dígitos: 5554589524
    variants.add(mxWithoutOne);
    variants.add(mxWithoutOne.replace(/^\+/, ''));
    variants.add(mxNational);
  } else if (withPlus.startsWith('+52') && !withPlus.startsWith('+521') && withPlus.length === 13) {
    const mxWithOne = `+521${withPlus.slice(3)}`;
    const mxNational = withPlus.slice(3); // 10 dígitos: 5554589524
    variants.add(mxWithOne);
    variants.add(mxWithOne.replace(/^\+/, ''));
    variants.add(mxNational);
  } else if (withoutPlus.length === 10 && withoutPlus.startsWith('55')) {
    // Si viene solo 10 dígitos (CDMX / México)
    variants.add(`+52${withoutPlus}`);
    variants.add(`52${withoutPlus}`);
    variants.add(`+521${withoutPlus}`);
    variants.add(`521${withoutPlus}`);
  }

  return Array.from(variants);
}

