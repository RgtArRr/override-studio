# Fixtures

- `video/sample-720p.mp4` — clip horizontal 10 s (Fase 0).
- `video/sample-vertical.mp4` — clip vertical 10 s (Fase 0).
- `video/sample-square.mp4` — clip cuadrado 10 s (Fase 4).
- `video/sample-long.mp4` — clip horizontal 180 s para prueba de memoria (Fase 5).
- `templates/broadcast.json` — ejemplo del schema v1.
- `activity/sample.fit` — 120 registros @1Hz, generado con `node fixtures/make-sample-fit.mjs`.
- `activity/sample-long.fit` — 200 registros @1Hz para el clip largo (`node fixtures/make-sample-fit.mjs 200 sample-long`).
