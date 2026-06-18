/**
 * src/vendor-mixins-ref.js
 *
 * Human-readable reference of all vendor/helpers/mixins.pug entries.
 * Injected into the AI system prompt so the AI can write real Pug code
 * using the actual mixin library instead of inventing abstract layouts.
 *
 * Each entry contains:
 *   - signature   — exact Pug call syntax
 *   - visual      — what it renders visually
 *   - use         — when to use this mixin
 *   - example     — concrete usage snippet
 */

export const VENDOR_MIXINS = [
  {
    name: "vml-bg",
    signature: "+vml-bg(imageUrl, bgColor, width, height)",
    visual: "Full-width section with a background image. VML-compatible for Outlook. Content goes inside the block.",
    use: "Hero sections with background images. ALWAYS use this (not a plain <img>) when the design has a full-width background behind text.",
    example: `+vml-bg('https://cdn.example.com/hero-bg.png', '#01080d', 580, 320)
  table.row
    tr
      td.wrapper.last.offset-by-one
        table.ten.columns
          tr
            td.text-pad-small.pb50.pt40
              p.white-title Volatility Detected
              p.white-text The market rewards the prepared.
              .h-24 &nbsp;
              table.w280(align="center" style="width:100%;")
                tr
                  td.butt.pb0
                    a.butt-link(href="{{link}}" target="_blank") Trade now`
  },
  {
    name: "vml-bg-fixed",
    signature: "+vml-bg-fixed(imageUrl, bgColor, width, height)",
    visual: "Same as vml-bg but with fixed background-size for Outlook compatibility.",
    use: "Use instead of vml-bg when background must not scale — e.g. texture or pattern backgrounds.",
    example: `+vml-bg-fixed('https://cdn.example.com/pattern.png', '#101314', 580, 240)
  table.row
    tr
      td.wrapper.last.offset-by-one
        table.ten.columns
          tr
            td.text-pad-small.pb44.pt44
              p.middle-title Exclusive bonus
              p.text-2.pb28 Risk-free trade for verified accounts.`
  },
  {
    name: "col3_icon_text",
    signature: "+col3_icon_text(img1, title1, text1, img2, title2, text2, img3, title3, text3)",
    visual: "3-column grid. Each column has: icon image → bold title → body text.",
    use: "Feature lists, benefit blocks, '3 reasons why', VIP privileges, product advantages with icons.",
    example: `+col3_icon_text(
  'https://cdn.example.com/icon-signals.png', 'VIP Signals', 'Our analysts track markets daily.',
  'https://cdn.example.com/icon-profit.png', '+2-3% Profit', 'Trade currency pairs with guided entries.',
  'https://cdn.example.com/icon-support.png', 'Priority Support', 'Your personal manager is one message away.'
)`
  },
  {
    name: "general-btn",
    signature: "+general-btn(font_size, line_h, background_color, text_color, font_w, border, border_r, link, text, section_class_to_add)",
    visual: "Fully customizable CTA button. All visual params are explicit.",
    use: "When brand colors differ from the default .butt class. Preferred for new brands where buttonRadius/primaryColor is known.",
    example: `+general-btn('18px', '27px', '#BDFF00', '#000000', '700', 'none', '12px',
  'https://example.com/cta', 'Activate bonus', 'pb24')`
  },
  {
    name: "top_img_100",
    signature: "+top_img_100(img_src, link, add_class)",
    visual: "Full-width clickable image spanning the entire email container width.",
    use: "Hero banners where the entire image is clickable. Also for decorative dividers between sections.",
    example: `+top_img_100('https://cdn.example.com/hero-banner.png', '{{link}}', 'brad-full')`
  },
  {
    name: "cta-two-column-table",
    signature: "+cta-two-column-table(leftHref, leftText, rightHref, rightText)",
    visual: "Two CTA buttons side by side. On mobile they stack vertically.",
    use: "Dual CTA rows — e.g. 'Trade now' + 'Download app', or 'Deposit' + 'Practice on demo'.",
    example: `+cta-two-column-table(
  '{{deposit_link}}', 'Deposit now',
  '{{demo_link}}', 'Try on demo'
)`
  },
  {
    name: "cta-switch-table",
    signature: "+cta-switch-table(leftHref, leftText, rightHref, rightText, desktopArrowSrc, mobileArrowSrc)",
    visual: "Two buttons with an arrow icon between them. Arrow flips direction on mobile.",
    use: "Step/switch flows — e.g. 'Switch to real account → Practice on demo'.",
    example: `+cta-switch-table(
  '{{real_link}}', 'Real account',
  '{{demo_link}}', 'Demo account',
  'https://cdn.example.com/arrow-h.png',
  'https://cdn.example.com/arrow-v.png'
)`
  },
  {
    name: "person",
    signature: "+person(photo, name, position, link)",
    visual: "Author/expert card: photo left, name + position right, whole card is a link.",
    use: "Expert quotes, analyst profiles, personal manager introductions.",
    example: `+person('https://cdn.example.com/analyst-photo.png', 'Anna Kowalski', 'Senior Market Analyst', '{{profile_link}}')`
  },
  {
    name: "person-text",
    signature: "+person-text(text)",
    visual: "Body text paragraph styled for a person card (used after +person).",
    use: "Quote or bio text under a +person block.",
    example: `+person-text('Markets are volatile this week — here is how to stay ahead.')`
  },
  {
    name: "person-bottom-text",
    signature: "+person-bottom-text(photo, name, position, link, bottom_text)",
    visual: "Person card with additional text below the name/position.",
    use: "Analyst card with a tagline or department name below position.",
    example: `+person-bottom-text('https://cdn.example.com/photo.png', 'Ivan Petrov', 'Head of Analytics', '{{link}}', 'IQ Option Research Team')`
  },
  {
    name: "person-right-text",
    signature: "+person-right-text(photo, name, position, link, bottom_text)",
    visual: "Person card where text appears to the right of the photo.",
    use: "When design layout has photo on left, name+title+quote all on the right.",
    example: `+person-right-text('https://cdn.example.com/photo.png', 'Maria Santos', 'Market Analyst', '{{link}}', 'Volatility creates opportunity.')`
  },
  {
    name: "btn",
    signature: "+btn(link, text, wrap_class)",
    visual: "Classic centered CTA button with → arrow icon. Uses default brand button styles.",
    use: "Standard single CTA. Use when the email has one primary action and brand defaults (orange/standard radius) are acceptable.",
    example: `+btn('{{cta_link}}', 'Get started', 'pb32')`
  },
  {
    name: "weekly-block-title",
    signature: "+weekly-block-title(title)",
    visual: "Centered section title with divider. Used in weekly digest layouts.",
    use: "Section headers in newsletter/weekly digest emails.",
    example: `+weekly-block-title('This week in markets')`
  },
  {
    name: "vestnik-title",
    signature: "+vestnik-title(text)",
    visual: "Newsletter masthead title — large headline at top of newsletter emails.",
    use: "Weekly newsletter/digest header.",
    example: `+vestnik-title('IQ Weekly — Issue #42')`
  },
  {
    name: "vestnik-block-title",
    signature: "+vestnik-block-title(text)",
    visual: "Section subheading inside a newsletter.",
    use: "Newsletter section headers between content blocks.",
    example: `+vestnik-block-title('Top movers this week')`
  },
];

