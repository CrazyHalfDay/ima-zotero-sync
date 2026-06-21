var IMAZoteroSyncPrefs = {
  PREF: "extensions.imaZoteroSync.",
  BASE_URL: "https://ima.qq.com",
  SKILL_VERSION: "zotero-plugin-prefs-0.2.14",
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

    const defaultName = this.prefGet("targetKbName");
    const defaultFolder = this.prefGet("targetFolderName");
    this.updateFolderPathLabel();
    this.initialized = true;
    if (defaultName) {
      this.setStatus(`默认同步目标：${defaultName}${defaultFolder && defaultFolder !== "（根目录）" ? ` / ${defaultFolder}` : "（根目录）"}`);
    } else {
      this.setStatus("尚未选择默认 IMA 知识库。");
    }
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
    this.status.textContent = text;
  },

  openDashboard() {
    try {
      if (Zotero.IMAZoteroSync && typeof Zotero.IMAZoteroSync.openDashboard === "function") {
        Zotero.IMAZoteroSync.openDashboard();
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

  credentials() {
    const clientId = this.clientIdInput.value.trim() || this.prefGet("clientId");
    const apiKey = this.apiKeyInput.value.trim() || this.prefGet("apiKey");
    if (!clientId || !apiKey) {
      throw new Error("需要填写 IMA Client ID 和 API Key。");
    }
    return { clientId, apiKey };
  },

  async imaPost(apiPath, body) {
    const { clientId, apiKey } = this.credentials();
    const response = await fetch(`${this.BASE_URL}/${apiPath}`, {
      method: "POST",
      headers: {
        "ima-openapi-clientid": clientId,
        "ima-openapi-apikey": apiKey,
        "ima-openapi-ctx": `skill_version=${this.SKILL_VERSION}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body || {}),
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text || "{}");
    } catch (err) {
      throw new Error(`IMA returned non-JSON response from ${apiPath}`);
    }
    if (json.code !== 0) {
      throw new Error(json.msg || `IMA API failed: ${apiPath}`);
    }
    return json.data || {};
  },

  async testCredentials() {
    try {
      this.saveCredentials();
      const data = await this.imaPost("openapi/wiki/v1/get_addable_knowledge_base_list", { cursor: "", limit: 1 });
      const count = this.extractKnowledgeBases(data).length;
      this.setStatus(`IMA 连接正常。返回可写入知识库：${count} 个。响应字段：${Object.keys(data).join(", ") || "无"}。`);
    } catch (err) {
      this.setStatus(`连接失败：${err.message || err}`);
    }
  },

  normalizeKnowledgeBase(kb, source) {
    return {
      id: kb.kb_id || kb.id || kb.knowledge_base_id || kb.knowledgeBaseId || kb.base_id || kb.baseId || "",
      name: kb.kb_name || kb.name || kb.title || kb.knowledge_base_name || kb.knowledgeBaseName || kb.base_name || kb.baseName || "未命名知识库",
      type: kb.base_type || kb.type || kb.knowledge_base_type || kb.knowledgeBaseType || source,
      contentCount: kb.content_count || kb.contentCount || kb.doc_count || kb.docCount || kb.knowledge_count || kb.knowledgeCount || "",
      source,
    };
  },

  extractKnowledgeBases(data) {
    if (Array.isArray(data)) return data;
    const candidates = [
      data.info_list,
      data.addable_knowledge_base_list,
      data.addableKnowledgeBaseList,
      data.knowledge_base_list,
      data.knowledgeBaseList,
      data.knowledge_bases,
      data.knowledgeBases,
      data.base_list,
      data.baseList,
      data.list,
      data.items,
      data.records,
      data.results,
      data.data && data.data.info_list,
      data.data && data.data.list,
      data.data && data.data.knowledge_base_list,
    ];
    return candidates.find((value) => Array.isArray(value)) || [];
  },

  renderKnowledgeBases(items, mode) {
    this.kbSelect.textContent = "";
    for (const kb of items) {
      if (!kb.id) continue;
      const option = document.createElement("option");
      option.value = kb.id;
      option.dataset.name = kb.name;
      option.dataset.type = kb.type || "";
      option.dataset.source = kb.source || mode;
      const details = [kb.type, kb.contentCount ? `${kb.contentCount} 个条目` : ""].filter(Boolean).join("，");
      option.textContent = details ? `${kb.name} [${details}]` : kb.name;
      this.kbSelect.appendChild(option);
    }
    this.setStatus(`${mode}：已加载 ${this.kbSelect.options.length} 个知识库。`);
  },

  async loadWritableKnowledgeBases() {
    try {
      this.saveCredentials();
      const data = await this.imaPost("openapi/wiki/v1/get_addable_knowledge_base_list", { cursor: "", limit: 20 });
      const rawItems = this.extractKnowledgeBases(data);
      const items = rawItems.map((kb) => this.normalizeKnowledgeBase(kb, "可写入"));
      this.renderKnowledgeBases(items, "可写入");
      if (!items.length) {
        this.setStatus(`可写入：已加载 0 个知识库。响应字段：${Object.keys(data).join(", ") || "无"}。如果 addable_knowledge_base_list 为空，说明 IMA 没有返回此账号可写入的目标。`);
      }
    } catch (err) {
      this.setStatus(`加载可写入知识库失败：${err.message || err}`);
    }
  },

  async loadVisibleKnowledgeBases() {
    try {
      this.saveCredentials();
      const data = await this.imaPost("openapi/wiki/v1/search_knowledge_base", { query: "", cursor: "", limit: 20 });
      const rawItems = this.extractKnowledgeBases(data);
      const items = rawItems.map((kb) => this.normalizeKnowledgeBase(kb, "可见/共享"));
      this.renderKnowledgeBases(items, "可见/共享");
      if (!items.length) {
        this.setStatus(`可见/共享：已加载 0 个知识库。响应字段：${Object.keys(data).join(", ") || "无"}。`);
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

  // IMA 把文件夹编码为 media_type=99 的条目，其 media_id 即作为 folder_id 使用；
  // 兼容另一种可能：有独立 folder_id 且无 media_id。
  isFolderItem(it) {
    if (Number(it.media_type) === 99 || Number(it.mediaType) === 99) return true;
    const fid = it.folder_id || it.folderId;
    if (fid && !(it.media_id || it.mediaId)) return true;
    return false;
  },

  folderIdOf(it) {
    return String(it.folder_id || it.folderId || it.media_id || it.mediaId || "");
  },

  extractFolders(data) {
    const lists = [
      data.folder_list,
      data.folderList,
      data.folders,
      data.knowledge_list,
      data.list,
      data.items,
      data.data && data.data.folder_list,
      data.data && data.data.knowledge_list,
    ];
    const seen = new Set();
    const out = [];
    for (const lst of lists) {
      if (!Array.isArray(lst)) continue;
      for (const it of lst) {
        if (!this.isFolderItem(it)) continue;
        const folderId = this.folderIdOf(it);
        if (!folderId || seen.has(folderId)) continue;
        const name = it.title || it.name || it.folder_name || it.folderName || "未命名文件夹";
        seen.add(folderId);
        out.push({ folderId, name: String(name) });
      }
    }
    return out;
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

  firstArray(data, keys) {
    for (const key of keys) {
      if (Array.isArray(data[key])) return data[key];
    }
    if (data.data) {
      for (const key of keys) {
        if (Array.isArray(data.data[key])) return data.data[key];
      }
    }
    return [];
  },

  async fetchFolders(kbId, folderId) {
    const folders = [];
    let cursor = "";
    this._lastDiag = { keys: "无", rawCount: 0, sampleKeys: "无" };
    for (let page = 0; page < 20; page++) {
      const body = { cursor, limit: 50, knowledge_base_id: kbId };
      if (folderId && folderId !== kbId) body.folder_id = folderId;
      const data = await this.imaPost("openapi/wiki/v1/get_knowledge_list", body);
      try {
        Zotero.debug(`IMA Zotero Sync: get_knowledge_list raw = ${JSON.stringify(data)}`);
      } catch (err) {}
      this._lastDiag.keys = Object.keys(data).join(", ") || "无";
      const rawList = this.firstArray(data, ["knowledge_list", "folder_list", "list", "items", "info_list", "records", "results"]);
      if (rawList.length) {
        this._lastDiag.rawCount += rawList.length;
        if (this._lastDiag.sampleKeys === "无") this._lastDiag.sampleKeys = Object.keys(rawList[0] || {}).join(", ") || "无";
        if (!this._lastDiag.items) this._lastDiag.items = rawList.slice(0, 12);
      }
      for (const folder of this.extractFolders(data)) folders.push(folder);
      if (data.is_end || !data.next_cursor) break;
      cursor = data.next_cursor;
    }
    return folders;
  },

  async browseFolders(reset) {
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
      const folders = await this.fetchFolders(this.browseKbId, this.currentBrowseFolderId());
      this.renderFolders(folders);
      this.updateFolderPathLabel();
      if (folders.length) {
        this.setStatus(`已加载 ${folders.length} 个文件夹（${this.browseKbName} / ${this.currentBrowsePathName()}）。`);
      } else {
        const diag = this._lastDiag || { keys: "无", rawCount: 0, sampleKeys: "无", items: [] };
        const listing = (diag.items || [])
          .map((it, i) => {
            const kind = this.isFolderItem(it) ? "📁文件夹" : "📄文件";
            const title = it.title || it.name || it.file_name || "(无标题)";
            return `  ${i + 1}. [${kind} mt=${it.media_type !== undefined ? it.media_type : "?"}] ${title}`;
          })
          .join("\n");
        this.setStatus(
          `该层级没有解析到子文件夹（${this.browseKbName} / ${this.currentBrowsePathName()}）。\n` +
            `调试：返回字段=[${diag.keys}]，原始条目数=${diag.rawCount}，首条字段=[${diag.sampleKeys}]。\n` +
            (listing ? `本层条目（前 12 条）：\n${listing}\n` : "") +
            `若上面全是 📄文件、没有 📁文件夹，说明该知识库根目录确实没有子文件夹。`,
        );
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
    try {
      if (!Zotero.IMAZoteroSync || typeof Zotero.IMAZoteroSync[method] !== "function") {
        throw new Error("IMA Zotero 同步命令桥不可用。请重启 Zotero 后再试。");
      }
      this.saveCredentials();
      this.setStatus("正在执行 Zotero 同步命令...");
      await Zotero.IMAZoteroSync[method](options || {});
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
