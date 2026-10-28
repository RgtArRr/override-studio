# Cal.com — Design System

> Fuente: [design.ricoui.com/brands/cal](https://design.ricoui.com/brands/cal) — archivo `cal-com-design-system-DESIGN.md`.
> Sistema de referencia adoptado por override.studio. Tema: Light. Voz: Monochrome Utility, Human Touch.

Cal is a scheduling product whose interface feels precise, quiet and useful.
The visual system is predominantly black, white and graduated neutral gray.
Blue is a deliberately scarce functional accent for tertiary links and informational states.

## Foundations

### Color

| Token | Value | Usage |
| ---------------- | --------- | ------------------------------------------- |
| `ink` | `#101010` | Primary text, primary CTA, dark footer |
| `action-blue` | `#0099ff` | Tertiary links and informational highlights |
| `white` | `#ffffff` | Cards and elevated scheduling surfaces |
| `paper` | `#f4f4f4` | Main page background and quiet fills |
| `graphite` | `#242424` | Secondary text and controls |
| `slate` | `#6b7280` | Muted text |
| `stone` | `#898989` | Subtle labels |
| `silver` | `#e5e7eb` | Input and control borders |
| `info-banner-bg` | `#eff6fe` | Informational banner background |
| `google-blue` | `#4285f4` | Google integration mark only |
| `google-yellow` | `#fbbc04` | Google integration mark only |
| `google-green` | `#34a853` | Google integration mark only |
| `google-red` | `#ea4335` | Google integration mark only |

### Typography

Use **Cal Sans** for headings (fallback: Poppins or Gilroy), and **Cal Sans UI Variable Light**
for reading text (fallback: Inter Light). Inter is used for compact product UI.

| Role | Family | Weight | Size / line height | Tracking |
| ------------- | --------------------------------- | -----: | ------------------ | -------- |
| Caption | Cal Sans UI Variable Light, Inter | 300 | 12px / 1.4 | -0.24px |
| Body small | Cal Sans UI Variable Light, Inter | 300 | 14px / 1.5 | -0.20px |
| Body | Cal Sans UI Variable Light, Inter | 300 | 16px / 1.5 | -0.19px |
| Subheading | Cal Sans UI Variable Light, Inter | 300 | 18px / 1.4 | -0.20px |
| Heading small | Cal Sans, Poppins | 600 | 20px / 1.3 | 0.20px |
| Heading | Cal Sans, Poppins | 600 | 24px / 1.3 | 0.24px |
| Heading large | Cal Sans, Poppins | 600 | 48px / 1.1 | 0.48px |
| Display | Cal Sans, Poppins | 600 | 64px / 1.1 | 0.64px |

### Spacing

4px rhythm: `4`, `5`, `6`, `8`, `10`, `12`, `16`, `20`, `24`, `28`, `32`, `40`, `48`, `80`.

### Radius

`4`, `8`, `12`, `16`, `29`, `100`, `120`, `1000`, `9999` px.
Inputs use 8px; cards use 12px; small tags and pill buttons use 9999px.

### Shadows

| Token | Value |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `sm` | `rgba(36, 36, 36, 0.7) 0px 1px 5px -4px, rgba(36, 36, 36, 0.05) 0px 4px 8px 0px` |
| `subtle` | `rgba(255, 255, 255, 0.15) 0px 2px 0px 0px inset` |
| `sm-2` | `rgba(19, 19, 22, 0.7) 0px 1px 5px -4px, rgba(34, 42, 53, 0.1) 0px 0px 0px 1px, rgba(34, 42, 53, 0.05) 0px 4px 8px 0px` |
| `sm-3` | `rgba(19, 19, 22, 0.7) 0px 1px 5px -4px, rgba(34, 42, 53, 0.08) 0px 0px 0px 1px, rgba(34, 42, 53, 0.05) 0px 4px 8px 0px` |
| `sm-4` | `rgba(34, 42, 53, 0.05) 0px 4px 8px 0px` |
| `subtle-2` | `rgb(255, 255, 255) 0px 2px 0px 0px inset` |
| `subtle-3` | `rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.06) 0px 0px 2px 0px` |

## Layout

- Content maximum: `1200px`
- Section gap: `96px`
- Standard card padding: `24px`
- Product UI cards are white, 12px rounded, and use an extremely subtle shadow instead of a card border.

## Components

### Buttons and controls

| Component | Treatment |
| --------------- | --------------------------------------------------------------------------------------------- |
| Primary CTA | Ink fill, white UI text, pill radius, 12px / 24px padding |
| Secondary ghost | Transparent or paper fill, graphite text, 1px silver border, pill radius, 12px / 24px padding |
| Header CTA | Ink fill, white 14px UI text, 8px radius, 8px / 16px padding |
| Tag | Paper fill or silver edge, graphite text, 9999px radius, 4px / 12px padding |
| Navigation link | Graphite Cal Sans UI, 14–16px, no underline |

### Informational state and integrations

Informational banners use `info-banner-bg` with an `action-blue` link.
Google colors are confined to the Google integration mark and are not promoted into general UI accents.

## Usage guidance

**Do**

- Keep core UI monochrome and let spacing, type and surface hierarchy carry emphasis.
- Use Cal Sans for headings and Cal Sans UI / Inter for body and product UI text.
- Use 8–12px cards with quiet elevation and ample internal space.

**Avoid**

- Adding new core UI colors or broad blue decoration.
- Gradients, sharp corners, heavy borders on cards, or lifestyle / abstract imagery.
- Font weights above 600.
- Setting paragraph copy in the display face.

## Accessibility

Maintain visible keyboard focus, semantic controls, readable contrast, and reduced-motion behavior.
Motion should be limited to a single calm product-surface entrance and disabled for `prefers-reduced-motion`.

## Aplicación en override.studio

Mapeo a `web/src/style.css`:

| Token | Variable CSS |
| --------- | ---------------- |
| `paper` | `--paper` (fondo) |
| `white` | `--surface` (tarjetas) |
| `ink` | `--ink` (texto primario, CTA primario) |
| `graphite` | `--graphite` (texto UI) |
| `slate` | `--muted` |
| `stone` | `--stone` |
| `silver` | `--border` |
| `action-blue` | `--accent` (links, foco) |
| `info-banner-bg` | `--info-bg` |
| `sm-4` | `--shadow-card` |

Notas:

- Fuentes autoservidas (ver `web/public/fonts.css`): Poppins 600 (display, fallback de Cal Sans) + Inter 300–500 (cuerpo/UI). Sin Google Fonts ni rastreo de terceros.
- Se añade un único token fuera del sistema, `--danger: #b42318`, solo para estados de error
  (errores de formulario, acciones destructivas, banner de aviso) y "fuera de rango" de telemetría.
  Todo lo demás usa la paleta del sistema.