/**
 * Returns the mixin reference formatted as a plain-text block for injection
 * into the AI system prompt or user context.
 */
export function buildVendorMixinsReference() {
  const lines = [
    "=== VENDOR MIXINS — use these to write real Pug template code ===",
    "All mixins are available via `include vendor/helpers/mixins` (already included in every template).",
    "ALWAYS prefer these mixins over raw table HTML. They handle Outlook VML, mobile responsiveness, and brand CSS.",
    "",
  ];

  for (const m of VENDOR_MIXINS) {
    lines.push(`MIXIN: ${m.name}`);
    lines.push(`  Call: ${m.signature}`);
    lines.push(`  Renders: ${m.visual}`);
    lines.push(`  Use when: ${m.use}`);
    lines.push(`  Example:`);
    for (const line of m.example.split("\n")) {
      lines.push(`    ${line}`);
    }
    lines.push("");
  }

  lines.push("=== END VENDOR MIXINS ===");
  return lines.join("\n");
}

/**
 * Returns a compact one-line summary of each mixin for inline context injection.
 */
export function buildVendorMixinsCompact() {
  return [
    "Available vendor mixins (use in pug_blocks):",
    ...VENDOR_MIXINS.map((m) => `  ${m.signature}  →  ${m.visual.split(".")[0]}`),
  ].join("\n");
}

/**
 * Returns a plain-text block describing real Pug markup patterns extracted
 * from the actual email-base templates. Injected into AI context so the AI
 * mimics the studio's real coding style when writing pug_blocks.
 */
