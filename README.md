# override.studio

Editor web que incrusta telemetría deportiva en clips MP4/MOV (H.264). 100% client-side para el render (WebCodecs + Canvas + MediaBunny), backend full-JS en Cloudflare Workers + D1.

## Comandos

```bash
npm install
npm run dev        # web (5173) + api (8787) juntos
npm run dev:web    # solo frontend
npm run dev:api    # solo worker (wrangler local + D1 local)
npm run typecheck
npm run check
npm run build
npm run deploy     # build web + deploy del Worker en Cloudflare
```

Abrir en el navegador: <http://localhost:5173> (Chrome o Edge).

## Estructura

- `web/` — app estática (Vite + TS). Render, editor y overlay en el navegador.
- `api/` — Cloudflare Worker (JS/TS). Auth + plantillas en la nube + Intervals.icu + D1.
- `shared/` — schema versionado de templates + tipos comunes.
- `fixtures/` — MP4/MOV de ejemplo, templates de ejemplo, `.fit`.
- `scripts/` — checks (`check.mjs`) y generación SEO (`seo-build.mjs`).
- `docs/` — setup de auth, sistema de diseño, schema de plantillas.

## Soporte

Chrome/Edge desktop y Android. Safari e iOS no soportados (sin WebCodecs): la app lo detecta y lo indica.

## Licencia

MIT — ver [LICENSE](LICENSE).
