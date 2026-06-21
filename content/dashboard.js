var IMAZoteroSyncDashboard = {
  PREF: "extensions.imaZoteroSync.",
  win: null,
  doc: null,
  Zotero: null,
  bridge: null,
  busy: false,
  browseKbId: "",
  browseKbName: "",
  folderStack: [],

  init(win) {
    this.win = win;
    this.doc = win.document;
    const mainWindow =
      (win.arguments && win.arguments[0]) ||
      (typeof Services !== "undefined" && Services.wm.getMostRecentWindow("navigator:browser"));
    this.Zotero = mainWindow && mainWindow.Zotero ? mainWindow.Zotero : null;
    this.bridge = this.Zotero && this.Zotero.IMAZoteroSync ? this.Zotero.IMAZoteroSync : null;

    // 标签页
    this.bind("tab-dashboard", () => this.switchTab("dashboard"));
    this.bind("tab-settings", () => this.switchTab("settings"));
    this.bind("btn-refresh", () => this.refresh());

    // 仪表盘操作
    this.bind("act-sync", () => this.runCommand("syncSelectedFromActiveWindow", {}, "正在同步所选文献…"));
    this.bind("act-dryrun", () => this.runCommand("dryRunSelectedFromActiveWindow", { forcePrompt: true, dryRun: true }, "正在预演…"));
    this.bind("act-syncall", () => this.runCommand("syncAllPendingFromActiveWindow", undefined, "正在同步全部待同步…"));
    this.bind("act-target", () => this.switchTab("settings"));
    this.bind("act-cred", () => this.switchTab("settings"));
    this.bind("act-diag", () => this.runCommand("runDiagnostics", undefined, "正在运行诊断…"));

    // 设置：凭据
    this.bind("set-save-cred", () => this.saveCredentials());
    this.bind("set-test-cred", () => this.testConnection());
    // 设置：知识库
    this.bind("set-load-kbs", () => this.loadKnowledgeBases());
    // 设置：文件夹
    this.bind("set-browse-folders", () => this.browseFolders(true));
    this.bind("set-folder-up", () => this.folderUp());
    this.bind("set-folder-open", () => this.openSelectedFolder());
    this.bind("set-folder-default", () => this.saveDefaultFolder());
    this.bind("set-folder-root", () => this.saveRootAsDefault());
    const folderSelect = this.doc.getElementById("set-folder-select");
    if (folderSelect) folderSelect.addEventListener("dblclick", () => this.openSelectedFolder());

    this.loadSettingsInputs();

    if (!this.bridge) {
      this.setBanner("error", "无法连接到 IMA Zotero 同步插件。请重启 Zotero 后重新打开控制台。");
      return;
    }
    this.refresh();
  },

  // ---------- 工具 ----------
  bind(id, handler) {
    const el = this.doc.getElementById(id);
    if (el) el.addEventListener("click", handler);
  },

  prefGet(name, fallback = "") {
    try {
      const v = this.Zotero.Prefs.get(this.PREF + name, true);
      return v === undefined || v === null ? fallback : v;
    } catch (err) {
      return fallback;
    }
  },

  prefSet(name, value) {
    this.Zotero.Prefs.set(this.PREF + name, value, true);
  },

  setStatus(text) {
    const el = this.doc.getElementById("dash-status");
    if (el) el.textContent = text || "";
  },

  setBanner(kind, text) {
    const el = this.doc.getElementById("banner");
    if (!el) return;
    el.className = `banner ${kind}`;
    el.textContent = text;
  },

  setValue(id, value) {
    const el = this.doc.getElementById(id);
    if (el) el.textContent = value;
  },

  switchTab(name) {
    const isDash = name === "dashboard";
    this.doc.getElementById("view-dashboard").style.display = isDash ? "" : "none";
    this.doc.getElementById("view-settings").style.display = isDash ? "none" : "";
    this.doc.getElementById("tab-dashboard").className = `tab${isDash ? " active" : ""}`;
    this.doc.getElementById("tab-settings").className = `tab${isDash ? "" : " active"}`;
    if (isDash) this.refresh();
  },

  // ---------- 仪表盘 ----------
  async refresh() {
    if (!this.bridge || !this.bridge.getDashboardData) {
      this.setBanner("error", "命令桥不可用。请重启 Zotero。");
      return;
    }
    this.setStatus("正在刷新…");
    try {
      const data = await this.bridge.getDashboardData();
      this.render(data);
      this.setStatus(`已更新 · ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      this.setBanner("error", `加载数据失败：${(err && err.message) || err}`);
      this.setStatus("");
    }
  },

  render(data) {
    const stats = data.stats || {};
    this.setValue("stat-total", this.num(stats.totalSynced));
    this.setValue("stat-today", this.num(stats.today));
    this.setValue("stat-pending", this.num(stats.pending));
    this.setValue("stat-rate", `${this.num(stats.successRate)}%`);
    this.setValue("stat-avg", stats.avgDurationSec ? `${stats.avgDurationSec}s` : "—");
    this.setValue("stat-failed", this.num(stats.failed));

    const target = data.target || {};
    const targetText = `知识库：${target.kbName || "(未设置)"} · 文件夹：${target.folderName || "（根目录）"}`;
    if (data.credentialsOk) {
      this.setBanner("ok", `✅ 凭据正常 · ${targetText}`);
    } else {
      this.setBanner("error", `⚠ 未配置或无效的 IMA 凭据 · ${targetText} · 请到「设置」填写`);
    }
    this.renderActivities(data.activities || []);
  },

  renderActivities(activities) {
    const container = this.doc.getElementById("activity");
    if (!container) return;
    container.textContent = "";
    if (!activities.length) {
      const empty = this.doc.createElement("div");
      empty.className = "activity-empty";
      empty.textContent = "暂无同步记录。开始同步后，这里会显示最近的活动。";
      container.appendChild(empty);
      return;
    }
    for (const item of activities) container.appendChild(this.activityRow(item));
  },

  activityRow(item) {
    const row = this.doc.createElement("div");
    row.className = "activity-row";

    const icon = this.doc.createElement("div");
    icon.className = `activity-icon status-${item.status}`;
    icon.textContent = item.status === "synced" ? "✅" : item.status === "failed" ? "❌" : "⏭";
    row.appendChild(icon);

    const main = this.doc.createElement("div");
    main.className = "activity-main";
    const title = this.doc.createElement("div");
    title.className = "activity-title";
    title.textContent = item.title || "(无标题)";
    main.appendChild(title);
    const sub = this.doc.createElement("div");
    sub.className = "activity-sub";
    const parts = [this.statusText(item.status)];
    if (item.reason) parts.push(this.reasonText(item.reason));
    if (item.kbName) parts.push(`→ ${item.kbName}${item.folderName && item.folderName !== "（根目录）" ? ` / ${item.folderName}` : ""}`);
    sub.textContent = parts.join(" · ");
    main.appendChild(sub);
    row.appendChild(main);

    const meta = this.doc.createElement("div");
    meta.className = "activity-meta";
    const dur = item.durationMs ? ` · ${Math.round(item.durationMs / 1000)}s` : "";
    meta.textContent = `${this.relativeTime(item.ts)}${dur}`;
    row.appendChild(meta);

    return row;
  },

  async runCommand(method, options, statusText) {
    if (this.busy) return;
    if (!this.bridge || typeof this.bridge[method] !== "function") {
      this.setStatus(`命令不可用：${method}。请重启 Zotero。`);
      return;
    }
    this.busy = true;
    this.setStatus(statusText || "正在执行…");
    try {
      await this.bridge[method](options);
      await this.refresh();
    } catch (err) {
      this.setStatus(`执行失败：${(err && err.message) || err}`);
    } finally {
      this.busy = false;
    }
  },

  // ---------- 设置：凭据 ----------
  loadSettingsInputs() {
    const cid = this.doc.getElementById("set-client-id");
    const key = this.doc.getElementById("set-api-key");
    if (cid) cid.value = this.prefGet("clientId");
    if (key) key.value = this.prefGet("apiKey");
  },

  persistCredsFromInputs() {
    const cid = this.doc.getElementById("set-client-id");
    const key = this.doc.getElementById("set-api-key");
    if (cid) this.prefSet("clientId", (cid.value || "").trim());
    if (key) this.prefSet("apiKey", (key.value || "").trim());
  },

  saveCredentials() {
    this.persistCredsFromInputs();
    this.setStatus("IMA 凭据已保存。");
  },

  async testConnection() {
    this.persistCredsFromInputs();
    this.setStatus("正在测试连接…");
    try {
      const res = await this.bridge.testConnection();
      this.setStatus(`连接正常，可写入知识库：${res.count} 个。`);
    } catch (err) {
      this.setStatus(`连接失败：${(err && err.message) || err}`);
    }
  },

  // ---------- 设置：知识库 ----------
  selectedKnowledgeBase() {
    const select = this.doc.getElementById("set-kb-select");
    const option = select && select.selectedOptions && select.selectedOptions[0];
    if (option) return { id: option.value, name: option.dataset.name || option.textContent };
    const savedId = this.prefGet("targetKbId");
    if (savedId) return { id: savedId, name: this.prefGet("targetKbName") || "默认知识库" };
    return null;
  },

  async loadKnowledgeBases() {
    this.persistCredsFromInputs();
    this.setStatus("正在加载知识库…");
    try {
      const bases = await this.bridge.listKnowledgeBases();
      const select = this.doc.getElementById("set-kb-select");
      select.textContent = "";
      for (const kb of bases) {
        if (!kb.id) continue;
        const option = this.doc.createElement("option");
        option.value = kb.id;
        option.dataset.name = kb.name;
        option.textContent = kb.type ? `${kb.name} [${kb.type}]` : kb.name;
        select.appendChild(option);
      }
      this.setStatus(`已加载 ${select.options.length} 个可写入知识库。选中后即可「浏览文件夹」或直接「设为默认文件夹」。`);
    } catch (err) {
      this.setStatus(`加载知识库失败：${(err && err.message) || err}`);
    }
  },

  // ---------- 设置：文件夹 ----------
  currentBrowseFolderId() {
    return this.folderStack.length ? this.folderStack[this.folderStack.length - 1].folderId : this.browseKbId;
  },

  currentBrowsePathName() {
    if (!this.folderStack.length) return "根目录";
    return ["根目录", ...this.folderStack.map((f) => f.name)].join(" / ");
  },

  updateFolderPathLabel() {
    const el = this.doc.getElementById("set-folder-path");
    if (!el) return;
    el.textContent = this.browseKbId
      ? `当前位置：${this.browseKbName} / ${this.currentBrowsePathName()}`
      : "当前位置：根目录";
  },

  renderFolders(folders) {
    const select = this.doc.getElementById("set-folder-select");
    if (!select) return;
    select.textContent = "";
    for (const folder of folders) {
      const option = this.doc.createElement("option");
      option.value = folder.folderId;
      option.dataset.name = folder.name;
      option.textContent = folder.name;
      select.appendChild(option);
    }
  },

  async browseFolders(reset) {
    this.persistCredsFromInputs();
    try {
      if (reset) {
        const kb = this.selectedKnowledgeBase();
        if (!kb) {
          this.setStatus("请先在「默认知识库」里加载并选中一个知识库。");
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
      const folders = await this.bridge.listFolders(this.browseKbId, this.currentBrowseFolderId());
      this.renderFolders(folders);
      this.updateFolderPathLabel();
      this.setStatus(
        folders.length
          ? `已加载 ${folders.length} 个文件夹（${this.browseKbName} / ${this.currentBrowsePathName()}）。`
          : `该层级没有子文件夹（${this.browseKbName} / ${this.currentBrowsePathName()}）。`,
      );
    } catch (err) {
      this.setStatus(`加载文件夹失败：${(err && err.message) || err}`);
    }
  },

  async openSelectedFolder() {
    const select = this.doc.getElementById("set-folder-select");
    const option = select && select.selectedOptions && select.selectedOptions[0];
    if (!option) {
      this.setStatus("请先在列表中选择一个文件夹。");
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
      this.setStatus("请先「浏览所选知识库的文件夹」再设为默认。");
      return;
    }
    const select = this.doc.getElementById("set-folder-select");
    const option = select && select.selectedOptions && select.selectedOptions[0];
    let folderId;
    let pathName;
    if (option) {
      folderId = option.value;
      pathName = `${this.currentBrowsePathName()} / ${option.dataset.name || option.textContent}`.replace(/^根目录 \/ /, "");
    } else {
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

  // ---------- 格式化 ----------
  num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : "0";
  },

  statusText(status) {
    return { synced: "已同步", failed: "失败", skipped: "已跳过" }[status] || status;
  },

  reasonText(reason) {
    return (
      {
        unchanged: "未变化",
        exists: "远端已存在",
        "sync already running": "同步进行中",
        "no supported local attachments": "无可上传附件",
        "not a regular item": "非普通条目",
      }[reason] || reason
    );
  },

  relativeTime(ts) {
    if (!ts) return "";
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return "刚刚";
    if (min < 60) return `${min} 分钟前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} 小时前`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} 天前`;
    return new Date(ts).toLocaleDateString();
  },
};
