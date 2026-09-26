// @ts-check
/**
 * Lector mínimo del contenedor OLE2 (Compound File Binary) que envuelve a los
 * .xls de BIFF8. Sólo hace falta extraer un flujo por nombre: "Workbook".
 *
 * Los ficheros pequeños (la tarjeta son 36 filas) viven en el mini-flujo, con
 * su propia tabla de asignación. Los grandes (la cuenta, 1136 filas) van por
 * sectores normales. Hay que soportar los dos caminos.
 */

const FIRMA = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const FIN_DE_CADENA = -2
const SECTOR_LIBRE = -1

/**
 * @param {ArrayBuffer} datos
 * @returns {boolean}
 */
export function esOle2(datos) {
  if (datos.byteLength < 512) return false
  const b = new Uint8Array(datos, 0, 8)
  return FIRMA.every((v, i) => b[i] === v)
}

/**
 * Extrae un flujo del contenedor por nombre.
 * @param {ArrayBuffer} datos
 * @param {string[]} nombres nombres aceptados, en orden de preferencia
 * @returns {Uint8Array}
 */
export function leerFlujo(datos, nombres) {
  if (!esOle2(datos)) {
    throw new Error('El fichero no es un documento OLE2 (.xls de Excel 97-2003).')
  }
  const vista = new DataView(datos)
  const bytes = new Uint8Array(datos)

  const tamSector = 1 << vista.getUint16(30, true)
  const tamMini = 1 << vista.getUint16(32, true)
  const numFat = vista.getInt32(44, true)
  const dirInicio = vista.getInt32(48, true)
  const corteMini = vista.getUint32(56, true)
  const miniFatInicio = vista.getInt32(60, true)
  const numMiniFat = vista.getInt32(64, true)
  const difatInicio = vista.getInt32(68, true)
  const numDifat = vista.getInt32(72, true)

  /** @param {number} n */
  const sector = (n) => {
    const desde = 512 + n * tamSector
    if (desde + tamSector > bytes.length) {
      throw new Error(`Sector ${n} fuera del fichero: está truncado.`)
    }
    return bytes.subarray(desde, desde + tamSector)
  }

  // DIFAT: los primeros 109 punteros van en la cabecera, el resto encadenados.
  const punterosFat = []
  for (let i = 0; i < 109; i += 1) punterosFat.push(vista.getInt32(76 + i * 4, true))
  let siguiente = difatInicio
  for (let i = 0; i < numDifat && siguiente >= 0; i += 1) {
    const s = sector(siguiente)
    const v = new DataView(s.buffer, s.byteOffset, s.byteLength)
    const cabenAqui = tamSector / 4 - 1
    for (let j = 0; j < cabenAqui; j += 1) punterosFat.push(v.getInt32(j * 4, true))
    siguiente = v.getInt32(cabenAqui * 4, true)
  }

  /** @param {number[]} sectores */
  const tablaDesde = (sectores) => {
    const tabla = []
    for (const s of sectores) {
      if (s < 0) continue
      const d = sector(s)
      const v = new DataView(d.buffer, d.byteOffset, d.byteLength)
      for (let i = 0; i < tamSector / 4; i += 1) tabla.push(v.getInt32(i * 4, true))
    }
    return tabla
  }

  const fat = tablaDesde(punterosFat.slice(0, Math.max(numFat, 0)))

  /**
   * @param {number} inicio
   * @param {number[]} tabla
   */
  const cadena = (inicio, tabla) => {
    const salida = []
    const vistos = new Set()
    let c = inicio
    while (c >= 0 && c < tabla.length) {
      if (vistos.has(c)) throw new Error('Cadena de sectores circular: fichero corrupto.')
      vistos.add(c)
      salida.push(c)
      const paso = tabla[c]
      if (paso === FIN_DE_CADENA || paso === SECTOR_LIBRE) break
      c = paso
    }
    return salida
  }

  /** @param {number[]} sectores */
  const unir = (sectores) => {
    const salida = new Uint8Array(sectores.length * tamSector)
    sectores.forEach((s, i) => salida.set(sector(s), i * tamSector))
    return salida
  }

  // Directorio: entradas de 128 bytes.
  const directorio = unir(cadena(dirInicio, fat))
  const vistaDir = new DataView(directorio.buffer, directorio.byteOffset, directorio.byteLength)

  let raizInicio = -1
  let raizTam = 0
  /** @type {Map<string, { inicio: number, tam: number }>} */
  const flujos = new Map()

  for (let off = 0; off + 128 <= directorio.length; off += 128) {
    const largoNombre = vistaDir.getUint16(off + 64, true)
    if (largoNombre < 2) continue
    let nombre = ''
    for (let i = 0; i < largoNombre - 2; i += 2) {
      nombre += String.fromCharCode(vistaDir.getUint16(off + i, true))
    }
    const tipo = directorio[off + 66]
    const inicio = vistaDir.getInt32(off + 116, true)
    const tam = vistaDir.getUint32(off + 120, true)
    if (tipo === 5) {
      raizInicio = inicio
      raizTam = tam
    } else if (tipo === 2) {
      flujos.set(nombre, { inicio, tam })
    }
  }

  const elegido = nombres.map((n) => flujos.get(n)).find((f) => f !== undefined)
  if (!elegido) {
    throw new Error(
      `No se encontró ninguno de los flujos ${nombres.join(', ')}. ` +
        `El fichero contiene: ${[...flujos.keys()].join(', ') || '(ninguno)'}.`,
    )
  }

  if (elegido.tam >= corteMini) {
    return unir(cadena(elegido.inicio, fat)).subarray(0, elegido.tam)
  }

  // Flujo pequeño: vive dentro del mini-flujo, troceado en mini-sectores.
  const miniFat = tablaDesde(cadena(miniFatInicio, fat).slice(0, Math.max(numMiniFat, 0)))
  const miniFlujo = unir(cadena(raizInicio, fat)).subarray(0, raizTam)
  const trozos = cadena(elegido.inicio, miniFat)
  const salida = new Uint8Array(trozos.length * tamMini)
  trozos.forEach((t, i) => {
    salida.set(miniFlujo.subarray(t * tamMini, (t + 1) * tamMini), i * tamMini)
  })
  return salida.subarray(0, elegido.tam)
}
