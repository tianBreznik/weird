# Editor Toolbar Handoff Spec

This document describes the editor toolbar in `ChapterEditor` for reuse in another project.

Scope notes:
- Includes all editor toolbar features except karaoke.
- Includes styling details for the toolbar and explicit scrollbar behavior.

## 1) Toolbar Feature Inventory (Karaoke Excluded)

The toolbar is split into:
- `toolbar-buttons` (primary editing controls)
- `toolbar-actions` (chapter actions / publishing controls)

### Primary Controls (`toolbar-buttons`)

- Title toggle (`T` / `p`)
  - Toggles current block between heading and paragraph.
- Line break (`↵`)
  - Inserts a soft line break (Shift+Enter style behavior).
- Inline formatting
  - Bold, Italic, Strikethrough, Underline.
- Font size dropdown
  - Options: `default, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48`.
- Chapter font-family dropdown (chapter-level only; hidden for subchapters)
  - Custom trigger + portal dropdown (rendered outside clipping parents).
- Page border/frame controls
  - Upload frame image (`🔲`), border width dropdown, border slice percentage dropdown.
- Image controls
  - Insert block image (`🖼`).
  - Insert inline/flow image (`📎`).
- Field notes block (`📝`)
  - Insert scanned field-notes style content block.
- Footnote insert (`¹`)
  - Inserts a footnote reference.
- Text color picker
  - Native color input.
- Highlight picker + apply overlay (`H`)
  - Color input plus overlay button to apply/remove highlight.
- Paragraph alignment
  - Left, Center, Right, Justify.
- Image alignment (conditional)
  - Only shown when an image context is active: Left / Center / Right.
- Block and typography controls
  - Blockquote, Subscript, Superscript.
  - Indent, Outdent.
- Paragraph style controls
  - Intro paragraph.
  - Whisper/aside paragraph.
  - Paragraph epigraph block (quote + author).
  - Poetry block.
  - Dinkus separator.
  - Drop cap.

### Secondary/Action Controls (`toolbar-actions`)

- Chapter epigraph (`✶`) (chapter-level only)
- Link (`🔗`)
- Hide/show title (`🫥`)
- Chapter background image (`🏞️`) (chapter-level only)
  - Replace and remove interactions supported.
- Publish (`Objavi`; saving label `Objavljam`)
- Mobile-only close button (`✕`)

### Explicitly Excluded (Karaoke)

- Karaoke insert button (`🎤`)
- Karaoke timing JSON download button (`⬇️`)
- Karaoke dialog workflows and markers

## 2) Toolbar Structural Styling

### Toolbar Container: `.editor-toolbar`

- Background: `#fdfdfd`
- Borders:
  - `border-bottom: 1px solid #eeeeef`
  - no top/left/right borders
- Radius: `0`
- Layout:
  - `display: flex`
  - `align-items: center`
- Spacing:
  - base padding: `16px 12px 8px 12px`
  - margin: `0`

### Desktop Behavior (`min-width: 769px`)

- Extra top padding:
  - `padding-top: 50px` (to leave room for top-right close control area).
- Horizontal overflow enabled:
  - `overflow-x: auto`
  - `overflow-y: hidden`
  - `flex-wrap: nowrap`
  - `-webkit-overflow-scrolling: touch`
- Groups do not shrink:
  - `.toolbar-buttons`, `.toolbar-actions` use `flex-shrink: 0`.

### Mobile Behavior (`max-width: 768px`)

- Toolbar remains horizontally scrollable:
  - `overflow-x: auto !important`
  - `overflow-y: hidden !important`
  - `flex-wrap: nowrap !important`
  - `-webkit-overflow-scrolling: touch !important`
- Sizing:
  - `min-height: 60px !important`
  - `height: auto !important`
- Padding remains compact:
  - `16px 12px 8px 12px !important`
- Mobile close button is visible (`.toolbar-close-btn`), desktop hidden.

## 3) Control-Level Styling

### Standard Toolbar Button: `.toolbar-btn`

- Fixed square controls:
  - `28px` width/height/min/max constraints
- Visuals:
  - border: `1px solid #e8e9ed`
  - radius: `6px`
  - background: `#fdfdfd`
  - no outer shadow (`box-shadow: none`)
