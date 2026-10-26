# Template schema v2

Templates are JSON data validated against this spec (see `shared/src/template.ts`
for the types). The renderer (`web/src/overlay.ts`) implements exactly what follows —
nothing more. AI-generated templates must conform to it.

## Shape

```jsonc
{
  "schemaVersion": 2,
  "id": "apex",            // unique, lowercase
  "name": "Apex",          // display name
  "description": "…",      // optional
  "theme": {
    "fontFamily": "system-ui, sans-serif",
    "text": "#ffffff",     // value + label text
    "accent": "#00e5ff",   // labels, gauge arc, unit
    "panel": "#0b0e11",    // widget background
    "panelOpacity": 0.6    // 0..1
  },
  "widgets": [ Widget, … ]
}
```

## Widget

```jsonc
{
  "id": "speed",           // unique within the template
  "metric": "speed",       // speed|heartRate|power|cadence|elevation|distance|elapsedTime|grade
  "kind": "gauge",         // stat|number|gauge (required)
  "visible": true,
  "label": "VEL",          // optional custom label (stat + gauge; number ignores it)
  "showUnit": true,        // optional, default true
  "range": [0, 12],        // optional gauge scale in raw SI units (default per metric)
  "style": {               // optional per-widget overrides
    "shape": "pill",       // rect|pill|none (default rect)
    "background": "#000000",
    "backgroundOpacity": 0.5,
    "accent": "#ffffff",
    "text": "#ffffff"
  },
  "layout": {              // required: one box per aspect, normalized 0..1
    "horizontal": { "x": 0.03, "y": 0.4, "w": 0.32, "h": 0.55 },
    "square": { … },
    "vertical": { … }
  }
}
```

### Kinds

- `stat`: label (accent, top-left) + value + unit (bottom-left). The default workhorse.
- `number`: big centered value, unit small beneath. No label. Set `shape: 'none'`
  and `showUnit: false` for a pure floating number.
- `gauge`: 270° arc with background track + accent value arc, value centered,
  label on top. Scale from `range`, else the built-in default.

### Gauge default ranges (raw SI)

speed `[0, 15]` m/s · heartRate `[40, 200]` bpm · power `[0, 400]` W ·
cadence `[0, 120]` rpm · elevation `[0, 1000]` m · distance `[0, 10000]` m ·
elapsedTime `[0, 3600]` s · grade `[-15, 15]` %.

Gauges suit rate-like metrics (speed, heartRate, power, cadence). Anything is
allowed, but a distance gauge rarely makes sense.

## Layout rules

- One box per aspect (`vertical` | `square` | `horizontal`); all three required.
- Boxes must fit inside the frame (`x + w ≤ 1`, `y + h ≤ 1`).
- Boxes of visible widgets must not overlap.
- Keep every box ≥ 24×16 px at 720p and at 512×288 (thumbnail size), or the
  renderer skips it.
- Gauges want squarish boxes; numbers want wide boxes.

## Values and units

Metrics arrive in raw SI units (m/s, m, s, …) and the renderer formats them for
the selected units (metric/imperial). `elapsedTime` is FIT elapsed seconds at the
rendered moment and formats as `h:mm:ss`. If a metric is missing from the data,
the widget shows `—`.

## Built-ins

broadcast · minimal · climb · chrono · strip · story · apex · pulse.
`apex` and `pulse` exercise gauges, numbers, pill/transparent panels, custom
labels and explicit ranges — use them as the reference for new kinds.
