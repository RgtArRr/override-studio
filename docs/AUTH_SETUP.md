# Auth: cuentas opcionales (clásico + Intervals.icu)

La app es login-less por defecto. Con cuenta, las plantillas propias se
guardan en la nube y se conectan proveedores de telemetría (hoy
Intervals.icu por API key).
Stack: Worker + D1 (Auth.js v5 solo para la maquinaria de
sesión/signout; login clásico propio en la misma tabla). Sin vendors
externos.

## Login clásico (sin setup)

Registro y entrada con correo + contraseña: `POST /api/register`,
`POST /api/login`. Política mínima: 10+ caracteres, letra y número.
Hash PBKDF2-HMAC-SHA256 (100k iteraciones, salt aleatorio) vía WebCrypto;
mismo error y mismo costo para correo inexistente o clave mala.
No hay recuperación por correo (no hay mailer): registrar pide
confirmar la contraseña para evitar typos con bloqueo permanente.

## 1. Secretos

Local (`api/.dev.vars`, ya ignorado por git):

```ini
AUTH_SECRET=cualquier-string-largo-al-azar
AUTH_URL=http://localhost:8787
WEB_ORIGIN=http://localhost:5173,http://localhost:5174
```

(Si el API ya estaba corriendo al crear este archivo, reinicia
`npm run dev`: wrangler lo lee al arrancar.)

(`WEB_ORIGIN` acepta lista separada por comas: los puertos dev cambian.)

Producción (una vez):

```bash
wrangler secret put AUTH_SECRET --config api/wrangler.toml
```

`AUTH_URL` y `WEB_ORIGIN` de prod ya están en `api/wrangler.toml` ([vars]).

## 2. Base de datos

```bash
# local (ya aplicada si seguiste el dev normal)
npm run db:apply:local --workspace=api
# producción
wrangler d1 migrations apply override-studio-db --config api/wrangler.toml
```

Migraciones: `0002_auth.sql` (tablas Auth.js + `user_templates`),
`0003_credentials.sql` (hash local), `0004_provider_keys.sql` (API keys
cifradas), `0005_drop_strava.sql` (purga tokens Strava retirados).

## 3. Probar

```bash
npm run dev   # web :5173 + api :8787
```

- El login clásico funciona sin setup: Entrar → Crear cuenta.
- Intervals.icu funciona con cualquier API key válida de usuario, sin
  secretos del lado servidor.

## Endpoints

- `GET /api/auth/*` — Auth.js (signin, callback, signout, session).
- `POST /api/register`, `POST /api/login` — clásico (`{email, password}` →
  `{user}` + cookie; errores `email|weak|taken|invalid`).
- `GET /api/me` — usuario actual o 401.
- `GET/POST /api/my/templates`, `PUT/DELETE /api/my/templates/:id` — CRUD con
  sesión; el POST hace upsert por id y valida con `parseTemplateJson`.
- `GET /api/intervals/status` — `{ connected }` (401 sin sesión).
- `PUT/DELETE /api/intervals/key` — guarda/olvida la API key (PUT la valida).
- `GET /api/intervals/activities?page=` — ventanas de 30 días (máx 12).
- `GET /api/intervals/activities/:id/streams` — streams `{ tipo: datos }`.

## Intervals.icu como fuente (API key por usuario)

Sin OAuth: cada usuario pega su API key (final de
[intervals.icu/settings](https://intervals.icu/settings)) en el modal
"Elegir de Intervals". El API la valida contra `athlete/0`, la guarda
cifrada (AES-GCM con `AUTH_SECRET`, tabla `provider_keys`) y la usa para
listar actividades y traer streams. Notas:

- Auth upstream: Basic `API_KEY:<key>`; atleta `0` = propio.
- Streams por `streams.json?types=...` (el GET plano no existe, es solo PUT).
- IDs de actividad son strings (`i123`); `start_date_local` se interpreta
  con su `timezone` IANA (sin zona, hora local del navegador).
- `velocity_smooth` se asume m/s (API métrica): verificar con una salida
  real; si la velocidad sale mal, es ese factor.
- Sin clave, el modal pide pegarla; si muere, pide reingresarla.
