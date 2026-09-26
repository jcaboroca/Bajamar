// @ts-check
/**
 * Arranque y pintado.
 *
 * Todo el trabajo ocurre aquí, en el navegador: leer el .xls, agrupar,
 * detectar lo que se repite y proyectar. No hay ninguna llamada de red en
 * toda la aplicación, y no la hay a propósito.
 */

import { formatEuros, formatEurosRedondo } from '../dominio/dinero.js'
import { diasEntre, fechaLarga, hoyIso } from '../dominio/tipos.js'
import { importarXls } from '../importar/sabadell.js'
import { guardarMovimientos, leerMovimientos, vaciar } from '../almacen/db.js'
import { bajar, subir, aFichero, desdeFichero, hacerMaleta, SinBuzon } from '../almacen/sincro.js'
import { ContrasenaInvalida } from '../almacen/cifrado.js'
import { BUZON } from '../../config.js'
import { pedirClave } from './clave.js'
import { construirEstado, totalesPorCategoria } from '../estado.js'
import { dibujarLamina } from './lamina.js'

const lienzo = requerir('lienzo')
const bienvenida = requerir('bienvenida')
const soltar = requerir('soltar')

/** @param {string} id */
function requerir(id) {
  const nodo = document.getElementById(id)
  if (!nodo) throw new Error(`falta el elemento #${id}`)
  return nodo
}

arrancar()

async function arrancar() {
  const guardados = await leerMovimientos()
  if (guardados.length > 0) pintar(guardados, { animar: false })

  for (const id of ['fichero', 'fichero-mas']) {
    const entrada = document.getElementById(id)
    if (entrada instanceof HTMLInputElement) {
      entrada.addEventListener('change', () => {
        if (entrada.files) tragar([...entrada.files])
        entrada.value = ''
      })
    }
  }

  requerir('olvidar').addEventListener('click', async () => {
    const seguro = confirm('Se borra todo lo guardado en este dispositivo. No hay copia en ningún otro sitio.')
    if (!seguro) return
    await vaciar()
    location.reload()
  })

  requerir('enviar').addEventListener('click', enviar)
  requerir('traer').addEventListener('click', () => traer())

  const sobre = document.getElementById('fichero-sobre')
  if (sobre instanceof HTMLInputElement) {
    sobre.addEventListener('change', () => {
      const fichero = sobre.files?.[0]
      sobre.value = ''
      if (fichero) traer(fichero)
    })
  }

  let arrastres = 0
  addEventListener('dragenter', (e) => {
    e.preventDefault()
    arrastres += 1
    soltar.classList.add('activo')
  })
  addEventListener('dragleave', () => {
    arrastres = Math.max(arrastres - 1, 0)
    if (arrastres === 0) soltar.classList.remove('activo')
  })
  addEventListener('dragover', (e) => e.preventDefault())
  addEventListener('drop', (e) => {
    e.preventDefault()
    arrastres = 0
    soltar.classList.remove('activo')
    if (e.dataTransfer?.files) tragar([...e.dataTransfer.files])
  })

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {})
  }
}

/** @param {string} texto */
function decir(texto) {
  const nodo = document.getElementById('estado-sincro')
  if (nodo) nodo.textContent = texto
}

async function enviar() {
  const guardados = await leerMovimientos()
  if (guardados.length === 0) return decir('Todavía no hay nada que enviar.')

  const clave = await pedirClave({
    aceptar: 'Enviar',
    pie: BUZON
      ? 'Se cifra aquí antes de salir. Con esta misma contraseña lo recuperas en el otro dispositivo.'
      : 'Se cifra aquí antes de salir. Te lo podrás pasar al otro dispositivo y abrirlo con esta misma contraseña.',
  })
  if (!clave) return

  const maleta = hacerMaleta(guardados)
  decir('Cifrando…')
  try {
    if (BUZON) {
      await subir(BUZON, maleta, clave)
      decir('Enviado. Ábrelo en el otro dispositivo con esa contraseña.')
    } else {
      const via = await aFichero(maleta, clave)
      decir(via === 'compartido'
        ? 'Cifrado y compartido. Ábrelo en el otro dispositivo con esa contraseña.'
        : 'Fichero cifrado descargado. Pásalo al otro dispositivo y ábrelo allí.')
    }
  } catch (error) {
    decir(`No he podido enviarlo: ${error instanceof Error ? error.message : error}`)
  }
}

