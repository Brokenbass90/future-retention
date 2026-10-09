/**
 * src/figma-clipboard.js — что приехало из Figma через Ctrl+V.
 *
 * Когда в Figma жмут ⌘C, в буфер кладётся HTML такого вида:
 *
 *   <span data-metadata="<!--(figmeta){base64}(/figmeta)-->"></span>
 *   <span data-buffer="<!--(figma){base64}(/figma)-->"></span>
 *
 * `figmeta` — обычный JSON в base64: ключ файла, номер вставки, тип данных.
 * `data-buffer` — весь макет в приватном двоичном формате (kiwi + zstd).
 *
 * Разбирать буфер мы НЕ беремся, и это осознанное решение, а не лень. Формат
 * закрытый и недокументированный, он уже менялся (сцена переехала с deflate на
 * zstd и сломала все сторонние парсеры), а ломается такой разбор молча: вставка
 * «сработает» и отдаст мусор. Зато ключ файла из `figmeta` — это base64 от
 * JSON, ломаться там нечему; по ключу студия дальше идёт в Figma по её
 * собственному API, который открыт, описан и не меняется молча.
 *
 * Поэтому здесь только разбор буфера обмена: понять, ЧТО вставили и хватает ли
 * этого, чтобы забрать макет. Сам разбор макета на секции, тексты и картинки
 * делает src/figma.js — он это уже умеет.
 */

/** Достать base64 из фигмовского комментария-обёртки. */
function pickPayload(html, tag) {
  const pattern = new RegExp(`<!--\\(${tag}\\)([\\s\\S]*?)\\(/${tag}\\)-->`);
  const match = String(html || "").match(pattern);
  return match ? match[1].trim() : "";
}

function decodeBase64Json(value) {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Ссылка на файл или на выделение внутри него. */
function figmaUrlIn(text) {
  const match = String(text || "").match(/https?:\/\/(?:www\.)?figma\.com\/[^\s"'<>]+/);
  return match ? match[0] : "";
}

/**
 * Разобрать буфер обмена.
 *
 * @param {object} input
 * @param {string} [input.html] — флейвор text/html
 * @param {string} [input.text] — флейвор text/plain
 * @returns {{kind:string, fileKey:string, nodeId:string, url:string, bufferBytes:number, note:string}}
 *   kind: "link" — ссылка на выделение, самый точный случай;
 *         "scene" — сам макет: есть ключ файла, но не известно, какой фрейм;
 *         "text" — просто текст, макета нет;
 *         "empty" — вставлять нечего.
 */
export function readFigmaClipboard({ html = "", text = "" } = {}) {
  const meta = decodeBase64Json(pickPayload(html, "figmeta"));
  const buffer = pickPayload(html, "figma");
  const url = figmaUrlIn(text) || figmaUrlIn(html);

  // Ссылка точнее всего: в ней есть и файл, и конкретный узел. Её человек
  // получает по ⌘L «Copy link to selection».
  if (url) {
    const fileKeyMatch = url.match(/figma\.com\/(?:design|file|proto)\/([A-Za-z0-9_-]+)/);
    const nodeMatch = url.match(/node-id=([0-9]+)[:\-]([0-9]+)/);
    if (fileKeyMatch) {
      return {
        kind: "link",
        fileKey: fileKeyMatch[1],
        nodeId: nodeMatch ? `${nodeMatch[1]}:${nodeMatch[2]}` : "",
        url,
        bufferBytes: 0,
        note: nodeMatch
          ? "Ссылка на выделение — самый точный случай: студия заберёт именно этот фрейм."
          : "Ссылка на файл без выделения: студия покажет фреймы, выберите нужный.",
      };
    }
  }

  const fileKey = String(meta?.fileKey || "").trim();
  if (fileKey) {
    return {
      kind: "scene",
      fileKey,
      nodeId: "",
      url: `https://www.figma.com/design/${fileKey}/`,
      bufferBytes: buffer.length,
      // Тексты макета Figma кладёт в буфер и обычной строкой — те самые
      // заголовки, абзацы и надписи на кнопках. Это работает, даже когда до
      // API не достучаться (протух токен, нет сети), и выбрасывать их только
      // потому, что не вышло забрать картинку, — расточительство: половину
      // работы по письму они закрывают.
      text: String(text || "").trim().slice(0, 20000),
      note:
        "Вставлен макет. Ключ файла прочитан, но какой именно фрейм скопировали — в закрытой " +
        "части буфера, и мы её не разбираем. Студия покажет фреймы файла, выберите нужный — " +
        "или скопируйте ссылку на выделение (⌘L), тогда выбирать не придётся.",
    };
  }

  const plain = String(text || "").trim();
  if (plain) {
    return {
      kind: "text",
      fileKey: "",
      nodeId: "",
      url: "",
      bufferBytes: 0,
      note: "Это обычный текст, а не макет. Его можно взять как содержимое письма.",
      text: plain.slice(0, 20000),
    };
  }

  return {
    kind: "empty",
    fileKey: "",
    nodeId: "",
    url: "",
    bufferBytes: buffer.length,
    note: buffer.length
      ? "В буфере что-то из Figma, но ключа файла в нём нет. Скопируйте ссылку на выделение (⌘L)."
      : "В буфере нет ни макета, ни ссылки, ни текста.",
  };
}

/** Собрать адрес, по которому студия заберёт макет. */
export function figmaUrlFor({ fileKey = "", nodeId = "" } = {}) {
  const key = String(fileKey || "").trim();
  if (!key) return "";
  const base = `https://www.figma.com/design/${key}/paste`;
  return nodeId ? `${base}?node-id=${String(nodeId).replace(":", "-")}` : base;
}
