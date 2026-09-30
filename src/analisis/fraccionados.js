// @ts-check
/**
 * Lo que aplazas no desaparece: vuelve en tres cuotas.
 *
 * El banco lo cuenta en dos sitios y ninguno de los dos lo dice entero. En la
 * cuenta aparece un abono «FRACCIONAMIENTO …» por el importe completo, que te
 * devuelve lo que ya te había cobrado. En el extracto de la tarjeta aparece la
 * cuota de este mes. Las dos cuotas que faltan no están escritas en ninguna
 * parte, y son exactamente las que hunden los dos meses siguientes.
 *
 * Aplazar se siente como que el gasto se ha ido. Aquí se ve que sigue ahí.
 */

import { sumarMeses, ultimoDiaDelMes } from '../dominio/tipos.js'

/** El banco fracciona a tres meses. */
export const PLAZOS = 3

const ES_FRACCIONAMIENTO = /^FRACCIONAMIENTO\b/i

/**
 * @typedef {object} Cuota
 * @property {string} fecha
 * @property {number} importe  negativo: sale de la cuenta
 * @property {string} nombre
 * @property {number} plazo    1, 2 o 3
 * @property {number} total    lo que aplazaste entero
 * @property {boolean} estimada  true si se dividió entre tres a falta de dato
 */

/**
 * Las cuotas que todavía no te han cobrado.
 *
 * @param {import('../dominio/tipos.js').Movimiento[]} movimientos
 * @param {string} desde  hasta aquí ya está cobrado; sólo cuenta lo de después
 * @returns {Cuota[]}
 */
export function cuotasPendientes(movimientos, desde) {
  // La foto de la tarjeta manda: cada fila fraccionada es una cuota que se
  // repite tres meses. Muchas no dejan rastro en la cuenta —se fraccionan
  // dentro de la propia tarjeta—, así que el abono no puede ser la única pista.
  const filas = movimientos.filter((m) => m.origen === 'tarjeta' && m.fraccionado === true && m.importe < 0)
  const diaDeLaFoto = filas.reduce((d, m) => (m.foto && m.foto.slice(0, 10) > d ? m.foto.slice(0, 10) : d), '')
  const reales = filas.map((m) => ({
    clave: clave(m.conceptoRaw ?? ''), importe: Math.abs(m.importe), libre: true, m,
    nombre: nombreDelPlazo(m.conceptoRaw ?? ''), total: Math.abs(m.importe) * PLAZOS,
  }))
  /** @type {Cuota[]} */
  const cuotas = []
  /** @param {string} comprado @param {number} cuota @param {Omit<Cuota, 'fecha' | 'importe' | 'plazo'>} resto @param {number} [ultima] */
  const repartir = (comprado, cuota, resto, ultima = cuota) => {
    for (let plazo = 1; plazo <= PLAZOS; plazo += 1) {
      // A fin de mes, empezando por la liquidación del mes siguiente: el 30 de
      // septiembre no entró lo fraccionado el 22, y sí la última cuota de junio.
      const fecha = ultimoDiaDelMes(sumarMeses(`${comprado.slice(0, 8)}01`, plazo))
      if (fecha <= desde) continue
      cuotas.push({ ...resto, fecha, importe: -(plazo < PLAZOS ? cuota : ultima), plazo })
    }
  }

  for (const m of movimientos) {
    if (m.origen !== 'cuenta' || m.importe <= 0) continue
    if (!ES_FRACCIONAMIENTO.test(m.conceptoRaw ?? '')) continue
    const nombre = nombreDelPlazo(m.conceptoRaw ?? '')
    // Se busca con el concepto entero, no con el nombre ya recortado: el
    // extracto de la tarjeta tampoco recorta, y si no, «TRANSFERENCIA A
    // MyInvestor» y «MyInvestor» no se reconocerían.
    const real = cuotaDelExtracto(reales, (m.conceptoRaw ?? '').replace(ES_FRACCIONAMIENTO, ''), m.importe)
    if (real !== null) {
      real.nombre = nombre
      real.total = m.importe
      continue
    }
    // Si la foto es posterior y no lo trae, es que ya está pagado entero.
    if (diaDeLaFoto && m.fecha <= diaDeLaFoto) continue
    // Sin foto que lo diga, se divide entre tres. El redondeo se lo come la última.
    const cuota = Math.round(m.importe / PLAZOS)
    repartir(m.fecha, cuota, { nombre, total: m.importe, estimada: true }, m.importe - cuota * (PLAZOS - 1))
  }

  for (const r of reales) {
    repartir(r.m.fecha, r.importe, { nombre: r.nombre, total: r.total, estimada: false })
  }
  return cuotas.sort((a, b) => a.fecha.localeCompare(b.fecha))
}

/**
 * El extracto de la tarjeta trae la cuota de verdad, con sus intereses dentro.
 * Dividir entre tres se queda corto, y esa diferencia se acumula justo los meses
 * que ya venían apretados.
 *
 * Se empareja por nombre y por cercanía al tercio, porque tres recibos del mismo
 * ayuntamiento el mismo día comparten concepto y sólo los distingue el importe.
 *
 * @template {{ clave: string, importe: number, libre: boolean }} T
 * @param {T[]} reales
 * @param {string} nombre
 * @param {number} total
 * @returns {T | null}
 */
function cuotaDelExtracto(reales, nombre, total) {
  const buscada = clave(nombre)
  const tercio = total / PLAZOS
  let mejor = null
  for (const r of reales) {
    if (!r.libre || !casan(r.clave, buscada)) continue
    // Un interés que doblara la cuota no sería un fraccionamiento, sería otra cosa.
    if (Math.abs(r.importe - tercio) > tercio * 0.5) continue
    if (mejor === null || Math.abs(r.importe - tercio) < Math.abs(mejor.importe - tercio)) mejor = r
  }
  if (mejor === null) return null
  mejor.libre = false
  return mejor
}

/** El extracto recorta el concepto a la anchura de la columna. */
function casan(/** @type {string} */ a, /** @type {string} */ b) {
  const corto = Math.min(a.length, b.length)
  if (corto < 8) return a === b
  return a.slice(0, corto) === b.slice(0, corto)
}

/** @param {string} texto */
function clave(texto) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^\s*(COMPRA\s+TARJ\.?|PAGO\s+DE)\s*/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
}

/** @param {string} concepto */
function nombreDelPlazo(concepto) {
  const limpio = concepto
    .replace(ES_FRACCIONAMIENTO, '')
    .replace(/^\s*(COMPRA\s+TARJ\.?|PAGO\s+DE|TRANSFERENCIA\s+A)\s*/i, '')
    .trim()
  return limpio === '' ? 'Pago aplazado' : limpio
}
