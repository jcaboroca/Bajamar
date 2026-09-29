// @ts-check
/**
 * Todo lo que el usuario decide, guardado aparte de los extractos.
 *
 * La separación importa: un extracto se reimporta y se sobrescribe entero,
 * pero una categoría corregida a mano o un objetivo de ahorro tienen que
 * sobrevivir a eso. Por eso no se tocan los movimientos para guardar nada de
 * esto.
 */

import { borrar, escribir, leer, leerTodo } from './db.js'
import { VENTANA_POR_DEFECTO } from '../analisis/compromisos.js'

/**
 * @typedef {import('../dominio/tipos.js').Retoque} Retoque
 * @typedef {import('../analisis/presupuestos.js').Presupuesto} Presupuesto
 * @typedef {import('../analisis/plan.js').Plan} Plan
 * @typedef {import('../analisis/objetivos.js').Objetivo} Objetivo
 * @typedef {import('../analisis/patrimonio.js').Apunte} Apunte
 */

/**
 * @typedef {'fijo' | 'suelto' | 'baja'} Trato
 */

/**
 * @typedef {object} Preferencias
 * @property {Retoque[]} retoques
 * @property {Presupuesto[]} presupuestos      heredado: sólo vive para migrarse
 * @property {Record<string, Plan>} planes     mes → en qué se va el día a día
 * @property {Objetivo[]} objetivos
 * @property {Apunte[]} patrimonio
 * @property {Record<string, string>} reglas   entidadId → categoría
 * @property {Record<string, Trato>} tratos    reciboId → cómo preverlo
 * @property {Record<string, string>} apodos   reciboId → cómo lo llama el usuario
 * @property {Record<string, true>} unicos     entidadId → no va a repetirse
 * @property {Record<string, true>} anuales    entidadId → vuelve cada año
 * @property {Record<string, string>} ritmos   reciboId → cada cuánto llega, dicho por ti
 * @property {import('../dominio/tipos.js').Manual[]} manuales recibos que no pasan por la cuenta
 * @property {Record<string, true>} apagadas   categoría → no toca esta temporada
 * @property {Record<string, true>} saltados   reciboId|mes → este mes no se paga
 * @property {Record<string, boolean>} inversiones reciboId → es inversión, no gasto
 * @property {import('../dominio/tipos.js').Bulto[]} bultos
 * @property {number} colchon                  céntimos
 * @property {number} ventanaRitmo             meses que mira el goteo atrás
 */

/** @returns {Promise<Preferencias>} */
export async function cargar() {
  const [retoques, presupuestos, objetivos, patrimonio, reglas, bultos, colchon, ventanaRitmo, tratos, apodos, unicos, anuales, apagadas, saltados, inversiones, planes, ritmos, manuales] = await Promise.all([
    leerTodo('retoques'),
    leerTodo('presupuestos'),
    leerTodo('objetivos'),
    leerTodo('patrimonio'),
    leerTodo('reglas'),
    leerTodo('bultos'),
    leer('ajustes', 'colchon'),
    leer('ajustes', 'ventanaRitmo'),
    leerTodo('tratos'),
    leerTodo('apodos'),
    leerTodo('unicos'),
    leerTodo('anuales'),
    leerTodo('apagadas'),
    leerTodo('saltados'),
    leerTodo('inversiones'),
    leerTodo('planes'),
    leerTodo('ritmos'),
    leerTodo('manuales'),
  ])

  return {
    retoques,
    presupuestos,
    planes: Object.fromEntries(planes.map((/** @type {any} */ p) => [p.id, {
      mes: p.id,
      asignado: p.asignado ?? {},
      residuo: Number(p.residuo ?? 0),
      sello: p.sello ?? '',
    }])),
    objetivos,
    patrimonio,
    bultos,
    reglas: Object.fromEntries(reglas.map((/** @type {any} */ r) => [r.id, r.categoria])),
    tratos: Object.fromEntries(tratos.map((/** @type {any} */ t) => [t.id, t.trato])),
    apodos: Object.fromEntries(apodos.map((/** @type {any} */ a) => [a.id, a.nombre])),
    unicos: Object.fromEntries(unicos.map((/** @type {any} */ u) => [u.id, true])),
    anuales: Object.fromEntries(anuales.map((/** @type {any} */ a) => [a.id, true])),
    ritmos: Object.fromEntries(ritmos.map((/** @type {any} */ r) => [r.id, r.cada])),
    manuales,
    apagadas: Object.fromEntries(apagadas.map((/** @type {any} */ a) => [a.id, true])),
    saltados: Object.fromEntries(saltados.map((/** @type {any} */ s) => [s.id, true])),
    inversiones: Object.fromEntries(inversiones.map((/** @type {any} */ i) => [i.id, i.esInversion])),
    colchon: Number(/** @type {any} */ (colchon)?.valor ?? 0),
    ventanaRitmo: Number(/** @type {any} */ (ventanaRitmo)?.valor ?? VENTANA_POR_DEFECTO),
  }
}

