const storageKey = "email-studio-demo-state-v4";
const assetPlacements = ["auto", "hero", "logo", "section", "feature", "footer", "background", "reference"];

const initialState = {
  api: {
    openAiConfigured: false,
    model: "gpt-4.1-mini",
    config: null,
    providers: [],
    clientProfiles: [],
    emailBase: null
  },
  busy: false,
  activeTab: "html",
  mode: "mock",
  previewSource: "draft",
  previewViewport: "fit",
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
    requestedLocales: "",
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
  designAnalysis: null,
  assetInputs: [createEmptyAsset(1)],
  messages: [
    {
      role: "assistant",
      content: "Чат подключен к студии. Если на сервере нет OPENAI_API_KEY, сейчас работает mock-режим: он помогает со структурой и workflow, но не заменяет живую нейросеть."
    }
  ],
  draft: null,
  settingsOpen: false,
  workspaceModal: "",
  localeEditorDocs: [],
  activeLocaleDoc: "",
  codeEditorBuffer: "",
  blockCatalog: {
    generatedAt: "",
    items: [],
    summary: null
  },
  assetRegistry: {
    items: [],
    summary: null
  },
  journal: {
    entries: [],
    summary: null
  }
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
  aiModePill: document.querySelector("#aiModePill"),
  chatCard: document.querySelector("#chatCard"),
  messages: document.querySelector("#messages"),
  chatForm: document.querySelector("#chatForm"),
  chatSubmitButtons: Array.from(document.querySelectorAll("#chatForm button[type='submit']")),
  chatInput: document.querySelector("#chatInput"),
  fillDemoBtn: document.querySelector("#fillDemoBtn"),
  clearChatBtn: document.querySelector("#clearChatBtn"),
  clearStateBtn: document.querySelector("#clearStateBtn"),
  settingsBtn: document.querySelector("#settingsBtn"),
  closeSettingsBtn: document.querySelector("#closeSettingsBtn"),
  settingsDrawer: document.querySelector("#settingsDrawer"),
  settingsBackdrop: document.querySelector("#settingsBackdrop"),
  workspaceModalBackdrop: document.querySelector("#workspaceModalBackdrop"),
  loadBaseBtn: document.querySelector("#loadBaseBtn"),
  createBaseMailBtn: document.querySelector("#createBaseMailBtn"),
  buildBaseMailBtn: document.querySelector("#buildBaseMailBtn"),
  addAssetBtn: document.querySelector("#addAssetBtn"),
  attachDesignBtn: document.querySelector("#attachDesignBtn"),
  attachTranslationsBtn: document.querySelector("#attachTranslationsBtn"),
  attachTranslationFolderBtn: document.querySelector("#attachTranslationFolderBtn"),
  attachAssetsBtn: document.querySelector("#attachAssetsBtn"),
  replaceDesignBtn: document.querySelector("#replaceDesignBtn"),
  analyzeDesignBtn: document.querySelector("#analyzeDesignBtn"),
  replaceAssetsBtn: document.querySelector("#replaceAssetsBtn"),
  assetFileInput: document.querySelector("#assetFileInput"),
  openLocalesBtn: document.querySelector("#openLocalesBtn"),
  openAssetsBtn: document.querySelector("#openAssetsBtn"),
  openBlocksBtn: document.querySelector("#openBlocksBtn"),
  openCodeBtn: document.querySelector("#openCodeBtn"),
  openLocalesQuickBtn: document.querySelector("#openLocalesQuickBtn"),
  openAssetsQuickBtn: document.querySelector("#openAssetsQuickBtn"),
  openCodeQuickBtn: document.querySelector("#openCodeQuickBtn"),
  openTestsBtn: document.querySelector("#openTestsBtn"),
  openTestsQuickBtn: document.querySelector("#openTestsQuickBtn"),
  openJournalBtn: document.querySelector("#openJournalBtn"),
  openJournalFromSettingsBtn: document.querySelector("#openJournalFromSettingsBtn"),
  designBadge: document.querySelector("#designBadge"),
  translationBadge: document.querySelector("#translationBadge"),
  localesModal: document.querySelector("#localesModal"),
  assetsModal: document.querySelector("#assetsModal"),
  codeModal: document.querySelector("#codeModal"),
  journalModal: document.querySelector("#journalModal"),
  testsModal: document.querySelector("#testsModal"),
  closeLocalesModalBtn: document.querySelector("#closeLocalesModalBtn"),
  closeLocalesFooterBtn: document.querySelector("#closeLocalesFooterBtn"),
  closeAssetsModalBtn: document.querySelector("#closeAssetsModalBtn"),
  closeCodeModalBtn: document.querySelector("#closeCodeModalBtn"),
  closeCodeFooterBtn: document.querySelector("#closeCodeFooterBtn"),
  closeJournalModalBtn: document.querySelector("#closeJournalModalBtn"),
  closeJournalFooterBtn: document.querySelector("#closeJournalFooterBtn"),
  closeTestsModalBtn: document.querySelector("#closeTestsModalBtn"),
  closeTestsFooterBtn: document.querySelector("#closeTestsFooterBtn"),
  saveLocaleEditsBtn: document.querySelector("#saveLocaleEditsBtn"),
  saveCodeBtn: document.querySelector("#saveCodeBtn"),
  createBaseMailFromCodeBtn: document.querySelector("#createBaseMailFromCodeBtn"),
  localeTabs: document.querySelector("#localeTabs"),
  localeEditor: document.querySelector("#localeEditor"),
  localeEditorMeta: document.querySelector("#localeEditorMeta"),
  generateLocalesModalBtn: document.querySelector("#generateLocalesModalBtn"),
  codeEditorMeta: document.querySelector("#codeEditorMeta"),
  designEmptyState: document.querySelector("#designEmptyState"),
  assetComposerList: document.querySelector("#assetComposerList"),
  assetLibraryList: document.querySelector("#assetLibraryList"),
  assetRegistryMeta: document.querySelector("#assetRegistryMeta"),
  subjectValue: document.querySelector("#subjectValue"),
  preheaderValue: document.querySelector("#preheaderValue"),
  localeValue: document.querySelector("#localeValue"),
  modeValue: document.querySelector("#modeValue"),
  sourceValue: document.querySelector("#sourceValue"),
  assistantReply: document.querySelector("#assistantReply"),
  previewStage: document.querySelector("#previewStage"),
  previewFrame: document.querySelector("#previewFrame"),
  previewViewportButtons: Array.from(document.querySelectorAll("[data-preview-viewport]")),
  codeOutput: document.querySelector("#codeOutput"),
  codeTabs: Array.from(document.querySelectorAll(".tab")),
  assetList: document.querySelector("#assetList"),
  diagnosticsList: document.querySelector("#diagnosticsList"),
  blockList: document.querySelector("#blockList"),
  blockCatalogSummary: document.querySelector("#blockCatalogSummary"),
  designFile: document.querySelector("#designFile"),
  translationFile: document.querySelector("#translationFile"),
  translationFolderInput: document.querySelector("#translationFolderInput"),
  translationDropZone: document.querySelector("#translationDropZone"),
  translationUploadStatus: document.querySelector("#translationUploadStatus"),
  designPreviewWrap: document.querySelector("#designPreviewWrap"),
  designPreview: document.querySelector("#designPreview"),
  designCaption: document.querySelector("#designCaption"),
  designAnalysisCard: document.querySelector("#designAnalysisCard"),
  designAnalysisSummary: document.querySelector("#designAnalysisSummary"),
  designBlocksList: document.querySelector("#designBlocksList"),
  designAssetsList: document.querySelector("#designAssetsList"),
  designRequirementsList: document.querySelector("#designRequirementsList"),
  designWarningsList: document.querySelector("#designWarningsList"),
  refreshCatalogBtn: document.querySelector("#refreshCatalogBtn"),
  generateLocalesBtn: document.querySelector("#generateLocalesBtn") || document.querySelector("#generateLocalesModalBtn"),
  themeSelect: document.querySelector("#themeSelect"),
  providerSelect: document.querySelector("#providerSelect"),
  providerHelp: document.querySelector("#providerHelp"),
  runtimeConfigInfo: document.querySelector("#runtimeConfigInfo"),
  clientProfileSelect: document.querySelector("#clientProfileSelect"),
  clientProfileHelp: document.querySelector("#clientProfileHelp"),
  emailBaseSummary: document.querySelector("#emailBaseSummary"),
  journalSummary: document.querySelector("#journalSummary"),
  clearJournalBtn: document.querySelector("#clearJournalBtn"),
  journalList: document.querySelector("#journalList"),
  testsOverview: document.querySelector("#testsOverview"),
  testsProfileGrid: document.querySelector("#testsProfileGrid"),
  testsList: document.querySelector("#testsList"),
  fields: {
    campaignName: document.querySelector("#campaignName"),
    category: document.querySelector("#category"),
    mailId: document.querySelector("#mailId"),
    locale: document.querySelector("#locale"),
    requestedLocales: document.querySelector("#requestedLocales"),
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
  refs.chatInput.addEventListener("paste", handleChatPaste);
  refs.fillDemoBtn?.addEventListener("click", fillDemoScenario);
  refs.clearChatBtn.addEventListener("click", clearChatHistory);
  refs.clearStateBtn.addEventListener("click", resetState);
  refs.settingsBtn.addEventListener("click", () => toggleSettings(true));
  refs.closeSettingsBtn.addEventListener("click", () => toggleSettings(false));
  refs.settingsBackdrop.addEventListener("click", () => toggleSettings(false));
  refs.loadBaseBtn.addEventListener("click", handleLoadBaseEmail);
  refs.createBaseMailBtn.addEventListener("click", handleCreateBaseMail);
  refs.buildBaseMailBtn.addEventListener("click", handleLoadBaseEmail);
  refs.generateLocalesBtn.addEventListener("click", handleGenerateMissingLocales);
  if (refs.generateLocalesModalBtn !== refs.generateLocalesBtn) {
    refs.generateLocalesModalBtn.addEventListener("click", handleGenerateMissingLocales);
  }
  refs.addAssetBtn.addEventListener("click", addAssetRow);
  refs.attachDesignBtn.addEventListener("click", () => refs.designFile.click());
  refs.attachTranslationsBtn.addEventListener("click", () => refs.translationFile.click());
  refs.attachTranslationFolderBtn.addEventListener("click", () => refs.translationFolderInput.click());
  refs.attachAssetsBtn.addEventListener("click", () => refs.assetFileInput.click());
  refs.analyzeDesignBtn.addEventListener("click", handleAnalyzeDesign);
  refs.replaceDesignBtn.addEventListener("click", () => refs.designFile.click());
  refs.replaceAssetsBtn.addEventListener("click", () => refs.assetFileInput.click());
  refs.openLocalesBtn.addEventListener("click", openLocalesModal);
  refs.openAssetsBtn.addEventListener("click", () => openWorkspaceModal("assets"));
  refs.openCodeBtn.addEventListener("click", openCodeModal);
  refs.openLocalesQuickBtn.addEventListener("click", openLocalesModal);
  refs.openAssetsQuickBtn.addEventListener("click", () => openWorkspaceModal("assets"));
  refs.openCodeQuickBtn.addEventListener("click", openCodeModal);
  refs.openTestsBtn.addEventListener("click", openTestsModal);
  refs.openTestsQuickBtn.addEventListener("click", openTestsModal);
  refs.openJournalBtn.addEventListener("click", openJournalModal);
  refs.openJournalFromSettingsBtn.addEventListener("click", openJournalModal);
  refs.openBlocksBtn.addEventListener("click", scrollToBlocks);
  refs.refreshCatalogBtn.addEventListener("click", handleRefreshBlockCatalog);
  refs.closeLocalesModalBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeLocalesFooterBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeAssetsModalBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeCodeModalBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeCodeFooterBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeJournalModalBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeJournalFooterBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeTestsModalBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeTestsFooterBtn.addEventListener("click", closeWorkspaceModal);
  refs.workspaceModalBackdrop.addEventListener("click", closeWorkspaceModal);
  refs.saveLocaleEditsBtn.addEventListener("click", saveLocaleEdits);
  refs.saveCodeBtn.addEventListener("click", saveCodeEdits);
  refs.createBaseMailFromCodeBtn.addEventListener("click", handleCreateBaseMail);
  refs.clearJournalBtn.addEventListener("click", handleClearJournal);

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
  refs.assetFileInput.addEventListener("change", handleAssetUpload);
  refs.localeEditor.addEventListener("input", handleLocaleEditorInput);
  refs.codeOutput.addEventListener("input", handleCodeEditorInput);
  bindChatDropTargets();
  window.addEventListener("resize", positionHelpTips);

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

  for (const button of refs.previewViewportButtons) {
    button.addEventListener("click", () => {
      state.previewViewport = button.dataset.previewViewport || "fit";
      renderPreviewViewportButtons();
      renderPreview();
      persistState();
    });
  }

  for (const tab of refs.codeTabs) {
    tab.addEventListener("click", () => {
      state.activeTab = tab.dataset.tab;
      state.codeEditorBuffer = state.draft?.[codeMap[state.activeTab]] || "";
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

    await loadBlockCatalog();
    await loadAssetRegistry();
    await loadJournal();
  } catch {
    state.api = {
      openAiConfigured: false,
      model: "unavailable",
      config: null,
      providers: [],
      clientProfiles: [],
      emailBase: null,
      blockCatalog: null,
      assetRegistry: null,
      journal: null
    };
    state.blockCatalog = structuredClone(initialState.blockCatalog);
    state.assetRegistry = structuredClone(initialState.assetRegistry);
    state.journal = structuredClone(initialState.journal);
  }

  renderAll();
  persistState();
}

async function loadBlockCatalog(forceRefresh = false) {
  const response = await fetch(forceRefresh ? "/api/block-catalog/refresh" : "/api/block-catalog", {
    method: forceRefresh ? "POST" : "GET"
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Block catalog request failed");
  }

  state.blockCatalog = {
    generatedAt: payload.generatedAt || "",
    items: Array.isArray(payload.items) ? payload.items : [],
    summary: payload.summary || null
  };
}

async function loadAssetRegistry() {
  const response = await fetch("/api/assets");
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Asset registry request failed");
  }

  state.assetRegistry = {
    items: Array.isArray(payload.items) ? payload.items : [],
    summary: payload.summary || null
  };
}

async function loadJournal() {
  const response = await fetch("/api/journal");
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Journal request failed");
  }

  state.journal = {
    entries: Array.isArray(payload.entries) ? payload.entries : [],
    summary: payload.summary || null
  };
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
        ...structuredClone(initialState.design),
        ...(saved.design ?? {})
      },
      designAnalysis: saved.designAnalysis ?? null,
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
    previewViewport: state.previewViewport,
    settings: state.settings,
    brief: state.brief,
    design: state.design,
    designAnalysis: state.designAnalysis,
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
  refs.assetFileInput.value = "";
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
    requestedLocales: "en, de, fr_FR, es_ES",
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
    state.designAnalysis = null;
    renderDesignPreview();
    return;
  }

  try {
    await applyDesignFile(file, file.name);
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Ошибка при загрузке design: ${error.message}`
    });
    renderAll();
    persistState();
  }
  event.target.value = "";
}

async function applyDesignFile(file, sourceLabel = "") {
  const [entry] = await registerFilesInAssetRegistry([file], {
    kind: "design",
    placement: "reference",
    notes: sourceLabel || "chat intake"
  });

  state.design = {
    name: entry?.label || file.name,
    dataUrl: getPreferredAssetUrl(entry),
    assetId: entry?.id || ""
  };
  state.designAnalysis = null;
  state.translationUploadStatus = sourceLabel
    ? `Design attached from ${sourceLabel}.`
    : `${file.name} загружен как design reference.`;
  renderDesignPreview();
  renderAttachmentSummary();
  persistState();
}

async function handleTranslationUpload(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) {
    return;
  }

  await applyTranslationFiles(files, files.length === 1 ? files[0].name : `${files.length} files`);
  event.target.value = "";
}

async function handleAssetUpload(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) {
    return;
  }

  try {
    await applyAssetFiles(files, files.length === 1 ? files[0].name : `${files.length} files`);
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Ошибка при загрузке картинок: ${error.message}`
    });
    renderAll();
    persistState();
  }
  event.target.value = "";
}

