// @ts-check
/**
 * Decodificador de los registros BIFF8 que necesitamos para leer una hoja:
 * cadenas compartidas, texto, números y RK empaquetados.
 *
 * No interpreta formatos ni fechas: el Sabadell manda las fechas como texto
 * ("28/09/2026") y los importes como número o como texto según el fichero,
 * así que devolvemos el valor crudo y que decida el parser de cada plantilla.
 */

const BOF = 0x0809
const EOF_REC = 0x000a
const BOUNDSHEET = 0x0085
const CONTINUE = 0x003c
const SST = 0x00fc
const LABELSST = 0x00fd
const LABEL = 0x0204
const NUMBER = 0x0203
const RK = 0x027e
const MULRK = 0x00bd

/** @typedef {string | number | null} Celda */

/**
 * @param {Uint8Array} flujo
 * @returns {Array<{ id: number, inicio: number, datos: Uint8Array }>}
 */
function trocear(flujo) {
  const vista = new DataView(flujo.buffer, flujo.byteOffset, flujo.byteLength)
  const registros = []
  let p = 0
  while (p + 4 <= flujo.length) {
    const id = vista.getUint16(p, true)
    const largo = vista.getUint16(p + 2, true)
    if (p + 4 + largo > flujo.length) break
    registros.push({ id, inicio: p, datos: flujo.subarray(p + 4, p + 4 + largo) })
    p += 4 + largo
  }
  return registros
}

/**
 * Recorre una secuencia de bloques (el SST más sus CONTINUE) como si fuera
 * continua, pero sabiendo dónde están las costuras: al cruzar una, una cadena
 * partida vuelve a declarar su codificación en el primer byte del bloque.
 */
class Costura {
  /** @param {Uint8Array[]} bloques */
  constructor(bloques) {
    this.bloques = bloques
    this.i = 0
    this.p = 0
  }

  get actual() {
    const b = this.bloques[this.i]
    if (!b) throw new Error('Tabla de cadenas compartidas truncada.')
    return b
  }

  /** @param {number} n */
  asegurar(n) {
    while (this.i < this.bloques.length && this.actual.length - this.p < n) {
      this.i += 1
      this.p = 0
    }
  }

  byte() {
    this.asegurar(1)
    const v = this.actual[this.p]
    this.p += 1
    return v ?? 0
  }

  uint16() {
    this.asegurar(2)
    const b = this.actual
    const v = b[this.p] | (b[this.p + 1] << 8)
    this.p += 2
    return v
  }

  int32() {
    this.asegurar(4)
    const b = this.actual
    const v = b[this.p] | (b[this.p + 1] << 8) | (b[this.p + 2] << 16) | (b[this.p + 3] << 24)
    this.p += 4
    return v
  }

  /** @param {number} n */
  saltar(n) {
    let quedan = n
    while (quedan > 0 && this.i < this.bloques.length) {
      const hay = this.actual.length - this.p
      if (hay <= 0) {
        this.i += 1
        this.p = 0
        continue
      }
      const paso = Math.min(quedan, hay)
      this.p += paso
      quedan -= paso
    }
  }

  /**
   * @param {number} cch número de caracteres, no de bytes
   * @param {boolean} anchoDoble
   */
  texto(cch, anchoDoble) {
    let quedan = cch
    let doble = anchoDoble
    let salida = ''
    while (quedan > 0) {
      if (this.p >= this.actual.length) {
        this.i += 1
        this.p = 0
        if (this.i >= this.bloques.length) break
        doble = (this.byte() & 1) === 1 // el CONTINUE redeclara la codificación
      }
      const hay = this.actual.length - this.p
      const puedo = doble ? Math.min(quedan, hay >> 1) : Math.min(quedan, hay)
      if (puedo <= 0) {
        this.p = this.actual.length
        continue
      }
      const b = this.actual
      for (let k = 0; k < puedo; k += 1) {
        salida += doble
          ? String.fromCharCode(b[this.p + k * 2] | (b[this.p + k * 2 + 1] << 8))
          : String.fromCharCode(b[this.p + k] ?? 0)
      }
      this.p += doble ? puedo * 2 : puedo
      quedan -= puedo
    }
    return salida
  }
}

/**
 * @param {Uint8Array[]} bloques
 * @returns {string[]}
 */
