# Fixtures

- `video/sample-720p.mp4` — clip horizontal 10 s con `creation_time` 10:00:05Z (5 s después del inicio del FIT, para probar el offset auto).
- `video/sample-vertical.mp4` — clip vertical 10 s (Fase 0).
- `video/sample-square.mp4` — clip cuadrado 10 s (Fase 4).
- `video/sample-long.mp4` — clip horizontal 180 s para prueba de memoria (Fase 5).
- `video/sample.mov` — clip MOV/H.264 5 s (verificado: renderiza con audio).
- `video/sample-hevc.mov` — clip MOV/HEVC 5 s tipo iPhone (verificado: sin decode en Chrome headless).
- `templates/*.json` — 8 plantillas del schema v2 (ver `docs/TEMPLATES.md`).
- `activity/sample.fit` — 120 registros @1Hz, generado con `node fixtures/make-sample-fit.mjs`.
- `activity/sample-long.fit` — 200 registros @1Hz para el clip largo (`node fixtures/make-sample-fit.mjs 200 sample-long`).
