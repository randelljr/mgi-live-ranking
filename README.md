# MGI Live Ranking — Group B

Configuración confirmada:
- Página pública
- Actualización automática: cada 5 minutos
- Historial: sí
- Like = 1 punto
- Comentario = 1 punto
- Repost = 2 puntos

## Ejecutar
1. Instala Node.js 20+
2. `npm install`
3. `npm run install:browsers`
4. Define `ADMIN_KEY`
5. `npm start`
6. Abre `http://localhost:3000`

## Publicar
Recomendado: Railway o Render, usando el Dockerfile.

Variables:
- `ADMIN_KEY`: tu contraseña para correcciones manuales.

## Nota
El lector de Instagram es de mejor esfuerzo. Si Instagram no muestra una métrica al navegador automatizado, se conserva el último valor y puedes corregirlo manualmente.
