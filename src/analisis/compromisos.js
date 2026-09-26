// @ts-check
/**
 * Detección de compromisos: lo que se repite y, por tanto, volverá.
 *
 * Reglas que no se negocian, aprendidas a base de equivocarse con estos datos:
 *
 * 1. El importe esperado es la MEDIANA de la serie, nunca la media ni el
 *    último valor. Con 50 · 55 · 70 la media dice 58 y el último dice 70;
 *    la mediana dice 55, que es lo que de verdad cuesta.
 * 2. Nunca se afirma una tendencia con menos de cuatro observaciones.
 * 3. Con una o dos observaciones no se infiere periodicidad: se pregunta.
 *    Un recibo anual visto una sola vez es indistinguible de un pago único.
 * 4. Un mismo cobrador puede tener varias series a la vez. El ayuntamiento
 *    cobra el IBI, la basura y el vado por separado; promediarlos da una
 *    cifra que no corresponde a ningún recibo real.
 */

import { mediana } from '../dominio/dinero.js'
import { diasEntre, hoyIso, sumarMeses } from '../dominio/tipos.js'

/**
 * @typedef {import('../dominio/tipos.js').Movimiento} Movimiento
 * @typedef {import('../dominio/tipos.js').Compromiso} Compromiso
 */

/** @type {Array<{ nombre: Compromiso['periodicidad'], dias: number, meses: number, margen: number }>} */
const PERIODOS = [
  { nombre: 'mensual', dias: 30, meses: 1, margen: 7 },
  { nombre: 'bimestral', dias: 61, meses: 2, margen: 10 },
  { nombre: 'trimestral', dias: 91, meses: 3, margen: 12 },
  { nombre: 'semestral', dias: 182, meses: 6, margen: 20 },
  { nombre: 'anual', dias: 365, meses: 12, margen: 30 },
]

/** Días de cortesía antes de dar un recibo por retrasado. */
const GRACIA = { mensual: 6, bimestral: 10, trimestral: 12, semestral: 20, anual: 25 }

/**
 * Apariciones mínimas para creerse cada ritmo. Nunca bastan dos: con dos
 * fechas sólo hay un intervalo, y un intervalo de 365 días no distingue un
 * recibo anual de dos visitas al mismo bar con un año de diferencia.
 */
const MINIMO_OBSERVACIONES = { mensual: 4, bimestral: 3, trimestral: 3, semestral: 3, anual: 3 }

/** Por debajo de esto no merece seguimiento: es ruido, no un compromiso. */
const MINIMO_RELEVANTE = 500 // 5,00 €

/**
 * Categorías en las que una aparición suelta sí plantea una pregunta legítima:
 * son obligaciones que suelen volver. Una compra en una tienda de bicicletas
 * no vuelve, y preguntar por ella sería ruido.
 */
export const SUELEN_VOLVER = new Set([
  'seguros', 'impuestos', 'luz', 'agua', 'gas', 'telecom', 'vehiculos', 'calefaccion', 'riggs',
])

/**
 * Distancia al día del mes típico, contando que fin de mes cae en 28, 30 o 31.
 * @param {number} dia
 * @param {number} tipico
 */
function desviacionDia(dia, tipico) {
  const bruta = Math.abs(dia - tipico)
  return Math.min(bruta, 31 - bruta)
}

/**
 * @param {Movimiento[]} orden  ordenados por fecha ascendente
 * @returns {Compromiso['periodicidad'] | null}
 */
function periodicidadDe(orden) {
  const intervalos = []
  for (let i = 1; i < orden.length; i += 1) {
    intervalos.push(diasEntre(orden[i - 1].fecha, orden[i].fecha))
  }
  if (intervalos.length === 0) return null

  const tipico = mediana(intervalos)
  const encaja = PERIODOS.find((p) => Math.abs(tipico - p.dias) <= p.margen)
  if (!encaja) return null
  if (orden.length < MINIMO_OBSERVACIONES[encaja.nombre]) return null

  // Todos los intervalos deben caber en el mismo patrón: si uno se dispara,
  // no es un compromiso periódico sino una coincidencia.
  const coherentes = intervalos.filter((d) => Math.abs(d - encaja.dias) <= encaja.margen * 2)
  if (coherentes.length < Math.ceil(intervalos.length * 0.7)) return null

  // Un recibo domiciliado cae siempre el mismo día del mes. Una racha de
  // compras en meses seguidos —forfaits de esquí en invierno— no. Este es el
  // filtro que separa un compromiso de una costumbre estacional.
  if (encaja.meses <= 3) {
    const dias = orden.map((m) => Number(m.fecha.slice(8, 10)))
    const diaTipico = mediana(dias)
    const dispersos = dias.filter((d) => desviacionDia(d, diaTipico) > 4).length
    if (dispersos > Math.floor(dias.length * 0.25)) return null
  }

  return encaja.nombre
}