function bindChatDropTargets() {
  const targets = [
    refs.chatCard,
    refs.translationDropZone,
    refs.messages,
    refs.chatForm,
    refs.chatInput
  ].filter(Boolean);

  const activate = (event) => {
    event.preventDefault();
    refs.chatCard.classList.add("is-dragover");
    refs.translationDropZone.classList.add("is-dragover");
  };

  const deactivate = (event) => {
    event.preventDefault();
    const related = event.relatedTarget;
    if (related && refs.chatCard.contains(related)) {
      return;
    }
    refs.chatCard.classList.remove("is-dragover");
    refs.translationDropZone.classList.remove("is-dragover");
  };

  for (const target of targets) {
    target.addEventListener("dragenter", activate);
    target.addEventListener("dragover", activate);
    target.addEventListener("dragleave", deactivate);
    target.addEventListener("drop", async (event) => {
      event.preventDefault();
      refs.chatCard.classList.remove("is-dragover");
      refs.translationDropZone.classList.remove("is-dragover");
      await applyDroppedChatPayload(event.dataTransfer);
    });
  }
}

async function handleChatPaste(event) {
  const items = Array.from(event.clipboardData?.items || []);
  const files = items
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(Boolean);

  if (files.length === 0) {
    return;
  }

  event.preventDefault();
  try {
    await applyChatFiles(files, "clipboard");
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Ошибка при вставке файлов: ${error.message}`
    });
    renderAll();
    persistState();
  }
}

async function applyDroppedChatPayload(dataTransfer) {
  const files = await extractFilesFromDrop(dataTransfer);
  const droppedText = cleanText(dataTransfer?.getData?.("text/plain"));

  if (files.length > 0) {
    try {
      await applyChatFiles(files, inferDropSourceLabel(files));
      return;
    } catch (error) {
      state.messages.push({
        role: "assistant",
        content: `Ошибка при drop файлов: ${error.message}`
      });
      renderAll();
      persistState();
      return;
    }
  }

  if (droppedText) {
    const applied = applyReferenceLinksFromText(droppedText);
    if (applied) {
      renderAll();
      persistState();
      return;
    }
  }

  state.translationUploadStatus = "В drop ничего полезного не нашел: нужны картинки, translation files или ссылка.";
  renderTranslationUploadStatus();
  persistState();
}

async function applyChatFiles(files, sourceLabel = "") {
  const translationFiles = filterTranslationFiles(files);
  const imageFiles = files.filter(isImageFile);

  if (translationFiles.length > 0) {
    await applyTranslationFiles(translationFiles, sourceLabel || "chat intake");
  }

  if (imageFiles.length > 0) {
    const [designCandidate, ...assetCandidates] = shouldTreatFirstImageAsDesign()
      ? imageFiles
      : [null, ...imageFiles];

    if (designCandidate) {
      await applyDesignFile(designCandidate, sourceLabel || "chat intake");
    }

    if (assetCandidates.length > 0) {
      await applyAssetFiles(assetCandidates, sourceLabel || "chat intake");
    }
  }

  if (translationFiles.length === 0 && imageFiles.length === 0) {
    state.translationUploadStatus = "Поддерживаются translation files и изображения.";
    renderTranslationUploadStatus();
    persistState();
  }
}

function applyReferenceLinksFromText(text, options = {}) {
  const urls = extractUrlsFromText(text);
  if (urls.length === 0) {
    return false;
  }

  const imageUrl = urls.find(looksLikeImageUrl);
  const figmaUrl = urls.find((url) => /figma\.com/i.test(url));
  const chosen = imageUrl || figmaUrl || urls[0];
  state.brief.designUrl = chosen;
  state.designAnalysis = null;
  state.translationUploadStatus = imageUrl
    ? "Сохранил ссылку на design/image reference из сообщения."
    : figmaUrl
      ? "Сохранил Figma link как design reference. Для vision нужен публичный доступ или экспорт скрина."
      : "Сохранил ссылку как reference для письма.";
  if (options.announce !== false) {
    state.messages.push({
      role: "assistant",
      content: imageUrl
        ? "Вижу ссылку на изображение. Сохранил ее как design reference."
        : figmaUrl
          ? "Вижу Figma link. Сохранил ее как reference, но для анализа макета надежнее прикладывать скрин или публичный image export."
          : "Сохранил ссылку как reference."
    });
  }
  return true;
}

async function handleChatSubmit(event) {
  event.preventDefault();

  const intent = event.submitter?.dataset.intent || "draft";
  const message = refs.chatInput.value.trim() || (intent === "discuss"
    ? "Давай обсудим текущее письмо."
    : "Обнови текущий драфт по моим данным.");

  applyReferenceLinksFromText(message, { announce: false });

  state.messages.push({ role: "user", content: message });
  const assistantMessage = {
    role: "assistant",
    content: "",
    streaming: true
  };
  state.messages.push(assistantMessage);
  refs.chatInput.value = "";
  state.busy = true;
  renderMessages();
  renderStatus();

  try {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(createChatRequestBody(intent))
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Request failed");
    }

    await consumeChatStream(response, assistantMessage);
  } catch (error) {
    assistantMessage.streaming = false;
    assistantMessage.content = `Ошибка при генерации: ${error.message}`;
  } finally {
    state.busy = false;
    renderAll();
    persistState();
  }
}

function createChatRequestBody(intent) {
  return {
    intent,
    messages: state.messages
      .filter((message) => !message.streaming)
      .map(({ role, content }) => ({ role, content })),
    brief: state.brief,
    assetInputs: state.assetInputs,
    assetRegistryItems: state.assetRegistry.items,
    translationText: state.translationText,
    design: state.design,
    designAnalysis: state.designAnalysis,
    settings: state.settings,
    currentDraft: state.draft?.mail ?? null
  };
}

async function consumeChatStream(response, assistantMessage) {
  const reader = response.body?.getReader();
  if (!reader) {
    const payload = await response.json();
    applyChatPayload(payload, assistantMessage);
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = processChatStreamBuffer(buffer, assistantMessage);
  }

  buffer += decoder.decode();
  processChatStreamBuffer(buffer, assistantMessage);
}

function processChatStreamBuffer(buffer, assistantMessage) {
  let cursor = buffer.indexOf("\n");
  let remainder = buffer;

  while (cursor >= 0) {
    const line = remainder.slice(0, cursor).trim();
    remainder = remainder.slice(cursor + 1);
    if (line) {
      const frame = JSON.parse(line);
      applyChatStreamFrame(frame, assistantMessage);
    }
    cursor = remainder.indexOf("\n");
  }

  return remainder;
}

function applyChatStreamFrame(frame, assistantMessage) {
  if (frame.type === "assistant_delta") {
    assistantMessage.content += frame.delta || "";
    renderMessages();
    renderSummary();
    return;
  }

  if (frame.type === "final") {
    applyChatPayload(frame.payload, assistantMessage);
  }
}

function applyChatPayload(payload, assistantMessage) {
  assistantMessage.streaming = false;
  assistantMessage.content = payload.assistantReply || assistantMessage.content || "Ответ готов.";
  state.mode = payload.mode;
  if (payload.designAnalysis) {
    state.designAnalysis = payload.designAnalysis;
  }
  if (payload.draft) {
    state.previewSource = "draft";
    state.draft = payload.draft;
  }
  renderAll();
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
    await loadJournal();
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

async function handleCreateBaseMail() {
  if (!state.draft?.mail) {
    state.messages.push({
      role: "assistant",
      content: "Сначала собери draft, потом я смогу сохранить его в email-base как новый mail-*."
    });
    renderAll();
    persistState();
    return;
  }

  state.busy = true;
  renderStatus();

  try {
    const response = await fetch("/api/email-base/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        brief: state.brief,
        settings: state.settings,
        draft: state.draft,
        translationText: state.translationText,
        assetInputs: state.assetInputs,
        assetRegistryItems: state.assetRegistry.items,
        design: state.design,
        designAnalysis: state.designAnalysis,
        messages: state.messages
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Save to email-base failed");
    }

    state.mode = payload.mode;
    state.previewSource = "email-base";
    state.draft = payload.draft;
    if (payload.saved?.category) {
      state.brief.category = payload.saved.category;
    }
    if (payload.saved?.mailId) {
      state.brief.mailId = payload.saved.mailId;
    }
    state.messages.push({
      role: "assistant",
      content: payload.assistantReply
    });
    await loadApiStatus();
    await loadBlockCatalog(true);
    await loadJournal();
    toggleSettings(false);
    closeWorkspaceModal();
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Ошибка при сохранении в email-base: ${error.message}`
    });
  } finally {
    state.busy = false;
    renderAll();
    persistState();
  }
}

