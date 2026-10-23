# Design

## Principles

- **Calm, dark-first, one accent.** Near-black graphite surfaces, hairline borders and a single electric-lime
  accent for primary actions and data marks. A light theme uses the same roles with adjusted values.
- **Secrets look like secrets.** Codes, passwords and keys are set in a monospace face, masked by default and
  revealed or copied with one click; the clipboard is cleared again after 30 seconds.
- **Identity by type.** Each entry type has an icon and a tint (note blue, Matter teal, login violet, Wi-Fi sky,
  card amber, key rose). Color never carries meaning alone – labels and icons always accompany it.
- **Fast paths.** ⌘K command palette, quick-add tiles, `⌘/Ctrl + S` to save, pin to top.

## Tokens

Defined as CSS variables in [`apps/web/src/styles.css`](../apps/web/src/styles.css) and exposed to Tailwind via
`@theme`.

| Role | Dark | Light |
|---|---|---|
| Background | `#0A0B0F` | `#F6F7F9` |
| Surface 1 / 2 / 3 | `#111318` / `#171A21` / `#1E222B` | `#FFFFFF` / `#F1F3F6` / `#E7EAEF` |
| Text / secondary / muted | `#ECEEF3` / `#A3A9B7` / `#7D8494` | `#0D0F14` / `#4A5060` / `#646A79` |
| Accent (fill) / text on accent | `#C5F04A` / `#0A0B0F` | `#C5F04A` / `#0A0B0F` |
| Accent text, chart marks | `#C5F04A`, `#A6D93A` | `#3F6212`, `#65A30D` |
| Hairline | `rgba(255,255,255,.07)` | `rgba(10,11,15,.08)` |

Radii: cards 16 px, inputs/buttons 10 px, chips full. Spacing on a 4 px grid.

## Typography

**Geist** for UI text and **Geist Mono** for codes, numbers in tables and keys – both bundled with the app (no
external font requests). Headlines use tight negative tracking (−0.02 to −0.035 em).

## Charts

Single-series charts in the accent mark color: columns with 4 px rounded data ends on a hairline grid, hover
tooltip, and a screen-reader data table. Bar lists rank values with direct labels instead of a legend.
