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
import { cuotasPendientes } from './analisis/fraccionados.js'
import { conGotaDiaria, disponibleReal, mesContable, mesDeUnMovimiento, porMeses, resumenDeMes } from './analisis/mes.js'
import { gastoPorCategoriaYMes, revisarPresupuestos } from './analisis/presupuestos.js'
import { cuadre as cuadrarPlan, residuoDelMes, ritmoDelPlan } from './analisis/plan.js'
import { curvaDelMes, detallarMeses, estaAcabado, residuoDe } from './analisis/mensual.js'
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
 * @param {Record<string, import('./analisis/plan.js').Plan>} [opciones.planes] mes → plan
 * @param {import('./analisis/patrimonio.js').Apunte[]} [opciones.patrimonio]
 * @param {Record<string, 'fijo' | 'suelto' | 'baja'>} [opciones.tratos] reciboId → cómo preverlo
 * @param {Record<string, string>} [opciones.apodos] reciboId → cómo lo llama el usuario
 * @param {Record<string, true>} [opciones.unicos] entidadId → pasó una vez y no volverá
 * @param {Record<string, true>} [opciones.anuales] entidadId → pasó una vez y vuelve cada año
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
  ).filter((m) => !apagadas[m.categoria ?? 'otros'])
  const ritmo = ritmoOrdinario(ordinarios, opciones.ventanaRitmo)

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
   * El día a día deja de ser una medida y pasa a ser una decisión. Si hay plan
   * para el mes natural en curso, el ritmo sale de él; si no, del histórico
   * como hasta ahora, que sigue siendo la respuesta correcta mientras no hayas
   * decidido nada.
   *
   * El residuo es `disponibleReal` sin el goteo. Tenía que ser exactamente el
   * mismo número que sale en portada, o habría dos respuestas para «cuánto me
   * queda». Y como lo ya gastado está dentro del saldo del banco, no hay que
   * descontarlo: recortar el día 15 se recalcula solo sobre los días que faltan.
   */
  const finDeMes = ultimoDiaDelMes(hoy)
  const residuo = residuoDelMes({ saldo: saldoInicial, eventos: armar(finDeMes), hoy, hasta: finDeMes })
  const planes = opciones.planes ?? {}
  const plan = planes[mesDe(hoy)] ?? null
  const gastadoPorCategoria = Object.fromEntries(
    [...gastoPorCategoriaYMes(contables, categorias, NO_ES_GASTO)]
      .map(([id, meses]) => [id, Math.abs(meses.get(mesDe(hoy)) ?? 0)]),
  )
  const ritmoEfectivo = ritmoDelPlan({ plan, gastado: gastadoPorCategoria, hoy, hasta: finDeMes }) ?? ritmo
  const cuadre = cuadrarPlan({ plan, residuo })

  // El plan manda dentro de su mes y ni un día más. Su ritmo es «lo que queda
  // entre los días que quedan», así que extenderlo a doce meses daría cifras
  // absurdas: un día 30 sería el presupuesto entero repartido en un solo día.
  // A partir de fin de mes vuelve a mandar lo que sueles gastar.
  const gota = (/** @type {string} */ fecha) =>
    (fecha <= finDeMes ? ritmoEfectivo.porDia : ritmo.porDia)

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

  const presupuestos = revisarPresupuestos({
    movimientos: contables,
    categorias,
    noEsGasto: NO_ES_GASTO,
    asignado: plan?.asignado ?? {},
    hoy,
  })

  /*
   * Quién abre mes: la nómina, y nada más.
   *
   * No vale con «es un ingreso que se repite». Una bonificación del banco de
   * 60 € el día 24 se repite todos los meses igual que la nómina, y sin
   * embargo paga el mes en que cae, no el siguiente. Lo que abre un mes es lo
   * que lo financia entero.
   *
   * Y si no hay nada etiquetado como nómina, se toma el mayor ingreso que
   * vuelva. Es la red: sin ella, un cobro que la aplicación no ha sabido
   * etiquetar dejaba el mes siguiente sin ingresos y sin decir por qué.
   */
  const nominas = ingresos.filter((i) => categorias.get(i.entidadId ?? '') === 'nomina')
  const mayorIngreso = ingresos.reduce(
    (mejor, i) => (Math.abs(i.importeEsperado) > Math.abs(mejor?.importeEsperado ?? 0) ? i : mejor),
    /** @type {typeof ingresos[number] | null} */ (null),
  )
  const abrenMes = new Set(
    (nominas.length > 0 ? nominas : mayorIngreso ? [mayorIngreso] : [])
      .map((i) => i.entidadId)
      .filter((id) => typeof id === 'string'),
  )

  const mesEnCurso = conGotaDiaria(
    resumenDeMes({
      movimientos: contables,
      categorias,
      noEsGasto: NO_ES_GASTO,
      eventos: proyeccion.eventos,
      mes: mesDe(hoy),
      hoy,
      abrenMes,
    }),
    ritmoEfectivo.porDia,
    hoy,
  )

  const disponible = disponibleReal({
    saldo: saldoInicial,
    eventos: proyeccion.eventos,
    ritmoPorDia: ritmoEfectivo.porDia,
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
  const meses = porMeses(proyeccionLarga, abrenMes)

  /*
   * Y la misma tabla sin mover nada: la cuenta tal cual, con cada cobro en el
   * mes en que cae. El desplazamiento de la nómina sirve para leer un mes por
   * dentro —cuánto tengo para vivir octubre— pero estorba para mirar la cuenta
   * de lejos, donde lo que se quiere ver es cuándo entra y sale el dinero de
   * verdad. Son dos preguntas y necesitan dos respuestas.
   */
  const SIN_DESPLAZAR = new Set()
  const mesesDeCuenta = porMeses(proyeccionLarga, SIN_DESPLAZAR)
  // El mes en curso, igual que arriba: la proyección sólo trae lo que falta,
  // así que sus totales salen del extracto más lo que queda por pasar.
  const enCursoDeCuenta = conGotaDiaria(
    resumenDeMes({
      movimientos: contables,
      categorias,
      noEsGasto: NO_ES_GASTO,
      eventos: proyeccion.eventos,
      mes: mesDe(hoy),
      hoy,
      abrenMes: SIN_DESPLAZAR,
    }),
    ritmoEfectivo.porDia,
    hoy,
  )
  if (mesesDeCuenta[0] && mesesDeCuenta[0].mes === mesDe(hoy)) {
    mesesDeCuenta[0] = {
      ...mesesDeCuenta[0],
      ingresos: enCursoDeCuenta.ingresos.total,
      gastos: enCursoDeCuenta.gastos.total,
      ahorro: enCursoDeCuenta.ahorro,
    }
  }
  if (meses[0] && meses[0].mes === mesDe(hoy)) {
    meses[0] = {
      ...meses[0],
      ingresos: mesEnCurso.ingresos.total,
      gastos: mesEnCurso.gastos.total,
      ahorro: mesEnCurso.ahorro,
    }
  }

  /*
   * Al mes que viene lo paga una nómina que ya ha entrado. La regla de que un
   * cobro del 25 cuenta en el mes que abre sí se aplica en porMeses, pero esa
   * nómina no llega hasta allí: cayó antes de que empezara la proyección, así
   * que no es un evento futuro, está dentro del saldo. Sin esto, el mes que
   * viene sale con cero ingresos y la tabla dice «se va más de lo que entra»
   * todos los meses del año, para el mismo mes y por el mismo motivo.
   *
   * Sólo le pasa al siguiente. Los demás cobran su nómina dentro del horizonte,
   * así que su parte ya cobrada es cero y sumarla no cambiaría nada.
   */
  const mesQueViene = sumarMeses(`${mesDe(hoy)}-01`, 1).slice(0, 7)
  const fila = meses.find((f) => f.mes === mesQueViene)
  if (fila) {
    const yaCobrado = resumenDeMes({
      movimientos: contables,
      categorias,
      noEsGasto: NO_ES_GASTO,
      eventos: [],
      mes: mesQueViene,
      hoy,
      abrenMes,
    })
    fila.ingresos += yaCobrado.ingresos.real
    fila.gastos += yaCobrado.gastos.real
    fila.ahorro = fila.ingresos + fila.gastos
  }

  /*
   * El resumen, mes a mes. Deja de haber un «este mes» que quiere decir una
   * cosa aquí y otra allí: cada mes se cuenta entero, del 1 al último, sabe si
   * está cerrado, en curso o por venir, y lleva su plan al lado para poder
   * comparar lo que decidiste con lo que llevas gastado.
   */
  const detalleMensual = detallarMeses({
    meses,
    proyeccion: proyeccionLarga,
    // Sin eventos: aquí sólo interesa lo que ya ha pasado de verdad. Lo
    // previsto se deduce restándoselo al total, que sale de la proyección.
    resumenDe: (mesPedido) => resumenDeMes({
      movimientos: contables,
      categorias,
      noEsGasto: NO_ES_GASTO,
      eventos: [],
      mes: mesPedido,
      hoy,
      abrenMes,
    }),
    hoy,
  }).map((m) => ({
    ...m,
    acabado: estaAcabado(m.mes, hoy),
    // Lo que ya ha entrado y paga este mes. Sin esto, la lista de octubre no
    // enseñaba de dónde salen sus ingresos —la nómina cayó en septiembre— y
    // en su lugar enseñaba la del 25 de octubre, que es la que paga noviembre.
    // Dos cifras iguales en la misma pantalla que son dinero distinto.
    cobrado: contables.filter((x) => x.origen !== 'tarjeta' && x.importe > 0
      && mesDeUnMovimiento(x, abrenMes) === m.mes),
    ...curvaDelMes({
      mes: m.mes,
      movimientos: cuenta,
      proyeccion: proyeccionLarga,
      hoy,
      // Lo que entra en este mes pero paga el siguiente: la nómina del 25. Se
      // enseña en la línea del banco, porque está en la cuenta, pero no cuenta
      // para saber hasta dónde bajó el dinero de este mes.
      desplazados: [
        ...cuenta.filter((x) => x.importe > 0 && x.fecha.slice(0, 7) === m.mes
          && mesDeUnMovimiento(x, abrenMes) !== m.mes),
        ...proyeccionLarga.eventos.filter((ev) => ev.importe > 0
          && ev.fecha.slice(0, 7) === m.mes && mesContable(ev, abrenMes) !== m.mes),
      ],
    }),
    plan: planes[m.mes] ?? null,
    lineas: revisarPresupuestos({
      movimientos: contables,
      categorias,
      noEsGasto: NO_ES_GASTO,
      asignado: planes[m.mes]?.asignado ?? {},
      mes: m.mes,
      hoy,
    }),
  }))

  /*
   * Qué mes se está planificando, que no es el mismo que se está viviendo. En
   * cuanto entra la nómina pasas a repartir el mes que abre: el que corre ya
   * lo repartiste el mes pasado y ahora sólo se compara con lo que va saliendo.
   *
   * Es el mes de la cascada. Antes esto apuntaba al mes natural, y del día 20
   * en adelante te hacía repartir un mes al que le quedaban dos días: como no
   * quedaba nada por pagar, el residuo salía siendo la cuenta entera.
   */
  const mesAPlanificar = mesQuePagaLaNomina(hoy)
  const aPlanificar = detalleMensual.find((m) => m.mes === mesAPlanificar) ?? null
  const planificando = {
    mes: mesAPlanificar,
    plan: planes[mesAPlanificar] ?? null,
    residuo: aPlanificar === null || aPlanificar.estado === 'enCurso'
      ? residuo
      : residuoDe(aPlanificar, opciones.colchon ?? 0),
  }
  const cuadrePlanificado = cuadrarPlan({ plan: planificando.plan, residuo: planificando.residuo })

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
    // `ritmo` es lo que sueles gastar; `ritmoEfectivo` es lo que has decidido
    // gastar. Se devuelven los dos porque la interfaz enseña la distancia.
    ritmo,
    ritmoEfectivo,
    plan,
    planes,
    residuo,
    cuadre,
    detalleMensual,
    mesesDeCuenta,
    abrenMes,
    planificando: { ...planificando, cuadre: cuadrePlanificado },
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
      /*
       * El día a día del mes de la cascada, que es un mes entero.
       *
       * Si lo has repartido, es lo que repartiste. Si no, el goteo medido por
       * días, que es como lo cuenta la proyección y así las dos dicen lo mismo.
       *
       * Lo que no puede ser es multiplicar el ritmo del plan por los días de
       * este mes: ese ritmo es «lo que queda entre los días que quedan» del mes
       * en curso, y un día 28 vale sesenta y cuatro euros al día. Por treinta y
       * un días daba mil novecientos, y la cascada cerraba en rojo un mes que
       * la portada daba por ahorrado.
       */
      diaADia: planificando.plan
        ? -Object.values(planificando.plan.asignado).reduce((t, x) => t + x, 0)
        : ritmo.porDia * Number(ultimoDiaDelMes(`${mesQuePagaLaNomina(hoy)}-01`).slice(8)),
      inversiones: opciones.inversiones,
      plazos,
      saltados,
    }),
    plazos,
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
