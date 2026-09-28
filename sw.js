// Aquí vivía la PWA. Se ha quitado para rehacerla desde cero, pero este fichero
// no se puede borrar: los aparatos que ya la instalaron seguirían sirviéndose
// una copia vieja para siempre. Esto es lo que los libera.
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    for (const nombre of await caches.keys()) await caches.delete(nombre)
    await self.registration.unregister()
    for (const ventana of await self.clients.matchAll({ type: 'window' })) {
      try {
        await ventana.navigate(ventana.url)
      } catch {
        // La que no controlamos ya vendrá limpia la próxima vez que se abra.
      }
    }
  })())
})
