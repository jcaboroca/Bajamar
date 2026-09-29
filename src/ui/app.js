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
import { guardarMovimientos, hayQueSubir, leerDecisiones, leerMovimientos, mezclarDecisiones, vaciar } from '../almacen/db.js'
import { bajar, subir, aFichero, desdeFichero, hacerMaleta, buzonDesde, SinBuzon } from '../almacen/sincro.js'
import { ContrasenaInvalida } from '../almacen/cifrado.js'
import { BUZON } from '../../config.js'
import { pedirClave, quiereRecordar } from './clave.js'
import { claveRecordada, recordarClave, olvidarClave, marcarSincro, ultimaSincro } from '../almacen/llavero.js'
import { construirEstado } from '../estado.js'
import { recuadrar, sellar } from '../analisis/plan.js'
import {
  cargar as cargarPreferencias,
  nuevoId,
  ponerApunte,
  ponerColchon,
  ponerSaltado,
  ponerVentanaRitmo,
  ponerObjetivo,
  ponerAsignacion,
  ponerRegla,
  ponerUnico,
  ponerAnual,
  ponerRitmo,
  ponerManual,
  ponerApagada,
  ponerInversion,
  ponerRetoque,
  ponerTrato,
  ponerApodo,
  quitarApunte,
  quitarObjetivo,
  migrarPresupuestosAlPlan,
  ponerPlan,
  repartirTratosViejos,
} from '../almacen/preferencias.js'
import { requerir } from './piezas.js'
import { arrancarNavegacion } from './nav.js'
import { montarResumen, pintarResumen } from './vistas/resumen.js'
import { montarMovimientos, pintarMovimientos } from './vistas/movimientos.js'
import { montarPrevision, pintarPrevision } from './vistas/prevision.js'
import { montarCategorias, pintarCategorias } from './vistas/categorias.js'
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
  if (guardados.length > 0) {
    await repartirTratosViejos()
    await refrescar({ animar: false, local: false })
    // Los presupuestos viejos no tenían mes. Se convierten en el plan del mes
    // en curso, y para eso hace falta el residuo, que sólo se sabe una vez
    // construido el estado. De ahí que vaya después del primer refresco.
    if (ultimoEstado && await migrarPresupuestosAlPlan(contextoDelPlan())) {
      await refrescar({ animar: false, local: false })
    }
  }

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
  requerir('rehacer').addEventListener('click', rehacer)
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
    // Ya no hay PWA, pero quien la instaló sigue con ella puesta: registrar el
    // desinstalador es la única forma de que le llegue.
    navigator.serviceWorker.register('sw.js').catch(() => {})
  }

  ponerseAlDia()
  tirarParaBuscar()

  // Volver a la app es abrirla: en el móvil casi nunca se arranca de cero.
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ponerseAlDia()
  })
  addEventListener('online', ponerseAlDia)

  // Con los dos aparatos abiertos a la vez no hay nada que despierte a este:
  // mirar de vez en cuando es la única forma de que el cambio aparezca solo.
  setInterval(() => {
    if (document.visibilityState === 'visible') ponerseAlDia()
  }, 20_000)
}

/**
 * Las vistas se enganchan una vez. Lo que cambia con cada dato es el pintado,
 * no los escuchadores: volver a colgarlos en cada refresco multiplicaría los
 * manejadores en silencio hasta que un clic hiciera cinco cosas.
 */