/**
 * Parte los movimientos de un mismo cobrador en series por importe.
 * Sólo se usa cuando el conjunto no tiene un ritmo propio: la luz varía de un
 * mes a otro y no debe trocearse, pero el ayuntamiento sí.
 * @param {Movimiento[]} lista
 * @returns {Movimiento[][]}
 */
function separarPorImporte(lista) {
  const orden = [...lista].sort((a, b) => Math.abs(a.importe) - Math.abs(b.importe))
  /** @type {Movimiento[][]} */
  const grupos = []
  for (const m of orden) {
    const ultimo = grupos[grupos.length - 1]
    const referencia = ultimo ? Math.abs(ultimo[ultimo.length - 1].importe) : 0
    const tolerancia = Math.max(300, referencia * 0.06)
    if (ultimo && Math.abs(Math.abs(m.importe) - referencia) <= tolerancia) ultimo.push(m)
    else grupos.push([m])
  }
  return grupos
}

/**
 * @typedef {object} Deteccion
 * @property {Compromiso[]} compromisos
 * @property {Array<{ entidadId: string, nombre: string, importe: number, fecha: string, meses: number }>} dudosos
 */

/**
 * @param {Movimiento[]} movimientos  ya clasificados con entidadId
 * @param {Map<string, string>} nombres  entidadId → nombre visible
 * @param {object} [opciones]
 * @param {string} [opciones.hoy]
 * @param {Set<string>} [opciones.ignorar]            entidades que no son gasto
 * @param {'gasto' | 'ingreso'} [opciones.signo]
 * @param {Map<string, string>} [opciones.categorias] entidadId → categoría
 * @returns {Deteccion}
 */
export function detectarCompromisos(movimientos, nombres, opciones = {}) {
  const hoy = opciones.hoy ?? hoyIso()
  const ignorar = opciones.ignorar ?? new Set()
  const categorias = opciones.categorias ?? new Map()
  const buscaIngresos = opciones.signo === 'ingreso'

  /** @type {Map<string, Movimiento[]>} */
  const porEntidad = new Map()
  for (const m of movimientos) {
    if (buscaIngresos ? m.importe <= 0 : m.importe >= 0) continue
    if (m.excepcional || m.origen === 'tarjeta' || m.fraccionado) continue
    if (!m.entidadId || ignorar.has(m.entidadId)) continue
    if (Math.abs(m.importe) < MINIMO_RELEVANTE) continue
    const lista = porEntidad.get(m.entidadId)
    if (lista) lista.push(m)
    else porEntidad.set(m.entidadId, [m])
  }

  /** @type {Compromiso[]} */
  const compromisos = []
  /** @type {Deteccion['dudosos']} */
  const dudosos = []

  for (const [entidadId, lista] of porEntidad) {
    const nombre = nombres.get(entidadId) ?? entidadId
    const orden = [...lista].sort((a, b) => a.fecha.localeCompare(b.fecha))

    // Primer intento: el cobrador entero como una sola serie.
    const entera = periodicidadDe(orden)
    if (entera) {
      compromisos.push(construir(entidadId, nombre, orden, entera))
      continue
    }

    // Segundo intento: varias series distintas bajo el mismo cobrador.
    let encontrada = false
    if (orden.length >= 5) {
      for (const serie of separarPorImporte(orden)) {
        if (serie.length < 2) continue
        const cronologica = [...serie].sort((a, b) => a.fecha.localeCompare(b.fecha))
        const ritmo = periodicidadDe(cronologica)
        if (!ritmo) continue
        // Dos préstamos del mismo banco salen como dos líneas con el mismo
        // nombre. No se les pega el importe al nombre: ya está en su columna,
        // y repetirlo sólo consigue que el nombre no quepa en una línea.
        compromisos.push(construir(entidadId, nombre, cronologica, ritmo))
        encontrada = true
      }
    }
    if (!encontrada) anotarDudoso(entidadId, nombre, orden)
  }

  /**
   * Una o dos apariciones no permiten deducir un ritmo. Si encima es de algo
   * que suele volver y el importe pesa, es una pregunta, no un dato.
   * @param {string} entidadId
   * @param {string} nombre
   * @param {Movimiento[]} orden
   */
  function anotarDudoso(entidadId, nombre, orden) {
    if (orden.length === 0 || orden.length > 3) return
    if (!SUELEN_VOLVER.has(categorias.get(entidadId) ?? 'otros')) return
    const ultima = orden[orden.length - 1].fecha
    const meses = Math.round(diasEntre(ultima, hoy) / 30.4)
    const importe = mediana(orden.map((m) => m.importe))
    if (Math.abs(importe) < 5000 || meses < 5) return
    dudosos.push({ entidadId, nombre, importe, fecha: ultima, meses })
  }

  /**
   * @param {string} entidadId
   * @param {string} nombre
   * @param {Movimiento[]} orden
   * @param {Compromiso['periodicidad']} periodicidad
   * @returns {Compromiso}
   */
  function construir(entidadId, nombre, orden, periodicidad) {
    const meses = PERIODOS.find((p) => p.nombre === periodicidad)?.meses ?? 1
    const ultima = orden[orden.length - 1].fecha
    let proxima = sumarMeses(ultima, meses)
    // Si han pasado varios periodos sin aparecer, proyectar al siguiente futuro
    // para no anunciar un recibo con fecha del pasado.
    let saltos = 0
    while (proxima < hoy && saltos < 24) {
      proxima = sumarMeses(proxima, meses)
      saltos += 1
    }
    const retraso = diasEntre(sumarMeses(ultima, meses), hoy)
    return {
      entidadId,
      nombre,
      periodicidad,
      importeEsperado: mediana(orden.map((m) => m.importe)),
      ultimaVista: ultima,
      proximaPrevista: proxima,
      observaciones: orden.length,
      estado: retraso > GRACIA[periodicidad] ? 'retrasado' : 'activo',
    }
  }

  compromisos.sort((a, b) => a.proximaPrevista.localeCompare(b.proximaPrevista))
  dudosos.sort((a, b) => a.importe - b.importe)
  return { compromisos, dudosos }
}

