# Pencil-mode popup — UI spec

When the user toggles the 🖊 pencil button on the workbench top bar and then clicks an element in the preview, a floating popup ("inspector") opens next to that element. This document describes what appears inside it for each element kind and how its controls bind back to the source code.

## Activation

- 🖊 toggle on the preview toolbar → `state.pencilMode = true`. While ON:
  - Preview iframe gets a 2 px dashed orange outline.
  - Cursor over preview becomes a crosshair.
  - All clicks in preview are intercepted: `preventDefault()` + open inspector. The existing "click → highlight source line" behavior still runs in parallel (lower right corner shows where in code the element is).
- ESC anywhere closes the inspector.
- Click outside the popup AND outside the same element closes it.

## Element kind detection

When user clicks, we classify the target by walking its DOM up:

| Kind | Detection rule |
|---|---|
| `text` | clicked element is `<p>`, `<h1>`–`<h6>`, `<li>`, `<span>`, `<td>` with direct text content (no nested block children), OR clicked element is a `text node`'s parent |
| `image` | clicked element is `<img>`, OR a `<a>` containing only an `<img>` |
| `button` | clicked element is `<a class="butt-link">` OR `<td class="butt">`, OR any element inside a `<table>` whose class matches `/^(button|tiny-button|small-button|medium-button-.*|large-button)$/` |
| `container` | clicked element is a `<td>` / `<table>` / `<div>` that doesn't match the above (used for backgrounds, paddings, border-radius) |
| `link` | clicked element is `<a>` with text and `href`, but NOT styled as a button |

Fallback: if classification is ambiguous, show **container** controls + a tiny "Treat as: [text] [button] [image]" switcher at the top.

## Popup layout

```
┌─────────────────────────────────────────┐
│  TEXT  · <p class="hero-title">         │  ← header: kind icon · matched selector
│  ┌─────────────────────────────────┐    │
│  │ Welcome to the Loyalty Program  │    │  ← live-editable text (contenteditable)
│  └─────────────────────────────────┘    │
│  [B] [I] [U] [link]                     │  ← inline format buttons
│  ─────────────────────────────────       │
│  Font size  [ 32 px ▾ ]                  │  ← style controls
│  Line height [ 1.2 ▾ ]                   │
│  Color     [ #1a1a1a 🎨 ]                │
│  Align     [◧] [◨] [◫] [◰]               │
│  ─────────────────────────────────       │
│  [ Reset ]  [ Apply ]  [ Cancel ]        │
└─────────────────────────────────────────┘
   ▲ tail points to the clicked element
```

Position: anchored to the bottom-right of the clicked element. If close to viewport edge, mirrors to bottom-left or top-right. Z-index above iframe.

## Controls per kind

### kind = `text`

| Control | Binds to |
|---|---|
| Live-editable text area | text content of the element |
| **B** Bold | wraps selection in `<b>…</b>` (preserves caret) |
| **I** Italic | wraps in `<i>…</i>` |
| **link** | opens link sub-popup (URL input) → wraps in `<a href="…">…</a>` |
| Font size | inline `style="font-size: Xpx"` |
| Line height | inline `style="line-height: X"` |
| Color | inline `style="color: #…"` |
| Align | inline `style="text-align: left | center | right | justify"` |
| Padding (top / right / bottom / left) | inline `style="padding: …"` on the nearest block ancestor |

### kind = `image`

| Control | Binds to |
|---|---|
| Image src | `src=` attribute |
| Image alt | `alt=` attribute |
| Width (px) | `width=` attribute + inline `style="max-width: Xpx"` |
| Border radius | inline `style="border-radius: Xpx"` |
| Upload from device | POST to existing `/api/assets/register`, server returns URL → write into `src=` |

### kind = `button`

| Control | Binds to |
|---|---|
| Label text | inner text of the `<a class="butt-link">` |
| Link (href) | `href=` of the same `<a>` |
| Background color | inline `style="background-color: …"` on `<td class="butt">` |
| Text color | inline `style="color: …"` on `<a class="butt-link">` |
| Border radius | inline `style="border-radius: Xpx"` on `<td class="butt">` |
| Padding | inline `style="padding: …px …px"` on `<a class="butt-link">` |
| Font size | inline `style="font-size: Xpx"` on `<a class="butt-link">` |
| Width (full / auto / 280 / custom) | `<table class="…">` class swap or `style="width: …"` |

