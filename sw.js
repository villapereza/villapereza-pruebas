self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil((async()=>{const n=await caches.keys();await Promise.all(n.map(x=>caches.delete(x)));await self.registration.unregister();})()));
