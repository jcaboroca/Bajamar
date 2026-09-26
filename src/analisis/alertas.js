// @ts-check
/**
 * Avisos: lo que la aplicación ha visto y tú no.
 *
 * Una alerta que se dispara sola deja de leerse. Aquí cada regla tiene un
 * umbral pensado para que salte pocas veces y, cuando salta, merezca la pena
 * mirarla. Por eso hay mínimos en euros además de en porcentaje: un 70% más
 * de lo habitual en un café son dos euros.
 *
 * Nada de lo que se detecta aquí es una certeza. Un cargo repetido puede ser
 * dos cafés seguidos y un recibo que falta puede llegar mañana, así que el
 * texto dice «posible» cuando lo es. Una aplicación que se equivoca con
 * seguridad es peor que una que duda en voz alta.
 */

import { diasEntre, fechaLarga, mesDe } from '../dominio/tipos.js'
import { formatEuros } from '../dominio/dinero.js'
import { MESES_DE } from './fijos.js'

/**
 * @typedef {import('../dominio/tipos.js').Movimiento} Movimiento
 * @typedef {import('../dominio/tipos.js').Compromiso} Compromiso
 * @typedef {import('./fijos.js').Fijo} Fijo
 * @typedef {import('./presupuestos.js').LineaPresupuesto} LineaPresupuesto
 */

/**
 * @typedef {'alto' | 'medio' | 'bajo'} Nivel
 * @typedef {'suelo' | 'anual' | 'retraso' | 'nomina' | 'duplicado' | 'desvio' | 'presupuesto' | 'nuevo'} Clase
 */

/**
 * @typedef {object} Aviso
 * @property {string} id
 * @property {Clase} clase
 * @property {Nivel} nivel
 * @property {string} titulo
 * @property {string} detalle
 * @property {string} [entidadId] cuando el aviso se puede contestar tocando
 */

/** Días de antelación con los que avisar de un recibo gordo. */
const ANTELACION = 15

/** Por debajo de esto un aviso es ruido, por mucho que el porcentaje asuste. */
const MINIMO_AVISO = 5000 // 50,00 €

/**
 * @param {object} entrada
 * @param {import('./bajamar.js').Proyeccion} entrada.proyeccion
 * @param {Fijo[]} entrada.fijos
 * @param {Compromiso[]} entrada.ingresos
 * @param {Movimiento[]} entrada.movimientos
 * @param {Map<string, string>} entrada.nombres
 * @param {LineaPresupuesto[]} entrada.presupuestos
 * @param {number} entrada.colchon        céntimos; por debajo, incomodidad
 * @param {string} entrada.hoy
 * @param {Set<Clase>} [entrada.silenciadas]
 * @returns {Aviso[]}
 */
export function revisar({ proyeccion, fijos, ingresos, movimientos, nombres, presupuestos, colchon, hoy, silenciadas }) {
  /** @type {Aviso[]} */
  const avisos = []

  const { suelo } = proyeccion
  if (suelo.saldo < 0) {
    avisos.push({
      id: 'suelo',
      clase: 'suelo',
      nivel: 'alto',
      titulo: `Tu saldo se pone en negativo el ${fechaLarga(suelo.fecha)}`,
      detalle: `La previsión baja hasta ${formatEuros(suelo.saldo)}. Faltan ${diasEntre(hoy, suelo.fecha)} días.`,
    })
  } else if (colchon > 0 && suelo.saldo < colchon) {
    avisos.push({
      id: 'suelo',
      clase: 'suelo',
      nivel: 'medio',
      titulo: `El ${fechaLarga(suelo.fecha)} bajas de tu colchón`,
      detalle: `Te quedarías en ${formatEuros(suelo.saldo)}, por debajo de los ${formatEuros(colchon)} que te has marcado.`,
    })
  }

  for (const f of fijos) {
    if (f.periodicidad === 'mensual' || f.importeEsperado > -10_000) continue
    const dias = diasEntre(hoy, f.proximaPrevista)
    if (dias < 0 || dias > ANTELACION) continue
    avisos.push({
      id: `anual:${f.entidadId}:${f.proximaPrevista}`,
      clase: 'anual',
      nivel: 'medio',
      titulo: `${f.nombre}: ${formatEuros(f.importeEsperado)} en ${dias} ${dias === 1 ? 'día' : 'días'}`,
      detalle: `Se cobra cada ${f.periodicidad === 'anual' ? 'año' : `${MESES_DE[f.periodicidad]} meses`}. Equivale a ${formatEuros(f.mensualEquivalente)} al mes.`,
    })
  }

  // Los retrasos se dicen en una sola línea. Tres cajas repitiendo el mismo
  // texto con otro nombre no informan tres veces: empujan hacia abajo lo que
  // sí importa y enseñan a no leer los avisos.
  const retrasados = fijos.filter((f) => f.estado === 'retrasado')
  if (retrasados.length > 0) {
    const nombra = retrasados.slice(0, 3).map((f) => f.nombre)
    const resto = retrasados.length - nombra.length
    const lista = nombra.join(', ') + (resto > 0 ? ` y ${resto} más` : '')
    avisos.push({
      id: `retraso:${retrasados.map((f) => f.entidadId).join('|')}`,
      clase: 'retraso',
      nivel: 'bajo',
      titulo: retrasados.length === 1
        ? `${lista} no ha vuelto a pasar`
        : `${retrasados.length} recibos no han vuelto a pasar`,
      detalle: retrasados.length === 1
        ? 'Tocaba hace tiempo y no aparece. Puede que lo hayas dado de baja, o puede que llegue con retraso y se junte con el siguiente. Toca aquí para decírmelo.'
        : `${lista}. Puede que los hayas dado de baja, o puede que lleguen con retraso y se junten con los siguientes. En Previsión puedes decirme cuáles ya no pagas.`,
      // Sólo cuando hay uno: con varios, un toque no puede contestar por todos.
      entidadId: retrasados.length === 1 ? retrasados[0].entidadId : undefined,
    })
  }

  for (const i of ingresos) {
    if (i.estado !== 'retrasado' || i.periodicidad !== 'mensual') continue
    avisos.push({
      id: `nomina:${i.entidadId}`,
      clase: 'nomina',
      nivel: 'medio',
      titulo: `Todavía no ha entrado ${i.nombre}`,
      detalle: `Sueles cobrarlo hacia el día ${Number(i.ultimaVista.slice(8, 10))}. La previsión cuenta con ello, así que si no llega el suelo será más bajo.`,
    })
  }

  avisos.push(...duplicados(movimientos, nombres, hoy))
  avisos.push(...desvios(presupuestos, hoy))

  for (const p of presupuestos) {
    if (p.presupuesto <= 0 || p.propuesto) continue
    if (p.porcentaje < 90) continue
    avisos.push({
      id: `presupuesto:${p.id}`,
      clase: 'presupuesto',
      nivel: p.porcentaje > 100 ? 'medio' : 'bajo',
      titulo: p.porcentaje > 100
        ? `Te has pasado ${formatEuros(-p.disponible)} en ${p.nombre}`
        : `Llevas el ${p.porcentaje}% del presupuesto de ${p.nombre}`,
      detalle: `${formatEuros(p.gastado)} de ${formatEuros(p.presupuesto)} este mes.`,
    })
  }

  const orden = { alto: 0, medio: 1, bajo: 2 }
  return avisos
    .filter((a) => !silenciadas?.has(a.clase))
    .sort((a, b) => orden[a.nivel] - orden[b.nivel])
}