function montarVistas() {
  /** @param {{ reciboId: string, trato: import('./trato.js').Trato, apodo: string, categoria: string, ritmo: string, cambiaTrato: boolean }} cambio */
  const alCambiarTrato = async ({ reciboId, trato, apodo, categoria, ritmo, cambiaTrato }) => {
    await ponerApodo(reciboId, apodo)
    await ponerTrato(reciboId, trato)
    await ponerRitmo(reciboId, ritmo)
    // La regla se guarda bajo el recibo, no bajo el cobrador: del mismo PayPal
    // salen dos suscripciones y una compra suelta.
    if (categoria) await ponerRegla(reciboId, categoria)
    await refrescar()
    if (!cambiaTrato) return decir(apodo === '' ? 'Hecho.' : `Hecho: ahora se llama ${apodo}.`)
    decir(trato === 'baja'
      ? 'Hecho: deja de contar para el futuro.'
      : trato === 'suelto'
        ? 'Hecho: lo sigo previendo, y te digo cuánto margen te daría saltarlo.'
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

  montarCategorias({
    alCambiarTrato,
    alApuntarRecibo: async (manual) => {
      await ponerManual(manual)
      await refrescar()
      decir(`Hecho: ${manual.nombre} entra en la previsión.`)
    },
    alMarcarAnual: async (entidadId, esAnual) => {
      await ponerAnual(entidadId, esAnual)
      await refrescar()
    },
  })

  montarPrevision({
    alCambiarTrato,
    alApagarCategoria: async (categoria, apagada) => {
      await ponerApagada(categoria, apagada)
      await refrescar()
    },
    alAsignar: async (categoria, centimos) => {
      if (!ultimoEstado) return
      await ponerAsignacion(categoria, centimos, contextoDelPlan())
      await refrescar()
    },
    // Con un reparto delante, lo escribe tal cual; sin él, encoge el que hay en
    // proporción hasta que vuelva a cuadrar con el residuo de hoy.
    alRecuadrar: async (asignado) => {
      if (!ultimoEstado) return
      const contexto = contextoDelPlan()
      const nuevo = asignado
        ?? (ultimoEstado.plan ? recuadrar(ultimoEstado.plan, contexto.residuo) : {})
      await ponerPlan(sellar({ ...contexto, asignado: nuevo }))
      await refrescar()
    },
    alMarcarInversion: async (reciboId, esInversion) => {
      await ponerInversion(reciboId, esInversion)
      await refrescar()
    },
    alSaltarCobro: async (reciboId, mes, saltado) => {
      await ponerSaltado(reciboId, mes, saltado)
      await refrescar()
      decir(saltado ? 'Este mes no cuenta.' : 'Vuelve a contar.')
    },
  })

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
    alElegirVentana: async (meses) => {
      await ponerVentanaRitmo(meses)
      await refrescar()
      decir(meses === 0 ? 'Miro todo tu historial.' : `Miro tus últimos ${meses} meses.`)
    },
    alGuardarPresupuesto: async (categoria, centimos) => {
      if (!ultimoEstado) return
      await ponerAsignacion(categoria, centimos, contextoDelPlan())
      await refrescar()
    },
    alClasificar: async (entidadId, categoria) => {
      await ponerRegla(entidadId, categoria)
      await refrescar()
    },
    alMarcarUnico: async (entidadId, esUnico) => {
      await ponerUnico(entidadId, esUnico)
      await refrescar()
    },
  })
}

/**
 * @param {{ animar?: boolean, local?: boolean }} [opciones]
 * `local` distingue el refresco que nace de una decisión del que sólo repinta
 * lo que ya sabíamos; sólo el primero tiene algo que contarle al otro aparato.
 */
/** @type {ReturnType<typeof construirEstado> | null} */
let ultimoEstado = null

/** Contra qué mes y qué residuo se está cuadrando el plan ahora mismo. */
function contextoDelPlan() {
  return {
    mes: ultimoEstado?.periodoActual?.id ?? hoyIso().slice(0, 7),
    residuo: ultimoEstado?.residuo ?? 0,
    hoy: hoyIso(),
  }
}

