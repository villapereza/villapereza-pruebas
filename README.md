# Villa Pereza · Gestión de pruebas

Aplicación web móvil para gestionar las solicitudes y asignaciones de las pruebas de las Olimpiadas.

- `index.html`: aplicación del equipo.
- `admin.html`: panel de administración.
- Google Sheets: base de datos.
- Google Apps Script: API y autenticación.
- GitHub Pages: alojamiento de la interfaz.

La dirección de la API ya está configurada en `config.js`.


## Versión 2.1.0

- Incompatibilidades configurables entre pruebas.
- Bloqueo inmediato y validación de servidor ante asignaciones incompatibles.


## v5.1
Corrección de caché para evitar mezclar versiones del panel y asegurar que el selector de incompatibilidades cargue correctamente.


## Versión 6.0
- Control de usuarios con sus pruebas asignadas.
- Edición del reparto completo por persona.
- PIN exclusivamente numérico, con cualquier longitud a partir de 1 cifra.


## Versión 6.1
- El PIN puede tener cualquier longitud desde 1 cifra.
- Se mantienen únicamente caracteres numéricos.


## v6.2
- Recarga completa al cambiar de pestaña.
- Guarda las solicitudes pendientes antes de mostrar otra sección.
- Recarga completa al volver a la aplicación.
