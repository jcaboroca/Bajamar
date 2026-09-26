/**
 * Caché para que la app abra sin red.
 *
 * Los datos NO pasan por aquí: viven en IndexedDB. Esto solo guarda el
 * programa, que es lo único que hace falta descargar.
 */

const CAU = 'bajamar-v6'

const PROGRAMA = [
  './',
  './index.html',
  './config.js',
  './manifest.webmanifest',
  './icono.svg',
  './src/ui/estilo.css',
  './src/ui/app.js',
  './src/ui/lamina.js',
  './src/ui/clave.js',
  './src/estado.js',
  './src/almacen/db.js',
  './src/almacen/cifrado.js',
  './src/almacen/sincro.js',
  './src/almacen/llavero.js',
  './src/analisis/bajamar.js',
  './src/analisis/compromisos.js',
  './src/dominio/dinero.js',
  './src/dominio/tipos.js',
  './src/entidades/limpiar.js',
  './src/entidades/reconciliar.js',
  './src/entidades/semillas.js',
  './src/importar/biff.js',
  './src/importar/ole2.js',
  './src/importar/sabadell.js',
  './src/importar/xls.js',
]

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CAU)
      .then((cau) => cau.addAll(PROGRAMA.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== CAU).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  )
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
