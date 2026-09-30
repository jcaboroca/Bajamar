// @ts-check
/**
 * Tipos del dominio y utilidades de fecha.
 *
 * Las fechas viajan como cadenas ISO "yyyy-mm-dd". Son ordenables como texto,
 * no tienen zona horaria y no sufren el desfase de `new Date('2026-09-28')`
 * interpretado en UTC y mostrado en local.
 */

/**
 * @typedef {'cuenta' | 'tarjeta'} Origen
 * @typedef {'comercio' | 'persona' | 'organismo'} TipoEntidad
 */

/**
 * @typedef {object} Movimiento
 * @property {string} id
 * @property {string} fecha            ISO yyyy-mm-dd
 * @property {string} fechaValor
 * @property {string} conceptoRaw
 * @property {string | null} entidadId
 * @property {number} importe          céntimos; negativo = gasto
 * @property {number | null} saldo     la tarjeta no lo trae
 * @property {Origen} origen
 * @property {string | null} localidad
 * @property {boolean} fraccionado     cuota de un pago aplazado, no gasto nuevo
 * @property {string} [foto]           tarjeta: de qué extracto sale; sólo vale el último
 * @property {boolean} excepcional     marcado a mano: no cuenta para medianas
 * @property {string} [categoria]      resuelta al construir el estado
 * @property {boolean} [excluido]      fuera de todos los cálculos, por decisión del usuario
 * @property {string} [nota]
 */

/**
 * Lo que el usuario corrige sobre un apunte concreto.
 *
 * Vive aparte de los movimientos a propósito: reimportar el extracto vuelve a
 * escribir el movimiento entero, y las correcciones tienen que sobrevivir a
 * eso. Un retoque sin ningún campo puesto equivale a no tenerlo.
 *
 * @typedef {object} Retoque
 * @property {string} id               el del movimiento
 * @property {string} [categoria]
 * @property {boolean} [excluido]      no cuenta para nada
 * @property {boolean} [traspaso]      dinero movido entre cuentas propias
 * @property {string} [nota]
 */

/**
 * @typedef {object} Entidad
 * @property {string} id
 * @property {string} nombre
 * @property {string[]} alias
 * @property {TipoEntidad} tipo
 */

/**
 * @typedef {object} Compromiso
 * @property {string} entidadId
 * @property {string} reciboId        distingue dos recibos del mismo cobrador
 * @property {string} nombre
 * @property {'mensual' | 'bimestral' | 'trimestral' | 'semestral' | 'anual'} periodicidad
 * @property {number} importeEsperado  mediana de la serie, en céntimos
 * @property {string} ultimaVista      ISO
 * @property {string} proximaPrevista  ISO
 * @property {number} observaciones
 * @property {string[]} cobros         los movimientos de los que sale la serie
 * @property {'activo' | 'retrasado' | 'extinto'} estado
 * @property {string} [devuelto]      quién te lo devuelve: sale de tu cuenta, pero no es tu gasto
 */

/**
 * @typedef {object} Manual
 * @property {string} id
 * @property {string} nombre
 * @property {number} importe          céntimos, negativo
 * @property {string} categoria
 * @property {'mensual' | 'bimestral' | 'trimestral' | 'semestral' | 'anual'} cada
 * @property {string} proxima         ISO, el próximo cobro
 */

/**
 * @typedef {object} Bulto
 * @property {string} id
 * @property {string} nombre
 * @property {number} importe          céntimos, negativo
 * @property {string} fecha            ISO
 * @property {string} [nota]
 */

const DIAS_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/**
 * @param {number} anio
 * @param {number} mes 1-12
 */
function diasDelMes(anio, mes) {
  if (mes === 2 && (anio % 4 === 0 && (anio % 100 !== 0 || anio % 400 === 0))) return 29
  return DIAS_MES[mes - 1]
}

/**
 * Convierte "dd/mm/yyyy" a ISO. Rechaza fechas que no existen.
 * @param {string} texto
 * @returns {string}
 */
export function fechaDesdeEs(texto) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(texto).trim())
  if (!m) throw new RangeError(`fecha no reconocida: ${JSON.stringify(texto)}`)
  const dia = Number(m[1])
  const mes = Number(m[2])
  const anio = Number(m[3])
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasDelMes(anio, mes)) {
    throw new RangeError(`fecha inexistente: ${JSON.stringify(texto)}`)
  }
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/**
 * La tarjeta escribe "22/09" sin año. El año se deduce del mes del extracto:
 * si el mes del movimiento es posterior al del extracto, es del año anterior.
 * @param {string} texto  "dd/mm"
 * @param {number} anioExtracto
 * @param {number} mesExtracto 1-12
 * @returns {string}
 */
export function fechaDesdeEsSinAnio(texto, anioExtracto, mesExtracto) {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(String(texto).trim())
  if (!m) throw new RangeError(`fecha sin año no reconocida: ${JSON.stringify(texto)}`)
  const mes = Number(m[2])
  const anio = mes > mesExtracto ? anioExtracto - 1 : anioExtracto
  return fechaDesdeEs(`${m[1]}/${m[2]}/${anio}`)
}

/**
 * @param {string} iso
 * @param {number} meses
 * @returns {string}
 */
export function sumarMeses(iso, meses) {
  const [a, m, d] = iso.split('-').map(Number)
  const total = (a * 12 + (m - 1)) + meses
  const anio = Math.floor(total / 12)
  const mes = (total % 12) + 1
  return `${anio}-${String(mes).padStart(2, '0')}-${String(Math.min(d, diasDelMes(anio, mes))).padStart(2, '0')}`
}

/**
 * @param {string} a ISO
 * @param {string} b ISO
 * @returns {number} días de a a b
 */
export function diasEntre(a, b) {
  const ms = Date.UTC(...isoATupla(b)) - Date.UTC(...isoATupla(a))
  return Math.round(ms / 86_400_000)
}

/**
 * @param {string} iso
 * @returns {[number, number, number]}
 */
function isoATupla(iso) {
  const [a, m, d] = iso.split('-').map(Number)
  return [a, m - 1, d]
}

/** @param {string} iso */
export function mesDe(iso) {
  return iso.slice(0, 7)
}

/** @param {Date} [reloj] */
export function hoyIso(reloj) {
  const d = reloj ?? new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** @param {string} iso */
export function ultimoDiaDelMes(iso) {
  const [a, m] = iso.split('-').map(Number)
  return `${a}-${String(m).padStart(2, '0')}-${diasDelMes(a, m)}`
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/**
 * "2026-10-05" → "5 de octubre"
 * @param {string} iso
 */
export function fechaLarga(iso) {
  const [, m, d] = iso.split('-').map(Number)
  return `${d} de ${MESES[m - 1]}`
}

/** @param {Movimiento} m */
export function esGasto(m) {
  return m.importe < 0
}
