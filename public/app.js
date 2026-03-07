const storageKey = "email-studio-demo-state-v3";
const assetPlacements = ["auto", "hero", "logo", "section", "feature", "footer", "background", "reference"];

const initialState = {
  api: {
    openAiConfigured: false,
    model: "gpt-4.1-mini",
    providers: [],
    clientProfiles: [],
    emailBase: null
  },
  busy: false,
  activeTab: "html",
  mode: "mock",
  previewSource: "draft",
  settings: {
    theme: "light",
    providerId: "mock",
    clientProfileId: "standard"
  },
  brief: {
    campaignName: "",
    category: "",
    mailId: "",
    locale: "en",
    audience: "",
    goal: "",
    tone: "",
    primaryCta: "",
    primaryLink: "",
    contentNotes: "",
    designUrl: ""
  },
  translationText: "",
  translationUploadStatus: "",
  design: {
    name: "",
    dataUrl: ""
  },
  assetInputs: [createEmptyAsset(1)],
  messages: [
    {
      role: "assistant",
      content: "Я в живом режиме. Можем обсуждать письмо, потом применять изменения к draft. Design, переводы и картинки лежат в Upload Hub наверху."
    }
  ],
  draft: null,
  settingsOpen: false
};

const state = structuredClone(initialState);

const codeMap = {
  html: "html",
  pug: "pug",
  locales: "locales",
  assets: "assetsManifest",
  spec: "spec",
  buildLog: "buildLog"
};

