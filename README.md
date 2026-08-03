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


## v6.3
- Recarga completa al cambiar de pestaña.
- Guarda las solicitudes pendientes antes de mostrar otra sección.
- Recarga completa al volver a la aplicación.


## Cambios v6.3

- La selección optimista ya no puede ser sobrescrita por una lectura antigua que termine más tarde.
- La cola local se separa por usuario y conserva incluso una selección vacía.
- Los reintentos no eliminan cambios más recientes.
- Al cambiar de pestaña se guardan primero los cambios y después se recargan todos los datos.
- Los PIN son numéricos, con una o más cifras y sin longitud máxima fijada por la aplicación.
- Las acciones de cambio y restablecimiento de PIN usan nombres compatibles con versiones anteriores del backend.
