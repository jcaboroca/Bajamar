// @ts-check
/**
 * Almacén local sobre IndexedDB, sin biblioteca intermedia.
 *
 * Todo vive en el navegador. No hay servidor al que enviar nada, y esa es la
 * razón de que la aplicación exista: los extractos bancarios de alguien no
 * tienen por qué pasar por la máquina de un tercero.
 */

const NOMBRE = 'bajamar'
const VERSION = 2

/**
 * Todo lo que el usuario decide a mano vive separado de los movimientos: si
 * reimporta el extracto, sus correcciones siguen ahí.
 */
export const ALMACENES = [
  'movimientos',
  'ajustes',
  'reglas',      // entidadId → categoría elegida por el usuario
  'bultos',      // gastos futuros anotados a mano
  'retoques',    // correcciones sobre un movimiento concreto
  'objetivos',
  'presupuestos',
  'patrimonio',
]

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
  await transaccion(db, almacen, 'readwrite', (t) => t.objectStore(almacen).put(valor))
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
 * @param {string} almacen
 * @param {string} id
 */
export async function borrar(almacen, id) {
  const db = await abrir()
  await transaccion(db, almacen, 'readwrite', (t) => t.objectStore(almacen).delete(id))
}

/** Vaciar todo: la única forma honesta de ofrecer «olvídalo todo». */
export async function vaciar() {
  const db = await abrir()
  await transaccion(db, ALMACENES, 'readwrite', (t) => {
    for (const nombre of ALMACENES) t.objectStore(nombre).clear()
  })
}