const refs = {
  apiStatus: document.querySelector("#apiStatus"),
  messages: document.querySelector("#messages"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  fillDemoBtn: document.querySelector("#fillDemoBtn"),
  clearChatBtn: document.querySelector("#clearChatBtn"),
  clearStateBtn: document.querySelector("#clearStateBtn"),
  settingsBtn: document.querySelector("#settingsBtn"),
  closeSettingsBtn: document.querySelector("#closeSettingsBtn"),
  settingsDrawer: document.querySelector("#settingsDrawer"),
  settingsBackdrop: document.querySelector("#settingsBackdrop"),
  loadBaseBtn: document.querySelector("#loadBaseBtn"),
  buildBaseMailBtn: document.querySelector("#buildBaseMailBtn"),
  addAssetBtn: document.querySelector("#addAssetBtn"),
  assetComposerList: document.querySelector("#assetComposerList"),
  subjectValue: document.querySelector("#subjectValue"),
  preheaderValue: document.querySelector("#preheaderValue"),
  localeValue: document.querySelector("#localeValue"),
  modeValue: document.querySelector("#modeValue"),
  sourceValue: document.querySelector("#sourceValue"),
  assistantReply: document.querySelector("#assistantReply"),
  previewFrame: document.querySelector("#previewFrame"),
  codeOutput: document.querySelector("#codeOutput"),
  codeTabs: Array.from(document.querySelectorAll(".tab")),
  assetList: document.querySelector("#assetList"),
  diagnosticsList: document.querySelector("#diagnosticsList"),
  designFile: document.querySelector("#designFile"),
  translationFile: document.querySelector("#translationFile"),
  translationFolderInput: document.querySelector("#translationFolderInput"),
  translationDropZone: document.querySelector("#translationDropZone"),
  translationUploadStatus: document.querySelector("#translationUploadStatus"),
  designPreviewWrap: document.querySelector("#designPreviewWrap"),
  designPreview: document.querySelector("#designPreview"),
  designCaption: document.querySelector("#designCaption"),
  themeSelect: document.querySelector("#themeSelect"),
  providerSelect: document.querySelector("#providerSelect"),
  providerHelp: document.querySelector("#providerHelp"),
  clientProfileSelect: document.querySelector("#clientProfileSelect"),
  clientProfileHelp: document.querySelector("#clientProfileHelp"),
  emailBaseSummary: document.querySelector("#emailBaseSummary"),
  fields: {
    campaignName: document.querySelector("#campaignName"),
    category: document.querySelector("#category"),
    mailId: document.querySelector("#mailId"),
    locale: document.querySelector("#locale"),
    audience: document.querySelector("#audience"),
    goal: document.querySelector("#goal"),
    tone: document.querySelector("#tone"),
    primaryCta: document.querySelector("#primaryCta"),
    primaryLink: document.querySelector("#primaryLink"),
    contentNotes: document.querySelector("#contentNotes"),
    designUrl: document.querySelector("#designUrl"),
    translationText: document.querySelector("#translationText")
  }
};

boot();

function boot() {
  hydrateFromStorage();
  bindEvents();
  applyTheme();
  renderAll();
  loadApiStatus();
}

function createEmptyAsset(index = 1) {
  return {
    id: `asset-${Date.now()}-${index}`,
    key: index === 1 ? "hero_asset" : `asset_${index}`,
    url: "",
    alt: "",
    placement: "auto",
    notes: ""
  };
}

function bindEvents() {
  refs.chatForm.addEventListener("submit", handleChatSubmit);
  refs.fillDemoBtn.addEventListener("click", fillDemoScenario);
  refs.clearChatBtn.addEventListener("click", clearChatHistory);
  refs.clearStateBtn.addEventListener("click", resetState);
  refs.settingsBtn.addEventListener("click", () => toggleSettings(true));
  refs.closeSettingsBtn.addEventListener("click", () => toggleSettings(false));
  refs.settingsBackdrop.addEventListener("click", () => toggleSettings(false));
  refs.loadBaseBtn.addEventListener("click", handleLoadBaseEmail);
  refs.buildBaseMailBtn.addEventListener("click", handleLoadBaseEmail);
  refs.addAssetBtn.addEventListener("click", addAssetRow);

  for (const [key, element] of Object.entries(refs.fields)) {
    element.addEventListener("input", () => {
      if (key === "translationText") {
        state.translationText = element.value;
      } else {
        state.brief[key] = element.value;
      }

      persistState();
    });
  }

  refs.designFile.addEventListener("change", handleDesignUpload);
  refs.translationFile.addEventListener("change", handleTranslationUpload);
  refs.translationFolderInput.addEventListener("change", handleTranslationUpload);
  bindTranslationDropzone();

  refs.themeSelect.addEventListener("change", () => {
    state.settings.theme = refs.themeSelect.value;
    applyTheme();
    persistState();
  });

  refs.providerSelect.addEventListener("change", () => {
    state.settings.providerId = refs.providerSelect.value;
    renderSettingsInfo();
    renderStatus();
    persistState();
  });

  refs.clientProfileSelect.addEventListener("change", () => {
    state.settings.clientProfileId = refs.clientProfileSelect.value;
    renderSettingsInfo();
    renderPreview();
    renderDiagnostics();
    persistState();
  });

  for (const tab of refs.codeTabs) {
    tab.addEventListener("click", () => {
      state.activeTab = tab.dataset.tab;
      renderTabs();
      renderCode();
      persistState();
    });
  }
}

async function loadApiStatus() {
  try {
    const response = await fetch("/api/status");
    const payload = await response.json();
    state.api = payload;

    if (!state.settings.providerId || state.settings.providerId === "mock") {
      state.settings.providerId = payload.openAiConfigured ? "openai" : "mock";
    }

    if (!state.brief.category && payload.emailBase?.currentMail?.category) {
      state.brief.category = payload.emailBase.currentMail.category;
    }

    if (!state.brief.mailId && payload.emailBase?.currentMail?.mailId) {
      state.brief.mailId = payload.emailBase.currentMail.mailId;
    }

    if (!state.brief.locale && payload.emailBase?.locales?.[0]) {
      state.brief.locale = payload.emailBase.locales[0];
    }
  } catch {
    state.api = {
      openAiConfigured: false,
      model: "unavailable",
      providers: [],
      clientProfiles: [],
      emailBase: null
    };
  }

  renderAll();
  persistState();
}

function hydrateFromStorage() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return;
    }

    const saved = JSON.parse(raw);
    const merged = {
      ...structuredClone(initialState),
      ...saved,
      settings: {
        ...structuredClone(initialState.settings),
        ...(saved.settings ?? {})
      },
      brief: {
        ...structuredClone(initialState.brief),
        ...(saved.brief ?? {})
      },
      design: {
        ...structuredClone(initialState.design)
      },
      assetInputs: Array.isArray(saved.assetInputs) && saved.assetInputs.length > 0
        ? saved.assetInputs
        : [createEmptyAsset(1)],
      messages: Array.isArray(saved.messages) && saved.messages.length > 0
        ? saved.messages
        : structuredClone(initialState.messages),
      draft: saved.draft ?? null
    };
    Object.assign(state, merged);
    state.api = { ...initialState.api };
    state.busy = false;
    state.settingsOpen = false;
    state.design = { name: "", dataUrl: "" };
  } catch {
    localStorage.removeItem(storageKey);
  }
}

function persistState() {
  const draft = createPersistableDraft(state.draft);
  const payload = {
    activeTab: state.activeTab,
    mode: state.mode,
    previewSource: state.previewSource,
    settings: state.settings,
    brief: state.brief,
    translationText: state.translationText,
    translationUploadStatus: state.translationUploadStatus,
    assetInputs: state.assetInputs,
    messages: state.messages,
    draft
  };

  try {
    localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        ...payload,
        draft: null
      })
    );
  }
}

