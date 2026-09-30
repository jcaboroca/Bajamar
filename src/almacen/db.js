// @ts-check
/**
 * Almacén local sobre IndexedDB, sin biblioteca intermedia.
 *
 * Todo vive en el navegador. No hay servidor al que enviar nada, y esa es la
 * razón de que la aplicación exista: los extractos bancarios de alguien no
 * tienen por qué pasar por la máquina de un tercero.
 */

const NOMBRE = 'bajamar'
const VERSION = 13

/**
 * Todo lo que el usuario decide a mano vive separado de los movimientos: si
 * reimporta el extracto, sus correcciones siguen ahí.
 */
const ALMACENES = [
  'movimientos',
  'ajustes',
  'reglas',      // entidadId → categoría elegida por el usuario
  'tratos',      // reciboId → si va a volver
  'apodos',      // reciboId → cómo lo llama el usuario
  'unicos',      // entidadId → pasó una vez y no va a repetirse
  'anuales',     // entidadId → pasó una vez y vuelve cada año
  'ritmos',      // reciboId → cada cuánto llega, cuando tú lo sabes mejor que yo
  'manuales',    // recibos que no pasan por la cuenta y me dictas tú
  'apagadas',    // categoría → no toca esta temporada, fuera del goteo
  'saltados',    // reciboId|mes → este mes concreto no se paga
  'inversiones', // reciboId → sale de la cuenta pero no se gasta (o lo contrario)
  'devueltos',   // reciboId → quién te devuelve este recibo
  'bultos',      // gastos futuros anotados a mano
  'retoques',    // correcciones sobre un movimiento concreto
  'objetivos',
  'presupuestos', // heredado: se migra a 'planes' y deja de escribirse
  'planes',       // mes → en qué has decidido que se va el día a día
  'patrimonio',
  'lapidas',     // lo borrado, para que no resucite al sincronizar
]

/** Lo que viaja entre dispositivos: todo menos los movimientos. */
const DECISIONES = ALMACENES.filter((n) => n !== 'movimientos')

/** @type {IDBDatabase | null} */
let abierta = null

export function abrir() {
  if (abierta) return Promise.resolve(abierta)
  return new Promise((resuelve, rechaza) => {
    const peticion = indexedDB.open(NOMBRE, VERSION)
    peticion.onupgradeneeded = () => {
      const db = peticion.result
      if (!db.objectStoreNames.contains('movimientos')) {
        const store = db.createObjectStore('movimientos', { keyPath: 'id' })
        store.createIndex('por-fecha', 'fecha')
      }
      for (const nombre of ALMACENES) {
        if (nombre === 'movimientos') continue
        if (!db.objectStoreNames.contains(nombre)) db.createObjectStore(nombre, { keyPath: 'id' })
      }
    }
    peticion.onsuccess = () => {
      abierta = peticion.result
      resuelve(abierta)
    }
    peticion.onerror = () => rechaza(peticion.error)
  })
}

/**
 * @param {IDBDatabase} db
 * @param {string | string[]} almacenes
 * @param {IDBTransactionMode} modo
 * @param {(t: IDBTransaction) => void} trabajo
 */
function transaccion(db, almacenes, modo, trabajo) {
  return new Promise((resuelve, rechaza) => {
    const t = db.transaction(almacenes, modo)
    t.oncomplete = () => resuelve(undefined)
    t.onerror = () => rechaza(t.error)
    t.onabort = () => rechaza(t.error)
    trabajo(t)
  })
}

/**
 * Guarda movimientos. El identificador es determinista, así que reimportar el
 * mismo extracto sobrescribe en lugar de duplicar.
 * @param {import('../dominio/tipos.js').Movimiento[]} movimientos
 */
export async function guardarMovimientos(movimientos) {
  const db = await abrir()
  await transaccion(db, 'movimientos', 'readwrite', (t) => {
    const store = t.objectStore('movimientos')
    for (const m of movimientos) store.put(m)
  })
  return movimientos.length
}

/** @returns {Promise<import('../dominio/tipos.js').Movimiento[]>} */
export async function leerMovimientos() {
  const db = await abrir()
  return new Promise((resuelve, rechaza) => {
    const peticion = db.transaction('movimientos', 'readonly').objectStore('movimientos').getAll()
    peticion.onsuccess = () => resuelve(peticion.result)
    peticion.onerror = () => rechaza(peticion.error)
  })
}

/**
 * @param {string} almacen
 * @param {string} id
 */
export async function leer(almacen, id) {
  const db = await abrir()
  return new Promise((resuelve, rechaza) => {
    const peticion = db.transaction(almacen, 'readonly').objectStore(almacen).get(id)
    peticion.onsuccess = () => resuelve(peticion.result ?? null)
    peticion.onerror = () => rechaza(peticion.error)
  })
}

/**
 * @param {string} almacen
 * @param {{ id: string } & Record<string, unknown>} valor
 */
export async function escribir(almacen, valor) {
  const db = await abrir()
  // La hora de la decisión es lo que permite que dos dispositivos se pongan de
  // acuerdo sin que gane el último en encenderse, sino el último en decidir.
  const sellado = { ...valor, tocado: new Date().toISOString() }
  await transaccion(db, almacen, 'readwrite', (t) => t.objectStore(almacen).put(sellado))
}

