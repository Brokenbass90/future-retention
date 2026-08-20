/**
 * tmp-cut/blocks.mjs — исходники блоков IQ Broker (нарезка mail-strategies).
 *
 * Pug пишется ровно так, как в оригинальном письме: скоуп классов и сбор CSS
 * делает build-iqbr-blocks.mjs. Здесь только разметка и слоты.
 */

export const BLOCKS = [
  /* ─── Обёртка ──────────────────────────────────────────────────────────── */
  {
    id: "iqbr-outer-wrapper",
    label: "Обёртка письма (IQ Broker)",
    description: "Наружная часть письма IQ Broker: тёмный фон, preheader, контейнер, footer, gmail-fix. Внутрь стекаются секции.",
    placement: "outer",
    category: "wrapper",
    pug: `doctype PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"
html(xmlns="http://www.w3.org/1999/xhtml")

    include ../../../../vendor/helpers/mixins
    include ../../../../vendor/helpers/head
    <u></u>
    body.body(style="background-color:{{ background_color }}")
        include helpers/preheader
        table.body(style="background-color:{{ background_color }}")
            tr
                td.center.bg-col(align="center", valign="top" style="background-color:{{ background_color }}")
                    center
                        table.container
                            tr
                                td.pt0.out-wrapper
                                    //- {{ SECTION_BLOCKS }}
                                    include blocks/header
                                    include helpers/footer

        //Gmail App Fix
        include ../../../../vendor/helpers/gmail-fix
`,
    slots: [
      { id: "background_color", kind: "color", label: "Фон письма", default: "#01080D", uiGroup: "appearance" },
      { id: "preheader", kind: "text", label: "Preheader (скрытый предпросмотр)", default: "", uiGroup: "content" },
    ],
    childSlots: [{ id: "sections", marker: "SECTION_BLOCKS", accepts: ["section", "both"] }],
  },

  /* ─── Шапка: контейнер и логотип отдельно ─────────────────────────────── */
  {
    id: "iqbr-section-header",
    label: "Секция: шапка письма (IQ Broker)",
    description: "Верхний ряд письма без фона и обводки. Внутрь кладётся логотип или что-то ещё — например бейдж с датой.",
    placement: "section",
    category: "header",
    pug: `table.row
    tr
        td.wrapper.last.offset-by-one.pt0
            table.ten.columns
                tr
                    td.text-pad-small.pb0
                        //- {{ INNER_BLOCKS }}`,
    slots: [],
    childSlots: [{ id: "content", marker: "INNER_BLOCKS", accepts: ["inner", "inline", "both"] }],
  },
  {
    id: "iqbr-logo",
    label: "Логотип IQ Broker",
    description: "Логотип со ссылкой, по центру, с отступами сверху и снизу.",
    placement: "inner",
    category: "header",
    pug: `a(href="{{ href }}" universal="true" target="_blank")
    img.logo.center(src="{{ logo }}" alt="{{ alt }}")`,
    slots: [
      { id: "logo", kind: "image", label: "Логотип", default: "https://fsms.quadcode.com/storage/public/d5/ss/e6gggnfnh4cs771g/logo-broker.png", uiGroup: "assets" },
      { id: "href", kind: "url", label: "Ссылка логотипа", default: "https://api.trade.iqbroker.com/v1/multi-links/open-asset?aff=7", uiGroup: "content" },
      { id: "alt", kind: "text", label: "Alt логотипа", default: "IQ Broker", uiGroup: "content" },
    ],
  },

  /* ─── Тёмная панель (контейнер головы) ────────────────────────────────── */
  {
    id: "iqbr-section-dark",
    label: "Секция: тёмная панель (голова письма)",
    description: "Скруглённая тёмная панель в две зоны: широкая картинка сверху и содержимое под ней. Внутрь кладутся заголовок, тексты и кнопка.",
    placement: "section",
    category: "hero",
    pug: `table.row.brad-full.color-bg(style="background-color:{{ background_color }}")
    tr
        td.wrapper.last.pt0
            table.twelve.columns
                tr
                    td.pb10
                        //- {{ MEDIA_BLOCKS }}
    tr
        td.wrapper.last.offset-by-one.pt0
            table.ten.columns
                tr
                    td.text-pad-small.pb50.pt10
                        //- {{ INNER_BLOCKS }}`,
    slots: [
      { id: "background_color", kind: "color", label: "Фон панели", default: "#101314", uiGroup: "appearance" },
    ],
    childSlots: [
      { id: "media", marker: "MEDIA_BLOCKS", accepts: ["inner", "inline", "both"] },
      { id: "content", marker: "INNER_BLOCKS", accepts: ["inner", "inline", "both"] },
    ],
  },

  /* ─── Карточка с обводкой (контейнер) ──────────────────────────────────── */
  {
    id: "iqbr-section-bordered",
    label: "Секция: карточка с обводкой (IQ Broker)",
    description: "Скруглённая карточка с обводкой. Внутрь кладутся заголовки, тексты, картинки, двойные блоки и кнопки.",
    placement: "section",
    category: "layout",
    pug: `table.row.brad-full(style="border:{{ border }};background-color:{{ background_color }}")
    tr
        td.wrapper.last.offset-by-one
            table.ten.columns
                tr
                    td.text-pad-small.pb44.pt44
                        //- {{ INNER_BLOCKS }}`,
    slots: [
      { id: "border", kind: "text", label: "Обводка", default: "4px solid #1A1D1E", uiGroup: "appearance" },
      { id: "background_color", kind: "color", label: "Фон карточки", default: "#01080D", uiGroup: "appearance" },
    ],
    childSlots: [{ id: "content", marker: "INNER_BLOCKS", accepts: ["inner", "inline", "both"] }],
  },

  /* ─── Отбивка ──────────────────────────────────────────────────────────── */
  {
    id: "iqbr-spacer",
    label: "Отбивка (IQ Broker)",
    description: "Пустая полоса заданной высоты. Работает и между секциями, и внутри карточки.",
    placement: "both",
    category: "helper",
    pug: `div(style="font-size:8px;line-height:{{ height }};height:{{ height }}") &nbsp;`,
    slots: [
      { id: "height", kind: "select", label: "Высота", default: "12px", options: ["8px", "12px", "16px", "20px", "24px", "28px", "32px", "40px"], uiGroup: "appearance" },
    ],
  },

  /* ─── Сторы ────────────────────────────────────────────────────────────── */
  {
    id: "iqbr-stores",
    label: "Кнопки магазинов (IQ Broker)",
    description: "App Store и Google Play в ряд, на мобильном — друг под другом.",
    placement: "section",
    category: "footer",
    pug: `table.row
    tr
        td.wrapper.last.pt68.offset-by-one
            table.ten.columns
                tr
                    td.pb32.text-pad-small
                        .stor.center
                            a(href="{{ app_href }}" target="_blank")
                                img.a-app(src="{{ app_image }}" alt="App Store")
                            a(href="{{ google_href }}" target="_blank")
                                img.a-google(src="{{ google_image }}" alt="Google Play")`,
    slots: [
      { id: "app_href", kind: "url", label: "Ссылка App Store", default: "https://apps.apple.com/tn/app/iqbroker-trade-with-focus/id6752568298", uiGroup: "content" },
      { id: "app_image", kind: "image", label: "Бейдж App Store", default: "https://fsms.quadcode.com/storage/public/d5/tk/bqfvhhgea139uk40/app-iqbr-1.png", uiGroup: "assets" },
      { id: "google_href", kind: "url", label: "Ссылка Google Play", default: "https://play.google.com/store/apps/details?id=iq.broker", uiGroup: "content" },
      { id: "google_image", kind: "image", label: "Бейдж Google Play", default: "https://fsms.quadcode.com/storage/public/d5/tj/q6nvhhgea139uk30/glg-str-1.png", uiGroup: "assets" },
    ],
  },

  /* ─── Соцсети ──────────────────────────────────────────────────────────── */
  {
    id: "iqbr-socials",
    label: "Соцсети (IQ Broker)",
    description: "Четыре иконки соцсетей по центру: Facebook, Instagram, YouTube, X.",
    placement: "section",
    category: "footer",
    pug: `table.row
    tr
        td.wrapper.last.pt0
            table.twelve.columns
                tr
                    td.pb0.center(align="center")
                        .socials.center
                            a(href="{{ facebook_href }}" target="_blank")
                                img.soc-icon.fb(src="{{ facebook_icon }}" alt="Facebook")
                            a(href="{{ instagram_href }}" target="_blank")
                                img.soc-icon.twitter(src="{{ instagram_icon }}" alt="Instagram")
                            a(href="{{ youtube_href }}" target="_blank")
                                img.soc-icon.you(src="{{ youtube_icon }}" alt="YouTube")
                            a(href="{{ x_href }}" target="_blank")
                                img.soc-icon.ig(src="{{ x_icon }}" alt="X")`,
    slots: [
      { id: "facebook_href", kind: "url", label: "Facebook", default: "https://www.facebook.com/iqbroker.global/", uiGroup: "content" },
      { id: "facebook_icon", kind: "image", label: "Иконка Facebook", default: "https://fsms.quadcode.com/storage/public/d5/su/7b8ggnfnh4cs7730/fb.png", uiGroup: "assets" },
      { id: "instagram_href", kind: "url", label: "Instagram", default: "https://www.instagram.com/iq_broker_official/", uiGroup: "content" },
      { id: "instagram_icon", kind: "image", label: "Иконка Instagram", default: "https://fsms.quadcode.com/storage/public/d5/su/7b8ggnfnh4cs772g/ig.png", uiGroup: "assets" },
      { id: "youtube_href", kind: "url", label: "YouTube", default: "https://www.youtube.com/@iqbroker", uiGroup: "content" },
      { id: "youtube_icon", kind: "image", label: "Иконка YouTube", default: "https://fsms.quadcode.com/storage/public/d5/su/7bfvhhgea139ujqg/yt.png", uiGroup: "assets" },
      { id: "x_href", kind: "url", label: "X (Twitter)", default: "https://x.com/iqbroker_off", uiGroup: "content" },
      { id: "x_icon", kind: "image", label: "Иконка X", default: "https://fsms.quadcode.com/storage/public/d5/su/7bfvhhgea139ujr0/tw.png", uiGroup: "assets" },
    ],
  },

  /* ─── Футер ────────────────────────────────────────────────────────────── */
  {
    id: "iqbr-footer",
    label: "Футер (IQ Broker)",
    description: "Тёмный футер: адрес компании, предупреждение о рисках, ссылки на условия и отписку.",
    placement: "section",
    category: "footer",
    pug: `table.row.footer.bg-col(style="background-color:{{ background_color }}")
    tr
        td.pb30
            table.twelve.columns
                tr
                    td
                        .mobile-paddding
                            p.address-text {{ company_address }}
                            p.warning.pt20 {{ risk_warning }}
                            p.subscribe
                                a.left(href="{{ terms_href }}") {{ conditions }}
                                a.right(href="{{ unsubscribe_href }}") {{ unsubscribe }}`,
    slots: [
      { id: "company_address", kind: "text", label: "Адрес компании", default: "{{embedded.company_address}}", uiGroup: "content" },
      { id: "risk_warning", kind: "richText", label: "Предупреждение о рисках", default: "{{embedded.risk_warning}}", uiGroup: "content" },
      { id: "terms_href", kind: "url", label: "Ссылка на условия", default: "{{embedded.company_terms_link}}", uiGroup: "content" },
      { id: "conditions", kind: "text", label: "Текст ссылки на условия", default: "${{ footer.footer.conditions }}$", uiGroup: "content" },
      { id: "unsubscribe_href", kind: "url", label: "Ссылка отписки", default: "{{embedded.unsubscribe_link}}", uiGroup: "content" },
      { id: "unsubscribe", kind: "text", label: "Текст отписки", default: "${{ footer.footer.unsubscribe }}$", uiGroup: "content" },
      { id: "background_color", kind: "color", label: "Фон футера", default: "#01080D", uiGroup: "appearance" },
    ],
  },

  /* ─── Внутренние блоки ─────────────────────────────────────────────────── */
  {
    id: "iqbr-title-white",
    label: "Крупный белый заголовок (IQ Broker)",
    description: "Заголовок головы письма, 48/58, на мобильном 26/32.",
    placement: "inner",
    category: "text",
    pug: `p.white-title(style="color:{{ color }};padding-bottom:{{ padding_bottom }}") {{ text }}`,
    slots: [
      { id: "text", kind: "text", label: "Текст", default: "Крупный заголовок письма", uiGroup: "content" },
      { id: "color", kind: "color", label: "Цвет", default: "#F9F9F9", uiGroup: "appearance" },
      { id: "padding_bottom", kind: "select", label: "Отступ снизу", default: "16px", options: ["0", "8px", "16px", "24px", "32px"], uiGroup: "appearance" },
    ],
  },
  {
    id: "iqbr-text-white",
    label: "Белый абзац (IQ Broker)",
    description: "Основной текст на тёмной панели, 18/27.",
    placement: "inner",
    category: "text",
    pug: `p.white-text(style="color:{{ color }};padding-bottom:{{ padding_bottom }}") {{ text }}`,
    slots: [
      { id: "text", kind: "richText", label: "Текст", default: "Абзац на тёмной панели.", uiGroup: "content" },
      { id: "color", kind: "color", label: "Цвет", default: "#FFFFFF", uiGroup: "appearance" },
      { id: "padding_bottom", kind: "select", label: "Отступ снизу", default: "0", options: ["0", "8px", "16px", "24px"], uiGroup: "appearance" },
    ],
  },
  {
    id: "iqbr-title-middle",
    label: "Заголовок карточки (IQ Broker)",
    description: "Крупный светлый заголовок внутри карточки, 32/42, на мобильном 26/32.",
    placement: "inner",
    category: "text",
    pug: `p.middle-title(style="color:{{ color }};padding-bottom:{{ padding_bottom }}") {{ text }}`,
    slots: [
      { id: "text", kind: "text", label: "Текст", default: "Заголовок", uiGroup: "content" },
      { id: "color", kind: "color", label: "Цвет", default: "#ECECED", uiGroup: "appearance" },
      { id: "padding_bottom", kind: "select", label: "Отступ снизу", default: "12px", options: ["0", "8px", "12px", "16px", "24px", "32px"], uiGroup: "appearance" },
    ],
  },
  {
    id: "iqbr-text-gray",
    label: "Серый абзац (IQ Broker)",
    description: "Второстепенный текст внутри карточки, 18/27.",
    placement: "inner",
    category: "text",
    pug: `p.gray-text(style="color:{{ color }};padding-bottom:{{ padding_bottom }}") {{ text }}`,
    slots: [
      { id: "text", kind: "richText", label: "Текст", default: "Пояснение под заголовком.", uiGroup: "content" },
      { id: "color", kind: "color", label: "Цвет", default: "#A6A6AB", uiGroup: "appearance" },
      { id: "padding_bottom", kind: "select", label: "Отступ снизу", default: "32px", options: ["0", "8px", "16px", "24px", "32px"], uiGroup: "appearance" },
    ],
  },
  {
    id: "iqbr-block-title",
    label: "Подзаголовок блока (IQ Broker)",
    description: "Заголовок внутри тёмной колонки, 24/31.",
    placement: "inner",
    category: "text",
    pug: `p.block-title(style="color:{{ color }};padding-bottom:{{ padding_bottom }}") {{ text }}`,
    slots: [
      { id: "text", kind: "text", label: "Текст", default: "Подзаголовок", uiGroup: "content" },
      { id: "color", kind: "color", label: "Цвет", default: "#ECECED", uiGroup: "appearance" },
      { id: "padding_bottom", kind: "select", label: "Отступ снизу", default: "16px", options: ["0", "8px", "12px", "16px", "24px"], uiGroup: "appearance" },
    ],
  },
  {
    id: "iqbr-image",
    label: "Картинка со ссылкой (IQ Broker)",
    description: "Картинка по центру, ширина по контейнеру, отступ снизу слотом.",
    placement: "inner",
    category: "media",
    pug: `a(href="{{ href }}" universal="true" target="_blank")
    img.center(src="{{ image }}" alt="{{ alt }}" style="padding-bottom:{{ padding_bottom }}")`,
    slots: [
      { id: "image", kind: "image", label: "Картинка", default: "https://fsms.quadcode.com/storage/public/d5/th/oj8ggnfnh4cs77a0/strategies-1.png", uiGroup: "assets" },
      { id: "href", kind: "url", label: "Ссылка", default: "#", uiGroup: "content" },
      { id: "alt", kind: "text", label: "Alt", default: "", uiGroup: "content" },
      { id: "padding_bottom", kind: "select", label: "Отступ снизу", default: "20px", options: ["0", "8px", "16px", "20px", "32px"], uiGroup: "appearance" },
    ],
  },
  {
    id: "iqbr-two-columns",
    label: "Двойной блок: две тёмные колонки (IQ Broker)",
    description: "Две тёмные колонки рядом, на мобильном — друг под другом. В каждую кладутся свои внутренние блоки.",
    placement: "inner",
    category: "layout",
    pug: `.left-block
    .padding-block
        //- {{ LEFT_BLOCKS }}
.right-block
    .padding-block
        //- {{ RIGHT_BLOCKS }}`,
    childSlots: [
      { id: "left", marker: "LEFT_BLOCKS", accepts: ["inner", "inline", "both"] },
      { id: "right", marker: "RIGHT_BLOCKS", accepts: ["inner", "inline", "both"] },
    ],
  },
  {
    id: "iqbr-list-3",
    label: "Список из трёх пунктов (IQ Broker)",
    description: "Маркированный список, три пункта.",
    placement: "inner",
    category: "text",
    pug: `ul(style="margin: 0; padding: 0 0 0 20px;")
    li.block-text
        p.block-text.pb8 {{ item_1 }}
    li.block-text
        p.block-text.pb8 {{ item_2 }}
    li.block-text
        p.block-text {{ item_3 }}`,
    slots: [
      { id: "item_1", kind: "text", label: "Пункт 1", default: "Первый пункт", uiGroup: "content" },
      { id: "item_2", kind: "text", label: "Пункт 2", default: "Второй пункт", uiGroup: "content" },
      { id: "item_3", kind: "text", label: "Пункт 3", default: "Третий пункт", uiGroup: "content" },
    ],
  },
  {
    id: "iqbr-list-2",
    label: "Список из двух пунктов (IQ Broker)",
    description: "Маркированный список, два пункта.",
    placement: "inner",
    category: "text",
    pug: `ul(style="margin: 0; padding: 0 0 0 20px;")
    li.block-text
        p.block-text {{ item_1 }}
    li.block-text
        p.block-text {{ item_2 }}`,
    slots: [
      { id: "item_1", kind: "text", label: "Пункт 1", default: "Первый пункт", uiGroup: "content" },
      { id: "item_2", kind: "text", label: "Пункт 2", default: "Второй пункт", uiGroup: "content" },
    ],
  },
  {
    id: "iqbr-block-note",
    label: "Заметка с итогом (IQ Broker)",
    description: "Текст с пунктирной чертой, подзаголовок и серая строка с цветным хвостом — для «плюс/минус» и результатов.",
    placement: "inner",
    category: "text",
    pug: `p.block-text.pb16.bb-dash {{ text }}
p.block-subtitle.pt16.pb8 {{ subtitle }}
p.block-gray {{ note }}
    span(style="color:{{ accent_color }}") &nbsp;{{ accent }}`,
    slots: [
      { id: "text", kind: "richText", label: "Текст над чертой", default: "Описание сценария.", uiGroup: "content" },
      { id: "subtitle", kind: "text", label: "Подзаголовок", default: "Итог", uiGroup: "content" },
      { id: "note", kind: "text", label: "Серая строка", default: "Результат:", uiGroup: "content" },
      { id: "accent", kind: "text", label: "Цветной хвост", default: "+10%", uiGroup: "content" },
      { id: "accent_color", kind: "color", label: "Цвет хвоста", default: "#3BA581", uiGroup: "appearance" },
    ],
  },
  {
    id: "iqbr-button",
    label: "Кнопка (IQ Broker)",
    description: "Оранжевая кнопка шириной до 280px, на мобильном — во всю ширину.",
    placement: "inner",
    category: "cta",
    pug: `table.w280(align="{{ align }}" style="width: 100%;")
    tr
        td.butt.pb0(style="background-color:{{ background_color }};border-radius:{{ radius }}")
            a.butt-link(href="{{ href }}" universal="true" target="_blank" style="color:{{ text_color }}") {{ label }}`,
    slots: [
      { id: "label", kind: "text", label: "Текст кнопки", default: "Перейти", uiGroup: "content" },
      { id: "href", kind: "url", label: "Ссылка", default: "https://api.trade.iqbroker.com/v1/multi-links/open-asset?aff=7", uiGroup: "content" },
      { id: "background_color", kind: "color", label: "Цвет кнопки", default: "#FF5500", uiGroup: "appearance" },
      { id: "text_color", kind: "color", label: "Цвет текста", default: "#F9F9F9", uiGroup: "appearance" },
      { id: "radius", kind: "select", label: "Скругление", default: "12px", options: ["0", "8px", "12px", "16px", "24px"], uiGroup: "appearance" },
      { id: "align", kind: "select", label: "Выравнивание", default: "center", options: ["left", "center", "right"], uiGroup: "appearance" },
    ],
  },
];
