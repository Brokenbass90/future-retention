const MEBIBYTE = 1024 * 1024;

/**
 * Четыре прикреплённых к чату изображения (до 4 MiB каждое, до 12 MiB
 * суммарно) после base64 занимают примерно 16 MiB. Остаток лимита оставлен
 * для HTML, дерева конструктора и истории разговора.
 */
export const DEFAULT_JSON_BODY_LIMIT_BYTES = 20 * MEBIBYTE;

export const REQUEST_BODY_LIMIT_EXCEEDED = Symbol("requestBodyLimitExceeded");

function formatByteLimit(bytes) {
  if (bytes >= MEBIBYTE) {
    return `${Number((bytes / MEBIBYTE).toFixed(1))} MiB`;
  }
  if (bytes >= 1024) {
    return `${Number((bytes / 1024).toFixed(1))} KiB`;
  }
  return `${bytes} bytes`;
}

function normalizeLimit(value, fallback = DEFAULT_JSON_BODY_LIMIT_BYTES) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export class RequestBodyTooLargeError extends Error {
  constructor(limitBytes) {
    super(`Request body exceeds the ${formatByteLimit(limitBytes)} limit`);
    this.name = "RequestBodyTooLargeError";
    this.code = "REQUEST_BODY_TOO_LARGE";
    this.statusCode = 413;
    this.limitBytes = limitBytes;
  }
}

export function configuredJsonBodyLimit(env = process.env) {
  return normalizeLimit(env?.MAX_JSON_BODY_BYTES);
}

export function isRequestBodyTooLarge(request) {
  return Boolean(request?.[REQUEST_BODY_LIMIT_EXCEEDED]);
}

export function requestBodyResponseStatus(request, fallbackStatusCode) {
  return isRequestBodyTooLarge(request) ? 413 : fallbackStatusCode;
}

function markTooLarge(request, limitBytes) {
  request[REQUEST_BODY_LIMIT_EXCEEDED] = {
    limitBytes,
    at: Date.now(),
  };
}

function drainWithoutBuffering(request) {
  // Клиент может оборвать oversized upload сразу после получения 413. Пока
  // соединение закрывается, не оставляем error event без слушателя.
  const ignoreDrainError = () => {};
  const cleanup = () => {
    request.removeListener("error", ignoreDrainError);
    request.removeListener("end", cleanup);
    request.removeListener("close", cleanup);
  };
  request.on("error", ignoreDrainError);
  request.once("end", cleanup);
  request.once("close", cleanup);
  request.resume?.();
}

/**
 * Читает один JSON body с жёстким лимитом памяти.
 *
 * При превышении лимита promise отклоняется сразу. Остаток входящего потока
 * переводится в flowing mode без накопления chunks; HTTP-слой в server.js
 * отвечает 413 и закрывает keep-alive соединение.
 */
export function readJsonRequestBody(request, options = {}) {
  const limitBytes = normalizeLimit(options.limitBytes, configuredJsonBodyLimit(options.env));
  const declaredLength = Number(request?.headers?.["content-length"]);

  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    markTooLarge(request, limitBytes);
    drainWithoutBuffering(request);
    return Promise.reject(new RequestBodyTooLargeError(limitBytes));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let byteLength = 0;
    let settled = false;

    const cleanup = () => {
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
      request.removeListener("aborted", onAborted);
    };

    const fail = (error, { drain = false } = {}) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (drain) drainWithoutBuffering(request);
      reject(error);
    };

    const onData = (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.length;
      if (byteLength > limitBytes) {
        markTooLarge(request, limitBytes);
        fail(new RequestBodyTooLargeError(limitBytes), { drain: true });
        return;
      }
      chunks.push(buffer);
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks, byteLength).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    };

    const onError = (error) => fail(error);
    const onAborted = () => {
      const error = new Error("Request body was aborted");
      error.code = "REQUEST_ABORTED";
      fail(error);
    };

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("aborted", onAborted);
  });
}
