// @ts-check
/**
 * Saber si el código que está corriendo ya no es el último que se publicó.
 *
 * Mientras la pestaña siga viva el navegador no vuelve a pedir nada, y en el
 * móvil una pestaña vive semanas. Se publicaba un arreglo y seguías viendo el
 * fallo durante días, sin ningún motivo para sospechar que mirabas código
 * viejo. Peor: con el código viejo la base de datos se queda en su versión
 * antigua, y las decisiones que aún no existían allí no se pueden ni guardar.
 */

import { SELLO } from '../version.js'

/**
 * El sello publicado ahora mismo, o null si no se puede saber. Sin red, sin
 * fichero o con una respuesta rara, se calla: avisar de una versión nueva que
 * no existe es peor que no avisar.
 * @param {typeof fetch} traer
 * @returns {Promise<string | null>}
 */
export async function selloPublicado(traer) {
  try {
    const respuesta = await traer('version.json', { cache: 'no-store' })
    if (!respuesta.ok) return null
    const datos = await respuesta.json()
    return typeof datos?.sello === 'string' ? datos.sello : null
  } catch {
    return null
  }
}

/**
 * @param {typeof fetch} traer
 * @param {string} mio
 */
export async function hayVersionNueva(traer, mio = SELLO) {
  const suyo = await selloPublicado(traer)
  return suyo !== null && suyo !== mio
}

/**
 * Enseña el aviso cuando toca. No recarga por su cuenta: recargar a alguien que
 * está a media faena es quitarle la pantalla de las manos.
 * @param {HTMLElement} aviso
 * @param {typeof fetch} traer
 */
export function vigilarVersion(aviso, traer = fetch) {
  const mirar = async () => {
    if (await hayVersionNueva(traer)) aviso.hidden = false
  }
  aviso.addEventListener('click', () => {
    // Una dirección nueva obliga al navegador a pedir el documento otra vez;
    // una recarga normal puede devolverle la copia que ya tenía.
    location.replace(`${location.pathname}?v=${Date.now()}${location.hash}`)
  })
  mirar()
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') mirar()
  })
}
