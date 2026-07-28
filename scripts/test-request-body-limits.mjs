#!/usr/bin/env node
import assert from "node:assert/strict";
import { PassThrough, Readable } from "node:stream";
import {
  RequestBodyTooLargeError,
  configuredJsonBodyLimit,
  isRequestBodyTooLarge,
  readJsonRequestBody,
  requestBodyResponseStatus,
} from "../src/request-body.js";

let pass = 0;
const check = (name, condition) => {
  assert.ok(condition, name);
  pass += 1;
  console.log("  \x1b[32m✓\x1b[0m", name);
};

{
  const request = Readable.from([Buffer.from('{"ok":true}')]);
  request.headers = {};
  const body = await readJsonRequestBody(request, { limitBytes: 64 });
  check("JSON меньше лимита читается без изменений", body.ok === true);
}

{
  const request = Readable.from([]);
  request.headers = {};
  const body = await readJsonRequestBody(request, { limitBytes: 64 });
  check("пустой body совместимо возвращает пустой объект", Object.keys(body).length === 0);
}

{
  const request = new PassThrough();
  request.headers = { "content-length": "65" };
  let error = null;
  try {
    await readJsonRequestBody(request, { limitBytes: 64 });
  } catch (caught) {
    error = caught;
  }
  check("завышенный Content-Length отклоняется до чтения", error instanceof RequestBodyTooLargeError);
  check("ошибка несёт HTTP-статус 413", error?.statusCode === 413);
  check("request помечен для ответа 413 даже внутри route catch", isRequestBodyTooLarge(request));
  check("sendJson получит 413 вместо вложенного 500", requestBodyResponseStatus(request, 500) === 413);
}

{
  const request = new PassThrough();
  request.headers = {};
  const bodyPromise = readJsonRequestBody(request, { limitBytes: 8 });
  request.write(Buffer.alloc(5));
  request.write(Buffer.alloc(5));

  let error = null;
  try {
    await bodyPromise;
  } catch (caught) {
    error = caught;
  }
  request.end(Buffer.alloc(1024));

  check("chunked body останавливается сразу после пересечения лимита", error?.statusCode === 413);
  check("остаток chunked body не добавляется в массив JSON-reader", request.readableFlowing === true);
}

{
  check(
    "лимит можно уменьшить через MAX_JSON_BODY_BYTES для окружения",
    configuredJsonBodyLimit({ MAX_JSON_BODY_BYTES: "1234" }) === 1234
  );
}

console.log(`\nrequest-body-limits: ${pass} ok, 0 fail`);
