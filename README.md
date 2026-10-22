# TournamenSport

Plataforma para crear y organizar torneos deportivos. Este repositorio es una copia independiente de la base funcional de TournamentClash; los cambios aquí no modifican el proyecto original.

## Requisitos
- Node.js 20.19+ o 22.12+
- Un proyecto Supabase propio para TournamenSport

## Ejecutar localmente
1. Instalá dependencias: `npm install`
2. Copiá `.env.example` a `.env.local`
3. Completá `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` con las credenciales del proyecto Supabase NUEVO.
4. Ejecutá `npm run dev`
5. Verificá la compilación con `npm run build`

## Importante: base de datos independiente
No configures aquí las credenciales de TournamentClash si querés mantener los datos separados. Creá un proyecto Supabase nuevo y replicá allí las tablas, políticas RLS y funciones necesarias para la app antes de usarla en producción. Las claves públicas anon pueden estar en el frontend, pero nunca publiques una service-role key.

## Deploy
En Netlify, conectá este repositorio y configurá las mismas dos variables de entorno. Comando de build: `npm run build`; directorio de publicación: `dist`.
