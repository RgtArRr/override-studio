# Fixtures

Archivos de ejemplo para desarrollo y pruebas (solo entorno local):

- `video/sample-720p.mp4` — clip horizontal de 10 s con `creation_time` 10:00:05Z (5 s después del inicio del FIT, para probar el offset automático).
- `video/sample-vertical.mp4` — clip vertical de 10 s (pruebas de aspecto vertical).
- `video/sample-square.mp4` — clip cuadrado de 10 s (pruebas de aspecto cuadrado).
- `video/sample-long.mp4` — clip horizontal de 180 s (pruebas de memoria).
- `video/sample.mov` — clip MOV/H.264 de 5 s (verificado: renderiza conservando el audio).
- `video/sample-hevc.mov` — clip MOV/HEVC de 5 s con perfil típico de iPhone (verificado: Chrome headless no lo decodifica).
- `templates/*.json` — 18 plantillas del schema v2 (ver `docs/TEMPLATES.md`).
- `activity/sample.fit` — 120 registros a 1 Hz, generado con `node fixtures/make-sample-fit.mjs`.
- `activity/sample-long.fit` — 200 registros a 1 Hz para el clip largo (`node fixtures/make-sample-fit.mjs 200 sample-long`).
