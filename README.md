# Villa Pereza · Gestión de pruebas — v8.0.0 definitiva

## Funciones incluidas

- PIN numérico de exactamente 4 cifras.
- PIN inicial y de restablecimiento: `1234`.
- Cambio obligatorio del PIN en el primer acceso.
- Gestión completa de usuarios, pruebas, cupos, días e incompatibilidades.
- Solicitudes públicas con nombres de las demás personas interesadas.
- Resolución por pruebas o por personas, agrupada por viernes 21, sábado 22 y domingo 23.
- Asignación directa aunque una persona no hubiera solicitado la prueba.
- Control de reparto recomendado entre 2 y 4 pruebas por participante.
- Actualización al cambiar de pestaña, después de guardar y comprobación cada segundo.
- Guardado local de solicitudes pendientes y reintento automático.
- Protección contra respuestas antiguas que desmarquen elecciones recientes.
- Sin Service Worker persistente para evitar que GitHub Pages cargue versiones antiguas.
- Diagnóstico visible de versión Web/API.

## Instalación

1. Sustituir `Code.gs` por `Code_Villa_Pereza_v8.gs`.
2. Recargar Google Sheets y ejecutar **Villa Pereza → Aplicar versión definitiva v8**.
3. Actualizar la implementación existente de Apps Script seleccionando **Nueva versión**.
4. Subir todo el contenido de esta carpeta a la raíz de GitHub.
5. Abrir `actualizar.html` una vez.
6. Comprobar que el acceso muestra `Web 8.0.0 · API 8.0.0`.

La preparación definitiva restablece los PIN de todas las cuentas activas a `1234`, cierra las sesiones antiguas y obliga a escoger un PIN nuevo de 4 cifras.