### kind = `container` (`<td>` / `<div>` / `<table>` non-text non-button)

| Control | Binds to |
|---|---|
| Background color | inline `style="background-color: …"` |
| Padding (each side) | inline `style="padding: t r b l"` |
| Border radius | inline `style="border-radius: …px"` |
| Border (width / style / color) | inline `style="border: 1px solid #…"` |
| Background image (URL or upload) | inline `style="background-image: url(...)"` |
| Background position | dropdown `top center / bottom center / center / top left / top right` |

### kind = `link` (plain text link, not styled as button)

| Control | Binds to |
|---|---|
| Label text | inner text |
| URL | `href=` |
| Color | inline `style="color: …"` |
| Underline | inline `style="text-decoration: underline | none"` |
| Open in new tab | `target="_blank"` toggle |

## Two-way binding

The inspector reads:
- Current text content via `el.innerText`.
- Current inline style via parsing `el.getAttribute("style")` into a map.
- Current attributes (`href`, `src`, `alt`, `width`).

On any change:
1. **Preview** is updated immediately (live).
2. **Source code** is patched on `Apply` (or on blur if Auto-Apply is on, see below).

Source-code patching strategy:
- For HTML edits in the workbench's HTML view → use the existing click-highlight infrastructure to find the source line for the element, then string-replace.
- For Pug edits (when the workbench is showing pug source) → harder. v1 just refuses to apply if source is pug; user has to be in HTML view. v2: implement a Pug → HTML → modified-HTML → diff → patched-Pug round trip.

For inline-style changes:
- Read the existing `style="…"` string from the matched source line.
- Parse it as a key:value map.
- Merge in the new declarations.
- Stringify back, preserving order where possible.
- Write the updated `style="…"` back.

## Auto-Apply toggle

In the popup footer:

```
☑ Auto-apply on blur     [ Apply now ]   [ Cancel ]
```

When checked (default ON), every change is written to source on blur (no need to click Apply). When OFF, edits stay in the popup until Apply.

## Empty / unknown element

If user clicks an element we can't classify (e.g. a `<table>` with no clear role), show:

```
┌─────────────────────────────────────────┐
│  ⚠ Не могу понять что это               │
│  <table class="row" ...>                │
│  Selector: body > table.body > tr > ... │
│  Try clicking on a child element        │
│  inside this one.                       │
└─────────────────────────────────────────┘
```

## HTML / CSS skeleton

Drop into `public/workbench.html` (or a partial `partials/pencil-popup.html`):

```html
<div id="pencilPopup" class="pencil-popup hidden" role="dialog" aria-label="Element inspector">
  <div class="pp-header">
    <span class="pp-kind-icon">🖊</span>
    <span class="pp-kind-label">Text</span>
    <span class="pp-selector"></span>
    <button class="pp-close" aria-label="Close">✕</button>
  </div>
  <div class="pp-body">
    <!-- content swapped per kind by JS -->
  </div>
  <div class="pp-footer">
    <label><input type="checkbox" id="ppAutoApply" checked> Auto-apply</label>
    <button class="pp-btn pp-apply">Apply</button>
    <button class="pp-btn pp-cancel">Cancel</button>
  </div>
  <div class="pp-tail"></div>
</div>
```

CSS (append to `public/workbench.css`):

```css
.pencil-popup {
  position: fixed; z-index: 9999;
  width: 320px; max-height: 80vh; overflow-y: auto;
  background: var(--bg-1, #161b22);
  border: 1px solid var(--border, rgba(255,255,255,.12));
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0,0,0,.4);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--text, #e6edf3);
}
.pencil-popup.hidden { display: none; }
.pp-header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.pp-kind-icon { font-size: 16px; }
.pp-kind-label { font-weight: 600; }
.pp-selector { flex: 1; font: 11px/1 ui-monospace, Menlo, monospace; opacity: .55; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-close { background: transparent; border: 0; color: var(--text-2); cursor: pointer; font-size: 16px; padding: 0 4px; }
.pp-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.pp-body label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--text-2); }
.pp-body input[type="text"], .pp-body input[type="url"], .pp-body input[type="number"], .pp-body select, .pp-body textarea {
  background: var(--bg-2, rgba(255,255,255,.04));
  border: 1px solid var(--border, rgba(255,255,255,.1));
  border-radius: 6px; padding: 6px 8px; color: var(--text); font: inherit;
}
.pp-body textarea { min-height: 60px; resize: vertical; }
.pp-format-row { display: flex; gap: 4px; }
.pp-format-row button { background: var(--bg-2); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 4px 8px; cursor: pointer; }
.pp-format-row button.active { background: var(--accent, #2563eb); color: #fff; border-color: transparent; }
.pp-footer { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--border); }
.pp-footer label { font-size: 11px; color: var(--text-2); display: flex; align-items: center; gap: 4px; }
.pp-btn { background: var(--bg-2); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
.pp-btn.pp-apply { background: var(--accent, #2563eb); border-color: transparent; color: #fff; margin-left: auto; }
.pp-tail { position: absolute; width: 12px; height: 12px; background: inherit; border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); transform: rotate(45deg); top: -7px; left: 24px; }
```

