/* eslint-disable no-console */

// Gulp 4 wrapper around the new Node build pipeline.
// Usage examples:
//   gulp build --category X_IQ --mail roll-300126
//   gulp build --category X_IQ --mail roll-300126 --locales en,es

const { series } = require('gulp');
const { spawn } = require('child_process');

function runNodeBuild(cb) {
  // Pass-through flags to build-mail.js.
  // Works for both:
  //   gulp build --category X_IQ --mail roll-300126
  //   gulp --category X_IQ --mail roll-300126
  // because the task name may be omitted.
  const args = process.argv
    .slice(2)
    .filter((a) => a !== 'build' && a !== 'default');
  const child = spawn(process.execPath, ['tools/build-mail.js', ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => {
    if (code === 0) cb();
    else cb(new Error(`build-mail.js failed with code ${code}`));
  });
}


function runNodeServe(cb) {
  const args = process.argv.slice(2).filter((a) => a !== 'serve' && a !== 'default');
  const child = spawn(process.execPath, ['tools/serve-dist.js', '--dist', 'dist', '--port', '3001', ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => {
    if (code === 0) cb();
    else cb(new Error(`serve-dist.js failed with code ${code}`));
  });
}

function runNodeDev(cb) {
  const args = process.argv.slice(2).filter((a) => a !== 'dev' && a !== 'default');
  const child = spawn(process.execPath, ['tools/dev.js', ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => {
    if (code === 0) cb();
    else cb(new Error(`dev.js failed with code ${code}`));
  });
}

exports.build = series(runNodeBuild);
exports.serve = series(runNodeServe);
exports.dev = series(runNodeDev);
exports.default = exports.build;