async function handleGenerateMissingLocales() {
  state.busy = true;
  renderStatus();

  try {
    const response = await fetch("/api/translations/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        brief: state.brief,
        settings: state.settings,
        draft: state.draft,
        translationText: state.translationText,
        assetInputs: state.assetInputs,
        assetRegistryItems: state.assetRegistry.items,
        design: state.design,
        designAnalysis: state.designAnalysis,
        messages: state.messages
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Locale generation failed");
    }

    state.mode = payload.mode;
    state.translationText = payload.translationText || state.translationText;
    state.translationUploadStatus = payload.uploadStatus || state.translationUploadStatus;
    if (payload.draft) {
      state.draft = payload.draft;
    }
    state.messages.push({
      role: "assistant",
      content: payload.assistantReply
    });
    await loadJournal();
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Ошибка при генерации локалей: ${error.message}`
    });
  } finally {
    state.busy = false;
    renderAll();
    persistState();
  }
}

async function handleAnalyzeDesign() {
  state.busy = true;
  renderStatus();

  try {
    const response = await fetch("/api/design/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        brief: state.brief,
        settings: state.settings,
        draft: state.draft,
        translationText: state.translationText,
        assetInputs: state.assetInputs,
        assetRegistryItems: state.assetRegistry.items,
        design: state.design,
        designAnalysis: state.designAnalysis,
        messages: state.messages
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Design analysis failed");
    }

    state.mode = payload.mode || state.mode;
    state.designAnalysis = payload.designAnalysis || null;
    state.messages.push({
      role: "assistant",
      content: payload.assistantReply || "Design analysis updated."
    });
    await loadJournal();
    openWorkspaceModal("assets");
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Ошибка при анализе дизайна: ${error.message}`
    });
  } finally {
    state.busy = false;
    renderAll();
    persistState();
  }
}

async function handleRefreshBlockCatalog() {
  state.busy = true;
  renderStatus();

  try {
    await loadBlockCatalog(true);
    await loadJournal();
    state.messages.push({
      role: "assistant",
      content: `Обновил block catalog. Сейчас в нем ${state.blockCatalog.summary?.itemCount || state.blockCatalog.items.length} канонических блоков.`
    });
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Ошибка при обновлении block catalog: ${error.message}`
    });
  } finally {
    state.busy = false;
    renderAll();
    persistState();
  }
}

function openWorkspaceModal(name) {
  state.workspaceModal = name;

  if (name === "locales") {
    prepareLocaleEditor();
  }

  if (name === "code") {
    state.codeEditorBuffer = state.draft?.[codeMap[state.activeTab]] || "";
  }

  renderWorkspaceModals();
}

function closeWorkspaceModal() {
  state.workspaceModal = "";
  renderWorkspaceModals();
}

function openLocalesModal() {
  prepareLocaleEditor();
  openWorkspaceModal("locales");
}

function openCodeModal() {
  state.codeEditorBuffer = state.draft?.[codeMap[state.activeTab]] || "";
  openWorkspaceModal("code");
}

async function openJournalModal() {
  try {
    await loadJournal();
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Ошибка при загрузке journal: ${error.message}`
    });
  }
  openWorkspaceModal("journal");
}

