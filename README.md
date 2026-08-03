# Villa Pereza · Gestión de pruebas — v7

Aplicación móvil alojada en GitHub Pages con Google Apps Script y Google Sheets como backend.

## PIN

- Todos los PIN deben tener exactamente 4 cifras.
- El PIN inicial por defecto al crear o restablecer una cuenta es `1234`.
- La primera vez que una persona entra con el PIN temporal, debe elegir otro PIN de 4 cifras.
- El administrador puede restablecer el PIN de una persona a `1234` desde el panel.
- En Google Sheets existe además el menú **Villa Pereza → Restablecer PIN de participantes a 1234** para una migración masiva opcional.

## Instalación

1. Sustituye `Code.gs` por `Code_Villa_Pereza_v7.gs`.
2. Publica una nueva versión de la implementación existente de Apps Script.
3. Sube todo el contenido de esta carpeta a la raíz del repositorio de GitHub.
4. Abre la web con `?v=7` y realiza una recarga completa la primera vez.
