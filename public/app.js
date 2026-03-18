const storageKey = "email-studio-demo-state-v4";
const assetPlacements = ["auto", "hero", "logo", "section", "feature", "footer", "background", "reference"];

const initialState = {
  api: {
    openAiConfigured: false,
    model: "gpt-4.1-mini",
    config: null,
    providers: [],
    clientProfiles: [],
    figma: null,
    emailBase: null
  },
  busy: false,
  activeTab: "html",
  mode: "mock",
  providerRuntime: null,
  previewSource: "draft",
  previewViewport: "fit",
  previewLocale: "",
  settings: {
    theme: "light",
    providerId: "mock",
    clientProfileId: "standard"
  },
  chatAttachMenuOpen: false,
  assetsWorkspaceView: "design",
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
    dataUrl: "",
    assetId: "",
    figmaFileKey: "",
    figmaNodeId: "",
    figmaSelectionName: "",
    figmaImport: null
  },
  designAnalysis: null,
  designTab: "figma", // "figma" | "screenshot"
  figmaScanResult: null, // last scan result from /api/figma/inspect
  // Clone & Edit: base email HTML attachment
  baseEmailHtml: null,
  baseEmailFileName: "",
  baseEmailContentMap: null,
  // Scaffold mode: context from POST /api/email-base/scaffold
  scaffoldContext: null,
  assetInputs: [createEmptyAsset(1)],
  messages: [
    {
      role: "assistant",
      content: "Привет! Три способа начать:\n\n**Из Figma** — правой кнопкой на фрейм → Copy/Paste as → **Copy as PNG**, затем Cmd+V сюда. Обычный Cmd+C копирует текст слоёв, а не картинку.\n\n**Готовое письмо** — вставь HTML-код сюда, тулза его подхватит и спросит что поменять.\n\n**Текстом** — просто опиши что нужно: тема, аудитория, CTA, и я соберу письмо по базе.\n\nОтправить: Cmd+Enter."
    }
  ],
  draft: null,
  settingsOpen: false,
  workspaceModal: "",
  localeEditorDocs: [],
  activeLocaleDoc: "",
  codeEditorBuffer: "",
  codeFileSelection: {},
  blockCatalog: {
    generatedAt: "",
    items: [],
    summary: null
  },
  assetRegistry: {
    items: [],
    summary: null
  },
  projectRules: {
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
  stylus: "stylus",
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
  toggleAttachMenuBtn: document.querySelector("#toggleAttachMenuBtn"),
  pasteFigmaLinkBtn: document.querySelector("#pasteFigmaLinkBtn"),
  settingsBtn: document.querySelector("#settingsBtn"),
  closeSettingsBtn: document.querySelector("#closeSettingsBtn"),
  settingsDrawer: document.querySelector("#settingsDrawer"),
  settingsBackdrop: document.querySelector("#settingsBackdrop"),
  workspaceModalBackdrop: document.querySelector("#workspaceModalBackdrop"),
  loadBaseBtn: document.querySelector("#loadBaseBtn"),
  openRulesBtn: document.querySelector("#openRulesBtn"),
  createBaseMailBtn: document.querySelector("#createBaseMailBtn"),
  buildBaseMailBtn: document.querySelector("#buildBaseMailBtn"),
  addAssetBtn: document.querySelector("#addAssetBtn"),
  attachDesignBtn: document.querySelector("#attachDesignBtn"),
  attachTranslationsBtn: document.querySelector("#attachTranslationsBtn"),
  attachTranslationFolderBtn: document.querySelector("#attachTranslationFolderBtn"),
  attachAssetsBtn: document.querySelector("#attachAssetsBtn"),
  replaceDesignBtn: document.querySelector("#replaceDesignBtn"),
  clearDesignBtn: document.querySelector("#clearDesignBtn"),
  analyzeDesignBtn: document.querySelector("#analyzeDesignBtn"),
  // Design tabs
  scanFigmaBtn: document.querySelector("#scanFigmaBtn"),
  figmaScanResult: document.querySelector("#figmaScanResult"),
  figmaScanStatus: document.querySelector("#figmaScanStatus"),
  figmaScanBody: document.querySelector("#figmaScanBody"),
  screenshotPasteZone: document.querySelector("#screenshotPasteZone"),
  uploadScreenshotBtn: document.querySelector("#uploadScreenshotBtn"),
  designStatusBar: document.querySelector("#designStatusBar"),
  // Base email: clone & edit
  openBaseEmailBtn: document.querySelector("#openBaseEmailBtn"),
  baseEmailFileInput: document.querySelector("#baseEmailFileInput"),
  uploadBaseEmailBtn: document.querySelector("#uploadBaseEmailBtn"),
  pasteBaseEmailBtn: document.querySelector("#pasteBaseEmailBtn"),
  clearBaseEmailBtn: document.querySelector("#clearBaseEmailBtn"),
  clearBaseEmailInlineBtn: document.querySelector("#clearBaseEmailInlineBtn"),
  baseEmailDropZone: document.querySelector("#baseEmailDropZone"),
  baseEmailEmptyState: document.querySelector("#baseEmailEmptyState"),
  baseEmailLoadedState: document.querySelector("#baseEmailLoadedState"),
  baseEmailFileName: document.querySelector("#baseEmailFileName"),
  baseEmailStats: document.querySelector("#baseEmailStats"),
  baseEmailContentMap: document.querySelector("#baseEmailContentMap"),
  baseEmailPasteZone: document.querySelector("#baseEmailPasteZone"),
  baseEmailPasteInput: document.querySelector("#baseEmailPasteInput"),
  confirmBaseEmailPasteBtn: document.querySelector("#confirmBaseEmailPasteBtn"),
  cancelBaseEmailPasteBtn: document.querySelector("#cancelBaseEmailPasteBtn"),
  replaceAssetsBtn: document.querySelector("#replaceAssetsBtn"),
  assetFileInput: document.querySelector("#assetFileInput"),
  openLocalesBtn: document.querySelector("#openLocalesBtn"),
  openAssetsBtn: document.querySelector("#openAssetsBtn"),
  openBlocksBtn: document.querySelector("#openBlocksBtn"),
  openCodeBtn: document.querySelector("#openCodeBtn"),
  openContextBtn: document.querySelector("#openContextBtn"),
  openLocalesQuickBtn: document.querySelector("#openLocalesQuickBtn"),
  openAssetsQuickBtn: document.querySelector("#openAssetsQuickBtn"),
  openCodeQuickBtn: document.querySelector("#openCodeQuickBtn"),
  openTestsBtn: document.querySelector("#openTestsBtn"),
  openTestsQuickBtn: document.querySelector("#openTestsQuickBtn"),
  openDesignQuickBtn: document.querySelector("#openDesignQuickBtn"),
  openJournalBtn: document.querySelector("#openJournalBtn"),
  openJournalFromSettingsBtn: document.querySelector("#openJournalFromSettingsBtn"),
  openRulesFromSettingsBtn: document.querySelector("#openRulesFromSettingsBtn"),
  openLessonsFromSettingsBtn: document.querySelector("#openLessonsFromSettingsBtn"),
  lessonsCountBadgeSettings: document.querySelector("#lessonsCountBadgeSettings"),
  openBlockCandidatesBtn: document.querySelector("#openBlockCandidatesBtn"),
  toggleBlocksBtn: document.querySelector("#toggleBlocksBtn"),
  hideBlocksBtn: document.querySelector("#hideBlocksBtn"),
  blocksCatalogSection: document.querySelector("#blocksCatalogSection"),
  designBadge: document.querySelector("#designBadge"),
  translationBadge: document.querySelector("#translationBadge"),
  chatIntakeActions: document.querySelector("#chatIntakeActions"),
  chatAttachmentsRow: document.querySelector("#chatAttachmentsRow"),
  contextModal: document.querySelector("#contextModal"),
  localesModal: document.querySelector("#localesModal"),
  assetsModal: document.querySelector("#assetsModal"),
  codeModal: document.querySelector("#codeModal"),
  rulesModal: document.querySelector("#rulesModal"),
  journalModal: document.querySelector("#journalModal"),
  testsModal: document.querySelector("#testsModal"),
  blockCandidatesModal: document.querySelector("#blockCandidatesModal"),
  closeLocalesModalBtn: document.querySelector("#closeLocalesModalBtn"),
  closeLocalesFooterBtn: document.querySelector("#closeLocalesFooterBtn"),
  closeAssetsModalBtn: document.querySelector("#closeAssetsModalBtn"),
  closeCodeModalBtn: document.querySelector("#closeCodeModalBtn"),
  closeCodeFooterBtn: document.querySelector("#closeCodeFooterBtn"),
  closeRulesModalBtn: document.querySelector("#closeRulesModalBtn"),
  closeRulesFooterBtn: document.querySelector("#closeRulesFooterBtn"),
  closeJournalModalBtn: document.querySelector("#closeJournalModalBtn"),
  closeJournalFooterBtn: document.querySelector("#closeJournalFooterBtn"),
  closeTestsModalBtn: document.querySelector("#closeTestsModalBtn"),
  closeTestsFooterBtn: document.querySelector("#closeTestsFooterBtn"),
  closeBlockCandidatesModalBtn: document.querySelector("#closeBlockCandidatesModalBtn"),
  closeBlockCandidatesFooterBtn: document.querySelector("#closeBlockCandidatesFooterBtn"),
  closeContextModalBtn: document.querySelector("#closeContextModalBtn"),
  closeContextFooterBtn: document.querySelector("#closeContextFooterBtn"),
  saveLocaleEditsBtn: document.querySelector("#saveLocaleEditsBtn"),
  saveCodeBtn: document.querySelector("#saveCodeBtn"),
  createBaseMailFromCodeBtn: document.querySelector("#createBaseMailFromCodeBtn"),
  localeTabs: document.querySelector("#localeTabs"),
  localeEditor: document.querySelector("#localeEditor"),
  localeEditorMeta: document.querySelector("#localeEditorMeta"),
  generateLocalesModalBtn: document.querySelector("#generateLocalesModalBtn"),
  deeplAutoTranslateBtn: document.querySelector("#deeplAutoTranslateBtn"),
  codeEditorMeta: document.querySelector("#codeEditorMeta"),
  codeFileMeta: document.querySelector("#codeFileMeta"),
  codeLocaleTabs: document.querySelector("#codeLocaleTabs"),
  codeFileList: document.querySelector("#codeFileList"),
  codeHighlight: document.querySelector("#codeHighlight"),
  toggleCodeEditBtn: document.querySelector("#toggleCodeEditBtn"),
  codeViewLabel: document.querySelector("#codeViewLabel"),
  designEmptyState: document.querySelector("#designEmptyState"),
  assetsModalTitle: document.querySelector("#assetsModalTitle"),
  designWorkspaceSection: document.querySelector("#designWorkspaceSection"),
  inputAssetsSection: document.querySelector("#inputAssetsSection"),
  previewAssetsSection: document.querySelector("#previewAssetsSection"),
  assetLibrarySection: document.querySelector("#assetLibrarySection"),
  assetComposerList: document.querySelector("#assetComposerList"),
  assetLibraryList: document.querySelector("#assetLibraryList"),
  assetRegistryMeta: document.querySelector("#assetRegistryMeta"),
  subjectValue: document.querySelector("#subjectValue"),
  preheaderValue: document.querySelector("#preheaderValue"),
  localeValue: document.querySelector("#localeValue"),
  mailIdValue: document.querySelector("#mailIdValue"),
  modeValue: document.querySelector("#modeValue"),
  sourceValue: document.querySelector("#sourceValue"),
  assistantReply: document.querySelector("#assistantReply"),
  previewLocaleRow: document.querySelector("#previewLocaleRow"),
  previewLocaleTabs: document.querySelector("#previewLocaleTabs"),
  copyPreviewHtmlBtn: document.querySelector("#copyPreviewHtmlBtn"),
  previewStage: document.querySelector("#previewStage"),
  previewSkeleton: document.querySelector("#previewSkeleton"),
  previewFrame: document.querySelector("#previewFrame"),
  previewViewportButtons: Array.from(document.querySelectorAll("[data-preview-viewport]")),
  codeOutput: document.querySelector("#codeOutput"),
  codeTabs: Array.from(document.querySelectorAll(".tab")),
  assetList: document.querySelector("#assetList"),
  diagnosticsList: document.querySelector("#diagnosticsList"),
  blockList: document.querySelector("#blockList"),
  blockCatalogSummary: document.querySelector("#blockCatalogSummary"),
  blockCandidateSummary: document.querySelector("#blockCandidateSummary"),
  blockCandidatesMeta: document.querySelector("#blockCandidatesMeta"),
  blockCandidatesList: document.querySelector("#blockCandidatesList"),
  designFile: document.querySelector("#designFile"),
  translationFile: document.querySelector("#translationFile"),
  translationFolderInput: document.querySelector("#translationFolderInput"),
  translationDropZone: document.querySelector("#translationDropZone"),
  translationUploadStatus: document.querySelector("#translationUploadStatus"),
  designPreviewWrap: document.querySelector("#designPreviewWrap"),
  designPreview: document.querySelector("#designPreview"),
  designCaption: document.querySelector("#designCaption"),
  designSourceSummary: document.querySelector("#designSourceSummary"),
  designSourcePills: document.querySelector("#designSourcePills"),
  designReferenceUrlInput: document.querySelector("#designReferenceUrlInput"),
  saveDesignReferenceBtn: document.querySelector("#saveDesignReferenceBtn"),
  clearDesignReferenceBtn: document.querySelector("#clearDesignReferenceBtn"),
  figmaImportSummary: document.querySelector("#figmaImportSummary"),
  figmaPayloadInput: document.querySelector("#figmaPayloadInput"),
  figmaPayloadFileInput: document.querySelector("#figmaPayloadFileInput"),
  importFigmaPayloadBtn: document.querySelector("#importFigmaPayloadBtn"),
  loadFigmaPayloadFileBtn: document.querySelector("#loadFigmaPayloadFileBtn"),
  clearFigmaPayloadBtn: document.querySelector("#clearFigmaPayloadBtn"),
  figmaImportNote: document.querySelector("#figmaImportNote"),
  designWorkspaceNote: document.querySelector("#designWorkspaceNote"),
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
  figmaRuntimeInfo: document.querySelector("#figmaRuntimeInfo"),
  clientProfileSelect: document.querySelector("#clientProfileSelect"),
  clientProfileHelp: document.querySelector("#clientProfileHelp"),
  emailBaseSummary: document.querySelector("#emailBaseSummary"),
  journalSummary: document.querySelector("#journalSummary"),
  rulesMeta: document.querySelector("#rulesMeta"),
  rulesList: document.querySelector("#rulesList"),
  ruleInput: document.querySelector("#ruleInput"),
  saveRuleBtn: document.querySelector("#saveRuleBtn"),
  clearRulesBtn: document.querySelector("#clearRulesBtn"),
  clearJournalBtn: document.querySelector("#clearJournalBtn"),
  journalList: document.querySelector("#journalList"),
  // AI Lessons
  openLessonsBtn: document.querySelector("#openLessonsBtn"),
  lessonsCountBadge: document.querySelector("#lessonsCountBadge"),
  closeLessonsModalBtn: document.querySelector("#closeLessonsModalBtn"),
  closeLessonsFooterBtn: document.querySelector("#closeLessonsFooterBtn"),
  lessonsModal: document.querySelector("#lessonsModal"),
  lessonsList: document.querySelector("#lessonsList"),
  lessonMistakeInput: document.querySelector("#lessonMistakeInput"),
  lessonCorrectionInput: document.querySelector("#lessonCorrectionInput"),
  lessonCategorySelect: document.querySelector("#lessonCategorySelect"),
  saveLessonBtn: document.querySelector("#saveLessonBtn"),
  clearLessonsBtn: document.querySelector("#clearLessonsBtn"),
  // Remember last reply
  rememberLastBtn: document.querySelector("#rememberLastBtn"),
  rememberModal: document.querySelector("#rememberModal"),
  closeRememberModalBtn: document.querySelector("#closeRememberModalBtn"),
  closeRememberFooterBtn: document.querySelector("#closeRememberFooterBtn"),
  rememberMistakeInput: document.querySelector("#rememberMistakeInput"),
  rememberCorrectionInput: document.querySelector("#rememberCorrectionInput"),
  rememberCategorySelect: document.querySelector("#rememberCategorySelect"),
  saveRememberBtn: document.querySelector("#saveRememberBtn"),
  // Diff modal
  diffModal: document.querySelector("#diffModal"),
  diffModalTitle: document.querySelector("#diffModalTitle"),
  diffModalMeta: document.querySelector("#diffModalMeta"),
  diffStats: document.querySelector("#diffStats"),
  diffView: document.querySelector("#diffView"),
  closeDiffModalBtn: document.querySelector("#closeDiffModalBtn"),
  closeDiffFooterBtn: document.querySelector("#closeDiffFooterBtn"),
  confirmSaveDiffBtn: document.querySelector("#confirmSaveDiffBtn"),
  // Generation History
  openHistoryBtn: document.querySelector("#openHistoryBtn"),
  historyModal: document.querySelector("#historyModal"),
  historyList: document.querySelector("#historyList"),
  closeHistoryModalBtn: document.querySelector("#closeHistoryModalBtn"),
  closeHistoryFooterBtn: document.querySelector("#closeHistoryFooterBtn"),
  clearHistoryBtn: document.querySelector("#clearHistoryBtn"),
  // Template Browser
  openTemplateBrowserBtn: document.querySelector("#openTemplateBrowserBtn"),
  templateBrowserDrawer: document.querySelector("#templateBrowserDrawer"),
  templateBrowserBackdrop: document.querySelector("#templateBrowserBackdrop"),
  closeTemplateBrowserBtn: document.querySelector("#closeTemplateBrowserBtn"),
  templateBrowserBody: document.querySelector("#templateBrowserBody"),
  templateSearchInput: document.querySelector("#templateSearchInput"),
  testsOverview: document.querySelector("#testsOverview"),
  testsProfileGrid: document.querySelector("#testsProfileGrid"),
  testsList: document.querySelector("#testsList"),
  // Image slot panel
  imageSlotPanel: document.querySelector("#imageSlotPanel"),
  imageSlotList: document.querySelector("#imageSlotList"),
  dismissImageSlotPanel: document.querySelector("#dismissImageSlotPanel"),
  // Scaffold banner
  scaffoldBanner: document.querySelector("#scaffoldBanner"),
  scaffoldBannerText: document.querySelector("#scaffoldBannerText"),
  dismissScaffoldBanner: document.querySelector("#dismissScaffoldBanner"),
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
  refs.chatInput.addEventListener("keydown", (e) => {
    // Cmd+Enter (Mac) or Ctrl+Enter → submit
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      refs.chatForm.requestSubmit();
    }
  });
  refs.fillDemoBtn?.addEventListener("click", fillDemoScenario);
  refs.clearChatBtn.addEventListener("click", clearChatHistory);
  refs.clearStateBtn.addEventListener("click", resetState);
  refs.toggleAttachMenuBtn.addEventListener("click", toggleAttachMenu);
  refs.pasteFigmaLinkBtn.addEventListener("click", handlePasteFigmaLink);
  refs.settingsBtn.addEventListener("click", () => toggleSettings(true));
  refs.closeSettingsBtn.addEventListener("click", () => toggleSettings(false));
  refs.settingsBackdrop.addEventListener("click", () => toggleSettings(false));
  refs.loadBaseBtn.addEventListener("click", handleLoadBaseEmail);
  refs.closeDiffModalBtn.addEventListener("click", () => closeWorkspaceModal());
  refs.closeDiffFooterBtn.addEventListener("click", () => closeWorkspaceModal());
  refs.confirmSaveDiffBtn.addEventListener("click", executeSaveToEmailBase);
  refs.openHistoryBtn.addEventListener("click", openHistoryModal);
  refs.closeHistoryModalBtn.addEventListener("click", closeHistoryModal);
  refs.closeHistoryFooterBtn.addEventListener("click", closeHistoryModal);
  refs.clearHistoryBtn.addEventListener("click", handleClearHistory);
  refs.dismissImageSlotPanel?.addEventListener("click", () => {
    state.imageSlotPanelDismissed = true;
    renderImageSlotPanel();
  });
  refs.dismissScaffoldBanner?.addEventListener("click", () => {
    state.scaffoldContext = null;
    persistState();
    renderScaffoldBanner();
  });
  // Figma browse button (inside design modal Figma URL tab)
  document.getElementById("browseFigmaBtn")?.addEventListener("click", handleBrowseFigmaBtn);
  // Figma assets modal events
  bindFigmaAssetEvents();
  refs.openTemplateBrowserBtn.addEventListener("click", openTemplateBrowser);
  refs.closeTemplateBrowserBtn.addEventListener("click", closeTemplateBrowser);
  refs.templateBrowserBackdrop.addEventListener("click", closeTemplateBrowser);
  refs.templateSearchInput.addEventListener("input", renderTemplateBrowserFiltered);
  refs.openRulesBtn.addEventListener("click", openRulesModal);
  refs.createBaseMailBtn.addEventListener("click", handleCreateBaseMail);
  refs.buildBaseMailBtn.addEventListener("click", handleLoadBaseEmail);
  refs.generateLocalesBtn.addEventListener("click", handleGenerateMissingLocales);
  if (refs.generateLocalesModalBtn !== refs.generateLocalesBtn) {
    refs.generateLocalesModalBtn.addEventListener("click", handleGenerateMissingLocales);
  }
  refs.deeplAutoTranslateBtn.addEventListener("click", handleDeepLAutoTranslate);
  refs.addAssetBtn.addEventListener("click", addAssetRow);
  refs.attachDesignBtn.addEventListener("click", () => refs.designFile.click());
  refs.attachTranslationsBtn.addEventListener("click", () => refs.translationFile.click());
  refs.attachTranslationFolderBtn.addEventListener("click", () => refs.translationFolderInput.click());
  refs.attachAssetsBtn.addEventListener("click", () => refs.assetFileInput.click());
  refs.analyzeDesignBtn.addEventListener("click", handleAnalyzeDesign);
  if (refs.replaceDesignBtn) refs.replaceDesignBtn.addEventListener("click", () => refs.designFile.click());
  refs.clearDesignBtn.addEventListener("click", clearDesignWorkspace);
  refs.replaceAssetsBtn.addEventListener("click", () => refs.assetFileInput.click());
  refs.designBadge.addEventListener("click", handleDesignBadgeClick);
  refs.translationBadge.addEventListener("click", handleTranslationBadgeClick);
  refs.openLocalesBtn.addEventListener("click", handleLocalesBadgeClick);
  refs.openAssetsBtn.addEventListener("click", handleAssetsBadgeClick);
  refs.openCodeBtn.addEventListener("click", openCodeModal);
  refs.openContextBtn.addEventListener("click", openContextModal);
  refs.openDesignQuickBtn.addEventListener("click", openDesignWorkspaceModal);
  refs.openLocalesQuickBtn.addEventListener("click", openLocalesModal);
  refs.openAssetsQuickBtn.addEventListener("click", openImageWorkspaceModal);
  refs.openCodeQuickBtn.addEventListener("click", openCodeModal);
  refs.openTestsBtn.addEventListener("click", openTestsModal);
  refs.openTestsQuickBtn.addEventListener("click", openTestsModal);
  refs.openJournalBtn.addEventListener("click", openJournalModal);
  refs.openJournalFromSettingsBtn.addEventListener("click", openJournalModal);
  if (refs.openRulesFromSettingsBtn) refs.openRulesFromSettingsBtn.addEventListener("click", openRulesModal);
  if (refs.openLessonsFromSettingsBtn) refs.openLessonsFromSettingsBtn.addEventListener("click", openLessonsModal);
  refs.copyPreviewHtmlBtn.addEventListener("click", handleCopyPreviewHtml);
  refs.openBlocksBtn.addEventListener("click", scrollToBlocks);
  refs.toggleBlocksBtn.addEventListener("click", toggleBlocksSection);
  refs.hideBlocksBtn.addEventListener("click", toggleBlocksSection);
  refs.openBlockCandidatesBtn.addEventListener("click", openBlockCandidatesModal);
  refs.refreshCatalogBtn.addEventListener("click", handleRefreshBlockCatalog);
  refs.closeLocalesModalBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeLocalesFooterBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeAssetsModalBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeCodeModalBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeCodeFooterBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeRulesModalBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeRulesFooterBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeJournalModalBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeJournalFooterBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeTestsModalBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeTestsFooterBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeBlockCandidatesModalBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeBlockCandidatesFooterBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeContextModalBtn.addEventListener("click", closeWorkspaceModal);
  refs.closeContextFooterBtn.addEventListener("click", closeWorkspaceModal);
  refs.workspaceModalBackdrop.addEventListener("click", closeWorkspaceModal);
  refs.saveLocaleEditsBtn.addEventListener("click", saveLocaleEdits);
  refs.saveCodeBtn.addEventListener("click", saveCodeEdits);
  refs.toggleCodeEditBtn.addEventListener("click", handleToggleCodeEdit);
  refs.createBaseMailFromCodeBtn.addEventListener("click", handleCreateBaseMail);
  refs.saveRuleBtn.addEventListener("click", handleSaveRule);
  refs.clearRulesBtn.addEventListener("click", handleClearRules);
  refs.clearJournalBtn.addEventListener("click", handleClearJournal);
  // AI Lessons
  if (refs.openLessonsBtn) refs.openLessonsBtn.addEventListener("click", openLessonsModal);
  if (refs.closeLessonsModalBtn) refs.closeLessonsModalBtn.addEventListener("click", closeWorkspaceModal);
  if (refs.closeLessonsFooterBtn) refs.closeLessonsFooterBtn.addEventListener("click", closeWorkspaceModal);
  if (refs.saveLessonBtn) refs.saveLessonBtn.addEventListener("click", handleSaveLesson);
  if (refs.clearLessonsBtn) refs.clearLessonsBtn.addEventListener("click", handleClearLessons);
  if (refs.rememberLastBtn) refs.rememberLastBtn.addEventListener("click", openRememberModal);
  if (refs.closeRememberModalBtn) refs.closeRememberModalBtn.addEventListener("click", closeWorkspaceModal);
  if (refs.closeRememberFooterBtn) refs.closeRememberFooterBtn.addEventListener("click", closeWorkspaceModal);
  if (refs.saveRememberBtn) refs.saveRememberBtn.addEventListener("click", handleSaveRememberLesson);
  if (refs.saveDesignReferenceBtn) refs.saveDesignReferenceBtn.addEventListener("click", handleSaveDesignReference);
  if (refs.clearDesignReferenceBtn) refs.clearDesignReferenceBtn.addEventListener("click", handleClearDesignReference);
  refs.importFigmaPayloadBtn.addEventListener("click", handleImportFigmaPayload);
  refs.loadFigmaPayloadFileBtn.addEventListener("click", () => refs.figmaPayloadFileInput.click());
  refs.clearFigmaPayloadBtn.addEventListener("click", handleClearFigmaPayload);
  refs.figmaPayloadFileInput.addEventListener("change", handleFigmaPayloadFileUpload);

  // Design tab switching
  document.querySelectorAll(".design-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchDesignTab(btn.dataset.designTab));
  });

  // Figma scan
  if (refs.scanFigmaBtn) refs.scanFigmaBtn.addEventListener("click", handleScanFigma);

  // Screenshot tab paste zone - listens for paste when inside modal
  if (refs.screenshotPasteZone) {
    refs.screenshotPasteZone.addEventListener("click", () => refs.screenshotPasteZone.focus());
  }
  if (refs.uploadScreenshotBtn) {
    refs.uploadScreenshotBtn.addEventListener("click", () => refs.designFile && refs.designFile.click());
  }

  // Base email: clone & edit
  if (refs.openBaseEmailBtn) refs.openBaseEmailBtn.addEventListener("click", openBaseEmailModal);
  if (refs.uploadBaseEmailBtn) refs.uploadBaseEmailBtn.addEventListener("click", () => refs.baseEmailFileInput && refs.baseEmailFileInput.click());
  if (refs.baseEmailFileInput) refs.baseEmailFileInput.addEventListener("change", handleBaseEmailFileUpload);
  if (refs.pasteBaseEmailBtn) refs.pasteBaseEmailBtn.addEventListener("click", showBaseEmailPasteZone);
  if (refs.confirmBaseEmailPasteBtn) refs.confirmBaseEmailPasteBtn.addEventListener("click", handleBaseEmailPasteConfirm);
  if (refs.cancelBaseEmailPasteBtn) refs.cancelBaseEmailPasteBtn.addEventListener("click", hideBaseEmailPasteZone);
  if (refs.clearBaseEmailBtn) refs.clearBaseEmailBtn.addEventListener("click", clearBaseEmail);
  if (refs.clearBaseEmailInlineBtn) refs.clearBaseEmailInlineBtn.addEventListener("click", clearBaseEmail);

  // Base email drag & drop
  if (refs.baseEmailDropZone) {
    refs.baseEmailDropZone.addEventListener("dragover", (e) => { e.preventDefault(); refs.baseEmailDropZone.classList.add("is-dragover"); });
    refs.baseEmailDropZone.addEventListener("dragleave", () => refs.baseEmailDropZone.classList.remove("is-dragover"));
    refs.baseEmailDropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      refs.baseEmailDropZone.classList.remove("is-dragover");
      const file = e.dataTransfer?.files?.[0];
      if (file) loadBaseEmailFile(file);
    });
  }

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
  // Sync scroll: keep highlight aligned with textarea
  refs.codeOutput.addEventListener("scroll", () => {
    if (refs.codeHighlight) {
      refs.codeHighlight.scrollTop = refs.codeOutput.scrollTop;
      refs.codeHighlight.scrollLeft = refs.codeOutput.scrollLeft;
    }
  });
  bindChatDropTargets();
  window.addEventListener("resize", positionHelpTips);

  refs.themeSelect.addEventListener("change", () => {
    state.settings.theme = refs.themeSelect.value;
    applyTheme();
    persistState();
  });

  refs.providerSelect.addEventListener("change", () => {
    state.settings.providerId = refs.providerSelect.value;
    state.providerRuntime = null;
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
      renderCode();
      persistState();
    });
  }

  for (const tab of refs.codeTabs) {
    tab.addEventListener("click", () => {
      state.activeTab = tab.dataset.tab;
      syncCodeSelectionWithPreviewLocale();
      syncCodeEditorBufferForActiveContext(true);
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
    await loadProjectRules();
    await loadJournal();
  } catch {
    state.api = {
      openAiConfigured: false,
      model: "unavailable",
      config: null,
      providers: [],
      clientProfiles: [],
      figma: null,
      emailBase: null,
      blockCatalog: null,
      assetRegistry: null,
      projectRules: null,
      journal: null
    };
    state.blockCatalog = structuredClone(initialState.blockCatalog);
    state.assetRegistry = structuredClone(initialState.assetRegistry);
    state.projectRules = structuredClone(initialState.projectRules);
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

async function loadProjectRules() {
  const response = await fetch("/api/project-rules");
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Project rules request failed");
  }

  state.projectRules = {
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
      providerRuntime: saved.providerRuntime ?? null,
      designAnalysis: saved.designAnalysis ?? null,
      figmaScanResult: saved.figmaScanResult ?? null,
      baseEmailHtml: saved.baseEmailHtml ?? null,
      baseEmailFileName: saved.baseEmailFileName ?? "",
      baseEmailContentMap: saved.baseEmailContentMap ?? null,
      scaffoldContext: saved.scaffoldContext ?? null,
      previewLocale: cleanText(saved.previewLocale),
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
    previewLocale: state.previewLocale,
    providerRuntime: state.providerRuntime,
    settings: state.settings,
    brief: state.brief,
    design: state.design,
    designAnalysis: state.designAnalysis,
    translationText: state.translationText,
    translationUploadStatus: state.translationUploadStatus,
    assetInputs: state.assetInputs,
    messages: state.messages,
    draft,
    scaffoldContext: state.scaffoldContext || null
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

function getAvailableDraftLocales() {
  const actualLocales = [
    ...Object.keys(state.draft?.previewLocales || {}),
    ...Object.keys(state.draft?.localePayloads || {}),
    ...(Array.isArray(state.draft?.mail?.translations) ? state.draft.mail.translations.map((entry) => cleanText(entry.locale)) : [])
  ].filter(Boolean);
  const dedupedActualLocales = Array.from(new Set(actualLocales));
  const requestedLocales = [
    cleanText(state.previewLocale),
    cleanText(state.brief.locale),
    cleanText(state.draft?.mail?.locale)
  ].filter(Boolean);

  const extras = requestedLocales.filter((locale) => !hasLocaleMatch(dedupedActualLocales, locale));
  return Array.from(new Set([...dedupedActualLocales, ...extras]));
}

function ensurePreviewLocale() {
  const locales = getAvailableDraftLocales();
  const current = cleanText(state.previewLocale);
  if (!current || !hasLocaleMatch(locales, current)) {
    state.previewLocale = locales[0] || cleanText(state.brief.locale || state.draft?.mail?.locale || "");
  }
}

function getCurrentPreviewLocale() {
  ensurePreviewLocale();
  const requested = cleanText(state.previewLocale || state.brief.locale || state.draft?.mail?.locale || "");
  return resolveMatchingLocale(getAvailableDraftLocales(), requested);
}

function getCurrentPreviewHtml() {
  const locale = getCurrentPreviewLocale();
  return cleanText(state.draft?.previewLocales?.[locale]) || cleanText(state.draft?.html) || emptyPreview();
}

function getCurrentLocalePayload() {
  const locale = getCurrentPreviewLocale();
  const payload = state.draft?.localePayloads?.[locale];
  return payload
    ? JSON.stringify({ locale, ...payload }, null, 2)
    : (state.draft?.locales || "Код появится после первого draft или build.");
}

function getCurrentLocaleBuildLog() {
  const locale = getCurrentPreviewLocale();
  return cleanText(state.draft?.localeBuildLogs?.[locale]) || cleanText(state.draft?.buildLog) || "Build log появится после первого build.";
}

function isCodeLocaleAwareTab(tab) {
  return ["html", "locales", "buildLog"].includes(cleanText(tab));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getCodeFileBaseName(filePath) {
  return cleanText(filePath).split("/").pop() || "file";
}

function inferCodeFileLanguage(file) {
  const tab = cleanText(file?.tab);
  const explicit = cleanText(file?.language);
  const filePath = cleanText(file?.path).toLowerCase();

  if (explicit) {
    return explicit;
  }
  if (tab === "pug") {
    return "pug";
  }
  if (tab === "stylus") {
    return filePath.endsWith(".css") ? "css" : "stylus";
  }
  if (tab === "html") {
    return "html";
  }
  if (tab === "locales" || tab === "assets" || tab === "spec") {
    return "json";
  }
  if (tab === "buildLog") {
    return "log";
  }
  return "text";
}

function createVirtualCodeFile(entry, index = 0) {
  const tab = cleanText(entry?.tab) || "spec";
  const locale = cleanText(entry?.locale);
  const path = cleanText(entry?.path) || `${tab}/file-${index + 1}.txt`;
  return {
    id: cleanText(entry?.id) || `${tab}:${locale || "default"}:${path}`,
    tab,
    locale,
    path,
    label: cleanText(entry?.label) || getCodeFileBaseName(path),
    language: inferCodeFileLanguage(entry),
    editable: entry?.editable !== false,
    mailRelativePath: cleanText(entry?.mailRelativePath),
    sourcePath: cleanText(entry?.sourcePath),
    content: typeof entry?.content === "string" ? entry.content : JSON.stringify(entry?.content || {}, null, 2)
  };
}

function getDraftWorkspaceFiles() {
  return Array.isArray(state.draft?.workspaceFiles)
    ? state.draft.workspaceFiles.map((file, index) => createVirtualCodeFile(file, index))
    : [];
}

function buildFallbackCodeFilesForTab(tab) {
  if (!state.draft) {
    return [];
  }

  if (tab === "html") {
    const previewLocales = state.draft.previewLocales && typeof state.draft.previewLocales === "object"
      ? Object.entries(state.draft.previewLocales)
      : [];
    if (previewLocales.length > 0) {
      return previewLocales.map(([locale, content], index) => createVirtualCodeFile({
        tab: "html",
        locale,
        path: `preview/${locale}.html`,
        label: `${locale}.html`,
        content
      }, index));
    }
    return [createVirtualCodeFile({
      tab: "html",
      locale: getCurrentPreviewLocale(),
      path: "preview/current.html",
      label: "current.html",
      content: getCurrentPreviewHtml()
    })];
  }

  if (tab === "locales") {
    const localePayloads = state.draft.localePayloads && typeof state.draft.localePayloads === "object"
      ? Object.entries(state.draft.localePayloads)
      : [];
    if (localePayloads.length > 0) {
      return localePayloads.map(([locale, content], index) => createVirtualCodeFile({
        tab: "locales",
        locale,
        path: `locales/${locale}.json`,
        label: `${locale}.json`,
        content
      }, index));
    }
    return [createVirtualCodeFile({
      tab: "locales",
      locale: getCurrentPreviewLocale(),
      path: "locales/bundle.json",
      label: "bundle.json",
      content: state.draft.locales || "Локали появятся после первого build."
    })];
  }

  if (tab === "buildLog") {
    const buildLogs = state.draft.localeBuildLogs && typeof state.draft.localeBuildLogs === "object"
      ? Object.entries(state.draft.localeBuildLogs)
      : [];
    if (buildLogs.length > 0) {
      return buildLogs.map(([locale, content], index) => createVirtualCodeFile({
        tab: "buildLog",
        locale,
        path: `logs/${locale}.log`,
        label: `${locale}.log`,
        editable: false,
        content
      }, index));
    }
    return [createVirtualCodeFile({
      tab: "buildLog",
      locale: getCurrentPreviewLocale(),
      path: "logs/build.log",
      label: "build.log",
      editable: false,
      content: getCurrentLocaleBuildLog()
    })];
  }

  if (tab === "pug") {
    return [createVirtualCodeFile({
      tab: "pug",
      path: "app/templates/index.pug",
      label: "index.pug",
      mailRelativePath: "app/templates/index.pug",
      content: state.draft.pug || "Pug появится после первого build."
    })];
  }

  if (tab === "stylus") {
    return [createVirtualCodeFile({
      tab: "stylus",
      path: "app/styles/common.styl",
      label: "common.styl",
      mailRelativePath: "app/styles/common.styl",
      content: state.draft.stylus || "Stylus пока не загружен. Он появится после реального email-base build."
    })];
  }

  if (tab === "assets") {
    return [createVirtualCodeFile({
      tab: "assets",
      path: "studio/assets.json",
      label: "assets.json",
      content: state.draft.assetsManifest || "{}"
    })];
  }

  return [createVirtualCodeFile({
    tab: "spec",
    path: "studio/mail-spec.json",
    label: "mail-spec.json",
    content: state.draft.spec || "{}"
  })];
}

function getCodeFilesForTab(tab = state.activeTab) {
  const workspaceFiles = getDraftWorkspaceFiles().filter((file) => file.tab === tab);
  if (workspaceFiles.length > 0) {
    return workspaceFiles;
  }
  return buildFallbackCodeFilesForTab(tab);
}

function getPreferredCodeFileId(tab = state.activeTab) {
  const files = getCodeFilesForTab(tab);
  if (files.length === 0) {
    return "";
  }

  const remembered = cleanText(state.codeFileSelection?.[tab]);
  if (remembered && files.some((file) => file.id === remembered)) {
    return remembered;
  }

  if (isCodeLocaleAwareTab(tab)) {
    const locale = getCurrentPreviewLocale();
    const localeFile = files.find((file) => cleanText(file.locale) === locale);
    if (localeFile) {
      return localeFile.id;
    }
  }

  const indexFile = files.find((file) => /(^|\/)index\.(pug|jade|html)$/i.test(cleanText(file.path)));
  if (indexFile) {
    return indexFile.id;
  }

  const commonStyleFile = files.find((file) => /(^|\/)common\.(styl|css)$/i.test(cleanText(file.path)));
  if (commonStyleFile) {
    return commonStyleFile.id;
  }

  return files[0].id;
}

function getCurrentCodeFile(tab = state.activeTab) {
  const files = getCodeFilesForTab(tab);
  if (files.length === 0) {
    return null;
  }

  const selectedId = getPreferredCodeFileId(tab);
  state.codeFileSelection[tab] = selectedId;
  return files.find((file) => file.id === selectedId) || files[0];
}

function syncCodeSelectionWithPreviewLocale() {
  if (!isCodeLocaleAwareTab(state.activeTab)) {
    return;
  }

  const files = getCodeFilesForTab(state.activeTab);
  const locale = getCurrentPreviewLocale();
  const localeFile = files.find((file) => cleanText(file.locale) === locale);
  if (localeFile) {
    state.codeFileSelection[state.activeTab] = localeFile.id;
  }
}

function syncCodeEditorBufferForActiveContext(force = false) {
  const activeFile = getCurrentCodeFile();
  const nextValue = cleanText(activeFile?.content) || "Код появится после первого draft или build.";

  if (force || !state.codeEditorBuffer || refs.codeModal.getAttribute("aria-hidden") !== "false") {
    state.codeEditorBuffer = nextValue;
  }
}

function resetCodeWorkspaceSelection() {
  state.codeFileSelection = {};
  state.codeEditorBuffer = "";
}

function setPreviewLocale(locale) {
  state.previewLocale = locale;
  syncCodeSelectionWithPreviewLocale();
  syncCodeEditorBufferForActiveContext(true);
  renderSummary();
  renderPreviewLocaleTabs();
  renderPreview();
  renderCode();
  persistState();
}

function highlightJsonCode(source) {
  return escapeHtml(source)
    .split("\n")
    .map((line) => {
      let html = line;
      html = html.replace(/("(?:\\.|[^"\\])*")(\s*:)/g, '<span class="code-token key">$1</span>$2');
      html = html.replace(/:\s*("(?:\\.|[^"\\])*")/g, ': <span class="code-token string">$1</span>');
      html = html.replace(/\b(true|false|null)\b/g, '<span class="code-token atom">$1</span>');
      html = html.replace(/\b(-?\d+(?:\.\d+)?)\b/g, '<span class="code-token number">$1</span>');
      return `<span class="code-line">${html}</span>`;
    })
    .join("");
}

function highlightHtmlCode(source) {
  return source
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("<!--") && trimmed.endsWith("-->")) {
        return `<span class="code-line"><span class="code-token comment">${escapeHtml(line)}</span></span>`;
      }

      const escaped = escapeHtml(line).replace(/&lt;[^&]*?&gt;/g, (tag) => {
        let nextTag = tag.replace(/^(&lt;\/?)([A-Za-z0-9:-]+)/, '$1<span class="code-token tag">$2</span>');
        nextTag = nextTag.replace(/\s([A-Za-z-:]+)(=)/g, ' <span class="code-token attr">$1</span>$2');
        nextTag = nextTag.replace(/=(&quot;[^"]*?&quot;)/g, '=<span class="code-token string">$1</span>');
        return nextTag;
      });

      return `<span class="code-line">${escaped || "&nbsp;"}</span>`;
    })
    .join("");
}

function highlightPugLikeCode(source) {
  return source
    .split("\n")
    .map((line) => {
      let html = escapeHtml(line);
      if (/^\s*\/\/-?/.test(line)) {
        return `<span class="code-line"><span class="code-token comment">${html}</span></span>`;
      }

      html = html.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, '<span class="code-token string">$1</span>');
      html = html.replace(/^(\s*)(include|extends|block|append|prepend|mixin|each|if|else|doctype|case|when|default)\b/, '$1<span class="code-token keyword">$2</span>');
      html = html.replace(/(^|\s)(\.[A-Za-z0-9_-]+|#[A-Za-z0-9_-]+)/g, '$1<span class="code-token selector">$2</span>');
      return `<span class="code-line">${html || "&nbsp;"}</span>`;
    })
    .join("");
}

function highlightStylusLikeCode(source) {
  return source
    .split("\n")
    .map((line) => {
      let html = escapeHtml(line);
      if (/^\s*\/\//.test(line)) {
        return `<span class="code-line"><span class="code-token comment">${html}</span></span>`;
      }

      html = html.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, '<span class="code-token string">$1</span>');
      html = html.replace(/\b(@media|@supports|@import|@font-face|@require)\b/g, '<span class="code-token keyword">$1</span>');
      html = html.replace(/^(\s*[.#@]?[A-Za-z0-9_-][^{;]*)$/, (full) => /:\s/.test(full) ? full : `<span class="code-token selector">${full}</span>`);
      html = html.replace(/^(\s*)([A-Za-z-]+)(?=\s*:)/, '$1<span class="code-token attr">$2</span>');
      html = html.replace(/\b(-?\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw)?)\b/g, '<span class="code-token number">$1</span>');
      return `<span class="code-line">${html || "&nbsp;"}</span>`;
    })
    .join("");
}

function highlightLogCode(source) {
  return escapeHtml(source)
    .split("\n")
    .map((line) => {
      if (/\berror|failed|exception\b/i.test(line)) {
        return `<span class="code-line"><span class="code-token danger">${line}</span></span>`;
      }
      if (/\bwarning|warn|missing|gap\b/i.test(line)) {
        return `<span class="code-line"><span class="code-token warning">${line}</span></span>`;
      }
      if (/\bok|success|built|completed|loaded\b/i.test(line)) {
        return `<span class="code-line"><span class="code-token success">${line}</span></span>`;
      }
      return `<span class="code-line">${line || "&nbsp;"}</span>`;
    })
    .join("");
}

function renderHighlightedCode(source, language) {
  if (language === "json") {
    return highlightJsonCode(source);
  }
  if (language === "html") {
    return highlightHtmlCode(source);
  }
  if (language === "pug") {
    return highlightPugLikeCode(source);
  }
  if (language === "stylus" || language === "css") {
    return highlightStylusLikeCode(source);
  }
  if (language === "log") {
    return highlightLogCode(source);
  }
  return escapeHtml(source);
}

function resetState() {
  localStorage.removeItem(storageKey);
  Object.assign(state, structuredClone(initialState));
  resetCodeWorkspaceSelection();
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

function normalizeLocaleTag(locale) {
  return cleanText(locale).replaceAll("-", "_").toLowerCase();
}

function localeMatchesRequest(existingLocale, requestedLocale) {
  const existing = normalizeLocaleTag(existingLocale);
  const requested = normalizeLocaleTag(requestedLocale);

  if (!existing || !requested) {
    return false;
  }

  if (existing === requested) {
    return true;
  }

  const existingParts = existing.split("_");
  const requestedParts = requested.split("_");
  return requestedParts.length === 1 && existingParts[0] === requestedParts[0];
}

function hasLocaleMatch(locales, requestedLocale) {
  return locales.some((locale) => localeMatchesRequest(locale, requestedLocale));
}

function resolveMatchingLocale(locales, requestedLocale) {
  const requested = cleanText(requestedLocale);
  if (!requested) {
    return locales[0] || "";
  }

  return locales.find((locale) => normalizeLocaleTag(locale) === normalizeLocaleTag(requested))
    || locales.find((locale) => localeMatchesRequest(locale, requested))
    || requested;
}

function toggleAttachMenu() {
  state.chatAttachMenuOpen = !state.chatAttachMenuOpen;
  renderChatIntake();
  persistState();
}

function handleDesignBadgeClick() {
  if (detectDesignInputKind() === "none") {
    refs.designFile.click();
    return;
  }

  openDesignWorkspaceModal();
}

function handleTranslationBadgeClick() {
  if (getParsedLocaleEntries().length === 0) {
    refs.translationFile.click();
    return;
  }

  openLocalesModal();
}

function handleLocalesBadgeClick() {
  if (getParsedLocaleEntries().length === 0) {
    refs.translationFile.click();
    return;
  }

  openLocalesModal();
}

function handleAssetsBadgeClick() {
  const assetsCount = state.assetInputs.filter((asset) => asset.url).length;
  if (assetsCount === 0) {
    refs.assetFileInput.click();
    return;
  }

  openImageWorkspaceModal();
}

async function handlePasteFigmaLink() {
  let candidate = "";

  try {
    candidate = extractFigmaLinkFromText(await navigator.clipboard.readText());
  } catch {
    candidate = "";
  }

  if (!candidate) {
    candidate = extractFigmaLinkFromText(window.prompt("Вставь ссылку на Figma frame", "") || "");
  }

  if (!candidate) {
    return;
  }

  if (!parseFigmaReferenceUrl(candidate)) {
    state.translationUploadStatus = "Это не похоже на Figma frame link.";
    renderTranslationUploadStatus();
    return;
  }

  setDesignReferenceUrl(candidate);
  state.designAnalysis = null;
  state.translationUploadStatus = "Figma frame link сохранен. Если frame приватный, следующий шаг: open draft/share link или скрин/export.";
  state.messages.push({
    role: "assistant",
    content: "Сохранил Figma frame link. Если frame приватный, пришли open draft/share link или просто скрин/export выбранного frame."
  });
  renderAll();
  persistState();
}

async function handleCopyPreviewHtml() {
  const html = getCurrentPreviewHtml();
  if (!cleanText(html)) {
    return;
  }

  try {
    await navigator.clipboard.writeText(html);
    state.messages.push({
      role: "assistant",
      content: `Скопировал HTML для локали ${getCurrentPreviewLocale() || cleanText(state.brief.locale || "en")} в буфер обмена.`
    });
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Не смог скопировать HTML: ${error.message}`
    });
  }

  renderAll();
  persistState();
}

function clearDesignWorkspace() {
  state.design = structuredClone(initialState.design);
  state.brief.designUrl = "";
  state.designAnalysis = null;
  state.translationUploadStatus = "Макет очищен.";
  renderAll();
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
  state.design = structuredClone(initialState.design);
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

async function applyDesignFile(file, sourceLabel = "", options = {}) {
  const [entry] = await registerFilesInAssetRegistry([file], {
    kind: "design",
    placement: "reference",
    notes: sourceLabel || "chat intake"
  });

  state.design = {
    ...state.design,
    name: entry?.label || file.name,
    dataUrl: getPreferredAssetUrl(entry),
    assetId: entry?.id || ""
  };
  state.designAnalysis = null;
  state.chatAttachMenuOpen = false;
  if (options.resetAssetInputs) {
    state.assetInputs = [createEmptyAsset(1)];
  }
  removeDesignFromAssetInputs();
  if (!options.skipStatus) {
    state.translationUploadStatus = sourceLabel
      ? `Design attached from ${sourceLabel}.`
      : `${file.name} загружен как design reference.`;
  }
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

  // 1. Image files — e.g. Figma "Copy as PNG" (Shift+Cmd+C)
  const files = items
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(Boolean);

  if (files.length > 0) {
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
    return;
  }

  // 2. Detect pasted text — Figma URL or HTML email
  const textItem = items.find((item) => item.kind === "string" && item.type === "text/plain");
  if (textItem) {
    textItem.getAsString((text) => {
      const trimmed = text.trim();

      // 2a. HTML email code → offer Clone & Edit
      const looksLikeHtml = /^<!doctype\s+html|^<html[\s>]|<table[\s>].*<\/table>/is.test(trimmed)
        && trimmed.length > 200;
      if (looksLikeHtml) {
        event.preventDefault();
        processBaseEmailHtml(trimmed, "pasted-email.html");
        state.messages.push({
          role: "assistant",
          content: "📧 Вижу HTML письма — загружаю как base email. Напиши что нужно поменять: текст, ссылки, картинки, добавить/убрать блоки."
        });
        renderAll();
        persistState();
        return;
      }

      // 2b. Pure Figma URL (nothing else in clipboard) → auto-open browse modal
      const isFigmaUrl = /^https?:\/\/(www\.)?figma\.com\/(design|file|proto)\//.test(trimmed)
        && !trimmed.includes("\n")
        && trimmed === trimmed.trim();
      if (isFigmaUrl) {
        event.preventDefault();
        // Save as design reference
        setDesignReferenceUrl(trimmed);
        // Populate the URL input in the design modal so Browse can read it
        const urlInput = document.getElementById("designReferenceUrlInput");
        if (urlInput) urlInput.value = trimmed;
        // Trigger browse flow — opens the frames modal automatically
        handleBrowseFigmaBtn();
        return;
      }

      // Otherwise let default text paste work normally
    });
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

function buildChatFileIntakeStatus({
  sourceLabel = "",
  translationCount = 0,
  designCount = 0,
  assetCount = 0,
  singleImageBecameAsset = false
} = {}) {
  const source = cleanText(sourceLabel) || "chat intake";
  const parts = [];

  if (translationCount > 0) {
    parts.push(`${translationCount} locale file(s)`);
  }

  if (designCount > 0 && assetCount > 0) {
    parts.push(`1 design reference + ${assetCount} image asset(s)`);
  } else if (designCount > 0) {
    parts.push("1 design reference");
  } else if (assetCount > 0) {
    parts.push(`${assetCount} image asset(s)`);
  }

  if (parts.length === 0) {
    return "Поддерживаются translation files и изображения.";
  }

  if (singleImageBecameAsset) {
    return `Из ${source} добавил ${parts.join(" и ")}. Действующий design уже был загружен, поэтому картинка ушла в assets, а не заменила макет.`;
  }

  return `Из ${source} распознал и сохранил: ${parts.join(" и ")}.`;
}

async function applyChatFiles(files, sourceLabel = "") {
  const translationFiles = filterTranslationFiles(files);
  const imageFiles = files.filter(isImageFile);
  const designShouldBeCaptured = shouldTreatFirstImageAsDesign();
  let designCount = 0;
  let assetCount = 0;

  if (translationFiles.length > 0) {
    await applyTranslationFiles(translationFiles, sourceLabel || "chat intake", { skipStatus: true });
  }

  if (imageFiles.length > 0) {
    if (translationFiles.length === 0 && imageFiles.length === 1 && designShouldBeCaptured) {
      await applyDesignFile(imageFiles[0], sourceLabel || "chat intake", {
        resetAssetInputs: true,
        skipStatus: true
      });
      designCount = 1;
    } else if (translationFiles.length === 0 && imageFiles.length === 1) {
      await applyAssetFiles(imageFiles, sourceLabel || "chat intake", { skipStatus: true });
      assetCount = 1;
    } else {
      const [designCandidate, ...assetCandidates] = designShouldBeCaptured
        ? imageFiles
        : [null, ...imageFiles];

      if (designCandidate) {
        await applyDesignFile(designCandidate, sourceLabel || "chat intake", { skipStatus: true });
        designCount = 1;
      }

      if (assetCandidates.length > 0) {
        await applyAssetFiles(assetCandidates, sourceLabel || "chat intake", { skipStatus: true });
        assetCount = assetCandidates.length;
      }
    }
  }

  if (translationFiles.length === 0 && imageFiles.length === 0) {
    state.translationUploadStatus = "Поддерживаются translation files и изображения.";
    renderTranslationUploadStatus();
    persistState();
    return;
  }

  state.translationUploadStatus = buildChatFileIntakeStatus({
    sourceLabel,
    translationCount: translationFiles.length,
    designCount,
    assetCount,
    singleImageBecameAsset: imageFiles.length === 1 && designCount === 0 && assetCount === 1
  });
  renderTranslationUploadStatus();
  renderAttachmentSummary();
  persistState();
}

function applyReferenceLinksFromText(text, options = {}) {
  const urls = extractUrlsFromText(text);
  if (urls.length === 0) {
    return false;
  }

  const imageUrl = urls.find(looksLikeImageUrl);
  const figmaUrl = urls.find((url) => /figma\.com/i.test(url));
  const chosen = imageUrl || figmaUrl || urls[0];
  setDesignReferenceUrl(chosen);
  state.designAnalysis = null;
  state.translationUploadStatus = imageUrl
    ? "Сохранил ссылку на design/image reference из сообщения."
    : figmaUrl
      ? "Сохранил Figma link как design reference."
      : "Сохранил ссылку как reference для письма.";
  if (options.announce !== false) {
    state.messages.push({
      role: "assistant",
      content: imageUrl
        ? "Вижу ссылку на изображение. Сохранил ее как design reference."
        : figmaUrl
          ? "Вижу Figma link — сохранил как design reference. Можешь описать задачу, или вставь ссылку отдельной строкой чтобы сразу открыть нарезку фреймов."
          : "Сохранил ссылку как reference."
    });
  }
  return true;
}

function handleSaveDesignReference() {
  const nextUrl = cleanText(refs.designReferenceUrlInput.value);
  setDesignReferenceUrl(nextUrl);
  state.designAnalysis = null;
  state.translationUploadStatus = nextUrl
    ? "Design reference URL сохранен."
    : "Design reference URL очищен.";

  if (nextUrl) {
    state.messages.push({
      role: "assistant",
      content: /figma\.com/i.test(nextUrl)
        ? "Сохранил Figma frame как design reference. Если это приватный frame, для надежного разбора пришли open draft link или скрин/export."
        : looksLikeImageUrl(nextUrl)
          ? "Сохранил public image export как design reference."
          : "Сохранил reference URL как часть design context."
    });
  }

  renderAll();
  persistState();
}

function handleImportFigmaPayload() {
  const rawText = cleanText(refs.figmaPayloadInput.value);
  if (!rawText) {
    state.translationUploadStatus = "Вставь JSON export из Figma plugin/API перед импортом.";
    renderTranslationUploadStatus();
    return;
  }

  try {
    const imported = summarizeFigmaImportPayload(rawText, state.brief.designUrl);
    state.design = {
      ...state.design,
      figmaFileKey: imported.fileKey,
      figmaNodeId: imported.nodeId,
      figmaSelectionName: imported.selectionName,
      figmaImport: imported
    };
    if (!cleanText(state.brief.designUrl) && imported.fileKey) {
      const nodeParam = imported.nodeId ? `?node-id=${encodeURIComponent(imported.nodeId.replace(/:/g, "-"))}` : "";
      state.brief.designUrl = `https://www.figma.com/file/${imported.fileKey}/${slugify(imported.selectionName || "frame")}${nodeParam}`;
    } else {
      updateDesignFigmaReference(state.brief.designUrl);
    }
    state.designAnalysis = null;
    state.translationUploadStatus = "Structured Figma payload imported. Studio can now use file/frame/layer/text context.";
    refs.figmaPayloadInput.value = "";
    renderAll();
    persistState();
  } catch (error) {
    state.translationUploadStatus = `Не смог распарсить Figma JSON: ${error.message}`;
    renderTranslationUploadStatus();
  }
}

async function handleFigmaPayloadFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    refs.figmaPayloadInput.value = await readFileAsText(file);
    handleImportFigmaPayload();
  } catch (error) {
    state.translationUploadStatus = `Не смог прочитать Figma JSON: ${error.message}`;
    renderTranslationUploadStatus();
  }

  event.target.value = "";
}

function handleClearFigmaPayload() {
  state.design = {
    ...state.design,
    figmaImport: null,
    figmaSelectionName: cleanText(parseFigmaReferenceUrl(state.brief.designUrl)?.selectionName),
    figmaFileKey: cleanText(parseFigmaReferenceUrl(state.brief.designUrl)?.fileKey),
    figmaNodeId: cleanText(parseFigmaReferenceUrl(state.brief.designUrl)?.nodeId)
  };
  state.designAnalysis = null;
  state.translationUploadStatus = "Structured Figma payload cleared.";
  renderAll();
  persistState();
}

function handleClearDesignReference() {
  setDesignReferenceUrl("");
  state.designAnalysis = null;
  state.translationUploadStatus = "Design reference URL очищен.";
  renderAll();
  persistState();
}

// ── Design tabs ──────────────────────────────────────────────────

function switchDesignTab(tab) {
  state.designTab = tab || "figma";
  const tabFigma = document.querySelector("#designTabFigma");
  const tabScreenshot = document.querySelector("#designTabScreenshot");
  if (tabFigma) tabFigma.hidden = (tab !== "figma");
  if (tabScreenshot) tabScreenshot.hidden = (tab !== "screenshot");
  document.querySelectorAll(".design-tab-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.designTab === tab);
  });
}

async function handleScanFigma() {
  const url = cleanText(refs.designReferenceUrlInput?.value);
  if (!url || !/figma\.com/i.test(url)) {
    if (refs.figmaScanStatus) refs.figmaScanStatus.textContent = "Вставь Figma URL выше.";
    if (refs.figmaScanResult) refs.figmaScanResult.hidden = false;
    return;
  }

  if (refs.figmaScanStatus) refs.figmaScanStatus.textContent = "Сканирую Figma...";
  if (refs.figmaScanBody) refs.figmaScanBody.innerHTML = "";
  if (refs.figmaScanResult) refs.figmaScanResult.hidden = false;
  if (refs.scanFigmaBtn) refs.scanFigmaBtn.disabled = true;

  try {
    const resp = await fetch("/api/figma/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const data = await resp.json();

    if (!resp.ok || data.error) {
      if (refs.figmaScanStatus) refs.figmaScanStatus.textContent = `Ошибка: ${data.error || "Не удалось получить данные"}`;
      if (refs.figmaScanBody) refs.figmaScanBody.textContent = "Убедись что ссылка публичная (Share → Anyone with the link can view) или что FIGMA_API_TOKEN задан в .env";
      return;
    }

    state.figmaScanResult = data;
    // Save the URL as design reference
    setDesignReferenceUrl(url);

    const { summary, texts, components } = data;
    if (refs.figmaScanStatus) {
      refs.figmaScanStatus.textContent = `✓ Найдено: ${summary.layerCount} слоёв, ${summary.textCount} текстов, ${summary.componentCount} компонентов`;
    }

    if (refs.figmaScanBody) {
      const lines = [];
      if (components?.length) {
        lines.push(`<div class="figma-scan-section">Компоненты (${components.length})</div>`);
        components.slice(0, 8).forEach((c) => {
          lines.push(`<div class="figma-scan-item">${escHtml(c)}</div>`);
        });
      }
      if (texts?.length) {
        lines.push(`<div class="figma-scan-section">Тексты (${texts.length})</div>`);
        texts.slice(0, 12).forEach((t) => {
          lines.push(`<div class="figma-scan-item">${escHtml(String(t).slice(0, 120))}</div>`);
        });
      }
      if (!lines.length) lines.push('<div class="figma-scan-item">Данные получены, но слои не распознаны. Попробуй "Copy as PNG" и переключись на вкладку Screenshot.</div>');
      refs.figmaScanBody.innerHTML = lines.join("");
    }

    state.messages.push({
      role: "assistant",
      content: `Просканировал Figma frame: нашёл ${summary.layerCount} слоёв, ${summary.textCount} текстов, ${summary.componentCount} компонентов. Данные добавлены в контекст — теперь говори что собрать.`
    });
    renderAll();
    persistState();
  } catch (err) {
    if (refs.figmaScanStatus) refs.figmaScanStatus.textContent = `Ошибка: ${err.message}`;
  } finally {
    if (refs.scanFigmaBtn) refs.scanFigmaBtn.disabled = false;
  }
}

// ── Base email: Clone & Edit ─────────────────────────────────────

function openBaseEmailModal() {
  state.assetsWorkspaceView = "design";
  openWorkspaceModal("assets");
  // Scroll to base email section
  setTimeout(() => {
    document.querySelector("#baseEmailSection")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, 150);
}

async function loadBaseEmailFile(file) {
  if (!file) return;
  const html = await readFileAsText(file);
  await processBaseEmailHtml(html, file.name);
}

async function handleBaseEmailFileUpload() {
  const file = refs.baseEmailFileInput?.files?.[0];
  if (!file) return;
  await loadBaseEmailFile(file);
  if (refs.baseEmailFileInput) refs.baseEmailFileInput.value = "";
}

function showBaseEmailPasteZone() {
  if (refs.baseEmailPasteZone) refs.baseEmailPasteZone.hidden = false;
  if (refs.baseEmailPasteInput) refs.baseEmailPasteInput.focus();
}

function hideBaseEmailPasteZone() {
  if (refs.baseEmailPasteZone) refs.baseEmailPasteZone.hidden = true;
  if (refs.baseEmailPasteInput) refs.baseEmailPasteInput.value = "";
}

async function handleBaseEmailPasteConfirm() {
  const html = refs.baseEmailPasteInput?.value?.trim() || "";
  if (!html) return;
  await processBaseEmailHtml(html, "pasted-email.html");
  hideBaseEmailPasteZone();
}

async function processBaseEmailHtml(html, filename) {
  if (!html || html.length < 50) return;

  // Extract content map via server
  let contentMap = null;
  try {
    const resp = await fetch("/api/email/extract-content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html })
    });
    const data = await resp.json();
    if (data.ok) contentMap = data.contentMap;
  } catch { /* fallback: no content map */ }

  state.baseEmailHtml = html;
  state.baseEmailFileName = filename || "email.html";
  state.baseEmailContentMap = contentMap;

  renderBaseEmailState();
  persistState();

  state.messages.push({
    role: "assistant",
    content: contentMap
      ? `Загрузил базовое письмо "${filename}" — нашёл ${contentMap.sectionCount} текстовых блоков, ${contentMap.images?.length || 0} картинок, ${contentMap.links?.length || 0} ссылок. Скажи что нужно изменить — заменю текст, ссылки или картинки, сохранив вёрстку.`
      : `Загрузил базовое письмо "${filename}". Скажи что нужно изменить.`
  });
  renderMessages();
}

function clearBaseEmail() {
  state.baseEmailHtml = null;
  state.baseEmailFileName = "";
  state.baseEmailContentMap = null;
  renderBaseEmailState();
  persistState();
}

function renderBaseEmailState() {
  const hasEmail = Boolean(state.baseEmailHtml);
  if (refs.baseEmailEmptyState) refs.baseEmailEmptyState.hidden = hasEmail;
  if (refs.baseEmailLoadedState) refs.baseEmailLoadedState.hidden = !hasEmail;
  if (refs.clearBaseEmailBtn) refs.clearBaseEmailBtn.hidden = !hasEmail;
  if (refs.openBaseEmailBtn) refs.openBaseEmailBtn.classList.toggle("has-content", hasEmail);

  if (!hasEmail) return;

  if (refs.baseEmailFileName) refs.baseEmailFileName.textContent = state.baseEmailFileName || "email.html";

  const map = state.baseEmailContentMap;
  if (refs.baseEmailStats) {
    refs.baseEmailStats.textContent = map
      ? `${map.sectionCount} блоков · ${map.images?.length || 0} картинок · ${map.links?.length || 0} ссылок · ${Math.round((state.baseEmailHtml?.length || 0) / 1024)}KB`
      : `${Math.round((state.baseEmailHtml?.length || 0) / 1024)}KB`;
  }

  if (refs.baseEmailContentMap && map) {
    const groups = [];

    if (map.subject) {
      groups.push(`<div class="base-email-section-group">
        <div class="base-email-section-label">Тема</div>
        <div class="base-email-section-item">${escHtml(map.subject)}</div>
      </div>`);
    }

    if (map.sections?.length) {
      const items = map.sections.slice(0, 8).map((s) =>
        `<div class="base-email-section-item">${escHtml(s.slice(0, 100))}</div>`
      ).join("");
      groups.push(`<div class="base-email-section-group">
        <div class="base-email-section-label">Текст (${map.sections.length})</div>
        ${items}
      </div>`);
    }

    if (map.images?.length) {
      const items = map.images.slice(0, 4).map((src) => {
        const short = src.replace(/^https?:\/\/[^/]+/, "").slice(0, 60);
        return `<div class="base-email-section-item" title="${escHtml(src)}">🖼 ${escHtml(short)}</div>`;
      }).join("");
      groups.push(`<div class="base-email-section-group">
        <div class="base-email-section-label">Картинки (${map.images.length})</div>
        ${items}
      </div>`);
    }

    if (map.links?.length) {
      const items = map.links.slice(0, 4).map((l) =>
        `<div class="base-email-section-item" title="${escHtml(l.href)}">🔗 ${escHtml(l.text)}</div>`
      ).join("");
      groups.push(`<div class="base-email-section-group">
        <div class="base-email-section-label">Ссылки (${map.links.length})</div>
        ${items}
      </div>`);
    }

    refs.baseEmailContentMap.innerHTML = groups.join("") || "<div style='color:var(--muted);font-size:.9rem'>Структура загружена.</div>";
  }
}

async function handleChatSubmit(event) {
  event.preventDefault();

  const typedMessage = refs.chatInput.value.trim();
  applyChatHintsFromMessage(typedMessage);
  if (await handleRuleCommand(typedMessage)) {
    refs.chatInput.value = "";
    renderAll();
    persistState();
    return;
  }
  const intent = inferChatIntent(typedMessage);
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

function extractRuleCommand(text) {
  const source = cleanText(text);
  if (!source) {
    return "";
  }

  const patterns = [
    /^запомни правило:\s*(.+)$/i,
    /^rule:\s*(.+)$/i,
    /^remember rule:\s*(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) {
      return cleanText(match[1]);
    }
  }

  return "";
}

async function handleRuleCommand(text) {
  const ruleText = extractRuleCommand(text);
  if (!ruleText) {
    return false;
  }

  state.messages.push({ role: "user", content: text });
  try {
    const response = await fetch("/api/project-rules", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: ruleText,
        source: "chat"
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Rule save failed");
    }

    state.projectRules = {
      items: Array.isArray(payload.items) ? payload.items : [],
      summary: payload.summary || null
    };
    state.messages.push({
      role: "assistant",
      content: `Сохранил правило проекта: ${ruleText}`
    });
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Не смог сохранить правило: ${error.message}`
    });
  }

  return true;
}

function inferChatIntent(message) {
  const text = cleanText(message).toLowerCase();

  if (!text) {
    return state.draft?.mail ? "draft" : "discuss";
  }

  const previousAssistantMessage = [...state.messages]
    .reverse()
    .find((entry) => entry.role === "assistant")?.content || "";
  const containsDraftSignal = [
    "сверстай", "сверстаем", "сверстать", "верстай", "переверстай", "собери", "соберем", "собрать",
    "сделай", "сделаем", "добавь", "добавим", "измени", "обнови", "убери", "замени", "подставь",
    "примени", "начинай", "начнем", "поехали", "делай", "build", "apply", "update", "generate", "layout", "draft"
  ].some((token) => text.includes(token));
  const isDraftConfirmation = /^(да|ага|ок|окей|хорошо|верно|подтверждаю|можешь|начинай|делай|поехали|вперед|yes|go ahead)/i.test(text)
    && /(собер|сдела|сверст|черновик|draft|верстк|код|макет|письм)/i.test(previousAssistantMessage);

  const applyPatterns = [
    /(нужно|надо)\s+(собрать|сделать|сверстать|обновить|добавить|переверстать)/i,
    /\b(build|apply|update|change|add|remove|replace|generate|layout)\b/i,
    /\b\d+\s*(колонк|колонки|колонки|columns?|картинк|изображени|images?)\b/i
  ];
  if (isDraftConfirmation || containsDraftSignal || applyPatterns.some((pattern) => pattern.test(text))) {
    return "draft";
  }

  const discussPatterns = [
    /[?]\s*$/i,
    /^(что|как|почему|зачем|где|когда|чем|можно|подскажи|расскажи|какие)\b/i,
    /\b(обсудим|объясни|explain|why|what|how)\b/i
  ];
  if (discussPatterns.some((pattern) => pattern.test(text))) {
    return "discuss";
  }

  return state.draft?.mail ? "draft" : "discuss";
}

function extractRequestedLocalesFromMessage(text) {
  const source = cleanText(text).replaceAll("-", "_");
  if (!source) {
    return [];
  }

  const knownLocales = new Map();
  const supportedLocales = [
    ...(Array.isArray(state.api.emailBase?.locales) ? state.api.emailBase.locales : []),
    "en", "ru", "pt", "pt_BR", "de", "fr", "fr_FR", "es", "es_ES", "it", "id", "ja", "ko", "th", "tr", "uk", "vi", "ar", "az", "bn", "cn", "ge", "hi", "hl", "ms", "nl", "no", "se", "tl", "ur"
  ];

  for (const locale of supportedLocales) {
    const normalized = cleanText(locale).replaceAll("-", "_");
    if (!normalized) {
      continue;
    }
    knownLocales.set(normalized.toLowerCase(), normalized);
  }

  const matches = source.match(/\b[a-z]{2}(?:_[A-Za-z]{2})?\b/gi) || [];
  const locales = matches
    .map((token) => knownLocales.get(token.toLowerCase()))
    .filter(Boolean);

  return Array.from(new Set(locales));
}

function mergeRequestedLocales(nextLocales = []) {
  const merged = Array.from(new Set([
    ...cleanText(state.brief.requestedLocales).split(/[\s,;]+/).map((locale) => locale.trim()).filter(Boolean),
    ...nextLocales
  ]));

  state.brief.requestedLocales = merged.join(", ");
}

function setBriefCategoryDefaults(categoryName) {
  const categories = Array.isArray(state.api.emailBase?.categories) ? state.api.emailBase.categories : [];
  const category = categories.find((entry) => cleanText(entry.name) === cleanText(categoryName));
  if (!category) {
    return;
  }

  state.brief.category = category.name;
  if (cleanText(state.brief.mailId)) {
    return;
  }

  const preferredMail = category.mails.find((mail) => /payment|success|welcome|confirm|docs/i.test(cleanText(mail.id)))
    || category.mails[0];

  if (preferredMail?.id) {
    state.brief.mailId = preferredMail.id;
  }
}

function applyChatHintsFromMessage(text) {
  const lowered = cleanText(text).toLowerCase();
  const requestedLocales = extractRequestedLocalesFromMessage(text)
    .filter((locale) => locale.toLowerCase() !== cleanText(state.brief.locale || "en").toLowerCase());

  if (requestedLocales.length > 0) {
    mergeRequestedLocales(requestedLocales);
  }

  if (!cleanText(state.brief.category) && /(системн|technical|transactional|service email|system email)/i.test(lowered)) {
    setBriefCategoryDefaults("X_System");
  }
}

function createChatRequestBody(intent) {
  return {
    intent,
    messages: state.messages
      .filter((message) => !message.streaming)
      .map(({ role, content }) => ({ role, content })),
    brief: state.brief,
    assetInputs: getPayloadAssetInputs(),
    assetRegistryItems: state.assetRegistry.items,
    translationText: state.translationText,
    projectRules: state.projectRules.items,
    design: state.design,
    designAnalysis: state.designAnalysis,
    settings: state.settings,
    currentDraft: state.draft?.mail ?? null,
    baseEmailHtml: state.baseEmailHtml || null,
    baseEmailContentMap: state.baseEmailContentMap || null,
    scaffoldContext: state.scaffoldContext || null
  };
}

function getPayloadAssetInputs() {
  return state.assetInputs.filter((asset) => !isDesignAssetInput(asset));
}

function isDesignAssetInput(asset) {
  if (!asset) {
    return false;
  }

  const designUrl = cleanText(state.design?.dataUrl);
  const designAssetId = cleanText(state.design?.assetId);
  const assetUrl = cleanText(asset.url);
  const assetLibraryId = cleanText(asset.libraryId);

  return Boolean(
    (designUrl && assetUrl && designUrl === assetUrl)
    || (designAssetId && assetLibraryId && designAssetId === assetLibraryId)
  );
}

function removeDesignFromAssetInputs() {
  const filtered = state.assetInputs.filter((asset) => !isDesignAssetInput(asset));
  state.assetInputs = filtered.length > 0 ? filtered : [createEmptyAsset(1)];
  renderAssetComposer();
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
  state.providerRuntime = payload.providerRuntime || null;
  if (payload.clearDraft) {
    state.previewSource = "draft";
    state.draft = null;
    state.previewLocale = cleanText(state.brief.locale || "en");
    resetCodeWorkspaceSelection();
  }
  if (payload.translationText) {
    state.translationText = payload.translationText;
  }
  if (payload.uploadStatus) {
    state.translationUploadStatus = payload.uploadStatus;
  }
  if (payload.designAnalysis) {
    state.designAnalysis = payload.designAnalysis;
  }
  if (payload.draft) {
    state.previewSource = payload.previewSource || "draft";
    state.draft = payload.draft;
    state.previewLocale = cleanText(payload.draft?.mail?.locale || state.brief.locale);
    state.imageSlotPanelDismissed = false; // reset panel dismiss on new draft
    resetCodeWorkspaceSelection();
  }

  // Scaffold mode: handle locale_entries and/or brand_theme from AI response
  if (state.scaffoldContext) {
    const mailId   = payload.scaffoldMailId   || state.scaffoldContext.newMailId;
    const category = payload.scaffoldCategory || state.scaffoldContext.category;
    const lc       = payload.localeContent    || null;

    if (payload.brandTheme) {
      // Server already patched styl files in-process → rebuild (+ resolve tokens if we have them)
      triggerScaffoldRebuildAfterTheme(mailId, category, lc);
    } else if (lc && mailId) {
      // No theme change — just rebuild and resolve tokens in the result
      applyScaffoldLocaleContent(mailId, category, lc);
    }
  }

  renderAll();
}

async function triggerScaffoldRebuildAfterTheme(mailId, category, localeContent = null) {
  if (!mailId || !category) return;
  try {
    // Server already patched styl files in-process; rebuild to get updated HTML.
    // Optionally resolve scaffold tokens in the result if localeContent provided.
    const res = await fetch("/api/email-base/rebuild", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, mailId, ...(localeContent ? { localeContent } : {}) })
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.previewHtml) {
      if (!state.draft) state.draft = {};
      state.draft.html = data.previewHtml;
      state.previewSource = "scaffold";
      if (localeContent) state.scaffoldContext = null; // tokens resolved — context no longer needed
      persistState();
      renderAll();
    }
  } catch (err) {
    console.warn("[theme] rebuild after patch failed:", err.message);
  }
}

async function applyScaffoldLocaleContent(mailId, category, localeContent) {
  // Rebuild the mail with token resolution — server reads the existing built HTML,
  // resolves ${{ ns.key }} tokens using localeContent, and returns the final preview.
  try {
    const res = await fetch("/api/email-base/rebuild", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: category || state.scaffoldContext?.category,
        mailId,
        localeContent
      })
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.previewHtml) {
      if (!state.draft) state.draft = {};
      state.draft.html = data.previewHtml;
      state.previewSource = "scaffold";
      state.scaffoldContext = null; // tokens resolved — context done
      persistState();
      renderAll();
    }
  } catch (err) {
    console.warn("[scaffold] token resolve failed:", err.message);
  }
}

// ─── Figma Assets Browser ────────────────────────────────────────────────────

const figmaAssets = {
  overlay:      document.getElementById("figmaAssetsOverlay"),
  title:        document.getElementById("figmaAssetsModalTitle"),
  closeBtn:     document.getElementById("closeFigmaAssetsModal"),
  pageSelect:   document.getElementById("figmaAssetsPageSelect"),
  scaleSelect:  document.getElementById("figmaAssetsScale"),
  formatSelect: document.getElementById("figmaAssetsFormat"),
  selectAllBtn: document.getElementById("figmaSelectAllBtn"),
  deselectBtn:  document.getElementById("figmaDeselectAllBtn"),
  frameGrid:    document.getElementById("figmaAssetsFrameGrid"),
  selectedCount:document.getElementById("figmaAssetsSelectedCount"),
  exportBtn:    document.getElementById("exportFigmaAssetsBtn"),
  exportStatus: document.getElementById("figmaAssetsExportStatus"),
};

let figmaBrowseData = null; // { fileName, pages: [...] }
let figmaSelectedIds = new Set();
let figmaFileKey = null;

function openFigmaAssetsModal(fileKey, browseData) {
  figmaFileKey    = fileKey;
  figmaBrowseData = browseData;
  figmaSelectedIds.clear();
  figmaAssets.title.textContent = `Figma — ${browseData.fileName}`;

  // Populate page selector
  figmaAssets.pageSelect.innerHTML = browseData.pages
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join("");

  renderFigmaFrameGrid();
  updateFigmaSelectionCount();
  figmaAssets.overlay.hidden = false;
}

function closeFigmaAssetsModal() {
  figmaAssets.overlay.hidden = true;
}

function renderFigmaFrameGrid() {
  if (!figmaBrowseData) return;
  const pageId = figmaAssets.pageSelect.value;
  const page   = figmaBrowseData.pages.find((p) => p.id === pageId) || figmaBrowseData.pages[0];
  if (!page) { figmaAssets.frameGrid.innerHTML = "<p style='color:rgba(255,255,255,.4);padding:20px'>Нет фреймов на этой странице.</p>"; return; }

  figmaAssets.frameGrid.innerHTML = page.frames.map((frame) => {
    const sel = figmaSelectedIds.has(frame.id);
    const exp = frame.assetUrl ? "is-exported" : "";
    return `<div class="figma-frame-card ${sel ? "is-selected" : ""} ${exp}"
                  data-frame-id="${escapeHtml(frame.id)}"
                  data-frame-name="${escapeHtml(frame.name)}"
                  title="${escapeHtml(frame.name)}">
      <div class="figma-frame-preview-placeholder">▢</div>
      <div class="figma-frame-name">${escapeHtml(frame.name)}</div>
      <div class="figma-frame-dims">${frame.width} × ${frame.height}</div>
      ${frame.assetUrl ? `<a class="figma-frame-asset-link" href="${escapeHtml(frame.assetUrl)}" target="_blank">✓ В ассетах</a>` : ""}
    </div>`;
  }).join("");
}

function updateFigmaSelectionCount() {
  const n = figmaSelectedIds.size;
  figmaAssets.selectedCount.textContent = `Выбрано: ${n}`;
  figmaAssets.exportBtn.disabled = n === 0;
}

function bindFigmaAssetEvents() {
  figmaAssets.closeBtn.addEventListener("click", closeFigmaAssetsModal);
  figmaAssets.overlay.addEventListener("click", (e) => { if (e.target === figmaAssets.overlay) closeFigmaAssetsModal(); });

  figmaAssets.pageSelect.addEventListener("change", () => {
    figmaSelectedIds.clear();
    renderFigmaFrameGrid();
    updateFigmaSelectionCount();
  });

  figmaAssets.frameGrid.addEventListener("click", (e) => {
    const card = e.target.closest(".figma-frame-card");
    if (!card) return;
    const id = card.dataset.frameId;
    if (figmaSelectedIds.has(id)) figmaSelectedIds.delete(id);
    else figmaSelectedIds.add(id);
    card.classList.toggle("is-selected", figmaSelectedIds.has(id));
    updateFigmaSelectionCount();
  });

  figmaAssets.selectAllBtn.addEventListener("click", () => {
    if (!figmaBrowseData) return;
    const pageId = figmaAssets.pageSelect.value;
    const page   = figmaBrowseData.pages.find((p) => p.id === pageId) || figmaBrowseData.pages[0];
    page?.frames.forEach((f) => figmaSelectedIds.add(f.id));
    renderFigmaFrameGrid();
    updateFigmaSelectionCount();
  });

  figmaAssets.deselectBtn.addEventListener("click", () => {
    figmaSelectedIds.clear();
    renderFigmaFrameGrid();
    updateFigmaSelectionCount();
  });

  figmaAssets.exportBtn.addEventListener("click", exportSelectedFigmaFrames);
}

async function exportSelectedFigmaFrames() {
  if (!figmaFileKey || !figmaSelectedIds.size) return;
  const nodeIds = [...figmaSelectedIds];
  const scale   = Number(figmaAssets.scaleSelect.value) || 2;
  const format  = figmaAssets.formatSelect.value || "png";

  figmaAssets.exportBtn.disabled = true;
  figmaAssets.exportStatus.textContent = `Экспортируем ${nodeIds.length} фреймов…`;

  try {
    const res = await fetch("/api/figma/export-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileKey: figmaFileKey, nodeIds, scale, format, save: true })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);

    const ok    = data.images.filter((i) => i.assetUrl);
    const fails = data.images.filter((i) => i.error);

    // Mark exported frames in browse data
    if (figmaBrowseData) {
      for (const img of ok) {
        for (const page of figmaBrowseData.pages) {
          const f = page.frames.find((fr) => fr.id === img.nodeId);
          if (f) f.assetUrl = img.assetUrl;
        }
      }
    }

    figmaAssets.exportStatus.textContent =
      `✓ Сохранено: ${ok.length}` + (fails.length ? ` | Ошибок: ${fails.length}` : "");

    figmaSelectedIds.clear();
    renderFigmaFrameGrid();
    updateFigmaSelectionCount();

    // Refresh asset panel if open
    if (typeof refreshAssetPanel === "function") refreshAssetPanel();

  } catch (err) {
    figmaAssets.exportStatus.textContent = `Ошибка: ${err.message}`;
    figmaAssets.exportBtn.disabled = false;
  }
}

async function handleBrowseFigmaBtn() {
  const urlInput = document.getElementById("designReferenceUrlInput");
  const url = urlInput?.value?.trim() || state.brief?.designReferenceUrl || "";
  const statusEl = document.getElementById("figmaBrowseStatus");
  const bodyEl   = document.getElementById("figmaBrowseBody");

  if (!url) {
    statusEl.textContent = "Сначала вставь Figma URL в поле выше.";
    statusEl.hidden = false;
    bodyEl.hidden = true;
    return;
  }

  statusEl.textContent = "Загружаем список фреймов…";
  statusEl.hidden = false;
  bodyEl.hidden = true;

  try {
    const res = await fetch("/api/figma/browse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);

    // Extract fileKey from URL for export step
    const match = url.match(/figma\.com\/(?:design|file|proto)\/([A-Za-z0-9_-]+)/);
    const fileKey = match ? match[1] : null;

    statusEl.hidden = true;
    openFigmaAssetsModal(fileKey, data);

  } catch (err) {
    statusEl.textContent = `Ошибка: ${err.message}`;
    statusEl.hidden = false;
  }
}

// ─── Generation History ───────────────────────────────────────────────────────

async function openHistoryModal() {
  openWorkspaceModal("history");
  await loadAndRenderHistory();
}

function closeHistoryModal() {
  closeWorkspaceModal();
}

async function loadAndRenderHistory() {
  refs.historyList.innerHTML = '<div class="history-empty">Загрузка…</div>';
  try {
    const res = await fetch("/api/history?limit=50");
    if (!res.ok) throw new Error("Failed");
    const { items } = await res.json();
    renderHistoryList(items);
  } catch (err) {
    refs.historyList.innerHTML = `<div class="history-empty">Ошибка: ${escHtml(err.message)}</div>`;
  }
}

function renderHistoryList(items) {
  if (!items || items.length === 0) {
    refs.historyList.innerHTML = '<div class="history-empty">История пуста. Генерации будут сохраняться автоматически.</div>';
    return;
  }

  refs.historyList.innerHTML = items.map((item) => {
    const time = formatHistoryTime(item.createdAt);
    const subj = item.subject || "(без темы)";
    const pre = item.preheader || "";
    const pills = [item.category, item.mailId, item.locale, item.mode]
      .filter(Boolean)
      .map((p) => `<span class="history-pill">${escHtml(p)}</span>`)
      .join("");

    return `
      <div class="history-item" data-id="${escHtml(item.id)}">
        <div class="history-item-meta">${pills}</div>
        <div class="history-item-time">${escHtml(time)}</div>
        <div class="history-item-subject">${escHtml(subj)}</div>
        ${pre ? `<div class="history-item-preheader">${escHtml(pre)}</div>` : ""}
        <div class="history-item-actions">
          <button class="ghost-button" style="font-size:12px" type="button"
            data-history-restore="${escHtml(item.id)}">Восстановить brief →</button>
          <button class="ghost-button" style="font-size:12px;opacity:0.45" type="button"
            data-history-delete="${escHtml(item.id)}">✕</button>
        </div>
      </div>
    `;
  }).join("");

  // Bind actions
  refs.historyList.querySelectorAll("[data-history-restore]").forEach((btn) => {
    btn.addEventListener("click", () => restoreHistoryItem(btn.dataset.historyRestore));
  });
  refs.historyList.querySelectorAll("[data-history-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await fetch(`/api/history/${btn.dataset.historyDelete}`, { method: "DELETE" });
      await loadAndRenderHistory();
    });
  });
}

function formatHistoryTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "только что";
    if (diffMins < 60) return `${diffMins} мин. назад`;
    const diffH = Math.floor(diffMins / 60);
    if (diffH < 24) return `${diffH} ч. назад`;
    return d.toLocaleDateString("ru", { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

async function restoreHistoryItem(id) {
  try {
    const res = await fetch(`/api/history/${id}`);
    if (!res.ok) throw new Error("Not found");
    const data = await res.json();
    // Restore to state + form — don't generate, just fill brief
    if (data.html) {
      // If we have the html snapshot, load it as current draft HTML (read-only preview)
      state.messages.push({
        role: "assistant",
        content: `Восстановлен черновик из истории. Тема: ${data.html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "(без темы)"}`
      });
    }
    closeHistoryModal();
    renderAll();
    persistState();
  } catch (err) {
    state.messages.push({ role: "assistant", content: `Ошибка восстановления: ${err.message}` });
    renderAll();
  }
}

async function handleClearHistory() {
  if (!confirm("Очистить всю историю генераций? Это действие нельзя отменить.")) return;
  await fetch("/api/history/clear", { method: "POST" });
  await loadAndRenderHistory();
}

// ─── Template Browser ─────────────────────────────────────────────────────────

/** @type {{ tree: Array<{brand:string, label:string, mails:Array<{mailId:string, hasBuilt:boolean, locales:string[]}>}> } | null} */
let templateBrowserData = null;
/** @type {string|null} Active selection: "brand::mailId" */
let templateBrowserActive = null;

async function openTemplateBrowser() {
  refs.templateBrowserDrawer.setAttribute("aria-hidden", "false");
  refs.templateBrowserDrawer.classList.add("is-open");
  refs.templateBrowserBackdrop.hidden = false;
  refs.templateSearchInput.value = "";
  if (!templateBrowserData) {
    await loadTemplateBrowserData();
  } else {
    renderTemplateBrowserTree(templateBrowserData.tree);
  }
}

function closeTemplateBrowser() {
  refs.templateBrowserDrawer.setAttribute("aria-hidden", "true");
  refs.templateBrowserDrawer.classList.remove("is-open");
  refs.templateBrowserBackdrop.hidden = true;
}

async function loadTemplateBrowserData() {
  refs.templateBrowserBody.innerHTML = '<div class="template-browser-loading">Загрузка…</div>';
  try {
    const res = await fetch("/api/email-base/tree");
    if (!res.ok) throw new Error("Failed to load template tree");
    templateBrowserData = await res.json();
    renderTemplateBrowserTree(templateBrowserData.tree);
  } catch (err) {
    refs.templateBrowserBody.innerHTML = `<div class="template-browser-loading">Ошибка: ${escHtml(err.message)}</div>`;
  }
}

function renderTemplateBrowserFiltered() {
  if (!templateBrowserData) return;
  const q = refs.templateSearchInput.value.toLowerCase().trim();
  if (!q) {
    renderTemplateBrowserTree(templateBrowserData.tree);
    return;
  }
  const filtered = templateBrowserData.tree
    .map((brand) => ({
      ...brand,
      mails: brand.mails.filter(
        (m) => m.mailId.toLowerCase().includes(q) || brand.label.toLowerCase().includes(q)
      )
    }))
    .filter((brand) => brand.mails.length > 0);
  renderTemplateBrowserTree(filtered, true);
}

function renderTemplateBrowserTree(tree, expandAll = false) {
  if (!tree || tree.length === 0) {
    refs.templateBrowserBody.innerHTML = '<div class="template-browser-loading">Нет шаблонов.</div>';
    return;
  }

  const html = tree.map((brand) => {
    const isOpen = expandAll || templateBrowserData?.tree.indexOf(brand) === 0;
    const mailItems = brand.mails.map((m) => {
      const key = `${brand.brand}::${m.mailId}`;
      const isActive = templateBrowserActive === key;
      return `
        <div class="template-mail-item${isActive ? " active" : ""}"
          data-brand="${escHtml(brand.brand)}"
          data-mail="${escHtml(m.mailId)}"
          data-built="${m.hasBuilt}"
          data-key="${escHtml(key)}">
          <span class="template-mail-name">${escHtml(m.mailId)}</span>
          <span class="template-mail-built-dot" title="${m.hasBuilt ? "Build exists" : "Not built yet"}"></span>
        </div>
        ${isActive ? renderTemplateQuickBar(brand.brand, m) : ""}
      `;
    }).join("");

    return `
      <div class="template-brand-group${isOpen ? " open" : ""}" data-brand="${escHtml(brand.brand)}">
        <button class="template-brand-toggle" type="button">
          <span>${escHtml(brand.label)}</span>
          <span class="template-brand-count">${brand.mails.length}</span>
          <span class="brand-chevron">▶</span>
        </button>
        <div class="template-mail-list">${mailItems}</div>
      </div>
    `;
  }).join("");

  refs.templateBrowserBody.innerHTML = html;

  // Bind toggle clicks
  refs.templateBrowserBody.querySelectorAll(".template-brand-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".template-brand-group").classList.toggle("open");
    });
  });

  // Bind mail item clicks
  refs.templateBrowserBody.querySelectorAll(".template-mail-item").forEach((item) => {
    item.addEventListener("click", () => {
      const brand = item.dataset.brand;
      const mailId = item.dataset.mail;
      const key = item.dataset.key;
      templateBrowserActive = templateBrowserActive === key ? null : key;
      // Re-render tree to show/hide quick bar
      renderTemplateBrowserFiltered();
      // If search is empty, restore full tree but keep state
      if (!refs.templateSearchInput.value.trim()) {
        renderTemplateBrowserTree(templateBrowserData?.tree || []);
      }
    });
  });

  // Bind quick bar action buttons (delegated)
  refs.templateBrowserBody.querySelectorAll("[data-tbaction]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const action = e.currentTarget.dataset.tbaction;
      const brand = e.currentTarget.dataset.brand;
      const mailId = e.currentTarget.dataset.mail;
      const locale = e.currentTarget.dataset.locale || "";
      if (action === "load") {
        templateBrowserLoadMail(brand, mailId, locale);
      } else if (action === "scaffold") {
        openScaffoldModal(brand, mailId);
      }
    });
  });
}

function renderTemplateQuickBar(brand, mail) {
  const localeButtons = (mail.locales || []).map((loc) =>
    `<button class="ghost-button" style="font-size:11px;padding:3px 8px" type="button"
      data-tbaction="load" data-brand="${escHtml(brand)}" data-mail="${escHtml(mail.mailId)}" data-locale="${escHtml(loc)}">${escHtml(loc)}</button>`
  ).join(" ");

  // Show Clone button for system-type categories (X_AffSystem etc.)
  const isAffSystem = /AffSystem|_System/i.test(brand);
  const cloneBtn = isAffSystem
    ? `<button class="ghost-button" style="font-size:12px;padding:4px 12px;color:rgba(255,180,50,.9);border-color:rgba(255,180,50,.3)" type="button"
        data-tbaction="scaffold" data-brand="${escHtml(brand)}" data-mail="${escHtml(mail.mailId)}">
        Clone →
      </button>`
    : "";

  return `
    <div class="template-quick-bar">
      <div class="template-quick-bar-label">
        <strong>${escHtml(mail.mailId)}</strong>
        ${mail.hasBuilt ? `Build ready · ${mail.locales.length} locale(s)` : "Not built yet"}
      </div>
      <button class="primary-button" style="font-size:12px;padding:4px 12px" type="button"
        data-tbaction="load" data-brand="${escHtml(brand)}" data-mail="${escHtml(mail.mailId)}" data-locale="">
        Load →
      </button>
      ${localeButtons}
      ${cloneBtn}
    </div>
  `;
}

async function templateBrowserLoadMail(brand, mailId, locale) {
  // Pre-fill brief fields
  if (refs.fields.category) refs.fields.category.value = brand;
  if (refs.fields.mailId) refs.fields.mailId.value = mailId.replace(/^mail-/, "");
  if (locale && refs.fields.locale) refs.fields.locale.value = locale;

  // Update state.brief
  state.brief.category = brand;
  state.brief.mailId = mailId.replace(/^mail-/, "");
  if (locale) state.brief.locale = locale;

  closeTemplateBrowser();
  persistState();
  await handleLoadBaseEmail();
}

// ─── Scaffold Modal ──────────────────────────────────────────────────────────

function openScaffoldModal(brand, templateMailId) {
  // Remove any existing scaffold modal
  document.getElementById("scaffoldModal")?.remove();

  const modal = document.createElement("div");
  modal.id = "scaffoldModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-box" style="max-width:440px">
      <div class="modal-header">
        <span class="modal-title">Clone письма</span>
        <button class="modal-close-btn" id="scaffoldModalClose" type="button">✕</button>
      </div>
      <div class="modal-body" style="padding:16px">
        <p style="font-size:13px;color:rgba(255,255,255,.6);margin:0 0 14px">
          Клонирует <strong>${escHtml(templateMailId)}</strong> из <strong>${escHtml(brand)}</strong>
          в новое письмо. Токены переименуются автоматически.
        </p>
        <label style="font-size:12px;color:rgba(255,255,255,.5);display:block;margin-bottom:5px">ID нового письма (без mail-)</label>
        <input id="scaffoldNewMailId" type="text" placeholder="например: new-aff-welcome"
          style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);
          border-radius:5px;color:rgba(255,255,255,.9);font-size:13px;padding:8px 10px;outline:none" />
        <div id="scaffoldStatus" style="margin-top:10px;font-size:12px;color:rgba(255,255,255,.5);min-height:16px"></div>
      </div>
      <div class="modal-footer" style="padding:10px 16px;display:flex;gap:8px;justify-content:flex-end">
        <button class="ghost-button" id="scaffoldCancelBtn" type="button">Отмена</button>
        <button class="primary-button" id="scaffoldRunBtn" type="button">Клонировать →</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.getElementById("scaffoldModalClose").addEventListener("click", closeModal);
  document.getElementById("scaffoldCancelBtn").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  const input = document.getElementById("scaffoldNewMailId");
  const status = document.getElementById("scaffoldStatus");
  const runBtn = document.getElementById("scaffoldRunBtn");

  input.focus();
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runBtn.click();
  });

  runBtn.addEventListener("click", async () => {
    const newMailId = input.value.trim().toLowerCase().replace(/\s+/g, "-");
    if (!newMailId) {
      status.textContent = "⚠️ Введите ID нового письма";
      status.style.color = "rgba(255,140,50,.8)";
      return;
    }

    runBtn.disabled = true;
    runBtn.textContent = "Клонирую…";
    status.textContent = "Запускаю scaffold…";
    status.style.color = "rgba(255,255,255,.5)";

    try {
      const res = await fetch("/api/email-base/scaffold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: brand,
          templateMail: templateMailId,
          newMailId,
          buildAfter: true
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scaffold failed");

      status.textContent = `✓ Создано: mail-${data.safeMailId} · ${data.blockCount} блоков · ${data.tokenKeys?.length} токенов`;
      status.style.color = "rgba(100,220,120,.9)";
      runBtn.textContent = "Готово ✓";
      runBtn.disabled = false;

      // Refresh template browser tree
      templateBrowserData = null;

      // Pre-fill brief for the new mail and let the user generate copy via AI
      if (refs.fields.category) refs.fields.category.value = brand;
      if (refs.fields.mailId) refs.fields.mailId.value = data.safeMailId;
      state.brief.category = brand;
      state.brief.mailId = data.safeMailId;

      // Store scaffold context in state for the next AI call
      state.scaffoldContext = {
        newMailId: data.safeMailId,
        namespace: data.namespace,
        category: brand,
        templateMail: templateMailId,
        tokenKeys: data.tokenKeys || []
      };

      persistState();

      // Close modal after 1.5s and refresh template browser
      setTimeout(() => {
        closeModal();
        closeTemplateBrowser();
        // Show a hint in the chat input
        if (refs.chatInput) {
          refs.chatInput.value = `Напиши копи для нового письма mail-${data.safeMailId} — заполни все ${data.tokenKeys?.length} токенов`;
          refs.chatInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }, 1500);

    } catch (err) {
      status.textContent = `✗ Ошибка: ${err.message}`;
      status.style.color = "rgba(255,100,100,.9)";
      runBtn.disabled = false;
      runBtn.textContent = "Клонировать →";
    }
  });
}

function escHtml(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Load Base Email ───────────────────────────────────────────────────────────

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
    state.previewLocale = cleanText(payload.draft?.mail?.locale || state.brief.locale);
    state.imageSlotPanelDismissed = false;
    resetCodeWorkspaceSelection();
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

  // Show diff before saving
  await openDiffModal();
}

async function openDiffModal() {
  openWorkspaceModal("diff");
  const mail = state.draft?.mail;
  const category = cleanText(state.brief.category || mail?.category);
  const mailId = cleanText(state.brief.mailId || mail?.mail_id);
  const locale = cleanText(state.brief.locale || mail?.locale || "en");

  refs.diffModalTitle.textContent = `Diff: ${category}/${mailId} (${locale})`;
  refs.diffModalMeta.textContent = "Загружаю существующий шаблон для сравнения…";
  refs.diffView.innerHTML = '<div class="diff-no-change">Загрузка…</div>';
  refs.diffStats.innerHTML = "";

  let oldHtml = "";
  try {
    const res = await fetch(`/api/email-base/read?category=${encodeURIComponent(category)}&mailId=${encodeURIComponent(mailId)}&locale=${encodeURIComponent(locale)}`);
    if (res.ok) {
      const data = await res.json();
      oldHtml = data.html || "";
      refs.diffModalMeta.textContent = oldHtml
        ? `Сравнение с существующим шаблоном ${category}/${mailId} (locale: ${data.locale || locale})`
        : `Шаблон ${category}/${mailId} ещё не существует — будет создан новый`;
    } else {
      refs.diffModalMeta.textContent = `Шаблон ${category}/${mailId} ещё не существует — будет создан новый`;
    }
  } catch {
    refs.diffModalMeta.textContent = "Не удалось загрузить существующий шаблон — diff показывает только новый файл";
  }

  const newHtml = cleanText(mail?.html) || "";
  renderDiffView(oldHtml, newHtml);
}

function renderDiffView(oldText, newText) {
  const oldLines = oldText ? oldText.split("\n") : [];
  const newLines = newText ? newText.split("\n") : [];

  const hunks = computeDiffHunks(oldLines, newLines, 3);

  let added = 0, removed = 0, unchanged = 0;
  for (const hunk of hunks) {
    for (const op of hunk) {
      if (op.type === "added") added++;
      else if (op.type === "removed") removed++;
      else unchanged++;
    }
  }

  refs.diffStats.innerHTML = `
    <span class="diff-stat-added">+${added} добавлено</span>
    <span class="diff-stat-removed">-${removed} удалено</span>
    <span class="diff-stat-unchanged">${unchanged} без изменений</span>
  `;

  if (added === 0 && removed === 0) {
    refs.diffView.innerHTML = '<div class="diff-no-change">Изменений нет — файлы идентичны.</div>';
    return;
  }

  if (!oldText) {
    // New file — show all lines as added
    const lines = newLines.slice(0, 1000);
    refs.diffView.innerHTML = lines.map((l) =>
      `<div class="diff-line diff-line-added">${escHtml(l)}</div>`
    ).join("") + (newLines.length > 1000 ? `<div class="diff-hunk-header">… ещё ${newLines.length - 1000} строк</div>` : "");
    return;
  }

  let html = "";
  for (const hunk of hunks) {
    html += `<div class="diff-hunk-header">@@ Hunk @@</div>`;
    for (const op of hunk) {
      const cls = op.type === "added" ? "diff-line-added"
        : op.type === "removed" ? "diff-line-removed"
        : "diff-line-context";
      html += `<div class="diff-line ${cls}">${escHtml(op.text)}</div>`;
    }
  }
  refs.diffView.innerHTML = html;
}

/**
 * Minimal Myers-style line diff returning hunks of context lines.
 * contextLines: number of unchanged lines shown around each change.
 */
function computeDiffHunks(oldLines, newLines, contextLines = 3) {
  // LCS-based diff
  const ops = lineDiff(oldLines, newLines);

  // Group into hunks around changed lines
  const changed = new Set();
  ops.forEach((op, i) => { if (op.type !== "context") changed.add(i); });

  const include = new Set();
  changed.forEach((i) => {
    for (let j = Math.max(0, i - contextLines); j <= Math.min(ops.length - 1, i + contextLines); j++) {
      include.add(j);
    }
  });

  if (include.size === 0) return [];

  const sorted = Array.from(include).sort((a, b) => a - b);
  const hunks = [];
  let hunk = [];
  let prev = -2;

  for (const i of sorted) {
    if (i > prev + 1 && hunk.length > 0) {
      hunks.push(hunk);
      hunk = [];
    }
    hunk.push(ops[i]);
    prev = i;
  }
  if (hunk.length > 0) hunks.push(hunk);

  return hunks;
}

/**
 * Patience-like line diff using LCS.
 * Returns array of {type: "added"|"removed"|"context", text: string}
 */
function lineDiff(a, b) {
  const m = a.length, n = b.length;
  // DP table — only store last two rows for memory efficiency
  // For large files, cap at 5000 lines each
  const A = a.slice(0, 5000);
  const B = b.slice(0, 5000);
  const M = A.length, N = B.length;

  const dp = Array.from({ length: M + 1 }, () => new Int32Array(N + 1));
  for (let i = M - 1; i >= 0; i--) {
    for (let j = N - 1; j >= 0; j--) {
      if (A[i] === B[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const result = [];
  let i = 0, j = 0;
  while (i < M && j < N) {
    if (A[i] === B[j]) {
      result.push({ type: "context", text: A[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: "removed", text: A[i] });
      i++;
    } else {
      result.push({ type: "added", text: B[j] });
      j++;
    }
  }
  while (i < M) { result.push({ type: "removed", text: A[i++] }); }
  while (j < N) { result.push({ type: "added", text: B[j++] }); }

  // If files were capped, append note
  if (m > 5000 || n > 5000) {
    result.push({ type: "added", text: `[… файлы обрезаны до 5000 строк для diff]` });
  }

  return result;
}

async function executeSaveToEmailBase() {
  closeWorkspaceModal();

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
    state.previewLocale = cleanText(payload.draft?.mail?.locale || state.brief.locale);
    resetCodeWorkspaceSelection();
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
    // Invalidate template browser cache so next open shows the new mail
    templateBrowserData = null;
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
    state.providerRuntime = payload.providerRuntime || null;
    state.translationText = payload.translationText || state.translationText;
    state.translationUploadStatus = payload.uploadStatus || state.translationUploadStatus;
    if (payload.draft) {
      state.draft = payload.draft;
      state.previewLocale = cleanText(payload.draft?.mail?.locale || state.brief.locale);
      resetCodeWorkspaceSelection();
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

/**
 * "DeepL Auto-translate" button handler.
 * Overrides provider to "deepl" for this one request,
 * then restores original provider.
 */
async function handleDeepLAutoTranslate() {
  state.busy = true;
  renderStatus();

  const originalProvider = state.settings.providerId;
  try {
    const response = await fetch("/api/translations/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief: state.brief,
        settings: { ...state.settings, providerId: "deepl" },
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
    if (!response.ok) throw new Error(payload.error || "DeepL translate failed");

    state.mode = payload.mode;
    state.providerRuntime = payload.providerRuntime || null;
    state.translationText = payload.translationText || state.translationText;
    state.translationUploadStatus = payload.uploadStatus || state.translationUploadStatus;
    if (payload.draft) {
      state.draft = payload.draft;
      state.previewLocale = cleanText(payload.draft?.mail?.locale || state.brief.locale);
      resetCodeWorkspaceSelection();
    }
    state.messages.push({ role: "assistant", content: payload.assistantReply });
    await loadJournal();
  } catch (error) {
    state.messages.push({ role: "assistant", content: `Ошибка DeepL: ${error.message}` });
  } finally {
    state.settings.providerId = originalProvider;
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
    state.providerRuntime = payload.providerRuntime || null;
    state.designAnalysis = payload.designAnalysis || null;
    state.messages.push({
      role: "assistant",
      content: payload.assistantReply || "Design analysis updated."
    });
    await loadJournal();
    state.assetsWorkspaceView = "design";
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
    syncCodeSelectionWithPreviewLocale();
    syncCodeEditorBufferForActiveContext(true);
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
  syncCodeSelectionWithPreviewLocale();
  syncCodeEditorBufferForActiveContext(true);
  openWorkspaceModal("code");
}

async function openRulesModal() {
  try {
    await loadProjectRules();
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Ошибка при загрузке project rules: ${error.message}`
    });
  }
  openWorkspaceModal("rules");
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

function openDesignWorkspaceModal() {
  state.assetsWorkspaceView = "design";
  openWorkspaceModal("assets");
}

function openImageWorkspaceModal() {
  state.assetsWorkspaceView = "assets";
  openWorkspaceModal("assets");
}

function openContextModal() {
  openWorkspaceModal("context");
}

function openBlockCandidatesModal() {
  openWorkspaceModal("block-candidates");
}

function scrollToBlocks() {
  if (refs.blocksCatalogSection) {
    const isHidden = refs.blocksCatalogSection.hidden;
    if (isHidden) {
      toggleBlocksSection();
    }
    refs.blocksCatalogSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function toggleBlocksSection() {
  const section = refs.blocksCatalogSection;
  const btn = refs.toggleBlocksBtn;
  if (!section) return;
  const willShow = section.hidden;
  section.hidden = !willShow;
  if (btn) btn.classList.toggle("is-active", willShow);
  if (willShow) {
    section.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function updateChatIntakeCompact() {
  const intake = refs.translationDropZone;
  if (!intake) return;
  const hasMessages = refs.messages && refs.messages.children.length > 0;
  intake.classList.toggle("is-compact", hasMessages);
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

let _codeAutoSaveTimer = null;

function handleCodeEditorInput() {
  const activeFile = getCurrentCodeFile();
  state.codeEditorBuffer = refs.codeOutput.value;
  // Live re-highlight while typing
  refs.codeHighlight.innerHTML = renderHighlightedCode(state.codeEditorBuffer, activeFile?.language || "text");
  // Sync scroll position
  refs.codeHighlight.scrollTop = refs.codeOutput.scrollTop;
  refs.codeHighlight.scrollLeft = refs.codeOutput.scrollLeft;
  // Auto-save with debounce
  clearTimeout(_codeAutoSaveTimer);
  _codeAutoSaveTimer = setTimeout(() => {
    saveCodeEdits();
    const badge = document.querySelector("#codeAutosaveBadge");
    if (badge) {
      badge.hidden = false;
      clearTimeout(badge._hideTimer);
      badge._hideTimer = setTimeout(() => { badge.hidden = true; }, 2000);
    }
  }, 600);
}

function handleToggleCodeEdit() {
  // No-op — overlay mode: edit and highlight always visible together
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
  const activeFile = getCurrentCodeFile();
  const nextValue = refs.codeOutput.value;
  state.draft[selectedKey] = nextValue;

  if (activeFile) {
    const files = Array.isArray(state.draft.workspaceFiles) ? [...state.draft.workspaceFiles] : [];
    const index = files.findIndex((file) => file.id === activeFile.id);
    if (index >= 0) {
      files[index] = { ...files[index], content: nextValue };
    } else {
      files.push({ ...activeFile, content: nextValue });
    }
    state.draft.workspaceFiles = files;
  }

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
    if (activeFile?.locale) {
      if (!state.draft.localePayloads || typeof state.draft.localePayloads !== "object") {
        state.draft.localePayloads = {};
      }
      try {
        state.draft.localePayloads[activeFile.locale] = JSON.parse(nextValue);
      } catch {
        state.draft.localePayloads[activeFile.locale] = nextValue;
      }
    }
    if (entries.length > 0) {
      const existing = Array.isArray(state.draft.mail.translations) ? state.draft.mail.translations : [];
      const merged = [...existing];
      for (const entry of entries) {
        const index = merged.findIndex((candidate) => cleanText(candidate.locale).toLowerCase() === cleanText(entry.locale).toLowerCase());
        if (index >= 0) {
          merged[index] = entry;
        } else {
          merged.push(entry);
        }
      }
      state.draft.mail.translations = merged;
      state.translationText = merged
        .map((entry) => `=== FILE: ${entry.source_name || `${entry.locale}.txt`} ===\n${renderLocaleDocFromEntry(entry)}`)
        .join("\n\n");
      state.translationUploadStatus = "Locale JSON updated from code editor.";
      syncDraftTranslationsFromCurrentText();
      state.draft.locales = buildLocalesJsonFromEntries(merged);
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
    const locale = activeFile?.locale || getCurrentPreviewLocale();
    if (locale && state.draft.previewLocales && typeof state.draft.previewLocales === "object") {
      state.draft.previewLocales[locale] = nextValue;
    }
    state.draft.html = nextValue;
    state.previewSource = "draft";
  }

  if (state.activeTab === "buildLog") {
    const locale = activeFile?.locale || getCurrentPreviewLocale();
    if (locale && state.draft.localeBuildLogs && typeof state.draft.localeBuildLogs === "object") {
      state.draft.localeBuildLogs[locale] = nextValue;
    }
    state.draft.buildLog = nextValue;
  }

  if (state.activeTab === "pug") {
    state.draft.pug = nextValue;
  }

  if (state.activeTab === "stylus") {
    state.draft.stylus = nextValue;
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
  renderChatIntake();
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
  renderPreviewLocaleTabs();
  renderPreview();
  renderImageSlotPanel();
  renderScaffoldBanner();
  renderTabs();
  renderCode();
  renderAssets();
  renderAssetLibrary();
  renderProjectRules();
  renderJournalSummary();
  renderTests();
  renderBlockCatalogSummary();
  renderBlocks();
  renderDiagnostics();
  renderAssetsWorkspaceView();
  renderDesignWorkspace();
  renderDesignPreview();
  renderDesignAnalysis();
  renderBaseEmailState();
  positionHelpTips();
}

function renderChatIntake() {
  refs.chatIntakeActions.hidden = false;
  refs.chatIntakeActions.style.display = state.chatAttachMenuOpen ? "flex" : "none";
  refs.toggleAttachMenuBtn.textContent = state.chatAttachMenuOpen ? "Скрыть" : "Прикрепить";
}

function renderAssetsWorkspaceView() {
  const isDesignView = state.assetsWorkspaceView !== "assets";
  refs.assetsModalTitle.textContent = isDesignView ? "Design" : "Картинки и библиотека";
  refs.designWorkspaceSection.hidden = !isDesignView;
  refs.inputAssetsSection.hidden = isDesignView;
  refs.previewAssetsSection.hidden = isDesignView;
  refs.assetLibrarySection.hidden = isDesignView;
}

function detectDesignInputKind() {
  const designLink = cleanText(state.brief.designUrl);
  const hasFigmaImport = Boolean(state.design?.figmaImport);

  if (state.design?.dataUrl && hasFigmaImport) {
    return "figma-structured";
  }

  if (state.design?.dataUrl) {
    return state.design.assetId ? "project-upload" : "local-upload";
  }

  if (hasFigmaImport) {
    return "figma-structured";
  }

  if (!designLink) {
    return "none";
  }

  if (/figma\.com/i.test(designLink)) {
    return "figma-frame";
  }

  if (looksLikeImageUrl(designLink)) {
    return "image-url";
  }

  return "reference-url";
}

function getDesignSourceLabel(kind) {
  switch (kind) {
    case "project-upload":
      return "project design asset";
    case "local-upload":
      return "local screenshot/export";
    case "figma-structured":
      return "figma frame + layer payload";
    case "figma-frame":
      return "public figma frame";
    case "image-url":
      return "public image export";
    case "reference-url":
      return "reference url";
    default:
      return "no design";
  }
}

function renderDesignWorkspace() {
  const kind = detectDesignInputKind();
  const designLink = cleanText(state.brief.designUrl);
  const figmaReference = parseFigmaReferenceUrl(designLink);
  const figmaImport = state.design?.figmaImport || null;
  const figmaRuntime = state.api?.figma || null;
  refs.designReferenceUrlInput.value = designLink;
  refs.designSourcePills.innerHTML = "";
  if (refs.figmaImportSummary) refs.figmaImportSummary.textContent = describeFigmaImport(figmaImport);
  refs.figmaImportNote.textContent = figmaImport
    ? "Structured Figma payload уже загружен. Теперь студия видит selection name, layer summary, text layers и image fills даже без публичного доступа ко всему файлу."
    : figmaRuntime?.recommendedFlow
      ? `${figmaRuntime.recommendedFlow} Этот advanced import оставлен только как внутренний fallback, пока мы не сделали прямой one-click Send to Studio.`
      : "Обычному пользователю этот advanced import не нужен. Обычно хватает ссылки на frame или скрина/export. Этот блок оставлен как внутренний fallback, пока мы не сделали прямой plugin/API import.";

  const pills = [];
  if (state.design?.dataUrl) {
    pills.push(getDesignSourceLabel(kind));
  }
  if (designLink) {
    pills.push(getDesignSourceLabel(state.design?.dataUrl ? (/figma\.com/i.test(designLink) ? "figma-frame" : looksLikeImageUrl(designLink) ? "image-url" : "reference-url") : kind));
  }

  refs.designSourceSummary.textContent = state.design?.dataUrl
    ? `Primary design input: ${state.design.name || "attached design"}.`
    : designLink
      ? `Primary design input: ${designLink}`
      : figmaImport
        ? `Primary design input: structured Figma payload${figmaImport.selectionName ? ` for ${figmaImport.selectionName}` : ""}.`
        : "Design пока не приложен.";

  if (figmaReference?.fileKey || figmaImport?.fileKey) {
    pills.push(`figma file ${cleanText(figmaReference?.fileKey || figmaImport?.fileKey).slice(0, 8)}`);
  }
  if (figmaReference?.nodeId || figmaImport?.nodeId) {
    pills.push(`node ${cleanText(figmaReference?.nodeId || figmaImport?.nodeId)}`);
  }
  if (figmaImport?.selectionName) {
    pills.push(`selection ${figmaImport.selectionName}`);
  }
  if (figmaImport?.textLayerCount) {
    pills.push(`${figmaImport.textLayerCount} text layers`);
  }

  for (const label of Array.from(new Set(pills))) {
    const pill = document.createElement("div");
    pill.className = "pill";
    pill.textContent = label;
    refs.designSourcePills.appendChild(pill);
  }

  if (refs.designWorkspaceNote) {
    if (kind === "figma-structured" && state.design?.dataUrl) {
      refs.designWorkspaceNote.textContent = "Сейчас у студии есть и image-based design, и structured Figma payload. Это лучший режим для сложного письма: vision видит картинку, а mapping использует слои, тексты и node context.";
    } else if (kind === "figma-structured") {
      refs.designWorkspaceNote.textContent = "Сейчас у студии есть Figma frame reference и structured payload со слоями/текстами. Для pixel-level vision все еще полезно приложить image export этого frame.";
    } else if (state.design?.dataUrl && designLink) {
      refs.designWorkspaceNote.textContent = "Сейчас у студии есть и image-based design, и внешний reference URL. Для vision основным будет приложенный скрин/export, а ссылка останется как дополнительный контекст.";
    } else if (kind === "figma-frame") {
      refs.designWorkspaceNote.textContent = "Figma frame сохранен как design reference. Если этот frame открыт как draft/share link, студия может использовать его как основной reference. Если доступ закрыт, проще всего приложить скрин/export.";
    } else if (kind === "image-url") {
      refs.designWorkspaceNote.textContent = "Публичный image export сохранен как design input. Такой источник уже подходит для vision-анализа без локального upload.";
    } else if (kind === "reference-url") {
      refs.designWorkspaceNote.textContent = "Сохранен reference URL. Студия может учитывать его как контекст, но для точного design mapping лучше прикладывать скрин или image export.";
    } else if (kind === "project-upload" || kind === "local-upload") {
      refs.designWorkspaceNote.textContent = "Приложенный скрин/export считается основным design input. При желании можно добавить еще и публичный reference URL.";
    } else {
      refs.designWorkspaceNote.textContent = "Сюда можно просто положить Figma frame link, image export или reference URL. Если link приватный, студия должна попросить open draft link или скрин/export.";
    }
  }
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
  const bundleBlocks = countLocaleBlocks(state.translationText);
  const assetsCount = state.assetInputs.filter((asset) => asset.url).length;
  const blockCount = state.draft?.mail?.sections?.length || 0;
  const designKind = detectDesignInputKind();
  const hasTranslationBundle = translationDocs > 0;
  const hasAssets = assetsCount > 0;
  const hasBlocks = blockCount > 0;
  const hasDesign = designKind !== "none";
  const hasDraft = Boolean(state.draft);

  refs.designBadge.textContent = designKind === "project-upload" || designKind === "local-upload"
    ? `Design: ${state.design.name || "attached"}`
    : designKind === "figma-structured"
      ? "Design: Figma+"
    : designKind === "figma-frame"
      ? "Design: Figma"
      : designKind === "image-url"
        ? "Design: image URL"
        : designKind === "reference-url"
          ? "Design: reference"
          : "Design: none";
  refs.translationBadge.textContent = translationDocs > 0
    ? `Bundle: ${bundleBlocks > 0 ? `${bundleBlocks} block(s)` : `${translationDocs} locale(s)`}`
    : "Bundle: empty";
  refs.openLocalesBtn.textContent = `Locales: ${translationDocs}`;
  refs.openAssetsBtn.textContent = `Assets: ${assetsCount}`;
  refs.openBlocksBtn.textContent = `Blocks: ${blockCount}`;
  refs.openCodeBtn.textContent = hasDraft ? "Code" : "Code: waiting";

  refs.designBadge.title = hasDesign
    ? `Open design workspace. Source: ${getDesignSourceLabel(designKind)}.`
    : "Attach a design screenshot, export or reference.";
  refs.openLocalesBtn.title = hasTranslationBundle
    ? `Open ${translationDocs} locale file(s).`
    : "Attach locale files or a locale folder.";
  refs.translationBadge.title = hasTranslationBundle
    ? `Bundle contains ${translationDocs} locale file(s) and about ${bundleBlocks} text block(s).`
    : "Translation bundle is empty.";
  refs.openAssetsBtn.title = hasAssets
    ? `Open ${assetsCount} mapped image asset(s).`
    : "Attach content images for the email.";

  refs.designBadge.classList.toggle("passive", !hasDesign);
  refs.designBadge.classList.toggle("is-empty", !hasDesign);
  refs.openLocalesBtn.classList.toggle("passive", !hasTranslationBundle);
  refs.openLocalesBtn.classList.toggle("is-empty", !hasTranslationBundle);
  refs.translationBadge.classList.toggle("passive", !hasTranslationBundle);
  refs.translationBadge.classList.toggle("is-empty", !hasTranslationBundle);
  refs.openAssetsBtn.classList.toggle("passive", !hasAssets);
  refs.openAssetsBtn.classList.toggle("is-empty", !hasAssets);

  refs.openLocalesBtn.hidden = false;
  refs.translationBadge.hidden = false;
  refs.openAssetsBtn.hidden = false;
  refs.openBlocksBtn.hidden = !hasBlocks;
  refs.openCodeBtn.hidden = !hasDraft;
  refs.designBadge.hidden = false;
  refs.chatAttachmentsRow.hidden = false;
}

function renderWorkspaceModals() {
  const active = state.workspaceModal;
  refs.workspaceModalBackdrop.hidden = !active;
  toggleModalVisibility(refs.contextModal, active === "context");
  toggleModalVisibility(refs.localesModal, active === "locales");
  toggleModalVisibility(refs.assetsModal, active === "assets");
  toggleModalVisibility(refs.codeModal, active === "code");
  toggleModalVisibility(refs.rulesModal, active === "rules");
  toggleModalVisibility(refs.journalModal, active === "journal");
  toggleModalVisibility(refs.testsModal, active === "tests");
  toggleModalVisibility(refs.blockCandidatesModal, active === "block-candidates");
  toggleModalVisibility(refs.lessonsModal, active === "lessons");
  toggleModalVisibility(refs.rememberModal, active === "remember");
  toggleModalVisibility(refs.historyModal, active === "history");
  toggleModalVisibility(refs.diffModal, active === "diff");

  if (active === "locales") {
    prepareLocaleEditor();
    renderLocaleEditor();
  }

  if (active === "code") {
    renderCode();
  }

  if (active === "assets") {
    renderAssetsWorkspaceView();
  }

  if (active === "journal") {
    renderJournal();
  }

  if (active === "rules") {
    renderProjectRules();
  }

  if (active === "tests") {
    renderTests();
  }

  if (active === "block-candidates") {
    renderBlockCandidates();
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

function getBlockCandidates() {
  const sections = state.draft?.mail?.sections ?? [];

  return sections
    .map((section, index) => {
      const match = findCatalogMatchForSection(section);
      if (match) {
        return null;
      }

      const fields = [
        section.title ? "title" : "",
        section.body ? "body" : "",
        section.image_key ? "image" : "",
        section.cta_label ? "cta_label" : "",
        section.cta_href ? "cta_href" : "",
        Array.isArray(section.items) && section.items.length > 0 ? "items" : ""
      ].filter(Boolean);

      return {
        index,
        id: `candidate-${cleanText(section.kind) || "block"}-${slugify(section.title || section.eyebrow || `section-${index + 1}`)}`,
        kind: cleanText(section.kind) || "text",
        label: section.title || section.eyebrow || `Section ${index + 1}`,
        body: cleanText(section.body),
        fields,
        hasImage: Boolean(section.image_key),
        hasCta: Boolean(section.cta_label),
        itemCount: Array.isArray(section.items) ? section.items.length : 0,
        definition: {
          id: `candidate-${cleanText(section.kind) || "block"}-${slugify(section.title || section.eyebrow || `section-${index + 1}`)}`,
          label: section.title || section.eyebrow || `Section ${index + 1}`,
          kind: cleanText(section.kind) || "text",
          suggestedInputs: fields,
          localizable: [
            section.title ? "title" : "",
            section.body ? "body" : "",
            section.cta_label ? "cta_label" : ""
          ].filter(Boolean),
          traits: {
            hasImage: Boolean(section.image_key),
            hasCta: Boolean(section.cta_label),
            itemCount: Array.isArray(section.items) ? section.items.length : 0
          },
          sourceSection: {
            index,
            title: section.title || "",
            eyebrow: section.eyebrow || "",
            imageKey: section.image_key || "",
            ctaLabel: section.cta_label || ""
          }
        }
      };
    })
    .filter(Boolean);
}

function renderBlockCandidates() {
  refs.blockCandidatesList.innerHTML = "";
  const candidates = getBlockCandidates();

  refs.blockCandidatesMeta.textContent = candidates.length > 0
    ? `${candidates.length} candidate block(s) found in current draft. Эти секции еще не имеют канонического блока в email-base.`
    : "В текущем draft новых кандидатов в блоки нет.";

  if (candidates.length === 0) {
    refs.blockCandidatesList.appendChild(createTextCard("Сейчас все секции либо совпали с catalog, либо draft еще не собран."));
    return;
  }

  for (const candidate of candidates) {
    const card = document.createElement("article");
    card.className = "block-card";

    const head = document.createElement("div");
    head.className = "block-card-head";

    const badge = document.createElement("span");
    badge.className = "block-kind";
    badge.textContent = `${String(candidate.index + 1).padStart(2, "0")} ${candidate.kind}`;

    const title = document.createElement("strong");
    title.textContent = candidate.label;
    head.append(badge, title);

    const meta = document.createElement("div");
    meta.className = "block-card-meta";
    meta.textContent = [
      `candidate_id=${candidate.id}`,
      candidate.fields.length > 0 ? `fields=${candidate.fields.join(", ")}` : "fields=none",
      candidate.hasImage ? "has_image" : "",
      candidate.hasCta ? "has_cta" : "",
      candidate.itemCount > 0 ? `items=${candidate.itemCount}` : ""
    ].filter(Boolean).join(" | ");

    const note = document.createElement("div");
    note.className = "block-catalog-match is-missing";
    note.textContent = "Нужен новый block definition. Эту секцию лучше превратить в переиспользуемый блок для каталога.";

    const body = document.createElement("p");
    body.textContent = candidate.body || "Без body.";

    const fields = document.createElement("div");
    fields.className = "candidate-field-list";
    fields.textContent = candidate.fields.length > 0
      ? `Suggested inputs: ${candidate.fields.join(", ")}`
      : "Suggested inputs: none";

    const schema = document.createElement("pre");
    schema.className = "candidate-schema";
    schema.textContent = JSON.stringify(candidate.definition, null, 2);

    card.append(head, meta, note, body, fields, schema);
    refs.blockCandidatesList.appendChild(card);
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
  updateChatIntakeCompact();
}

function renderStatus() {
  const providerLabel = getSelectedProvider()?.label || state.settings.providerId;
  const providerRuntime = getActiveProviderRuntime();
  const hasProviderIssue = Boolean(providerRuntime?.fallback && providerRuntime?.issueCode);
  const isLive = state.settings.providerId === "openai"
    && state.api.openAiConfigured
    && !hasProviderIssue;
  let statusText = "Генерирую...";
  if (!state.busy) {
    if (hasProviderIssue) {
      statusText = `${providerLabel}: ${formatProviderIssue(providerRuntime)}`;
    } else if (state.settings.providerId === "openai" && !state.api.openAiConfigured) {
      statusText = `${providerLabel}: нет OPENAI_API_KEY, работает mock mode`;
    } else if (state.settings.providerId === "mock") {
      statusText = "Mock mode: без vision-разбора и без реального AI ответа";
    } else {
      statusText = `${providerLabel}: ${state.api.openAiConfigured ? state.api.model : "demo mode"}`;
    }
  }

  refs.apiStatus.textContent = statusText;
  refs.aiModePill.textContent = hasProviderIssue
    ? providerRuntime.issueCode === "quota"
      ? "AI BILLING"
      : "AI FALLBACK"
    : isLive
      ? "LIVE AI"
      : "MOCK / FALLBACK";
  refs.aiModePill.dataset.state = hasProviderIssue ? "error" : isLive ? "live" : "mock";
  refs.modeValue.textContent = state.mode;
  refs.loadBaseBtn.disabled = state.busy;
  refs.createBaseMailBtn.disabled = state.busy;
  refs.buildBaseMailBtn.disabled = state.busy;
  refs.generateLocalesBtn.disabled = state.busy;
  refs.generateLocalesModalBtn.disabled = state.busy;
  refs.fillDemoBtn.disabled = state.busy;
  refs.clearChatBtn.disabled = state.busy;
  refs.clearStateBtn.disabled = state.busy;
  refs.toggleAttachMenuBtn.disabled = state.busy;
  refs.pasteFigmaLinkBtn.disabled = state.busy;
  refs.designBadge.disabled = state.busy;
  refs.openLocalesBtn.disabled = state.busy;
  refs.translationBadge.disabled = state.busy;
  refs.openAssetsBtn.disabled = state.busy;
  refs.openBlocksBtn.disabled = state.busy;
  refs.openCodeBtn.disabled = state.busy;
  refs.openContextBtn.disabled = state.busy;
  refs.openDesignQuickBtn.disabled = state.busy;
  refs.openLocalesQuickBtn.disabled = state.busy;
  refs.openAssetsQuickBtn.disabled = state.busy;
  refs.openCodeQuickBtn.disabled = state.busy;
  refs.openTestsBtn.disabled = state.busy;
  refs.openTestsQuickBtn.disabled = state.busy;
  refs.openRulesBtn.disabled = state.busy;
  refs.openJournalBtn.disabled = state.busy;
  refs.openJournalFromSettingsBtn.disabled = state.busy;
  if (refs.openRulesFromSettingsBtn) refs.openRulesFromSettingsBtn.disabled = state.busy;
  if (refs.openLessonsFromSettingsBtn) refs.openLessonsFromSettingsBtn.disabled = state.busy;
  refs.refreshCatalogBtn.disabled = state.busy;
  refs.attachDesignBtn.disabled = state.busy;
  refs.attachTranslationsBtn.disabled = state.busy;
  refs.attachTranslationFolderBtn.disabled = state.busy;
  refs.attachAssetsBtn.disabled = state.busy;
  refs.analyzeDesignBtn.disabled = state.busy || detectDesignInputKind() === "none";
  refs.clearDesignBtn.disabled = state.busy;
  if (refs.saveDesignReferenceBtn) refs.saveDesignReferenceBtn.disabled = state.busy;
  if (refs.clearDesignReferenceBtn) refs.clearDesignReferenceBtn.disabled = state.busy;
  refs.designReferenceUrlInput.disabled = state.busy;
  refs.figmaPayloadInput.disabled = state.busy;
  refs.figmaPayloadFileInput.disabled = state.busy;
  refs.importFigmaPayloadBtn.disabled = state.busy;
  refs.loadFigmaPayloadFileBtn.disabled = state.busy;
  refs.clearFigmaPayloadBtn.disabled = state.busy || !state.design?.figmaImport;
  refs.saveLocaleEditsBtn.disabled = state.busy;
  refs.saveCodeBtn.disabled = state.busy;
  refs.createBaseMailFromCodeBtn.disabled = state.busy;
  refs.saveRuleBtn.disabled = state.busy;
  refs.clearRulesBtn.disabled = state.busy;
  refs.ruleInput.disabled = state.busy;
  refs.clearJournalBtn.disabled = state.busy;
  refs.closeRulesModalBtn.disabled = state.busy;
  refs.closeRulesFooterBtn.disabled = state.busy;
  refs.closeContextModalBtn.disabled = state.busy;
  refs.closeContextFooterBtn.disabled = state.busy;
  refs.closeTestsModalBtn.disabled = state.busy;
  refs.closeTestsFooterBtn.disabled = state.busy;
  refs.copyPreviewHtmlBtn.disabled = state.busy || !getCurrentPreviewHtml();
  for (const button of refs.previewViewportButtons) {
    button.disabled = state.busy;
  }
  for (const button of refs.chatSubmitButtons) {
    button.disabled = state.busy;
  }
}

function renderSummary() {
  const mail = state.draft?.mail;
  const previewLocale = getCurrentPreviewLocale();

  const hasDraft = !!mail?.subject;
  const summaryBar = document.querySelector("#previewSummaryBar");
  if (summaryBar) summaryBar.classList.toggle("has-draft", hasDraft);

  if (refs.subjectValue) refs.subjectValue.textContent = mail?.subject || "Сгенерируйте первый драфт";
  if (refs.preheaderValue) {
    const ph = mail?.preheader || "";
    refs.preheaderValue.textContent = ph;
    refs.preheaderValue.hidden = !ph;
  }
  if (refs.localeValue) {
    // Only show locale chip once a draft exists
    const loc = hasDraft ? (previewLocale || mail?.locale || state.brief.locale || "") : "";
    refs.localeValue.textContent = loc;
  }
  if (refs.mailIdValue) {
    // Only show mail ID chip once a draft exists
    if (hasDraft) {
      const cat = state.brief.category || "";
      const mid = state.brief.mailId || "";
      refs.mailIdValue.textContent = cat && mid ? `${cat}/mail-${mid}` : (cat || mid || "");
    } else {
      refs.mailIdValue.textContent = "";
    }
  }
  // keep hidden fields updated for compatibility
  if (refs.sourceValue) refs.sourceValue.textContent = state.previewSource;
}

function buildAssistantNote() {
  if (state.providerRuntime?.issueCode === "quota") {
    return "OpenAI подключен, но сейчас упирается в billing/quota. Подробности в чате слева.";
  }

  if (state.providerRuntime?.issueCode === "auth") {
    return "Есть проблема с API-ключом OpenAI. Подробности в чате слева.";
  }

  if (String(state.mode || "").includes("discuss")) {
    return "";
  }

  if (String(state.previewSource || "").startsWith("email-base")) {
    if (state.previewSource === "email-base-draft") {
      return "Сейчас в preview показан временный build черновика через реальный email-base pipeline.";
    }
    return "Сейчас в preview показан реальный build из email-base.";
  }

  if (state.draft?.mail) {
    const localesCount = getParsedLocaleEntries().length;
    return localesCount > 0
      ? `Черновик обновлен. В bundle сейчас ${localesCount} локалей. Открой Локали, Код или Тесты.`
      : "Черновик обновлен. Открой Локали, Код или Тесты.";
  }

  return "";
}

function renderPreview() {
  const baseHtml = getCurrentPreviewHtml();
  const showSkeleton = state.busy && !baseHtml;
  refs.previewStage.dataset.viewport = state.previewViewport || "fit";
  if (refs.previewSkeleton) refs.previewSkeleton.classList.toggle("is-visible", showSkeleton);
  refs.previewFrame.style.display = showSkeleton ? "none" : "";
  const simulated = simulatePreviewHtml(baseHtml, state.settings.clientProfileId);
  refs.previewFrame.srcdoc = simulated;
}

function renderPreviewViewportButtons() {
  for (const button of refs.previewViewportButtons) {
    button.classList.toggle("is-active", button.dataset.previewViewport === state.previewViewport);
  }
}

// ─── Image Slot Panel ──────────────────────────────────────────────────────

/**
 * Rebuild preview HTML from state.draft.mail client-side.
 * Called after user enters an image URL in the slot panel, so the
 * preview reflects the new asset without a server round-trip.
 */
function rebuildDraftHtmlFromMail(mail) {
  if (!mail || !Array.isArray(mail.sections)) return null;

  // Detect system email mode from current state
  const isSystem = (state.brief?.category || "").toLowerCase().includes("system") ||
    (state.brief?.category || "") === "X_System";

  if (isSystem) return rebuildSystemEmailHtml(mail);

  const assetMap = {};
  for (const a of (mail.assets || [])) {
    if (a.key) assetMap[a.key] = a;
  }

  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function paragraphize(text) {
    return text.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join("");
  }

  function sectionHtml(section) {
    const asset = section.image_key ? assetMap[section.image_key] : null;
    const imgSrc = asset?.url || "";
    const imgAlt = asset?.alt || "";
    const imgW = asset?.width || 600;
    const imgH = asset?.height || 300;
    const imgTag = imgSrc
      ? `<img class="section-image" src="${esc(imgSrc)}" alt="${esc(imgAlt)}" width="${imgW}" height="${imgH}" style="width:100%;display:block;border-radius:20px;margin-bottom:20px;" />`
      : "";
    const eyebrow = section.eyebrow ? `<div class="eyebrow">${esc(section.eyebrow)}</div>` : "";
    const body = section.body ? `<div class="body-copy">${paragraphize(section.body)}</div>` : "";
    const btn = section.cta_label
      ? section.cta_href
        ? `<a class="button" href="${esc(section.cta_href)}">${esc(section.cta_label)}</a>`
        : `<span class="button is-disabled">${esc(section.cta_label)}</span>`
      : "";
    const items = section.items?.length
      ? `<ul>${section.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`
      : "";

    if (section.kind === "hero") {
      return `<section class="section hero">${imgTag}<div class="section-content">${eyebrow}<h1>${esc(section.title || mail.subject)}</h1>${body}${btn}</div></section>`;
    }
    if (section.kind === "feature-list") {
      return `<section class="section feature-list">${eyebrow}<h2>${esc(section.title || "")}</h2>${body}${items}</section>`;
    }
    if (section.kind === "image") {
      return `<section class="section image-only">${eyebrow}${imgTag}${body}</section>`;
    }
    if (section.kind === "cta") {
      return `<section class="section cta">${eyebrow}<h2>${esc(section.title || "")}</h2>${body}${btn}</section>`;
    }
    if (section.kind === "footer") {
      return `<section class="section footer">${body || `<p>${esc(section.title || "")}</p>`}</section>`;
    }
    return `<section class="section text">${eyebrow}<h2>${esc(section.title || "")}</h2>${body}${btn}${items}</section>`;
  }

  const sectionsHtml = mail.sections.map(sectionHtml).join("");

  return `<!DOCTYPE html>
<html lang="${esc(mail.locale)}">
  <head>
    <meta charset="utf-8" />
    <title>${esc(mail.subject)}</title>
    <style>
      body{margin:0;background:#eef2e8;color:#14281d;font-family:"Avenir Next","Segoe UI",sans-serif}
      .canvas{max-width:640px;margin:32px auto;background:#fffdf7;border-radius:28px;overflow:hidden;box-shadow:0 24px 70px rgba(20,40,29,.16)}
      .meta{padding:18px 24px;background:#14281d;color:#d7e6c8;font-size:12px;letter-spacing:.08em;text-transform:uppercase}
      .section{padding:28px 24px;border-bottom:1px solid rgba(20,40,29,.08)}
      .hero{background:linear-gradient(160deg,#1d3b2a 0%,#365b38 42%,#f4a259 100%);color:#fff9f0}
      .hero h1,.section h2{margin:0 0 12px;line-height:1.05}
      .hero h1{font-size:42px}.section h2{font-size:28px}
      .eyebrow{margin-bottom:12px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.72}
      .body-copy p,.footer p{margin:0 0 12px;font-size:16px;line-height:1.6}
      .button{display:inline-block;margin-top:16px;padding:14px 32px;background:#f4a259;color:#fff;border-radius:100px;font-size:15px;font-weight:700;text-decoration:none}
      ul{padding-left:20px;margin:12px 0}li{margin:6px 0;font-size:16px;line-height:1.5}
    </style>
  </head>
  <body>
    <div class="canvas">
      <div class="meta">${esc(mail.subject)} · ${esc(mail.locale)}</div>
      ${sectionsHtml}
    </div>
  </body>
</html>`;
}

/**
 * Render the image-slot panel that appears after draft generation
 * when the AI has specified asset slots (mail.assets[]).
 * Shows each slot with a URL input; entering a URL rebuilds the preview live.
 */
function renderImageSlotPanel() {
  if (!refs.imageSlotPanel || !refs.imageSlotList) return;

  const assets = state.draft?.mail?.assets;
  const hasMail = Boolean(state.draft?.mail);
  // Show panel only when there's a mail with assets and panel isn't dismissed
  const hasSlots = hasMail && Array.isArray(assets) && assets.length > 0;

  if (!hasSlots || state.imageSlotPanelDismissed) {
    refs.imageSlotPanel.hidden = true;
    return;
  }

  refs.imageSlotPanel.hidden = false;

  // Re-render the slot list
  refs.imageSlotList.innerHTML = "";

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const hasUrl = Boolean(asset.url && asset.url.trim() && !asset.url.startsWith("http://placeholder"));

    const item = document.createElement("div");
    item.className = "image-slot-item";

    // Thumbnail or placeholder icon
    const thumbWrap = document.createElement("div");
    if (hasUrl) {
      const img = document.createElement("img");
      img.className = "image-slot-thumb";
      img.src = asset.url;
      img.alt = asset.alt || asset.key;
      img.onerror = () => {
        img.replaceWith(makePlaceholderThumb());
      };
      thumbWrap.appendChild(img);
    } else {
      thumbWrap.appendChild(makePlaceholderThumb());
    }

    // Fields column
    const fields = document.createElement("div");
    fields.className = "image-slot-fields";

    const label = document.createElement("div");
    label.className = "image-slot-label";
    label.textContent = asset.key;

    const hint = document.createElement("div");
    hint.className = "image-slot-hint";
    hint.textContent = [
      asset.placement ? `📍 ${asset.placement}` : "",
      asset.alt ? asset.alt : "",
      asset.width && asset.height ? `${asset.width}×${asset.height}` : ""
    ].filter(Boolean).join(" · ");

    // URL input row
    const inputRow = document.createElement("div");
    inputRow.className = "image-slot-input-row";

    const input = document.createElement("input");
    input.type = "url";
    input.className = `image-slot-input${hasUrl ? " has-value" : ""}`;
    input.placeholder = "https://cdn.example.com/image.jpg";
    input.value = hasUrl ? asset.url : "";

    // Hidden file input for upload
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";

    // Upload button
    const uploadBtn = document.createElement("button");
    uploadBtn.type = "button";
    uploadBtn.className = "image-slot-upload-btn";
    uploadBtn.title = "Загрузить файл";
    uploadBtn.textContent = "↑";

    // Helper: apply a new URL to this slot
    const applyUrl = (newUrl) => {
      if (state.draft?.mail?.assets?.[i]) {
        state.draft.mail.assets[i].url = newUrl;
      }
      input.value = newUrl;
      input.classList.toggle("has-value", Boolean(newUrl));

      if (newUrl) {
        let existingThumb = thumbWrap.querySelector("img.image-slot-thumb");
        if (!existingThumb) {
          thumbWrap.innerHTML = "";
          existingThumb = document.createElement("img");
          existingThumb.className = "image-slot-thumb";
          existingThumb.alt = asset.alt || asset.key;
          existingThumb.onerror = () => existingThumb.replaceWith(makePlaceholderThumb());
          thumbWrap.appendChild(existingThumb);
        }
        existingThumb.src = newUrl;
      } else {
        thumbWrap.innerHTML = "";
        thumbWrap.appendChild(makePlaceholderThumb());
      }

      if (state.draft?.mail) {
        const rebuilt = rebuildDraftHtmlFromMail(state.draft.mail);
        if (rebuilt) {
          state.draft.html = rebuilt;
          renderPreview();
        }
      }
    };

    input.addEventListener("input", () => applyUrl(input.value.trim()));

    // File upload handler shared by button + drop
    const handleFileUpload = async (file) => {
      if (!file || !file.type.startsWith("image/")) return;
      uploadBtn.textContent = "…";
      uploadBtn.disabled = true;
      try {
        const url = await uploadAssetFile(file, asset.key);
        applyUrl(url);
      } catch (err) {
        console.error("[image-slot] upload failed", err);
      } finally {
        uploadBtn.textContent = "↑";
        uploadBtn.disabled = false;
      }
    };

    fileInput.addEventListener("change", () => {
      if (fileInput.files?.[0]) handleFileUpload(fileInput.files[0]);
    });
    uploadBtn.addEventListener("click", () => fileInput.click());

    // Drag & drop on the thumbnail placeholder
    thumbWrap.addEventListener("dragover", (e) => {
      e.preventDefault();
      thumbWrap.classList.add("drag-over");
    });
    thumbWrap.addEventListener("dragleave", () => thumbWrap.classList.remove("drag-over"));
    thumbWrap.addEventListener("drop", (e) => {
      e.preventDefault();
      thumbWrap.classList.remove("drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFileUpload(file);
    });

    inputRow.appendChild(input);
    inputRow.appendChild(uploadBtn);
    inputRow.appendChild(fileInput);

    fields.appendChild(label);
    if (hint.textContent) fields.appendChild(hint);
    fields.appendChild(inputRow);

    item.appendChild(thumbWrap);
    item.appendChild(fields);
    refs.imageSlotList.appendChild(item);
  }
}

function renderScaffoldBanner() {
  if (!refs.scaffoldBanner) return;
  const sc = state.scaffoldContext;
  if (!sc) {
    refs.scaffoldBanner.hidden = true;
    return;
  }
  refs.scaffoldBanner.hidden = false;
  if (refs.scaffoldBannerText) {
    refs.scaffoldBannerText.textContent =
      `Scaffold mode: mail-${sc.newMailId} (${sc.tokenKeys?.length || 0} токенов). Напиши промт → AI заполнит копи.`;
  }
}

/**
 * Upload an image file to the studio's internal asset storage.
 * Uses the existing /api/assets/register endpoint (accepts base64 dataUrl).
 * Returns the public URL: /studio-assets/filename
 */
async function uploadAssetFile(file, assetKey) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = reader.result;
        const response = await fetch("/api/assets/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: [{
              name: file.name,
              dataUrl,
              kind: "asset",
              key: assetKey || "upload",
              alt: assetKey || file.name.replace(/\.[^.]+$/, ""),
              placement: "auto"
            }]
          })
        });
        if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
        const data = await response.json();
        const item = data.items?.[0];
        if (!item?.fileName) throw new Error("No fileName in response");
        resolve(`/studio-assets/${encodeURIComponent(item.fileName)}`);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

function makePlaceholderThumb() {
  const div = document.createElement("div");
  div.className = "image-slot-thumb-placeholder";
  div.textContent = "🖼";
  return div;
}

/**
 * Client-side rebuild of system (transactional) email HTML.
 * Mirrors the server-side renderSystemEmailHtml() for live preview updates.
 */
function rebuildSystemEmailHtml(mail) {
  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function para(text) {
    return text.split(/\n+/).filter(Boolean).map(p => `<p style="margin:0 0 14px;color:#4f5f73;font-size:16px;line-height:24px;">${esc(p)}</p>`).join("");
  }

  const sections = (mail.sections || []).filter(s => s.kind !== "footer");
  const sectionsHtml = sections.map((section, i) => {
    if (section.kind === "image") return "";
    const isLead = i === 0;
    const titleTag = isLead ? "h1" : "h2";
    const titleSize = isLead ? "28px" : "20px";
    const title = section.title
      ? `<${titleTag} style="margin:0 0 16px;color:#20242f;font-size:${titleSize};font-weight:700;line-height:1.2;">${esc(section.title)}</${titleTag}>`
      : "";
    const eyebrow = section.eyebrow
      ? `<div style="margin:0 0 8px;color:#2473d7;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">${esc(section.eyebrow)}</div>`
      : "";
    const body = section.body ? `<div>${para(section.body)}</div>` : "";
    const btn = section.cta_label
      ? section.cta_href
        ? `<a href="${esc(section.cta_href)}" style="display:inline-block;margin-top:8px;padding:13px 22px;background:#2c89df;color:#fff;text-decoration:none;border-radius:4px;font-size:14px;font-weight:700;">${esc(section.cta_label)}</a>`
        : `<span style="display:inline-block;margin-top:8px;padding:13px 22px;background:#2c89df;color:#fff;border-radius:4px;font-size:14px;font-weight:700;opacity:.7;">${esc(section.cta_label)}</span>`
      : "";
    const items = section.kind === "feature-list" && section.items?.length
      ? `<ul style="margin:10px 0 0 18px;padding:0;">${section.items.map(it => `<li style="margin:0 0 10px;font-size:16px;line-height:24px;color:#20242f;">${esc(it)}</li>`).join("")}</ul>`
      : "";
    return `<tr><td style="padding:${isLead ? "8px" : "0"} 40px 22px;">${eyebrow}${title}${body}${items}${btn}</td></tr>`;
  }).join("");

  // Footer
  const footerSection = (mail.sections || []).find(s => s.kind === "footer");
  const footerText = footerSection?.body || footerSection?.title || "© Company. All rights reserved.";
  const footerHtml = `<tr><td style="padding:10px 40px 32px;"><div style="border-top:1px solid #e6ebf0;padding-top:18px;">${para(footerText)}</div></td></tr>`;

  return `<!DOCTYPE html>
<html lang="${esc(mail.locale)}">
<head>
<meta charset="utf-8"/><title>${esc(mail.subject)}</title>
<style>body{margin:0;background:#f6f9fc;font-family:Roboto,Helvetica,Arial,sans-serif;color:#20242f}</style>
</head>
<body>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f6f9fc;padding:20px 0 36px;">
<tr><td align="center">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:640px;background:#fff;">
<tr><td style="padding:16px 22px 0;color:#7a8698;font-size:11px;letter-spacing:.04em;text-transform:uppercase;">
Subject: ${esc(mail.subject)}<br/>Preheader: ${esc(mail.preheader)}
</td></tr>
<tr><td style="padding:28px 40px 14px;"><div style="color:#f58220;font-size:22px;font-weight:700;">${esc(mail.subject)}</div></td></tr>
${sectionsHtml}
${footerHtml}
</table>
</td></tr>
</table>
</body>
</html>`;
}

function renderPreviewLocaleTabs() {
  const locales = getAvailableDraftLocales();
  refs.previewLocaleTabs.innerHTML = "";
  // locale row is visible only when there are multiple locales to switch between
  const multiLocale = locales.length > 1;
  refs.previewLocaleRow.hidden = !multiLocale;

  if (!state.draft?.html) {
    return;
  }

  const visibleLocales = locales.length > 0
    ? locales
    : [cleanText(state.previewLocale || state.brief.locale || state.draft?.mail?.locale || "en")].filter(Boolean);

  const activeLocale = getCurrentPreviewLocale();
  for (const locale of visibleLocales) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `locale-tab${locale === activeLocale ? " is-active" : ""}`;
    button.textContent = locale;
    button.addEventListener("click", () => setPreviewLocale(locale));
    refs.previewLocaleTabs.appendChild(button);
  }
}

function renderTabs() {
  for (const tab of refs.codeTabs) {
    tab.classList.toggle("is-active", tab.dataset.tab === state.activeTab);
  }
}

function renderCodeLocaleTabs() {
  refs.codeLocaleTabs.innerHTML = "";

  if (!isCodeLocaleAwareTab(state.activeTab)) {
    refs.codeLocaleTabs.hidden = true;
    return;
  }

  const locales = getCodeFilesForTab(state.activeTab)
    .map((file) => cleanText(file.locale))
    .filter(Boolean);
  const visibleLocales = locales.length > 0 ? locales : getAvailableDraftLocales();

  if (visibleLocales.length <= 1) {
    refs.codeLocaleTabs.hidden = true;
    return;
  }

  refs.codeLocaleTabs.hidden = false;
  const activeLocale = getCurrentPreviewLocale();
  for (const locale of visibleLocales) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `locale-tab${locale === activeLocale ? " is-active" : ""}`;
    button.textContent = locale;
    button.addEventListener("click", () => setPreviewLocale(locale));
    refs.codeLocaleTabs.appendChild(button);
  }
}

function renderCodeFileList() {
  refs.codeFileList.innerHTML = "";

  const files = getCodeFilesForTab(state.activeTab);
  if (files.length === 0) {
    refs.codeFileMeta.textContent = "Файлы появятся после первого draft или real build.";
    refs.codeFileList.appendChild(createTextCard("Пока нечего показывать."));
    return;
  }

  const activeFileId = getPreferredCodeFileId(state.activeTab);
  refs.codeFileMeta.textContent = files.length === 1
    ? "Одна текущая версия файла."
    : `${files.length} файлов доступно для просмотра и сравнения.`;

  for (const file of files) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `code-file-button${file.id === activeFileId ? " is-active" : ""}`;
    button.addEventListener("click", () => {
      state.codeFileSelection[state.activeTab] = file.id;
      state.codeEditorBuffer = file.content;
      renderCode();
      persistState();
    });

    const title = document.createElement("strong");
    title.textContent = file.label;

    const meta = document.createElement("span");
    meta.className = "code-file-meta";
    const metaParts = [
      file.locale ? `locale ${file.locale}` : "",
      file.language.toUpperCase(),
      file.editable ? "editable" : "read-only"
    ].filter(Boolean);
    meta.textContent = metaParts.join(" • ");

    const pathLine = document.createElement("span");
    pathLine.className = "code-file-path";
    pathLine.textContent = file.path;

    button.append(title, meta, pathLine);
    refs.codeFileList.appendChild(button);
  }
}

function renderCode() {
  syncCodeSelectionWithPreviewLocale();
  const activeFile = getCurrentCodeFile();
  const currentValue = cleanText(activeFile?.content) || "Код появится после первого draft или build.";

  if (!state.codeEditorBuffer || refs.codeModal.getAttribute("aria-hidden") !== "false") {
    state.codeEditorBuffer = currentValue;
  }

  renderCodeLocaleTabs();
  renderCodeFileList();

  // Overlay mode: both highlight (behind) and textarea (on top) always shown
  refs.codeOutput.hidden = false;
  refs.codeHighlight.hidden = false;
  refs.codeOutput.value = state.codeEditorBuffer;
  refs.codeHighlight.innerHTML = renderHighlightedCode(state.codeEditorBuffer, activeFile?.language || "text");
  const tabDescriptions = {
    html: "Готовый HTML preview для текущей локали.",
    pug: "Шаблонная структура письма и include-файлы.",
    stylus: "Стили, которые участвуют в email-base сборке.",
    locales: "Locale payload по каждой локали.",
    assets: "Asset manifest текущего draft: URL, placement, alt, notes.",
    spec: "Нормализованная draft-структура, с которой работает студия.",
    buildLog: "Логи реального email-base build по локали."
  };
  refs.codeEditorMeta.textContent = activeFile
    ? [
        `${activeFile.label}`,
        activeFile.locale ? `локаль ${activeFile.locale}` : "",
        tabDescriptions[state.activeTab] || ""
      ].filter(Boolean).join(" • ")
    : "Можно смотреть текущее представление драфта.";
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

function renderProjectRules() {
  refs.rulesList.innerHTML = "";
  const summary = state.projectRules.summary || state.api.projectRules;
  const items = Array.isArray(state.projectRules.items) ? state.projectRules.items : [];

  refs.rulesMeta.textContent = summary?.itemCount
    ? `Активных правил: ${summary.activeCount || summary.itemCount}. Эти правила попадают в AI-контекст при обсуждении, анализе дизайна и сборке письма.`
    : "Правил пока нет. Можно добавить вручную или написать в чате: «запомни правило: ...».";

  if (items.length === 0) {
    refs.rulesList.appendChild(createTextCard("Пока нет project rules. Сохрани первое правило вручную или через чат-команду."));
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "asset-item";

    const title = document.createElement("strong");
    title.textContent = item.text;

    const meta = document.createElement("div");
    meta.className = "settings-info";
    meta.textContent = `source=${item.source || "manual"} | updated=${formatJournalTimestamp(item.updatedAt || item.createdAt)}`;

    card.append(title, meta);
    refs.rulesList.appendChild(card);
  }
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

async function handleSaveRule() {
  const text = cleanText(refs.ruleInput.value);
  if (!text) {
    return;
  }

  state.busy = true;
  renderStatus();

  try {
    const response = await fetch("/api/project-rules", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        source: "rules-modal"
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Rule save failed");
    }

    state.projectRules = {
      items: Array.isArray(payload.items) ? payload.items : [],
      summary: payload.summary || null
    };
    refs.ruleInput.value = "";
    state.messages.push({
      role: "assistant",
      content: `Сохранил правило проекта: ${text}`
    });
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Ошибка при сохранении правила: ${error.message}`
    });
  } finally {
    state.busy = false;
    renderAll();
    persistState();
  }
}

async function handleClearRules() {
  state.busy = true;
  renderStatus();

  try {
    const response = await fetch("/api/project-rules/clear", {
      method: "POST"
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Rules clear failed");
    }

    state.projectRules = {
      items: Array.isArray(payload.items) ? payload.items : [],
      summary: payload.summary || null
    };
    refs.ruleInput.value = "";
    state.messages.push({
      role: "assistant",
      content: "Project rules очищены."
    });
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Ошибка при очистке project rules: ${error.message}`
    });
  } finally {
    state.busy = false;
    renderAll();
    persistState();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI LESSONS — functions
// ─────────────────────────────────────────────────────────────────────────────

async function loadLessons() {
  try {
    const response = await fetch("/api/ai/lessons");
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}

function renderLessonsPanel(lessons) {
  if (!refs.lessonsList) return;
  if (!lessons || lessons.length === 0) {
    refs.lessonsList.innerHTML = '<div class="diagnostics-item"><span class="diagnostics-message">Уроков пока нет. Добавь первый!</span></div>';
    return;
  }
  refs.lessonsList.innerHTML = lessons.map((lesson) => {
    const tags = lesson.tags?.length ? `<span class="lesson-tags">${lesson.tags.join(", ")}</span>` : "";
    return `
      <div class="diagnostics-item lesson-item" data-lesson-id="${lesson.id}">
        <div class="lesson-meta">
          <span class="lesson-category">${lesson.category}</span>
          ${tags}
          <span class="lesson-date">${new Date(lesson.createdAt).toLocaleDateString("ru-RU")}</span>
        </div>
        <div class="lesson-mistake">❌ ${lesson.mistake}</div>
        <div class="lesson-correction">✅ ${lesson.correction}</div>
        <button class="ghost-button lesson-delete-btn" data-lesson-id="${lesson.id}" type="button">Удалить</button>
      </div>
    `;
  }).join("");

  // Attach delete handlers
  refs.lessonsList.querySelectorAll(".lesson-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.dataset.lessonId;
      await fetch(`/api/ai/lesson/${id}`, { method: "DELETE" });
      const lessons = await loadLessons();
      renderLessonsPanel(lessons);
      updateLessonsCountBadge(lessons.length);
    });
  });
}

function updateLessonsCountBadge(count) {
  [refs.lessonsCountBadge, refs.lessonsCountBadgeSettings].forEach((badge) => {
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  });
}

async function openLessonsModal() {
  const lessons = await loadLessons();
  renderLessonsPanel(lessons);
  updateLessonsCountBadge(lessons.length);
  openWorkspaceModal("lessons");
}

async function handleSaveLesson() {
  const mistake = refs.lessonMistakeInput?.value?.trim();
  const correction = refs.lessonCorrectionInput?.value?.trim();
  const category = refs.lessonCategorySelect?.value || "general";

  if (!mistake || !correction) {
    alert("Заполни оба поля: ошибка и правильный вариант.");
    return;
  }

  try {
    const response = await fetch("/api/ai/lesson", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mistake, correction, category, source: "user" })
    });
    if (!response.ok) throw new Error("Save failed");

    refs.lessonMistakeInput.value = "";
    refs.lessonCorrectionInput.value = "";

    const lessons = await loadLessons();
    renderLessonsPanel(lessons);
    updateLessonsCountBadge(lessons.length);
  } catch (error) {
    alert(`Ошибка: ${error.message}`);
  }
}

async function handleClearLessons() {
  if (!confirm("Удалить все уроки? AI забудет все исправления.")) return;
  await fetch("/api/ai/lessons/clear", { method: "POST" });
  const lessons = await loadLessons();
  renderLessonsPanel(lessons);
  updateLessonsCountBadge(0);
}

function openRememberModal() {
  if (refs.rememberMistakeInput) refs.rememberMistakeInput.value = "";
  if (refs.rememberCorrectionInput) refs.rememberCorrectionInput.value = "";
  openWorkspaceModal("remember");
}

async function handleSaveRememberLesson() {
  const mistake = refs.rememberMistakeInput?.value?.trim();
  const correction = refs.rememberCorrectionInput?.value?.trim();
  const category = refs.rememberCategorySelect?.value || "general";

  if (!mistake || !correction) {
    alert("Заполни оба поля.");
    return;
  }

  try {
    const response = await fetch("/api/ai/lesson", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mistake, correction, category, source: "user" })
    });
    if (!response.ok) throw new Error("Save failed");

    closeWorkspaceModal();
    const lessons = await loadLessons();
    updateLessonsCountBadge(lessons.length);

    state.messages.push({
      role: "assistant",
      content: `✅ Урок сохранён. AI запомнит: "${mistake.slice(0, 60)}..."`
    });
    renderAll();
  } catch (error) {
    alert(`Ошибка: ${error.message}`);
  }
}

