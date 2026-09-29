// @ts-check
/**
 * Ensamblado: de una lista de movimientos crudos al estado que mira la interfaz.
 *
 * Este es el único sitio donde se juntan las piezas. Los módulos de `analisis`
 * no se conocen entre ellos y no saben nada de la interfaz; aquí se les pasa
 * lo que necesitan y se devuelve un objeto plano.
 */

import { detectarCompromisos, detectarIngresos, gastoOrdinario, loQueSeAnula, ritmoOrdinario } from './analisis/compromisos.js'
import { eventosDesde, proyectar } from './analisis/bajamar.js'
import { describirFijos, estructura, MESES_DE } from './analisis/fijos.js'
import { cascadaDelPeriodo } from './analisis/cascada.js'
import { cuotasPendientes } from './analisis/fraccionados.js'
import { disponibleReal } from './analisis/mes.js'
import { gastoPorCategoria, revisarPresupuestos } from './analisis/presupuestos.js'
import { cuadre as cuadrarPlan, ritmoDelPlan } from './analisis/plan.js'
import { cierresPorDia, detallarPeriodos, residuoDe } from './analisis/mensual.js'
import { cortesDeNomina, periodoDe, periodosEntre } from './analisis/periodos.js'
import { balance, evolucion } from './analisis/patrimonio.js'
import { capacidadDeAhorro } from './analisis/objetivos.js'
import { revisar } from './analisis/alertas.js'
import { hoyIso, diasEntre, mesDe, sumarMeses, ultimoDiaDelMes } from './dominio/tipos.js'
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
 * Y para el goteo, tampoco la tarjeta. Sus compras ya están fuera por venir del
 * extracto, y el cargo que las agrupa se proyecta solo con lo que hay pendiente
 * y las cuotas de lo aplazado. Contarlo aquí sería la tercera vez.
 */
const FUERA_DEL_GOTEO = new Set([...NO_ES_GASTO, 'tarjeta'])

/**
 * Lo que llega con recibo: si su categoría ya tiene una línea prevista con fecha
 * e importe, sus apuntes sueltos tampoco son goteo. El goteo es para lo que no
 * se sabe hasta que pasa, y un IBI se sabe.
 *
 * Se mira si está previsto de verdad, no se da por hecho: sacar del goteo un
 * gasto que nadie más prevé no lo ahorra, sólo lo esconde.
 */
const CON_RECIBO = new Set([
  'luz', 'agua', 'gas', 'telecom', 'impuestos', 'seguros', 'financiacion',
  'suscripciones', 'calefaccion',
])

/**
 * Cuando el concepto limpio es un número de cuenta, no hay comercio detrás:
 * es dinero que se mueve de un bolsillo propio a otro.
 */
const PARECE_CUENTA = /^\d{4}[- ]?\d{6,}$/

/** El banco liquida la tarjeta con un apunte propio en la cuenta. */
const LIQUIDACION_TARJETA = /TARJETA\s+(DE\s+)?CREDITO/i

/**
 * Las fechas en que va a entrar un ingreso recurrente, de aquí a un límite.
 *
 * Se sacan del compromiso y no de la proyección porque los periodos hacen
 * falta antes de proyectar: es el plan del periodo en curso el que decide el
 * ritmo con el que se proyecta.
 *
 * @param {{ proximaPrevista: string, periodicidad: string }} compromiso
 * @param {string} hasta
 */
function fechasPrevistas(compromiso, hasta) {
  const meses = { mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 }
  const paso = meses[compromiso.periodicidad] ?? 1
  const fechas = []
  let fecha = compromiso.proximaPrevista
  let vueltas = 0
  while (fecha <= hasta && vueltas < 24) {
    fechas.push({ fecha })
    fecha = sumarMeses(fecha, paso)
    vueltas += 1
  }
  return fechas
}

/** Hasta dónde mira la previsión larga. Un año es lo que tarda en volver un recibo anual. */
const HORIZONTE_LARGO = 12

/**
 * Un recibo dictado a mano vale lo mismo que uno detectado: no sale de ningún
 * movimiento porque no pasa por la cuenta, pero se cobra igual.
 * @param {import('./dominio/tipos.js').Manual[]} manuales
 * @param {string} hoy
 * @returns {Compromiso[]}
 */
