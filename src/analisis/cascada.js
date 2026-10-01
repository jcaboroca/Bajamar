// @ts-check
/**
 * El mes, de arriba abajo, en el orden en que se gasta.
 *
 * Un mes no es una bolsa de gastos revueltos: es una nómina de la que van
 * saliendo cosas, y no todas pesan igual ni se deciden igual. Los recibos fijos
 * no se eligen cada mes, las inversiones sí y además no son gasto, el día a día
 * es lo único que se decide cada mañana, y lo anual no toca casi nunca pero
 * cuando toca se lleva un mes por delante.
 *
 * Verlas sumadas en una sola cifra esconde justo eso. Aquí van en cascada, cada
 * una restando de lo que quedaba, para ver en qué escalón se acaba el dinero.
 *
 * El mes es el periodo entre dos nóminas (ver `periodos.js`), así que aquí no
 * se desplaza nada: la nómina que abre el periodo ya está dentro de él y todo
 * lo que cae entre sus dos bordes es suyo.
 */

import { sumarMeses } from '../dominio/tipos.js'
import { formatEuros } from '../dominio/dinero.js'
import { PLAZOS } from './fraccionados.js'
import { MESES_DE } from './fijos.js'

/** @typedef {import('./fijos.js').Fijo} Fijo */

/**
 * @typedef {object} Escalon
 * @property {string} nombre
 * @property {number} importe    céntimos, negativo
 * @property {string} detalle
 * @property {string} reciboId
 * @property {string} categoria
 * @property {boolean} inversion
 * @property {boolean} aplazable         el usuario dice que un mes malo se lo salta
 * @property {boolean} puedeSerInversion  la app duda y el usuario puede decidir
 * @property {string} [fecha]             cuándo cae, para saber de qué mes es
 * @property {boolean} [previsto]         todavía no ha pasado
 * @property {boolean} [saltado]          este mes no se paga: se ve, pero no suma
 * @property {boolean} [marcado]          lo diste por pagado tú; falta que lo traiga el extracto
 * @property {string} [mes]               yyyy-mm en que tocaba
 */

/**
 * @typedef {object} Cascada
 * @property {string} mes              'yyyy-mm'
 * @property {number} apertura        con lo que llegas al periodo
 * @property {number} ingreso          céntimos, positivo
 * @property {Escalon[]} fijos         los que se pagan todos los meses
 * @property {Escalon[]} inversiones   sale de la cuenta, pero no se gasta
 * @property {Escalon[]} toca          lo que sólo cae algunos meses, y éste cae
 * @property {Escalon[]} plazos        cuotas de lo que aplazaste
 * @property {number} sumaFijos
 * @property {number} sumaInversiones
 * @property {number} diaADia
 * @property {number} sumaToca
 * @property {number} sumaPlazos
 * @property {number} aplazable        lo que darías de margen si te lo saltaras
 * @property {number} resultado        lo que sobra, o falta, al acabar el mes
 * @property {number} cierre           con lo que acabas: la apertura más el mes
 */

/**
 * @param {object} entrada
 * @param {import('./periodos.js').Periodo} entrada.periodo
 * @param {Fijo[]} entrada.fijos              ya descritos
 * @param {import('./mensual.js').Apunte[]} [entrada.conFecha] lo que sale con fecha, ya contado
 * @param {number} [entrada.apertura]         céntimos con los que llegas
 * @param {number} entrada.ingreso            céntimos positivos
 * @param {number} entrada.diaADia            goteo mensual, céntimos negativos
 * @param {Record<string, boolean>} [entrada.inversiones] reciboId → es inversión
 * @param {import('./fraccionados.js').Cuota[]} [entrada.plazos]
 * @param {Record<string, true>} [entrada.saltados] reciboId|mes que no se paga
 * @returns {Cascada}
 */
