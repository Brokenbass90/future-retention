#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(repoRoot, "public", "studio-chat.js"), "utf8");

let fileReads = 0;
class FakeFileReader {
  readAsDataURL(file) {
    fileReads += 1;
    this.result = `data:${file.type || "image/png"};base64,AA==`;
    queueMicrotask(() => this.onload?.());
  }
}

const sandbox = {
  window: {},
  document: {},
  console,
  TextEncoder,
  FileReader: FakeFileReader,
  setTimeout,
  clearTimeout,
  queueMicrotask,
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const StudioChat = sandbox.window.StudioChat;
assert.equal(typeof StudioChat, "function", "StudioChat должен экспортироваться в window");

let pass = 0;
const check = (name, condition) => {
  assert.ok(condition, name);
  pass += 1;
  console.log("  \x1b[32m✓\x1b[0m", name);
};
const makeChat = () => {
  const chat = new StudioChat({ surface: "constructor", buildContext: () => ({}) });
  chat._errors = [];
  chat.attachmentError = (message) => chat._errors.push(message);
  return chat;
};
const image = (name, size) => ({ name, size, type: "image/png" });
const MiB = 1024 * 1024;

{
  const chat = makeChat();
  await chat.addImages([
    image("1.png", 10),
    image("2.png", 10),
    image("3.png", 10),
    image("4.png", 10),
    image("5.png", 10),
  ]);
  check("в очередь попадают максимум четыре изображения", chat.images.length === 4);
  check("о превышении количества сообщается до отправки", chat._errors.some((text) => /не больше 4/.test(text)));
}

{
  const chat = makeChat();
  const readsBefore = fileReads;
  await chat.addImages([image("huge.png", 4 * MiB + 1)]);
  check("файл больше 4 МБ не читается в память", fileReads === readsBefore);
  check("файл больше 4 МБ не прикрепляется", chat.images.length === 0);
  check("ошибка содержит понятный индивидуальный лимит", chat._errors.some((text) => /больше 4 МБ/.test(text)));
}

{
  const chat = makeChat();
  await chat.addImages([
    image("a.png", 4 * MiB),
    image("b.png", 4 * MiB),
    image("c.png", 4 * MiB),
  ]);
  await chat.addImages([image("overflow.png", 1)]);
  check("ровно 12 МБ принимаются", chat.images.length === 3);
  check("превышение общего лимита отклоняется", chat._errors.some((text) => /общий лимит.*12 МБ/.test(text)));
}

{
  const chat = makeChat();
  chat.input = { value: "проверь письмо", focus() {} };
  chat.images = Array.from({ length: 5 }, (_, index) => ({
    name: `${index}.png`,
    dataUrl: "data:image/png;base64,AA==",
    bytes: 1,
  }));
  let fetchCalls = 0;
  sandbox.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch не должен вызываться");
  };
  await chat.send();
  check("повторная проверка перед fetch блокирует лишнее вложение", fetchCalls === 0);
  check("пользователь видит причину блокировки отправки", chat._errors.some((text) => /не больше 4/.test(text)));
}

console.log(`\nstudio-chat-attachments: ${pass} ok, 0 fail`);
