// @ts-check
/**
 * En qué se va el goteo del día a día.
 *
 * El goteo ya está medido —mediana de los meses completos— y esa cifra manda:
 * es la que sale en portada y la que mueve la previsión. Aquí no se vuelve a
 * medir nada, sólo se parte en trozos según lo que pesó cada categoría en esos
 * mismos meses.
 *
 * Repartir en vez de medir cada categoría por su cuenta no es pereza. Las
 * medianas por categoría no suman la mediana del total: un impuesto anual vale
 * cero en quince meses de veinte, así que su mediana es cero y el reparto se
 * quedaría a medias. Sumando trozos que sí cuadran, «cuánto gasto» tiene una
 * sola respuesta en toda la aplicación.
 */

import { CATEGORIAS } from '../entidades/semillas.js'

/**
 * @typedef {import('../dominio/tipos.js').Movimiento} Movimiento
 */

/**
 * @typedef {object} Trozo
 * @property {string} categoria
 * @property {string} nombre
 * @property {number} alMes     céntimos negativos
 * @property {number} cuantos   movimientos que lo sostienen
 */

/**
 * @param {Movimiento[]} ordinarios
 * @param {{ porMes: number }} ritmo
 * @returns {Trozo[]}  de más caro a menos; suman exactamente ritmo.porMes
 */
export function repartirGasto(ordinarios, ritmo) {
  const meses = [...new Set(ordinarios.map((m) => m.fecha.slice(0, 7)))].sort()
  const enCurso = meses[meses.length - 1]

  /** @type {Map<string, { suma: number, cuantos: number }>} */
  const porCategoria = new Map()
  let total = 0
  for (const m of ordinarios) {
    // El mes a medias queda fuera, igual que al medir el goteo: si no, la
    // categoría que toca cobrar a final de mes saldría siempre pequeña.
    if (m.fecha.slice(0, 7) === enCurso) continue
    const clave = m.categoria ?? 'otros'
    const previo = porCategoria.get(clave) ?? { suma: 0, cuantos: 0 }
    porCategoria.set(clave, { suma: previo.suma + m.importe, cuantos: previo.cuantos + 1 })
    total += m.importe
  }
  if (total === 0) return []

  const trozos = [...porCategoria.entries()]
    .map(([categoria, { suma, cuantos }]) => ({
      categoria,
      nombre: CATEGORIAS[categoria] ?? categoria,
      alMes: Math.round(ritmo.porMes * (suma / total)),
      cuantos,
    }))
    .sort((a, b) => a.alMes - b.alMes)

  // Los céntimos del redondeo se los queda el trozo más gordo: los trozos
  // tienen que sumar el goteo al céntimo o habría dos cifras para lo mismo.
  trozos[0].alMes += ritmo.porMes - trozos.reduce((t, x) => t + x.alMes, 0)
  return trozos
}
