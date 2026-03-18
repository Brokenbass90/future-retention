function buildPluginPayloadExample() {
  return {
    source: "figma-plugin",
    fileKey: "FILE_KEY",
    nodeId: "19963:29238",
    selectionName: "Password reset",
    pageName: "Ready for dev",
    frameSize: {
      width: 600,
      height: 1480
    },
    localeHints: ["latin-script"],
    directionHint: "ltr",
    styles: {
      bgColor: "#F3F3F3",
      textColor: "#2F2F35",
      headingColor: "#2A2730",
      linkColor: "#8AAE00",
      primaryColor: "#B8F500",
      primaryTextColor: "#111111",
      buttonRadius: "12px",
      contentRadius: "8px",
      borderColor: "#D8D8D8",
      fontFamily: "Inter"
    },
    previewImage: {
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,..."
    },
    componentNames: ["Header", "Primary Button", "Footer"],
    sections: [
      {
        id: "sec_01",
        role: "header",
        name: "Header",
        x: 0,
        y: 0,
        width: 600,
        height: 120,
        children: ["img_01"],
        componentName: "Header",
        columnCount: 1,
        archetype: "logo-row",
        style: {
          bgColor: "#F3F3F3",
          layoutMode: "horizontal",
          textAlign: "center"
        }
      },
      {
        id: "sec_02",
        role: "text",
        name: "Main card",
        x: 40,
        y: 120,
        width: 520,
        height: 860,
        children: ["txt_01", "txt_02", "txt_03", "img_02"],
        componentName: "Main card",
        columnCount: 1,
        archetype: "copy-card",
        style: {
          bgColor: "#FFFFFF",
          borderColor: "#D8D8D8",
          radius: "8px",
          borderWidth: "1px",
          paddingTop: 32,
          paddingRight: 32,
          paddingBottom: 32,
          paddingLeft: 32
        }
      },
      {
        id: "sec_03",
        role: "cta",
        name: "CTA band",
        x: 40,
        y: 760,
        width: 520,
        height: 180,
        children: ["txt_04", "txt_05"],
        componentName: "Primary Button",
        columnCount: 1,
        archetype: "cta-card",
        style: {
          bgColor: "#FFFFFF",
          radius: "8px"
        }
      }
    ],
    texts: [
      {
        id: "txt_01",
        roleHint: "heading",
        text: "Set your new password",
        x: 52,
        y: 188,
        width: 420,
        height: 72,
        fontFamily: "Inter",
        fontSize: 48,
        fontWeight: 700,
        align: "left",
        lineHeight: "56px",
        letterSpacing: "0px",
        direction: "ltr",
        color: "#2A2730",
        sectionId: "sec_02"
      },
      {
        id: "txt_02",
        roleHint: "body",
        text: "We've created an account for you on {{affiliate_embedded_admin_domain_url}}.",
        x: 52,
        y: 300,
        width: 420,
        height: 96,
        fontFamily: "Inter",
        fontSize: 20,
        fontWeight: 400,
        align: "left",
        lineHeight: "30px",
        direction: "ltr",
        color: "#2F2F35",
        sectionId: "sec_02"
      },
      {
        id: "txt_03",
        roleHint: "legal",
        text: "If you didn't request to create or reset your password, you can ignore this email.",
        x: 52,
        y: 420,
        width: 420,
        height: 86,
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        align: "left",
        lineHeight: "24px",
        direction: "ltr",
        color: "#2F2F35",
        sectionId: "sec_02"
      },
      {
        id: "txt_04",
        roleHint: "body",
        text: "Please click the button below to set your new password:",
        x: 52,
        y: 790,
        width: 420,
        height: 60,
        fontFamily: "Inter",
        fontSize: 18,
        fontWeight: 400,
        align: "left",
        lineHeight: "28px",
        direction: "ltr",
        color: "#2F2F35",
        sectionId: "sec_03"
      },
      {
        id: "txt_05",
        roleHint: "cta",
        text: "Set new password",
        x: 52,
        y: 860,
        width: 240,
        height: 24,
        fontFamily: "Inter",
        fontSize: 18,
        fontWeight: 700,
        align: "center",
        lineHeight: "24px",
        direction: "ltr",
        color: "#111111",
        sectionId: "sec_03"
      }
    ],
    images: [
      {
        id: "img_01",
        roleHint: "logo",
        name: "Brand logo",
        x: 230,
        y: 42,
        width: 140,
        height: 36,
        sectionId: "sec_01",
        alt: "Affstore logo",
        componentName: "Header",
        exportRef: "node-export:img_01",
        imageHash: "abcd1234",
        assetSource: {
          kind: "figma-export",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,..."
        }
      },
      {
        id: "img_02",
        roleHint: "background",
        name: "Card glow background",
        x: 40,
        y: 120,
        width: 520,
        height: 860,
        sectionId: "sec_02",
        isBackground: true,
        exportRef: "node-export:img_02",
        assetSource: {
          kind: "figma-export",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,..."
        }
      }
    ]
  };
}