/**
 * Las primeras respuestas se guardaron todas en un mismo registro. Se reparten
 * en cuanto se abre la app, y el registro viejo se retira para no leerlo dos
 * veces ni dejar dos verdades sobre lo mismo.
 */
export async function repartirTratosViejos() {
  const guardado = /** @type {any} */ (await leer('ajustes', 'tratos'))
  if (!guardado?.valor) return
  for (const [reciboId, trato] of Object.entries(guardado.valor)) {
    if (trato === 'suelto' || trato === 'baja') await escribir('tratos', { id: reciboId, trato })
  }
  await borrar('ajustes', 'tratos')
}

/**
 * Guarda un retoque, o lo borra si ya no dice nada.
 *
 * Un retoque vacío no es lo mismo que no tenerlo sólo en apariencia: dejarlo
 * ahí obligaría a comprobar campo por campo en cada cálculo.
 * @param {Retoque} retoque
 */
export async function ponerRetoque(retoque) {
  const vacio = retoque.categoria === undefined
    && retoque.excluido !== true
    && retoque.traspaso !== true
    && !retoque.nota
  if (vacio) return borrar('retoques', retoque.id)
  return escribir('retoques', { ...retoque })
}

/**
 * @param {string} entidadId
 * @param {string | null} categoria  null borra la regla
 */
export async function ponerRegla(entidadId, categoria) {
  if (!categoria) return borrar('reglas', entidadId)
  return escribir('reglas', { id: entidadId, categoria })
}

/**
 * La batería solar se compra una vez. Sigue estando en el historial y en el
 * saldo de aquel mes, pero no tiene por qué seguir saliendo del de los que
 * vienen.
 * @param {string} entidadId
 * @param {boolean} esUnico
 */
export async function ponerUnico(entidadId, esUnico) {
  if (!esUnico) return borrar('unicos', entidadId)
  return escribir('unicos', { id: entidadId })
}

/**
 * El seguro del coche visto una sola vez es indistinguible de un pago único, y
 * la app no puede saberlo. El usuario sí.
 * @param {string} entidadId
 * @param {boolean} esAnual
 */
export async function ponerAnual(entidadId, esAnual) {
  if (!esAnual) return borrar('anuales', entidadId)
  return escribir('anuales', { id: entidadId })
}

/**
 * Cada cuánto llega un recibo, cuando tú lo sabes mejor que yo. Entre las
 * compras de Amazon hay una que es Prime, y no hay forma de distinguirla por el
 * importe: cuesta lo mismo que cualquier otra cosa que compres allí.
 * @param {string} reciboId
 * @param {string} cada '' para volver a deducirlo
 */
export async function ponerRitmo(reciboId, cada) {
  if (cada === '') return borrar('ritmos', reciboId)
  return escribir('ritmos', { id: reciboId, cada })
}

/**
 * Un recibo que no pasa por la cuenta. El premium del GPS del perro se paga con
 * el saldo de PayPal y en el extracto no hay ni rastro: existe, se cobra cada
 * año y hunde la previsión el día que llega, pero yo no puedo verlo.
 * @param {import('../dominio/tipos.js').Manual} manual
 */
export async function ponerManual(manual) {
  return escribir('manuales', manual)
}

/** @param {string} id */
export async function quitarManual(id) {
  return borrar('manuales', id)
}

/**
 * El goteo da por hecho que sigues gastando en todo como hasta ahora. Hay
 * categorías que van por temporadas y sobre eso el histórico no sabe nada.
 * @param {string} categoria
 * @param {boolean} apagada
 */
export async function ponerApagada(categoria, apagada) {
  if (!apagada) return borrar('apagadas', categoria)
  return escribir('apagadas', { id: categoria })
}

/**
 * Se guarda por recibo y no por entidad porque el mismo cobrador puede llevarse
 * las dos cosas: una aportación al fondo y la cuota de un préstamo.
 * @param {string} reciboId
 * @param {boolean} esInversion
 */
export async function ponerInversion(reciboId, esInversion) {
  return escribir('inversiones', { id: reciboId, esInversion })
}

/**
 * Lo que asignas a una categoría dentro del plan de un mes.
 *
 * Se guarda junto al residuo con el que lo decidiste: es lo que después
 * permite decir «el residuo ha bajado 40 € desde que repartiste» en vez de
 * encoger las demás categorías por tu cuenta.
 *
 * @param {string} categoria
 * @param {number | null} importe  céntimos positivos; null la saca del plan
 * @param {object} contexto
 * @param {string} contexto.mes      'yyyy-mm'
 * @param {number} contexto.residuo  el que hay al cuadrar
 * @param {string} contexto.hoy
 */
