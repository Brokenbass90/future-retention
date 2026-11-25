/**
 * src/figma-intake.js — макет из Figma, разобранный на части письма.
 *
 * Studio уже умеет вытащить из Figma структуру: секции с координатами, узлы
 * текста, слоты картинок, цвета и шрифты (src/figma.js). Здесь это
 * превращается в то, чем можно собирать письмо: порядок секций сверху вниз,
 * отступы в пикселях, тексты по ролям и — главное — решение про каждую
 * картинку: она фон или содержимое.
 *
 * Почему это решение нельзя оставить модели. В письме фон и картинка в
 * контенте — две разные вёрстки: фон уезжает в background-цвет ячейки с
 * запасным цветом (половина почтовиков фоновые картинки не покажет), а
 * контентная картинка остаётся <img> с шириной и alt. Перепутать их — значит
 * получить письмо, которое в Outlook выглядит пустым прямоугольником.
 * Правило здесь детерминированное, а модель пусть решает, что написать.
 */

/** Картинка считается фоном, если секция лежит на ней, а не рядом с ней. */
const BACKGROUND_COVERAGE = 0.9;

const round = (value) => Math.round(Number(value) || 0);

/**
 * Разобрать структурный импорт Figma в план письма.
 *
 * @param {object} figmaImport — результат buildStructuredImportFromNode
 * @returns {{frame:object, palette:object, sections:Array, warnings:Array}}
 */
export function planFromFigmaImport(figmaImport) {
  const frameWidth = round(figmaImport?.frameSize?.width) || 600;
  const frameHeight = round(figmaImport?.frameSize?.height);
  const rawSections = Array.isArray(figmaImport?.sections) ? figmaImport.sections : [];
  const texts = Array.isArray(figmaImport?.texts) ? figmaImport.texts : [];
  const images = Array.isArray(figmaImport?.images) ? figmaImport.images : [];
  const warnings = [];

  // Порядок в письме — сверху вниз. В Figma секции могут лежать в любом
  // порядке слоёв, и брать их «как есть» значит собрать письмо задом наперёд.
  const sections = [...rawSections].sort((a, b) => round(a.y) - round(b.y));

  const inside = (item, section) => {
    const ix = round(item.x);
    const iy = round(item.y);
    return ix >= round(section.x) - 2
      && iy >= round(section.y) - 2
      && ix <= round(section.x) + round(section.width) + 2
      && iy <= round(section.y) + round(section.height) + 2;
  };

  let previousBottom = 0;
  const plan = sections.map((section, index) => {
    const x = round(section.x);
    const y = round(section.y);
    const width = round(section.width);
    const height = round(section.height);

    const ownTexts = texts.filter((text) => inside(text, section));
    const ownImages = images.filter((image) => inside(image, section));

    const classified = ownImages.map((image) => {
      const imageWidth = round(image.width);
      const imageHeight = round(image.height);
      const coversWidth = width > 0 && imageWidth / width >= BACKGROUND_COVERAGE;
      const coversHeight = height > 0 && imageHeight / height >= BACKGROUND_COVERAGE;
      // Фон — это когда картинка закрывает секцию целиком И поверх неё лежит
      // текст. Картинка во всю ширину без текста — это просто широкая
      // картинка (шапка, баннер), и верстается она как <img>.
      const hasTextOver = ownTexts.some((text) => inside(text, {
        x: image.x, y: image.y, width: image.width, height: image.height,
      }));
      const role = coversWidth && coversHeight && hasTextOver ? "background" : "content";
      if (role === "background") {
        warnings.push(
          `Секция «${section.name || index + 1}»: картинка стоит фоном под текстом. ` +
          "В письме это фоновый цвет + картинка: половина почтовиков фон не покажет, " +
          "и нужен запасной цвет, на котором текст читается.",
        );
      }
      return {
        role,
        width: imageWidth,
        height: imageHeight,
        name: String(image.name || "").slice(0, 120),
        ...(image.url ? { url: image.url } : {}),
      };
    });

    // Отступы считаем от рамки макета и от предыдущей секции: это то, что
    // человек глазами называет «воздухом», и то, что придётся задать в письме.
    const padding = {
      left: Math.max(0, x),
      right: Math.max(0, frameWidth - (x + width)),
      top: Math.max(0, y - previousBottom),
    };
    previousBottom = y + height;

    return {
      order: index + 1,
      name: String(section.name || "").slice(0, 120),
      role: String(section.role || "").slice(0, 40),
      width,
      height,
      columns: Number(section.columnCount) || 1,
      padding,
      background: String(section.style?.bgColor || "").trim(),
      radius: String(section.style?.radius || "").trim(),
      texts: ownTexts.map((text) => ({
        text: String(text.text || text.characters || "").slice(0, 600),
        size: round(text.fontSize),
        weight: String(text.fontWeight || "").trim(),
        color: String(text.color || "").trim(),
        align: String(text.align || "").trim(),
      })).filter((text) => text.text),
      images: classified,
    };
  });

  if (!plan.length) {
    warnings.push("В макете не нашлось секций: возможно, скопирован один слой, а не фрейм письма.");
  }
  if (frameWidth > 700) {
    warnings.push(
      `Ширина макета ${frameWidth}px. Письма верстаются под 600px — всё, что шире, ` +
      "придётся ужимать, и мелкий текст станет нечитаемым.",
    );
  }

  return {
    frame: { width: frameWidth, height: frameHeight },
    palette: {
      background: String(figmaImport?.styles?.bgColor || "").trim(),
      text: String(figmaImport?.styles?.textColor || "").trim(),
      heading: String(figmaImport?.styles?.headingColor || "").trim(),
      primary: String(figmaImport?.styles?.primaryColor || "").trim(),
      primaryText: String(figmaImport?.styles?.primaryTextColor || "").trim(),
      font: String(figmaImport?.styles?.fontFamily || "").trim(),
    },
    sections: plan,
    warnings: [...new Set(warnings)],
  };
}

/** Человеческий пересказ плана — для чата и для агента. */
export function describePlan(plan) {
  if (!plan?.sections?.length) return "Разобрать макет на секции не вышло.";
  const lines = plan.sections.map((section) => {
    const parts = [`${section.order}. ${section.name || "секция"} — ${section.width}×${section.height}px`];
    if (section.columns > 1) parts.push(`${section.columns} колонки`);
    if (section.padding.top) parts.push(`отступ сверху ${section.padding.top}`);
    if (section.padding.left) parts.push(`слева ${section.padding.left}`);
    if (section.background) parts.push(`фон ${section.background}`);
    const head = parts.join(", ");
    const texts = section.texts.slice(0, 4).map((text) => `   «${text.text.slice(0, 80)}» ${text.size}px`);
    const images = section.images.map((image) => (
      `   картинка ${image.width}×${image.height} — ${image.role === "background" ? "ФОНОМ под текстом" : "в контенте"}`
    ));
    return [head, ...texts, ...images].join("\n");
  });
  return [
    `Макет ${plan.frame.width}×${plan.frame.height}px, секций ${plan.sections.length}.`,
    ...lines,
    ...(plan.warnings.length ? ["", "Внимание:", ...plan.warnings.map((warning) => `• ${warning}`)] : []),
  ].join("\n");
}