function resetState() {
  localStorage.removeItem(storageKey);
  Object.assign(state, structuredClone(initialState));
  refs.designFile.value = "";
  refs.translationFile.value = "";
  refs.translationFolderInput.value = "";
  refs.chatInput.value = "";
  applyTheme();
  renderAll();
  loadApiStatus();
}

function clearChatHistory() {
  state.messages = structuredClone(initialState.messages);
  refs.chatInput.value = "";
  renderMessages();
  renderSummary();
  persistState();
}

function fillDemoScenario() {
  state.brief = {
    campaignName: "Spring comeback offer",
    category: state.api.emailBase?.currentMail?.category || "X_IQ",
    mailId: state.api.emailBase?.currentMail?.mailId || "rfm-311",
    locale: "en",
    audience: "Dormant customers inactive for 90 days",
    goal: "Bring inactive users back with a short-lived free shipping incentive and a strong benefit summary.",
    tone: "Warm, direct, conversion-focused",
    primaryCta: "Reactivate now",
    primaryLink: "https://example.com/reactivate",
    contentNotes: "Free shipping for 72 hours\nUse one clean hero\nMention 3 benefits before the CTA\nKeep footer simple",
    designUrl: ""
  };
  state.assetInputs = [
    {
      id: "asset-demo-1",
      key: "hero_offer",
      url: "https://placehold.co/1200x600/png",
      alt: "Hero offer",
      placement: "hero",
      notes: "Main hero visual"
    },
    {
      id: "asset-demo-2",
      key: "app_screen",
      url: "https://placehold.co/900x500/jpg",
      alt: "App screen",
      placement: "section",
      notes: "Use in body section"
    }
  ];
  state.translationText = JSON.stringify(
    {
      en: {
        subject: "Spring comeback offer",
        preheader: "A short offer for customers we want back",
        notes: "English source copy"
      },
      de: {
        subject: "Fruehlingsangebot zur Rueckkehr",
        preheader: "Ein kurzes Angebot fuer inaktive Kunden",
        notes: "German draft"
      }
    },
    null,
    2
  );
  state.messages = [
    { role: "assistant", content: initialState.messages[0].content },
    {
      role: "user",
      content: "Давай обсудим письмо для возврата спящих клиентов. Hero-картинку поставь в первый экран, body image во вторую секцию."
    }
  ];
  state.draft = null;
  state.previewSource = "draft";
  state.design = { name: "", dataUrl: "" };
  state.translationUploadStatus = "Демо bundle загружен вручную.";
  renderAll();
  persistState();
}

function addAssetRow() {
  state.assetInputs.push(createEmptyAsset(state.assetInputs.length + 1));
  renderAssetComposer();
  persistState();
}

function updateAssetRow(id, patch) {
  state.assetInputs = state.assetInputs.map((asset) => asset.id === id ? { ...asset, ...patch } : asset);
  persistState();
}

function removeAssetRow(id) {
  state.assetInputs = state.assetInputs.filter((asset) => asset.id !== id);
  if (state.assetInputs.length === 0) {
    state.assetInputs = [createEmptyAsset(1)];
  }
  renderAssetComposer();
  persistState();
}

async function handleDesignUpload(event) {
  const file = event.target.files?.[0];
  if (!file) {
    state.design = { name: "", dataUrl: "" };
    renderDesignPreview();
    return;
  }

  const dataUrl = await readFileAsDataUrl(file);
  state.design = {
    name: file.name,
    dataUrl
  };
  renderDesignPreview();
}

async function handleTranslationUpload(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) {
    return;
  }

  await applyTranslationFiles(files, files.length === 1 ? files[0].name : `${files.length} files`);
  event.target.value = "";
}

function bindTranslationDropzone() {
  const zone = refs.translationDropZone;
  const activate = (event) => {
    event.preventDefault();
    zone.classList.add("is-dragover");
  };
  const deactivate = (event) => {
    event.preventDefault();
    if (event.type === "dragleave" && zone.contains(event.relatedTarget)) {
      return;
    }
    zone.classList.remove("is-dragover");
  };

  zone.addEventListener("dragenter", activate);
  zone.addEventListener("dragover", activate);
  zone.addEventListener("dragleave", deactivate);
  zone.addEventListener("drop", async (event) => {
    event.preventDefault();
    zone.classList.remove("is-dragover");
    const files = await extractTranslationFilesFromDrop(event.dataTransfer);
    if (files.length === 0) {
      state.translationUploadStatus = "Не нашел .txt/.json/.md файлов в drop.";
      renderTranslationUploadStatus();
      persistState();
      return;
    }

    await applyTranslationFiles(files, inferDropSourceLabel(files));
  });
}

