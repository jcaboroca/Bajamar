// @ts-check

/**
 * Cifrado de los movimientos antes de que salgan del dispositivo.
 *
 * La premisa de Bajamar es que tus datos no los ve nadie. En cuanto hay
 * sincronización entre dos dispositivos hay un intermediario, así que la única
 * forma de mantener la promesa es que el intermediario reciba algo que no puede
 * leer: se cifra aquí, con una clave que se deriva de la contraseña y que nunca
 * se transmite.
 *
 * AES-GCM porque además de cifrar autentica: si alguien manipula un byte del
 * mensaje, descifrar falla en vez de devolver basura silenciosamente.
 *
 * PBKDF2 con muchas iteraciones porque una contraseña humana tiene poca
 * entropía. Sin derivación lenta, probar millones de candidatas contra el
 * fichero robado es cuestión de minutos.
 */

/** Recomendación OWASP para PBKDF2-HMAC-SHA256 (2023). */
const ITERACIONES = 600_000

const SAL_BYTES = 16
const IV_BYTES = 12

export class ContrasenaInvalida extends Error {
  constructor() {
    super('La contraseña no abre estos datos.')
    this.name = 'ContrasenaInvalida'
  }
}

/**
 * @typedef {object} Sobre
 * @property {1} v
 * @property {'PBKDF2-SHA256'} kdf
 * @property {number} iteraciones
 * @property {string} sal   base64
 * @property {string} iv    base64
 * @property {string} datos base64
 */

/** @param {ArrayBuffer | Uint8Array} bytes */
function aBase64(bytes) {
  const vista = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bruto = ''
  // De 8 KB en 8 KB: `String.fromCharCode(...miles)` desborda la pila.
  for (let i = 0; i < vista.length; i += 8192) {
    bruto += String.fromCharCode(...vista.subarray(i, i + 8192))
  }
  return btoa(bruto)
}

/** @param {string} texto */
function deBase64(texto) {
  const bruto = atob(texto)
  const bytes = new Uint8Array(bruto.length)
  for (let i = 0; i < bruto.length; i += 1) bytes[i] = bruto.charCodeAt(i)
  return bytes
}

/**
 * @param {string} contrasena
 * @param {Uint8Array} sal
 * @param {number} iteraciones
 */
async function derivarClave(contrasena, sal, iteraciones) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(contrasena.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: sal, iterations: iteraciones, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * @param {unknown} contenido  cualquier cosa serializable a JSON
 * @param {string} contrasena
 * @returns {Promise<Sobre>}
 */
export async function cifrar(contenido, contrasena) {
  if (!contrasena) throw new Error('Hace falta una contraseña para cifrar.')
  const sal = crypto.getRandomValues(new Uint8Array(SAL_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const clave = await derivarClave(contrasena, sal, ITERACIONES)
  const claro = new TextEncoder().encode(JSON.stringify(contenido))
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, clave, claro)
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iteraciones: ITERACIONES,
    sal: aBase64(sal),
    iv: aBase64(iv),
    datos: aBase64(cifrado),
  }
}

/**
 * @param {Sobre} sobre
 * @param {string} contrasena
 * @returns {Promise<any>}
 */
export async function descifrar(sobre, contrasena) {
  if (!sobre || sobre.v !== 1) throw new Error('Formato de sobre desconocido.')
  const clave = await derivarClave(contrasena, deBase64(sobre.sal), sobre.iteraciones)
  let claro
  try {
    claro = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: deBase64(sobre.iv) },
      clave,
      deBase64(sobre.datos),
    )
  } catch {
    // AES-GCM no distingue «clave mala» de «mensaje manipulado», y está bien:
    // en ambos casos la respuesta honesta es que esto no se abre.
    throw new ContrasenaInvalida()
  }
  return JSON.parse(new TextDecoder().decode(claro))
}
