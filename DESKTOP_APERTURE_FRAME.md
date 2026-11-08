# Desktop aperture frame — why this is hard

## What you see in the reader

- **Scroll** = 450×636 paper.
- **Shell padding** (`--aperture-outset`) = room for the mat in the dark workspace.
- **`.DesktopApertureFrame` overlay** = same 450×636 box as the scroll, `z-index` above pages.

The mat must sit **on the page edge** (corners over the paper), not **inside** the text area and not **floating** with a halo in the gutter.

## Why one `slice %` + `width` is not enough

CSS `border-image` is a **9-slice** of the source PNG:

| Asset type | Slice need | On-page need |
|------------|------------|--------------|
| Thin mat (`smallerborder.png`, ~1024px, ~5% slice) | Small corners, thin rails | Low width (~12px) |
| Ornate mat (~360px, ~24% slice) | Large corner rosettes | Higher width (~22–26px) |

Ornate files often put **black opening padding inside the slice**. That is **art**, not layout. No single layout trick fixes all PNGs; you tune **slice** (what pixels go in corners) and **width** (how big that slice renders). A uniform `%` slice is a compromise: corners want a **large** slice, side rails want a **small** one (asymmetric slice is possible in CSS but not in the editor yet).

## The layout mistake we kept repeating

Two different meanings of “border width”:

1. **Layout `border-width: Npx`** on the overlay → the border band is drawn **inside** the 450×636 box → mat looks **inset** on the paper.
2. **Picture frame** (what `DesktopPageReader` comments describe): **`border-width: 0`**, thickness from **`border-image` `/ Npx`**, placement from **`border-image-outset: Npx`** → layout box stays **full page**; paint sits on the edge and extends into the shell gutter.

Tweaking `content-box`, negative margins, and bleed was fighting the wrong model. **Outset + width 0** is the intended model for this app.

## Current implementation

**All mats use the same layout** (thin default + custom ornate):

```text
border-width: 0
border-image: url(...) {slice}% / {thickness}px round
border-image-outset: {outset}px   (default: same as thickness)
```

Shell `--aperture-outset` matches that value. Ornate-only: if saved `width` is very low, `thickness` is floored to **24px** so paint/outset still align — tune **width** and **slice** in the editor for the PNG.

Do **not** use a separate ornate layout (zero outset / negative nudge); that insets the mat on the paper.

## Parameters today

| Field | Role |
|-------|------|
| `pageBorderImageUrl` | Source PNG (square 9-slice) |
| `pageBorderWidth` | `border-image-width` (visual thickness) |
| `pageBorderSlicePercent` | `border-image-slice` (corner capture) |

## Parameters worth adding (later)

| Field | Role |
|-------|------|
| `pageBorderImageOutset` | Gutter push (default = width). Lower only if you see a **dark halo**; raise if outer corners clip. |
| `pageBorderSliceSides` | Optional `top right bottom left` % for ornate rails vs corners |
| `framePreset` | e.g. `thin-1024` vs `ornate-360` with sane defaults on upload |

## Ornate 360×360 PNG (editor)

**Start here** (after hard refresh):

| Control | Value |
|---------|--------|
| **Slice %** | **24–26%** (if dark ring remains, try **25 → 26**) |
| **Width** | **24–28px** (you said ~24 looks right — keep it) |

**Why ornate fights you and thin mats don’t**

- `smallerborder` puts the visible line near the **inner** edge of the slice tile.
- Ornate PNGs put **black opening** inside the slice, metal **farther out**.
- With `outset = width`, the whole tile shifts outward, so you see **workspace in that black band** → dark halo, “perfect width,” wrong position.

The app now uses **full width for paint**, **~40% of width for outset** on ornate (slice ≥ 12%). Thin mats stay **outset = width**.

**Manual tuning if needed**

- Dark halo still visible → in DB/metadata set `pageBorderImageOutset` to **6–8** (editor control not in UI yet), or **+1% slice**.
- Frame clips at corners → raise width 2px (shell padding follows thickness).

## If CSS is still not enough

Reliable alternatives (more work, more control):

- **Compositor overlay** (already used in PDF export): draw page + frame in canvas.
- **Four-layer frame** (corners + edge tiles) instead of one `border-image`.

Those are worth it if you ship many custom frames and want WYSIWYG parity with export.
