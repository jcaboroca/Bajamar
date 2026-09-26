// @ts-check
/**
 * Punto de entrada para leer un .xls de Excel 97-2003 sin dependencias.
 */

import { leerHoja } from './biff.js'
import { leerFlujo } from './ole2.js'

/** @typedef {import('./biff.js').Celda} Celda */

/**
 * @param {ArrayBuffer} datos
 * @returns {Celda[][]}
 */
export function leerLibro(datos) {
  return leerHoja(leerFlujo(datos, ['Workbook', 'Book']))
}

/**
 * Devuelve el texto de una celda, o cadena vacía. Normaliza los espacios.
 * @param {Celda[][]} rejilla
 * @param {number} fila
 * @param {number} col
 */
export function texto(rejilla, fila, col) {
  const v = rejilla[fila]?.[col]
  if (v === null || v === undefined) return ''
  return String(v).replace(/\s+/g, ' ').trim()
}

/**
 * Devuelve el número de una celda, o null si no lo es.
 * @param {Celda[][]} rejilla
 * @param {number} fila
 * @param {number} col
 */
export function numero(rejilla, fila, col) {
  const v = rejilla[fila]?.[col]
  return typeof v === 'number' ? v : null
}
