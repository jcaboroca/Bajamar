// @ts-check
/**
 * Patrimonio: lo que tienes menos lo que debes.
 *
 * Aquí no hay nada que adivinar. Un piso, un coche o un fondo valen lo que tú
 * digas que valen el día que lo dices, y la aplicación se limita a guardar esa
 * afirmación con su fecha. Inventar una revalorización sería fabricar una
 * curva bonita sobre datos que nadie ha medido.
 *
 * Cada apunte es una foto, no un movimiento. El valor de un activo es el de su
 * foto más reciente: volver a anotar «furgoneta 12.000 €» sustituye a la
 * anterior en lugar de sumarse, que es como funciona la cabeza de cualquiera.
 */

/**
 * @typedef {'efectivo' | 'cuentas' | 'inversiones' | 'cripto' | 'bienes' | 'deudas'} Grupo
 */

/**
 * @typedef {object} Apunte
 * @property {string} id
 * @property {string} nombre
 * @property {Grupo} grupo
 * @property {number} valor   céntimos; las deudas, en negativo
 * @property {string} fecha   ISO
 */

/** @type {Record<Grupo, string>} */
export const GRUPOS = {
  efectivo: 'Efectivo',
  cuentas: 'Cuentas',
  inversiones: 'Inversiones',
  cripto: 'Cripto',
  bienes: 'Bienes',
  deudas: 'Deudas',
}

/** El orden en que se enseñan: de lo más líquido a lo que no lo es. */
export const ORDEN_GRUPOS = /** @type {Grupo[]} */ (
  ['efectivo', 'cuentas', 'inversiones', 'cripto', 'bienes', 'deudas']
)

/**
 * Deja un solo apunte por partida: el último hasta la fecha pedida.
 * @param {Apunte[]} apuntes
 * @param {string} [hasta] ISO
 * @returns {Apunte[]}
 */
export function vigentes(apuntes, hasta) {
  /** @type {Map<string, Apunte>} */
  const ultimo = new Map()
  for (const a of apuntes) {
    if (hasta && a.fecha > hasta) continue
    const llave = `${a.grupo}\u0000${a.nombre.trim().toLowerCase()}`
    const previo = ultimo.get(llave)
    if (!previo || a.fecha >= previo.fecha) ultimo.set(llave, a)
  }
  return [...ultimo.values()]
}

/**
 * @typedef {object} Balance
 * @property {number} activos
 * @property {number} pasivos    negativo
 * @property {number} neto
 * @property {Array<{ grupo: Grupo, nombre: string, total: number, partidas: Apunte[] }>} porGrupo
 */

/**
 * @param {Apunte[]} apuntes
 * @param {string} [hasta]
 * @returns {Balance}
 */
export function balance(apuntes, hasta) {
  const foto = vigentes(apuntes, hasta)
  let activos = 0
  let pasivos = 0

  /** @type {Map<Grupo, Apunte[]>} */
  const porGrupo = new Map()
  for (const a of foto) {
    const valor = a.grupo === 'deudas' ? -Math.abs(a.valor) : a.valor
    if (valor < 0) pasivos += valor
    else activos += valor
    const lista = porGrupo.get(a.grupo) ?? []
    lista.push({ ...a, valor })
    porGrupo.set(a.grupo, lista)
  }

  return {
    activos,
    pasivos,
    neto: activos + pasivos,
    porGrupo: ORDEN_GRUPOS.filter((g) => porGrupo.has(g)).map((grupo) => {
      const partidas = (porGrupo.get(grupo) ?? []).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor))
      return {
        grupo,
        nombre: GRUPOS[grupo],
        total: partidas.reduce((t, p) => t + p.valor, 0),
        partidas,
      }
    }),
  }
}

/**
 * Patrimonio neto en cada fecha en la que algo cambió.
 *
 * Sólo hay puntos donde hay datos. Entre dos anotaciones la línea es recta
 * porque no se sabe otra cosa, y fingir lo contrario sería inventar.
 *
 * @param {Apunte[]} apuntes
 * @param {string} [hasta] ISO; añade un punto final con la foto de hoy
 * @returns {Array<{ fecha: string, neto: number }>}
 */
export function evolucion(apuntes, hasta) {
  const fechas = [...new Set(apuntes.map((a) => a.fecha))].sort()
  if (hasta && !fechas.includes(hasta) && fechas.length > 0) fechas.push(hasta)
  return fechas.map((fecha) => ({ fecha, neto: balance(apuntes, fecha).neto }))
}

/**
 * @param {Array<{ fecha: string, neto: number }>} serie
 * @param {number} meses
 */
export function variacion(serie, meses) {
  if (serie.length < 2) return null
  const fin = serie[serie.length - 1]
  const [a, m, d] = fin.fecha.split('-').map(Number)
  const total = a * 12 + (m - 1) - meses
  const corte = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  const anteriores = serie.filter((p) => p.fecha <= corte)
  const inicio = anteriores[anteriores.length - 1] ?? serie[0]
  if (inicio === fin) return null

  return {
    desde: inicio.fecha,
    absoluta: fin.neto - inicio.neto,
    relativa: inicio.neto !== 0 ? (fin.neto - inicio.neto) / Math.abs(inicio.neto) : 0,
  }
}
