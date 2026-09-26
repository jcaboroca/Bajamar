// @ts-check

/**
 * Recordar la contraseña en el dispositivo no destapa nada: aquí los
 * movimientos ya están guardados en claro. Lo que el cifrado protege es el
 * trayecto y el buzón, y eso sigue igual.
 */

const CAJON = 'bajamar:clave'

/** @param {string} clave */
export function recordarClave(clave) {
  try {
    localStorage.setItem(CAJON, clave)
  } catch {
    // Navegación privada o almacenamiento lleno: se seguirá preguntando.
  }
}

/** @returns {string} */
export function claveRecordada() {
  try {
    return localStorage.getItem(CAJON) ?? ''
  } catch {
    return ''
  }
}

export function olvidarClave() {
  try {
    localStorage.removeItem(CAJON)
  } catch {
    // Si no se puede borrar, tampoco se pudo guardar.
  }
}