async function refrescar({ animar = false, local = true } = {}) {
  const movimientos = await leerMovimientos()
  if (movimientos.length === 0) return
  if (local) publicar()

  const preferencias = await cargarPreferencias()
  const estado = construirEstado(movimientos, {
    hoy: hoyIso(),
    bultos: preferencias.bultos,
    categoriasManuales: preferencias.reglas,
    retoques: preferencias.retoques,
    planes: preferencias.planes,
    patrimonio: preferencias.patrimonio,
    tratos: preferencias.tratos,
    apodos: preferencias.apodos,
    unicos: preferencias.unicos,
    anuales: preferencias.anuales,
    ritmos: preferencias.ritmos,
    manuales: preferencias.manuales,
    apagadas: preferencias.apagadas,
    inversiones: preferencias.inversiones,
    saltados: preferencias.saltados,
    ventanaRitmo: preferencias.ventanaRitmo,
    colchon: preferencias.colchon,
  })

  // Los manejadores necesitan saber contra qué mes y qué residuo se está
  // cuadrando el plan, y se disparan entre dos refrescos. Guardar el último
  // estado es más barato que pasearlo por cada gancho de la interfaz.
  ultimoEstado = estado

  bienvenida.hidden = true
  barra.hidden = false
  lienzo.hidden = false

  pintarResumen(estado, { animar })
  pintarMovimientos(estado)
  pintarPrevision(estado)
  pintarCategorias(estado)
  pintarPatrimonio(estado, preferencias.objetivos)
  pintarAjustes(estado, preferencias.colchon, preferencias.ventanaRitmo)
  pintarSincro()
}

/**
 * Al abrir, si hay contraseña recordada, se mira el buzón sin preguntar nada.
 * Los movimientos se identifican por sí mismos, así que traer los del otro
 * dispositivo es mezclar, no elegir cuál gana. Y lo decidido a mano se funde
 * con lo de aquí por la hora en que se decidió.
 */
async function ponerseAlDia({ aMano = false } = {}) {
  if (forzando) return
  if (!BUZON) {
    if (aMano) decir('Esta copia no tiene buzón donde mirar.')
    return
  }
  if (!claveRecordada()) {
    if (aMano) decir('Aquí no hay contraseña puesta, así que este aparato no busca nada. Ponla en Ajustes, en «Enviar cifrado», y que sea la misma que en el otro.')
    return
  }
  try {
    const maleta = await bajar(BUZON, claveRecordada())
    const antes = (await leerMovimientos()).length
    await guardarMovimientos(maleta.movimientos)
    const cambios = await mezclarDecisiones(maleta.decisiones ?? {})
    const ahora = (await leerMovimientos()).length
    marcarSincro()
    // Mirar el buzón también sirve para ver si falta ahí lo de aquí. Sin esto
    // sólo se subía al importar o al decidir algo: si aquella vez falló, lo de
    // este aparato no volvía a salir nunca.
    if (ahora > maleta.movimientos.length || hayQueSubir(await leerDecisiones(), maleta.decisiones ?? {})) publicar()
    if (ahora === antes && cambios === 0) {
      pintarSincro()
      if (aMano) decir(`Ya tenías todo lo que hay en el otro dispositivo: ${ahora} movimientos.`)
      return
    }
    await refrescar({ animar: antes === 0, local: false })
    if (ahora !== antes) decir(`Traídos ${ahora - antes} movimientos del otro dispositivo.`)
    else decir('Actualizado con lo que cambiaste en el otro dispositivo.')
  } catch (fallo) {
    // Un buzón vacío teniendo datos aquí es lo mismo: esto nunca llegó a salir.
    if (fallo instanceof SinBuzon) {
      if ((await leerMovimientos()).length > 0) publicar()
      if (aMano) decir('Con esa contraseña no hay nada guardado. Si en el otro aparato usaste otra, ésta no le vale.')
      return
    }
    if (fallo instanceof ContrasenaInvalida) {
      if (aMano) decir('La contraseña de este aparato no abre lo que hay guardado. No es la misma que la del otro.')
      return
    }
    if (aMano) decir(`No he podido mirar: ${fallo instanceof Error ? fallo.message : fallo}`)
    // Sin red: no es momento de dar la lata. Los botones de Ajustes siguen ahí.
  }
}


