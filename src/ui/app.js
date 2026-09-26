// @ts-check
/**
 * Arranque y reparto.
 *
 * Este fichero ya no pinta: carga lo guardado, arma el estado una sola vez y
 * se lo da a cada vista. Todo el trabajo ocurre aquí, en el navegador —leer el
 * .xls, agrupar, detectar lo que se repite y proyectar—, y la única llamada de
 * red posible es el buzón cifrado, que es opcional.
 *
 * El estado se reconstruye entero en cada cambio. Es barato —mil movimientos
 * no son nada— y ahorra toda una clase de errores: no hay dos verdades que
 * mantener de acuerdo.
 */

import { hoyIso } from '../dominio/tipos.js'
import { importarXls } from '../importar/sabadell.js'
import { guardarMovimientos, leerMovimientos, vaciar } from '../almacen/db.js'
import { bajar, subir, aFichero, desdeFichero, hacerMaleta, SinBuzon } from '../almacen/sincro.js'
import { ContrasenaInvalida } from '../almacen/cifrado.js'
import { BUZON } from '../../config.js'
import { pedirClave, quiereRecordar } from './clave.js'
import { claveRecordada, recordarClave, olvidarClave } from '../almacen/llavero.js'
import { construirEstado } from '../estado.js'
import {
  cargar as cargarPreferencias,
  nuevoId,
  ponerApunte,
  ponerColchon,
  ponerObjetivo,
  ponerPresupuesto,
  ponerRegla,
  ponerRetoque,
  ponerTrato,
  quitarApunte,
  quitarObjetivo,
} from '../almacen/preferencias.js'
import { requerir } from './piezas.js'
import { arrancarNavegacion } from './nav.js'
import { montarResumen, pintarResumen } from './vistas/resumen.js'
import { montarMovimientos, pintarMovimientos } from './vistas/movimientos.js'
import { montarPrevision, pintarPrevision } from './vistas/prevision.js'
import { montarPatrimonio, pintarPatrimonio } from './vistas/patrimonio.js'
import { montarAjustes, pintarAjustes } from './vistas/ajustes.js'

const barra = requerir('barra')
const lienzo = requerir('lienzo')
const bienvenida = requerir('bienvenida')
const soltar = requerir('soltar')

arrancar()

async function arrancar() {
  montarVistas()
  arrancarNavegacion(() => {})

  const guardados = await leerMovimientos()
  if (guardados.length > 0) await refrescar({ animar: false })

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
    olvidarClave()
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

  ponerseAlDia()

  // Volver a la app es abrirla: en el móvil casi nunca se arranca de cero.
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ponerseAlDia()
  })
}

/**
 * Las vistas se enganchan una vez. Lo que cambia con cada dato es el pintado,
 * no los escuchadores: volver a colgarlos en cada refresco multiplicaría los
 * manejadores en silencio hasta que un clic hiciera cinco cosas.
 */
function montarVistas() {
  /** @param {string} entidadId @param {import('./trato.js').Trato} trato */
  const alCambiarTrato = async (entidadId, trato) => {
    await ponerTrato(entidadId, trato)
    await refrescar()
    decir(trato === 'baja'
      ? 'Hecho: deja de contar para el futuro.'
      : trato === 'suelto'
        ? 'Hecho: cuenta en el día a día, pero ya no se anuncia con fecha.'
        : 'Hecho: vuelve a la previsión.')
  }

  montarResumen({ alCambiarTrato })

  montarMovimientos({
    alCambiar: async ({ retoque, regla }) => {
      if (retoque) await ponerRetoque(retoque)
      if (regla) await ponerRegla(regla[0], regla[1])
      await refrescar()
    },
  })

  montarPrevision({ alCambiarTrato })

  montarPatrimonio({
    nuevoId,
    alGuardarApunte: async (apunte) => {
      await ponerApunte(apunte)
      await refrescar()
    },
    alBorrarApunte: async (id) => {
      await quitarApunte(id)
      await refrescar()
    },
    alGuardarObjetivo: async (objetivo) => {
      await ponerObjetivo(objetivo)
      await refrescar()
    },
    alBorrarObjetivo: async (id) => {
      await quitarObjetivo(id)
      await refrescar()
    },
  })

  montarAjustes({
    alGuardarColchon: async (centimos) => {
      await ponerColchon(centimos)
      await refrescar()
      decir('Colchón guardado.')
    },
    alGuardarPresupuesto: async (categoria, centimos) => {
      await ponerPresupuesto(categoria, centimos)
      await refrescar()
    },
  })
}

