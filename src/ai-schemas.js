/**
 * src/ai-schemas.js — OpenAI structured output JSON schemas
 *
 * All schemas use strict mode (additionalProperties: false).
 * Used with the OpenAI Responses API `text.format.json_schema`.
 */

// ─── Main email draft schema ──────────────────────────────────────────────────

export const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    assistant_reply: { type: "string" },
    mail: {
      type: "object",
      additionalProperties: false,
      properties: {
        subject: { type: "string" },
        preheader: { type: "string" },
        locale: { type: "string" },
        summary: { type: "string" },
        sections: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: {
                type: "string",
                enum: ["hero", "text", "feature-list", "image", "cta", "footer"]
              },
              eyebrow: { type: "string" },
              title: { type: "string" },
              body: { type: "string" },
              image_key: { type: "string" },
              cta_label: { type: "string" },
              cta_href: { type: "string" },
              items: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["kind", "eyebrow", "title", "body", "image_key", "cta_label", "cta_href", "items"]
          }
        },
        assets: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              key: { type: "string" },
              url: { type: "string" },
              alt: { type: "string" },
              placement: { type: "string" },
              notes: { type: "string" },
              width: { type: "number" },
              height: { type: "number" }
            },
            required: ["key", "url", "alt", "placement", "notes", "width", "height"]
          }
        },
        translations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              locale: { type: "string" },
              subject: { type: "string" },
              preheader: { type: "string" },
              cta_labels: {
                type: "array",
                items: { type: "string" }
              },
              notes: { type: "string" },
              body_blocks: {
                type: "array",
                items: { type: "string" }
              },
              source_name: { type: "string" }
            },
            required: ["locale", "subject", "preheader", "cta_labels", "notes", "body_blocks", "source_name"]
          }
        },
        // modified_html: used ONLY in clone-edit mode — full HTML of the edited email
        // Leave as empty string "" when not in clone-edit mode
        modified_html: { type: "string" },

        // locale_entries: used ONLY in scaffold mode — fills token blocks for new system email
        // Array of { key, value } pairs matching the token keys returned by the scaffold endpoint
        // e.g. [{ key: "block_00", value: "Reset your password" }, { key: "block_01", value: "Click below..." }]
        // Leave as empty array [] when not in scaffold mode
        locale_entries: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              key: { type: "string" },
              value: { type: "string" }
            },
            required: ["key", "value"]
          }
        },

        // pug_blocks: PRODUCTION Pug code using vendor mixins — the real template content.
        // This is the primary output for email assembly. Write real Pug using vendor mixins:
        //   +vml-bg(imgUrl, bgColor, 580, 320) { ... content ... }
        //   +col3_icon_text(img1,title1,text1, img2,title2,text2, img3,title3,text3)
        //   +general-btn(fontSize, lineH, bgColor, textColor, fontW, border, radius, link, text, class)
        //   +top_img_100(src, link, class)  +cta-two-column-table(...)  +person(...)
        // label: short identifier (e.g. "hero", "features", "cta", "footer")
        // pug_code: valid Pug snippet to insert into the email template's header.pug block
        // Leave as empty array [] in clone-edit and scaffold modes.
        pug_blocks: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label:    { type: "string" },
              pug_code: { type: "string" }
            },
            required: ["label", "pug_code"]
          }
        },

        // brand_theme: extracted from design screenshot — used to patch template styles
        // Fill when the user provides a design with brand-specific colors/styles
        // Leave all fields as empty string "" when no design/theme is provided
        // primaryColor: button background color (e.g. "#BDFF00")
        // primaryTextColor: button label color (e.g. "#1A1A1A")
        // buttonRadius: button border-radius (e.g. "12px") — must end in "px"
        // contentRadius: card corner radius (e.g. "8px") — must end in "px"
        // textColor: body paragraph color (e.g. "#333333")
        // headingColor: h1/subtitle color (e.g. "#1A1A1A")
        // linkColor: inline link color (e.g. "#BDFF00") — defaults to primaryColor if empty
        // bgColor: outer email background (e.g. "#F5F5F5")
        // borderColor: card border color (e.g. "#E0E0E0")
        // logoUrl: full URL to brand logo image
        brand_theme: {
          type: "object",
          additionalProperties: false,
          properties: {
            primaryColor:     { type: "string" },
            primaryTextColor: { type: "string" },
            buttonRadius:     { type: "string" },
            contentRadius:    { type: "string" },
            textColor:        { type: "string" },
            headingColor:     { type: "string" },
            linkColor:        { type: "string" },
            bgColor:          { type: "string" },
            borderColor:      { type: "string" },
            logoUrl:          { type: "string" }
          },
          required: ["primaryColor", "primaryTextColor", "buttonRadius", "contentRadius",
                     "textColor", "headingColor", "linkColor", "bgColor", "borderColor", "logoUrl"]
        }
      },
      required: ["subject", "preheader", "locale", "summary", "sections", "assets", "translations",
                 "modified_html", "locale_entries", "brand_theme", "pug_blocks"]
    }
  },
  required: ["assistant_reply", "mail"]
};

// ─── Clone-edit schema ────────────────────────────────────────────────────────

