// @ts-check
/**
 * Parsers de las dos plantillas que exporta Banc Sabadell.
 *
 * Son plantillas distintas y con trampas distintas, así que van separadas:
 * la cuenta trae importes como número y saldo corrido; la tarjeta los trae
 * como texto, sin signo y con la fecha sin año.
 */

import { desdeFloat, parseImporte } from '../dominio/dinero.js'
import { fechaDesdeEs, fechaDesdeEsSinAnio } from '../dominio/tipos.js'
import { leerLibro, numero, texto } from './xls.js'

/**
 * @typedef {import('../dominio/tipos.js').Movimiento} Movimiento
 * @typedef {import('./biff.js').Celda} Celda
 */

/**
 * @typedef {object} Resultado
 * @property {Movimiento[]} movimientos
 * @property {string[]} avisos
 * @property {Record<string, string | number | boolean>} meta
 */

/**
 * Decide qué plantilla es y la parsea.
 * @param {ArrayBuffer} datos
 * @param {{ nombre?: string, ahora?: Date }} [origen]  el nombre del fichero dice de qué día es la foto
 * @returns {Resultado}
 */
export function importarXls(datos, origen = {}) {
  const rejilla = leerLibro(datos)
  const primera = texto(rejilla, 0, 0).toLowerCase()
  if (primera.startsWith('consulta de movimientos')) return importarCuenta(rejilla)
  if (primera.startsWith('saldos y movimientos')) return importarTarjeta(rejilla, fotoDe(origen))
  throw new Error(
    `No reconozco esta plantilla. La primera celda dice ${JSON.stringify(texto(rejilla, 0, 0))}. ` +
      'Se esperaba "Consulta de movimientos" (cuenta) o "Saldos y movimientos" (tarjeta).',
  )
}

/**
 * @param {Celda[][]} rejilla
 * @param {(fila: Celda[], indice: number) => boolean} predicado
 */
function buscarFila(rejilla, predicado) {
  for (let i = 0; i < rejilla.length; i += 1) {
    if (predicado(rejilla[i] ?? [], i)) return i
  }
  return -1
}

/**
 * Extracto de cuenta. Viene del movimiento más reciente al más antiguo.
 * @param {Celda[][]} rejilla
 * @returns {Resultado}
 */
export function importarCuenta(rejilla) {
  const cabecera = buscarFila(rejilla, (_, i) => texto(rejilla, i, 0) === 'F. Operativa')
  if (cabecera === -1) {
    return { movimientos: [], avisos: ['No encontré la cabecera "F. Operativa".'], meta: {} }
  }

  /** @type {Movimiento[]} */
  const movimientos = []
  /** @type {string[]} */
  const avisos = []
  /** @type {Map<string, number>} */
  const vistos = new Map()

  for (let f = cabecera + 1; f < rejilla.length; f += 1) {
    const fOperativa = texto(rejilla, f, 0)
    if (!fOperativa) continue
    const concepto = texto(rejilla, f, 1)
    try {
      const importeCrudo = numero(rejilla, f, 3)
      const saldoCrudo = numero(rejilla, f, 4)
      if (importeCrudo === null || saldoCrudo === null) {
        throw new RangeError('importe o saldo no numéricos')
      }
      const fecha = fechaDesdeEs(fOperativa)
      const saldo = desdeFloat(saldoCrudo)
      const clave = `cuenta:${fecha}:${saldo}`
      const ordinal = vistos.get(clave) ?? 0
      vistos.set(clave, ordinal + 1)
      movimientos.push({
        id: `${clave}:${ordinal}`,
        fecha,
        fechaValor: texto(rejilla, f, 2) ? fechaDesdeEs(texto(rejilla, f, 2)) : fecha,
        conceptoRaw: concepto,
        entidadId: null,
        importe: desdeFloat(importeCrudo),
        saldo,
        origen: 'cuenta',
        localidad: null,
        fraccionado: /^FRACCIONAMIENTO\b/i.test(concepto),
        excepcional: false,
      })
    } catch (error) {
      avisos.push(`Fila ${f + 1} ignorada («${concepto || fOperativa}»): ${/** @type {Error} */ (error).message}`)
    }
  }

  const seleccion = texto(rejilla, buscarFila(rejilla, (_, i) => texto(rejilla, i, 0) === 'Selección:'), 1)
  return {
    movimientos,
    avisos,
    meta: {
      tipo: 'cuenta',
      iban: texto(rejilla, buscarFila(rejilla, (_, i) => texto(rejilla, i, 0) === 'Cuenta:'), 1),
      seleccion,
    },
  }
}

/**
 * El banco nombra los ficheros por el día de descarga: 30092026_…, 30092026 4106…
 * La hora de importar desempata dos fotos del mismo día.
 * @param {{ nombre?: string, ahora?: Date }} origen
 */
function fotoDe({ nombre = '', ahora = new Date() }) {
  const d = /^(\d{2})(\d{2})(20\d{2})/.exec(nombre)
  const dia = d ? `${d[3]}-${d[2]}-${d[1]}` : ahora.toISOString().slice(0, 10)
  return `${dia} ${ahora.toISOString()}`
}