async function handleChatSubmit(event) {
  event.preventDefault();

  const intent = event.submitter?.dataset.intent || "draft";
  const message = refs.chatInput.value.trim() || (intent === "discuss"
    ? "Давай обсудим текущее письмо."
    : "Обнови текущий драфт по моим данным.");

  state.messages.push({ role: "user", content: message });
  refs.chatInput.value = "";
  state.busy = true;
  renderMessages();
  renderStatus();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        intent,
        messages: state.messages,
        brief: state.brief,
        assetInputs: state.assetInputs,
        translationText: state.translationText,
        design: state.design,
        settings: state.settings,
        currentDraft: state.draft?.mail ?? null
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }

    state.mode = payload.mode;
    if (payload.draft) {
      state.previewSource = "draft";
      state.draft = payload.draft;
    }
    state.messages.push({
      role: "assistant",
      content: payload.assistantReply
    });
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Ошибка при генерации: ${error.message}`
    });
  } finally {
    state.busy = false;
    renderAll();
    persistState();
  }
}

async function handleLoadBaseEmail() {
  state.busy = true;
  renderStatus();

  try {
    const response = await fetch("/api/email-base/build", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        brief: {
          category: state.brief.category,
          mailId: state.brief.mailId,
          locale: state.brief.locale
        }
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Build failed");
    }

    state.mode = payload.mode;
    state.previewSource = "email-base";
    state.draft = payload.draft;
    state.messages.push({
      role: "assistant",
      content: payload.assistantReply
    });
    toggleSettings(false);
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Ошибка при сборке email-base: ${error.message}`
    });
  } finally {
    state.busy = false;
    renderAll();
    persistState();
  }
}

function toggleSettings(isOpen) {
  state.settingsOpen = isOpen;
  renderSettingsDrawer();
}

function renderAll() {
  applyTheme();
  renderFields();
  renderTranslationUploadStatus();
  renderAssetComposer();
  renderMessages();
  renderStatus();
  renderSummary();
  renderSettingsControls();
  renderSettingsInfo();
  renderSettingsDrawer();
  renderPreview();
  renderTabs();
  renderCode();
  renderAssets();
  renderDiagnostics();
  renderDesignPreview();
}

function renderFields() {
  refs.fields.campaignName.value = state.brief.campaignName;
  refs.fields.category.value = state.brief.category;
  refs.fields.mailId.value = state.brief.mailId;
  refs.fields.locale.value = state.brief.locale;
  refs.fields.audience.value = state.brief.audience;
  refs.fields.goal.value = state.brief.goal;
  refs.fields.tone.value = state.brief.tone;
  refs.fields.primaryCta.value = state.brief.primaryCta;
  refs.fields.primaryLink.value = state.brief.primaryLink;
  refs.fields.contentNotes.value = state.brief.contentNotes;
  refs.fields.designUrl.value = state.brief.designUrl;
  refs.fields.translationText.value = state.translationText;
}

function renderTranslationUploadStatus() {
  refs.translationUploadStatus.textContent = state.translationUploadStatus
    || "Можно выбрать файлы, выбрать папку или перетащить их прямо в этот блок.";
}

