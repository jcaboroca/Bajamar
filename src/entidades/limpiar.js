// @ts-check
/**
 * Del concepto que escribe el banco al nombre de quien cobra.
 *
 * El banco antepone su propia etiqueta a algunos recibos ("ELECTRICIDAD NEXUS
 * ENERGIA SA", "AGUA AIGUES DE BARCELONA"). Esa etiqueta no es ruido: es una
 * clasificación gratuita y fiable, así que se conserva como pista en vez de
 * tirarla junto con el resto del prefijo.
 */

/**
 * @typedef {object} ConceptoLimpio
 * @property {string} nombre
 * @property {string | null} localidad
 * @property {string | null} pista  categoría que ya insinúa el banco
 */

/** @type {Array<{ patron: RegExp, pista: string | null }>} */
const PREFIJOS = [
  { patron: /^ANUL COMPRA TARJ\.\s*\S+\s*/i, pista: 'devolucion' },
  { patron: /^DEVOLUCION TAR\.\s*\S+\s*/i, pista: 'devolucion' },
  { patron: /^COMPRA TARJ\.\s*\S+\s*/i, pista: null },
  { patron: /^FRACCIONAMIENTO\s+(TRANSFERENCIA A\s+)?/i, pista: 'fraccionamiento' },
  { patron: /^ADEUDO RECIBO\s+/i, pista: null },
  { patron: /^ELECTRICIDAD\s+/i, pista: 'luz' },
  { patron: /^AGUA\s+/i, pista: 'agua' },
  { patron: /^GAS\s+/i, pista: 'gas' },
  { patron: /^TELEFONOS\s+/i, pista: 'telecom' },
  { patron: /^SEGUROS\s+/i, pista: 'seguros' },
  { patron: /^NOMINA\s+/i, pista: 'nomina' },
  { patron: /^ABONO BIZUM DE\s+/i, pista: 'bizum-recibido' },
  { patron: /^PAGO BIZUM\s+/i, pista: 'bizum-enviado' },
  { patron: /^COMPRA BIZUM\s+/i, pista: 'bizum-enviado' },
  { patron: /^ABONO TRANSFERENCIA DE\s+/i, pista: 'transferencia-recibida' },
  { patron: /^TRANSFERENCIA A\s+/i, pista: 'transferencia-enviada' },
]

/**
 * Localidades que en realidad son un teléfono o un identificador, no un sitio.
 */
const NO_ES_LOCALIDAD = /^[+\d][\d\s.-]*$/

/**
 * @param {string} raw
 * @returns {ConceptoLimpio}
 */
export function limpiarConcepto(raw) {
  let texto = String(raw).replace(/\s+/g, ' ').trim()
  /** @type {string | null} */
  let pista = null

  for (const { patron, pista: p } of PREFIJOS) {
    const antes = texto
    texto = texto.replace(patron, '')
    if (texto !== antes) {
      pista = p
      break
    }
  }

  texto = texto.replace(/^\d{2}\.\d{2}\s+/, '') // fecha incrustada tipo "24.06 "
  texto = texto.replace(/^SUMUP\s+/i, '') // el datáfono, delante del comercio de verdad

  /** @type {string | null} */
  let localidad = null
  const corte = texto.lastIndexOf('-')
  if (corte > 0 && corte < texto.length - 1) {
    const candidata = normalizar(texto.slice(corte + 1))
    // "TELEFONOS O2 FIBRA - TELEFONICA DE ESPANA SAU" no tiene localidad:
    // el guion separa dos partes del nombre, no el sitio. Y en "1930-00010408"
    // separa dos mitades de un número de cuenta, que no hay que tocar.
    const esNombreDeSitio = /[A-Z]/.test(candidata) && candidata.length <= 24
    if (esNombreDeSitio && !candidata.includes(' SAU') && !candidata.includes(' SL')) {
      localidad = NO_ES_LOCALIDAD.test(candidata) ? null : candidata
      texto = texto.slice(0, corte)
    }
  }

  return { nombre: sinReferencia(normalizar(texto)), localidad, pista }
}

/**
 * Quita el número de factura o de contrato que algunos emisores pegan al
 * nombre. Sin esto, "HOLALUZ 2025VTA1685725/1" y "HOLALUZ 2026VTA68084/1"
 * serían dos empresas distintas y ningún recibo se repetiría jamás.
 *
 * Sólo se aplica si queda nombre por delante: un concepto que es únicamente
 * un número de cuenta debe conservarse entero.
 * @param {string} nombre
 */
function sinReferencia(nombre) {
  const podado = nombre.replace(/\s+[A-Z]*\d{4,}[A-Z0-9/.-]*$/, '')
  return podado.length >= 3 ? podado : nombre
}

/**
 * Mayúsculas, sin acentos y con los espacios colapsados. Los extractos mezclan
 * "GAVÀ" y "GAVA" para el mismo sitio.
 * @param {string} s
 */
export function normalizar(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[,.]+$/, '')
    .trim()
    .toUpperCase()
}