function buildInternalSchemaExample() {
  return {
    source: "figma-plugin",
    meta: {
      brandHint: "Affstore",
      categoryHint: "X_AffSystem",
      fileKey: "FILE_KEY",
      frameId: "19963:29238",
      frameName: "Password reset",
      pageName: "Ready for dev",
      width: 600,
      height: 1480
    },
    tokens: {
      bgColor: "#F3F3F3",
      textColor: "#2F2F35",
      headingColor: "#2A2730",
      linkColor: "#8AAE00",
      primaryColor: "#B8F500",
      primaryTextColor: "#111111",
      buttonRadius: "12px",
      contentRadius: "8px",
      borderColor: "#D8D8D8",
      fontFamily: "Inter"
    },
    sections: [
      { id: "sec_01", role: "header", name: "Header" },
      { id: "sec_02", role: "cta", name: "Main card" },
      { id: "sec_03", role: "footer", name: "Footer" }
    ],
    textNodes: [
      { id: "txt_01", roleHint: "heading", text: "Set your new password", sectionId: "sec_02" }
    ],
    imageSlots: [
      {
        id: "img_01",
        roleHint: "logo",
        name: "Brand logo",
        sectionId: "sec_01",
        assetSource: {
          kind: "figma-export",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,..."
        }
      }
    ],
    componentNames: ["Header", "Primary Button", "Footer"],
    localeHints: ["latin-script"],
    directionHint: "ltr",
    previewImage: {
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,..."
    }
  };
}

export function getFigmaIntegrationContract() {
  return {
    version: 1,
    endpoint: "/api/figma/import",
    auth: {
      header: "X-Figma-Import-Secret",
      optionalWhenServerSecretIsEmpty: true
    },
    preferredFlows: [
      "figma-plugin-push",
      "server-token-link-import",
      "screenshot-fallback"
    ],
    requiredMinimumFields: [
      "source",
      "fileKey or designUrl",
      "nodeId or frame reference",
      "selectionName",
      "previewImage or screenshot/dataUrl"
    ],
    recommendedStructuredFields: [
      "sections[].style",
      "sections[].columnCount",
      "texts[].lineHeight",
      "texts[].direction",
      "images[].roleHint",
      "images[].assetSource",
      "images[].exportRef",
      "localeHints",
      "directionHint"
    ],
    notes: [
      "Plugin push is the preferred private-Figma workflow.",
      "Users should not prepare JSON manually.",
      "PNG/JPG is fallback-only and loses layer fidelity.",
      "The goal is to send frame structure, text nodes, exported image nodes, section styles, and design tokens.",
      "For reliable layout mapping, send section card/background styles and column counts when available.",
      "For RTL languages, the plugin may send directionHint and localeHints to avoid guesswork on sparse copy."
    ],
    pluginPayloadExample: buildPluginPayloadExample(),
    internalDesignSchemaExample: buildInternalSchemaExample()
  };
}
