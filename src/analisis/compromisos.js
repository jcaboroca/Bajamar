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
 * Lo que costará la próxima vez.
 *
 * Normalmente la mediana, por la regla 1. Pero un recibo que llevaba veinte
 * meses cobrando exactamente lo mismo y de pronto cobra más dos veces seguidas
 * no está variando: ha subido de precio, y la mediana seguiría prometiendo el
 * precio viejo durante un año. Se exige que el pasado fuera plano —la luz varía
 * todos los meses y nunca cambia de precio— y que las dos últimas vayan en la
 * misma dirección. La cifra buena es la última: en una subida, la primera vuelta
 * suele venir prorrateada a medias.
 * @param {Movimiento[]} orden  ordenados por fecha ascendente
 */
function importeEsperadoDe(orden) {
  const importes = orden.map((m) => m.importe)
  const base = mediana(importes)
  if (importes.length < 6) return base

  const cuerpo = importes.slice(0, -2).map(Math.abs)
  const tipico = mediana(cuerpo)
  if (!cuerpo.every((v) => Math.abs(v - tipico) <= Math.max(10, tipico * 0.02))) return base

  const salto = Math.max(50, tipico * 0.05)
  const cola = importes.slice(-2).map(Math.abs)
  const cambio = cola.every((v) => v - tipico > salto) || cola.every((v) => tipico - v > salto)
  return cambio ? importes[importes.length - 1] : base
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
 * Comparten precio, no sólo tamaño. El primer cobro suele venir prorrateado,
 * así que no se exige a todos: se exige a la mayoría.
 * @param {number[]} importes
 */
function casiIguales(importes) {
  const tipico = mediana(importes)
  const holgura = Math.max(10, tipico * 0.02)
  const dentro = importes.filter((v) => Math.abs(v - tipico) <= holgura).length
  return dentro >= Math.ceil(importes.length * 0.7)
}

/**
 * Una suscripción cuesta lo mismo cada vez. Cuando hemos tenido que partir a un
 * cobrador por importes el grupo es una conjetura, y tres compras parecidas
 * espaciadas tres meses se parecen mucho a un recibo trimestral sin serlo.
 * @param {Movimiento[]} serie  ordenada por fecha ascendente
 */
function tienenElMismoPrecio(serie) {
  const importes = serie.map((m) => Math.abs(m.importe))
  if (casiIguales(importes)) return true
  // Una subida de precio deja dos tramos planos, uno detrás del otro. Un montón
  // de compras parecidas no deja ninguno.
  for (let corte = 2; corte <= importes.length - 2; corte += 1) {
    if (casiIguales(importes.slice(0, corte)) && casiIguales(importes.slice(corte))) return true
  }
  return false
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
    if (ultimo && cabeEnLaSerie(ultimo, m)) ultimo.push(m)
    else grupos.push([m])
  }
  return grupos
}

/**
 * Encadenar por cercanía de importe arrastra: con muchos cobros pequeños, cada
 * uno se pega al anterior y al final todo es un solo grupo. Se mide contra el
 * primero del grupo, no contra el último, y cuando el importe no es el mismo se
 * exige además que caiga el mismo día del mes: dos suscripciones de 5 y 7 euros
 * son dos cosas distintas por mucho que se parezcan en el precio.
 * @param {Movimiento[]} grupo
 * @param {Movimiento} m
 */
function cabeEnLaSerie(grupo, m) {
  const ancla = Math.abs(grupo[0].importe)
  const suyo = Math.abs(m.importe)
  const distancia = Math.abs(suyo - ancla)
  if (distancia > Math.max(300, ancla * 0.06)) return false
  if (distancia <= Math.max(20, ancla * 0.01)) return true
  const dias = grupo.map((x) => Number(x.fecha.slice(8, 10)))
  return desviacionDia(Number(m.fecha.slice(8, 10)), mediana(dias)) <= 4
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
    const usados = new Set()
    if (orden.length >= 5) {
      for (const serie of separarPorImporte(orden)) {
        if (serie.length < 2) continue
        const cronologica = [...serie].sort((a, b) => a.fecha.localeCompare(b.fecha))
        const ritmo = periodicidadDe(cronologica)
        if (!ritmo) continue
        if (!tienenElMismoPrecio(cronologica)) continue
        // Dos préstamos del mismo banco salen como dos líneas con el mismo
        // nombre. No se les pega el importe al nombre: ya está en su columna,
        // y repetirlo sólo consigue que el nombre no quepa en una línea.
        const recibo = construir(entidadId, nombre, cronologica, ritmo, true)
        // Dos series con el mismo importe compartirían identidad, y entonces
        // contestar por una contestaría por la otra sin avisar.
        while (usados.has(recibo.reciboId)) recibo.reciboId += '+'
        usados.add(recibo.reciboId)
        compromisos.push(recibo)
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
   * @param {boolean} [separado] una de varias series del mismo cobrador
   * @returns {Compromiso}
   */
  function construir(entidadId, nombre, orden, periodicidad, separado = false) {
    const periodo = PERIODOS.find((p) => p.nombre === periodicidad)
    const meses = periodo?.meses ?? 1
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
    // Un recibo puede retrasarse; tres seguidos sin pasar no es retraso, es que
    // se acabó. Seguir contándolo hunde la previsión con un gasto que ya no
    // existe, y nadie debería tener que venir a avisar de cada cuota que
    // termina. Si vuelve a pasar, vuelve sola.
    const muerto = retraso > (periodo?.dias ?? 30) * 2 + (periodo?.margen ?? 7)
    const importeEsperado = importeEsperadoDe(orden)
    return {
      entidadId,
      // Dos recibos del mismo cobrador pueden no ser la misma cosa: la
      // aportación que uno puede saltarse y la letra del coche que no. Se
      // distinguen por el importe en euros enteros, que aguanta los céntimos
      // de un mes a otro sin confundir dos préstamos de importe parecido.
      reciboId: separado ? `${entidadId}#${Math.round(Math.abs(importeEsperado) / 100)}` : entidadId,
      nombre,
      periodicidad,
      importeEsperado,
      ultimaVista: ultima,
      proximaPrevista: proxima,
      observaciones: orden.length,
      cobros: orden.map((m) => m.id),
      estado: muerto ? 'extinto' : retraso > GRACIA[periodicidad] ? 'retrasado' : 'activo',
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
  // Por cobro y no por cobrador: bajo un mismo PayPal conviven dos
  // suscripciones y cien compras sueltas, y esas compras sí son gasto del día a
  // día. Dar por comprometido todo lo suyo rebajaría el ritmo sin motivo.
  const comprometidos = new Set(compromisos.flatMap((c) => c.cobros))
  return movimientos.filter((m) => {
    if (m.importe >= 0 || m.excepcional) return false
    if (m.origen === 'tarjeta' || m.fraccionado) return false
    if (comprometidos.has(m.id)) return false
    if (!m.entidadId) return true
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