- Typography:
  - compact system font stack
  - `font-size: 11px`
  - `font-weight: 600`
- Interaction states:
  - hover: background `#f6f7f9`, border `#e3e5ea`
  - active press: background `#eef0f4`, darker border, subtle inset shadow
  - active/toggled: soft blue fill `#e9eefb`, border `#c7d4f7`, inset ring
  - disabled: muted background/text, no shadow, `not-allowed` cursor

### Save Button: `.toolbar-save-btn`

- Height: `28px`
- Min width: `88px`
- Radius: `6px`
- Border: `1px solid #e3e5ea`
- Background: subtle light gradient
- Font: compact semibold system font
- Hover/active: subtle neutral shade changes

### Select/Dropdown Inputs

- `.toolbar-font-size` and `.toolbar-border-dropdown`
  - `28px` height, rounded corners (`6px`), light border, compact text.
  - custom chevron icon via background SVG.
- `.toolbar-font-family-trigger`
  - compact trigger with ellipsis behavior for long labels.
  - open/focus state uses blue-tinted border/ring.
- `.toolbar-font-family-dropdown`
  - floating panel with max-height and internal vertical scroll.
  - light border + soft shadow.

### Upload Progress Treatment

- Buttons in uploading state use `.uploading`.
- Progress overlay bar (`.toolbar-btn-progress`) fills from left using `--upload-progress` percentage.

## 4) Scrollbar Behavior (Exact)

## 4.1 Toolbar Scrollbar

Toolbar is horizontally scrollable but the scrollbar is intentionally hidden on all target engines.

- Firefox:
  - `scrollbar-width: none`
- Legacy IE/Edge:
  - `-ms-overflow-style: none`
- WebKit:
  - `.editor-toolbar::-webkit-scrollbar { display: none; }`

Net effect:
- Horizontal scroll works (mouse/trackpad/touch swipe).
- Scrollbar track/thumb are not visible.

## 4.2 Editor Content Scrollbar (`.content-editor-wrapper`)

Content area uses `SimpleBar` for custom cross-platform vertical scrolling.

### Native Scrollbar Suppression in SimpleBar Wrapper

- `.simplebar-content-wrapper`
  - `overflow: auto`
  - `scrollbar-width: none` (Firefox)
  - `-ms-overflow-style: none` (IE/Edge)
- WebKit native scrollbar hidden:
  - `.simplebar-content-wrapper::-webkit-scrollbar { display: none; }`

### Custom Vertical Track (SimpleBar)

- Width forced to `18px`.
- Track aligned to right edge.
- Track background/borders emulate beveled desktop style:
  - white base
  - light top/left edges
  - darker right/bottom edges
  - inset highlights/shadows for embossed look

### Custom Thumb (SimpleBar)

- Width forced to `18px`.
- Gray vertical gradient thumb.
- Beveled border treatment matching track style.
- Square corners (`border-radius: 0`).
- Always visible (`opacity: 1 !important`), not just on hover.
- Default SimpleBar thumb overlay pseudo-element is disabled:
  - `.simplebar-scrollbar::before { display: none; }`

### Fallback When SimpleBar Is Not Active

Custom WebKit scrollbar rules exist on `.content-editor-wrapper`:
- `::-webkit-scrollbar` width `18px`
- Styled track and thumb matching the same beveled theme
- Styled scrollbar buttons (including arrow triangles) for classic desktop feel

Firefox fallback:
- `scrollbar-width: thin`
- `scrollbar-color: #0c0c0c #ffffff`

## 5) Locked/Disabled Mode (Acknowledgements Chapter)

When toolbar has `.acknowledgements-locked`:
- Most controls are visible but grayed and disabled.
- Frame/border controls stay active (explicit exception).
- Color and highlight groups are visually locked and pointer-disabled.

This creates a “mostly read-only” editing mode while preserving specific layout controls.

## 6) Implementation Notes for Porting

- Keep the toolbar as a single-row flex container with horizontal overflow.
- Preserve hidden-scrollbar behavior for the toolbar (visible scrolling, invisible bar).
- Keep control dimensions consistent (`28px`) to maintain rhythm.
- Preserve split between primary formatting cluster and right-side action cluster.
- If using custom font dropdown, render menu in a portal to avoid clipping by overflow ancestors.
- Use explicit active/disabled visual states so users can infer context without tooltips.