function leerCadenas(bloques) {
  const c = new Costura(bloques)
  c.saltar(4) // cstTotal, que no usamos
  const unicas = c.int32()
  const cadenas = []
  for (let n = 0; n < unicas; n += 1) {
    const cch = c.uint16()
    const grbit = c.byte()
    const anchoDoble = (grbit & 0x01) === 1
    const tieneFonetica = (grbit & 0x04) !== 0
    const tieneFormato = (grbit & 0x08) !== 0
    const runs = tieneFormato ? c.uint16() : 0
    const extra = tieneFonetica ? c.int32() : 0
    cadenas.push(c.texto(cch, anchoDoble))
    c.saltar(runs * 4 + extra)
  }
  return cadenas
}

/** @param {number} rk */
function decodificarRk(rk) {
  const porCien = (rk & 1) === 1
  const entero = (rk & 2) === 2
  let valor
  if (entero) {
    valor = rk >> 2
  } else {
    const buf = new ArrayBuffer(8)
    const v = new DataView(buf)
    v.setUint32(4, (rk & 0xfffffffc) >>> 0, true)
    valor = v.getFloat64(0, true)
  }
  return porCien ? valor / 100 : valor
}

/**
 * Lee la primera hoja de un flujo "Workbook" y la devuelve como rejilla.
 * @param {Uint8Array} flujo
 * @returns {Celda[][]}
 */
export function leerHoja(flujo) {
  const registros = trocear(flujo)
  if (registros.length === 0) throw new Error('El flujo Workbook está vacío.')

  /** @type {string[]} */
  let cadenas = []
  /** @type {number[]} */
  const hojas = []

  for (let i = 0; i < registros.length; i += 1) {
    const r = registros[i]
    if (r.id === BOUNDSHEET) {
      hojas.push(new DataView(r.datos.buffer, r.datos.byteOffset, r.datos.byteLength).getInt32(0, true))
    } else if (r.id === SST) {
      const bloques = [r.datos]
      for (let j = i + 1; j < registros.length && registros[j].id === CONTINUE; j += 1) {
        bloques.push(registros[j].datos)
      }
      cadenas = leerCadenas(bloques)
    }
  }

  const desde = hojas.length > 0 ? registros.findIndex((r) => r.inicio === hojas[0] && r.id === BOF) : 0
  const primero = desde === -1 ? 0 : desde

  /** @type {Celda[][]} */
  const rejilla = []
  /**
   * @param {number} fila
   * @param {number} col
   * @param {Celda} valor
   */
  const poner = (fila, col, valor) => {
    let f = rejilla[fila]
    if (!f) {
      f = []
      rejilla[fila] = f
    }
    f[col] = valor
  }

  for (let i = primero; i < registros.length; i += 1) {
    const { id, datos } = registros[i]
    if (id === EOF_REC && i > primero) break
    if (datos.length < 4) continue
    const v = new DataView(datos.buffer, datos.byteOffset, datos.byteLength)
    const fila = v.getUint16(0, true)
    const col = v.getUint16(2, true)

    if (id === LABELSST && datos.length >= 10) {
      poner(fila, col, cadenas[v.getUint32(6, true)] ?? '')
    } else if (id === NUMBER && datos.length >= 14) {
      poner(fila, col, v.getFloat64(6, true))
    } else if (id === RK && datos.length >= 10) {
      poner(fila, col, decodificarRk(v.getInt32(6, true)))
    } else if (id === MULRK && datos.length >= 6) {
      const ultima = v.getUint16(datos.length - 2, true)
      for (let c = col, off = 4; c <= ultima && off + 6 <= datos.length - 2; c += 1, off += 6) {
        poner(fila, c, decodificarRk(v.getInt32(off + 2, true)))
      }
    } else if (id === LABEL && datos.length >= 9) {
      const cch = v.getUint16(6, true)
      const doble = (datos[8] & 1) === 1
      let s = ''
      for (let k = 0; k < cch; k += 1) {
        s += doble
          ? String.fromCharCode(v.getUint16(9 + k * 2, true))
          : String.fromCharCode(datos[9 + k] ?? 0)
      }
      poner(fila, col, s)
    }
  }

  // Rellenar huecos para que el consumidor pueda indexar sin comprobar.
  const ancho = rejilla.reduce((m, f) => Math.max(m, f?.length ?? 0), 0)
  for (let f = 0; f < rejilla.length; f += 1) {
    const actual = rejilla[f] ?? []
    rejilla[f] = Array.from({ length: ancho }, (_, c) => actual[c] ?? null)
  }
  return rejilla
}
