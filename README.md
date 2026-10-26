# override.studio

Editor web que incrusta telemetría deportiva en clips MP4. 100% client-side para el render (WebCodecs + Canvas + MediaBunny), backend full-JS en Cloudflare Workers + D1, plantillas generadas con Meta Model API (`muse-spark-1.3-contributor`).

## Comandos

```bash
npm install
npm run dev        # web (5173) + api (8787) juntos
npm run dev:web    # solo frontend
npm run dev:api    # solo worker (wrangler local + D1 local)
npm run typecheck
npm run build
```

Abrir en el navegador: <http://localhost:5173> (Chrome o Edge).

## Estructura

- `web/` — app estática (Vite + TS). Render, editor y overlay en el navegador.
- `api/` — Cloudflare Worker (JS/TS). Proxy de Meta Model API + D1.
- `shared/` — schema versionado de templates + tipos comunes.
- `fixtures/` — MP4 de ejemplo, templates de ejemplo, `.fit` (desde Fase 1).

## Soporte

Chrome/Edge desktop y Android. Safari e iOS no soportados (sin WebCodecs): la app lo detecta y lo indica.

## Fases

0 cimientos · 1 ingesta+sync · 2 render · 3 editor · 4 catálogo · 5 hito · 6 Muse gen · 7 Muse refine · 8 cierre · 9 stretch.
