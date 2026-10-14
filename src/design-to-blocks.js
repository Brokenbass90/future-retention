/**
 * src/design-to-blocks.js — секция макета → блоки каталога.
 *
 * Главное, что здесь стоит понимать: «переработка макета» — это НЕ перевод
 * пикселей в вёрстку. Так не делает никто, и не потому что не умеют. Макет —
 * это абсолютные координаты, а письмо — поток таблиц, который должен выжить в
 * Outlook, Gmail и ещё десятке почтовиков со своими причудами. Один в один
 * между ними отображения не существует; попытка конвертировать буквально даёт
 * вёрстку, которая красиво выглядит в браузере и разваливается в почте.
 *
 * Работающий путь другой, и студия к нему уже приспособлена: макет говорит
 * ЧТО и в каком порядке, а КАК это верстается — знают блоки каталога, каждый
 * из которых уже проверен на почтовиках. Задача сводится к сопоставлению:
 * какой блок ближе всего к этой секции макета.
 *
 * Сопоставляем по структуре, а не по названиям. У каждого блока каталога есть
 * подпись превью: сколько картинок, кнопок, колонок, сколько текста, какая
 * подложка, какая высота. У секции макета то же самое считается из разбора.
 * Имена не описывают внешность — «hero-2» не говорит ни о чём, а «одна
 * картинка, короткий текст, кнопка» говорит всё.
 */

const round = (value) => Math.round(Number(value) || 0);

/** Что у секции внутри — в тех же единицах, что подпись блока. */
export function sectionShape(section) {
  const texts = Array.isArray(section?.texts) ? section.texts : [];
  const images = Array.isArray(section?.images) ? section.images : [];
  const textChars = texts.reduce((sum, item) => sum + String(item?.text || "").length, 0);
  const sizes = texts.map((item) => round(item?.size)).filter(Boolean);

  return {
    width: round(section?.width),
    height: round(section?.height),
    columns: Math.max(1, Number(section?.columns) || 1),
    background: String(section?.background || "").trim(),
    images: images.filter((image) => image?.role === "content").length,
    backgroundImage: images.some((image) => image?.role === "background"),
    textChars,
    lines: texts.length,
    maxFont: sizes.length ? Math.max(...sizes) : 0,
    // Кнопка в макете — это короткая надпись на своей заливке в невысокой
    // секции. Отдельного признака «это кнопка» в Figma нет, и угадывать по
    // имени слоя бессмысленно: их называют как попало.
    looksLikeButton: texts.length === 1
      && textChars > 0 && textChars <= 32
      && round(section?.height) <= 120
      && Boolean(String(section?.background || "").trim()),
  };
}

