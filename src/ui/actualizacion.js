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
 * Lo publicado ahora mismo, o null si no se puede saber. Sin red, sin fichero
 * o con una respuesta rara, se calla: avisar de una versión nueva que no existe
 * es peor que no avisar.
 * @param {typeof fetch} traer
 * @returns {Promise<{ sello: string, ficheros: string[] } | null>}
 */
export async function publicado(traer) {
  try {
    const respuesta = await traer('version.json', { cache: 'no-store' })
    if (!respuesta.ok) return null
    const datos = await respuesta.json()
    if (typeof datos?.sello !== 'string') return null
    return { sello: datos.sello, ficheros: Array.isArray(datos.ficheros) ? datos.ficheros : [] }
  } catch {
    return null
  }
}

/**
 * @param {typeof fetch} traer
 * @returns {Promise<string | null>}
 */
export async function selloPublicado(traer) {
  return (await publicado(traer))?.sello ?? null
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
 * Vuelve a pedir a la red cada fichero publicado, saltándose la copia que el
 * navegador guarda diez minutos. Sin esto, recargar servía el código viejo y
 * el aviso reaparecía al instante, una y otra vez.
 * @param {typeof fetch} traer
 * @param {string[]} ficheros
 */
export async function refrescar(traer, ficheros) {
  await Promise.all(ficheros.map((f) => traer(f, { cache: 'reload' }).catch(() => null)))
}

/**
 * Enseña el aviso cuando toca. No recarga por su cuenta: recargar a alguien que
 * está a media faena es quitarle la pantalla de las manos.
 * @param {HTMLElement} aviso
 * @param {typeof fetch} traer
 */
export function vigilarVersion(aviso, traer = fetch) {
  /** @type {string[]} */
  let ficheros = []
  const mirar = async () => {
    const hay = await publicado(traer)
    if (!hay || hay.sello === SELLO) return
    ficheros = hay.ficheros
    aviso.hidden = false
  }
  aviso.addEventListener('click', async () => {
    aviso.textContent = 'Poniéndola…'
    await refrescar(traer, ficheros)
    // Una dirección nueva obliga al navegador a pedir el documento otra vez;
    // una recarga normal puede devolverle la copia que ya tenía.
    location.replace(`${location.pathname}?v=${Date.now()}${location.hash}`)
  })
  mirar()
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') mirar()
  })
}
