#!/usr/bin/env node
// Runs before `npm start`: the studio needs Node 22.5+ (built-in node:sqlite).
// Prints a clear fix instead of ERR_UNKNOWN_BUILTIN_MODULE.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major > 22 || (major === 22 && minor >= 5)) process.exit(0);
console.error(`
✖ Студии нужен Node 22.5 или новее, а сейчас запущен ${process.version} (${process.execPath}).

  Как починить (один раз):
    nvm install 22
    nvm alias default 22
  Затем откройте новое окно терминала и снова: npm start

  Без nvm: поставьте Node 22 LTS с https://nodejs.org
`);
process.exit(1);