/**
 * La nómina y demás ingresos que se repiten.
 * @param {Movimiento[]} movimientos
 * @param {Map<string, string>} nombres
 * @param {{ hoy?: string, categorias?: Map<string, string> }} [opciones]
 */
export function detectarIngresos(movimientos, nombres, opciones = {}) {
  return detectarCompromisos(movimientos, nombres, { ...opciones, signo: 'ingreso' }).compromisos
}

/**
 * Gasto que no está comprometido: el que de verdad depende del día a día.
 * @param {Movimiento[]} movimientos
 * @param {Compromiso[]} compromisos
 * @param {Set<string>} categoriasFuera  categorías que no son gasto (traspasos, banco)
 * @param {Map<string, string>} categoriaPorEntidad
 * @returns {Movimiento[]}
 */
export function gastoOrdinario(movimientos, compromisos, categoriasFuera, categoriaPorEntidad) {
  const comprometidas = new Set(compromisos.map((c) => c.entidadId))
  return movimientos.filter((m) => {
    if (m.importe >= 0 || m.excepcional) return false
    if (m.origen === 'tarjeta' || m.fraccionado) return false
    if (!m.entidadId) return true
    if (comprometidas.has(m.entidadId)) return false
    return !categoriasFuera.has(categoriaPorEntidad.get(m.entidadId) ?? 'otros')
  })
}

/**
 * Ritmo diario de gasto ordinario, por mediana de los meses completos.
 * @param {Movimiento[]} ordinarios
 * @returns {{ porDia: number, porMes: number, meses: number }}
 */
export function ritmoOrdinario(ordinarios) {
  /** @type {Map<string, number>} */
  const porMes = new Map()
  for (const m of ordinarios) {
    const mes = m.fecha.slice(0, 7)
    porMes.set(mes, (porMes.get(mes) ?? 0) + m.importe)
  }
  const meses = [...porMes.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  // El mes en curso está a medias: contarlo hundiría la mediana.
  const completos = meses.slice(0, -1).map(([, v]) => v)
  const tipico = mediana(completos)
  return { porDia: Math.round(tipico / 30.4), porMes: tipico, meses: completos.length }
}