/** @param {{ animar?: boolean }} [opciones] */
async function refrescar({ animar = false } = {}) {
  const movimientos = await leerMovimientos()
  if (movimientos.length === 0) return

  const preferencias = await cargarPreferencias()
  const estado = construirEstado(movimientos, {
    hoy: hoyIso(),
    bultos: preferencias.bultos,
    categoriasManuales: preferencias.reglas,
    retoques: preferencias.retoques,
    presupuestos: preferencias.presupuestos,
    patrimonio: preferencias.patrimonio,
    tratos: preferencias.tratos,
    colchon: preferencias.colchon,
  })

  bienvenida.hidden = true
  barra.hidden = false
  lienzo.hidden = false

  pintarResumen(estado, { animar })
  pintarMovimientos(estado)
  pintarPrevision(estado)
  pintarPatrimonio(estado, preferencias.objetivos)
  pintarAjustes(estado, preferencias.colchon)
}

/**
 * Al abrir, si hay contraseña recordada, se mira el buzón sin preguntar nada.
 * Los movimientos se identifican por sí mismos, así que traer los del otro
 * dispositivo es mezclar, no elegir cuál gana.
 */
async function ponerseAlDia() {
  if (!BUZON || !claveRecordada()) return
  try {
    const maleta = await bajar(BUZON, claveRecordada())
    const antes = (await leerMovimientos()).length
    await guardarMovimientos(maleta.movimientos)
    const ahora = (await leerMovimientos()).length
    if (ahora !== antes) {
      await refrescar({ animar: antes === 0 })
      decir(`Traídos ${ahora - antes} movimientos del otro dispositivo.`)
    }
  } catch {
    // Sin buzón todavía, sin red o contraseña cambiada: no es momento de dar la
    // lata. Los botones de Ajustes siguen ahí.
  }
}

/**
 * Al importar, el otro dispositivo se entera sin que haya que acordarse.
 *
 * La primera vez hace falta una contraseña: sin ella el otro dispositivo no
 * tendría con qué descifrar. Se pregunta aquí, que es cuando viene a cuento, y
 * no se vuelve a preguntar.
 */
async function contarloAlOtro() {
  if (!BUZON) return

  let clave = claveRecordada()
  if (!clave) {
    clave = (await pedirClave({
      aceptar: 'Sincronizar',
      pie: 'Elige una contraseña. Con ella verás estos datos en tus otros dispositivos, y sin ella no los ve nadie. Solo se pide esta vez.',
    })) ?? ''
    if (!clave) return decir('Guardado solo en este dispositivo.')
    if (quiereRecordar()) recordarClave(clave)
  }

  try {
    await subir(BUZON, hacerMaleta(await leerMovimientos()), clave)
    decir('Enviado. Al abrir la app en el otro dispositivo aparecerá allí.')
  } catch {
    decir('Guardado aquí, pero no he podido avisar al otro dispositivo.')
  }
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let recadoPendiente

/**
 * Un aviso que se lee esté donde esté el usuario.
 *
 * El rótulo fijo vive en Ajustes, y ahora que hay cinco áreas casi nunca es la
 * que está abierta. Escribir sólo ahí sería no decir nada.
 * @param {string} texto
 */
function decir(texto) {
  const fijo = document.getElementById('estado-sincro')
  if (fijo) fijo.textContent = texto

  const nota = document.getElementById('aviso-bienvenida')
  if (nota && !bienvenida.hidden) {
    nota.textContent = texto
    return
  }

  let recado = document.getElementById('recado')
  if (!recado) {
    recado = document.createElement('p')
    recado.id = 'recado'
    recado.className = 'recado'
    recado.setAttribute('role', 'status')
    document.body.append(recado)
  }
  const visible = recado
  visible.textContent = texto
  visible.classList.add('visible')
  clearTimeout(recadoPendiente)
  recadoPendiente = setTimeout(() => visible.classList.remove('visible'), 6000)
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
  if (quiereRecordar()) recordarClave(clave)
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
  // Sin buzón, pedir el fichero es el primer paso.
  if (!fichero && !BUZON) {
    requerir('fichero-sobre').click()
    return
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
      if (quiereRecordar()) recordarClave(clave)
      await refrescar({ animar: true })
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

  await refrescar({ animar: true })
  contarloAlOtro()
}