/** @param {string} almacen */
export async function leerTodo(almacen) {
  const db = await abrir()
  return new Promise((resuelve, rechaza) => {
    const peticion = db.transaction(almacen, 'readonly').objectStore(almacen).getAll()
    peticion.onsuccess = () => resuelve(peticion.result)
    peticion.onerror = () => rechaza(peticion.error)
  })
}

/**
 * Borrar deja lápida. Sin ella, el otro dispositivo volvería a mandar lo que
 * acabas de quitar y reaparecería sin explicación.
 * @param {string} almacen
 * @param {string} id
 */
export async function borrar(almacen, id) {
  const db = await abrir()
  await transaccion(db, [almacen, 'lapidas'], 'readwrite', (t) => {
    t.objectStore(almacen).delete(id)
    t.objectStore('lapidas').put({ id: `${almacen}/${id}`, tocado: new Date().toISOString() })
  })
}

/** Vaciar todo: la única forma honesta de ofrecer «olvídalo todo». */
export async function vaciar() {
  const db = await abrir()
  await transaccion(db, ALMACENES, 'readwrite', (t) => {
    for (const nombre of ALMACENES) t.objectStore(nombre).clear()
  })
}

/**
 * @typedef {Record<string, Array<{ id: string, tocado?: string }>>} Decisiones
 */

/**
 * Todo lo que el usuario ha decidido, tal cual está guardado.
 * @returns {Promise<Decisiones>}
 */
export async function leerDecisiones() {
  const filas = await Promise.all(DECISIONES.map((n) => leerTodo(n)))
  return Object.fromEntries(DECISIONES.map((n, i) => [n, filas[i]]))
}

/**
 * Si aquí hay algo que al buzón no le consta. Contar cuántas decisiones tiene
 * cada lado no vale: el que tiene menos puede ser justo el que tiene la única
 * que falta, y entonces no subiría nunca.
 * @param {Decisiones} mias
 * @param {Decisiones} suyas
 */
export function hayQueSubir(mias, suyas) {
  const cuando = (/** @type {{ tocado?: string } | undefined} */ fila) => fila?.tocado ?? ''
  for (const [almacen, filas] of Object.entries(mias)) {
    const alla = new Map((suyas[almacen] ?? []).map((f) => [f.id, f]))
    for (const fila of filas) {
      if (!alla.has(fila.id)) return true
      if (cuando(alla.get(fila.id)) < cuando(fila)) return true
    }
  }
  return false
}

/**
 * Decide qué hacer al juntar lo de dos dispositivos, sin tocar nada todavía.
 *
 * La regla es una sola y vale para todo: gana la versión decidida más tarde.
 * Las lápidas compiten en la misma comparación, así que lo borrado en el móvil
 * se borra aquí, pero si después lo vuelves a poner aquí, vuelve —que es justo
 * lo que uno espera al volver a ponerlo.
 * @param {Decisiones} mias
 * @param {Decisiones} entrantes
 */
export function fundir(mias, entrantes) {
  const cuando = (/** @type {{ tocado?: string } | undefined} */ fila) => fila?.tocado ?? ''
  /** @type {Map<string, { id: string, tocado?: string }>} */
  const lapidas = new Map()
  for (const fila of [...(mias.lapidas ?? []), ...(entrantes.lapidas ?? [])]) {
    if (cuando(fila) > cuando(lapidas.get(fila.id))) lapidas.set(fila.id, fila)
  }

  /** @type {Array<[string, { id: string, tocado?: string }]>} */
  const aEscribir = []
  /** @type {Array<[string, string]>} */
  const aBorrar = []

  for (const almacen of DECISIONES) {
    if (almacen === 'lapidas') continue
    const aqui = new Map((mias[almacen] ?? []).map((f) => [f.id, f]))
    for (const fila of entrantes[almacen] ?? []) {
      // Lo que llega ya enterrado no se escribe para borrarlo acto seguido:
      // parecería un cambio, y se anunciaría uno en cada sincronización.
      if (cuando(lapidas.get(`${almacen}/${fila.id}`)) > cuando(fila)) continue
      if (aqui.has(fila.id) && cuando(aqui.get(fila.id)) >= cuando(fila)) continue
      aEscribir.push([almacen, fila])
      aqui.set(fila.id, fila)
    }
    for (const fila of mias[almacen] ?? []) {
      if (cuando(lapidas.get(`${almacen}/${fila.id}`)) > cuando(fila)) aBorrar.push([almacen, fila.id])
    }
  }

  const aEnterrar = [...lapidas.values()].filter((l) => {
    const mia = (mias.lapidas ?? []).find((o) => o.id === l.id)
    return cuando(mia) < cuando(l)
  })
  return { aEscribir, aBorrar, aEnterrar }
}

/**
 * @param {Decisiones} entrantes
 * @returns {Promise<number>} cuántas cosas han cambiado
 */
export async function mezclarDecisiones(entrantes) {
  const db = await abrir()
  const { aEscribir, aBorrar, aEnterrar } = fundir(await leerDecisiones(), entrantes)
  if (aEscribir.length + aBorrar.length + aEnterrar.length === 0) return 0

  await transaccion(db, DECISIONES, 'readwrite', (t) => {
    for (const [almacen, fila] of aEscribir) t.objectStore(almacen).put(fila)
    for (const [almacen, id] of aBorrar) t.objectStore(almacen).delete(id)
    for (const lapida of aEnterrar) t.objectStore('lapidas').put(lapida)
  })
  return aEscribir.length + aBorrar.length
}