## 7) Button Icon Legend (Exact)

Use this mapping to preserve the visual language.

- `T` / `p`: heading/paragraph mode toggle
- `↵`: hard line break
- `B`: bold
- `I`: italic
- `S` (struck): strikethrough
- `U` (underlined): underline
- `🔲`: chapter page-frame image upload
- `🖼`: block image insert
- `📎`: inline image insert
- `📝`: field notes block insert
- `¹`: footnote insert
- `H`: highlight apply/remove overlay button
- `⬑`, `≡`, `⬏`: left/center/right text alignment
- `⬅️`, `⬆️`, `➡️`: left/center/right image alignment (conditional)
- `"`: blockquote
- `x₂`: subscript
- `x²`: superscript
- `→`, `←`: indent/outdent
- `¶` (italic): intro paragraph class toggle
- `¶` (gray): whisper paragraph class toggle
- `"` (italic button): paragraph epigraph node dialog
- `📜`: poetry block toggle
- `* * *`: dinkus insert
- `A` (large): drop-cap class toggle
- `✶`: chapter epigraph dialog
- `🔗`: link dialog
- `🫥`: hide/show title
- `🏞️`: chapter background image picker/remove
- `✕`: close (modal close and mobile toolbar close)

Karaoke icons exist in source but are intentionally excluded from handoff scope:
- `🎤` (insert karaoke)
- `⬇️` (download karaoke timings)

## 8) TipTap Implementation Spec (Feature by Feature)

This section documents how each toolbar feature is wired into TipTap (extensions, commands, node/mark behavior, and popup behavior).

### 8.1 Editor Setup and Extension Stack

Editor is created with `useEditor` and this extension order:

- `StarterKit.configure({ hardBreak: { keepMarks: true }, paragraph: false })`
- `CustomParagraph` (replaces default paragraph to preserve class attributes like `para-body`, `para-intro`, etc.)
- `TextAlign` for `heading` and `paragraph`
- `Subscript`, `Superscript`
- `Indent` (custom extension; indent/outdent commands mutate `data-indent` and inline padding)
- `Highlight` (custom mark, color attribute)
- `TextColor` (custom mark with `setTextColor`/`unsetTextColor`)
- `FontSize` (custom mark with `setFontSize`/`unsetFontSize`)
- `Underline` (custom mark with toggle/set/unset)
- `Link` (`openOnClick: false`; target/rel attrs set)
- `InlineImage` then `CustomImage` (ordering is intentional so inline images parse correctly)
- `Video` (custom atom block node)
- `Dinkus` (custom atom block node)
- `Poetry` (custom block wrapper node)
- `ParagraphEpigraph` (custom atom block node)
- `FootnoteRef` (custom inline atom node)
- `KaraokeBlock`, `FieldNotesBlock` (custom atom block nodes; karaoke excluded from this handoff’s feature list)

### 8.2 Inline Formatting Features

- **Bold / Italic / Strikethrough**
  - Toolbar handlers call `editor.chain().focus().toggleBold() / toggleItalic() / toggleStrike().run()`.
  - No popup.
- **Underline**
  - Uses custom `Underline` mark (`<u>` render, style-based parse fallback).
  - Toolbar uses `toggleUnderline()`.
  - No popup.
- **Subscript / Superscript**
  - Provided by TipTap extensions.
  - Toolbar uses `toggleSubscript()` / `toggleSuperscript()`.
  - No popup.
- **Highlight**
  - Uses custom `Highlight` mark with color attribute.
  - Toolbar applies `toggleMark('highlight', { color })`.
  - No popup.
- **Text color**
  - Uses custom `TextColor` mark command `setTextColor(color)`.
  - No popup.
- **Font size**
  - Uses custom `FontSize` mark command.
  - `default` -> `unsetFontSize()`, otherwise `setFontSize('${size}px')`.
  - Rendered with `font-size` plus fixed line-height behavior in mark render.
  - No popup.

### 8.3 Block-Level and Structural Features

- **Title toggle (`T` / `p`)**
  - Toggles between heading and paragraph using `toggleHeading({ level })` based on chapter/subchapter context.
  - No popup.
- **Line break**
  - `setHardBreak()` from StarterKit.
  - No popup.