export function buildMarkupPatternsReference() {
  return `=== STUDIO PUG MARKUP PATTERNS (extracted from real email-base templates) ===

INDENTATION: Always 4 spaces per level. No tabs.

LINKS: All <a> elements MUST have universal="true" attribute: a(href="..." target="_blank" universal="true")

-- CONTAINER STRUCTURE --
Full-width row (no side margins):
  table.row
      tr
          td.wrapper.last.pt30
              table.twelve.columns
                  tr
                      td.text-pad-small.pb30
                          [content here]

Content row with side margins (10-column layout — use for text/body content):
  table.row
      tr
          td.wrapper.last.offset-by-one
              table.ten.columns
                  tr
                      td.text-pad-small.pb44
                          [content here]

-- SPACING CLASSES (combine on td or p) --
Padding-bottom: .pb2 .pb5 .pb8 .pb10 .pb12 .pb16 .pb20 .pb24 .pb28 .pb30 .pb32 .pb35 .pb44 .pb50 .pb68
Padding-top:    .pt10 .pt24 .pt30 .pt35 .pt40 .pt44 .pt68
Height spacers: .h-12 and .h-24 — use as: .h-24 &nbsp;
Divider:        .div-20 &nbsp;

-- CARD / SECTION VARIANTS (apply to table.row) --
Dark background card:  table.row.brad-full.color-bg
White card:            table.row.white-bg
Dark card with border: table.row.brad-full.color-bg(style="border: 4px solid #1A1D1E;")
Colored CTA card:      table.row.green-bg.brad-full.border-bg-green
Brand top hero:        table.row.bgr-color.brad-top
Rounded full card:     table.row.brad-full

-- TEXT CLASSES --
.white-title     → h1-level heading, white, bold (28-36px)
.middle-title    → h2-level heading, white (22-24px)
.fat-text        → bold secondary heading, dark
.white-text      → body text, white, 18px
.text-2          → body text, white, alternate style
.gray-text       → secondary body text, gray
.hello-text      → intro/greeting text
.text            → standard body text, dark
.number          → step number (large, colored)
.demo-note       → dev-only note — NEVER use in production output

Inline colored spans: span.green | span.red | span.yello | span.number
Inline link in text: a.a-link(href="..." universal="true" target="_blank") link text

-- BUTTON PATTERNS --
Standard centered button (use w280 for normal, w240 for smaller):
  table.w280(align="center" style="width: 100%;")
      tr
          td.butt.pb0
              a.butt-link(href="{{link}}" universal="true" target="_blank") Button text

Left-aligned button:
  .left-button
      table(align="left" style="width: 100%;")
          tr
              td.butt.pb0
                  a.butt-link(href="{{link}}" universal="true" target="_blank") Button text

Two-button row (left + right):
  .left-button
      table(align="left" style="width: 100%;")
          tr
              td.butt.pb0
                  a.butt-link(href="{{link1}}" universal="true" target="_blank") Primary CTA
  .right-button
      table(align="left" style="width: 100%;")
          tr
              td.butt.butt-2.pb0
                  a.butt-link-2(href="{{link2}}" universal="true" target="_blank") Secondary CTA

Small button (inside step cards):
  .smal-button-left
      table(align="left" style="width: 100%;")
          tr
              td.butt.butt-small.pb0
                  a.butt-link-middle(href="{{link}}" universal="true" target="_blank") Label

-- NUMBERED STEPS (1-of-N pattern) --
  table.w100
      tr
          td.m-w.pb0(style="vertical-align: top;")
              p.number 1
          td.w-a.pb0(style="vertical-align: middle;")
              p.fat-text Step title here

-- LEFT IMAGE + RIGHT TEXT (icon-list rows) --
  .left-container
      a(href="{{link}}" universal="true" target="_blank")
          img(src="{{icon_url}}")
  .right-container
      p.text.pb2
          span.number 1
          |{{copy for item 1}}
      p.text {{description}}

-- BULLET POINTS with dot image --
  p.text.pb10
      img.dot(src="{{bullet_dot_url}}" width="10" height="10" alt="")
      |{{bullet text}}

-- LOGO ROW (always first) --
  table.row
      tr
          td.wrapper.last.offset-by-one.pt0
              table.ten.columns
                  tr
                      td.text-pad-small.pb0
                          a(href="{{brand_site}}" universal="true" target="_blank")
                              img.logo.center(src="{{logo_url}}")

-- APP STORE BADGES --
  table.row
      tr
          td.wrapper.last.pt30.offset-by-one
              table.ten.columns
                  tr
                      td.pb32.text-pad-small
                          .stor.center
                              a(href="{{app_store_link}}" universal="true" target="_blank")
                                  img.a-app(src="{{appstore_badge_url}}")
                              a(href="{{play_store_link}}" universal="true" target="_blank")
                                  img.a-google(src="{{playstore_badge_url}}")

-- SOCIAL ICONS ROW --
  table.row
      tr
          td.wrapper.last.pt30
              table.twelve.columns
                  tr
                      td(align="center").pb0.center
                          .socials.center
                              a.first-link(href="{{fb_link}}" universal="true" target="_blank")
                                  img.soc-icon.fb(src="{{fb_icon_url}}")
                              a(href="{{ig_link}}" universal="true" target="_blank")
                                  img.soc-icon.twitter(src="{{ig_icon_url}}")
                              a.last-link(href="{{yt_link}}" universal="true" target="_blank")
                                  img.soc-icon.you(src="{{yt_icon_url}}")

-- TYPICAL EMAIL STRUCTURE (in order) --
1. Logo row
2. Hero (use +vml-bg if bg image, else table.row.bgr-color.brad-top with full-width img)
3. Intro text section (table.row.white-bg or table.row.brad-full.color-bg)
4. Feature/step sections (numbered steps or +col3_icon_text)
5. CTA section (+cta-two-column-table or centered button)
6. App store badges
7. Social icons
(Footer is auto-included via helpers/footer — do NOT write footer content in header.pug)

=== END STUDIO MARKUP PATTERNS ===`;
}