function deManuales(manuales, hoy) {
  return manuales.map((m) => {
    const meses = MESES_DE[m.cada] ?? 1
    let proxima = m.proxima
    let vueltas = 0
    while (proxima < hoy && vueltas < 24) {
      proxima = sumarMeses(proxima, meses)
      vueltas += 1
    }
    return {
      entidadId: m.id,
      reciboId: m.id,
      nombre: m.nombre,
      periodicidad: m.cada,
      importeEsperado: m.importe,
      ultimaVista: sumarMeses(proxima, -meses),
      proximaPrevista: proxima,
      observaciones: 1,
      cobros: [],
      estado: /** @type {const} */ ('activo'),
    }
  })
}

/**
 * @param {Movimiento[]} crudos
 * @param {object} [opciones]
 * @param {string} [opciones.hoy]
 * @param {Bulto[]} [opciones.bultos]
 * @param {Record<string, string>} [opciones.categoriasManuales] entidadId → categoría
 * @param {string[]} [opciones.excepcionales] ids de movimientos marcados a mano
 * @param {Retoque[]} [opciones.retoques]
 * @param {Record<string, import('./analisis/plan.js').Plan>} [opciones.planes] mes → plan
 * @param {import('./analisis/patrimonio.js').Apunte[]} [opciones.patrimonio]
 * @param {Record<string, 'fijo' | 'suelto' | 'baja'>} [opciones.tratos] reciboId → cómo preverlo
 * @param {Record<string, string>} [opciones.apodos] reciboId → cómo lo llama el usuario
 * @param {Record<string, string>} [opciones.devueltos] reciboId → quién te lo devuelve
 * @param {Record<string, true>} [opciones.unicos] entidadId → pasó una vez y no volverá
 * @param {Record<string, true>} [opciones.anuales] entidadId → pasó una vez y vuelve cada año
 * @param {Record<string, string>} [opciones.ritmos] reciboId → cada cuánto llega, dicho por el usuario
 * @param {import('./dominio/tipos.js').Manual[]} [opciones.manuales] recibos que no pasan por la cuenta
 * @param {Record<string, true>} [opciones.apagadas] categoría → no toca esta temporada
 * @param {Record<string, boolean>} [opciones.inversiones] reciboId → es inversión, no gasto
 * @param {number} [opciones.colchon] céntimos por debajo de los cuales avisar
 * @param {number} [opciones.ventanaRitmo] meses que mira el goteo hacia atrás
 * @param {Record<string, true>} [opciones.saltados] reciboId|mes que este mes no se paga
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

  // Los recibos dictados a mano no salen de ningún movimiento, así que nadie les
  // ha puesto nombre ni categoría antes de llegar aquí.
  for (const m of opciones.manuales ?? []) {
    categorias.set(m.id, m.categoria)
    nombres.set(m.id, m.nombre)
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
  const deteccion = detectarCompromisos(cuenta, nombres, { hoy, categorias, anuales: opciones.anuales, ritmos: opciones.ritmos })
  // El apodo se pone aquí y no en cada vista: así el nombre que puso el usuario
  // viaja solo hasta los eventos, los avisos y los fijos.
  const apodos = opciones.apodos ?? {}
  const devueltos = opciones.devueltos ?? {}
  /**
   * Los cuatro plazos del IBI son un recibo troceado, no cuatro recibos: quien
   * bautiza uno bautiza los cuatro, y quien te devuelve uno te devuelve los
   * cuatro. Se reconocen por cobrador y precio, que es lo mismo que los
   * distinguió de los demás recibos del mismo día.
   * @param {Compromiso[]} lista
   */
  const apodar = (lista) => {
    /** @param {Record<string, string>} dicho */
    const heredar = (dicho) => {
      const dichos = lista.filter((c) => dicho[c.reciboId])
      return (/** @type {Compromiso} */ c) => {
        const propio = dicho[c.reciboId]
        if (propio) return propio
        const hermano = dichos.find((b) => (
          b.entidadId === c.entidadId
          && Math.abs(Math.abs(b.importeEsperado) - Math.abs(c.importeEsperado)) <= 5
        ))
        return hermano ? dicho[hermano.reciboId] : ''
      }
    }
    const nombreDe = heredar(apodos)
    const devueltoDe = heredar(devueltos)
    return lista.map((c) => {
      const nombre = nombreDe(c)
      const devuelto = devueltoDe(c)
      if (!nombre && !devuelto) return c
      return { ...c, ...(nombre ? { nombre } : {}), ...(devuelto ? { devuelto } : {}) }
    })
  }
  const compromisosTodos = apodar([...deteccion.compromisos, ...deManuales(opciones.manuales ?? [], hoy)])
  const ingresosTodos = apodar(detectarIngresos(cuenta, nombres, { hoy, categorias }))
  const tratos = porRecibo(
    opciones.tratos ?? {},
    [...compromisosTodos, ...ingresosTodos],
    new Set(deteccion.dudosos.map((d) => d.entidadId)),
  )
  const anulados = loQueSeAnula(compromisosTodos, ingresosTodos)
  const recibosPorId = new Map([...compromisosTodos, ...ingresosTodos].map((c) => [c.reciboId, c]))
  const deBaja = new Set([
    ...Object.keys(tratos).filter((id) => tratos[id] === 'baja'),
    // Un cobro y su devolución del mismo día se tratan como una baja: ni se
    // prevén ni sus apuntes cuentan como gasto del día a día.
    ...anulados,
  ])
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
  const cubiertas = new Set(
    compromisos
      .filter((c) => c.estado !== 'extinto')
      .map((c) => categorias.get(c.reciboId) ?? categorias.get(c.entidadId))
      .filter((cat) => cat !== undefined && CON_RECIBO.has(cat)),
  )
  // Se filtra por la misma clave que usa el reparto, no por la entidad, para que
  // las barras y el goteo no puedan discrepar sobre qué se está contando.
  const ordinarios = gastoOrdinario(
    cuenta.filter((m) => !cobrosDeBaja.has(m.id)),
    compromisos,
    new Set([...FUERA_DEL_GOTEO, ...cubiertas]),
    categorias,
  )
  // Apagar una categoría dice «esto no lo voy a volver a gastar», no «esto no lo
  // gasté»: sólo sale de lo que se prevé. Lo ya cobrado sigue siendo día a día.
  const habituales = ordinarios.filter((m) => !apagadas[m.categoria ?? 'otros'])
  const ritmo = ritmoOrdinario(habituales, opciones.ventanaRitmo)

  const ultimaFecha = cuenta.reduce((mayor, m) => (m.fecha > mayor ? m.fecha : mayor), cuenta[0]?.fecha ?? '')
  const ultimo = cuenta.findLast((m) => m.fecha === ultimaFecha)
  const saldoInicial = cierresPorDia([...cuenta].sort((a, b) => a.fecha.localeCompare(b.fecha))).get(ultimaFecha) ?? 0

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
  // La liquidación pendiente ya trae la cuota de este mes; las que faltan son
  // las de los meses siguientes, que no están escritas en ninguna parte.
  // Con todos los movimientos, no sólo los de cuenta: la cuota de verdad, con
  // sus intereses, sólo está escrita en el extracto de la tarjeta.
  const plazos = cuotasPendientes(movimientos, cargoTarjeta?.fecha ?? hoy)
  const saltados = opciones.saltados ?? {}
  const armar = (/** @type {string} */ fin) => eventosDesde({
    compromisos: vivos,
    ingresos,
    bultos: opciones.bultos ?? [],
    tarjeta: cargoTarjeta,
    plazos,
    desde: hoy,
    hasta: fin,
  })
    // Saltarse un mes no es darse de baja: sólo cae ese cobro, el resto sigue.
    .filter((e) => !(e.reciboId && saltados[`${e.reciboId}|${e.fecha.slice(0, 7)}`]))
    .map((e) => ({ ...e, aplazable: e.reciboId ? aplazables.has(e.reciboId) : false }))

  const hasta = ultimoDiaDelMes(sumarMeses(hoy, (opciones.meses ?? 2) - 1))
  const finLargo = ultimoDiaDelMes(sumarMeses(hoy, HORIZONTE_LARGO - 1))

  /*
   * Quién corta el mes: la nómina. Un mes va de una nómina a la siguiente, así
   * que no hay nada que desplazar ni que reasignar —lo que cae entre sus dos
   * bordes es suyo—. Si no hay nada etiquetado como nómina se toma el mayor
   * ingreso que vuelva, y si no hay ninguno se cuenta por meses naturales.
   */
  const nominas = ingresos.filter((i) => categorias.get(i.entidadId ?? '') === 'nomina')
  const mayorIngreso = ingresos.reduce(
    (mejor, i) => (Math.abs(i.importeEsperado) > Math.abs(mejor?.importeEsperado ?? 0) ? i : mejor),
    /** @type {typeof ingresos[number] | null} */ (null),
  )
  const cortan = nominas.length > 0 ? nominas : mayorIngreso ? [mayorIngreso] : []
  const idsQueCortan = new Set(cortan.map((i) => i.entidadId).filter((id) => typeof id === 'string'))

  const periodos = periodosEntre({
    cortes: cortesDeNomina({
      cobradas: cuenta.filter((m) => m.importe > 0 && m.entidadId && idsQueCortan.has(m.entidadId)),
      previstas: cortan.flatMap((i) => fechasPrevistas(i, finLargo)),
    }),
    desde: cuenta[0]?.fecha ?? hoy,
    hasta: finLargo,
  })
  const enCurso = periodoDe(periodos, hoy) ?? periodos[periodos.length - 1]

  /*
   * El día a día deja de ser una medida y pasa a ser una decisión. Si hay plan
   * para el periodo en curso, el ritmo sale de él; si no, del histórico, que
   * sigue siendo la respuesta correcta mientras no hayas decidido nada.
   */
  const planes = opciones.planes ?? {}
  const plan = planes[enCurso?.id ?? ''] ?? null
  const gastadoPorCategoria = Object.fromEntries(
    [...gastoPorCategoria(
      { movimientos: cuenta.filter((m) => enCurso && m.fecha >= enCurso.desde && m.fecha <= enCurso.hasta) },
      NO_ES_GASTO,
    )],
  )
  const finDelPeriodo = enCurso?.hasta ?? ultimoDiaDelMes(hoy)
  const gastadoDiaADia = ordinarios.reduce(
    (t, m) => (enCurso && m.fecha >= enCurso.desde && m.fecha <= enCurso.hasta ? t + m.importe : t),
    0,
  )
  const ritmoEfectivo = ritmoDelPlan({ plan, gastado: gastadoPorCategoria, hoy, hasta: finDelPeriodo })
    ?? loQueQuedaDelMes({ habitualPorMes: ritmo.porMes, gastado: gastadoDiaADia, hoy, hasta: finDelPeriodo })

  // El plan manda dentro de su periodo y ni un día más. Su ritmo es «lo que
  // queda entre los días que quedan», así que extenderlo a doce meses daría
  // cifras absurdas: el último día sería el presupuesto entero en una jornada.
  const gota = (/** @type {string} */ fecha) =>
    (fecha <= finDelPeriodo ? ritmoEfectivo.porDia : ritmo.porDia)

  const proyeccion = proyectar({ saldoInicial, desde: hoy, hasta, eventos: armar(hasta), ritmoPorDia: gota })
  const proyeccionLarga = proyectar({ saldoInicial, desde: hoy, hasta: finLargo, eventos: armar(finLargo), ritmoPorDia: gota })

  // El mismo periodo, suponiendo que se salta todo lo que se puede saltar. No
  // es una previsión alternativa: es la medida de cuánto margen tienes.
  const holgado = aplazables.size === 0 ? null : proyectar({
    saldoInicial,
    desde: hoy,
    hasta,
    eventos: proyeccion.eventos.filter((e) => !e.aplazable),
    ritmoPorDia: gota,
  })
  const margen = holgado === null ? null : {
    suelo: holgado.suelo,
    gana: holgado.suelo.saldo - proyeccion.suelo.saldo,
  }

  const fijos = describirFijos(vivos, cuenta, categorias)
    .map((f) => ({ ...f, aplazable: aplazables.has(f.reciboId) }))
  const costes = estructura(fijos)
  const aplazableAlMes = fijos.reduce((t, f) => (f.aplazable ? t + f.mensualEquivalente : t), 0)

  /*
   * Cada periodo, contado entero: lo vivido del extracto, lo que falta de la
   * previsión, y su plan al lado para poder comparar lo que decidiste con lo
   * que llevas gastado.
   */
  const detalleCrudo = detallarPeriodos({
    periodos,
    movimientos: cuenta,
    proyeccion: proyeccionLarga,
    // Qué apuntes son día a día ya lo sabe gastoOrdinario: lo demás sale con
    // fecha. Preguntárselo a él evita tener dos ideas de qué es un recibo.
    ordinarios: new Set(ordinarios.map((m) => m.id)),
    hoy,
  })
  const detalleMensual = detalleCrudo.map((p) => ({
    ...p,
    plan: planes[p.id] ?? null,
    lineas: revisarPresupuestos({
      periodos: detalleCrudo,
      periodo: p,
      noEsGasto: NO_ES_GASTO,
      asignado: planes[p.id]?.asignado ?? {},
    }),
  }))

  // Lo que queda libre de aquí a que acabe el periodo. El saldo del banco ya
  // incluye todo lo pasado, así que se le suma sólo lo que falta por pasar.
  const disponible = disponibleReal({
    saldo: saldoInicial,
    eventos: proyeccion.eventos,
    ritmoPorDia: ritmoEfectivo.porDia,
    hoy,
    hasta: finDelPeriodo,
  })

  const periodoActual = detalleMensual.find((p) => p.id === enCurso?.id)
    ?? detalleMensual[detalleMensual.length - 1]
  // Lo que queda para el día a día del periodo entero. Es la cifra con la que
  // se reparte, y se decide al empezar el periodo, no día a día.
  const residuo = periodoActual ? residuoDe(periodoActual) : 0
  const cuadre = cuadrarPlan({ plan, residuo })

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
    devueltos,
    unicos,
    anuales: opciones.anuales ?? {},
    ritmos: opciones.ritmos ?? {},
    // Lo apartado se busca en la detección sin filtrar: es la única que aún
    // sabe cómo se llamaba y cuánto costaba lo que el usuario dio de baja.
    apartados: [
      // De un par que se anula sólo se enseña el cargo: la devolución al lado
      // sería la misma línea dos veces y ninguna de las dos se entendería.
      ...[...deBaja].filter((id) => !anulados.has(id) || (recibosPorId.get(id)?.importeEsperado ?? 0) < 0).map((id) => {
        const recibo = recibosPorId.get(id)
        return {
          reciboId: id,
          nombre: recibo?.nombre ?? nombres.get(id.split('#')[0]) ?? id,
          importe: recibo?.importeEsperado ?? 0,
          motivo: /** @type {'baja' | 'extinto' | 'anulado'} */ (anulados.has(id) ? 'anulado' : 'baja'),
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
        motivo: /** @type {'baja' | 'extinto' | 'anulado'} */ ('extinto'),
        ultima: c.ultimaVista,
        trato: tratos[c.reciboId],
      })),
    ].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    margen,
    sinClasificar: sinCajon(contables, nombres),
    aplazableAlMes,
    ingresoMensual,
    ordinarios: habituales,
    // `ritmo` es lo que sueles gastar; `ritmoEfectivo` es lo que has decidido
    // gastar. Se devuelven los dos porque la interfaz enseña la distancia.
    ritmo,
    ritmoEfectivo,
    plan,
    planes,
    residuo,
    cuadre,
    detalleMensual,
    periodos,
    periodoActual,
    reparto: repartirGasto(habituales, ritmo),
    apagadas: Object.keys(apagadas).sort(),
    saldoInicial,
    pendienteTarjeta,
    proyeccion,
    proyeccionLarga,
    fijos,
    costes,
    cascada: cascadaDelPeriodo({
      periodo: enCurso ?? { id: mesDe(hoy), desde: hoy, hasta: finDelPeriodo, completo: false, natural: true },
      fijos,
      // Las cifras son las del periodo, no medianas: la cascada explica este
      // mes, y si explicara uno promedio no cuadraría con el resumen ni con
      // la gráfica, que sí miran éste.
      conFecha: periodoActual?.desglose.conFecha ?? [],
      apertura: periodoActual?.apertura ?? saldoInicial,
      ingreso: periodoActual?.ingresos.total ?? ingresoMensual,
      diaADia: periodoActual?.diaADia ?? ritmo.porDia * 30,
      inversiones: opciones.inversiones,
      plazos,
      saltados,
    }),
    plazos,
    inversiones: opciones.inversiones ?? {},
    presupuestos: periodoActual?.lineas ?? [],
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
      presupuestos: periodoActual?.lineas ?? [],
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