function renderAssetComposer() {
  refs.assetComposerList.innerHTML = "";

  for (const [index, asset] of state.assetInputs.entries()) {
    const row = document.createElement("div");
    row.className = "asset-row";
    const suggestion = inferAssetSuggestion(asset, index);

    const grid = document.createElement("div");
    grid.className = "asset-row-grid";

    const urlField = createAssetField("Image URL", "url", asset.url, asset.id);
    const keyField = createAssetField("Key", "key", asset.key, asset.id);
    const placementField = createAssetPlacementField(asset);

    grid.append(urlField, keyField, placementField);

    const meta = document.createElement("div");
    meta.className = "asset-row-actions";

    const noteField = document.createElement("label");
    noteField.className = "field";
    noteField.innerHTML = `<span>Description / usage</span>`;
    const noteInput = document.createElement("input");
    noteInput.type = "text";
    noteInput.value = asset.notes;
    noteInput.placeholder = "Например: hero banner for first screen / app screenshot for body";
    noteInput.addEventListener("input", () => updateAssetRow(asset.id, { notes: noteInput.value }));
    noteInput.addEventListener("change", renderAssetComposer);
    noteField.appendChild(noteInput);

    const controls = document.createElement("div");
    controls.className = "asset-row-controls";

    const applyAutoBtn = document.createElement("button");
    applyAutoBtn.type = "button";
    applyAutoBtn.className = "ghost-button";
    applyAutoBtn.textContent = "Применить auto";
    applyAutoBtn.addEventListener("click", () => {
      const nextKey = shouldReplaceAssetKey(asset.key)
        ? suggestion.key
        : asset.key;
      updateAssetRow(asset.id, {
        placement: suggestion.placement,
        key: nextKey
      });
      renderAssetComposer();
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "ghost-button";
    removeBtn.textContent = "Удалить";
    removeBtn.addEventListener("click", () => removeAssetRow(asset.id));

    controls.append(applyAutoBtn, removeBtn);
    meta.append(noteField, controls);

    const hint = document.createElement("div");
    hint.className = "asset-suggestion";
    hint.textContent = cleanText(asset.placement) === "auto"
      ? `Auto сейчас выберет ${suggestion.placement}. ${suggestion.reason}. Suggested key: ${suggestion.key}.`
      : `Сейчас задано ${asset.placement}. Auto бы выбрал ${suggestion.placement}. Suggested key: ${suggestion.key}.`;

    row.append(grid, meta, hint);
    refs.assetComposerList.appendChild(row);
  }
}

function createAssetField(labelText, field, value, assetId) {
  const label = document.createElement("label");
  label.className = "field";
  label.innerHTML = `<span>${labelText}</span>`;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.addEventListener("input", () => updateAssetRow(assetId, { [field]: input.value }));
  input.addEventListener("change", renderAssetComposer);
  label.appendChild(input);
  return label;
}

function createAssetPlacementField(asset) {
  const label = document.createElement("label");
  label.className = "field";
  label.innerHTML = `<span>Placement</span>`;
  const select = document.createElement("select");
  select.className = "select-control";
  select.innerHTML = assetPlacements
    .map((placement) => `<option value="${placement}">${placement === "auto" ? "auto (guess from notes)" : placement}</option>`)
    .join("");
  select.value = asset.placement;
  select.addEventListener("change", () => {
    updateAssetRow(asset.id, { placement: select.value });
    renderAssetComposer();
  });
  label.appendChild(select);
  return label;
}

function renderMessages() {
  refs.messages.innerHTML = "";

  for (const message of state.messages) {
    const element = document.createElement("div");
    element.className = `message ${message.role}`;
    element.textContent = message.content;
    refs.messages.appendChild(element);
  }

  refs.messages.scrollTop = refs.messages.scrollHeight;
}

function renderStatus() {
  const providerLabel = getSelectedProvider()?.label || state.settings.providerId;
  const statusText = state.busy
    ? "Генерирую..."
    : `${providerLabel}: ${state.api.openAiConfigured ? state.api.model : "demo mode available"}`;

  refs.apiStatus.textContent = statusText;
  refs.modeValue.textContent = state.mode;
}

function renderSummary() {
  const mail = state.draft?.mail;
  refs.subjectValue.textContent = mail?.subject || "Пока пусто";
  refs.preheaderValue.textContent = mail?.preheader || "Сгенерируйте первый драфт";
  refs.localeValue.textContent = mail?.locale || state.brief.locale || "-";
  refs.sourceValue.textContent = state.previewSource;
  refs.assistantReply.textContent = state.messages.at(-1)?.role === "assistant"
    ? state.messages.at(-1).content
    : "Здесь появится краткое резюме от ассистента.";
}

function renderPreview() {
  const baseHtml = state.draft?.html || emptyPreview();
  const simulated = simulatePreviewHtml(baseHtml, state.settings.clientProfileId);
  refs.previewFrame.srcdoc = simulated;
}

function renderTabs() {
  for (const tab of refs.codeTabs) {
    tab.classList.toggle("is-active", tab.dataset.tab === state.activeTab);
  }
}

function renderCode() {
  const selectedKey = codeMap[state.activeTab];
  refs.codeOutput.textContent = state.draft?.[selectedKey] || "Код появится после первого draft или build.";
}

function renderAssets() {
  refs.assetList.innerHTML = "";

  const assets = state.draft?.mail?.assets ?? [];
  if (assets.length === 0) {
    refs.assetList.appendChild(createTextCard("Пока нет asset-ов в текущем preview."));
    return;
  }

  for (const asset of assets) {
    const item = document.createElement("div");
    item.className = "asset-item";

    const key = document.createElement("strong");
    key.textContent = `${asset.key} (${asset.placement || "section"})`;

    const meta = document.createElement("div");
    meta.textContent = `${asset.width}x${asset.height} | ${asset.alt || "No alt"} | ${asset.notes || "No notes"}`;

    const link = document.createElement("a");
    link.href = asset.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = asset.url.startsWith("data:")
      ? `${asset.alt || asset.key} (uploaded image)`
      : asset.url;

    item.append(key, meta, link);
    refs.assetList.appendChild(item);
  }
}

function renderDiagnostics() {
  refs.diagnosticsList.innerHTML = "";
  const items = getDiagnostics();

  for (const item of items) {
    const card = document.createElement("div");
    card.className = `diagnostic-item ${item.level}`;

    const title = document.createElement("strong");
    title.textContent = item.title;

    const body = document.createElement("div");
    body.textContent = item.body;

    card.append(title, body);
    refs.diagnosticsList.appendChild(card);
  }
}

function renderDesignPreview() {
  const hasDesign = Boolean(state.design.dataUrl);
  refs.designPreviewWrap.hidden = !hasDesign;

  if (!hasDesign) {
    return;
  }

  refs.designPreview.src = state.design.dataUrl;
  refs.designCaption.textContent = `${state.design.name} загружен только в текущую сессию браузера.`;
}

function renderSettingsControls() {
  refs.themeSelect.value = state.settings.theme;

  refs.providerSelect.innerHTML = state.api.providers.length > 0
    ? state.api.providers.map((provider) => `<option value="${provider.id}">${provider.label}</option>`).join("")
    : `<option value="${state.settings.providerId}">${state.settings.providerId}</option>`;
  refs.providerSelect.value = state.settings.providerId;

  refs.clientProfileSelect.innerHTML = (state.api.clientProfiles.length > 0
    ? state.api.clientProfiles
    : [{ id: "standard", label: "Standard preview" }])
    .map((profile) => `<option value="${profile.id}">${profile.label}</option>`)
    .join("");
  refs.clientProfileSelect.value = state.settings.clientProfileId;
}

function renderSettingsInfo() {
  const provider = getSelectedProvider();
  refs.providerHelp.textContent = provider
    ? `${provider.status}. Возможности: ${provider.capabilities.join(", ")}.`
    : "Провайдер пока не определен.";

  const profile = getSelectedClientProfile();
  refs.clientProfileHelp.textContent = profile
    ? profile.description
    : "Выберите профиль клиента для heuristic preview.";

  const emailBase = state.api.emailBase;
  refs.emailBaseSummary.textContent = emailBase?.available
    ? `Root: ${emailBase.root}. Current: ${emailBase.currentMail?.folder || "none"}. Locales: ${emailBase.localeCount}.`
    : "email-base пока не подключена.";
}

function renderSettingsDrawer() {
  refs.settingsBackdrop.hidden = !state.settingsOpen;
  refs.settingsDrawer.classList.toggle("is-open", state.settingsOpen);
  refs.settingsDrawer.setAttribute("aria-hidden", String(!state.settingsOpen));
}

function getSelectedProvider() {
  return state.api.providers.find((provider) => provider.id === state.settings.providerId);
}

function getSelectedClientProfile() {
  return state.api.clientProfiles.find((profile) => profile.id === state.settings.clientProfileId)
    || { id: "standard", label: "Standard preview", description: "Базовый browser preview без симуляции клиента." };
}

function getDiagnostics() {
  if (!state.draft?.html) {
    return [
      {
        level: "ok",
        title: "Preview is empty",
        body: "Сначала загрузи материалы в Upload Hub и либо обсуди письмо, либо обнови драфт."
      }
    ];
  }

  const items = [];
  const html = state.draft.html;
  const buildLog = state.draft.buildLog || "";
  const profileId = state.settings.clientProfileId;
  const mappedAssets = state.assetInputs.filter((asset, index) => asset.url && resolveAssetPlacement(asset, index)).length;
  const autoAssets = state.assetInputs.filter((asset) => asset.url && cleanText(asset.placement) === "auto").length;

  if (state.previewSource === "draft") {
    items.push({
      level: "warning",
      title: "Concept preview",
      body: "Текущий preview рендерится студией для быстрой оценки. Production HTML должен идти через email-base build."
    });
  } else {
    items.push({
      level: "ok",
      title: "Real build loaded",
      body: "Preview построен реальным email-base pipeline."
    });
  }

  if (mappedAssets === 0) {
    items.push({
      level: "warning",
      title: "No image mapping",
      body: "Картинки не размечены по ролям. Лучше назначить хотя бы hero или section, чтобы студия понимала, куда их ставить."
    });
  } else {
    items.push({
      level: "ok",
      title: "Image mapping present",
      body: `Размечено ${mappedAssets} asset(s). Студия видит, какие картинки hero, section или logo.`
    });
  }

  if (autoAssets > 0) {
    items.push({
      level: "ok",
      title: "Auto asset mapping enabled",
      body: `Для ${autoAssets} картинок placement будет выбран автоматически по описанию, key и URL.`
    });
  }

  if (/linear-gradient/i.test(html) && profileId === "outlook-desktop") {
    items.push({
      level: "warning",
      title: "Outlook gradient fallback",
      body: "Outlook Desktop часто ломает сложные background gradients. Нужен VML или более простой fallback."
    });
  }

  if (/border-radius/i.test(html) && profileId === "outlook-desktop") {
    items.push({
      level: "warning",
      title: "Outlook corners",
      body: "Border radius в Word-based Outlook может отображаться не так, как в browser preview."
    });
  }

  if (/box-shadow/i.test(html) && (profileId === "outlook-desktop" || profileId === "gmail-web")) {
    items.push({
      level: "warning",
      title: "Shadow support",
      body: "Тени ненадежны в старых desktop/webmail-средах."
    });
  }

  if (/unresolved placeholder/i.test(buildLog)) {
    items.push({
      level: "warning",
      title: "Missing locale keys",
      body: "В реальном build есть unresolved placeholders. Значит, локали для письма пока неполны."
    });
  }

  return items;
}

function simulatePreviewHtml(html, profileId) {
  if (!html) {
    return emptyPreview();
  }

  let transformed = html;
  let banner = "";

  if (profileId === "gmail-web") {
    transformed = transformed
      .replace(/box-shadow:[^;]+;?/gi, "")
      .replace(/linear-gradient\([^)]+\)/gi, "#365b38");
    banner = createClientBanner("Gmail Web heuristic preview");
  }

  if (profileId === "outlook-desktop") {
    transformed = transformed
      .replace(/border-radius:[^;]+;?/gi, "")
      .replace(/box-shadow:[^;]+;?/gi, "")
      .replace(/linear-gradient\([^)]+\)/gi, "#365b38");
    banner = createClientBanner("Outlook Desktop heuristic preview");
  }

  if (profileId === "yahoo-mail") {
    transformed = transformed
      .replace(/box-shadow:[^;]+;?/gi, "")
      .replace(/font-family:[^;]+;?/gi, "font-family: Arial, sans-serif;");
    banner = createClientBanner("Yahoo Mail heuristic preview");
  }

  if (profileId === "apple-mail") {
    banner = createClientBanner("Apple Mail preview bias");
  }

  return banner
    ? transformed.replace(/<body([^>]*)>/i, `<body$1>${banner}`)
    : transformed;
}

