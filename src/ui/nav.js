// @ts-check
/**
 * Navegación entre las cuatro áreas.
 *
 * Sin router ni historia falsa: el hash es el estado. Así se puede volver con
 * el botón atrás del móvil sin salir de la aplicación, que es lo que todo el
 * mundo intenta, y se puede recargar sin perder dónde estabas.
 */

import { requerir } from './piezas.js'

// Previsión se fundió en Resumen y Patrimonio se retiró: un #prevision o un
// #patrimonio guardado cae en Resumen por no estar en la lista.
const AREAS = ['resumen', 'movimientos', 'categorias', 'ajustes']

/**
 * @param {(vista: string) => void} alCambiar
 */
export function arrancarNavegacion(alCambiar) {
  const barra = requerir('barra')

  barra.addEventListener('click', (e) => {
    const boton = e.target instanceof Element ? e.target.closest('[data-vista]') : null
    if (!(boton instanceof HTMLButtonElement)) return
    ir(boton.dataset.vista ?? 'resumen', alCambiar)
  })

  window.addEventListener('hashchange', () => {
    mostrar(delHash(), alCambiar)
  })

  mostrar(delHash(), alCambiar)
}

function delHash() {
  const nombre = location.hash.replace('#', '')
  return AREAS.includes(nombre) ? nombre : 'resumen'
}

/**
 * @param {string} vista
 * @param {(vista: string) => void} alCambiar
 */
export function ir(vista, alCambiar) {
  if (location.hash === `#${vista}`) {
    mostrar(vista, alCambiar)
    return
  }
  location.hash = vista // el hashchange hace el resto
}

/**
 * @param {string} vista
 * @param {(vista: string) => void} alCambiar
 */
function mostrar(vista, alCambiar) {
  for (const area of AREAS) {
    const div = document.getElementById(`vista-${area}`)
    if (div) div.hidden = area !== vista
  }
  for (const boton of document.querySelectorAll('[data-vista]')) {
    if (boton.getAttribute('data-vista') === vista) boton.setAttribute('aria-current', 'page')
    else boton.removeAttribute('aria-current')
  }
  // Cambiar de área es como abrir otra página: se empieza por arriba.
  window.scrollTo({ top: 0 })
  alCambiar(vista)
}