export function cascadaDelPeriodo({
  periodo, fijos, conFecha = [], apertura = 0, ingreso, diaADia,
  inversiones = {}, plazos = [], saltados = {},
}) {
  const vivos = fijos.filter((f) => f.estado !== 'extinto')
  const porRecibo = new Map(vivos.map((f) => [f.reciboId, f]))
  // Un cobro ya pagado llega con el concepto en bruto del banco. Si su cobrador
  // tiene ficha se le pone el nombre bueno, salvo que cobre dos cosas distintas
  // —MyInvestor cobra una aportación y la letra de una furgoneta—.
  const porEntidad = new Map()
  for (const f of vivos) {
    if (!f.entidadId) continue
    porEntidad.set(f.entidadId, porEntidad.has(f.entidadId) ? null : f)
  }
  // Las cuotas no traen reciboId, así que se reconocen por dónde y cuánto.
  const cuotas = new Map(plazos.map((c) => [`${c.fecha}|${c.importe}`, c]))

  /** @type {Escalon[]} */
  const listaFijos = []
  /** @type {Escalon[]} */
  const listaInversiones = []
  /** @type {Escalon[]} */
  const listaToca = []
  /** @type {Escalon[]} */
  const listaPlazos = []

  /*
   * Los escalones salen de lo que el periodo ya tiene contado, no de repetir
   * aquí el calendario de los recibos. Haciéndolo por separado la cascada se
   * dejaba fuera la liquidación de la tarjeta y volvía a cobrar el agua que ya
   * se había pagado: dos cifras del mismo mes a cuatro dedos de distancia.
   */
  for (const a of conFecha) {
    const fijo = (a.reciboId ? porRecibo.get(a.reciboId) : null)
      ?? (a.entidadId ? porEntidad.get(a.entidadId) : null)
    const cuota = cuotas.get(`${a.fecha}|${a.importe}`)
    const inversion = fijo ? esInversion(fijo, inversiones) : false
    /** @type {Escalon} */
    const escalon = {
      nombre: fijo?.nombre ?? a.concepto,
      importe: a.importe,
      detalle: detalleDe(a, fijo ?? null, cuota ?? null),
      reciboId: a.reciboId ?? '',
      categoria: fijo?.categoria ?? (cuota ? 'tarjeta' : 'otros'),
      inversion,
      aplazable: a.aplazable === true,
      // El interruptor sólo aparece donde hay duda: un traspaso a tu propio
      // bolsillo puede ser una aportación o la cuota de un préstamo.
      puedeSerInversion: fijo
        ? fijo.categoria === 'traspaso' || fijo.reciboId in inversiones
        : false,
      fecha: a.fecha,
      previsto: a.previsto,
      saltado: false,
      marcado: a.marcado === true,
      mes: a.mes ?? a.fecha.slice(0, 7),
    }
    if (inversion) listaInversiones.push(escalon)
    else if (cuota) listaPlazos.push(escalon)
    else if (fijo && fijo.periodicidad !== 'mensual') listaToca.push(escalon)
    else listaFijos.push(escalon)
  }

  // Lo saltado ya no está en el periodo —se descontó al armar la previsión—,
  // pero tiene que verse para poder deshacerlo.
  for (const fijo of vivos) {
    for (const fecha of vecesEn(fijo, periodo)) {
      if (saltados[`${fijo.reciboId}|${fecha.slice(0, 7)}`] !== true) continue
      /** @type {Escalon} */
      const escalon = {
        nombre: fijo.nombre,
        importe: fijo.importeEsperado,
        detalle: fijo.periodicidad === 'mensual' ? diaDe(fecha) : `${diaDe(fecha)} · ${cada(fijo)}`,
        reciboId: fijo.reciboId,
        categoria: fijo.categoria,
        inversion: esInversion(fijo, inversiones),
        aplazable: fijo.aplazable === true,
        puedeSerInversion: fijo.categoria === 'traspaso' || fijo.reciboId in inversiones,
        fecha,
        previsto: true,
        saltado: true,
      }
      if (escalon.inversion) listaInversiones.push(escalon)
      else if (fijo.periodicidad !== 'mensual') listaToca.push(escalon)
      else listaFijos.push(escalon)
    }
  }

  const porImporte = (/** @type {Escalon} */ a, /** @type {Escalon} */ b) => a.importe - b.importe
  listaFijos.sort(porImporte)
  listaInversiones.sort(porImporte)
  listaToca.sort(porImporte)
  listaPlazos.sort(porImporte)

  // Lo saltado sigue en la lista para poder deshacerlo, pero no cuenta: si
  // desapareciera sin dejar rastro, se olvidaría que se saldó.
  const suma = (/** @type {Escalon[]} */ lista) =>
    lista.reduce((t, x) => (x.saltado ? t : t + x.importe), 0)
  const sumaFijos = suma(listaFijos)
  const sumaInversiones = suma(listaInversiones)
  const sumaToca = suma(listaToca)
  const sumaPlazos = suma(listaPlazos)

  return {
    mes: periodo.id,
    desde: periodo.desde,
    hasta: periodo.hasta,
    apertura,
    ingreso,
    fijos: listaFijos,
    inversiones: listaInversiones,
    toca: listaToca,
    plazos: listaPlazos,
    sumaFijos,
    sumaInversiones,
    diaADia,
    sumaToca,
    sumaPlazos,
    // Lo ya saltado no entra: su dinero está descontado del resultado y
    // volverlo a contar aquí sería ofrecerte por segunda vez lo que ya has
    // decidido no pagar. El margen es lo que te queda por decidir, no lo que
    // podrías haber decidido.
    aplazable: [...listaFijos, ...listaInversiones, ...listaToca]
      .reduce((t, e) => (e.aplazable && !e.saltado ? t + e.importe : t), 0),
    resultado: ingreso + sumaFijos + sumaInversiones + diaADia + sumaToca + sumaPlazos,
    // Con lo que acabas. Es la cifra que da nombre a la aplicación, así que
    // tiene que salir de aquí igual que del resumen y de la gráfica.
    cierre: apertura + ingreso + sumaFijos + sumaInversiones + diaADia + sumaToca + sumaPlazos,
  }
}

