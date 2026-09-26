// @ts-check

/**
 * Llevar los datos de un dispositivo a otro sin que nadie por el camino pueda
 * leerlos.
 *
 * Todo lo que sale de aquí va dentro de un sobre de `cifrado.js`. El buz\u00f3n
 * remoto guarda bytes que no entiende, y la contraseña no viaja nunca.
 *
 * El identificador del buzón también se deriva de la contraseña, con una sal
 * distinta de la del cifrado: así no hace falta inventar cuentas ni tokens, y
 * la dirección es impredecible para quien no la sepa. Que las dos derivaciones
 * usen sales separadas es lo que impide que conocer el buzón diga nada sobre
 * la clave.
 */

import { cifrar, descifrar } from './cifrado.js'

/** Sal fija y pública: aquí no se protege un secreto, se genera un nombre. */
const SAL_BUZON = new TextEncoder().encode('bajamar/buzon/v1')

export class SinBuzon extends Error {
  constructor() {
    super('Todavía no hay nada guardado con esa contraseña.')
    this.name = 'SinBuzon'
  }
}

/**
 * @param {string} contrasena
 * @returns {Promise<string>} 32 caracteres hexadecimales
 */
export async function buzonDesde(contrasena) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(contrasena.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: SAL_BUZON, iterations: 200_000, hash: 'SHA-256' },
    material,
    128,
  )
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * @typedef {object} Maleta
 * @property {import('../dominio/tipos.js').Movimiento[]} movimientos
 * @property {import('./db.js').Decisiones} [decisiones]
 * @property {Record<string, unknown>} [ajustes] maletas viejas, antes de que viajara todo
 * @property {string} guardado ISO
 */

/**
 * @param {import('../dominio/tipos.js').Movimiento[]} movimientos
 * @param {import('./db.js').Decisiones} [decisiones]
 */
export function hacerMaleta(movimientos, decisiones = {}) {
  return { movimientos, decisiones, guardado: new Date().toISOString() }
}

/**
 * @param {string} base  URL del worker, sin barra final
 * @param {Maleta} maleta
 * @param {string} contrasena
 */
export async function subir(base, maleta, contrasena) {
  const sobre = await cifrar(maleta, contrasena)
  const respuesta = await fetch(`${base}/${await buzonDesde(contrasena)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sobre),
  })
  if (!respuesta.ok) throw new Error(`El buzón respondió ${respuesta.status}.`)
}

/**
 * @param {string} base
 * @param {string} contrasena
 * @returns {Promise<Maleta>}
 */
export async function bajar(base, contrasena) {
  const respuesta = await fetch(`${base}/${await buzonDesde(contrasena)}`)
  if (respuesta.status === 404) throw new SinBuzon()
  if (!respuesta.ok) throw new Error(`El buzón respondió ${respuesta.status}.`)
  return descifrar(await respuesta.json(), contrasena)
}

/**
 * Camino sin infraestructura: un fichero que te pasas por AirDrop.
 * Si el sistema sabe compartir ficheros, se lo damos directamente: descargarlo
 * y luego buscarlo en el móvil son dos pasos donde se pierde la gente.
 * @param {Maleta} maleta
 * @param {string} contrasena
 * @returns {Promise<'compartido' | 'descargado'>}
 */
export async function aFichero(maleta, contrasena) {
  const sobre = await cifrar(maleta, contrasena)
  const nombre = `bajamar-${maleta.guardado.slice(0, 10)}.bajamar`
  const fichero = new File([JSON.stringify(sobre)], nombre, { type: 'application/json' })

  if (navigator.canShare?.({ files: [fichero] })) {
    try {
      await navigator.share({ files: [fichero] })
      return 'compartido'
    } catch (error) {
      // Cancelar el menú de compartir no es un fallo: se cae a la descarga.
      if (error instanceof DOMException && error.name === 'AbortError') return 'compartido'
    }
  }

  const url = URL.createObjectURL(fichero)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  enlace.click()
  URL.revokeObjectURL(url)
  return 'descargado'
}

/**
 * @param {File} fichero
 * @param {string} contrasena
 * @returns {Promise<Maleta>}
 */
export async function desdeFichero(fichero, contrasena) {
  return descifrar(JSON.parse(await fichero.text()), contrasena)
}
