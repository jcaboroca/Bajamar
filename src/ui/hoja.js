// @ts-check
/**
 * Un formulario genérico en una hoja modal.
 *
 * Existe para no repetir cinco veces el mismo diálogo. Devuelve una promesa
 * que se resuelve con lo tecleado, con `null` si se deja, o con `'borrar'` si
 * se pulsa borrar — que es una respuesta al formulario, no un error.
 */

import { nodo, requerir } from './piezas.js'

/**
 * @typedef {object} Campo
 * @property {string} nombre
 * @property {string} etiqueta
 * @property {'texto' | 'numero' | 'fecha' | 'lista'} [tipo]
 * @property {string} [valor]
 * @property {Array<[string, string]>} [opciones]  [valor, texto]
 * @property {string} [pista]
 * @property {boolean} [requerido]
 */

/**
 * @param {object} peticion
 * @param {string} peticion.titulo
 * @param {Campo[]} peticion.campos
 * @param {string} [peticion.aceptar]
 * @param {boolean} [peticion.borrable]
 * @returns {Promise<Record<string, string> | 'borrar' | null>}
 */
export function pedirDatos({ titulo, campos, aceptar = 'Guardar', borrable = false }) {
  const hoja = document.getElementById('formulario')
  const form = document.getElementById('formulario-form')
  if (!(hoja instanceof HTMLDialogElement) || !(form instanceof HTMLFormElement)) {
    return Promise.resolve(null)
  }

  requerir('formulario-rotulo').textContent = titulo
  requerir('formulario-aceptar').textContent = aceptar
  const borrar = requerir('formulario-borrar')
  borrar.hidden = !borrable

  const caja = requerir('formulario-campos')
  caja.replaceChildren(...campos.map(pintarCampo))

  return new Promise((resuelve) => {
    /** @param {Record<string, string> | 'borrar' | null} respuesta */
    const terminar = (respuesta) => {
      form.removeEventListener('submit', alEnviar)
      hoja.removeEventListener('close', alCerrar)
      borrar.removeEventListener('click', alBorrar)
      requerir('formulario-cancelar').removeEventListener('click', alCancelar)
      hoja.close()
      resuelve(respuesta)
    }

    /** @param {Event} e */
    const alEnviar = (e) => {
      e.preventDefault()
      if (!form.reportValidity()) return
      const datos = new FormData(form)
      terminar(Object.fromEntries([...datos.entries()].map(([k, v]) => [k, String(v)])))
    }
    const alCerrar = () => terminar(null)
    const alCancelar = () => terminar(null)
    const alBorrar = () => terminar('borrar')

    form.addEventListener('submit', alEnviar)
    hoja.addEventListener('close', alCerrar)
    borrar.addEventListener('click', alBorrar)
    requerir('formulario-cancelar').addEventListener('click', alCancelar)

    hoja.showModal()
    const primero = caja.querySelector('input, select')
    if (primero instanceof HTMLElement) primero.focus()
  })
}

/** @param {Campo} campo */
function pintarCampo(campo) {
  const envoltorio = nodo('div', 'campo-caja')
  const id = `campo-${campo.nombre}`
  const etiqueta = nodo('label', 'campo-etiqueta', campo.etiqueta)
  etiqueta.setAttribute('for', id)
  envoltorio.append(etiqueta)

  if (campo.tipo === 'lista') {
    const select = document.createElement('select')
    select.className = 'campo'
    select.id = id
    select.name = campo.nombre
    for (const [valor, texto] of campo.opciones ?? []) {
      const opcion = document.createElement('option')
      opcion.value = valor
      opcion.textContent = texto
      if (valor === campo.valor) opcion.selected = true
      select.append(opcion)
    }
    envoltorio.append(select)
    // Una lista no admite placeholder, y esta pregunta no se contesta bien sin
    // saber qué hace cada respuesta.
    if (campo.pista) envoltorio.append(nodo('p', 'aclaracion campo-pista', campo.pista))
  } else {
    const input = document.createElement('input')
    input.className = campo.tipo === 'numero' ? 'campo cifras' : 'campo'
    input.id = id
    input.name = campo.nombre
    input.type = campo.tipo === 'numero' ? 'number' : campo.tipo === 'fecha' ? 'date' : 'text'
    if (campo.tipo === 'numero') {
      input.step = '0.01'
      input.inputMode = 'decimal'
    }
    if (campo.valor !== undefined) input.value = campo.valor
    if (campo.requerido) input.required = true
    if (campo.pista) input.placeholder = campo.pista
    envoltorio.append(input)
  }

  return envoltorio
}