/**
 * @param {import('./mensual.js').Apunte} apunte
 * @param {Fijo | null} fijo
 * @param {import('./fraccionados.js').Cuota | null} cuota
 */
function detalleDe(apunte, fijo, cuota) {
  if (cuota) return `cuota ${cuota.plazo} de ${PLAZOS} · aplazaste ${formatEuros(cuota.total)}`
  const dia = diaDe(apunte.fecha)
  if (apunte.marcado) return `${dia} · pagado, falta que lo traiga el extracto`
  if (!apunte.previsto) return `${dia} · ya pagado`
  if (fijo && fijo.periodicidad !== 'mensual') return `${dia} · ${cada(fijo)}`
  return dia
}

/**
 * Un traspaso a tu propio bolsillo es inversión mientras no digas lo contrario.
 * Y hay que poder decirlo: la cuota de un préstamo sale por el mismo sitio que
 * una aportación al fondo, y son lo contrario la una de la otra.
 * @param {Fijo} fijo
 * @param {Record<string, boolean>} inversiones
 */
export function esInversion(fijo, inversiones) {
  return inversiones[fijo.reciboId] ?? fijo.categoria === 'traspaso'
}

/**
 * Qué días de este periodo toca pagar un recibo. Se retrocede desde la próxima
 * prevista y luego se avanza, para que el periodo pedido pueda estar por
 * detrás o por delante de ella.
 * @param {Fijo} fijo
 * @param {import('./periodos.js').Periodo} periodo
 * @returns {string[]}
 */
function vecesEn(fijo, periodo) {
  const paso = MESES_DE[fijo.periodicidad]
  const fechas = []
  let fecha = fijo.proximaPrevista
  let vueltas = 0
  while (fecha > periodo.hasta && vueltas < 200) {
    fecha = sumarMeses(fecha, -paso)
    vueltas += 1
  }
  while (fecha < periodo.desde && vueltas < 400) {
    fecha = sumarMeses(fecha, paso)
    vueltas += 1
  }
  while (fecha >= periodo.desde && fecha <= periodo.hasta) {
    fechas.push(fecha)
    fecha = sumarMeses(fecha, paso)
  }
  return fechas
}

/** @param {Fijo} fijo */
function cada(fijo) {
  const meses = MESES_DE[fijo.periodicidad]
  return meses === 12 ? 'una vez al año' : `cada ${meses} meses`
}

/** @param {string} iso */
function diaDe(iso) {
  return `día ${Number(iso.slice(8))}`
}