## JS skeleton

```js
// public/workbench.js — pencil-popup module

const _pp = {
  el: null,                 // popup element
  target: null,             // currently inspected DOM node
  kind: null,               // 'text' | 'image' | 'button' | 'container' | 'link'
  autoApply: true,
  open(clickedEl) {
    this.target = clickedEl;
    this.kind   = this.classify(clickedEl);
    this.render();           // swap body content per kind
    this.position(clickedEl);
    document.getElementById('pencilPopup').classList.remove('hidden');
  },
  classify(el) { /* see "Element kind detection" above */ },
  render()    { /* build body HTML from kind, bind input → applyChange */ },
  position(el){
    const r = el.getBoundingClientRect();
    const pop = document.getElementById('pencilPopup');
    pop.style.top  = `${r.bottom + window.scrollY + 8}px`;
    pop.style.left = `${r.left + window.scrollX}px`;
    // TODO: edge-flip if pop goes off-screen
  },
  applyChange(prop, value) {
    // 1) live-update the preview DOM
    // 2) if autoApply: patch the source via cmHighlight + replace
    // 3) update CodeMirror value
  },
  close() {
    document.getElementById('pencilPopup').classList.add('hidden');
    this.target = null;
  },
};

// Preview-click hook (extend the existing handler in workbench.js):
window.addEventListener('message', (e) => {
  if (e.data?.type !== 'retkit-text-click') return;
  if (!state.pencilMode) return;
  // The existing handler resolves e.data → DOM ref; pass that to _pp.open(...)
});
```

## Implementation order

1. **Static popup HTML + CSS** with all kinds visible but no logic. 30 min.
2. **Classify + open + position** for text-kind only. Live edits update preview only (no source patching yet). 1 hour.
3. **Source patching** for text-kind in HTML mode. 1.5 hours.
4. **Image-kind** + asset upload. 1 hour.
5. **Button-kind** with style merging. 1.5 hours.
6. **Container-kind**. 1 hour.
7. **Pug-source support** (read-back + write). 2 hours. _Optional v2._
8. **Edge cases**: edge-flip, off-screen, very small elements, IME-aware input. 1 hour.

Total to a working pencil mode: **6–8 hours**.

## Open questions

1. **When source is Pug (not HTML), what do we do?** Three options:
   - (a) refuse and prompt to switch to HTML view ✓ simplest
   - (b) compile Pug → HTML, edit in-memory, regenerate Pug via reverse parser (fragile)
   - (c) maintain a parallel "patches list" stored in JSON next to the Pug — applied at compile time (clean but new concept)

   For v1 I'd go with (a). Document clearly.

2. **Live preview vs Auto-apply.** When `style="color: red"` is changed:
   - Preview iframe MUST update instantly (no flicker).
   - Source code patch can happen on blur or on Apply.
   - Decision: always live-update preview; gate source patching behind Auto-apply checkbox.

3. **Undo.** If the user makes 5 edits then realises they want #1 back:
   - Each edit pushes a `{ path, before, after }` entry into `data/edit-history.jsonl` (via the planned unified patch API, Phase 8).
   - Cmd+Z in pencil-mode (outside CodeMirror focus) pops the last entry and reverts.
   - CodeMirror's native undo (Cmd+Z inside the editor) keeps working for direct code edits.

4. **Multi-select**. v1: single element only. v2: Shift+click to add to selection, apply changes to all.
