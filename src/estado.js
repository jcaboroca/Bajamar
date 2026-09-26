// @ts-check
/**
 * Ensamblado: de una lista de movimientos crudos al estado que mira la interfaz.
 */

import { detectarCompromisos, detectarIngresos, gastoOrdinario, ritmoOrdinario } from './analisis/compromisos.js'
import { eventosDesde, proyectar } from './analisis/bajamar.js'
import { hoyIso, sumarMeses, ultimoDiaDelMes } from './dominio/tipos.js'
import { limpiarConcepto } from './entidades/limpiar.js'
import { indicePorAlias, reconciliar } from './entidades/reconciliar.js'
import { CATEGORIAS } from './entidades/semillas.js'

/**
 * @typedef {import('./dominio/tipos.js').Movimiento} Movimiento
 * @typedef {import('./dominio/tipos.js').Bulto} Bulto
 */

/**
 * Categorías que no son gasto del día a día: mueven dinero pero no lo queman.
 * Contarlas hincharía el gasto y haría que ahorrar pareciera despilfarrar.
 */
export const NO_ES_GASTO = new Set(['traspaso', 'banco', 'nomina'])

/**
 * Cuando el concepto limpio es un número de cuenta, no hay comercio detrás:
 * es dinero que se mueve de un bolsillo propio a otro.
 */
const PARECE_CUENTA = /^\d{4}[- ]?\d{6,}$/

/** El banco liquida la tarjeta con un apunte propio en la cuenta. */
const LIQUIDACION_TARJETA = /TARJETA\s+(DE\s+)?CREDITO/i

/**
 * @param {Movimiento[]} crudos
 * @param {object} [opciones]
 * @param {string} [opciones.hoy]
 * @param {Bulto[]} [opciones.bultos]
 * @param {Record<string, string>} [opciones.categoriasManuales] entidadId → categoría
 * @param {string[]} [opciones.excepcionales] ids de movimientos marcados a mano
 */
export function construirEstado(crudos, opciones = {}) {
  const hoy = opciones.hoy ?? hoyIso()
  const excepcionales = new Set(opciones.excepcionales ?? [])

  const limpios = crudos.map((m) => ({ m, ...limpiarConcepto(m.conceptoRaw) }))
  const { entidades, categorias } = reconciliar(limpios.map((x) => x.nombre))
  const porAlias = indicePorAlias(entidades)
  const nombres = new Map(entidades.map((e) => [e.id, e.nombre]))

  for (const [entidadId, categoria] of Object.entries(opciones.categoriasManuales ?? {})) {
    categorias.set(entidadId, categoria)
  }

  /** @type {Movimiento[]} */
  const movimientos = limpios.map(({ m, nombre, localidad, pista }) => {
    const entidadId = porAlias.get(nombre) ?? null
    if (entidadId) {
      const actual = categorias.get(entidadId) ?? 'otros'
      // La etiqueta que pone el banco gana sobre «sin clasificar», pero no sobre
      // una regla concreta ni sobre lo que haya dicho el usuario.
      if (actual === 'otros' && pista && CATEGORIAS[pista]) categorias.set(entidadId, pista)
      else if (actual === 'otros' && PARECE_CUENTA.test(nombre)) categorias.set(entidadId, 'traspaso')
    }
    return {
      ...m,
      entidadId,
      localidad: m.localidad ?? localidad,
      excepcional: excepcionales.has(m.id),
    }
  })

  const cuenta = movimientos.filter((m) => m.origen === 'cuenta')
  const tarjeta = movimientos.filter((m) => m.origen === 'tarjeta')

  // Un traspaso al ahorro propio no es gasto, pero sí sale de la cuenta: tiene
  // que entrar en la proyección aunque no cuente como dinero quemado. Por eso
  // no se excluye aquí, sino más abajo al medir el gasto.
  const { compromisos, dudosos } = detectarCompromisos(cuenta, nombres, { hoy, categorias })
  const ingresos = detectarIngresos(cuenta, nombres, { hoy, categorias })
  const ordinarios = gastoOrdinario(cuenta, compromisos, NO_ES_GASTO, categorias)
  const ritmo = ritmoOrdinario(ordinarios)

  const ultimo = cuenta.reduce(
    (mejor, m) => (m.fecha > mejor.fecha || (m.fecha === mejor.fecha && (m.saldo ?? 0) < (mejor.saldo ?? 0)) ? m : mejor),
    cuenta[0],
  )
  const saldoInicial = ultimo?.saldo ?? 0

  // La tarjeta se conoce por dos vías y cada una sabe una cosa: el histórico de
  // la cuenta sabe CUÁNDO la cobran, y el extracto de la tarjeta sabe CUÁNTO
  // van a cobrar. Sumar las dos sería contar el mismo dinero dos veces.
  const pendienteTarjeta = tarjeta.reduce((t, m) => t + m.importe, 0)
  const liquidacion = compromisos.find((c) => LIQUIDACION_TARJETA.test(c.nombre)) ?? null
  const cargoTarjeta = pendienteTarjeta === 0 ? null : {
    fecha: liquidacion?.proximaPrevista ?? proximoDia(hoy, 30),
    importe: pendienteTarjeta,
  }

  const hasta = ultimoDiaDelMes(sumarMeses(hoy, 1))
  const eventos = eventosDesde({
    compromisos: compromisos.filter((c) => c.estado !== 'extinto' && c !== liquidacion),
    ingresos,
    bultos: opciones.bultos ?? [],
    tarjeta: cargoTarjeta,
    desde: hoy,
    hasta,
  })

  const proyeccion = proyectar({ saldoInicial, desde: hoy, hasta, eventos, ritmoPorDia: ritmo.porDia })

  return {
    hoy,
    movimientos,
    entidades,
    categorias,
    nombres,
    compromisos,
    dudosos,
    ingresos,
    ordinarios,
    ritmo,
    saldoInicial,
    pendienteTarjeta,
    proyeccion,
  }
}

/**
 * Próxima vez que caiga ese día del mes, contando desde hoy inclusive.
 * @param {string} hoy
 * @param {number} dia
 */
function proximoDia(hoy, dia) {
  const [a, m, d] = hoy.split('-').map(Number)
  const esteMes = `${a}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
  return d <= dia ? esteMes : sumarMeses(esteMes, 1)
}

/**
 * Totales por categoría en un rango. Incluye el reparto completo: si algo no
 * encaja en ninguna, aparece como "Sin clasificar" en vez de desaparecer.
 * @param {Movimiento[]} movimientos
 * @param {Map<string, string>} categorias
 * @param {{ desde?: string, hasta?: string }} [rango]
 */
export function totalesPorCategoria(movimientos, categorias, rango = {}) {
  /** @type {Map<string, { total: number, cuantos: number }>} */
  const acumulado = new Map()
  for (const m of movimientos) {
    if (rango.desde && m.fecha < rango.desde) continue
    if (rango.hasta && m.fecha > rango.hasta) continue
    if (m.importe >= 0 || m.origen === 'tarjeta') continue
    const categoria = (m.entidadId && categorias.get(m.entidadId)) || 'otros'
    if (NO_ES_GASTO.has(categoria)) continue
    const previo = acumulado.get(categoria) ?? { total: 0, cuantos: 0 }
    acumulado.set(categoria, { total: previo.total + m.importe, cuantos: previo.cuantos + 1 })
  }
  return [...acumulado.entries()]
    .map(([id, v]) => ({ id, nombre: CATEGORIAS[id] ?? id, ...v }))
    .sort((a, b) => a.total - b.total)
}