- **Text alignment**
  - `setTextAlign('left'|'center'|'right'|'justify')`.
  - No popup.
- **Blockquote**
  - `toggleBlockquote()`.
  - No popup.
- **Indent / Outdent**
  - Custom `Indent` extension commands `indent()` / `outdent()`:
    - Operates on selected paragraphs/headings.
    - Stores `data-indent`.
    - Renders style `padding-left: indent * 1.5rem`.
  - No popup.
- **Intro / Whisper / Epigraph paragraph style toggles**
  - Implemented in component logic (not a dedicated TipTap extension):
    - Finds current paragraph node.
    - Mutates `class` attribute via `setNodeMarkup`.
    - Maintains class hygiene among `para-intro`, `para-whisper`, `para-epigraph`, `para-body`.
  - No popup (except paragraph epigraph node, below).
- **Drop cap**
  - Also component-level class toggle on paragraph (`drop-cap` class) via `setNodeMarkup`.
  - No popup.
- **Poetry (`📜`)**
  - Uses custom `Poetry` node.
  - Toolbar calls `togglePoetry()`.
  - Node parses from `div.poetry`/`pre.poetry`, renders `div.poetry`, content is `paragraph+`.
  - **No popup**. It is an inline command toggle in the document flow.
- **Dinkus (`* * *`)**
  - Custom atom node inserted with `insertContent({ type: 'dinkus' })`.
  - NodeView renders centered dinkus image (`/dinkus.png`).
  - No popup.

### 8.4 Media Features

- **Block image (`🖼`)**
  - Upload happens outside TipTap, then inserts custom `image` node (`CustomImage`).
  - `CustomImage` supports attrs: `src`, `alt`, `title`, `width`, `height`, `align`.
  - NodeView adds resize handle and preserves alignment on resize.
  - No popup for insertion/editing.
- **Inline image (`📎`)**
  - Upload then inserts custom `inlineImage` node.
  - Strict inline constraints enforced in render and NodeView (`max-height`, inline flow, mutation observer).
  - No popup.
- **Image alignment buttons**
  - Uses `setImageAlign('left'|'center'|'right')` custom command from `CustomImage`.
  - Buttons are conditionally shown when image alignment state is active.
  - No popup.
- **Video**
  - Backed by custom `Video` node and node view.
  - Supports `mode` (`blank-page`/`background`) and optional `targetPage`.
  - Toolbar in this component does not expose a dedicated video popup button in the shown section, but video dialog styles exist in CSS and node infrastructure is present.

### 8.5 Footnote Feature

- **Footnote (`¹`)**
  - Custom inline atom node `FootnoteRef` exists for parsing/rendering.
  - Insertion flow uses manual content insertion in the editor handler (input-rule plugin intentionally disabled due typing interference).
  - No popup.

### 8.6 Dialog/Popup Features (Non-inline Commands)

- **Chapter epigraph (`✶`)**
  - Opens React portal dialog (`showEpigraphDialog`), not a TipTap node/mark.
  - Saves to chapter-level state (`epigraph` object with `text`, `author`, `align`), not directly to TipTap doc.
- **Link (`🔗`)**
  - Opens React portal dialog (`showLinkDialog`).
  - Submit applies TipTap link mark:
    - unset when URL empty
    - set or insert `<a>` content when URL/text provided.
- **Paragraph epigraph button**
  - Opens React portal dialog (`showParagraphEpigraphDialog`).
  - On save:
    - updates selected `paragraphEpigraph` node via `updateParagraphEpigraphAt(pos, attrs)`, or
    - inserts a new node via `insertParagraphEpigraph(attrs)`.
  - This one is both popup-driven and TipTap-node-backed.

### 8.7 Feature-to-Implementation Quick Matrix

- No popup, direct TipTap command:
  - Title toggle, line break, bold, italic, strikethrough, underline, text align, blockquote, subscript, superscript, indent/outdent, poetry, dinkus, image align, highlight, text color, font size.
- No popup, TipTap + custom node insertion:
  - Block image, inline image, footnote, field notes.
- Popup + TipTap mutation on submit:
  - Link dialog, Paragraph epigraph dialog.
- Popup + external chapter state (not TipTap doc mark/node):
  - Chapter epigraph dialog.
