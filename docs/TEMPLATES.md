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
  "metric": "speed",       // speed|heartRate|power|cadence|elevation|distance|elapsedTime|grade|vam|gears|none
  "kind": "gauge",         // stat|number|gauge|zones|speedo|ring|hbar|slope|gears|spark|profile|vam|map|navmap|compass|goal (required)
  "visible": true,
  "label": "VEL",          // optional custom label (stat + gauge; number ignores it)
  "showUnit": true,        // optional, default true
  "range": [0, 12],        // optional gauge scale in raw SI units (default per metric)
  "zoneBase": 250,         // optional: FTP watts (zones) or max HR bpm (hbar)
  "strokeWidth": 6,        // optional trail width in px (map; auto when absent)
  "style": {               // optional per-widget overrides
    "shape": "pill",       // rect|pill|none (default rect)
    "background": "#000000",
    "backgroundOpacity": 0.5,
    "accent": "#ffffff",
    "text": "#ffffff",
    "labelFont": "Poppins, sans-serif",  // optional, theme font when absent
    "labelScale": 1,                     // optional label size multiplier
    "valueFont": "Poppins, sans-serif",  // optional, theme font when absent
    "valueScale": 1.2                    // optional value (number) size multiplier
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
- `zones`: 7-segment Coggan power arc, active zone lit + `Z1..Z7` tag.
  Base from `zoneBase` (FTP watts, default 250).
- `speedo`: 180° speedometer with ticks, needle and digital readout.
- `ring`: full progress ring for any metric + `range`, value centered.
- `hbar`: 5-segment HR zone bar with position marker + `Z1..Z5` tag.
  Base from `zoneBase` (max HR bpm, default 185).
- `slope`: grade inclinometer, bubble on a centered track.
- `gears`: front × rear teeth from shift events (`gears` metric). `—` without Di2/AXS.
- `spark`: last-30 s area sparkline of any metric + current value. Needs history.
- `profile`: full-ride elevation profile, ridden part shaded + you-are-here dot.
  Needs history.
- `vam`: 60 s climb rate (`vam` metric) with trend arrow. Needs history.
- `map`: GPS track, faint full route + accent ridden trail + current dot.
  Metric `none`. Needs history with lat/lon. Trail width from `strokeWidth`,
  else auto-sized from the box.
- `navmap`: navigation view, 50 m behind + 400 m ahead, course-up, position
  arrow. Metric `none`. Needs history with lat/lon + motion. Same
  `strokeWidth` as `map`.
- `compass`: GPS course dial, card rotated so course points up + degrees.
  Metric `none`. Needs history with motion.
- `goal`: progress to `range[1]` meters (`distance` metric) with live ETA.

History kinds (`spark`, `profile`, `vam`, `map`, `navmap`, `compass`) receive
the full series at render time; without data they show `—`.

### Gauge default ranges (raw SI)

speed `[0, 15]` m/s · heartRate `[40, 200]` bpm · power `[0, 400]` W ·
cadence `[0, 120]` rpm · elevation `[0, 1000]` m · distance `[0, 10000]` m ·
elapsedTime `[0, 3600]` s · grade `[-15, 15]` % · vam `[0, 2000]` m/h.

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

## Custom, export, import

The strip starts with a white **+** card that opens the new-template dialog:
type a name to create a blank template (first position, selected, ready for
widgets), or pick a previously exported `.json` to restore it instantly. A
typed name wins over the file's embedded name; imports always get a fresh id
so they never collide with the built-ins.

Each card carries its own small export icon button (right of the name), which
downloads that template with its current widget setup (visibility, layout,
style, added widgets) as `{name}.json`. The importer
(`parseTemplateJson` in `shared/src/template.ts`) requires the shape above —
name string, widgets array, one box per aspect per widget — fills a neutral
theme when fields are missing, defaults `visible` to true, and rejects
unknown widget kinds/metrics. Covered by `npm run check` (+ tpljson).

## Built-ins

broadcast · minimal · climb · chrono · strip · story · apex · pulse ·
zones · speedo · ring · hbar · slope · gears · spark · profile · vam ·
routemap · navmap · compass · goal.

New metrics: `vam` (m/h, computed over 60 s), `gears` (shift teeth, never
interpolated), `none` (map/compass placeholders).
`apex` and `pulse` exercise gauges, numbers, pill/transparent panels, custom
labels and explicit ranges — use them as the reference for new kinds.