function createClientBanner(title) {
  return `
    <div style="padding: 10px 12px; background: #13231a; color: #f7f3ea; font-family: Arial, sans-serif; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; text-align: center;">
      ${title}
    </div>
  `;
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
}

function createPersistableDraft(draft) {
  if (!draft) {
    return null;
  }

  const serialized = JSON.stringify(draft);
  if (serialized.length > 900000 || serialized.includes("\"url\":\"data:image")) {
    return null;
  }

  return draft;
}

function createTextCard(text) {
  const node = document.createElement("div");
  node.className = "asset-item";
  node.textContent = text;
  return node;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "asset";
}

function extractNameFromUrl(url) {
  const raw = cleanText(url);
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw);
    const fileName = parsed.pathname.split("/").pop() || "";
    return fileName.replace(/\.[a-z0-9]+$/i, "");
  } catch {
    return raw.split("/").pop()?.replace(/\.[a-z0-9]+$/i, "") || "";
  }
}

function shouldReplaceAssetKey(key) {
  const normalized = cleanText(key);
  return !normalized || /^asset[_-]?\d+$/i.test(normalized) || normalized === "hero_asset";
}

function inferAssetSuggestion(asset, index = 0) {
  const signal = [
    asset.notes,
    asset.key,
    asset.alt,
    extractNameFromUrl(asset.url)
  ].map(cleanText).join(" ").toLowerCase();

  let placement = index === 0 ? "hero" : "section";
  let reason = index === 0
    ? "Первая картинка без явных подсказок идет в hero."
    : "Без явных подсказок картинка идет в обычную секцию.";

  if (/(logo|brand|brandmark|wordmark|icon)/i.test(signal)) {
    placement = "logo";
    reason = "В описании есть сигналы logo/brand/icon.";
  } else if (/(footer|legal|social|unsubscribe)/i.test(signal)) {
    placement = "footer";
    reason = "В описании есть сигналы footer/legal/social.";
  } else if (/(background|bg|texture|pattern|wallpaper)/i.test(signal)) {
    placement = "background";
    reason = "В описании есть сигналы background/bg/pattern.";
  } else if (/(hero|banner|cover|header|masthead|first screen|above the fold|main visual)/i.test(signal)) {
    placement = "hero";
    reason = "В описании есть сигналы hero/banner/header.";
  } else if (/(feature|benefit|card|tile|product shot)/i.test(signal)) {
    placement = "feature";
    reason = "В описании есть сигналы feature/card/benefit.";
  } else if (/(section|body|content|phone|screen|screenshot|app|device)/i.test(signal)) {
    placement = "section";
    reason = "В описании есть сигналы section/body/screenshot/app.";
  } else if (/(reference|design|figma|wireframe|mockup|layout)/i.test(signal)) {
    placement = "reference";
    reason = "Похоже на reference asset, а не на production image.";
  }

  const sourceName = cleanText(asset.notes) || cleanText(asset.alt) || extractNameFromUrl(asset.url);
  const key = shouldReplaceAssetKey(asset.key)
    ? placement === "hero" && index === 0
      ? "hero_asset"
      : `${placement}_${slugify(sourceName || `${placement}-${index + 1}`)}`
    : cleanText(asset.key);

  return { placement, reason, key };
}

