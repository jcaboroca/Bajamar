// @ts-check
/**
 * A qué se dedica alguien, deducido de cómo se llama.
 *
 * Distinto de las semillas: una semilla dice «esto es Mercadona» y junta todos
 * sus cobros bajo un mismo nombre. Esto no junta nada — cada bar sigue siendo
 * su bar — sólo contesta a «¿en qué va?» cuando nadie más lo ha contestado.
 * Por eso puede permitirse palabras genéricas: equivocarse aquí cuesta un
 * desplegable, y el usuario siempre gana.
 *
 * El orden importa y no es casual: un bar en un área de servicio de la autopista
 * pone «AUCAT BAR VALLCARCA», y eso es cenar, no peaje.
 */

/** @type {Array<{ patron: RegExp, categoria: string }>} */
export const OFICIOS = [
  // Comer fuera. Va primero porque medio mundo tiene un bar dentro.
  {
    patron: /\bBARS?\b|\bTAVERNA|CERVE[CS]ERIA|RESTAURANT|RISTORANTE|ROSTISSERIA|PIZZ|\bCAFE\b|CAFETERIA|\bTAPEO\b|BRASERIA|HAMBURGUES|\bSUSHI\b|KEBAB|CHIRINGUITO|\bMESON\b|\bBRASSERIE|UBER ?EATS|\bREST\b|\bBISTRO|\bTABERNA/,
    categoria: 'restaurantes',
  },

  // Dormir y moverse lejos
  {
    patron: /\bHOTEL|\bHOSTAL\b|\bHOSTEL\b|ALBERG|CAMPING|CAMPEGGIO|BOOKING\.COM|\bRIFUGIO|\bREFUGI\b|AIRBNB|\bMOTEL\b|RYANAIR|EASYJET|\bIBERIA\b|AEROPUERT|\bAIRPORT\b|^GRAB A-|\bFERRY\b/,
    categoria: 'viajes',
  },

  // Repostar
  {
    patron: /BENZINERA|GASOLINER|CARBURANT|ESTACION DE SERVICIO|AREA DE SERVEI|\bCEDIPSA\b|DISTRIBUTORE|\bPETROL\b|\bPLENOIL\b|\bGASOIL\b|\bAVIA\b/,
    categoria: 'combustible',
  },

  // Pagar por circular o por dejar el coche parado
  {
    patron: /\bPEAJE|\bPEAGE|PEDAGG|AUTOPIST|AUTOROUTE|\bASF\b|\bESCOTA\b|\bATMB\b|\bAUCAT\b|\bPARKING|\bPARKIN\b|PARKAUTOMAT|PARCHEGG|APARCAMENT|APARCAMIENTO|TELPARK|\bEYSA\b/,
    categoria: 'peajes',
  },

  // La compra
  {
    patron: /SUPERMERCAT|SUPERMERCADO|ALIMENTACIO|ALIMENTARIA|FRUITERIA|CARNISSERIA|CARNICERIA|PEIXATERIA|PESCADERIA|PANADERIA|\bFORN DE\b|\bALDI\b|\bBONAREA\b/,
    categoria: 'super',
  },

  // Cuerpo
  {
    patron: /FARMACIA|PARAFARMA|PERFUMERIA|\bDRUNI\b|PELUQUERIA|PERRUQUERIA|BARBERIA|\bOPTICA\b|CLINICA DENTAL|DENTISTA|FISIOTERAPIA/,
    categoria: 'cuidado',
  },

  // Riggs
  {
    patron: /VETERINARI|\bVET\b|\bPETS?\b|MASCOTA|TIENDANIMAL|KIWOK|KIWOCO|PERRUQUERIA CANINA/,
    categoria: 'riggs',
  },

  // La casa
  {
    patron: /LEROY MERLIN|BAUHAUS|FERRETERIA|\bBRICO|\bIKEA\b|OBRAMAT|\bAKI\b|FONTANER|ELECTRICITAT|\bPERSIANA/,
    categoria: 'hogar',
  },

  // Divertirse
  {
    patron: /\bCINES?A?\b|\bYELMO\b|TEATRE|TEATRO|\bMUSEU\b|\bMUSEO\b|PLAYTOMIC|\bPADEL\b|GIMNAS|\bGYM\b|FORFAIT|CABINOVIA|KABINENBAHN|TELECABINA|\bREMONTE|ESTACIO ESQUI/,
    categoria: 'ocio',
  },

  // Cables
  {
    patron: /STARLINK|VODAFONE|MOVISTAR|\bORANGE\b|\bYOIGO\b|MASMOVIL|PEPEPHONE|JAZZTEL|\bDIGI\b/,
    categoria: 'telecom',
  },

  // Enchufes
  {
    patron: /OCTOPUS ENERGY|IBERDROLA|TOTALENERGIES|SOM ENERGIA|\bLUCERA\b|\bREPSOL LUZ/,
    categoria: 'luz',
  },

  // Lo que se paga todos los meses sin tocarlo
  {
    patron: /OPENAI|CHATGPT|CHORDIFY|\bHBO\b|DISNEY|DROPBOX|\bADOBE\b|MICROSOFT ?365|YOUTUBE ?PREMIUM|PATREON|\bICLOUD\b|\bSUBSCR/,
    categoria: 'suscripciones',
  },

  // Cosas
  {
    patron: /ALIEXPRESS|WALLAPOP|\bSHEIN\b|\bTEMU\b|\bEBAY\b|ZALANDO|COOLMOD|PCCOMPONENTES|MEDIAMARKT|\bFNAC\b|ECOMMERCE/,
    categoria: 'compras',
  },

  // Administración
  {
    patron: /ORGANISME TRIBUTARI|AYUNTAMIENTO|AJUNTAMENT|DIPUTACI|\bIMPUESTOS?\b|\bTASA\b|\bIBI\b|SUMA GESTION|TRAFICO|\bDGT\b/,
    categoria: 'impuestos',
  },

  {
    patron: /\bSEGURO|ASSEGURANCES|\bMUTUA\b|SANITAS\b|\bDKV\b|\bAXA\b|\bZURICH\b/,
    categoria: 'seguros',
  },

  // Ruedas
  {
    patron: /ACCESORIOS Y REPUESTOS|RECAMBIOS|NEUMATIC|\bTALLER\b|\bITV\b|CONCESIONARIO|\bMOTOS?\b/,
    categoria: 'vehiculos',
  },

  // Dinero que sigue siendo tuyo
  { patron: /^TRASPASO\b|\bREVOLUT\b|\bN26\b|\bWISE\b/, categoria: 'traspaso' },

  // La pista más floja de todas, y por eso la última: quien se anuncia con un
  // dominio suele estar vendiéndote algo.
  { patron: /\bWWW\.|\.COM\b/, categoria: 'compras' },
]

/**
 * Lo que insinúa la etiqueta que pone el banco. Un Bizum lleva el nombre de una
 * persona detrás, y eso ya es una categoría.
 * @type {Record<string, string>}
 */
export const PISTAS = {
  'bizum-enviado': 'personas',
  'bizum-recibido': 'personas',
  'transferencia-enviada': 'personas',
}

/**
 * @param {string} nombre  ya normalizado: mayúsculas y sin acentos
 * @returns {string | null}
 */
export function oficioDe(nombre) {
  for (const { patron, categoria } of OFICIOS) {
    if (patron.test(nombre)) return categoria
  }
  return null
}