/** Huella corta y estable del contenido: la misma foto, importada dos veces, es la misma. */
function huella(/** @type {string} */ texto) {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * Extracto de tarjeta.
 *
 * No es un historial: es una foto de lo que falta por cobrar el día que se
 * descargó. Lo ya liquidado desaparece de la siguiente, así que sólo vale la
 * última. Por eso cada fila lleva la foto de la que sale.
 *
 * Sus filas NO son gasto nuevo: son las cuotas que se cargarán en la cuenta.
 * Un mismo pago fraccionado aparece aquí una vez por cuota y allí una vez por
 * recibo, así que sumarlas a las de la cuenta contaría lo mismo dos veces.
 * @param {Celda[][]} rejilla
 * @param {string} [foto]  día de la foto y hora de importarla
 * @returns {Resultado}
 */
export function importarTarjeta(rejilla, foto = fotoDe({})) {
  const filaPendientes = buscarFila(rejilla, (_, i) =>
    /^Total operaciones pendientes/i.test(texto(rejilla, i, 0)),
  )
  const periodo = /(\d{2})\/(\d{4})/.exec(texto(rejilla, filaPendientes, 0))
  if (!periodo) {
    return {
      movimientos: [],
      avisos: ['No encontré el periodo del extracto ("Total operaciones pendientes mm/aaaa").'],
      meta: {},
    }
  }
  const mesExtracto = Number(periodo[1])
  const anioExtracto = Number(periodo[2])

  const cabecera = buscarFila(rejilla, (_, i) => texto(rejilla, i, 0) === 'FECHA')
  if (cabecera === -1) {
    return { movimientos: [], avisos: ['No encontré la cabecera "FECHA".'], meta: {} }
  }

  /** @type {Movimiento[]} */
  const movimientos = []
  /** @type {string[]} */
  const avisos = []

  for (let f = cabecera + 1; f < rejilla.length; f += 1) {
    const fechaCruda = texto(rejilla, f, 0)
    const concepto = texto(rejilla, f, 1)
    if (!fechaCruda || !concepto) break // el pie de totales empieza con la fecha vacía
    try {
      movimientos.push({
        id: '',
        fecha: fechaDesdeEsSinAnio(fechaCruda, anioExtracto, mesExtracto),
        fechaValor: fechaDesdeEsSinAnio(fechaCruda, anioExtracto, mesExtracto),
        conceptoRaw: concepto,
        entidadId: null,
        // La tarjeta lista cargos sin signo. Todos restan.
        importe: -Math.abs(parseImporte(texto(rejilla, f, 4))),
        saldo: null,
        origen: 'tarjeta',
        localidad: texto(rejilla, f, 2) || null,
        fraccionado: /fraccionad/i.test(texto(rejilla, f, 6)),
        excepcional: false,
      })
    } catch (error) {
      avisos.push(`Fila ${f + 1} ignorada («${concepto}»): ${/** @type {Error} */ (error).message}`)
    }
  }

  const sumaFilas = movimientos.reduce((t, m) => t + m.importe, 0)
  // Dos fotos distintas no pueden pisarse fila a fila: la posición sola no identifica nada.
  const dia = foto.slice(0, 10)
  const marca = huella(JSON.stringify(movimientos.map((m) => [m.fecha, m.conceptoRaw, m.importe])))
  movimientos.forEach((m, i) => Object.assign(m, { id: `tarjeta:${dia}-${marca}:${i}`, foto }))
  const declarado = leerTotal(rejilla, /^Total operaciones pendientes/i, 2)
  const dispuesto = leerTotal(rejilla, /^Saldo dispuesto/i, 2)

  // El banco declara un total que no coincide con la suma de las filas que
  // lista. No elegimos por él: guardamos los dos y lo decimos.
  if (declarado !== null && Math.abs(declarado) !== Math.abs(sumaFilas)) {
    avisos.push(
      `El extracto declara ${(Math.abs(declarado) / 100).toFixed(2)} € pendientes pero las ` +
        `${movimientos.length} filas que lista suman ${(Math.abs(sumaFilas) / 100).toFixed(2)} €. ` +
        'Se usa la suma de las filas, que es lo único verificable.',
    )
  }

  return {
    movimientos,
    avisos,
    meta: {
      tipo: 'tarjeta',
      periodo: `${anioExtracto}-${periodo[1]}`,
      tarjeta: texto(rejilla, buscarFila(rejilla, (_, i) => texto(rejilla, i, 0) === 'Tarjeta:'), 1),
      sumaFilas,
      totalDeclarado: declarado ?? 0,
      saldoDispuesto: dispuesto ?? 0,
    },
  }
}

/**
 * @param {Celda[][]} rejilla
 * @param {RegExp} etiqueta
 * @param {number} col
 * @returns {number | null}
 */
function leerTotal(rejilla, etiqueta, col) {
  const f = buscarFila(rejilla, (_, i) => etiqueta.test(texto(rejilla, i, 0)))
  if (f === -1) return null
  try {
    return parseImporte(texto(rejilla, f, col))
  } catch {
    return null
  }
}
