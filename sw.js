/**
 * Caché para que la app abra sin red.
 *
 * Los datos NO pasan por aquí: viven en IndexedDB. Esto solo guarda el
 * programa, que es lo único que hace falta descargar.
 */

const CAU = 'bajamar-905eb76d57'

const PROGRAMA = [
  './',
  './index.html',
  './config.js',
  './manifest.webmanifest',
  './icono.svg',
  './src/ui/estilo.css',
  './src/almacen/cifrado.js',
  './src/almacen/db.js',
  './src/almacen/llavero.js',
  './src/almacen/preferencias.js',
  './src/almacen/sincro.js',
  './src/analisis/alertas.js',
  './src/analisis/bajamar.js',
  './src/analisis/cascada.js',
  './src/analisis/compromisos.js',
  './src/analisis/fijos.js',
  './src/analisis/fraccionados.js',
  './src/analisis/mensual.js',
  './src/analisis/mes.js',
  './src/analisis/objetivos.js',
  './src/analisis/patrimonio.js',
  './src/analisis/periodos.js',
  './src/analisis/plan.js',
  './src/analisis/presupuestos.js',
  './src/analisis/reparto.js',
  './src/dominio/dinero.js',
  './src/dominio/tipos.js',
  './src/entidades/limpiar.js',
  './src/entidades/oficios.js',
  './src/entidades/reconciliar.js',
  './src/entidades/semillas.js',
  './src/estado.js',
  './src/importar/biff.js',
  './src/importar/ole2.js',
  './src/importar/sabadell.js',
  './src/importar/xls.js',
  './src/ui/app.js',
  './src/ui/clave.js',
  './src/ui/hoja.js',
  './src/ui/lamina.js',
  './src/ui/nav.js',
  './src/ui/piezas.js',
  './src/ui/simulador.js',
  './src/ui/trato.js',
  './src/ui/vistas/ajustes.js',
  './src/ui/vistas/movimientos.js',
  './src/ui/vistas/patrimonio.js',
  './src/ui/vistas/prevision.js',
  './src/ui/vistas/resumen.js',
]

// Si al instalar ya había programa, esto es un relevo y hay ventanas mirando
// una versión que ya no existe.
let relevo = false

self.addEventListener('install', (evento) => {
  evento.waitUntil((async () => {
    relevo = (await caches.keys()).some((c) => c.startsWith('bajamar-') && c !== CAU)
    const cau = await caches.open(CAU)
    await cau.addAll(PROGRAMA.map((u) => new Request(u, { cache: 'reload' })))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    const claves = await caches.keys()
    await Promise.all(claves.filter((c) => c !== CAU).map((c) => caches.delete(c)))
    await self.clients.claim()
    if (!relevo) return
    // Recargar desde aquí y no desde la página: instalada en el teléfono, la
    // página nunca se vuelve a leer, así que un arreglo que viva en ella no
    // llega jamás a la versión vieja que hay que relevar.
    for (const ventana of await self.clients.matchAll({ type: 'window' })) {
      try {
        await ventana.navigate(ventana.url)
      } catch {
        // Una ventana que no controlamos todavía no se puede navegar; al abrirla
        // de nuevo ya vendrá con lo nuevo.
      }
    }
  })())
})

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request
  if (peticion.method !== 'GET') return
  // El buzón nunca se cachea: pedirlo es justamente preguntar si hay algo nuevo.
  if (!peticion.url.startsWith(self.registration.scope)) return

  evento.respondWith(
    caches.match(peticion).then((guardado) => {
      // `reload` salta la caché HTTP: GitHub sirve el HTML con diez minutos de
      // vida y, sin esto, revalidar contra ella devolvía lo viejo otra vez.
      const red = fetch(peticion, { cache: 'reload' })
        .then((respuesta) => {
          if (respuesta.ok) {
            const copia = respuesta.clone()
            caches.open(CAU).then((cau) => cau.put(peticion, copia))
          }
          return respuesta
        })
        .catch(() => guardado)
      return guardado || red
    }),
  )
})
