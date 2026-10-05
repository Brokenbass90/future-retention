/**
 * src/shot.js — снимок письма картинкой.
 *
 * Агент через MCP до сих пор работал вслепую: он собирал письмо и получал
 * обратно число байт и список предупреждений. О том, что заголовок налез на
 * картинку, а кнопка уехала за край, так узнать нельзя — и обсуждать дизайн
 * с человеком было не о чем. Здесь письмо превращается в PNG, который агент
 * действительно видит.
 *
 * Браузер не тянем в зависимости: `playwright-core` ничего не скачивает при
 * установке, и на машине, где студия работает, Chrome обычно уже стоит.
 * Порядок поиска тот же, что у съёмки превью блоков, — иначе получились бы
 * две разные картинки одного и того же письма.
 *
 * Если браузера нет, это не поломка: ошибка прямо говорит, что сделать, а
 * вызывающий решает, показать её человеку или обойтись без картинки.
 */
import { existsSync } from "node:fs";

/** Где искать браузер, если playwright свой не скачал. */
const SYSTEM_CHROME_CANDIDATES = process.platform === "darwin"
  ? [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
  : [
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ];

export class ShotUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "ShotUnavailableError";
    this.code = "NO_BROWSER";
  }
}

/**
 * Десктоп снимаем в окне 700px, а не 600: письмо и так 600 и центрируется,
 * но мобильные медиазапросы семьи написаны как max-width:640 — в окне 600
 * письмо снялось бы в мобильной вёрстке и выдало бы её за десктопную.
 */
export const SHOT_VIEWS = {
  desktop: { width: 700, label: "десктоп" },
  mobile: { width: 375, label: "телефон" },
};

let _chromium = null;
async function loadChromium() {
  if (_chromium) return _chromium;
  try {
    ({ chromium: _chromium } = await import("playwright-core"));
  } catch (error) {
    throw new ShotUnavailableError(
      `Снимок недоступен: не установлен playwright-core (${error.message}). ` +
      "Поставьте его в папке студии: npm install."
    );
  }
  return _chromium;
}

function resolveExecutable(chromium) {
  const bundled = (() => {
    try { return chromium.executablePath(); } catch { return ""; }
  })();
  if (bundled && existsSync(bundled)) return bundled;
  const system = SYSTEM_CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (system) return system;
  throw new ShotUnavailableError(
    "Снимок недоступен: на этой машине не найден браузер. " +
    "Поставьте его один раз командой npx playwright-core install --only-shell chromium " +
    "или установите Google Chrome."
  );
}

/**
 * Снять HTML письма в PNG.
 *
 * Внешние картинки не грузим: письмо ссылается на боевой CDN, и снимок начал
 * бы зависеть от сети и от того, жив ли чужой сервер. Вместо картинок —
 * серая заглушка того же размера: рамка блока видна, вёрстка не съезжает.
 *
 * @param {object} options
 * @param {string} options.html — готовый HTML письма
 * @param {"desktop"|"mobile"} [options.view]
 * @param {boolean} [options.fullPage] — всё письмо или только первый экран
 * @param {number} [options.maxHeight] — обрезать снимок по высоте, px
 * @returns {Promise<{png: Buffer, width: number, view: string}>}
 */
export async function renderHtmlShot({ html, view = "desktop", fullPage = true, maxHeight = 4000 } = {}) {
  const source = String(html || "");
  if (!source.trim()) throw new Error("Нечего снимать: пустой HTML.");
  const size = SHOT_VIEWS[view] || SHOT_VIEWS.desktop;

  const chromium = await loadChromium();
  const executablePath = resolveExecutable(chromium);

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const context = await browser.newContext({
      viewport: { width: size.width, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    // Картинки подменяем, всё остальное снаружи режем: снимок должен
    // зависеть только от письма.
    await context.route(/^https?:\/\//, (route) => (
      route.request().resourceType() === "image"
        ? route.fulfill({ contentType: "image/png", body: PLACEHOLDER_PNG })
        : route.abort()
    ));
    const page = await context.newPage();
    await page.setContent(source, { waitUntil: "load", timeout: 15_000 });

    // Высоту письма меряем по нижнему краю самого нижнего элемента, а не по
    // scrollHeight: для страницы короче окна и body, и documentElement
    // отдают высоту окна, и снимок письма на 150 пикселей приезжал с
    // восемью сотнями пустоты — на такой картинке не видно ничего.
    const content = await page.evaluate(() => Math.ceil(Math.max(
      0,
      ...Array.from(document.body.querySelectorAll("*"), (node) => node.getBoundingClientRect().bottom),
    )));
    const height = fullPage
      ? Math.max(200, Math.min(maxHeight, content + 24))
      : 900;
    await page.setViewportSize({ width: size.width, height });
    const png = await page.screenshot({ type: "png" });
    return { png, width: size.width, view: size === SHOT_VIEWS.mobile ? "mobile" : "desktop", height };
  } finally {
    try { await browser?.close(); } catch { /* уже мёртв */ }
  }
}

/** Серый квадрат 1×1: растягивается по размеру исходной картинки. */
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