function resolveAssetPlacement(asset, index = 0) {
  const explicit = cleanText(asset.placement);
  if (explicit && explicit !== "auto") {
    return explicit;
  }

  return inferAssetSuggestion(asset, index).placement;
}

function emptyPreview() {
  return `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: linear-gradient(180deg, #ecf2e7 0%, #f8f2e9 100%);
        color: #1c3024;
        font-family: "Avenir Next", "Segoe UI", sans-serif;
      }

      .placeholder {
        max-width: 460px;
        padding: 24px 28px;
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.84);
        box-shadow: 0 20px 60px rgba(28, 48, 36, 0.12);
        text-align: center;
        line-height: 1.6;
      }

      strong {
        display: block;
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <div class="placeholder">
      <strong>Email Studio</strong>
      Сначала положи материалы в Upload Hub, затем обсуди письмо или обнови драфт.
    </div>
  </body>
</html>`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read text file"));
    reader.readAsText(file);
  });
}

async function combineTranslationFiles(files) {
  if (files.length === 1 && /\.json$/i.test(files[0].name)) {
    return readFileAsText(files[0]);
  }

  const chunks = [];
  for (const file of files) {
    const content = await readFileAsText(file);
    const displayName = file.webkitRelativePath || file.name;
    chunks.push(`=== FILE: ${displayName} ===\n${content.trim()}`);
  }

  return chunks.join("\n\n");
}

