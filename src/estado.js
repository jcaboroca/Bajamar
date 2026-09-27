// @ts-check
/**
 * Ensamblado: de una lista de movimientos crudos al estado que mira la interfaz.
 *
 * Este es el único sitio donde se juntan las piezas. Los módulos de `analisis`
 * no se conocen entre ellos y no saben nada de la interfaz; aquí se les pasa
 * lo que necesitan y se devuelve un objeto plano.
 */

import { detectarCompromisos, detectarIngresos, gastoOrdinario, ritmoOrdinario } from './analisis/compromisos.js'
import { eventosDesde, proyectar } from './analisis/bajamar.js'
import { describirFijos, estructura } from './analisis/fijos.js'
import { cascadaDelMes, mesEnCurso as mesQuePagaLaNomina } from './analisis/cascada.js'
import { conGotaDiaria, disponibleReal, porMeses, resumenDeMes } from './analisis/mes.js'
import { revisarPresupuestos } from './analisis/presupuestos.js'
import { balance, evolucion } from './analisis/patrimonio.js'
import { capacidadDeAhorro } from './analisis/objetivos.js'
import { revisar } from './analisis/alertas.js'
import { hoyIso, mesDe, sumarMeses, ultimoDiaDelMes } from './dominio/tipos.js'
import { limpiarConcepto } from './entidades/limpiar.js'
import { indicePorAlias, reconciliar } from './entidades/reconciliar.js'
import { CATEGORIAS } from './entidades/semillas.js'
import { PISTAS, oficioDe } from './entidades/oficios.js'
import { repartirGasto } from './analisis/reparto.js'

/**
 * @typedef {import('./dominio/tipos.js').Movimiento} Movimiento
 * @typedef {import('./dominio/tipos.js').Bulto} Bulto
 * @typedef {import('./dominio/tipos.js').Retoque} Retoque
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

/** Hasta dónde mira la previsión larga. Un año es lo que tarda en volver un recibo anual. */
const HORIZONTE_LARGO = 12

/**
 * @param {Movimiento[]} crudos
 * @param {object} [opciones]
 * @param {string} [opciones.hoy]
 * @param {Bulto[]} [opciones.bultos]
 * @param {Record<string, string>} [opciones.categoriasManuales] entidadId → categoría
 * @param {string[]} [opciones.excepcionales] ids de movimientos marcados a mano
 * @param {Retoque[]} [opciones.retoques]
 * @param {import('./analisis/presupuestos.js').Presupuesto[]} [opciones.presupuestos]
 * @param {import('./analisis/patrimonio.js').Apunte[]} [opciones.patrimonio]
 * @param {Record<string, 'fijo' | 'suelto' | 'baja'>} [opciones.tratos] reciboId → cómo preverlo
 * @param {Record<string, string>} [opciones.apodos] reciboId → cómo lo llama el usuario
 * @param {Record<string, true>} [opciones.unicos] entidadId → pasó una vez y no volverá
 * @param {Record<string, true>} [opciones.anuales] entidadId → pasó una vez y vuelve cada año
 * @param {Record<string, true>} [opciones.apagadas] categoría → no toca esta temporada
 * @param {Record<string, boolean>} [opciones.inversiones] reciboId → es inversión, no gasto
 * @param {number} [opciones.colchon] céntimos por debajo de los cuales avisar
 * @param {number} [opciones.meses] meses que abarca la proyección de portada
 */
