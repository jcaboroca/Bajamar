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
 * El mes es el natural, del 1 al 31. Lo único que se mueve es la nómina: la que
 * se cobra a final de mes no paga los días que quedan detrás, paga los que
 * vienen delante, así que cuenta en el mes que abre. El dinero no se toca —en
 * la cuenta sigue entrando el 25 y el suelo se calcula con esa fecha—, sólo
 * cambia a qué mes se le apunta.
 */

import { sumarMeses } from '../dominio/tipos.js'
import { formatEuros } from '../dominio/dinero.js'
import { PLAZOS } from './fraccionados.js'
import { MESES_DE } from './fijos.js'

/** @typedef {import('./fijos.js').Fijo} Fijo */

/**
 * A partir de este día, un ingreso ya es el dinero del mes siguiente.
 */
export const DIA_DE_ADELANTO = 20

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
 */

/**
 * @typedef {object} Cascada
 * @property {string} mes              'yyyy-mm'
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
 */

/**
 * El mes que paga la última nómina cobrada: pasado el día 20 ya se vive del
 * dinero del mes siguiente.
 * @param {string} hoy
 */
export function mesEnCurso(hoy) {
  if (Number(hoy.slice(8)) < DIA_DE_ADELANTO) return hoy.slice(0, 7)
  return sumarMeses(`${hoy.slice(0, 8)}01`, 1).slice(0, 7)
}

/**
 * @param {object} entrada
 * @param {string} entrada.mes                'yyyy-mm'
 * @param {Fijo[]} entrada.fijos              ya descritos
 * @param {number} entrada.ingreso            céntimos positivos
 * @param {number} entrada.diaADia            goteo mensual, céntimos negativos
 * @param {Record<string, boolean>} [entrada.inversiones] reciboId → es inversión
 * @param {import('./fraccionados.js').Cuota[]} [entrada.plazos]
 * @returns {Cascada}
 */
export function cascadaDelMes({ mes, fijos, ingreso, diaADia, inversiones = {}, plazos = [] }) {
  /** @type {Escalon[]} */
  const listaFijos = []
  /** @type {Escalon[]} */
  const listaInversiones = []
  /** @type {Escalon[]} */
  const listaToca = []

  for (const fijo of fijos) {
    if (fijo.estado === 'extinto') continue
    const inversion = esInversion(fijo, inversiones)
    // El interruptor sólo aparece donde hay duda: un traspaso a tu propio
    // bolsillo puede ser una aportación o la cuota de un préstamo.
    const puedeSerInversion = fijo.categoria === 'traspaso' || fijo.reciboId in inversiones
    for (const fecha of vecesEn(fijo, mes)) {
      const escalon = {
        nombre: fijo.nombre,
        importe: fijo.importeEsperado,
        detalle: fijo.periodicidad === 'mensual' ? diaDe(fecha) : `${diaDe(fecha)} · ${cada(fijo)}`,
        reciboId: fijo.reciboId,
        categoria: fijo.categoria,
        inversion,
        aplazable: fijo.aplazable === true,
        puedeSerInversion,
      }
      if (inversion) listaInversiones.push(escalon)
      else if (fijo.periodicidad === 'mensual') listaFijos.push(escalon)
      else listaToca.push(escalon)
    }
  }

  const porImporte = (/** @type {Escalon} */ a, /** @type {Escalon} */ b) => a.importe - b.importe
  listaFijos.sort(porImporte)
  listaInversiones.sort(porImporte)
  listaToca.sort(porImporte)

  /** @type {Escalon[]} */
  const listaPlazos = plazos
    .filter((c) => c.fecha.slice(0, 7) === mes)
    .map((c) => ({
      nombre: c.nombre,
      importe: c.importe,
      detalle: `cuota ${c.plazo} de ${PLAZOS} · aplazaste ${formatEuros(c.total)}`,
      reciboId: '',
      categoria: 'tarjeta',
      inversion: false,
      aplazable: false,
      puedeSerInversion: false,
    }))
    .sort(porImporte)

  const suma = (/** @type {Escalon[]} */ lista) => lista.reduce((t, x) => t + x.importe, 0)
  const sumaFijos = suma(listaFijos)
  const sumaInversiones = suma(listaInversiones)
  const sumaToca = suma(listaToca)
  const sumaPlazos = suma(listaPlazos)

  return {
    mes,
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
    aplazable: [...listaFijos, ...listaInversiones, ...listaToca]
      .reduce((t, e) => (e.aplazable ? t + e.importe : t), 0),
    resultado: ingreso + sumaFijos + sumaInversiones + diaADia + sumaToca + sumaPlazos,
  }
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
 * Qué días de este mes toca pagar un recibo. Se retrocede desde la próxima
 * prevista y luego se avanza, para que el mes pedido pueda estar por detrás o
 * por delante de ella.
 * @param {Fijo} fijo
 * @param {string} mes  'yyyy-mm'
 * @returns {string[]}
 */
function vecesEn(fijo, mes) {
  const paso = MESES_DE[fijo.periodicidad]
  const fechas = []
  let fecha = fijo.proximaPrevista
  let vueltas = 0
  while (fecha.slice(0, 7) > mes && vueltas < 200) {
    fecha = sumarMeses(fecha, -paso)
    vueltas += 1
  }
  while (fecha.slice(0, 7) < mes && vueltas < 400) {
    fecha = sumarMeses(fecha, paso)
    vueltas += 1
  }
  while (fecha.slice(0, 7) === mes) {
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
