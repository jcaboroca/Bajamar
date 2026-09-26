// @ts-check
/**
 * Reglas de partida para agrupar comercios y clasificar por categoría.
 *
 * Son una semilla, no una verdad: el usuario puede corregir cualquiera y su
 * corrección gana siempre. Los patrones se prueban en orden.
 */

/**
 * @typedef {object} Semilla
 * @property {string} nombre
 * @property {RegExp} patron
 * @property {import('../dominio/tipos.js').TipoEntidad} tipo
 * @property {string} categoria
 */

/** @type {Semilla[]} */
export const SEMILLAS = [
  // Vivienda y suministros
  { nombre: 'Nexus Energía', patron: /NEXUS ENERGIA/, tipo: 'comercio', categoria: 'luz' },
  { nombre: 'Aigües de Barcelona', patron: /AIGUES DE BARCELONA/, tipo: 'comercio', categoria: 'agua' },
  { nombre: 'O2 Fibra', patron: /\bO2 FIBRA|TELEFONICA DE ESPANA/, tipo: 'comercio', categoria: 'telecom' },
  { nombre: 'Holaluz', patron: /HOLALUZ/, tipo: 'comercio', categoria: 'luz' },
  { nombre: 'Endesa', patron: /\bENDESA\b/, tipo: 'comercio', categoria: 'luz' },
  { nombre: 'Naturgy', patron: /NATURGY|GAS NATURAL/, tipo: 'comercio', categoria: 'gas' },
  { nombre: 'Àrea Metropolitana', patron: /AREA METROPOLITANA/, tipo: 'organismo', categoria: 'agua' },
  { nombre: 'Jardí Gavà', patron: /JARDI GAVA/, tipo: 'comercio', categoria: 'hogar' },

  // Impuestos
  { nombre: 'Ajuntament de Gavà', patron: /IMPUESTOS AJ\. GAVA|ORGT/, tipo: 'organismo', categoria: 'impuestos' },
  { nombre: 'Agencia Tributaria', patron: /\bAEAT\b|AGENCIA TRIBUTARIA/, tipo: 'organismo', categoria: 'impuestos' },
  { nombre: 'Generalitat', patron: /^GENCAT\b/, tipo: 'organismo', categoria: 'impuestos' },

  // Seguros
  { nombre: 'MAPFRE', patron: /^MAPFRE\b/, tipo: 'comercio', categoria: 'seguros' },
  { nombre: 'Allianz Direct', patron: /ALLIANZ DIRECT/, tipo: 'comercio', categoria: 'seguros' },
  { nombre: 'Allianz Seguros', patron: /ALLIANZ SEGUROS|ALLIANZ$/, tipo: 'comercio', categoria: 'seguros' },
  { nombre: 'Adeslas', patron: /^ADESLAS\b/, tipo: 'comercio', categoria: 'seguros' },

  // Financiación y ahorro
  { nombre: 'MyInvestor', patron: /MYINVESTOR|MY INVESTOR/, tipo: 'comercio', categoria: 'traspaso' },
  { nombre: 'Financiación CaixaBank', patron: /FINANCIERA CAIXABANK/, tipo: 'comercio', categoria: 'financiacion' },
  { nombre: 'Financiación BBVA', patron: /FINANCIERA BANCO BILBAO/, tipo: 'comercio', categoria: 'financiacion' },
  { nombre: 'Liquidación de la VISA', patron: /TARJETA\s+(DE\s+)?CREDITO/, tipo: 'comercio', categoria: 'tarjeta' },

  // Suscripciones
  { nombre: 'Netflix', patron: /NETFLIX/, tipo: 'comercio', categoria: 'suscripciones' },
  { nombre: 'Apple', patron: /APPLE\.COM|\bITUNES\b/, tipo: 'comercio', categoria: 'suscripciones' },
  { nombre: 'Spotify', patron: /SPOTIFY/, tipo: 'comercio', categoria: 'suscripciones' },
  { nombre: 'Google', patron: /^GOOGLE\b/, tipo: 'comercio', categoria: 'suscripciones' },

  // Compras y plataformas
  { nombre: 'Amazon', patron: /AMAZON|\bAMZN\b/, tipo: 'comercio', categoria: 'compras' },
  { nombre: 'PayPal', patron: /\bPAYPAL\b/, tipo: 'comercio', categoria: 'compras' },
  { nombre: 'Decathlon', patron: /^DECATHLON\b/, tipo: 'comercio', categoria: 'compras' },

  // Supermercado
  { nombre: 'Condis', patron: /^CONDIS\b/, tipo: 'comercio', categoria: 'super' },
  { nombre: 'Caprabo', patron: /^CAPRABO\b/, tipo: 'comercio', categoria: 'super' },
  { nombre: 'Carrefour', patron: /^CARREF/, tipo: 'comercio', categoria: 'super' },
  { nombre: 'Mercadona', patron: /^MERCADONA\b/, tipo: 'comercio', categoria: 'super' },
  { nombre: 'Lidl', patron: /^LIDL\b/, tipo: 'comercio', categoria: 'super' },

  // Combustible
  { nombre: 'Estaciones de servicio', patron: /^E\.?S\.?\s|^ES \b|\bSHELL\b|MEROIL|REPSOL|CEPSA|GALP/, tipo: 'comercio', categoria: 'combustible' },
  { nombre: 'Vilacarburants', patron: /VILACARBURANT/, tipo: 'comercio', categoria: 'calefaccion' },

  // Riggs
  { nombre: 'Doggy Dog', patron: /^DOGGY DOG\b/, tipo: 'comercio', categoria: 'riggs' },
  { nombre: 'Veterinaria Montau', patron: /VETERINARIA MONTAU|C\. VETERINARIA/, tipo: 'comercio', categoria: 'riggs' },
  { nombre: 'Tiendanimal', patron: /TIENDANIMAL|KIWOKO/, tipo: 'comercio', categoria: 'riggs' },

  // Vehículos
  { nombre: 'ITV', patron: /\bITV\b/, tipo: 'comercio', categoria: 'vehiculos' },
  { nombre: 'Carhaus', patron: /CARHAUS/, tipo: 'comercio', categoria: 'vehiculos' },
  { nombre: 'Sweet Ride', patron: /SWEET RIDE/, tipo: 'comercio', categoria: 'vehiculos' },

  // Ocio y deporte
  { nombre: 'Pàdel X-Trem', patron: /PADEL X.?TREM|RESTAURANT PADEL/, tipo: 'comercio', categoria: 'ocio' },
  { nombre: 'Club de Begues', patron: /CLUB DE BEGUES/, tipo: 'comercio', categoria: 'ocio' },
  { nombre: 'Esquí', patron: /ESTACIO ESQUI|BAQUEIRA|FORFAIT/, tipo: 'comercio', categoria: 'ocio' },
  { nombre: 'Entradas y espectáculos', patron: /WEEZEVENT|COMPRA ENTRADAS|TICKETMASTER|^TICKETS?\b/, tipo: 'comercio', categoria: 'ocio' },
  { nombre: 'Barbería Ferran Davila', patron: /BARBERIA FERRAN/, tipo: 'comercio', categoria: 'cuidado' },

  // Viajes
  { nombre: 'AirAsia', patron: /AIR ?ASIA/, tipo: 'comercio', categoria: 'viajes' },
  { nombre: 'Camping Xixerella', patron: /CAMPING XIXERELLA/, tipo: 'comercio', categoria: 'viajes' },
  { nombre: 'Renfe', patron: /\bRENFE\b/, tipo: 'comercio', categoria: 'viajes' },
  { nombre: 'Vueling', patron: /VUELING/, tipo: 'comercio', categoria: 'viajes' },

  // Efectivo
  { nombre: 'Cajero', patron: /REINTEGRO CAJERO|DISPOSICION EFECTIVO/, tipo: 'comercio', categoria: 'efectivo' },

  // Nómina
  { nombre: 'ERNI Consulting', patron: /ERNI CONSULTING/, tipo: 'comercio', categoria: 'nomina' },

  // Ruido del propio banco
  { nombre: 'Comisiones del banco', patron: /COMISION|INTERESES Y\/O/, tipo: 'comercio', categoria: 'banco' },
]

/**
 * Categorías conocidas, con su nombre visible.
 * @type {Record<string, string>}
 */
export const CATEGORIAS = {
  luz: 'Luz',
  agua: 'Agua',
  gas: 'Gas',
  telecom: 'Internet y móvil',
  impuestos: 'Impuestos',
  seguros: 'Seguros',
  financiacion: 'Financiación',
  tarjeta: 'Tarjeta de crédito',
  suscripciones: 'Suscripciones',
  ocio: 'Ocio y deporte',
  viajes: 'Viajes',
  hogar: 'Hogar y jardín',
  cuidado: 'Cuidado personal',
  efectivo: 'Efectivo',
  traspaso: 'Traspasos y ahorro',
  compras: 'Compras',
  super: 'Supermercado',
  restaurantes: 'Restaurantes',
  combustible: 'Combustible',
  calefaccion: 'Calefacción',
  riggs: 'Riggs',
  vehiculos: 'Furgoneta y moto',
  nomina: 'Nómina',
  banco: 'Banco',
  personas: 'Personas',
  otros: 'Sin clasificar',
}