// Load lessons badge on startup
loadLessons().then((lessons) => updateLessonsCountBadge(lessons.length));

// ─────────────────────────────────────────────────────────────────────────────
// END AI LESSONS
// ─────────────────────────────────────────────────────────────────────────────

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
    ? `Сейчас это heuristic test suite по ${state.api.clientProfiles.length || 1} client profile(s). Это полезная ранняя диагностика по Gmail/Outlook/Apple Mail профилям, но не полный эмулятор всех клиентов.`
    : "Сначала нужен draft или реальный build, потом здесь появятся client diagnostics и build warnings.";

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
  const hasFigmaImport = Boolean(state.design?.figmaImport);
  refs.designPreviewWrap.hidden = !hasDesign;
  refs.designEmptyState.hidden = hasDesign;

  if (!hasDesign) {
    if (hasFigmaImport) {
      refs.designEmptyState.hidden = false;
      refs.designEmptyState.textContent = "Structured Figma payload уже загружен. Для визуального preview и vision лучше еще приложить image export выбранного frame.";
    } else if (designLink) {
      refs.designEmptyState.hidden = false;
      refs.designEmptyState.textContent = `Используется design reference link: ${designLink}. Если это приватный Figma frame, для превью и vision лучше приложить скрин или image export.`;
    } else {
      refs.designEmptyState.textContent = "Design пока не загружен. Можно вставить скрин прямо в чат или нажать Attach design.";
    }
    return;
  }

  refs.designPreview.src = designSource;
  const baseCaption = state.design.assetId
    ? `${state.design.name} сохранен в проекте и может переиспользоваться.`
    : state.design.dataUrl
      ? `${state.design.name} загружен только в текущую сессию браузера.`
      : `Используется внешний design reference: ${cleanText(state.brief.designUrl)}`;
  refs.designCaption.textContent = hasFigmaImport
    ? `${baseCaption} Structured Figma payload тоже подключен и будет использован для layer/text context.`
    : baseCaption;
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
  const providerRuntime = getActiveProviderRuntime();
  const figma = state.api.figma;
  refs.providerHelp.textContent = provider
    ? `${provider.status}. Возможности: ${provider.capabilities.join(", ")}.`
    : "Провайдер пока не определен.";

  refs.runtimeConfigInfo.textContent = config
    ? config.openAiConfigured
      ? `Runtime: ${config.openAiModel} active. .env: ${config.envFileLoaded ? config.envFilePath : "not found"}.${providerRuntime?.fallback ? ` Last provider issue: ${formatProviderIssue(providerRuntime)}.` : ""}${config.deepLConfigured ? " DeepL: ✓" : ""}`
      : `Runtime: OpenAI key not loaded. Создай ${config.envFilePath} с OPENAI_API_KEY=... и перезапусти сервер.`
    : "Runtime config недоступен.";

  // Show DeepL auto-translate button only when key is configured
  if (refs.deeplAutoTranslateBtn) {
    refs.deeplAutoTranslateBtn.hidden = !(config?.deepLConfigured);
  }

  const profile = getSelectedClientProfile();
  refs.clientProfileHelp.textContent = profile
    ? profile.description
    : "Выберите профиль клиента для heuristic preview.";

  refs.figmaRuntimeInfo.textContent = figma
    ? [
        `Recommended flow: ${figma.recommendedFlow}`,
        `Plugin endpoint: ${figma.pluginImportEndpoint}${figma.pluginImportSecretRequired ? " (secret required)." : " (local dev open)."}`,
        figma.serverTokenConfigured
          ? "Server-side Figma token configured."
          : "Server-side Figma token not configured yet.",
        Array.isArray(figma.modes) && figma.modes.length > 0
          ? `Modes: ${figma.modes.join(", ")}.`
          : ""
      ].filter(Boolean).join(" ")
    : "Figma intake status пока недоступен.";

  const emailBase = state.api.emailBase;
  const blockCatalogSummary = state.blockCatalog.summary || state.api.blockCatalog;
  const assetRegistrySummary = state.assetRegistry.summary || state.api.assetRegistry;
  refs.emailBaseSummary.textContent = emailBase?.available
    ? `Root: ${emailBase.root}. Current: ${emailBase.currentMail?.folder || "none"}. Locales: ${emailBase.localeCount}. Catalog: ${blockCatalogSummary?.itemCount || 0} blocks. Assets: ${assetRegistrySummary?.itemCount || 0}.`
    : "email-base пока не подключена.";
}

