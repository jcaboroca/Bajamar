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
 * 3. Con una sola observación no se infiere periodicidad: se pregunta. Con dos
 *    tampoco, salvo lo anual, que de otro modo no podría detectarse nunca sin
 *    tres años de extractos; a cambio se le exige el mismo día del año y el
 *    mismo precio.
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
 * Apariciones mínimas para creerse cada ritmo. Dos nunca bastan para deducir
 * un ritmo a ciegas: un intervalo de 365 días no distingue un recibo anual de
 * dos visitas al mismo bar con un año de diferencia. Lo anual tiene su propia
 * puerta más abajo, con la prueba mucho más exigente.
 */
const MINIMO_OBSERVACIONES = { mensual: 4, bimestral: 3, trimestral: 3, semestral: 3, anual: 3 }

/** Por debajo de esto no merece seguimiento: es ruido, no un compromiso. */
const MINIMO_RELEVANTE = 500 // 5,00 €

/**
 * Y con sólo dos vistas, por debajo de esto no merece el riesgo de acertar a
 * medias: un recibo anual de treinta euros no mueve una previsión, pero sí la
 * ensucia si resulta que era una compra que se repitió por casualidad.
 */
const MINIMO_ANUAL = 3000 // 30,00 €

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
  // no es un compromiso periódico sino una coincidencia. Lo mensual tiene
  // manga ancha porque un recibo puede irse una semana; lo semestral y lo
  // anual, no: con el margen doblado, «cada seis meses» se traga cualquier
  // cosa entre cuatro y ocho, y tres pagos de mayo, octubre y mayo acaban
  // llamándose semestrales cuando son uno anual y un plazo suelto.
  const holgura = encaja.meses >= 6 ? encaja.margen : encaja.margen * 2
  const coherentes = intervalos.filter((d) => Math.abs(d - encaja.dias) <= holgura)
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
  if (dentro < Math.ceil(importes.length * 0.7)) return false
  // Se tolera que alguno se salga, pero no que se dispare. Una licencia de 99 €
  // entre nueve cuotas de 9,99 no es la misma cuota redondeada de otra manera,
  // y colarla aquí hacía pasar a Apple entero por un solo recibo.
  return importes.every((v) => Math.abs(v - tipico) <= Math.max(100, tipico * 0.5))
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
  // Cada precio deja un tramo plano y seguido. Y los precios cambian más de una
  // vez: Netflix pasó de 13,99 a 6,99 y de ahí a 8,99 en año y medio. Se van
  // mordiendo tramos lo más largos posible; si alguno sale de uno solo, esto no
  // son precios sino compras sueltas.
  let desde = 0
  let tramos = 0
  while (desde < importes.length) {
    let hasta = importes.length
    while (hasta > desde && !casiIguales(importes.slice(desde, hasta))) hasta -= 1
    if (hasta - desde < 2) return false
    desde = hasta
    tramos += 1
  }
  return tramos <= 4
}

/**
 * La racha final de importes iguales. Un cobro viejo y suelto le rompe el ritmo
 * a una serie que lleva nueve meses clavada, y entonces se pierde entera.
 * @param {Movimiento[]} serie  ordenada por fecha ascendente
 * @returns {Movimiento[]}
 */
function rachaFinal(serie) {
  let desde = serie.length - 1
  while (desde > 0 && casiIguales(serie.slice(desde - 1).map((m) => Math.abs(m.importe)))) desde -= 1
  return serie.slice(desde)
}