/**
 * Tirar hacia abajo estando arriba del todo busca lo del otro aparato.
 *
 * Solo hace falta cuando uno duda, y dudar es justo cuando no se puede esperar
 * veinte segundos sin saber si la espera sirve de algo. Además, pedirlo a mano
 * merece respuesta aunque no haya nada nuevo: el silencio se lee como avería.
 */
function tirarParaBuscar() {
  const tirador = document.getElementById('tirador')
  if (!tirador) return
  const UMBRAL = 70
  let empezo = -1
  let recorrido = 0
  let ocupado = false

  const guardar = () => {
    empezo = -1
    recorrido = 0
    tirador.style.transform = ''
    tirador.classList.add('suave')
    tirador.classList.remove('asomando', 'trabajando')
    setTimeout(() => tirador.classList.remove('suave'), 300)
  }

  addEventListener('touchstart', (e) => {
    if (ocupado || scrollY > 0 || e.touches.length !== 1) return
    empezo = e.touches[0].clientY
    recorrido = 0
  }, { passive: true })

  addEventListener('touchmove', (e) => {
    if (empezo < 0) return
    recorrido = e.touches[0].clientY - empezo
    if (recorrido <= 0 || scrollY > 0) return guardar()
    // Se arrastra a media velocidad: el dedo llega más lejos que el rótulo, y
    // así se nota que hay un tope al que llegar.
    tirador.classList.remove('suave')
    tirador.classList.add('asomando')
    tirador.style.transform = `translate(-50%, ${Math.min(recorrido / 2, UMBRAL) - 48}px)`
    tirador.textContent = recorrido >= UMBRAL ? 'Suelta para buscar' : 'Tira para buscar'
  }, { passive: true })

  addEventListener('touchend', async () => {
    if (empezo < 0) return
    if (recorrido < UMBRAL) return guardar()
    empezo = -1
    ocupado = true
    tirador.style.transform = ''
    tirador.classList.add('suave', 'trabajando')
    tirador.textContent = 'Buscando…'
    try {
      await ponerseAlDia({ aMano: true })
    } finally {
      ocupado = false
      guardar()
    }
  })
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let envioPendiente
// Mientras se rehace el aparato entero, nada de fondo puede colarse a subir lo
// que está a medio borrar.
let forzando = false

/**
 * Cada decisión viaja sola, sin botón de por medio.
 *
 * Se espera un momento porque una corrección suele venir en ráfaga —tres
 * recibos seguidos— y subir tres veces sería pagar tres viajes por el mismo
 * resultado. Antes de subir se baja: si no, publicar lo de aquí borraría del
 * buzón lo que el otro dispositivo dejó mientras tanto.
 */
function publicar() {
  if (!BUZON || forzando || !claveRecordada()) return
  clearTimeout(envioPendiente)
  envioPendiente = setTimeout(async () => {
    const clave = claveRecordada()
    if (!clave) return
    try {
      try {
        const suya = await bajar(BUZON, clave)
        await guardarMovimientos(suya.movimientos)
        if (await mezclarDecisiones(suya.decisiones ?? {})) await refrescar({ local: false })
      } catch (fallo) {
        if (!(fallo instanceof SinBuzon)) throw fallo
      }
      await subir(BUZON, hacerMaleta(await leerMovimientos(), await leerDecisiones()), clave)
      marcarSincro()
      pintarSincro()
    } catch {
      // El cambio ya está guardado aquí. Viajará con el siguiente, o al volver
      // a abrir la app: no hay nada que el usuario pueda hacer con este aviso.
    }
  }, 1200)
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
    await subir(BUZON, hacerMaleta(await leerMovimientos(), await leerDecisiones()), clave)
    marcarSincro()
    pintarSincro()
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
 * El rótulo fijo vive en Ajustes, y ahora que hay seis áreas casi nunca es la
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

/**
 * Lo que hay aquí y cuándo se juntó por última vez con el otro aparato.
 *
 * Sin esto, tener la contraseña puesta parecía estar sincronizado, y se podían
 * pasar meses con dos aparatos distintos sin que nada lo dijera.
 */
async function pintarSincro() {
  const donde = document.getElementById('huella-sincro')
  if (!donde) return
  const cuantos = (await leerMovimientos()).length
  const decisiones = Object.entries(await leerDecisiones())
    .filter(([almacen, filas]) => almacen !== 'lapidas' && filas.length > 0)
    .map(([almacen, filas]) => `${almacen} ${filas.length}`)
    .join(', ')
  const cuando = ultimaSincro()
  const fecha = cuando
    ? new Date(cuando).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : ''
  donde.textContent = `${cuantos} movimientos en este dispositivo. `
    + (fecha ? `Lo último que se juntó con el otro: ${fecha}.` : 'Todavía no se ha juntado con ningún otro.')
    + (decisiones ? ` Decidido a mano: ${decisiones}.` : ' Nada decidido a mano.')
    + ` ${await buzonPuesto()}`
}

// Sale de la contraseña, así que dos aparatos que no lo compartan no se están
// hablando por mucho que cada uno diga que se ha puesto al día.
async function buzonPuesto() {
  const clave = claveRecordada()
  if (!clave) return 'Sin contraseña puesta: este aparato no se junta con ninguno.'
  try {
    return `Buzón ${(await buzonDesde(clave)).slice(0, 8)}.`
  } catch {
    return ''
  }
}

/**
 * Qué versión del programa está corriendo aquí.
 *
 * Instalada en el teléfono no se cierra nunca, así que puede quedarse meses
 * atrás enseñando cuentas viejas con datos nuevos. Sin poder comparar las dos
 * versiones, eso parece un error de cálculo.
 */

/**
 * Cuando dos aparatos han ido cada uno por su lado, fundirlos deja una mezcla
 * que no es la de ninguno. Esto renuncia a mezclar: manda el buzón y aquí no
 * queda nada de antes.
 */
async function rehacer() {
  if (!BUZON) return decir('Esta copia no tiene buzón del que traer nada.')

  const mios = (await leerMovimientos()).length
  const aviso = mios > 0
    ? `Se borran los ${mios} movimientos de este dispositivo y todo lo que hayas decidido aquí, y se pone en su lugar lo del otro. No hay vuelta atrás.`
    : 'Se trae todo lo que haya guardado en el otro dispositivo.'
  if (!confirm(aviso)) return

  const clave = claveRecordada() || await pedirClave({
    aceptar: 'Traer',
    pie: 'La misma contraseña que tienes puesta en el otro dispositivo.',
  })
  if (!clave) return

  forzando = true
  decir('Trayendo…')
  try {
    const maleta = await bajar(BUZON, clave)
    await vaciar()
    await guardarMovimientos(maleta.movimientos)
    await mezclarDecisiones(maleta.decisiones ?? {})
    if (quiereRecordar()) recordarClave(clave)
    marcarSincro()
    await refrescar({ animar: true, local: false })
    pintarSincro()
    decir(`Este dispositivo es ahora igual que el otro: ${maleta.movimientos.length} movimientos.`)
  } catch (fallo) {
    if (fallo instanceof ContrasenaInvalida) decir('Esa contraseña no abre lo que hay guardado, así que no he borrado nada.')
    else if (fallo instanceof SinBuzon) decir('No hay nada guardado con esa contraseña, así que no he borrado nada.')
    else decir(`No he podido traerlo, y no he borrado nada: ${fallo instanceof Error ? fallo.message : fallo}`)
  } finally {
    forzando = false
  }
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

  const maleta = hacerMaleta(guardados, await leerDecisiones())
  decir('Cifrando…')
  if (quiereRecordar()) recordarClave(clave)
  try {
    if (BUZON) {
      await subir(BUZON, maleta, clave)
      marcarSincro()
      pintarSincro()
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
      await mezclarDecisiones(maleta.decisiones ?? {})
      if (quiereRecordar()) recordarClave(clave)
      await refrescar({ animar: true, local: false })
      marcarSincro()
      pintarSincro()
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