function openTestsModal() {
  openWorkspaceModal("tests");
}

function scrollToBlocks() {
  refs.blockList?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function prepareLocaleEditor() {
  const docs = buildLocaleEditorDocs();
  state.localeEditorDocs = docs;
  if (!docs.some((doc) => doc.locale === state.activeLocaleDoc)) {
    state.activeLocaleDoc = docs[0]?.locale || "";
  }
}

function handleLocaleEditorInput() {
  const activeDoc = state.localeEditorDocs.find((doc) => doc.locale === state.activeLocaleDoc);
  if (!activeDoc) {
    return;
  }

  activeDoc.content = refs.localeEditor.value;
}

function handleCodeEditorInput() {
  state.codeEditorBuffer = refs.codeOutput.value;
}

function saveLocaleEdits() {
  if (state.localeEditorDocs.length === 0) {
    return;
  }

  state.translationText = state.localeEditorDocs
    .map((doc) => `=== FILE: ${doc.name} ===\n${cleanText(doc.content)}`)
    .join("\n\n");
  state.translationUploadStatus = `Locale bundle updated in editor. ${state.localeEditorDocs.length} locale file(s).`;
  syncDraftTranslationsFromCurrentText();
  closeWorkspaceModal();
  renderAll();
  persistState();
}

function saveCodeEdits() {
  if (!state.draft) {
    return;
  }

  const selectedKey = codeMap[state.activeTab];
  const nextValue = refs.codeOutput.value;
  state.draft[selectedKey] = nextValue;

  if (state.activeTab === "spec") {
    try {
      const parsed = JSON.parse(nextValue);
      if (parsed && typeof parsed === "object" && parsed.subject && parsed.sections) {
        state.draft.mail = parsed;
      }
    } catch {
      state.messages.push({
        role: "assistant",
        content: "Spec JSON не распарсился. Сохранил raw текст в code view, но mail spec не обновлял."
      });
    }
  }

  if (state.activeTab === "locales") {
    const entries = parseJsonTranslationForEditor(nextValue, state.draft.mail, "locales-editor.json");
    if (entries.length > 0) {
      state.draft.mail.translations = entries;
      state.translationText = entries
        .map((entry) => `=== FILE: ${entry.source_name || `${entry.locale}.txt`} ===\n${renderLocaleDocFromEntry(entry)}`)
        .join("\n\n");
      state.translationUploadStatus = "Locale JSON updated from code editor.";
      syncDraftTranslationsFromCurrentText();
    }
  }

  if (state.activeTab === "assets") {
    try {
      const parsed = JSON.parse(nextValue);
      if (parsed && typeof parsed === "object") {
        state.draft.mail.assets = Object.entries(parsed).map(([key, value]) => ({
          key,
          url: cleanText(value?.url),
          alt: cleanText(value?.alt),
          placement: cleanText(value?.placement) || "section",
          notes: cleanText(value?.notes),
          width: Number(value?.width) || 600,
          height: Number(value?.height) || 300
        }));
      }
    } catch {
      state.messages.push({
        role: "assistant",
        content: "Assets JSON не распарсился. Сохранил raw текст, но asset manifest не обновлял."
      });
    }
  }

  if (state.activeTab === "html") {
    state.previewSource = "draft";
  }

  closeWorkspaceModal();
  renderAll();
  persistState();
}

function toggleSettings(isOpen) {
  state.settingsOpen = isOpen;
  renderSettingsDrawer();
}

function renderAll() {
  applyTheme();
  renderFields();
  renderTranslationUploadStatus();
  renderAttachmentSummary();
  renderAssetComposer();
  renderMessages();
  renderStatus();
  renderSummary();
  renderSettingsControls();
  renderSettingsInfo();
  renderSettingsDrawer();
  renderWorkspaceModals();
  renderPreviewViewportButtons();
  renderPreview();
  renderTabs();
  renderCode();
  renderAssets();
  renderAssetLibrary();
  renderJournalSummary();
  renderTests();
  renderBlockCatalogSummary();
  renderBlocks();
  renderDiagnostics();
  renderDesignPreview();
  renderDesignAnalysis();
  positionHelpTips();
}

function positionHelpTips() {
  const tips = Array.from(document.querySelectorAll(".help-tip"));
  for (const tip of tips) {
    const rect = tip.getBoundingClientRect();
    const minSpace = 180;
    let align = "center";
    let vertical = "top";

    if (rect.left < minSpace) {
      align = "start";
    } else if (window.innerWidth - rect.right < minSpace) {
      align = "end";
    }

    if (rect.top < 120) {
      vertical = "bottom";
    }

    tip.dataset.tipAlign = align;
    tip.dataset.tipVertical = vertical;
  }
}

function renderFields() {
  refs.fields.campaignName.value = state.brief.campaignName;
  refs.fields.category.value = state.brief.category;
  refs.fields.mailId.value = state.brief.mailId;
  refs.fields.locale.value = state.brief.locale;
  refs.fields.requestedLocales.value = state.brief.requestedLocales;
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
    || "Можно выбрать файлы, папку, вставить скрин из буфера или перетащить материалы прямо в этот блок.";
}

function renderAttachmentSummary() {
  const translationDocs = getParsedLocaleEntries().length;
  const assetsCount = state.assetInputs.filter((asset) => asset.url).length;
  const blockCount = state.draft?.mail?.sections?.length || 0;
  const hasDesignLink = cleanText(state.brief.designUrl);

  refs.designBadge.textContent = state.design.dataUrl
    ? `Design: ${state.design.name || "attached"}`
    : hasDesignLink
      ? "Design: link"
      : "Design: none";
  refs.translationBadge.textContent = translationDocs > 0
    ? `Bundle: ${translationDocs} locale(s)`
    : "Bundle: empty";
  refs.openLocalesBtn.textContent = `Locales: ${translationDocs}`;
  refs.openAssetsBtn.textContent = `Assets: ${assetsCount}`;
  refs.openBlocksBtn.textContent = `Blocks: ${blockCount}`;
}

function renderWorkspaceModals() {
  const active = state.workspaceModal;
  refs.workspaceModalBackdrop.hidden = !active;
  toggleModalVisibility(refs.localesModal, active === "locales");
  toggleModalVisibility(refs.assetsModal, active === "assets");
  toggleModalVisibility(refs.codeModal, active === "code");
  toggleModalVisibility(refs.journalModal, active === "journal");
  toggleModalVisibility(refs.testsModal, active === "tests");

  if (active === "locales") {
    prepareLocaleEditor();
    renderLocaleEditor();
  }

  if (active === "code") {
    renderCode();
  }

  if (active === "journal") {
    renderJournal();
  }

  if (active === "tests") {
    renderTests();
  }
}

function toggleModalVisibility(element, isOpen) {
  element.classList.toggle("is-open", isOpen);
  element.setAttribute("aria-hidden", String(!isOpen));
}

function renderLocaleEditor() {
  const docs = state.localeEditorDocs;
  refs.localeTabs.innerHTML = "";

  if (docs.length === 0) {
    refs.localeEditorMeta.textContent = "Пока нет локалей. Загрузите translation files или сгенерируйте missing locales.";
    refs.localeEditor.value = "";
    return;
  }

  for (const doc of docs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `locale-tab ${doc.locale === state.activeLocaleDoc ? "is-active" : ""}`;
    button.textContent = doc.locale;
    button.addEventListener("click", () => {
      state.activeLocaleDoc = doc.locale;
      renderLocaleEditor();
    });
    refs.localeTabs.appendChild(button);
  }

  const activeDoc = docs.find((doc) => doc.locale === state.activeLocaleDoc) || docs[0];
  if (activeDoc && activeDoc.locale !== state.activeLocaleDoc) {
    state.activeLocaleDoc = activeDoc.locale;
  }

  refs.localeEditorMeta.textContent = activeDoc
    ? `${activeDoc.name} | ${countLocaleBlocks(activeDoc.content)} blocks`
    : "Пока нет локалей.";
  refs.localeEditor.value = activeDoc?.content || "";
}

function renderBlocks() {
  refs.blockList.innerHTML = "";
  const sections = state.draft?.mail?.sections ?? [];
  const catalogItems = Array.isArray(state.blockCatalog?.items) ? state.blockCatalog.items : [];

  if (sections.length === 0) {
    if (catalogItems.length > 0) {
      refs.blockList.appendChild(createTextCard(`Draft пока пустой. В block catalog уже есть ${catalogItems.length} канонических секций из email-base.`));
    } else {
      refs.blockList.appendChild(createTextCard("Пока нет block outline. Сначала собери draft или загрузите письмо из email-base."));
    }
    return;
  }

  for (const [index, section] of sections.entries()) {
    const card = document.createElement("article");
    card.className = "block-card";
    const match = findCatalogMatchForSection(section);
    const assetRecommendation = findAssetRecommendationForSection(index);

    const head = document.createElement("div");
    head.className = "block-card-head";

    const badge = document.createElement("span");
    badge.className = "block-kind";
    badge.textContent = `${String(index + 1).padStart(2, "0")} ${section.kind}`;

    const title = document.createElement("strong");
    title.textContent = section.title || section.eyebrow || "Untitled block";

    head.append(badge, title);

    const meta = document.createElement("div");
    meta.className = "block-card-meta";
    meta.textContent = [
      match ? `catalog=${match.id}` : "catalog=candidate-new-block",
      section.image_key ? `image=${section.image_key}` : "no image",
      section.cta_label ? `cta=${section.cta_label}` : "no cta",
      Array.isArray(section.items) && section.items.length > 0 ? `items=${section.items.length}` : "",
      match?.helperMixins?.length ? `mixins=${match.helperMixins.join(", ")}` : ""
    ].filter(Boolean).join(" | ");

    const catalogNote = document.createElement("div");
    catalogNote.className = `block-catalog-match ${match ? "" : "is-missing"}`.trim();
    catalogNote.textContent = match
      ? `${match.label}. Источник: ${formatCatalogSources(match.sources)}.`
      : "Для этой секции пока нет явного канонического блока. Это кандидат в новый block definition.";

    const body = document.createElement("p");
    body.textContent = section.body || "Без body.";

    const assetNote = document.createElement("div");
    assetNote.className = `block-catalog-match ${assetRecommendation?.status === "missing-library-match" ? "is-missing" : ""}`.trim();
    assetNote.textContent = assetRecommendation
      ? formatAssetRecommendation(assetRecommendation)
      : "По assets пока нет подсказки.";

    card.append(head, meta, catalogNote, assetNote, body);
    refs.blockList.appendChild(card);
  }
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
    if (message.streaming) {
      element.classList.add("is-streaming");
    }
    element.textContent = message.content || (message.streaming ? "Пишу..." : "");
    refs.messages.appendChild(element);
  }

  refs.messages.scrollTop = refs.messages.scrollHeight;
}