/**
 * Parte los movimientos de un mismo cobrador en series por importe.
 * Sólo se usa cuando el conjunto no tiene un ritmo propio: la luz varía de un
 * mes a otro y no debe trocearse, pero el ayuntamiento sí.
 * @param {Movimiento[]} lista
 * @returns {Movimiento[][]}
 */function separarPorImporte(lista) {
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
 * @typedef {object} Factura
 * @property {string} fecha
 * @property {number} total
 * @property {Movimiento[]} cobros
 */

/**
 * Los apuntes del mismo cobrador y del mismo día son una factura, no varias.
 * El ayuntamiento cobra el IBI, la basura y el vado en tres líneas de la misma
 * mañana: tres apuntes en el extracto y un solo recibo en la vida real.
 * @param {Movimiento[]} orden
 * @returns {Factura[]}
 */
function facturasPorDia(orden) {
  /** @type {Map<string, Movimiento[]>} */
  const porDia = new Map()
  for (const m of orden) {
    const lista = porDia.get(m.fecha)
    if (lista) lista.push(m)
    else porDia.set(m.fecha, [m])
  }
  return [...porDia.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([fecha, cobros]) => ({ fecha, total: cobros.reduce((t, m) => t + m.importe, 0), cobros }))
}

/**
 * La misma factura del año pasado: cae casi en el mismo día y cuesta casi lo
 * mismo. El margen es mucho más estrecho que el de lo anual con tres vistas
 * porque aquí no hay una tercera fecha que confirme nada: con dónde cae la
 * segunda se decide todo. Dos compras de Amazon separadas por once meses y
 * medio no son una suscripción anual.
 * @param {Factura} a
 * @param {Factura} b
 */
function esLaDelAnoPasado(a, b) {
  if (Math.abs(diasEntre(a.fecha, b.fecha) - 365) > 12) return false
  const mayor = Math.max(Math.abs(a.total), Math.abs(b.total))
  return Math.abs(a.total - b.total) <= Math.max(100, mayor * 0.04)
}

/**
 * Recibos que sólo pasan una vez al año.
 *
 * Exigir tres apariciones para creerse lo anual es exigir tres años de
 * extractos, y con veinte meses eso significa no verlo nunca: el seguro del
 * coche lleva dos abriles cobrando lo mismo y acaba contado como gasto del día
 * a día. Dos bastan cuando no dejan lugar a duda —mismo día del año, mismo
 * precio, un año justo en medio—, que es una prueba bastante más dura que la
 * que se le pide a lo mensual.
 *
 * Y un cobrador que ha demostrado dos veces que factura en fechas fijas del año
 * factura también en las otras suyas. El ayuntamiento cobró en marzo, mayo y
 * junio los dos años; el plazo de octubre es el mismo calendario, aunque de
 * octubre sólo haya una. Se admite sólo mientras su turno no haya pasado: una
 * factura suelta cuyo aniversario ya vino y no se repitió no era un recibo.
 * @param {Movimiento[]} orden  ordenados por fecha ascendente
 * @param {string} hoy
 * @returns {Factura[][]}  cada grupo es un recibo anual distinto
 */
function anualesDeDosVistas(orden, hoy) {
  const facturas = facturasPorDia(orden).filter((f) => Math.abs(f.total) >= MINIMO_ANUAL)
  if (facturas.length < 2) return []

  /** @type {Factura[][]} */
  const cadenas = []
  const encadenados = new Set()
  for (let i = 0; i < facturas.length; i += 1) {
    if (encadenados.has(i)) continue
    const cadena = [facturas[i]]
    encadenados.add(i)
    for (let j = i + 1; j < facturas.length; j += 1) {
      if (encadenados.has(j)) continue
      if (!esLaDelAnoPasado(cadena[cadena.length - 1], facturas[j])) continue
      cadena.push(facturas[j])
      encadenados.add(j)
    }
    cadenas.push(cadena)
  }

  const confirmadas = cadenas.filter((c) => c.length >= 2)
  if (confirmadas.length < 2) return confirmadas
  return cadenas.filter((c) => c.length >= 2 || sumarMeses(c[0].fecha, 12) > hoy)
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
 * @param {Record<string, true>} [opciones.anuales]   entidadId → el usuario dice que vuelve cada año
 * @returns {Deteccion}
 */
export function detectarCompromisos(movimientos, nombres, opciones = {}) {
  const hoy = opciones.hoy ?? hoyIso()
  const ignorar = opciones.ignorar ?? new Set()
  const categorias = opciones.categorias ?? new Map()
  const confirmadosAnuales = opciones.anuales ?? {}
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

    // Primer intento: el cobrador entero como una sola serie. Aunque tenga
    // ritmo, si sus importes no son el mismo precio puede ser un cobrador con
    // dos cosas a la vez —una cuota al mes y una licencia al año— y entonces
    // hay que mirar dentro antes de darlo por un solo recibo.
    const entera = periodicidadDe(orden)
    if (entera && tienenElMismoPrecio(orden)) {
      compromisos.push(construir(entidadId, nombre, orden, entera))
      continue
    }

    // Segundo intento: varias series distintas bajo el mismo cobrador.
    let encontrada = false
    const usados = new Set()
    /** @type {Compromiso[]} */
    const sueltas = []
    let cubiertos = 0
    if (orden.length >= 5) {
      for (const serie of separarPorImporte(orden)) {
        if (serie.length < 2) continue
        const cronologica = [...serie].sort((a, b) => a.fecha.localeCompare(b.fecha))
        let candidata = cronologica
        let ritmo = periodicidadDe(candidata)
        if (!ritmo) {
          const racha = rachaFinal(cronologica)
          if (racha.length >= 3) {
            candidata = racha
            ritmo = periodicidadDe(candidata)
          }
        }
        if (!ritmo) continue
        if (!tienenElMismoPrecio(candidata)) continue
        // Dos préstamos del mismo banco salen como dos líneas con el mismo
        // nombre. No se les pega el importe al nombre: ya está en su columna,
        // y repetirlo sólo consigue que el nombre no quepa en una línea.
        const recibo = construir(entidadId, nombre, candidata, ritmo, true)
        // Dos series con el mismo importe compartirían identidad, y entonces
        // contestar por una contestaría por la otra sin avisar.
        while (usados.has(recibo.reciboId)) recibo.reciboId += '+'
        usados.add(recibo.reciboId)
        sueltas.push(recibo)
        cubiertos += candidata.length
        encontrada = true
      }
    }

    // Trocear sólo compensa si lo troceado explica al cobrador. Con la luz
    // salen dos meses parecidos por casualidad y el resto queda huérfano: más
    // vale un recibo variable entero que dos trozos y un agujero.
    if (encontrada && (!entera || cubiertos * 2 >= orden.length)) {
      compromisos.push(...sueltas)
      continue
    }
    if (entera) {
      compromisos.push(construir(entidadId, nombre, orden, entera))
      continue
    }
    if (!encontrada) {
      // Tercer intento: una factura al año. No se mete antes porque cualquier
      // ritmo más corto es mejor prueba, y si lo hay ya se ha encontrado.
      const cadenas = confirmadosAnuales[entidadId] === true
        ? facturasPorDia(orden).slice(-1).map((f) => [f])
        : anualesDeDosVistas(orden, hoy)
      for (const cadena of cadenas) {
        const cobros = cadena.flatMap((f) => f.cobros)
        const importeEsperado = mediana(cadena.map((f) => f.total))
        const mes = cadena[cadena.length - 1].fecha.slice(5, 7)
        compromisos.push(construir(entidadId, nombre, cadena.map((f) => f.cobros[0]), 'anual', false, {
          importeEsperado,
          cobros: cobros.map((m) => m.id),
          // El mes entra en la identidad: los cuatro plazos del ayuntamiento
          // valen lo mismo, y sin el mes contestar por uno contestaría por los
          // cuatro.
          sufijo: `${Math.round(Math.abs(importeEsperado) / 100)}m${mes}`,
        }))
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
  /**
   * @param {string} entidadId
   * @param {string} nombre
   * @param {Movimiento[]} orden
   * @param {Compromiso['periodicidad']} periodicidad
   * @param {boolean} [separado]
   * @param {{ importeEsperado: number, cobros: string[], sufijo: string }} [factura]
   */
  function construir(entidadId, nombre, orden, periodicidad, separado = false, factura) {
    const periodo = PERIODOS.find((p) => p.nombre === periodicidad)
    const meses = periodo?.meses ?? 1
    const ultima = orden[orden.length - 1].fecha
    let proxima = sumarMeses(ultima, meses)
    // Si han pasado varios periodos sin aparecer, proyectar al siguiente futuro
    // para no anunciar un recibo con fecha del pasado. Pero unos días de
    // retraso siguen siendo el cobro de este periodo, no el del siguiente:
    // rodar un año entero porque el seguro llega tres días tarde esconde justo
    // el recibo que está a punto de caer.
    let saltos = 0
    while (proxima < hoy && diasEntre(proxima, hoy) > GRACIA[periodicidad] && saltos < 24) {
      proxima = sumarMeses(proxima, meses)
      saltos += 1
    }
    if (proxima < hoy) proxima = hoy
    const retraso = diasEntre(sumarMeses(ultima, meses), hoy)
    // Un recibo puede retrasarse; tres seguidos sin pasar no es retraso, es que
    // se acabó. Seguir contándolo hunde la previsión con un gasto que ya no
    // existe, y nadie debería tener que venir a avisar de cada cuota que
    // termina. Si vuelve a pasar, vuelve sola.
    const muerto = retraso > (periodo?.dias ?? 30) * 2 + (periodo?.margen ?? 7)
    const importeEsperado = factura ? factura.importeEsperado : importeEsperadoDe(orden)
    return {
      entidadId,
      // Dos recibos del mismo cobrador pueden no ser la misma cosa: la
      // aportación que uno puede saltarse y la letra del coche que no. Se
      // distinguen por el importe en euros enteros, que aguanta los céntimos
      // de un mes a otro sin confundir dos préstamos de importe parecido.
      reciboId: factura
        ? `${entidadId}#${factura.sufijo}`
        : separado ? `${entidadId}#${Math.round(Math.abs(importeEsperado) / 100)}` : entidadId,
      nombre,
      periodicidad,
      importeEsperado,
      ultimaVista: ultima,
      proximaPrevista: proxima,
      observaciones: orden.length,
      cobros: factura ? factura.cobros : orden.map((m) => m.id),
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
 * Un año: coge el ciclo entero —verano, navidades, seguros— sin arrastrar a
 * la persona que eras hace dos. Cero significa mirarlo todo.
 */
export const VENTANA_POR_DEFECTO = 12

/**
 * Ritmo diario de gasto ordinario, por mediana de los meses completos.
 * @param {Movimiento[]} ordinarios
 * @param {number} [ventana] cuántos meses hacia atrás
 * @returns {{ porDia: number, porMes: number, meses: number, disponibles: number }}
 */
export function ritmoOrdinario(ordinarios, ventana = VENTANA_POR_DEFECTO) {
  /** @type {Map<string, number>} */
  const porMes = new Map()
  for (const m of ordinarios) {
    const mes = m.fecha.slice(0, 7)
    porMes.set(mes, (porMes.get(mes) ?? 0) + m.importe)
  }
  const meses = [...porMes.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  // El mes en curso está a medias: contarlo hundiría la mediana.
  const completos = meses.slice(0, -1).map(([, v]) => v)
  const usados = ventana > 0 ? completos.slice(-ventana) : completos
  const tipico = mediana(usados)
  return {
    porDia: Math.round(tipico / 30.4),
    porMes: tipico,
    meses: usados.length,
    disponibles: completos.length,
  }
}
