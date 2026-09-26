// @ts-check

/**
 * El diálogo de la contraseña.
 *
 * Se pide cada vez que algo va a salir del dispositivo o a entrar en él, y no
 * se guarda: vive en memoria mientras dura la operación. Guardarla en
 * `localStorage` habría sido más cómodo y habría convertido la contraseña en
 * un fichero más del navegador, que es justo lo que se intenta evitar.
 */

/** @param {string} id */
function requerir(id) {
  const nodo = document.getElementById(id)
  if (!nodo) throw new Error(`falta el elemento #${id}`)
  return nodo
}

/**
 * @param {{ pie?: string, error?: string, aceptar?: string }} opciones
 * @returns {Promise<string | null>} null si el usuario lo deja
 */
export function pedirClave({ pie = '', error = '', aceptar = 'Continuar' } = {}) {
  const dialogo = /** @type {HTMLDialogElement} */ (requerir('clave'))
  const campo = /** @type {HTMLInputElement} */ (requerir('clave-campo'))
  const formulario = /** @type {HTMLFormElement} */ (requerir('clave-form'))

  requerir('clave-pie').textContent = pie
  requerir('clave-error').textContent = error
  requerir('clave-aceptar').textContent = aceptar
  campo.value = ''

  return new Promise((resolver) => {
    let terminado = false

    /** @param {string | null} valor */
    const terminar = (valor) => {
      if (terminado) return
      terminado = true
      formulario.removeEventListener('submit', alEnviar)
      dialogo.removeEventListener('close', alCerrar)
      campo.value = ''
      if (dialogo.open) dialogo.close()
      resolver(valor)
    }

    // Se resuelve en el propio envío y no esperando a `close`: así la respuesta
    // no depende de que el diálogo emita un evento que, según cómo se cierre,
    // puede no llegar.
    const alEnviar = () => terminar(campo.value)
    const alCerrar = () => terminar(null)

    formulario.addEventListener('submit', alEnviar)
    dialogo.addEventListener('close', alCerrar)
    requerir('clave-cancelar').onclick = () => terminar(null)

    dialogo.showModal()
    campo.focus()
  })
}