function renderStatus() {
  const providerLabel = getSelectedProvider()?.label || state.settings.providerId;
  const isLive = state.settings.providerId === "openai" && state.api.openAiConfigured;
  let statusText = "Генерирую...";
  if (!state.busy) {
    if (state.settings.providerId === "openai" && !state.api.openAiConfigured) {
      statusText = `${providerLabel}: нет OPENAI_API_KEY, работает mock mode`;
    } else if (state.settings.providerId === "mock") {
      statusText = "Mock mode: без vision-разбора и без реального AI ответа";
    } else {
      statusText = `${providerLabel}: ${state.api.openAiConfigured ? state.api.model : "demo mode"}`;
    }
  }

  refs.apiStatus.textContent = statusText;
  refs.aiModePill.textContent = isLive ? "LIVE AI" : "MOCK / FALLBACK";
  refs.aiModePill.dataset.state = isLive ? "live" : "mock";
  refs.modeValue.textContent = state.mode;
  refs.loadBaseBtn.disabled = state.busy;
  refs.createBaseMailBtn.disabled = state.busy;
  refs.buildBaseMailBtn.disabled = state.busy;
  refs.generateLocalesBtn.disabled = state.busy;
  refs.generateLocalesModalBtn.disabled = state.busy;
  refs.fillDemoBtn.disabled = state.busy;
  refs.clearChatBtn.disabled = state.busy;
  refs.clearStateBtn.disabled = state.busy;
  refs.openLocalesBtn.disabled = state.busy;
  refs.openAssetsBtn.disabled = state.busy;
  refs.openBlocksBtn.disabled = state.busy;
  refs.openCodeBtn.disabled = state.busy;
  refs.openLocalesQuickBtn.disabled = state.busy;
  refs.openAssetsQuickBtn.disabled = state.busy;
  refs.openCodeQuickBtn.disabled = state.busy;
  refs.openTestsBtn.disabled = state.busy;
  refs.openTestsQuickBtn.disabled = state.busy;
  refs.openJournalBtn.disabled = state.busy;
  refs.openJournalFromSettingsBtn.disabled = state.busy;
  refs.refreshCatalogBtn.disabled = state.busy;
  refs.attachDesignBtn.disabled = state.busy;
  refs.attachTranslationsBtn.disabled = state.busy;
  refs.attachTranslationFolderBtn.disabled = state.busy;
  refs.attachAssetsBtn.disabled = state.busy;
  refs.analyzeDesignBtn.disabled = state.busy || (!state.design?.dataUrl && !cleanText(state.brief.designUrl));
  refs.saveLocaleEditsBtn.disabled = state.busy;
  refs.saveCodeBtn.disabled = state.busy;
  refs.createBaseMailFromCodeBtn.disabled = state.busy;
  refs.clearJournalBtn.disabled = state.busy;
  refs.closeTestsModalBtn.disabled = state.busy;
  refs.closeTestsFooterBtn.disabled = state.busy;
  for (const button of refs.previewViewportButtons) {
    button.disabled = state.busy;
  }
  for (const button of refs.chatSubmitButtons) {
    button.disabled = state.busy;
  }
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
  refs.previewStage.dataset.viewport = state.previewViewport || "fit";
  refs.previewFrame.srcdoc = simulated;
}

function renderPreviewViewportButtons() {
  for (const button of refs.previewViewportButtons) {
    button.classList.toggle("is-active", button.dataset.previewViewport === state.previewViewport);
  }
}

function renderTabs() {
  for (const tab of refs.codeTabs) {
    tab.classList.toggle("is-active", tab.dataset.tab === state.activeTab);
  }
}

function renderCode() {
  const selectedKey = codeMap[state.activeTab];
  if (!state.codeEditorBuffer) {
    state.codeEditorBuffer = state.draft?.[selectedKey] || "Код появится после первого draft или build.";
  }
  refs.codeOutput.value = state.codeEditorBuffer;
  refs.codeEditorMeta.textContent = state.activeTab === "locales"
    ? "Можно редактировать raw locales bundle. Для редактирования по языкам удобнее открыть Locales."
    : `Текущая вкладка: ${state.activeTab}. Save code edits сохранит текущий текст в workspace.`;
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

function renderAssetLibrary() {
  refs.assetLibraryList.innerHTML = "";
  const items = Array.isArray(state.assetRegistry?.items) ? state.assetRegistry.items : [];
  const summary = state.assetRegistry?.summary;

  refs.assetRegistryMeta.textContent = summary?.itemCount
    ? `${summary.itemCount} file(s) in project | external links: ${summary.withExternalUrlCount || 0}`
    : "Файлов пока нет.";

  if (items.length === 0) {
    refs.assetLibraryList.appendChild(createTextCard("Asset library пока пустая. Загрузи картинки или design, и они сохранятся в проекте."));
    return;
  }

  for (const entry of items) {
    const card = document.createElement("article");
    card.className = "asset-library-card";

    const preview = document.createElement("img");
    preview.className = "asset-library-thumb";
    preview.src = entry.localUrl || entry.preferredUrl;
    preview.alt = entry.alt || entry.label;

    const content = document.createElement("div");
    content.className = "asset-library-content";

    const head = document.createElement("div");
    head.className = "asset-library-head";

    const title = document.createElement("strong");
    title.textContent = entry.label || entry.fileName || entry.id;

    const badge = document.createElement("span");
    badge.className = "block-kind";
    badge.textContent = entry.kind || "asset";

    head.append(title, badge);

    const meta = document.createElement("div");
    meta.className = "block-card-meta";
    meta.textContent = [
      cleanText(entry.placement) || "auto",
      entry.externalUrl ? "cdn linked" : "local only",
      entry.size ? `${Math.round(entry.size / 1024)} KB` : ""
    ].filter(Boolean).join(" | ");

    const linkRow = document.createElement("div");
    linkRow.className = "asset-library-links";

    const localLink = document.createElement("a");
    localLink.href = entry.localUrl;
    localLink.target = "_blank";
    localLink.rel = "noreferrer";
    localLink.textContent = "Open file";

    const downloadLink = document.createElement("a");
    downloadLink.href = entry.localUrl;
    downloadLink.download = entry.fileName || entry.label || "asset";
    downloadLink.textContent = "Download";

    linkRow.append(localLink, downloadLink);

    const cdnField = document.createElement("label");
    cdnField.className = "field";
    cdnField.innerHTML = "<span>External / CDN URL</span>";
    const cdnInput = document.createElement("input");
    cdnInput.type = "url";
    cdnInput.value = entry.externalUrl || "";
    cdnInput.placeholder = "https://cdn.company.com/...";
    cdnField.appendChild(cdnInput);

    const controls = document.createElement("div");
    controls.className = "asset-row-controls";

    const saveLinkBtn = document.createElement("button");
    saveLinkBtn.type = "button";
    saveLinkBtn.className = "ghost-button";
    saveLinkBtn.textContent = "Save URL";
    saveLinkBtn.addEventListener("click", async () => {
      await updateAssetRegistryUrl(entry.id, cdnInput.value);
    });

    const useAsAssetBtn = document.createElement("button");
    useAsAssetBtn.type = "button";
    useAsAssetBtn.className = "ghost-button";
    useAsAssetBtn.textContent = "Use in email";
    useAsAssetBtn.addEventListener("click", () => {
      useRegistryAsset(entry, "asset");
    });

    const useAsDesignBtn = document.createElement("button");
    useAsDesignBtn.type = "button";
    useAsDesignBtn.className = "ghost-button";
    useAsDesignBtn.textContent = "Use as design";
    useAsDesignBtn.addEventListener("click", () => {
      useRegistryAsset(entry, "design");
    });

    controls.append(saveLinkBtn, useAsAssetBtn, useAsDesignBtn);
    content.append(head, meta, linkRow, cdnField, controls);
    card.append(preview, content);
    refs.assetLibraryList.appendChild(card);
  }
}

function renderJournalSummary() {
  const summary = state.journal.summary || state.api.journal;
  refs.journalSummary.textContent = summary?.entryCount
    ? `${summary.entryCount} entries | errors: ${summary.errorCount || 0} | warnings: ${summary.warningCount || 0}`
    : "Журнал пока пустой.";
}

function renderJournal() {
  refs.journalList.innerHTML = "";
  const entries = Array.isArray(state.journal.entries) ? state.journal.entries : [];

  if (entries.length === 0) {
    refs.journalList.appendChild(createTextCard("Журнал пока пустой. Когда студия будет собирать письма, обновлять блоки, локали и assets, события появятся здесь."));
    return;
  }

  for (const entry of entries) {
    const card = document.createElement("article");
    card.className = `diagnostic-item ${entry.level || "ok"}`;

    const title = document.createElement("strong");
    title.textContent = `${entry.title} | ${entry.area} | ${formatJournalTimestamp(entry.timestamp)}`;

    const body = document.createElement("div");
    body.textContent = entry.message || "No details";

    card.append(title, body);
    refs.journalList.appendChild(card);
  }
}

function formatJournalTimestamp(value) {
  const raw = cleanText(value);
  if (!raw) {
    return "unknown time";
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }

  return date.toLocaleString();
}

async function updateAssetRegistryUrl(id, externalUrl) {
  state.busy = true;
  renderStatus();

  try {
    const response = await fetch("/api/assets/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id,
        patch: {
          externalUrl
        }
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Asset registry update failed");
    }

    setAssetRegistryState(payload.registry);
    await loadJournal();
    state.messages.push({
      role: "assistant",
      content: externalUrl
        ? "Сохранил внешнюю ссылку для картинки. Теперь можно использовать CDN URL вместо локального файла."
        : "Убрал внешнюю ссылку. Картинка снова использует локальный файл проекта."
    });
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Ошибка при сохранении external URL: ${error.message}`
    });
  } finally {
    state.busy = false;
    renderAll();
    persistState();
  }
}

async function handleClearJournal() {
  state.busy = true;
  renderStatus();

  try {
    const response = await fetch("/api/journal/clear", {
      method: "POST"
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Journal clear failed");
    }

    state.journal = {
      entries: Array.isArray(payload.entries) ? payload.entries : [],
      summary: payload.summary || null
    };
    state.messages.push({
      role: "assistant",
      content: "Studio journal очищен."
    });
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Ошибка при очистке journal: ${error.message}`
    });
  } finally {
    state.busy = false;
    renderAll();
    persistState();
  }
}

