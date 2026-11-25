// Catches the class of bug that broke the Workbench agent ('ctx is not
// defined') and three email-base endpoints ('readJsonBody'): references to
// variables that do not exist. Only this one rule — no style policing.
const node = {
  process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', setImmediate: 'readonly',
  fetch: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
  structuredClone: 'readonly', globalThis: 'readonly', queueMicrotask: 'readonly', performance: 'readonly',
  Response: 'readonly', Request: 'readonly', Headers: 'readonly', Blob: 'readonly', FormData: 'readonly', crypto: 'readonly',
  atob: 'readonly', btoa: 'readonly', Intl: 'readonly',
};
const browser = {
  ...node, window: 'readonly', document: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly', navigator: 'readonly',
  location: 'readonly', history: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
  getComputedStyle: 'readonly', getSelection: 'readonly', matchMedia: 'readonly', alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
  open: 'readonly', screen: 'readonly', innerWidth: 'readonly', innerHeight: 'readonly', devicePixelRatio: 'readonly', scrollTo: 'readonly', self: 'readonly',
  DOMParser: 'readonly', XMLSerializer: 'readonly', FileReader: 'readonly', File: 'readonly', Image: 'readonly', CSS: 'readonly',
  MutationObserver: 'readonly', ResizeObserver: 'readonly', IntersectionObserver: 'readonly', Node: 'readonly', NodeFilter: 'readonly',
  Event: 'readonly', CustomEvent: 'readonly', KeyboardEvent: 'readonly', MouseEvent: 'readonly', HTMLElement: 'readonly', Element: 'readonly',
  Text: 'readonly', Comment: 'readonly', DocumentFragment: 'readonly', HTMLIFrameElement: 'readonly', ShadowRoot: 'readonly', Range: 'readonly', Selection: 'readonly',
  ClipboardItem: 'readonly', DataTransfer: 'readonly', WebSocket: 'readonly', EventSource: 'readonly',
  CodeMirror: 'readonly', html_beautify: 'readonly', JSZip: 'readonly', html2pdf: 'readonly', monaco: 'readonly',
  // Globals shared between the studio's classic browser scripts
  StudioChat: 'readonly', refreshAssetPanel: 'readonly', module: 'readonly', require: 'readonly',
};
export default [
  { files: ['server.js', 'src/**/*.js', 'mcp/**/*.mjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: node }, rules: { 'no-undef': 'error' } },
  { files: ['src/shot.js'], languageOptions: { globals: { document: 'readonly' } } },
  { files: ['public/**/*.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: browser }, rules: { 'no-undef': 'error' } },
];
