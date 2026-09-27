// @ts-check
/**
 * La bajamar: el punto más bajo al que llega el saldo antes de que vuelva a
 * entrar dinero.
 *
 * El total del mes no sirve para decidir nada. Si cobras el 25 y el recibo
 * gordo entra el 1, lo que importa no es cerrar el mes en positivo: es no
 * quedarte en descubierto el día 10. Por eso el titular de la aplicación es
 * el mínimo de la proyección y el día en que ocurre, no la suma.
 */

import { diasEntre, sumarMeses, ultimoDiaDelMes } from '../dominio/tipos.js'

/**
 * @typedef {import('../dominio/tipos.js').Compromiso} Compromiso
 * @typedef {import('../dominio/tipos.js').Bulto} Bulto
 */

/**
 * @typedef {object} Evento
 * @property {string} fecha
 * @property {number} importe    céntimos, con signo
 * @property {string} nombre
 * @property {'compromiso' | 'ingreso' | 'bulto' | 'tarjeta' | 'plazo'} tipo
 * @property {boolean} seguro    false si es una previsión, true si está confirmado
 * @property {string | null} [entidadId] de quién sale, cuando se puede decir que no vuelva
 * @property {string} [reciboId] qué recibo suyo, cuando el cobrador tiene varios
 */

/**
 * @typedef {object} Proyeccion
 * @property {number} saldoInicial
 * @property {string} desde
 * @property {string} hasta
 * @property {{ fecha: string, saldo: number }} suelo
 * @property {number} saldoFinal
 * @property {Evento[]} eventos
 * @property {Array<{ fecha: string, saldo: number }>} curva
 * @property {number} ritmoPorDia
 */

/**
 * @param {object} entrada
 * @param {number} entrada.saldoInicial
 * @param {string} entrada.desde       ISO
 * @param {string} [entrada.hasta]     ISO; por defecto, fin del mes siguiente
 * @param {Evento[]} entrada.eventos
 * @param {number} entrada.ritmoPorDia céntimos negativos
 * @returns {Proyeccion}
 */
export function proyectar({ saldoInicial, desde, hasta, eventos, ritmoPorDia }) {
  const fin = hasta ?? ultimoDiaDelMes(sumarMeses(desde, 1))
  const dias = Math.max(diasEntre(desde, fin), 0)

  /** @type {Map<string, Evento[]>} */
  const porDia = new Map()
  for (const e of eventos) {
    if (e.fecha < desde || e.fecha > fin) continue
    const lista = porDia.get(e.fecha)
    if (lista) lista.push(e)
    else porDia.set(e.fecha, [e])
  }

  let saldo = saldoInicial
  // Lo previsto para hoy todavía no ha pasado por el banco: el saldo inicial es
  // el del extracto, y un cobro que aún no ha llegado no está descontado. Sin
  // esto, el bucle empieza en el día siguiente y el recibo de hoy sale en la
  // lista sin bajarle el saldo a nadie.
  for (const e of porDia.get(desde) ?? []) saldo += e.importe
  let suelo = { fecha: desde, saldo }
  /** @type {Array<{ fecha: string, saldo: number }>} */
  const curva = [{ fecha: desde, saldo }]

  for (let d = 1; d <= dias; d += 1) {
    const fecha = sumarDias(desde, d)
    saldo += ritmoPorDia
    for (const e of porDia.get(fecha) ?? []) saldo += e.importe
    curva.push({ fecha, saldo })
    if (saldo < suelo.saldo) suelo = { fecha, saldo }
  }

  return {
    saldoInicial,
    desde,
    hasta: fin,
    suelo,
    saldoFinal: saldo,
    eventos: eventos.filter((e) => e.fecha >= desde && e.fecha <= fin)
      .sort((a, b) => a.fecha.localeCompare(b.fecha)),
    curva,
    ritmoPorDia,
  }
}

/**
 * @param {string} iso
 * @param {number} dias
 */
export function sumarDias(iso, dias) {
  const [a, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(a, m - 1, d + dias))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

/**
 * Convierte compromisos, ingresos y bultos en la lista de eventos a proyectar.
 *
 * Un compromiso se repite dentro del horizonte tantas veces como quepa: si la
 * proyección llega a dos meses, la luz entra dos veces.
 *
 * @param {object} entrada
 * @param {Compromiso[]} entrada.compromisos
 * @param {Compromiso[]} entrada.ingresos
 * @param {Bulto[]} entrada.bultos
 * @param {{ fecha: string, importe: number } | null} entrada.tarjeta
 * @param {import('./fraccionados.js').Cuota[]} [entrada.plazos]
 * @param {string} entrada.desde
 * @param {string} entrada.hasta
 * @returns {Evento[]}
 */
export function eventosDesde({ compromisos, ingresos, bultos, tarjeta, plazos = [], desde, hasta }) {
  /** @type {Evento[]} */
  const eventos = []
  const meses = { mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 }

  for (const grupo of [
    { lista: compromisos, tipo: /** @type {const} */ ('compromiso') },
    { lista: ingresos, tipo: /** @type {const} */ ('ingreso') },
  ]) {
    for (const c of grupo.lista) {
      if (c.estado === 'extinto') continue
      let fecha = c.proximaPrevista
      let vueltas = 0
      while (fecha <= hasta && vueltas < 24) {
        if (fecha >= desde) {
          eventos.push({
            fecha,
            importe: c.importeEsperado,
            nombre: c.nombre,
            tipo: grupo.tipo,
            seguro: false,
            entidadId: c.entidadId,
            reciboId: c.reciboId,
          })
        }
        fecha = sumarMeses(fecha, meses[c.periodicidad])
        vueltas += 1
      }
    }
  }

  for (const b of bultos) {
    eventos.push({ fecha: b.fecha, importe: b.importe, nombre: b.nombre, tipo: 'bulto', seguro: true })
  }

  for (const c of plazos) {
    if (c.fecha < desde || c.fecha > hasta) continue
    eventos.push({ fecha: c.fecha, importe: c.importe, nombre: c.nombre, tipo: 'plazo', seguro: true })
  }

  if (tarjeta) {
    eventos.push({
      fecha: tarjeta.fecha,
      importe: tarjeta.importe,
      nombre: 'Tarjeta VISA',
      tipo: 'tarjeta',
      seguro: true,
    })
  }

  return eventos
}
