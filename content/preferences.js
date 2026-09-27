var IMAZoteroSyncPrefs = {
  PREF: "extensions.imaZoteroSync.",
  initialized: false,

  init() {
    if (this.initialized) return;
    this.clientIdInput = document.getElementById("ima-client-id");
    this.apiKeyInput = document.getElementById("ima-api-key");
    this.kbSelect = document.getElementById("ima-kb-select");
    this.folderSelect = document.getElementById("ima-folder-select");
    this.folderPath = document.getElementById("ima-folder-path");
    this.status = document.getElementById("ima-settings-status");
    if (!this.clientIdInput || !this.apiKeyInput || !this.kbSelect || !this.status) return;

    this.clientIdInput.value = this.prefGet("clientId");
    this.apiKeyInput.value = this.prefGet("apiKey");

    // 文件夹浏览状态：browseKb 为当前正在浏览的知识库，
    // folderStack 为从根目录进入子文件夹的路径栈（空 = 在根目录）。
    this.browseKbId = "";
    this.browseKbName = "";
    this.folderStack = [];

    this.bindButton("ima-open-dashboard", () => this.openDashboard());
    this.bindButton("ima-save-credentials", () => this.saveCredentials());
    this.bindButton("ima-test-credentials", () => this.testCredentials());
    this.bindButton("ima-load-writable-kbs", () => this.loadWritableKnowledgeBases());
    this.bindButton("ima-load-visible-kbs", () => this.loadVisibleKnowledgeBases());
    this.bindButton("ima-save-default-kb", () => this.saveDefaultKnowledgeBase());
    this.bindButton("ima-load-folders", () => this.browseFolders(true));
    this.bindButton("ima-folder-up", () => this.folderUp());
    this.bindButton("ima-folder-open", () => this.openSelectedFolder());
    this.bindButton("ima-folder-set-default", () => this.saveDefaultFolder());
    this.bindButton("ima-folder-set-root", () => this.saveRootAsDefault());
    this.bindButton("ima-dry-run-selected", () => this.runPluginCommand("dryRunSelectedFromActiveWindow", { forcePrompt: true, dryRun: true }));
    this.bindButton("ima-sync-selected-default", () => this.runPluginCommand("syncSelectedFromActiveWindow", {}));
    this.bindButton("ima-sync-selected-chosen", () => this.runPluginCommand("syncSelectedFromActiveWindow", { forcePrompt: true }));

    if (this.folderSelect) {
      this.folderSelect.addEventListener("dblclick", () => this.openSelectedFolder());
    }

    this.updateFolderPathLabel();
    this.initialized = true;

    if (!this.bridge()) {
      this.setStatus("插件命令桥不可用，请重启 Zotero 后再试。");
      return;
    }

    const defaultName = this.prefGet("targetKbName");
    const defaultFolder = this.prefGet("targetFolderName");
    if (defaultName) {
      this.setStatus(`默认同步目标：${defaultName}${defaultFolder && defaultFolder !== "（根目录）" ? ` / ${defaultFolder}` : "（根目录）"}`);
    } else {
      this.setStatus("尚未选择默认 IMA 知识库。");
    }
  },

  // 所有 IMA 请求统一经主插件脚本暴露的命令桥发出，本页不再自己发请求。
  bridge() {
    try {
      return Zotero && Zotero.IMAZoteroSync ? Zotero.IMAZoteroSync : null;
    } catch (err) {
      return null;
    }
  },

  requireBridge() {
    const bridge = this.bridge();
    if (!bridge) {
      this.setStatus("插件命令桥不可用，请重启 Zotero 后再试。");
      return null;
    }
    return bridge;
  },

  bindButton(id, handler) {
    const button = document.getElementById(id);
    if (!button) return;
    let running = false;
    let lastRun = 0;
    const wrapped = async (event) => {
      const now = Date.now();
      if (running || now - lastRun < 600) {
        event && event.preventDefault && event.preventDefault();
        return;
      }
      running = true;
      lastRun = now;
      button.disabled = true;
      try {
        await handler(event);
      } finally {
        running = false;
        button.disabled = false;
      }
    };
    button.addEventListener("command", wrapped);
    button.addEventListener("click", wrapped);
  },

  prefGet(name, fallback = "") {
    try {
      const value = Zotero.Prefs.get(this.PREF + name, true);
      return value === undefined || value === null ? fallback : value;
    } catch (err) {
      return fallback;
    }
  },

  prefSet(name, value) {
    Zotero.Prefs.set(this.PREF + name, value, true);
  },

  setStatus(text) {
    if (this.status) this.status.textContent = text;
  },

  openDashboard() {
    const bridge = this.requireBridge();
    if (!bridge) return;
    try {
      if (typeof bridge.openDashboard === "function") {
        bridge.openDashboard();
        this.setStatus("已打开 IMA 同步控制台。");
      } else {
        this.setStatus("控制台不可用，请重启 Zotero 后再试。");
      }
    } catch (err) {
      this.setStatus(`打开控制台失败：${err.message || err}`);
    }
  },

  saveCredentials() {
    this.prefSet("clientId", this.clientIdInput.value.trim());
    this.prefSet("apiKey", this.apiKeyInput.value.trim());
    this.setStatus("IMA 凭据已保存到 Zotero 设置。");
  },

  async testCredentials() {
    const bridge = this.requireBridge();
    if (!bridge) return;
    try {
      this.saveCredentials();
      const res = await bridge.testConnection();
      this.setStatus(`IMA 连接正常，可写入知识库：${res.count} 个。`);
    } catch (err) {
      this.setStatus(`连接失败：${err.message || err}`);
    }
  },

  renderKnowledgeBases(items, mode) {
    this.kbSelect.textContent = "";
    for (const kb of items) {
      if (!kb.id) continue;
      const option = document.createElement("option");
      option.value = kb.id;
      option.dataset.name = kb.name;
      option.dataset.type = kb.type || "";
      const details = [kb.type, kb.contentCount ? `${kb.contentCount} 个条目` : ""].filter(Boolean).join("，");
      option.textContent = details ? `${kb.name} [${details}]` : kb.name;
      this.kbSelect.appendChild(option);
    }
    this.setStatus(`${mode}：已加载 ${this.kbSelect.options.length} 个知识库。`);
  },

  async loadWritableKnowledgeBases() {
    const bridge = this.requireBridge();
    if (!bridge) return;
    try {
      this.saveCredentials();
      const items = await bridge.listKnowledgeBases();
      this.renderKnowledgeBases(items, "可写入");
      if (!items.length) {
        this.setStatus("可写入：已加载 0 个知识库。若该账号没有可写入目标，IMA 不会返回任何条目。");
      }
    } catch (err) {
      this.setStatus(`加载可写入知识库失败：${err.message || err}`);
    }
  },

  async loadVisibleKnowledgeBases() {
    const bridge = this.requireBridge();
    if (!bridge) return;
    try {
      this.saveCredentials();
      const items = await bridge.listVisibleKnowledgeBases();
      this.renderKnowledgeBases(items, "可见/共享");
      if (!items.length) {
        this.setStatus("可见/共享：已加载 0 个知识库。");
      }
    } catch (err) {
      this.setStatus(`加载可见/共享知识库失败：${err.message || err}`);
    }
  },

  saveDefaultKnowledgeBase() {
    const option = this.kbSelect.selectedOptions && this.kbSelect.selectedOptions[0];
    if (!option) {
      this.setStatus("请先选择一个知识库。");
      return;
    }
    const name = option.dataset.name || option.textContent;
    this.prefSet("targetKbId", option.value);
    this.prefSet("targetKbName", name);
    // 切换默认知识库时把文件夹重置为根目录，避免默认文件夹仍指向旧知识库。
    this.prefSet("targetFolderId", "");
    this.prefSet("targetFolderName", "（根目录）");
    this.setStatus(`默认同步目标已保存：${name}（根目录）。如需指定文件夹，请在下方浏览并「设为默认文件夹」。`);
  },

  selectedKnowledgeBase() {
    const option = this.kbSelect.selectedOptions && this.kbSelect.selectedOptions[0];
    if (option) return { id: option.value, name: option.dataset.name || option.textContent };
    const savedId = this.prefGet("targetKbId");
    const savedName = this.prefGet("targetKbName");
    if (savedId) return { id: savedId, name: savedName || "默认知识库" };
    return null;
  },

  // 根目录的 folder_id 等于 knowledge_base_id；空栈表示在根目录。
  currentBrowseFolderId() {
    return this.folderStack.length ? this.folderStack[this.folderStack.length - 1].folderId : this.browseKbId;
  },

  currentBrowsePathName() {
    if (!this.folderStack.length) return "根目录";
    return ["根目录", ...this.folderStack.map((f) => f.name)].join(" / ");
  },

  updateFolderPathLabel() {
    if (!this.folderPath) return;
    if (!this.browseKbId) {
      this.folderPath.setAttribute("value", "当前位置：根目录");
      return;
    }
    this.folderPath.setAttribute("value", `当前位置：${this.browseKbName} / ${this.currentBrowsePathName()}`);
  },

  renderFolders(folders) {
    if (!this.folderSelect) return;
    this.folderSelect.textContent = "";
    for (const folder of folders) {
      const option = document.createElement("option");
      option.value = folder.folderId;
      option.dataset.name = folder.name;
      option.textContent = folder.name;
      this.folderSelect.appendChild(option);
    }
  },

  // 解析不到子文件夹时，展示主脚本带回的原始响应概要，便于排查 IMA 返回结构变化。
  folderDiagnosticText(diag) {
    const d = diag || { responseKeys: "无", rawItemCount: 0, sampleKeys: "无", items: [] };
    const listing = (d.items || [])
      .map((it, i) => {
        const kind = Number(it.media_type) === 99 || Number(it.mediaType) === 99 ? "📁文件夹" : "📄文件";
        const title = it.title || it.name || it.file_name || "(无标题)";
        return `  ${i + 1}. [${kind} mt=${it.media_type !== undefined ? it.media_type : "?"}] ${title}`;
      })
      .join("\n");
    return (
      `该层级没有解析到子文件夹（${this.browseKbName} / ${this.currentBrowsePathName()}）。\n` +
      `调试：返回字段=[${d.responseKeys}]，原始条目数=${d.rawItemCount}，首条字段=[${d.sampleKeys}]。\n` +
      (listing ? `本层条目（前 ${(d.items || []).length} 条）：\n${listing}\n` : "") +
      `若上面全是 📄文件、没有 📁文件夹，说明该知识库这一层确实没有子文件夹。`
    );
  },

  async browseFolders(reset) {
    const bridge = this.requireBridge();
    if (!bridge) return;
    try {
      this.saveCredentials();
      if (reset) {
        const kb = this.selectedKnowledgeBase();
        if (!kb) {
          this.setStatus("请先在上方选中（或已设默认）一个知识库，再浏览文件夹。");
          return;
        }
        this.browseKbId = kb.id;
        this.browseKbName = kb.name;
        this.folderStack = [];
      }
      if (!this.browseKbId) {
        this.setStatus("请先「浏览所选知识库的文件夹」。");
        return;
      }
      const result = await bridge.listFoldersWithDiagnostics(this.browseKbId, this.currentBrowseFolderId());
      this.renderFolders(result.folders);
      this.updateFolderPathLabel();
      if (result.folders.length) {
        this.setStatus(`已加载 ${result.folders.length} 个文件夹（${this.browseKbName} / ${this.currentBrowsePathName()}）。`);
      } else {
        this.setStatus(this.folderDiagnosticText(result.diag));
      }
    } catch (err) {
      this.setStatus(`加载文件夹失败：${err.message || err}`);
    }
  },

  async openSelectedFolder() {
    const option = this.folderSelect && this.folderSelect.selectedOptions && this.folderSelect.selectedOptions[0];
    if (!option) {
      this.setStatus("请先在列表中选择一个文件夹，再点「打开所选文件夹」。");
      return;
    }
    this.folderStack.push({ folderId: option.value, name: option.dataset.name || option.textContent });
    await this.browseFolders(false);
  },

  async folderUp() {
    if (!this.browseKbId) {
      this.setStatus("请先「浏览所选知识库的文件夹」。");
      return;
    }
    if (!this.folderStack.length) {
      this.setStatus("已经在根目录。");
      return;
    }
    this.folderStack.pop();
    await this.browseFolders(false);
  },

  saveDefaultFolder() {
    if (!this.browseKbId) {
      this.setStatus("请先「浏览所选知识库的文件夹」，再设为默认文件夹。");
      return;
    }
    const option = this.folderSelect && this.folderSelect.selectedOptions && this.folderSelect.selectedOptions[0];
    let folderId;
    let pathName;
    if (option) {
      // 列表里选中的子文件夹：默认目标 = 该子文件夹。
      folderId = option.value;
      pathName = `${this.currentBrowsePathName()} / ${option.dataset.name || option.textContent}`.replace(/^根目录 \/ /, "");
    } else {
      // 未选中：默认目标 = 当前所在层级。
      folderId = this.currentBrowseFolderId();
      pathName = this.currentBrowsePathName();
    }
    const isRoot = !folderId || folderId === this.browseKbId;
    this.prefSet("targetKbId", this.browseKbId);
    this.prefSet("targetKbName", this.browseKbName);
    this.prefSet("targetFolderId", isRoot ? "" : folderId);
    this.prefSet("targetFolderName", isRoot ? "（根目录）" : pathName);
    this.setStatus(`默认同步目标已保存：${this.browseKbName} / ${isRoot ? "（根目录）" : pathName}`);
  },

  saveRootAsDefault() {
    const kb = this.browseKbId ? { id: this.browseKbId, name: this.browseKbName } : this.selectedKnowledgeBase();
    if (kb) {
      this.prefSet("targetKbId", kb.id);
      this.prefSet("targetKbName", kb.name);
    }
    this.prefSet("targetFolderId", "");
    this.prefSet("targetFolderName", "（根目录）");
    this.setStatus(`默认同步目标已设为根目录${kb ? `：${kb.name}` : ""}。`);
  },

  async runPluginCommand(method, options) {
    const bridge = this.requireBridge();
    if (!bridge) return;
    try {
      if (typeof bridge[method] !== "function") {
        throw new Error(`命令不可用：${method}。请重启 Zotero 后再试。`);
      }
      this.saveCredentials();
      this.setStatus("正在执行 Zotero 同步命令...");
      await bridge[method](options || {});
      this.setStatus("Zotero 同步命令已完成。");
    } catch (err) {
      this.setStatus(`Zotero 同步命令失败：${err.message || err}`);
    }
  },
};

if (document.readyState === "complete" || document.readyState === "interactive") {
  IMAZoteroSyncPrefs.init();
} else {
  window.addEventListener("load", () => IMAZoteroSyncPrefs.init(), { once: true });
}
