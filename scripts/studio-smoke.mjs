import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { buildStructuredImportFromNode } from "../src/figma.js";

const tinyScreenshotDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnK0foAAAAASUVORK5CYII=";
const studioUrl = process.env.STUDIO_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const defaultScreenshotAsset = "/studio-assets/1774015340599-pzojjw-2026-03-20-14.36.35.png";
const defaultLocalScreenshotPath = defaultScreenshotAsset.replace(/^\/studio-assets\//, "data/assets/");
const screenshotAsset = process.env.STUDIO_SCREENSHOT_ASSET
  || (existsSync(defaultLocalScreenshotPath) ? defaultScreenshotAsset : tinyScreenshotDataUrl);

async function fetchJson(path, options = {}) {
  const method = options.method || "GET";
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  try {
    const response = await fetch(`${studioUrl}${path}`, {
      method,
      headers,
      body: options.body
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}${text ? ` :: ${text.slice(0, 240)}` : ""}`);
    }

    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { raw: text };
    }
  } catch (error) {
    const cause = error.cause?.message || error.cause?.code || "";
    throw new Error(`request failed for ${path}: ${error.message}${cause ? ` (${cause})` : ""}`, { cause: error });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStudio(maxAttempts = 10, delayMs = 1000) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchJson("/api/status");
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(delayMs);
      }
    }
  }
  throw lastError || new Error("Studio status check failed");
}

function printCheck(label, ok, detail = "") {
  const prefix = ok ? "PASS" : "FAIL";
  console.log(`${prefix} ${label}${detail ? ` :: ${detail}` : ""}`);
}

async function run() {
  const failures = [];
  console.log(`Smoke target: ${studioUrl}`);

  const status = await waitForStudio();
  try {
    assert.equal(status.openAiConfigured, true);
    assert.equal(status.modelRouting?.draft, "gpt-5.4");
    assert.equal(status.modelRouting?.cloneEdit, "gpt-5.4");
    printCheck("status routing", true, "draft/cloneEdit -> gpt-5.4");
  } catch (error) {
    failures.push(error.message);
    printCheck("status routing", false, error.message);
  }

  const screenshotPayload = {
    message: "Привет! Прикрепляю скрин простого письма, собери пожалуйста верстку и создай перевод на русскую локаль\n\nВот ссылка которая должна быть картинка для лого https://static.cdnpub.info/files/storage/public/5f/56/3583618159g0d6i8h8/logo.png\n\nСсылки оставь пустыми",
    messages: [
      {
        role: "user",
        content: "Привет! Прикрепляю скрин простого письма, собери пожалуйста верстку и создай перевод на русскую локаль\n\nВот ссылка которая должна быть картинка для лого https://static.cdnpub.info/files/storage/public/5f/56/3583618159g0d6i8h8/logo.png\n\nСсылки оставь пустыми"
      }
    ],
    brief: {
      category: "X_AffSystem",
      locale: "en",
      requestedLocales: "en, ru"
    },
    settings: {
      providerId: "openai",
      clientProfileId: "standard"
    },
    design: {
      name: "password-reset-screenshot.png",
      dataUrl: screenshotAsset
    },
    screenshotOcr: {
      source: "synthetic-password-reset-smoke",
      usable: true,
      brandLine: "Affstore",
      title: "Set a new password",
      ctaLead: "Click the button below to set a new password for your account.",
      ctaLabel: "SET NEW PASSWORD",
      bodyBlocks: [
        "We received a request to reset your password."
      ],
      warningBody: "If you did not request a password reset, ignore this email.",
      supportBody: "Contact support if you need help.",
      footerBody: "",
      layoutStyle: "compact-transactional-card"
    }
  };

  const chat = await fetchJson("/api/chat", {
    method: "POST",
    body: JSON.stringify(screenshotPayload)
  });

  const draft = chat.draft || {};
  const html = String(draft.html || "");
  const templateSelection = draft.templateSelection || {};
  const previewLocales = Object.keys(draft.previewLocales || {});
  const ruPreviewHtml = String(draft.previewLocales?.ru || "");
  const screenshotAssetRecommendationCount = Array.isArray(draft.assetRecommendations)
    ? draft.assetRecommendations.length
    : 0;

  const screenshotChecks = [
    {
      label: "screenshot template category",
      test: templateSelection.category === "X_AffSystem",
      detail: templateSelection.category || "missing"
    },
    {
      label: "screenshot template mail",
      test: templateSelection.mailId === "password-retrieving-affiliate",
      detail: templateSelection.mailId || "missing"
    },
    {
      label: "screenshot template profile",
      test: templateSelection.profile === "aff-password-reset",
      detail: templateSelection.profile || "missing"
    },
    {
      label: "screenshot preview source",
      test: chat.previewSource === "email-base-draft",
      detail: chat.previewSource || "missing"
    },
    {
      label: "screenshot preview locales",
      test: previewLocales.includes("en") && previewLocales.includes("ru"),
      detail: previewLocales.join(", ")
    },
    {
      label: "screenshot custom reset shell",
      test: html.includes("qr-reset-title") && html.includes("qr-reset-button"),
      detail: "expects qr-reset-* classes"
    },
    {
      label: "screenshot no affbot leak",
      test: !html.includes("affbot.block_"),
      detail: "affbot tokens must not leak"
    },
    {
      label: "screenshot no catalog copy leak",
      test: !html.includes("Single CTA card"),
      detail: "catalog helper text must not leak"
    },
    {
      label: "screenshot no legal placeholder noise",
      test: !html.includes("company_terms_link") && !html.includes("company_address"),
      detail: "screenshot preview should not inject unrelated legal placeholders"
    },
    {
      label: "screenshot blank cta link",
      test: !html.includes("reset_password_link") && (!html.includes("href=") || /href=""|href=''/i.test(html)),
      detail: "screenshot preview should respect empty-link request"
    },
    {
      label: "screenshot ru fallback is localized",
      test: /Задайте новый пароль|Нажмите кнопку ниже|сброс пароля/i.test(ruPreviewHtml),
      detail: "ru preview should contain deterministic Russian copy"
    },
    {
      label: "screenshot asset recommendations quiet",
      test: screenshotAssetRecommendationCount === 0,
      detail: `asset recommendations: ${screenshotAssetRecommendationCount}`
    }
  ];

  for (const check of screenshotChecks) {
    if (check.test) {
      printCheck(check.label, true, check.detail);
    } else {
      failures.push(`${check.label}: ${check.detail}`);
      printCheck(check.label, false, check.detail);
    }
  }

  if (chat.providerRuntime?.issueCode === "quota") {
    printCheck("billing note", true, "OpenAI quota/billing still blocks live vision/translation");
  } else {
    printCheck("billing note", true, "live OpenAI path available");
  }

  const syntheticSystemCardPayload = {
    message: "Собери простое системное письмо по скрину и оставь ссылку пустой.",
    messages: [
      {
        role: "user",
        content: "Собери простое системное письмо по скрину и оставь ссылку пустой."
      }
    ],
    brief: {
      category: "X_System",
      locale: "en",
      requestedLocales: "en"
    },
    settings: {
      providerId: "openai",
      clientProfileId: "standard"
    },
    design: {
      name: "synthetic-system-card.png",
      dataUrl: screenshotAsset
    },
    screenshotOcr: {
      source: "synthetic-smoke",
      usable: true,
      brandLine: "Acme",
      title: "Verify your email",
      ctaLead: "Please click the button below to verify your email:",
      ctaLabel: "VERIFY EMAIL",
      bodyBlocks: [
        "Thanks for signing up. We created your account and need to confirm your email address."
      ],
      warningBody: "If you didn't request this account, you can safely ignore this email.",
      supportBody: "If you need help, contact support@example.com",
      footerBody: "",
      layoutStyle: "centered-transactional-card",
      brandWidthRatio: 0.28,
      titleWidthRatio: 0.58,
      titleHeightRatio: 0.05,
      ctaWidthRatio: 0.32,
      ctaTopRatio: 0.58,
      ctaCenterOffset: 0.03,
      width: 1280,
      height: 960
    }
  };

  const syntheticSystemCard = await fetchJson("/api/chat", {
    method: "POST",
    body: JSON.stringify(syntheticSystemCardPayload)
  });

  const syntheticHtml = String(syntheticSystemCard?.draft?.html || "");
  const syntheticChecks = [
    {
      label: "synthetic system-card preview source",
      test: syntheticSystemCard.previewSource === "email-base-draft",
      detail: syntheticSystemCard.previewSource || "missing"
    },
    {
      label: "synthetic system-card custom shell",
      test: syntheticHtml.includes("ssc-title") && syntheticHtml.includes("ssc-button"),
      detail: "expects ssc-* classes"
    },
    {
      label: "synthetic system-card visual title hint",
      test: syntheticHtml.includes("ssc-title-hero"),
      detail: "expects hero title modifier"
    },
    {
      label: "synthetic system-card shell width hint",
      test: syntheticHtml.includes("ssc-shell-wide"),
      detail: "expects wide centered shell"
    },
    {
      label: "synthetic system-card visual button hint",
      test: syntheticHtml.includes("ssc-button-outline") && syntheticHtml.includes("ssc-button-wide"),
      detail: "expects outline + wide CTA modifiers"
    },
    {
      label: "synthetic system-card no reset shell bleed",
      test: !syntheticHtml.includes("qr-reset-title"),
      detail: "generic transactional path should not reuse reset shell"
    }
  ];

  for (const check of syntheticChecks) {
    if (check.test) {
      printCheck(check.label, true, check.detail);
    } else {
      failures.push(`${check.label}: ${check.detail}`);
      printCheck(check.label, false, check.detail);
    }
  }

  const syntheticNoticePayload = {
    message: "Собери closest draft по system notice email и не добавляй лишние секции.",
    messages: [
      {
        role: "user",
        content: "Собери closest draft по system notice email и не добавляй лишние секции."
      }
    ],
    brief: {
      category: "X_System",
      locale: "en",
      requestedLocales: "en, ru"
    },
    settings: {
      providerId: "openai",
      clientProfileId: "standard"
    },
    design: {
      name: "synthetic-system-notice.png",
      dataUrl: tinyScreenshotDataUrl
    },
    screenshotOcr: {
      source: "synthetic-notice-smoke",
      usable: true,
      brandLine: "iq option",
      title: "Your Copy Trading Has Been Paused",
      ctaLead: "",
      ctaLabel: "Check your trades",
      bodyBlocks: [
        "Dear client,",
        "We would like to inform you that your copy trading activity has been temporarily suspended."
      ],
      warningBody: "Insufficient balance available for copying",
      supportBody: "If you believe this suspension was applied in error, review your account settings and balance, or contact our Support Team for further assistance.",
      footerBody: "We appreciate your understanding.",
      layoutStyle: "centered-transactional-card",
      brandWidthRatio: 0.16,
      titleWidthRatio: 0.66,
      titleHeightRatio: 0.09,
      ctaWidthRatio: 0.22,
      width: 1280,
      height: 960
    }
  };

  const syntheticNotice = await fetchJson("/api/chat", {
    method: "POST",
    body: JSON.stringify(syntheticNoticePayload)
  });

  const syntheticNoticeHtml = String(syntheticNotice?.draft?.html || "");
  const syntheticNoticeSelection = syntheticNotice?.draft?.templateSelection || {};
  const syntheticNoticeChecks = [
    {
      label: "synthetic notice template profile",
      test: syntheticNoticeSelection.profile === "system-notice-card",
      detail: syntheticNoticeSelection.profile || "missing"
    },
    {
      label: "synthetic notice preview source",
      test: syntheticNotice.previewSource === "email-base-draft",
      detail: syntheticNotice.previewSource || "missing"
    },
    {
      label: "synthetic notice custom shell",
      test: syntheticNoticeHtml.includes("snc-title") && syntheticNoticeHtml.includes("snc-callout") && syntheticNoticeHtml.includes("snc-badge"),
      detail: "expects snc-* classes"
    },
    {
      label: "synthetic notice keeps title and reason copy",
      test: syntheticNoticeHtml.includes("Your Copy Trading Has Been Paused")
        && syntheticNoticeHtml.includes("Insufficient balance available for copying")
        && !syntheticNoticeHtml.includes("Terms and Conditions</p></div>"),
      detail: "notice shell should keep headline/reason and not leak footer terms into callout"
    },
    {
      label: "synthetic notice no rfm bleed",
      test: !syntheticNoticeHtml.includes("a-google") && !syntheticNoticeHtml.includes("soc-icon") && !syntheticNoticeHtml.includes("rfm-"),
      detail: "notice shell must not include store badges, socials or rfm copy"
    }
  ];

  for (const check of syntheticNoticeChecks) {
    if (check.test) {
      printCheck(check.label, true, check.detail);
    } else {
      failures.push(`${check.label}: ${check.detail}`);
      printCheck(check.label, false, check.detail);
    }
  }

  const cloneEditPayload = {
    message: "Перенеси кнопку под картинку, добавь нормальные отступы между картинкой, кнопкой и текстом, подготовь en и ru локали и оставь ссылки пустыми.",
    messages: [
      {
        role: "user",
        content: "Перенеси кнопку под картинку, добавь нормальные отступы между картинкой, кнопкой и текстом, подготовь en и ru локали и оставь ссылки пустыми."
      }
    ],
    brief: {
      category: "X_AffSystem",
      locale: "en",
      requestedLocales: "en, ru"
    },
    settings: {
      providerId: "openai",
      clientProfileId: "standard"
    },
    baseEmailHtml: "<!doctype html><html><body><table role=\"presentation\" width=\"100%\"><tr><td style=\"padding:24px\"><p style=\"margin:0 0 16px\">Intro above image</p><img src=\"https://example.com/hero.png\" alt=\"hero\" width=\"320\" style=\"display:block\"><p style=\"margin:16px 0 0\">Hello, user</p><a href=\"https://example.com/review\" style=\"display:inline-block;background:#ff7a00;color:#fff;padding:12px 20px;text-decoration:none\">Leave review</a><p style=\"margin:12px 0 0\">Share your experience with us.</p></td></tr></table></body></html>"
  };

  const cloneEdit = await fetchJson("/api/chat", {
    method: "POST",
    body: JSON.stringify(cloneEditPayload)
  });

  const cloneEditHtml = String(cloneEdit?.draft?.html || "");
  const cloneEditLocales = Object.keys(cloneEdit?.draft?.previewLocales || {});
  const cloneEditChecks = [
    {
      label: "clone-edit preview locales",
      test: cloneEditLocales.includes("en") && cloneEditLocales.includes("ru"),
      detail: cloneEditLocales.join(", ")
    }
  ];

  if (cloneEdit?.providerRuntime?.issueCode === "quota") {
    const imageIndex = cloneEditHtml.indexOf("<img");
    const ctaIndex = cloneEditHtml.indexOf("Leave review");
    const helloIndex = cloneEditHtml.indexOf("Hello, user");
    cloneEditChecks.push(
      {
        label: "clone-edit fallback blank links",
        test: cloneEditHtml.includes('href=""'),
        detail: "href should be blanked in mock fallback"
      },
      {
        label: "clone-edit fallback cta below image",
        test: imageIndex >= 0 && ctaIndex > imageIndex && (helloIndex < 0 || ctaIndex < helloIndex),
        detail: "CTA should be moved directly under image before copy"
      },
      {
        label: "clone-edit fallback spacing",
        test: /margin-bottom:\s*24px/i.test(cloneEditHtml) && /margin-top:\s*24px/i.test(cloneEditHtml),
        detail: "fallback should inject safe spacing"
      }
    );
  }

  for (const check of cloneEditChecks) {
    if (check.test) {
      printCheck(check.label, true, check.detail);
    } else {
      failures.push(`${check.label}: ${check.detail}`);
      printCheck(check.label, false, check.detail);
    }
  }

  const challengeCloneEditPayload = {
    message: "Нужно удалить кнопку Accept Challenge, блок с оранжевой обводкой перенести над блоком Try This Simple Challenge Next Week: и так же нужно перевести письмо на русский то есть сделать 2 локали английскую и русскую",
    messages: [
      {
        role: "user",
        content: "Нужно удалить кнопку Accept Challenge, блок с оранжевой обводкой перенести над блоком Try This Simple Challenge Next Week: и так же нужно перевести письмо на русский то есть сделать 2 локали английскую и русскую"
      }
    ],
    brief: {
      category: "X_AffSystem",
      locale: "en",
      requestedLocales: "en, ru"
    },
    settings: {
      providerId: "openai",
      clientProfileId: "standard"
    },
    baseEmailHtml: "<!doctype html><html><head><meta charset=\"utf-8\"><title>Weekly challenge</title></head><body style=\"margin:0;background:#f5f5f7;font-family:Arial,sans-serif;\"><table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\"><tr><td align=\"center\" style=\"padding:24px;\"><table role=\"presentation\" width=\"640\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#ffffff;border-radius:24px;overflow:hidden;\"><tr><td style=\"padding:32px;background:linear-gradient(135deg,#1d0d08,#ffae38);color:#fff;\"><h1 style=\"margin:0 0 16px;font-size:44px;line-height:1.1;\">One trade isn't all that defines you</h1><p style=\"margin:0 0 24px;font-size:18px;line-height:1.5;\">Markets move in cycles, and even the most successful traders face losing deals.</p><a href=\"https://example.com/challenge\" style=\"display:inline-block;background:#ff9a2f;color:#fff;padding:18px 28px;border-radius:16px;text-decoration:none;font-weight:700;\">Accept Challenge</a></td></tr><tr><td style=\"padding:24px 32px;\"><table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"border:3px solid #ff8a2a;border-radius:24px;\"><tr><td style=\"padding:24px;\"><h2 style=\"margin:0 0 12px;font-size:28px;line-height:1.2;\">Why the Market Moves</h2><p style=\"margin:0 0 20px;font-size:18px;line-height:1.5;\">Sometimes technical analysis is not enough. Many sharp swings are driven by global events.</p><a href=\"https://example.com/tutorials\" style=\"display:inline-block;background:#ff8a2a;color:#fff;padding:16px 24px;border-radius:14px;text-decoration:none;font-weight:700;\">Watch Tutorials</a></td></tr></table></td></tr><tr><td style=\"padding:0 32px 32px;\"><table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f7f7fb;border-radius:24px;\"><tr><td style=\"padding:24px;\"><h2 style=\"margin:0 0 16px;font-size:32px;line-height:1.2;color:#303341;\">Try This Simple Challenge Next Week:</h2><p style=\"margin:0;font-size:18px;line-height:1.5;color:#303341;\">Pick just one market and focus only on your best setup.</p></td></tr></table></td></tr></table></td></tr></table></body></html>"
  };

  const challengeCloneEdit = await fetchJson("/api/chat", {
    method: "POST",
    body: JSON.stringify(challengeCloneEditPayload)
  });

  const challengeEnHtml = String(challengeCloneEdit?.draft?.previewLocales?.en || challengeCloneEdit?.draft?.html || "");
  const challengeRuHtml = String(challengeCloneEdit?.draft?.previewLocales?.ru || "");
  const challengeChecks = [
    {
      label: "clone-edit challenge locales",
      test: Object.keys(challengeCloneEdit?.draft?.previewLocales || {}).includes("en")
        && Object.keys(challengeCloneEdit?.draft?.previewLocales || {}).includes("ru"),
      detail: Object.keys(challengeCloneEdit?.draft?.previewLocales || {}).join(", ")
    }
  ];

  if (challengeCloneEdit?.providerRuntime?.issueCode === "quota") {
    challengeChecks.push({
      label: "clone-edit challenge skipped on quota",
      test: true,
      detail: "live clone-edit assertions skipped because quota is unavailable"
    });
  } else {
    challengeChecks.push(
      {
        label: "clone-edit challenge removed CTA",
        test: !/Accept Challenge/i.test(challengeEnHtml) && !/Accept Challenge/i.test(challengeRuHtml),
        detail: "Accept Challenge should be removed in both locales"
      },
      {
        label: "clone-edit challenge moved outlined block",
        test: challengeEnHtml.indexOf("Why the Market Moves") > -1
          && challengeEnHtml.indexOf("Try This Simple Challenge Next Week") > -1
          && challengeEnHtml.indexOf("Why the Market Moves") < challengeEnHtml.indexOf("Try This Simple Challenge Next Week"),
        detail: "outlined block should appear before next-week block"
      },
      {
        label: "clone-edit challenge localized ru body",
        test: /[А-Яа-яЁё]/.test(challengeRuHtml)
          && /следующей неделе|следующую неделю|челлендж на следующей неделе/i.test(challengeRuHtml)
          && /Смотреть|Туториал|Руководств|урок/i.test(challengeRuHtml),
        detail: "ru preview should contain translated challenge/tutorial copy"
      }
    );
  }

  for (const check of challengeChecks) {
    if (check.test) {
      printCheck(check.label, true, check.detail);
    } else {
      failures.push(`${check.label}: ${check.detail}`);
      printCheck(check.label, false, check.detail);
    }
  }

  const readiness = await fetchJson("/api/figma/readiness", {
    method: "POST",
    body: JSON.stringify({
      figmaUrl: "https://www.figma.com/file/DEMO12345678/Test-Frame?node-id=1-2"
    })
  });
  const preferredFigmaPath = readiness?.readiness?.preferredPath || readiness?.preferredPath || "";

  try {
    assert.ok(preferredFigmaPath);
    printCheck("figma readiness", true, preferredFigmaPath);
  } catch (error) {
    failures.push(`figma readiness: ${error.message}`);
    printCheck("figma readiness", false, error.message);
  }

  const syntheticStructuredImport = buildStructuredImportFromNode({
    selectionName: "Smoke composite frame",
    pageName: "Smoke",
    rootNode: {
      id: "root",
      type: "FRAME",
      name: "Email frame",
      absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 900 },
      children: [
        {
          id: "wrapper",
          type: "GROUP",
          name: "Main wrapper",
          absoluteBoundingBox: { x: 40, y: 20, width: 520, height: 820 },
          children: [
            { id: "logo", type: "RECTANGLE", name: "logo", absoluteBoundingBox: { x: 240, y: 30, width: 120, height: 40 }, fills: [{ type: "IMAGE" }] },
            { id: "title", type: "TEXT", name: "title", characters: "Set your new password", style: { fontSize: 34, fontWeight: 700 }, absoluteBoundingBox: { x: 110, y: 140, width: 380, height: 56 } },
            { id: "body1", type: "TEXT", name: "body", characters: "We created an account for you on example.com", style: { fontSize: 18, fontWeight: 400 }, absoluteBoundingBox: { x: 110, y: 240, width: 380, height: 48 } },
            {
              id: "cta",
              type: "FRAME",
              name: "button",
              absoluteBoundingBox: { x: 180, y: 360, width: 240, height: 56 },
              fills: [{ type: "SOLID", color: { r: 1, g: 0.25, b: 0.3, a: 1 } }],
              children: [
                { id: "cta-text", type: "TEXT", name: "button text", characters: "SET NEW PASSWORD", style: { fontSize: 18, fontWeight: 700 }, absoluteBoundingBox: { x: 215, y: 376, width: 170, height: 24 } }
              ]
            },
            { id: "warn", type: "TEXT", name: "body", characters: "If you did not request this, ignore this email.", style: { fontSize: 16, fontWeight: 400 }, absoluteBoundingBox: { x: 110, y: 480, width: 380, height: 42 } },
            { id: "support", type: "TEXT", name: "body", characters: "Reach us at support@example.com", style: { fontSize: 16, fontWeight: 400 }, absoluteBoundingBox: { x: 110, y: 650, width: 380, height: 42 } },
            {
              id: "footer",
              type: "GROUP",
              name: "footer",
              absoluteBoundingBox: { x: 100, y: 760, width: 400, height: 40 },
              children: [
                { id: "terms", type: "TEXT", name: "terms", characters: "Terms and Conditions", style: { fontSize: 12, fontWeight: 400 }, absoluteBoundingBox: { x: 110, y: 770, width: 160, height: 20 } },
                { id: "unsub", type: "TEXT", name: "unsubscribe", characters: "Unsubscribe", style: { fontSize: 12, fontWeight: 400 }, absoluteBoundingBox: { x: 320, y: 770, width: 100, height: 20 } }
              ]
            }
          ]
        }
      ]
    }
  });
  const syntheticRoles = Array.isArray(syntheticStructuredImport?.sections)
    ? syntheticStructuredImport.sections.map((section) => section.role)
    : [];
  const wrappedStructuredImport = buildStructuredImportFromNode({
    fileKey: "DEMOFILE",
    nodeId: "wrapped-root",
    selectionName: "Wrapped intake frame",
    rootNode: {
      id: "wrapped-root",
      type: "FRAME",
      name: "Marketing Email",
      absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 1200 },
      children: [
        {
          id: "frame-22",
          type: "FRAME",
          name: "Frame 22",
          absoluteBoundingBox: { x: 20, y: 0, width: 560, height: 1180 },
          children: [
            {
              id: "container",
              type: "FRAME",
              name: "container",
              absoluteBoundingBox: { x: 20, y: 0, width: 560, height: 1180 },
              children: [
                {
                  id: "topbar",
                  type: "FRAME",
                  name: "Top Bar Center",
                  absoluteBoundingBox: { x: 20, y: 0, width: 560, height: 90 },
                  children: [
                    {
                      id: "logo",
                      type: "RECTANGLE",
                      name: "brand logo",
                      fills: [{ type: "IMAGE" }],
                      absoluteBoundingBox: { x: 240, y: 26, width: 120, height: 30 }
                    }
                  ]
                },
                {
                  id: "hero",
                  type: "FRAME",
                  name: "Hero Content",
                  absoluteBoundingBox: { x: 60, y: 120, width: 480, height: 260 },
                  children: [
                    { id: "hero-title", type: "TEXT", name: "title", characters: "Stronger Trading Setup", style: { fontSize: 36, fontWeight: 700 }, absoluteBoundingBox: { x: 80, y: 140, width: 400, height: 50 } },
                    { id: "hero-copy", type: "TEXT", name: "body", characters: "Use platform tools to refine your strategy.", style: { fontSize: 18, fontWeight: 400 }, absoluteBoundingBox: { x: 80, y: 210, width: 400, height: 56 } },
                    {
                      id: "hero-button",
                      type: "FRAME",
                      name: "button",
                      absoluteBoundingBox: { x: 160, y: 300, width: 220, height: 56 },
                      fills: [{ type: "SOLID", color: { r: 1, g: 0.45, b: 0, a: 1 } }],
                      children: [
                        { id: "hero-button-label", type: "TEXT", name: "button text", characters: "Open Traderoom", style: { fontSize: 18, fontWeight: 700 }, absoluteBoundingBox: { x: 195, y: 316, width: 150, height: 24 } }
                      ]
                    }
                  ]
                },
                {
                  id: "checklist",
                  type: "FRAME",
                  name: "Checklist",
                  absoluteBoundingBox: { x: 40, y: 430, width: 520, height: 420 },
                  children: [
                    { id: "checklist-title", type: "TEXT", name: "title", characters: "Top Tools to Upgrade Your Trading", style: { fontSize: 32, fontWeight: 700 }, absoluteBoundingBox: { x: 80, y: 460, width: 360, height: 42 } },
                    { id: "step-1", type: "TEXT", name: "body", characters: "Edge Scanner Strategy Indicator", style: { fontSize: 18, fontWeight: 400 }, absoluteBoundingBox: { x: 80, y: 530, width: 360, height: 27 } },
                    { id: "step-2", type: "TEXT", name: "body", characters: "Heikin-Ashi Chart", style: { fontSize: 18, fontWeight: 400 }, absoluteBoundingBox: { x: 80, y: 610, width: 360, height: 27 } },
                    { id: "step-3", type: "TEXT", name: "body", characters: "Volume Widget", style: { fontSize: 18, fontWeight: 400 }, absoluteBoundingBox: { x: 80, y: 690, width: 360, height: 27 } }
                  ]
                },
                {
                  id: "footer",
                  type: "GROUP",
                  name: "footer",
                  absoluteBoundingBox: { x: 60, y: 980, width: 480, height: 120 },
                  children: [
                    { id: "terms", type: "TEXT", name: "terms", characters: "Terms and Conditions", style: { fontSize: 12, fontWeight: 400 }, absoluteBoundingBox: { x: 120, y: 1020, width: 150, height: 20 } },
                    { id: "unsub", type: "TEXT", name: "unsubscribe", characters: "Unsubscribe", style: { fontSize: 12, fontWeight: 400 }, absoluteBoundingBox: { x: 340, y: 1020, width: 100, height: 20 } }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  });
  const wrappedRoles = Array.isArray(wrappedStructuredImport?.sections)
    ? wrappedStructuredImport.sections.map((section) => section.role)
    : [];
  const figmaSlicingChecks = [
    {
      label: "figma composite split count",
      test: syntheticRoles.length >= 5,
      detail: syntheticRoles.join(", ")
    },
    {
      label: "figma composite split roles",
      test: ["header", "hero", "cta", "text", "footer"].every((role) => syntheticRoles.includes(role)),
      detail: syntheticRoles.join(", ")
    },
    {
      label: "figma wrapper unwrap split count",
      test: wrappedRoles.length >= 4,
      detail: wrappedRoles.join(", ")
    },
    {
      label: "figma wrapper unwrap keeps footer last",
      test: wrappedRoles[wrappedRoles.length - 1] === "footer" && wrappedRoles[0] !== "footer",
      detail: wrappedRoles.join(", ")
    }
  ];

  for (const check of figmaSlicingChecks) {
    if (check.test) {
      printCheck(check.label, true, check.detail);
    } else {
      failures.push(`${check.label}: ${check.detail}`);
      printCheck(check.label, false, check.detail);
    }
  }

  if (failures.length > 0) {
    console.error(`\nSmoke checks failed: ${failures.length}`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("\nAll studio smoke checks passed.");
}

run().catch((error) => {
  console.error("Smoke runner failed:", error?.stack || error?.message || error);
  if (error?.cause) {
    console.error("Cause:", error.cause?.stack || error.cause?.message || error.cause);
  }
  process.exit(1);
});