/** Насколько блок далёк от секции. Меньше — ближе. */
function distance(shape, signature) {
  let score = 0;
  const notes = [];

  const blockImages = Number(signature?.images) || 0;
  if (blockImages === shape.images && shape.images > 0) notes.push(`${shape.images} картинк(и) — как в секции`);
  score += Math.abs(blockImages - shape.images) * 30;

  // Картинка ФОНОМ под текстом — отдельная вёрстка, и блок без картинки
  // сюда не годится в принципе. Без этой поправки секция-герой попадала в
  // «подсветку»: текста столько же, подложка есть — формально похоже.
  if (shape.backgroundImage) {
    score += blockImages > 0 ? 0 : 80;
    if (blockImages > 0) notes.push("умеет картинку под текстом");
  }

  const blockColumns = Math.max(1, Number(signature?.columns) || 1);
  if (blockColumns === shape.columns && shape.columns > 1) notes.push(`${shape.columns} колонки`);
  score += Math.abs(blockColumns - shape.columns) * 40;

  const blockButtons = (Number(signature?.buttons) || 0) + (Number(signature?.links) || 0);
  if (shape.looksLikeButton) {
    if (blockButtons > 0) notes.push("есть кнопка или ссылка");
    score += blockButtons > 0 ? 0 : 60;
    // Кнопка — это мало текста. Блок с абзацем сюда не годится.
    score += Math.min(60, Math.abs((Number(signature?.textChars) || 0) - shape.textChars) / 2);
  } else {
    const blockChars = Number(signature?.textChars) || 0;
    const diff = Math.abs(blockChars - shape.textChars);
    score += Math.min(50, diff / 8);
    if (diff <= 40 && shape.textChars > 0) notes.push("столько же текста");
  }

  // Высота — слабый признак: блок тянется по содержимому. Но секция в 60px и
  // блок в 400px это всё-таки разные вещи.
  const blockHeight = Number(signature?.height) || 0;
  if (blockHeight && shape.height) {
    score += Math.min(40, Math.abs(blockHeight - shape.height) / 12);
  }

  // Своя подложка у секции — значит нужен блок с подложкой, а не прозрачный.
  const blockBackground = String(signature?.background || "").toLowerCase();
  const blockHasBackground = blockBackground && !/^#f{3,6}$|^#fefefe$|transparent/.test(blockBackground);
  if (shape.background) {
    score += blockHasBackground ? 0 : 25;
    if (blockHasBackground) notes.push("своя подложка");
  } else if (blockHasBackground) {
    score += 15;
  }

  if (shape.maxFont >= 24 && (Number(signature?.textChars) || 0) <= 60 && shape.images === 0) {
    notes.push("похоже на заголовок");
    score -= 10;
  }

  return { score, notes };
}

/**
 * Подобрать блоки под план макета.
 *
 * @param {object} input
 * @param {object} input.plan — результат planFromFigmaImport
 * @param {Array} input.blocks — каталог с прикрученными превью
 * @param {number} [input.perSection] — сколько кандидатов на секцию
 * @returns {{sections: Array, uncovered: Array}}
 */
export function matchSectionsToBlocks({ plan, blocks = [], perSection = 3 } = {}) {
  const usable = (blocks || []).filter((block) => (
    block?.preview?.status === "ok"
    && block.preview.signature
    && block.placement !== "outer"
    && !block.retired
  ));

  const sections = (plan?.sections || []).map((section) => {
    const shape = sectionShape(section);
    const scored = usable
      .map((block) => {
        const { score, notes } = distance(shape, block.preview.signature);
        return { id: block.id, label: block.label || block.id, score, why: notes.slice(0, 3) };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, Math.max(1, perSection));

    return {
      order: section.order,
      name: section.name,
      shape,
      candidates: scored,
      // Ничего близкого — честный сигнал: такой формы в каталоге нет, и
      // агенту надо не подгонять, а предложить новый блок.
      needsNewBlock: !scored.length || scored[0].score > 120,
    };
  });

  return {
    sections,
    uncovered: sections.filter((section) => section.needsNewBlock).map((section) => section.order),
  };
}

/** Человеческий пересказ подбора. */
export function describeMatches(match) {
  if (!match?.sections?.length) return "Подбирать не к чему: в макете нет секций.";
  const lines = match.sections.map((section) => {
    const head = `${section.order}. ${section.name || "секция"}`;
    if (section.needsNewBlock) {
      return `${head} — похожего блока в каталоге НЕТ. Нужен новый: ` +
        `${section.shape.images} картинок, ${section.shape.columns} колонк(и), ` +
        `${section.shape.textChars} символов текста` +
        (section.shape.looksLikeButton ? ", похоже на кнопку" : "");
    }
    const options = section.candidates
      .map((candidate) => `${candidate.id}${candidate.why.length ? ` (${candidate.why.join(", ")})` : ""}`)
      .join("; ");
    return `${head} → ${options}`;
  });
  return [
    "Подбор блоков под макет:",
    ...lines,
    ...(match.uncovered.length
      ? ["", `Секций без подходящего блока: ${match.uncovered.join(", ")}. ` +
         "Их нужно либо собрать из мелких блоков, либо завести новый блок по образцу соседа."]
      : []),
  ].join("\n");
}