/** @param {File} [fichero] */
async function traer(fichero) {
  if (!fichero && !BUZON) {
    return decir('Sin buzón configurado: trae el fichero cifrado que descargaste en el otro dispositivo.')
  }

  let error = ''
  for (let intento = 0; intento < 3; intento += 1) {
    const clave = await pedirClave({
      aceptar: 'Abrir',
      error,
      pie: 'La contraseña con la que lo enviaste desde el otro dispositivo.',
    })
    if (!clave) return

    try {
      const maleta = fichero
        ? await desdeFichero(fichero, clave)
        : await bajar(BUZON, clave)
      await guardarMovimientos(maleta.movimientos)
      pintar(await leerMovimientos(), { animar: true })
      decir(`Traídos ${maleta.movimientos.length} movimientos.`)
      return
    } catch (fallo) {
      if (fallo instanceof ContrasenaInvalida) {
        error = 'Esa contraseña no abre estos datos.'
        continue
      }
      if (fallo instanceof SinBuzon) {
        return decir('No hay nada guardado con esa contraseña.')
      }
      return decir(`No he podido traerlos: ${fallo instanceof Error ? fallo.message : fallo}`)
    }
  }
  decir('Tres intentos fallidos. Vuelve a intentarlo cuando la recuerdes.')
}

/** @param {File[]} ficheros */
async function tragar(ficheros) {
  const avisos = []
  let leidos = 0
  for (const fichero of ficheros) {
    try {
      const { movimientos, avisos: propios } = importarXls(await fichero.arrayBuffer())
      await guardarMovimientos(movimientos)
      leidos += movimientos.length
      avisos.push(...propios)
    } catch (error) {
      avisos.push(`No he podido leer «${fichero.name}»: ${error instanceof Error ? error.message : error}`)
    }
  }

  const nota = document.getElementById('aviso-bienvenida')
  if (leidos === 0) {
    if (nota) nota.textContent = avisos[0] ?? 'Ese fichero no parece un extracto en formato Excel.'
    return
  }
  if (nota) nota.textContent = ''

  pintar(await leerMovimientos(), { animar: true })
}

/**
 * @param {import('../dominio/tipos.js').Movimiento[]} movimientos
 * @param {{ animar: boolean }} opciones
 */
function pintar(movimientos, { animar }) {
  const estado = construirEstado(movimientos, { hoy: hoyIso() })
  const { proyeccion } = estado

  bienvenida.hidden = true
  lienzo.hidden = false

  const cifra = requerir('suelo-cifra')
  cifra.replaceChildren(...titular(formatEurosRedondo(proyeccion.suelo.saldo)))
  cifra.parentElement?.classList.toggle('en-rojo', proyeccion.suelo.saldo < 0)

  const faltan = diasEntre(estado.hoy, proyeccion.suelo.fecha)
  requerir('suelo-pie').innerHTML = faltan <= 0
    ? 'Hoy mismo es el punto más bajo del periodo.'
    : `el <strong>${escapar(fechaLarga(proyeccion.suelo.fecha))}</strong>, dentro de ${faltan} ${faltan === 1 ? 'día' : 'días'}. ` +
      `Cierras el mes con ${escapar(formatEurosRedondo(proyeccion.saldoFinal))}.`

  const lamina = requerir('lamina')
  lamina.replaceChildren(dibujarLamina(proyeccion))
  lamina.classList.remove('dibujando')
  if (animar) {
    void lamina.offsetWidth // reiniciar la animación sin esperar a un cuadro
    lamina.classList.add('dibujando')
  }

  pintarEventos(proyeccion.eventos, estado.hoy)
  pintarPreguntas(estado.dudosos)
  pintarCategorias(estado)

  requerir('dato-movimientos').textContent = String(movimientos.length)
  requerir('dato-ritmo').textContent = `${formatEuros(estado.ritmo.porMes)} al mes`
  requerir('dato-saldo').textContent = formatEuros(estado.saldoInicial)
}

