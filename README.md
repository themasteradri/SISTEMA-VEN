# Control · Sistema de ventas

Versión React del panel Django. Consulta de empresas, ventas y sus líneas, inventario, Kardex, gastos y pronóstico. Los listados incluyen búsqueda, paginación y un modal de detalle.

## Abrir en local

Con Node.js 22.12+ y npm, desde este repositorio:

```sh
npm ci
npm run dev
```

Abre la URL que indique Vite, pulsa **Importar SQLite** y elige el archivo `db.sqlite3` del proyecto Django. La aplicación lee las tablas necesarias en el navegador y conserva el resultado en memoria hasta recargar la página. El selector de empresa filtra la vista. El archivo se abre para consulta y las tablas de contraseñas y sesiones quedan fuera de las consultas.

## Preparar para Vercel

`npm run build` genera el sitio estático en `dist/`. En Vercel, importa este repositorio y usa el preset Vite. El despliegue contiene solo la aplicación. Cada persona importa su archivo desde su propio equipo. Esta versión es de consulta y el selector de empresa sirve como filtro de datos, sin inicio de sesión.