/**
 * Dos cargos iguales del mismo sitio en pocos días.
 *
 * No se afirma que sea un error: repostar dos veces en la misma gasolinera
 * pasa. Lo que se afirma es que merece un vistazo.
 *
 * @param {Movimiento[]} movimientos
 * @param {Map<string, string>} nombres
 * @param {string} hoy
 * @returns {Aviso[]}
 */
function duplicados(movimientos, nombres, hoy) {
  const recientes = movimientos
    .filter((m) => m.importe < 0 && m.entidadId && diasEntre(m.fecha, hoy) <= 60)
    .sort((a, b) => a.fecha.localeCompare(b.fecha))

  /** @type {Aviso[]} */
  const avisos = []
  for (let i = 0; i < recientes.length; i += 1) {
    for (let j = i + 1; j < recientes.length; j += 1) {
      const a = recientes[i]
      const b = recientes[j]
      const dias = diasEntre(a.fecha, b.fecha)
      if (dias > 3) break
      if (a.entidadId !== b.entidadId || a.importe !== b.importe) continue
      if (Math.abs(a.importe) < MINIMO_AVISO) continue
      avisos.push({
        id: `duplicado:${a.id}:${b.id}`,
        clase: 'duplicado',
        nivel: 'bajo',
        titulo: `Posible cargo duplicado en ${nombres.get(a.entidadId ?? '') ?? 'un comercio'}`,
        detalle: `${formatEuros(a.importe)} el ${fechaLarga(a.fecha)} y otro igual el ${fechaLarga(b.fecha)}.`,
      })
    }
  }
  return avisos.slice(0, 3)
}

/**
 * Categorías que este mes se han disparado frente a lo habitual.
 * @param {LineaPresupuesto[]} lineas
 * @param {string} hoy
 * @returns {Aviso[]}
 */
function desvios(lineas, hoy) {
  // A día 3 cualquier categoría va «por debajo» y a día 28 casi ninguna. Antes
  // de que el mes esté mediado, comparar no dice nada.
  const dia = Number(hoy.slice(8, 10))
  if (dia < 12) return []

  return lineas
    .filter((l) => l.habitual > 0 && l.desvio >= 0.5 && l.gastado - l.habitual >= MINIMO_AVISO)
    .slice(0, 3)
    .map((l) => ({
      id: `desvio:${l.id}:${mesDe(hoy)}`,
      clase: /** @type {Clase} */ ('desvio'),
      nivel: /** @type {Nivel} */ ('bajo'),
      titulo: `${Math.round(l.desvio * 100)}% más en ${l.nombre} que de costumbre`,
      detalle: `Llevas ${formatEuros(l.gastado)} y tu mes normal son ${formatEuros(l.habitual)}.`,
    }))
}