export async function ponerAsignacion(categoria, importe, { mes, residuo, hoy }) {
  const actual = /** @type {any} */ (await leer('planes', mes))
  const asignado = { ...(actual?.asignado ?? {}) }
  if (importe === null) delete asignado[categoria]
  else asignado[categoria] = Math.abs(importe)
  return escribir('planes', { id: mes, asignado, residuo, sello: hoy })
}

/** Un plan entero: la propuesta inicial, o el recuadre de un clic. */
export async function ponerPlan(plan) {
  return escribir('planes', {
    id: plan.mes,
    asignado: plan.asignado,
    residuo: plan.residuo,
    sello: plan.sello,
  })
}

/**
 * Los presupuestos por categoría no tenían mes: valían para siempre. El plan sí
 * es de un mes concreto, así que lo que ya habías fijado se convierte en el
 * plan del mes en curso.
 *
 * Los registros viejos no se borran, sólo se dejan de leer. Borrarlos aquí
 * obligaría a poner lápidas para que la sincronización no los resucitase, y no
 * merece la pena por un puñado de importes: una marca en los ajustes basta para
 * no migrar dos veces.
 *
 * @param {object} contexto
 * @param {string} contexto.mes
 * @param {number} contexto.residuo
 * @param {string} contexto.hoy
 * @returns {Promise<boolean>} si ha migrado algo
 */
export async function migrarPresupuestosAlPlan({ mes, residuo, hoy }) {
  if (await leer('ajustes', 'presupuestosMigrados')) return false

  const viejos = /** @type {any[]} */ (await leerTodo('presupuestos'))
  const yaHayPlan = await leer('planes', mes)
  if (viejos.length > 0 && !yaHayPlan) {
    /** @type {Record<string, number>} */
    const asignado = {}
    for (const p of viejos) asignado[p.id] = Math.abs(p.importe)
    await escribir('planes', { id: mes, asignado, residuo, sello: hoy })
  }

  await escribir('ajustes', { id: 'presupuestosMigrados', valor: hoy })
  return viejos.length > 0 && !yaHayPlan
}

/** @param {Objetivo} objetivo */
export async function ponerObjetivo(objetivo) {
  return escribir('objetivos', { ...objetivo })
}

/** @param {string} id */
export async function quitarObjetivo(id) {
  return borrar('objetivos', id)
}

/** @param {Apunte} apunte */
export async function ponerApunte(apunte) {
  return escribir('patrimonio', { ...apunte })
}

/** @param {string} id */
export async function quitarApunte(id) {
  return borrar('patrimonio', id)
}

/** @param {number} centimos */
export async function ponerColchon(centimos) {
  return escribir('ajustes', { id: 'colchon', valor: Math.abs(centimos) })
}

/** @param {number} meses  0 = mirarlo todo */
export async function ponerVentanaRitmo(meses) {
  return escribir('ajustes', { id: 'ventanaRitmo', valor: Math.max(0, Math.round(meses)) })
}

/**
 * Saltarse un cobro un mes concreto, sin darlo de baja: el mes que viene vuelve.
 * @param {string} reciboId
 * @param {string} mes  yyyy-mm
 * @param {boolean} saltado
 */
export async function ponerSaltado(reciboId, mes, saltado) {
  const id = `${reciboId}|${mes}`
  if (!saltado) return borrar('saltados', id)
  return escribir('saltados', { id })
}

/**
 * Cambia cómo se trata un recibo al prever.
 *
 * Cada respuesta se guarda por separado y no en un bulto común: si viajaran
 * todas juntas, contestar en el móvil borraría lo contestado en el portátil
 * sólo por ser más reciente el bulto entero.
 * @param {string} reciboId
 * @param {Trato | null} trato  null lo devuelve a fijo
 */
export async function ponerTrato(reciboId, trato) {
  if (trato === null || trato === 'fijo') return borrar('tratos', reciboId)
  return escribir('tratos', { id: reciboId, trato })
}

/**
 * Cómo se llama un recibo. El banco pone «PayPal» a dos suscripciones
 * distintas y a cien compras; el nombre de verdad sólo lo sabe quien paga.
 * @param {string} reciboId
 * @param {string} nombre  vacío lo devuelve al del banco
 */
export async function ponerApodo(reciboId, nombre) {
  const limpio = nombre.trim()
  if (limpio === '') return borrar('apodos', reciboId)
  return escribir('apodos', { id: reciboId, nombre: limpio.slice(0, 40) })
}

/** Identificador corto y único para lo que crea el usuario. */
export function nuevoId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}
