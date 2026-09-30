// @ts-check
/**
 * Todo el dinero de la aplicación vive como enteros de céntimos.
 *
 * Un float de 64 bits no representa 0,1 exactamente, así que sumar cien
 * movimientos de 2.839,15 € acaba desviándose. Con céntimos enteros la
 * reconciliación de la VISA cuadra al céntimo y las comparaciones son exactas.
 */

// `useGrouping: 'always'` va contra el criterio de Intl para es-ES, que omite
// el punto en números de cuatro cifras. Aquí las cifras van en columna y la
// consistencia pesa más que la norma tipográfica.
const FORMATO = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  useGrouping: 'always',
})

const FORMATO_SECO = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: 'always',
})

const FORMATO_ENTERO = new Intl.NumberFormat('es-ES', {
  useGrouping: 'always',
  maximumFractionDigits: 0,
})

/**
 * Convierte un número decimal —tal y como lo entrega el .xls— a céntimos.
 * El redondeo no es cosmético: 2839.15 * 100 da 283914.99999999994.
 * @param {number} n
 * @returns {number}
 */
export function desdeFloat(n) {
  if (!Number.isFinite(n)) throw new RangeError(`importe no finito: ${n}`)
  return Math.round(n * 100)
}

/**
 * Lee un importe escrito en locale español: "1.234,56", "-1.234,56 EUR".
 * @param {string} texto
 * @returns {number}
 */
export function parseImporte(texto) {
  const limpio = String(texto)
    .trim()
    .replace(/\s*(EUR|€)\s*$/i, '')
    .replace(/\s+/g, '')
  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+([.,]\d+)?$/.test(limpio)) {
    throw new RangeError(`importe no reconocido: ${JSON.stringify(texto)}`)
  }
  const normalizado = limpio.includes(',')
    ? limpio.replace(/\./g, '').replace(',', '.')
    : limpio
  return desdeFloat(Number(normalizado))
}

/**
 * @param {number} centimos
 * @param {{ signo?: boolean, simbolo?: boolean }} [opciones]
 * @returns {string}
 */
export function formatEuros(centimos, opciones) {
  const formateador = opciones?.simbolo === false ? FORMATO_SECO : FORMATO
  // `|| 0` porque Intl escribe el cero negativo con signo: «-0,00 €».
  const texto = formateador.format(centimos / 100 || 0).replace(/\u00a0/g, ' ')
  return opciones?.signo && centimos > 0 ? `+${texto}` : texto
}

/**
 * Redondea a euros enteros para los titulares, donde los céntimos son ruido.
 * @param {number} centimos
 */
export function formatEurosRedondo(centimos) {
  return `${FORMATO_ENTERO.format(Math.round(centimos / 100) || 0).replace(/\u00a0/g, ' ')} €`
}

/**
 * @param {number[]} valores
 * @returns {number}
 */
export function sumar(...valores) {
  return valores.reduce((total, v) => total + v, 0)
}

/**
 * Mediana de una serie de céntimos. Se usa en vez de la media porque un solo
 * recibo excepcional desplaza la media y deja de predecir lo que viene.
 * @param {number[]} valores
 * @returns {number}
 */
export function mediana(valores) {
  if (valores.length === 0) return 0
  const orden = [...valores].sort((a, b) => a - b)
  const medio = Math.floor(orden.length / 2)
  return orden.length % 2 === 1
    ? orden[medio]
    : Math.round((orden[medio - 1] + orden[medio]) / 2)
}
