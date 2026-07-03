/* eslint-disable no-console */

// Gulp 4 wrapper around the new Node build pipeline.
// Usage examples:
//   gulp build --category X_IQ --mail roll-300126
//   gulp build --category X_IQ --mail roll-300126 --locales en,es

const { series } = require('gulp');
const { spawn } = require('child_process');

function runChild(script, args, cb) {
  const child = spawn(process.execPath, [script, ...args], {
    stdio: 'inherit',
    env: process.env,
  });

  let done = false;
  function finish(err) {
    if (done) return;
    done = true;
    cb(err);
  }

  function forward(signal) {
    if (!child.killed) {
      try { child.kill(signal); } catch {}
    }
  }

  const cleanup = () => {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    process.off('SIGHUP', onSighup);
    process.off('exit', onExit);
  };

  const onSigint = () => forward('SIGINT');
  const onSigterm = () => forward('SIGTERM');
  const onSighup = () => forward('SIGHUP');
  const onExit = () => forward('SIGTERM');

  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  process.once('SIGHUP', onSighup);
  process.once('exit', onExit);

  child.on('exit', (code, signal) => {
    cleanup();
    if (signal) {
      finish();
      return;
    }
    if (code === 0) finish();
    else finish(new Error(`${script} failed with code ${code}`));
  });

  child.on('error', (err) => {
    cleanup();
    finish(err);
  });

  return child;
}

function runNodeBuild(cb) {
  // Pass-through flags to build-mail.js.
  // Works for both:
  //   gulp build --category X_IQ --mail roll-300126
  //   gulp --category X_IQ --mail roll-300126
  // because the task name may be omitted.
  const args = process.argv
    .slice(2)
    .filter((a) => a !== 'build' && a !== 'default');
  runChild('tools/build-mail.js', args, cb);
}


function runNodeServe(cb) {
  const args = process.argv.slice(2).filter((a) => a !== 'serve' && a !== 'default');
  runChild('tools/serve-dist.js', ['--dist', 'dist', '--port', '3001', ...args], cb);
}

function runNodeDev(cb) {
  const args = process.argv.slice(2).filter((a) => a !== 'dev' && a !== 'default');
  runChild('tools/dev.js', args, cb);
}

exports.build = series(runNodeBuild);
exports.serve = series(runNodeServe);
exports.dev = series(runNodeDev);
exports.default = exports.build;