export function construirEstado(crudos, opciones = {}) {
  const hoy = opciones.hoy ?? hoyIso()
  const excepcionales = new Set(opciones.excepcionales ?? [])
  const unicos = opciones.unicos ?? {}
  const retoques = new Map((opciones.retoques ?? []).map((r) => [r.id, r]))

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
    if (entidadId && (categorias.get(entidadId) ?? 'otros') === 'otros') {
      // Por orden de fiabilidad, y ninguna pisa una semilla ni una regla del
      // usuario. Lo último es «va a nombre de alguien»: eso lo dice un Bizum,
      // pero también una transferencia al taller, y el taller se llama taller.
      const puesta = (pista && CATEGORIAS[pista] ? pista : null)
        ?? (PARECE_CUENTA.test(nombre) ? 'traspaso' : null)
        ?? oficioDe(nombre)
        ?? (pista ? PISTAS[pista] : null)
      if (puesta) categorias.set(entidadId, puesta)
    }
    const retoque = retoques.get(m.id)
    // Un retoque habla de este apunte y sólo de este. Para que valga también
    // para los siguientes del mismo comercio está la regla por entidad.
    const categoria = retoque?.traspaso
      ? 'traspaso'
      : retoque?.categoria ?? (entidadId ? categorias.get(entidadId) ?? 'otros' : 'otros')
    return {
      ...m,
      entidadId,
      categoria,
      nota: retoque?.nota,
      excluido: retoque?.excluido === true,
      localidad: m.localidad ?? localidad,
      excepcional: excepcionales.has(m.id)
        || retoque?.excluido === true
        || (entidadId !== null && unicos[entidadId] === true),
    }
  })

  const contables = movimientos.filter((m) => !m.excluido)
  const cuenta = contables.filter((m) => m.origen === 'cuenta')
  const tarjeta = contables.filter((m) => m.origen === 'tarjeta')

  // Un traspaso al ahorro propio no es gasto, pero sí sale de la cuenta: tiene
  // que entrar en la proyección aunque no cuente como dinero quemado. Por eso
  // no se excluye aquí, sino más abajo al medir el gasto.
  /*
   * Detectar que algo se repite no es lo mismo que saber que va a volver. Una
   * cuenta que se cierra o una compañía que se cambia siguen teniendo un
   * pasado impecablemente regular, y la previsión los seguiría cobrando para
   * siempre. Sólo el usuario sabe eso, y lo dice de dos maneras distintas.
   *
   * «Ya no lo pago» (baja) lo borra del futuro por completo, y además saca su
   * historia del ritmo diario: si contáramos los recibos viejos de la luz, el
   * goteo seguiría cobrándolos con otro nombre.
   *
   * «Me lo puedo saltar» (suelto) no lo quita de nada. Una inversión mensual o
   * un gimnasio salen de la cuenta casi todos los meses: esconderlos dejaría
   * un suelo falsamente tranquilo. Lo que cambia es que se puede medir cuánto
   * margen dan si el mes viene apretado, que es la pregunta de verdad.
   *
   * Todo esto va por RECIBO, no por cobrador: del mismo banco pueden salir la
   * aportación que uno se salta y la letra de la furgoneta que no.
   */
  const deteccion = detectarCompromisos(cuenta, nombres, { hoy, categorias, anuales: opciones.anuales })
  // El apodo se pone aquí y no en cada vista: así el nombre que puso el usuario
  // viaja solo hasta los eventos, los avisos y los fijos.
  const apodos = opciones.apodos ?? {}
  const apodar = (/** @type {Compromiso} */ c) => (
    apodos[c.reciboId] ? { ...c, nombre: apodos[c.reciboId] } : c
  )
  const compromisosTodos = deteccion.compromisos.map(apodar)
  const ingresosTodos = detectarIngresos(cuenta, nombres, { hoy, categorias }).map(apodar)
  const tratos = porRecibo(
    opciones.tratos ?? {},
    [...compromisosTodos, ...ingresosTodos],
    new Set(deteccion.dudosos.map((d) => d.entidadId)),
  )
  const deBaja = new Set(Object.keys(tratos).filter((id) => tratos[id] === 'baja'))
  const aplazables = new Set(Object.keys(tratos).filter((id) => tratos[id] === 'suelto'))

  const compromisos = compromisosTodos.filter((c) => !deBaja.has(c.reciboId))
  const dudosos = deteccion.dudosos.filter((d) => !deBaja.has(d.entidadId))
  const ingresos = ingresosTodos.filter((c) => !deBaja.has(c.reciboId))
  // Lo que se dio de baja tampoco cuenta como gasto del día a día: era un
  // compromiso que terminó. Se quitan sus cobros, no todo lo del cobrador, que
  // bajo el mismo nombre puede seguir cobrando otras cosas.
  const cobrosDeBaja = new Set(
    [...compromisosTodos, ...ingresosTodos]
      .filter((c) => deBaja.has(c.reciboId))
      .flatMap((c) => c.cobros),
  )
  const apagadas = opciones.apagadas ?? {}
  // Se filtra por la misma clave que usa el reparto, no por la entidad, para que
  // las barras y el goteo no puedan discrepar sobre qué se está contando.
  const ordinarios = gastoOrdinario(
    cuenta.filter((m) => !cobrosDeBaja.has(m.id)),
    compromisos,
    NO_ES_GASTO,
    categorias,
  ).filter((m) => !apagadas[m.categoria ?? 'otros'])
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

  const vivos = compromisos.filter((c) => c.estado !== 'extinto' && c !== liquidacion)
  const armar = (/** @type {string} */ fin) => eventosDesde({
    compromisos: vivos,
    ingresos,
    bultos: opciones.bultos ?? [],
    tarjeta: cargoTarjeta,
    desde: hoy,
    hasta: fin,
  }).map((e) => ({ ...e, aplazable: e.reciboId ? aplazables.has(e.reciboId) : false }))

  const hasta = ultimoDiaDelMes(sumarMeses(hoy, (opciones.meses ?? 2) - 1))
  const finLargo = ultimoDiaDelMes(sumarMeses(hoy, HORIZONTE_LARGO - 1))

  const proyeccion = proyectar({ saldoInicial, desde: hoy, hasta, eventos: armar(hasta), ritmoPorDia: ritmo.porDia })
  const proyeccionLarga = proyectar({ saldoInicial, desde: hoy, hasta: finLargo, eventos: armar(finLargo), ritmoPorDia: ritmo.porDia })

  // El mismo periodo, suponiendo que se salta todo lo que se puede saltar. No
  // es una previsión alternativa: es la medida de cuánto margen tienes.
  const holgado = aplazables.size === 0 ? null : proyectar({
    saldoInicial,
    desde: hoy,
    hasta,
    eventos: proyeccion.eventos.filter((e) => !e.aplazable),
    ritmoPorDia: ritmo.porDia,
  })
  const margen = holgado === null ? null : {
    suelo: holgado.suelo,
    gana: holgado.suelo.saldo - proyeccion.suelo.saldo,
  }

  const fijos = describirFijos(vivos, cuenta, categorias)
    .map((f) => ({ ...f, aplazable: aplazables.has(f.reciboId) }))
  const costes = estructura(fijos)
  const aplazableAlMes = fijos.reduce((t, f) => (f.aplazable ? t + f.mensualEquivalente : t), 0)

  const presupuestos = revisarPresupuestos({
    movimientos: contables,
    categorias,
    noEsGasto: NO_ES_GASTO,
    presupuestos: opciones.presupuestos ?? [],
    hoy,
  })

  const mesEnCurso = conGotaDiaria(
    resumenDeMes({
      movimientos: contables,
      categorias,
      noEsGasto: NO_ES_GASTO,
      eventos: proyeccion.eventos,
      mes: mesDe(hoy),
      hoy,
    }),
    ritmo.porDia,
    hoy,
  )

  const disponible = disponibleReal({
    saldo: saldoInicial,
    eventos: proyeccion.eventos,
    ritmoPorDia: ritmo.porDia,
    hoy,
    hasta: ultimoDiaDelMes(hoy),
  })

  /*
   * La proyección empieza hoy, así que del mes en curso sólo contiene los días
   * que quedan. Enseñar eso como si fuera el mes entero es mentir por omisión:
   * un día 28 la nómina ya cobrada desaparecería y el mes parecería ruinoso.
   * Los totales del primer mes salen de lo que de verdad ha pasado más lo que
   * queda; el suelo y el saldo final sí vienen de la proyección, porque mirar
   * hacia atrás buscando un mínimo no sirve de nada.
   */
  const meses = porMeses(proyeccionLarga)
  if (meses[0] && meses[0].mes === mesDe(hoy)) {
    meses[0] = {
      ...meses[0],
      ingresos: mesEnCurso.ingresos.total,
      gastos: mesEnCurso.gastos.total,
      ahorro: mesEnCurso.ahorro,
    }
  }

  const ingresoMensual = ingresos
    .filter((i) => i.periodicidad === 'mensual')
    .reduce((t, i) => t + i.importeEsperado, 0)

  const capacidad = capacidadDeAhorro({
    ingresos: ingresoMensual,
    fijos: costes.costeMensual,
    ordinario: ritmo.porMes,
    reserva: costes.reservaMensual,
  })

  // El saldo del banco es patrimonio aunque nadie lo haya anotado: dejarlo
  // fuera obligaría a teclear a mano un número que la aplicación ya sabe.
  //
  // La fecha nunca puede ir por delante de hoy. Los extractos traen apuntes con
  // fecha valor posterior, y un apunte fechado mañana no cuenta como vigente:
  // el patrimonio saldría cero justo cuando acaba de importarse todo.
  const fechaSaldo = ultimo && ultimo.fecha < hoy ? ultimo.fecha : hoy
  const apuntes = [
    ...(saldoInicial !== 0
      ? [{
          id: 'auto:cuenta',
          nombre: 'Cuenta corriente',
          grupo: /** @type {const} */ ('cuentas'),
          valor: saldoInicial,
          fecha: fechaSaldo,
        }]
      : []),
    ...(opciones.patrimonio ?? []),
  ]

  return {
    hoy,
    movimientos,
    entidades,
    categorias,
    nombres,
    compromisos,
    dudosos,
    ingresos,
    tratos,
    apodos,
    unicos,
    anuales: opciones.anuales ?? {},
    // Lo apartado se busca en la detección sin filtrar: es la única que aún
    // sabe cómo se llamaba y cuánto costaba lo que el usuario dio de baja.
    apartados: [
      ...[...deBaja].map((id) => {
        const recibo = [...compromisosTodos, ...ingresosTodos].find((c) => c.reciboId === id)
        return {
          reciboId: id,
          nombre: recibo?.nombre ?? nombres.get(id.split('#')[0]) ?? id,
          importe: recibo?.importeEsperado ?? 0,
          motivo: /** @type {'baja' | 'extinto'} */ ('baja'),
          ultima: recibo?.ultimaVista ?? '',
          trato: tratos[id],
        }
      }),
      // Los que se apagaron solos van aquí y no en otra lista: para quien mira,
      // «esto ya no cuenta» es lo mismo lo decida él o lo decidan los hechos.
      ...compromisos.filter((c) => c.estado === 'extinto').map((c) => ({
        reciboId: c.reciboId,
        nombre: c.nombre,
        importe: c.importeEsperado,
        motivo: /** @type {'baja' | 'extinto'} */ ('extinto'),
        ultima: c.ultimaVista,
        trato: tratos[c.reciboId],
      })),
    ].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    margen,
    sinClasificar: sinCajon(contables, nombres),
    aplazableAlMes,
    ingresoMensual,
    ordinarios,
    ritmo,
    reparto: repartirGasto(ordinarios, ritmo),
    apagadas: Object.keys(apagadas).sort(),
    saldoInicial,
    pendienteTarjeta,
    proyeccion,
    proyeccionLarga,
    meses,
    fijos,
    costes,
    cascada: cascadaDelMes({
      mes: mesQuePagaLaNomina(hoy),
      fijos,
      ingreso: ingresoMensual,
      // Por días y no la media mensual: si no, la cascada y la proyección dan
      // cifras distintas del mismo mes y una de las dos miente.
      diaADia: ritmo.porDia * Number(ultimoDiaDelMes(`${mesQuePagaLaNomina(hoy)}-01`).slice(8)),
      inversiones: opciones.inversiones,
    }),
    inversiones: opciones.inversiones ?? {},
    presupuestos,
    mesEnCurso,
    disponible,
    capacidad,
    patrimonio: balance(apuntes, hoy),
    evolucionPatrimonio: evolucion(apuntes, hoy),
    avisos: revisar({
      proyeccion,
      fijos,
      ingresos,
      movimientos: contables,
      nombres,
      presupuestos,
      colchon: opciones.colchon ?? 0,
      hoy,
    }),
  }
}