// Lightweight schema for "edit existing HTML email" mode.
// We do not ask the model to regenerate sections/assets/pug blocks here,
// because that slows down the response and is unnecessary for HTML-preserving edits.
export const cloneEditResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    assistant_reply: { type: "string" },
    mail: {
      type: "object",
      additionalProperties: false,
      properties: {
        subject: { type: "string" },
        preheader: { type: "string" },
        locale: { type: "string" },
        summary: { type: "string" },
        modified_html: { type: "string" },
        localized_html: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              locale: { type: "string" },
              html: { type: "string" }
            },
            required: ["locale", "html"]
          }
        },
        translations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              locale: { type: "string" },
              subject: { type: "string" },
              preheader: { type: "string" },
              cta_labels: {
                type: "array",
                items: { type: "string" }
              },
              notes: { type: "string" },
              body_blocks: {
                type: "array",
                items: { type: "string" }
              },
              source_name: { type: "string" }
            },
            required: ["locale", "subject", "preheader", "cta_labels", "notes", "body_blocks", "source_name"]
          }
        }
      },
      required: ["subject", "preheader", "locale", "summary", "modified_html", "localized_html", "translations"]
    }
  },
  required: ["assistant_reply", "mail"]
};

// ─── Translation schema ───────────────────────────────────────────────────────

export const translationResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    assistant_reply: { type: "string" },
    translations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          locale: { type: "string" },
          subject: { type: "string" },
          preheader: { type: "string" },
          cta_labels: {
            type: "array",
            items: { type: "string" }
          },
          notes: { type: "string" },
          body_blocks: {
            type: "array",
            items: { type: "string" }
          },
          source_name: { type: "string" }
        },
        required: ["locale", "subject", "preheader", "cta_labels", "notes", "body_blocks", "source_name"]
      }
    }
  },
  required: ["assistant_reply", "translations"]
};

// ─── Design analysis schema ───────────────────────────────────────────────────

export const designAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    assistant_reply: { type: "string" },
    analysis: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        reference_family: { type: "string" },
        reference_variant: { type: "string" },
        brand_hint: { type: "string" },
        visual_hints: {
          type: "object",
          additionalProperties: false,
          properties: {
            layout_style: {
              type: "string",
              enum: ["centered-transactional-card", "hero-promo-band", "multi-band", "plain", ""]
            },
            title_scale: {
              type: "string",
              enum: ["hero", "default", "compact"]
            },
            logo_scale: {
              type: "string",
              enum: ["wide", "default", "compact"]
            },
            card_width: {
              type: "string",
              enum: ["wide", "default", "narrow"]
            },
            button_width: {
              type: "string",
              enum: ["wide", "default", "compact"]
            },
            button_tone: {
              type: "string",
              enum: ["outline", "solid"]
            },
            card_shape: {
              type: "string",
              enum: ["sharp", "soft", "round"]
            },
            button_shape: {
              type: "string",
              enum: ["sharp", "soft", "pill"]
            },
            card_density: {
              type: "string",
              enum: ["airy", "default", "compact"]
            },
            support_layout: {
              type: "string",
              enum: ["detached", "default", "inline"]
            },
            page_bg_color: { type: "string", pattern: "^(|#[0-9A-Fa-f]{6})$" },
            card_bg_color: { type: "string", pattern: "^(|#[0-9A-Fa-f]{6})$" },
            title_color: { type: "string", pattern: "^(|#[0-9A-Fa-f]{6})$" },
            body_color: { type: "string", pattern: "^(|#[0-9A-Fa-f]{6})$" },
            accent_color: { type: "string", pattern: "^(|#[0-9A-Fa-f]{6})$" },
            button_fill_color: { type: "string", pattern: "^(|#[0-9A-Fa-f]{6})$" },
            button_border_color: { type: "string", pattern: "^(|#[0-9A-Fa-f]{6})$" },
            button_text_color: { type: "string", pattern: "^(|#[0-9A-Fa-f]{6})$" },
            notes: { type: "string" }
          },
          required: [
            "layout_style",
            "title_scale",
            "logo_scale",
            "card_width",
            "button_width",
            "button_tone",
            "card_shape",
            "button_shape",
            "card_density",
            "support_layout",
            "page_bg_color",
            "card_bg_color",
            "title_color",
            "body_color",
            "accent_color",
            "button_fill_color",
            "button_border_color",
            "button_text_color",
            "notes"
          ]
        },
        section_kinds: {
          type: "array",
          items: {
            type: "string",
            enum: ["hero", "text", "feature-list", "image", "cta", "footer"]
          }
        },
        sections_structured: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              index:        { type: "number" },
              kind: {
                type: "string",
                enum: ["hero", "text", "feature-list", "image", "cta", "footer"]
              },
              title:        { type: "string" },
              body:         { type: "string" },
              cta_label:    { type: "string" },
              has_image:    { type: "boolean" },
              image_notes:  { type: "string" },
              layout_notes: { type: "string" }
            },
            required: ["index", "kind", "title", "body", "cta_label", "has_image", "image_notes", "layout_notes"]
          }
        },
        suggested_blocks: {
          type: "array",
          items: { type: "string" }
        },
        asset_slots: {
          type: "array",
          items: { type: "string" }
        },
        content_requirements: {
          type: "array",
          items: { type: "string" }
        },
        warnings: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: [
        "summary",
        "reference_family",
        "reference_variant",
        "brand_hint",
        "visual_hints",
        "section_kinds",
        "sections_structured",
        "suggested_blocks",
        "asset_slots",
        "content_requirements",
        "warnings"
      ]
    }
  },
  required: ["assistant_reply", "analysis"]
};