function useRegistryAsset(entry, mode = "asset") {
  if (mode === "design") {
    state.design = {
      name: entry.label || entry.fileName || "design",
      dataUrl: getPreferredAssetUrl(entry),
      assetId: entry.id
    };
    state.translationUploadStatus = `Design взят из asset library: ${entry.label || entry.fileName}.`;
    renderAll();
    persistState();
    return;
  }

  const alreadyUsed = state.assetInputs.some((asset) => cleanText(asset.libraryId) === cleanText(entry.id));
  if (alreadyUsed) {
    state.messages.push({
      role: "assistant",
      content: `Картинка ${entry.label || entry.fileName} уже есть в текущем письме.`
    });
    renderAll();
    persistState();
    return;
  }

  const nextIndex = state.assetInputs.length + 1;
  const nextRow = {
    id: `asset-library-${Date.now()}-${nextIndex}`,
    key: cleanText(entry.key) || `asset_${nextIndex}`,
    url: getPreferredAssetUrl(entry),
    alt: cleanText(entry.alt) || cleanText(entry.label),
    placement: cleanText(entry.placement) || "auto",
    notes: cleanText(entry.label) || cleanText(entry.notes),
    libraryId: cleanText(entry.id),
    downloadUrl: cleanText(entry.localUrl)
  };

  const meaningful = state.assetInputs.filter((asset) => asset.url || asset.notes || asset.key !== "hero_asset");
  state.assetInputs = meaningful.length > 0 ? [...meaningful, nextRow] : [nextRow];
  state.translationUploadStatus = `Картинка взята из asset library: ${entry.label || entry.fileName}.`;
  renderAll();
  persistState();
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

function renderTests() {
  refs.testsList.innerHTML = "";
  refs.testsProfileGrid.innerHTML = "";

  const currentItems = getDiagnostics();
  refs.testsOverview.textContent = state.draft?.html
    ? `Heuristic test suite по ${state.api.clientProfiles.length || 1} client profile(s). Для production финальную проверку все равно лучше прогонять реальным билдом и внешним renderer.`
    : "Сначала нужен draft или реальный build, потом здесь появятся client diagnostics.";

  const profiles = state.api.clientProfiles.length > 0
    ? state.api.clientProfiles
    : [{ id: "standard", label: "Standard preview", description: "Базовый browser preview." }];

  for (const profile of profiles) {
    const items = getDiagnostics(profile.id);
    const warningCount = items.filter((item) => item.level === "warning").length;
    const okCount = items.filter((item) => item.level === "ok").length;
    const card = document.createElement("article");
    card.className = `test-profile-card ${warningCount > 0 ? "warning" : "ok"}`;

    const title = document.createElement("strong");
    title.textContent = profile.label;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${warningCount} warning | ${okCount} ok`;

    const body = document.createElement("div");
    body.textContent = profile.description;

    card.append(title, meta, body);
    refs.testsProfileGrid.appendChild(card);
  }

  if (currentItems.length === 0) {
    refs.testsList.appendChild(createTextCard("Проверки пока пустые."));
    return;
  }

  for (const item of currentItems) {
    const card = document.createElement("div");
    card.className = `diagnostic-item ${item.level}`;

    const title = document.createElement("strong");
    title.textContent = item.title;

    const body = document.createElement("div");
    body.textContent = item.body;

    card.append(title, body);
    refs.testsList.appendChild(card);
  }
}

function renderDesignPreview() {
  const designLink = cleanText(state.brief.designUrl);
  const designSource = state.design.dataUrl || (looksLikeImageUrl(designLink) ? designLink : "");
  const hasDesign = Boolean(designSource);
  refs.designPreviewWrap.hidden = !hasDesign;
  refs.designEmptyState.hidden = hasDesign;

  if (!hasDesign) {
    if (designLink) {
      refs.designEmptyState.hidden = false;
      refs.designEmptyState.textContent = `Используется design reference link: ${designLink}. Для превью лучше приложить скрин или image export.`;
    } else {
      refs.designEmptyState.textContent = "Design пока не загружен. Можно вставить скрин прямо в чат или нажать Attach design.";
    }
    return;
  }

  refs.designPreview.src = designSource;
  refs.designCaption.textContent = state.design.assetId
    ? `${state.design.name} сохранен в проекте и может переиспользоваться.`
    : state.design.dataUrl
      ? `${state.design.name} загружен только в текущую сессию браузера.`
      : `Используется внешний design reference: ${cleanText(state.brief.designUrl)}`;
}

function renderDesignAnalysis() {
  const analysis = state.designAnalysis;
  refs.designAnalysisCard.hidden = !analysis;

  if (!analysis) {
    return;
  }

  const summaryBits = [
    cleanText(analysis.summary),
    cleanText(analysis.mode) ? `Mode: ${analysis.mode}` : "",
    cleanText(analysis.updatedAt) ? `Updated: ${new Date(analysis.updatedAt).toLocaleString()}` : ""
  ].filter(Boolean);
  refs.designAnalysisSummary.textContent = summaryBits.join(" | ");
  renderSimpleList(refs.designBlocksList, Array.isArray(analysis.suggested_blocks) ? analysis.suggested_blocks : [], "Нет block suggestions.");
  renderSimpleList(refs.designAssetsList, Array.isArray(analysis.asset_slots) ? analysis.asset_slots : [], "Нет asset slots.");
  renderSimpleList(refs.designRequirementsList, Array.isArray(analysis.content_requirements) ? analysis.content_requirements : [], "Не хватает design analysis.");
  renderSimpleList(refs.designWarningsList, Array.isArray(analysis.warnings) ? analysis.warnings : [], "Warnings нет.");
}

function renderSimpleList(container, items, emptyText) {
  container.innerHTML = "";
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (values.length === 0) {
    container.appendChild(createTextCard(emptyText));
    return;
  }

  for (const item of values) {
    container.appendChild(createTextCard(item));
  }
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
  const config = state.api.config;
  refs.providerHelp.textContent = provider
    ? `${provider.status}. Возможности: ${provider.capabilities.join(", ")}.`
    : "Провайдер пока не определен.";

  refs.runtimeConfigInfo.textContent = config
    ? config.openAiConfigured
      ? `Runtime: ${config.openAiModel} active. .env: ${config.envFileLoaded ? config.envFilePath : "not found"}.`
      : `Runtime: OpenAI key not loaded. Создай ${config.envFilePath} с OPENAI_API_KEY=... и перезапусти сервер.`
    : "Runtime config недоступен.";

  const profile = getSelectedClientProfile();
  refs.clientProfileHelp.textContent = profile
    ? profile.description
    : "Выберите профиль клиента для heuristic preview.";

  const emailBase = state.api.emailBase;
  const blockCatalogSummary = state.blockCatalog.summary || state.api.blockCatalog;
  const assetRegistrySummary = state.assetRegistry.summary || state.api.assetRegistry;
  refs.emailBaseSummary.textContent = emailBase?.available
    ? `Root: ${emailBase.root}. Current: ${emailBase.currentMail?.folder || "none"}. Locales: ${emailBase.localeCount}. Catalog: ${blockCatalogSummary?.itemCount || 0} blocks. Assets: ${assetRegistrySummary?.itemCount || 0}.`
    : "email-base пока не подключена.";
}

function renderBlockCatalogSummary() {
  refs.blockCatalogSummary.innerHTML = "";
  const summary = state.blockCatalog.summary || state.api.blockCatalog;

  if (!summary?.itemCount) {
    refs.blockCatalogSummary.appendChild(createTextCard("Block catalog пока не собран. Нажми Refresh catalog или дождись первой инициализации email-base."));
    return;
  }

  const parts = [
    `${summary.itemCount} canonical block(s)`,
    `${summary.sourceMailCount || 0} source mail(s)`,
    summary.sectionKinds?.length ? `Kinds: ${summary.sectionKinds.join(", ")}` : "",
    summary.helperMixins?.length ? `Mixins: ${summary.helperMixins.join(", ")}` : ""
  ].filter(Boolean);

  for (const part of parts) {
    const pill = document.createElement("div");
    pill.className = "pill";
    pill.textContent = part;
    refs.blockCatalogSummary.appendChild(pill);
  }
}

function findCatalogMatchForSection(section) {
  const catalogItems = Array.isArray(state.blockCatalog?.items) ? state.blockCatalog.items : [];
  if (catalogItems.length === 0) {
    return null;
  }

  const explicitId = cleanText(section?.catalog_id);
  if (explicitId) {
    const direct = catalogItems.find((item) => item.id === explicitId);
    if (direct) {
      return direct;
    }
  }

  let bestMatch = null;
  let bestScore = 0;

  for (const item of catalogItems) {
    const score = scoreCatalogMatch(section, item);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }

  return bestScore >= 5 ? bestMatch : null;
}

function scoreCatalogMatch(section, item) {
  let score = 0;
  const sectionKind = cleanText(section?.kind);
  const itemKind = cleanText(item?.sectionKind);
  const hasImage = Boolean(cleanText(section?.image_key));
  const hasCta = Boolean(cleanText(section?.cta_label));
  const itemsCount = Array.isArray(section?.items) ? section.items.length : 0;

  if (sectionKind && itemKind && sectionKind === itemKind) {
    score += 5;
  }

  if (hasImage && item?.traits?.hasImage) {
    score += 2;
  } else if (!hasImage && !item?.traits?.hasImage) {
    score += 1;
  }

  if (hasCta && item?.traits?.hasCta) {
    score += 2;
  } else if (!hasCta && !item?.traits?.hasCta) {
    score += 1;
  }

  if (itemsCount > 1 && (item?.traits?.itemMode === "numbered" || Number(item?.traits?.minItems) > 1)) {
    score += 2;
  }

  if (sectionKind === "hero" && item.id.includes("hero")) {
    score += 1;
  }

  if (sectionKind === "footer" && item.id.includes("footer")) {
    score += 1;
  }

  return score;
}

function formatCatalogSources(sources) {
  const first = Array.isArray(sources) ? sources[0] : null;
  if (!first) {
    return "catalog";
  }

  const mailRef = first.category && first.mailId ? `${first.category}/mail-${first.mailId}` : "catalog";
  return first.file ? `${mailRef} -> ${first.file}` : mailRef;
}

function findAssetRecommendationForSection(sectionIndex) {
  const items = Array.isArray(state.draft?.assetRecommendations) ? state.draft.assetRecommendations : [];
  return items.find((item) => Number(item.sectionIndex) === Number(sectionIndex)) || null;
}

function formatAssetRecommendation(recommendation) {
  if (recommendation.status === "mapped") {
    return "Asset note: в секции уже есть картинка или image mapping.";
  }

  if (recommendation.matches?.length > 0) {
    return `Asset note: для секции подойдут ${recommendation.matches.map((item) => item.label).join(", ")}.`;
  }

  return "Asset note: в library пока нет явного кандидата под эту секцию.";
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

function getDiagnostics(profileId = state.settings.clientProfileId) {
  if (!state.draft?.html) {
    return [
      {
        level: "ok",
        title: "Preview is empty",
        body: "Сначала приложи материалы в чат, потом либо просто общайся, либо применяй изменения к письму."
      }
    ];
  }

  const items = [];
  const html = state.draft.html;
  const buildLog = state.draft.buildLog || "";
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

  const recommendationItems = Array.isArray(state.draft?.assetRecommendations) ? state.draft.assetRecommendations : [];
  const reusableMatches = recommendationItems.filter((item) => item.status === "needs-asset" && item.matches?.length > 0);
  const missingLibraryMatches = recommendationItems.filter((item) => item.status === "missing-library-match");

  if (reusableMatches.length > 0) {
    items.push({
      level: "ok",
      title: "Reusable library assets found",
      body: `Для ${reusableMatches.length} block(s) уже есть кандидаты в asset library. Их можно быстро подставить без нового upload.`
    });
  }

  if (missingLibraryMatches.length > 0) {
    items.push({
      level: "warning",
      title: "Library gaps",
      body: `Для ${missingLibraryMatches.length} block(s) в asset library пока нет явного кандидата. Возможно, нужен новый upload или другой дизайн.`
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

function extractUrlsFromText(text) {
  return (cleanText(text).match(/https?:\/\/[^\s)]+/gi) || [])
    .map((url) => url.replace(/[.,]+$/g, ""));
}

function looksLikeImageUrl(url) {
  return /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(cleanText(url));
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
      <strong>retantion future</strong>
      Сначала приложи материалы в чат, затем общайся с ассистентом или применяй изменения к письму.
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
  syncDraftTranslationsFromCurrentText();
  renderTranslationUploadStatus();
  renderAttachmentSummary();
  persistState();
}

function filterTranslationFiles(files) {
  return files.filter((file) => /\.(json|txt|md)$/i.test(file.name));
}

function looksLikeJsonBundle(text) {
  const raw = cleanText(text);
  return raw.startsWith("{") || raw.startsWith("[");
}

function isImageFile(file) {
  return /^image\//i.test(file.type) || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
}

function shouldTreatFirstImageAsDesign() {
  return !state.design?.dataUrl;
}

async function applyAssetFiles(files, sourceLabel = "") {
  const supported = files.filter(isImageFile);
  if (supported.length === 0) {
    return;
  }

  const rows = [];
  const uploaded = await registerFilesInAssetRegistry(supported, {
    kind: "asset",
    placement: "auto",
    notes: sourceLabel || "chat intake"
  });

  for (const [index, entry] of uploaded.entries()) {
    rows.push({
      id: `asset-upload-${Date.now()}-${index + 1}`,
      key: index === 0 && state.assetInputs.every((asset) => !asset.url) ? "hero_asset" : cleanText(entry?.key) || `asset_${state.assetInputs.length + index + 1}`,
      url: getPreferredAssetUrl(entry),
      alt: cleanText(entry?.alt) || cleanText(entry?.label).replace(/\.[a-z0-9]+$/i, ""),
      placement: index === 0 && state.assetInputs.every((asset) => !asset.url) ? "hero" : cleanText(entry?.placement) || "auto",
      notes: cleanText(entry?.label) || cleanText(entry?.notes),
      libraryId: cleanText(entry?.id),
      downloadUrl: cleanText(entry?.localUrl)
    });
  }

  const meaningful = state.assetInputs.filter((asset) => asset.url || asset.notes || asset.key !== "hero_asset");
  state.assetInputs = meaningful.length > 0 ? [...meaningful, ...rows] : rows;
  state.translationUploadStatus = sourceLabel
    ? `Добавлено ${rows.length} image asset(s) из ${sourceLabel}.`
    : `Добавлено ${rows.length} image asset(s).`;
  renderAssetComposer();
  renderAssetLibrary();
  renderAttachmentSummary();
  persistState();
}

async function registerFilesInAssetRegistry(files, defaults = {}) {
  const payloadFiles = [];

  for (const [index, file] of files.entries()) {
    const dataUrl = await readFileAsDataUrl(file);
    payloadFiles.push({
      name: cleanText(file.name) || `${defaults.kind || "asset"}-${Date.now()}-${index + 1}.png`,
      dataUrl,
      kind: defaults.kind || "asset",
      alt: defaults.alt || cleanText(file.name).replace(/\.[a-z0-9]+$/i, ""),
      notes: defaults.notes || cleanText(file.name),
      placement: defaults.placement || "auto",
      key: defaults.key || cleanText(file.name).replace(/\.[a-z0-9]+$/i, "")
    });
  }

  const response = await fetch("/api/assets/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      files: payloadFiles
    })
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Asset upload failed");
  }

  setAssetRegistryState(payload.registry);
  await loadJournal();
  return Array.isArray(payload.items) ? payload.items : [];
}

function setAssetRegistryState(registry) {
  state.assetRegistry = {
    items: Array.isArray(registry?.items) ? registry.items : [],
    summary: registry?.summary || null
  };
}

function getPreferredAssetUrl(entry) {
  return cleanText(entry?.preferredUrl || entry?.externalUrl || entry?.localUrl || entry?.url);
}

function buildLocaleEditorDocs() {
  if (looksLikeJsonBundle(state.translationText)) {
    const entriesFromJson = parseTranslationEntriesForEditor(state.translationText, state.draft?.mail || null);
    if (entriesFromJson.length > 0) {
      return entriesFromJson.map((entry) => ({
        locale: cleanText(entry.locale) || "en",
        name: cleanText(entry.source_name) || `${cleanText(entry.locale) || "locale"}.json`,
        content: renderLocaleDocFromEntry(entry)
      }));
    }
  }

  const docsFromText = splitTranslationDocumentsForEditor(state.translationText)
    .map((doc) => ({
      locale: extractLocaleFromEditorFileName(doc.name) || `locale_${Math.random().toString(36).slice(2, 6)}`,
      name: doc.name,
      content: doc.content.trim()
    }))
    .filter((doc) => doc.content);

  if (docsFromText.length > 0) {
    return docsFromText;
  }

  const translations = Array.isArray(state.draft?.mail?.translations) ? state.draft.mail.translations : [];
  return translations.map((entry) => ({
    locale: cleanText(entry.locale) || "en",
    name: cleanText(entry.source_name) || `${cleanText(entry.locale) || "locale"}.txt`,
    content: renderLocaleDocFromEntry(entry)
  }));
}

function getParsedLocaleEntries() {
  const parsed = parseTranslationEntriesForEditor(state.translationText, state.draft?.mail || null);
  if (parsed.length > 0) {
    return parsed;
  }

  return Array.isArray(state.draft?.mail?.translations) ? state.draft.mail.translations : [];
}

function syncDraftTranslationsFromCurrentText() {
  if (!state.draft?.mail) {
    return;
  }

  const entries = parseTranslationEntriesForEditor(state.translationText, state.draft.mail);
  if (entries.length === 0) {
    return;
  }

  state.draft.mail.translations = entries;
  const primaryLocale = cleanText(state.brief.locale || state.draft.mail.locale || "en").toLowerCase();
  const primaryEntry = entries.find((entry) => cleanText(entry.locale).toLowerCase() === primaryLocale)
    || entries.find((entry) => cleanText(entry.locale).toLowerCase().startsWith(primaryLocale.split(/[_-]/)[0] || ""))
    || entries[0];

  if (primaryEntry) {
    state.draft.mail.subject = primaryEntry.subject || state.draft.mail.subject;
    state.draft.mail.preheader = primaryEntry.preheader || state.draft.mail.preheader;
  }

  state.draft.locales = buildLocalesJsonFromEntries(entries);
  state.draft.spec = JSON.stringify(state.draft.mail, null, 2);
}

function splitTranslationDocumentsForEditor(translationText) {
  const raw = cleanText(translationText);
  if (!raw) {
    return [];
  }

  const marker = /^=== FILE: (.+?) ===$/gm;
  const matches = [...raw.matchAll(marker)];
  if (matches.length === 0) {
    return [{ name: "inline.txt", content: raw }];
  }

  const docs = [];
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const start = current.index + current[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : raw.length;
    docs.push({
      name: cleanText(current[1]) || `translation-${index + 1}.txt`,
      content: raw.slice(start, end).trim()
    });
  }

  return docs.filter((doc) => doc.content);
}

function extractLocaleFromEditorFileName(fileName) {
  const match = cleanText(fileName).match(/_([a-z]{2}(?:[_-][A-Za-z]{2})?)(?:_|\.|$)/);
  return match ? match[1].replace("-", "_") : "";
}

function normalizeEditorBoldTokens(text) {
  return cleanText(text).replace(/@@(.*?)@@/g, "**$1**");
}

function formatEditorBoldTokens(text) {
  return cleanText(text).replace(/\*\*(.*?)\*\*/g, "@@$1@@");
}

function parseTranslationEntriesForEditor(translationText, mail) {
  const docs = splitTranslationDocumentsForEditor(translationText);
  const entries = docs.flatMap((doc) => parseTranslationDocumentForEditor(doc, mail));
  return entries.filter((entry) => entry.locale || entry.subject || entry.preheader || entry.body_blocks?.length > 0);
}

function parseTranslationDocumentForEditor(doc, mail) {
  if (/\.json$/i.test(doc.name)) {
    return parseJsonTranslationForEditor(doc.content, mail, doc.name);
  }

  const content = cleanText(doc.content);
  if (!content) {
    return [];
  }

  const subjectMatch = content.match(/^Subject:\s*(.+)$/im);
  const snippetMatch = content.match(/^Snippet:\s*(.+)$/im);
  const bodySource = content
    .replace(/^Subject:\s*.+$/gim, "")
    .replace(/^Snippet:\s*.+$/gim, "");
  const bodyBlocks = [...bodySource.matchAll(/\{\{([\s\S]*?)\}\}/g)]
    .map((match) => normalizeEditorBoldTokens(match[1]))
    .filter(Boolean);
  const lines = content.split(/\r?\n/).map((line) => line.trim());
  const pushIndex = lines.findIndex((line) => /^PUSH$/i.test(line));
  const ctaLabels = pushIndex >= 0
    ? lines.slice(pushIndex + 1).map(normalizeEditorBoldTokens).filter(Boolean)
    : [];
  const locale = extractLocaleFromEditorFileName(doc.name) || cleanText(mail?.locale) || "en";

  return [{
    locale,
    subject: normalizeEditorBoldTokens(subjectMatch?.[1] || "") || cleanText(mail?.subject),
    preheader: normalizeEditorBoldTokens(snippetMatch?.[1] || "") || cleanText(mail?.preheader),
    cta_labels: ctaLabels,
    notes: `source=${doc.name}`,
    body_blocks: bodyBlocks,
    source_name: doc.name
  }];
}

function parseJsonTranslationForEditor(content, mail, fileName = "bundle.json") {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => normalizeEditorTranslationEntry(entry, mail, fileName));
    }
    if (parsed && typeof parsed === "object") {
      if ("locale" in parsed) {
        return [normalizeEditorTranslationEntry(parsed, mail, fileName)];
      }

      return Object.entries(parsed).map(([locale, value]) => normalizeEditorTranslationEntry({
        locale,
        ...(value && typeof value === "object" ? value : {})
      }, mail, fileName));
    }
  } catch {
    return [];
  }

  return [];
}

function normalizeEditorTranslationEntry(entry, mail, fileName) {
  return {
    locale: cleanText(entry?.locale) || cleanText(mail?.locale) || "en",
    subject: cleanText(entry?.subject) || cleanText(mail?.subject),
    preheader: cleanText(entry?.preheader) || cleanText(mail?.preheader),
    cta_labels: Array.isArray(entry?.cta_labels) ? entry.cta_labels.map(cleanText).filter(Boolean) : [],
    notes: cleanText(entry?.notes),
    body_blocks: Array.isArray(entry?.body_blocks) ? entry.body_blocks.map(normalizeEditorBoldTokens).filter(Boolean) : [],
    source_name: cleanText(entry?.source_name) || fileName
  };
}

function renderLocaleDocFromEntry(entry) {
  const lines = [];
  if (entry.subject) {
    lines.push(`Subject: ${formatEditorBoldTokens(entry.subject)}`);
  }
  if (entry.preheader) {
    lines.push(`Snippet: ${formatEditorBoldTokens(entry.preheader)}`);
  }
  if (lines.length > 0) {
    lines.push("");
  }
  for (const block of entry.body_blocks || []) {
    lines.push(`{{${formatEditorBoldTokens(block)}}}`);
    lines.push("");
  }
  if (Array.isArray(entry.cta_labels) && entry.cta_labels.length > 0) {
    lines.push("PUSH");
    for (const label of entry.cta_labels) {
      lines.push(formatEditorBoldTokens(label));
    }
  }
  return lines.join("\n").trim();
}

function buildLocalesJsonFromEntries(entries) {
  return JSON.stringify(
    Object.fromEntries(entries.map((entry) => [entry.locale, {
      subject: entry.subject,
      preheader: entry.preheader,
      cta_labels: entry.cta_labels || [],
      notes: entry.notes || "",
      body_blocks: entry.body_blocks || [],
      source_name: entry.source_name || ""
    }])),
    null,
    2
  );
}

function countLocaleBlocks(content) {
  return [...String(content || "").matchAll(/\{\{([\s\S]*?)\}\}/g)].length;
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

async function extractFilesFromDrop(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);
  if (items.length > 0 && items.some((item) => typeof item.webkitGetAsEntry === "function")) {
    const groups = await Promise.all(items.map(async (item) => {
      const entry = item.webkitGetAsEntry?.();
      return entry ? collectFilesFromEntry(entry) : [];
    }));
    const droppedFiles = groups.flat();
    if (droppedFiles.length > 0) {
      return droppedFiles;
    }
  }

  return Array.from(dataTransfer?.files || []);
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