/**
 * A quién le pagamos sin saber en qué cajón va, de más a menos dinero.
 * Mientras esto pese, cualquier reparto del gasto por categorías es a medias.
 * @param {Movimiento[]} movimientos
 * @param {Map<string, string>} nombres
 */
function sinCajon(movimientos, nombres) {
  /** @type {Map<string, { total: number, cuantos: number, ultima: string }>} */
  const acumulado = new Map()
  for (const m of movimientos) {
    if (m.importe >= 0 || m.origen === 'tarjeta') continue
    if ((m.categoria ?? 'otros') !== 'otros' || !m.entidadId) continue
    const previo = acumulado.get(m.entidadId) ?? { total: 0, cuantos: 0, ultima: '' }
    acumulado.set(m.entidadId, {
      total: previo.total + m.importe,
      cuantos: previo.cuantos + 1,
      ultima: m.fecha > previo.ultima ? m.fecha : previo.ultima,
    })
  }
  return [...acumulado.entries()]
    .map(([entidadId, v]) => ({ entidadId, nombre: nombres.get(entidadId) ?? entidadId, ...v }))
    .sort((a, b) => a.total - b.total)
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
    if (m.importe >= 0 || m.origen === 'tarjeta' || m.excluido) continue
    const categoria = m.categoria ?? (m.entidadId ? categorias.get(m.entidadId) : null) ?? 'otros'
    if (NO_ES_GASTO.has(categoria)) continue
    const previo = acumulado.get(categoria) ?? { total: 0, cuantos: 0 }
    acumulado.set(categoria, { total: previo.total + m.importe, cuantos: previo.cuantos + 1 })
  }
  return [...acumulado.entries()]
    .map(([id, v]) => ({ id, nombre: CATEGORIAS[id] ?? id, ...v }))
    .sort((a, b) => a.total - b.total)
}

/**
 * Las primeras respuestas se guardaron por cobrador, cuando un cobrador era un
 * recibo. Al separar los recibos, esas claves se quedarían huérfanas y el
 * usuario perdería en silencio lo que ya había contestado. Se adoptan sólo
 * cuando no hay duda de a cuál se referían.
 * @param {Record<string, 'fijo' | 'suelto' | 'baja'>} guardados
 * @param {import('./dominio/tipos.js').Compromiso[]} recibos
 * @param {Set<string>} dudosos  aún no son recibos, pero también se contestan
 * @returns {Record<string, 'fijo' | 'suelto' | 'baja'>}
 */
function porRecibo(guardados, recibos, dudosos) {
  const vivos = new Set(recibos.map((c) => c.reciboId))
  /** @type {Record<string, 'fijo' | 'suelto' | 'baja'>} */
  const puestos = {}
  for (const [clave, trato] of Object.entries(guardados)) {
    if (vivos.has(clave) || dudosos.has(clave)) {
      puestos[clave] = trato
      continue
    }
    const suyos = recibos.filter((c) => c.entidadId === clave)
    if (suyos.length === 1) puestos[suyos[0].reciboId] = trato
  }
  return puestos
}