function renderBlockCatalogSummary() {
  refs.blockCatalogSummary.innerHTML = "";
  refs.blockCandidateSummary.innerHTML = "";
  const summary = state.blockCatalog.summary || state.api.blockCatalog;
  const candidates = getBlockCandidates();

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

  if (candidates.length > 0) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pill candidate-pill";
    button.textContent = `${candidates.length} new block candidate(s)`;
    button.addEventListener("click", openBlockCandidatesModal);
    refs.blockCandidateSummary.appendChild(button);
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

function getActiveProviderRuntime() {
  if (!state.providerRuntime) {
    return null;
  }

  return state.providerRuntime.providerId === state.settings.providerId
    ? state.providerRuntime
    : null;
}

function formatProviderIssue(providerRuntime) {
  if (!providerRuntime) {
    return "provider fallback";
  }

  if (providerRuntime.issueCode === "quota") {
    return "ключ загружен, но API уперся в quota/billing. Проверь API billing в OpenAI.";
  }

  if (providerRuntime.issueCode === "schema") {
    return "structured output schema отклонена OpenAI.";
  }

  if (providerRuntime.issueCode === "auth") {
    return "ошибка авторизации OpenAI. Проверь API key.";
  }

  if (providerRuntime.issueCode === "rate_limit") {
    return "превышен rate limit OpenAI. Попробуй повторить позже.";
  }

  return providerRuntime.errorMessage || providerRuntime.issueLabel || "provider fallback";
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

  if (state.previewSource === "scaffold") {
    items.push({
      level: "ok",
      title: "Scaffold preview",
      body: "Preview построен из клонированного шаблона с токенами от AI."
    });
  } else if (state.previewSource === "draft") {
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

function extractFigmaLinkFromText(text) {
  return extractUrlsFromText(text).find((url) => /figma\.com/i.test(url)) || "";
}

function looksLikeImageUrl(url) {
  return /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(cleanText(url));
}

function normalizeFigmaNodeId(value) {
  return cleanText(value).replace(/-/g, ":");
}

function parseFigmaReferenceUrl(url) {
  const value = cleanText(url);
  if (!value || !/figma\.com/i.test(value)) {
    return null;
  }

  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const mode = segments[0] || "";
    const fileKey = ["file", "design", "proto", "board"].includes(mode) ? cleanText(segments[1]) : "";
    const nodeId = normalizeFigmaNodeId(parsed.searchParams.get("node-id"));
    const selectionName = cleanText(decodeURIComponent(segments[2] || "")).replace(/[-_]+/g, " ");

    return {
      url: value,
      mode,
      fileKey,
      nodeId,
      selectionName
    };
  } catch {
    return {
      url: value,
      mode: "figma",
      fileKey: "",
      nodeId: "",
      selectionName: ""
    };
  }
}

function updateDesignFigmaReference(url) {
  const parsed = parseFigmaReferenceUrl(url);
  if (!parsed) {
    state.design = {
      ...state.design,
      figmaFileKey: "",
      figmaNodeId: "",
      figmaSelectionName: state.design?.figmaImport?.selectionName || ""
    };
    return;
  }

  state.design = {
    ...state.design,
    figmaFileKey: parsed.fileKey,
    figmaNodeId: parsed.nodeId,
    figmaSelectionName: parsed.selectionName || state.design?.figmaImport?.selectionName || ""
  };
}

function setDesignReferenceUrl(url) {
  state.brief.designUrl = cleanText(url);
  updateDesignFigmaReference(state.brief.designUrl);
}

function collectFigmaPayloadStats(input) {
  const layerNames = [];
  const textSamples = [];
  const exportUrls = [];
  const visited = new Set();
  const stats = {
    layerCount: 0,
    textLayerCount: 0,
    imageFillCount: 0
  };

  const visit = (value) => {
    if (!value || typeof value !== "object") {
      if (typeof value === "string" && /^https?:\/\//i.test(value) && /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(value) && exportUrls.length < 6) {
        exportUrls.push(value);
      }
      return;
    }

    if (visited.has(value)) {
      return;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    const type = cleanText(value.type).toUpperCase();
    const name = cleanText(value.name);
    const characters = cleanText(value.characters || value.text || value.content);

    if (type || name || characters) {
      stats.layerCount += 1;
    }

    if (name && layerNames.length < 12) {
      layerNames.push(name);
    }

    if ((type === "TEXT" || characters) && textSamples.length < 10) {
      stats.textLayerCount += 1;
      if (characters) {
        textSamples.push(characters.replace(/\s+/g, " ").slice(0, 180));
      }
    } else if (type === "TEXT") {
      stats.textLayerCount += 1;
    }

    if (Array.isArray(value.fills)) {
      for (const fill of value.fills) {
        const fillType = cleanText(fill?.type).toUpperCase();
        if (fillType === "IMAGE" || cleanText(fill?.imageRef) || cleanText(fill?.imageHash)) {
          stats.imageFillCount += 1;
        }
      }
    }

    for (const nested of Object.values(value)) {
      visit(nested);
    }
  };

  visit(input);

  return {
    layerCount: stats.layerCount,
    textLayerCount: stats.textLayerCount,
    imageFillCount: stats.imageFillCount,
    layerNames: Array.from(new Set(layerNames)).slice(0, 12),
    textSamples: Array.from(new Set(textSamples)).slice(0, 10),
    exportUrls: Array.from(new Set(exportUrls)).slice(0, 6)
  };
}

function extractFigmaImportValue(payload, paths = []) {
  for (const path of paths) {
    let cursor = payload;
    let valid = true;
    for (const key of path) {
      if (!cursor || typeof cursor !== "object" || !(key in cursor)) {
        valid = false;
        break;
      }
      cursor = cursor[key];
    }
    if (valid) {
      const value = cleanText(cursor);
      if (value) {
        return value;
      }
    }
  }
  return "";
}

function summarizeFigmaImportPayload(rawText, fallbackUrl = "") {
  const payload = JSON.parse(cleanText(rawText));
  const reference = parseFigmaReferenceUrl(fallbackUrl);
  const stats = collectFigmaPayloadStats(payload);
  const fileKey = extractFigmaImportValue(payload, [["fileKey"], ["file_key"], ["meta", "fileKey"], ["file", "key"]]) || reference?.fileKey || "";
  const nodeId = normalizeFigmaNodeId(
    extractFigmaImportValue(payload, [["nodeId"], ["node_id"], ["meta", "nodeId"], ["selection", "nodeId"]]) || reference?.nodeId || ""
  );
  const selectionName = extractFigmaImportValue(payload, [["selectionName"], ["selection", "name"], ["meta", "selectionName"], ["name"]])
    || reference?.selectionName
    || stats.layerNames[0]
    || "";
  const pageName = extractFigmaImportValue(payload, [["pageName"], ["meta", "pageName"], ["selection", "pageName"]]);

  return {
    source: "figma-json",
    fileKey,
    nodeId,
    selectionName,
    pageName,
    layerCount: stats.layerCount,
    textLayerCount: stats.textLayerCount,
    imageFillCount: stats.imageFillCount,
    layerNames: stats.layerNames,
    textSamples: stats.textSamples,
    exportUrls: stats.exportUrls
  };
}

function describeFigmaImport(importData) {
  if (!importData) {
    return "Обычному пользователю structured import не нужен. Обычно хватает ссылки на frame или скрина/export. Этот блок нужен только для advanced/internal Figma flow.";
  }

  const bits = [
    importData.selectionName ? `Selection: ${importData.selectionName}` : "",
    importData.pageName ? `Page: ${importData.pageName}` : "",
    importData.fileKey ? `File: ${importData.fileKey}` : "",
    importData.nodeId ? `Node: ${importData.nodeId}` : "",
    Number(importData.layerCount) > 0 ? `Layers: ${importData.layerCount}` : "",
    Number(importData.textLayerCount) > 0 ? `Text layers: ${importData.textLayerCount}` : "",
    Number(importData.imageFillCount) > 0 ? `Image fills: ${importData.imageFillCount}` : ""
  ].filter(Boolean);

  return bits.join(" | ") || "Structured Figma payload imported.";
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
  const message = String(state.mode || "").includes("discuss")
    ? "Сейчас был только диалог. Чтобы письмо появилось здесь, дай команду вроде «собери письмо по скрину» или «начинай верстать»."
    : "Сначала приложи материалы в чат, затем общайся с ассистентом или применяй изменения к письму.";
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
      ${message}
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

async function applyTranslationFiles(files, sourceLabel = "", options = {}) {
  const supported = filterTranslationFiles(files);
  if (supported.length === 0) {
    state.translationUploadStatus = "Не найдено поддерживаемых translation files.";
    renderTranslationUploadStatus();
    persistState();
    return;
  }

  state.translationText = await combineTranslationFiles(supported);
  state.chatAttachMenuOpen = false;
  if (!options.skipStatus) {
    state.translationUploadStatus = sourceLabel
      ? `Загружено ${supported.length} translation file(s) из ${sourceLabel}.`
      : `Загружено ${supported.length} translation file(s).`;
  }
  refs.fields.translationText.value = state.translationText;
  syncDraftTranslationsFromCurrentText();
  if (!options.skipStatus) {
    renderTranslationUploadStatus();
  }
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

async function applyAssetFiles(files, sourceLabel = "", options = {}) {
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
  state.chatAttachMenuOpen = false;
  if (!options.skipStatus) {
    state.translationUploadStatus = sourceLabel
      ? `Добавлено ${rows.length} image asset(s) из ${sourceLabel}.`
      : `Добавлено ${rows.length} image asset(s).`;
  }
  renderAssetComposer();
  renderAssetLibrary();
  if (!options.skipStatus) {
    renderTranslationUploadStatus();
  }
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