/**
 * El ritmo de lo que queda de periodo cuando todavía no has repartido nada.
 *
 * Gotear la mediana diaria hasta el final salía barato de más: el periodo en
 * curso acababa previendo menos gasto que un mes normal, porque los días ya
 * vividos no descontaban de nada. Lo que se sabe es cuánto sale en un mes
 * entero; lo ya gastado lo consume y el resto se reparte entre los días que
 * faltan, que es lo mismo que hace un plan.
 *
 * Como con un plan, pasarse no devuelve dinero: si ya te has ido por encima
 * de tu mes normal, lo que queda por prever es cero.
 *
 * @param {object} entrada
 * @param {number} entrada.habitualPorMes  céntimos negativos
 * @param {number} entrada.gastado         céntimos negativos, lo que llevas
 * @param {string} entrada.hoy
 * @param {string} entrada.hasta
 * @returns {{ porDia: number, porMes: number, restante: number }}
 */
function loQueQuedaDelMes({ habitualPorMes, gastado, hoy, hasta }) {
  const restante = Math.max(Math.abs(habitualPorMes) - Math.abs(gastado), 0)
  const dias = Math.max(diasEntre(hoy, hasta), 0)
  return { restante, porMes: -restante, porDia: dias === 0 ? 0 : -Math.round(restante / dias) }
}