async function applyTranslationFiles(files, sourceLabel = "") {
  const supported = filterTranslationFiles(files);
  if (supported.length === 0) {
    state.translationUploadStatus = "Не найдено поддерживаемых translation files.";
    renderTranslationUploadStatus();
    persistState();
    return;
  }

  state.translationText = await combineTranslationFiles(supported);
  state.translationUploadStatus = sourceLabel
    ? `Загружено ${supported.length} translation file(s) из ${sourceLabel}.`
    : `Загружено ${supported.length} translation file(s).`;
  refs.fields.translationText.value = state.translationText;
  renderTranslationUploadStatus();
  persistState();
}

function filterTranslationFiles(files) {
  return files.filter((file) => /\.(json|txt|md)$/i.test(file.name));
}

function inferDropSourceLabel(files) {
  const paths = files
    .map((file) => cleanText(file.webkitRelativePath))
    .filter(Boolean);

  if (paths.length > 0) {
    const root = paths[0].split("/")[0];
    return root || "drag-and-drop folder";
  }

  return files.length === 1 ? files[0].name : "drag-and-drop";
}

async function extractTranslationFilesFromDrop(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);
  if (items.length > 0 && items.some((item) => typeof item.webkitGetAsEntry === "function")) {
    const groups = await Promise.all(items.map(async (item) => {
      const entry = item.webkitGetAsEntry?.();
      return entry ? collectFilesFromEntry(entry) : [];
    }));
    const droppedFiles = groups.flat();
    if (droppedFiles.length > 0) {
      return filterTranslationFiles(droppedFiles);
    }
  }

  return filterTranslationFiles(Array.from(dataTransfer?.files || []));
}

async function collectFilesFromEntry(entry) {
  if (!entry) {
    return [];
  }

  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file((file) => resolve([file]), () => resolve([]));
    });
  }

  if (!entry.isDirectory) {
    return [];
  }

  const reader = entry.createReader();
  const entries = await readDirectoryEntries(reader);
  const groups = await Promise.all(entries.map((child) => collectFilesFromEntry(child)));
  return groups.flat();
}

function readDirectoryEntries(reader) {
  return new Promise((resolve) => {
    const entries = [];
    const readChunk = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(entries);
          return;
        }

        entries.push(...batch);
        readChunk();
      }, () => resolve(entries));
    };

    readChunk();
  });
}