/**
 * @param {import('../analisis/bajamar.js').Evento[]} eventos
 * @param {string} hoy
 */
function pintarEventos(eventos, hoy) {
  const lista = requerir('eventos')
  lista.replaceChildren(...eventos.map((e) => {
    const li = document.createElement('li')
    li.className = e.seguro ? 'confirmado' : 'previsto'
    // Ámbar sólo para lo que cae en los próximos tres días: si se pintara
    // todo lo llamativo, no quedaría forma de llamar la atención.
    if (diasEntre(hoy, e.fecha) <= 3 && e.importe < 0) li.classList.add('urgente')
    li.append(
      celda('span', 'evento-fecha cifras', diaYMes(e.fecha)),
      nombreConDetalle(e),
      celda('span', 'evento-importe', formatEuros(e.importe, { signo: true })),
    )
    return li
  }))
}

/**
 * A ese tamaño el espacio de una tipografía monoespaciada abre un hueco de
 * medio dedo antes del símbolo. Se separa para poder componerlo aparte.
 * @param {string} texto
 */
function titular(texto) {
  const corte = texto.lastIndexOf(' ')
  if (corte < 0) return [document.createTextNode(texto)]
  const moneda = document.createElement('span')
  moneda.className = 'moneda'
  moneda.textContent = texto.slice(corte + 1)
  return [document.createTextNode(texto.slice(0, corte)), moneda]
}

/** @param {import('../analisis/bajamar.js').Evento} e */
function nombreConDetalle(e) {
  const div = document.createElement('div')
  div.className = 'evento-nombre'
  div.append(celda('span', '', e.nombre))
  div.append(celda('span', 'evento-detalle', e.seguro ? 'confirmado' : 'previsto'))
  return div
}

/** @param {import('../analisis/compromisos.js').Deteccion['dudosos']} dudosos */
function pintarPreguntas(dudosos) {
  const bloque = requerir('bloque-preguntas')
  bloque.hidden = dudosos.length === 0
  if (dudosos.length === 0) return
  requerir('preguntas').replaceChildren(...dudosos.map((d) => {
    const li = document.createElement('li')
    li.className = 'previsto'
    li.append(
      celda('span', 'evento-fecha cifras', diaYMes(d.fecha)),
      (() => {
        const div = document.createElement('div')
        div.className = 'evento-nombre'
        div.append(
          celda('span', '', d.nombre),
          celda('span', 'evento-detalle', `la última vez hace ${d.meses} meses · ¿vuelve?`),
        )
        return div
      })(),
      celda('span', 'evento-importe', formatEuros(d.importe, { signo: true })),
    )
    return li
  }))
}

/** @param {ReturnType<typeof construirEstado>} estado */
function pintarCategorias(estado) {
  const desde = `${Number(estado.hoy.slice(0, 4)) - 1}${estado.hoy.slice(4, 7)}-01`
  const totales = totalesPorCategoria(estado.movimientos, estado.categorias, { desde })
  const mayor = Math.abs(totales[0]?.total ?? 1)

  requerir('categorias').replaceChildren(...totales.slice(0, 12).map((c) => {
    const li = document.createElement('li')
    const barra = document.createElement('div')
    barra.className = 'barra'
    const relleno = document.createElement('i')
    relleno.style.width = `${(Math.abs(c.total) / mayor) * 100}%`
    barra.append(relleno)
    li.append(
      celda('span', '', c.nombre),
      celda('span', 'evento-importe', formatEurosRedondo(Math.round(c.total / 12))),
      barra,
    )
    return li
  }))
}

/**
 * @param {string} etiqueta
 * @param {string} clase
 * @param {string} contenido
 */
function celda(etiqueta, clase, contenido) {
  const nodo = document.createElement(etiqueta)
  if (clase) nodo.className = clase
  nodo.textContent = contenido
  return nodo
}

/** @param {string} iso */
function diaYMes(iso) {
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${Number(iso.slice(8, 10))} ${meses[Number(iso.slice(5, 7)) - 1]}`
}

/** @param {string} s */
function escapar(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}
