// La aplicación entera, guardada en el aparato, para que exista sin cobertura.
//
// El sello lo reescribe scripts/sellar.mjs en cada publicación, y que este
// fichero cambie es justo lo que hace que el navegador se entere: el script de
// un service worker no se sirve nunca de la caché, así que es el único sitio
// del que uno se puede fiar. Cada sello tiene su propio almacén: mientras se
// llena el nuevo, el viejo sigue sirviendo la versión que ya funcionaba.
const SELLO = '2416ee576aad'
const ALMACEN = `bajamar-${SELLO}`
const PORTADA = './'

// El sello vive fuera del almacén a propósito: si viniera de dentro, la app no
// podría enterarse nunca de que hay una versión nueva.
const SIEMPRE_DE_RED = 'version.json'

async function loQueHayQueGuardar() {
  const respuesta = await fetch(SIEMPRE_DE_RED, { cache: 'no-store' })
  const datos = await respuesta.json()
  return [PORTADA, 'icono.svg', 'icono-512.png', ...(datos.ficheros ?? [])]
}

self.addEventListener('install', (evento) => {
  evento.waitUntil((async () => {
    const almacen = await caches.open(ALMACEN)
    const rutas = await loQueHayQueGuardar().catch(() => [PORTADA])
    // Uno a uno y perdonando fallos: que falte un icono no puede dejarte sin app.
    await Promise.all(rutas.map(async (ruta) => {
      try {
        await almacen.add(new Request(ruta, { cache: 'reload' }))
      } catch {
        // Ya se pedirá a la red el día que haga falta.
      }
    }))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    for (const nombre of await caches.keys()) {
      if (nombre !== ALMACEN) await caches.delete(nombre)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request
  if (peticion.method !== 'GET') return
  const url = new URL(peticion.url)
  // El buzón es de otra casa: ahí no me meto.
  if (url.origin !== location.origin) return

  // Da igual con qué ?v= llegues: la portada es siempre la misma.
  const navegando = peticion.mode === 'navigate'
  const clave = navegando ? PORTADA : url.pathname
  const vaALaRed = url.pathname.endsWith(SIEMPRE_DE_RED)
    || peticion.cache === 'reload'
    || peticion.cache === 'no-store'

  evento.respondWith((async () => {
    // Siempre contra el almacén de este sello: nunca una mezcla de dos versiones.
    const almacen = await caches.open(ALMACEN)
    if (!vaALaRed) {
      const guardado = await almacen.match(clave)
      if (guardado) return guardado
    }
    try {
      const deLaRed = await fetch(navegando ? PORTADA : url.href, { cache: 'reload' })
      if (deLaRed.ok) almacen.put(clave, deLaRed.clone())
      return deLaRed
    } catch (error) {
      const guardado = await almacen.match(clave)
      if (guardado) return guardado
      throw error
    }
  })())
})
