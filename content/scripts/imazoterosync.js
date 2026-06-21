var IMAZoteroSync;

(function () {
  const PLUGIN_ID = "ima-zotero-sync@github.com.zhaox";
  const PREF = "extensions.imaZoteroSync.";
  const IMA_BASE_URL = "https://ima.qq.com";
  const IMA_SKILL_VERSION = "zotero-plugin-0.2.18";
  const SYNC_MARKER_BEGIN = "IMA-Zotero-Sync:";
  const SYNC_TAG = "IMA已上传";
  const SUPPORTED_FILES = {
    pdf: { mediaType: 1, contentType: "application/pdf", maxBytes: 200 * 1024 * 1024 },
    doc: { mediaType: 3, contentType: "application/msword", maxBytes: 200 * 1024 * 1024 },
    docx: {
      mediaType: 3,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      maxBytes: 200 * 1024 * 1024,
    },
    ppt: { mediaType: 4, contentType: "application/vnd.ms-powerpoint", maxBytes: 200 * 1024 * 1024 },
    pptx: {
      mediaType: 4,
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      maxBytes: 200 * 1024 * 1024,
    },
    xls: { mediaType: 5, contentType: "application/vnd.ms-excel", maxBytes: 10 * 1024 * 1024 },
    xlsx: {
      mediaType: 5,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      maxBytes: 10 * 1024 * 1024,
    },
    csv: { mediaType: 5, contentType: "text/csv", maxBytes: 10 * 1024 * 1024 },
    txt: { mediaType: 13, contentType: "text/plain", maxBytes: 10 * 1024 * 1024 },
    md: { mediaType: 7, contentType: "text/markdown", maxBytes: 10 * 1024 * 1024 },
    png: { mediaType: 9, contentType: "image/png", maxBytes: 30 * 1024 * 1024 },
    jpg: { mediaType: 9, contentType: "image/jpeg", maxBytes: 30 * 1024 * 1024 },
    jpeg: { mediaType: 9, contentType: "image/jpeg", maxBytes: 30 * 1024 * 1024 },
    mp3: { mediaType: 15, contentType: "audio/mpeg", maxBytes: 200 * 1024 * 1024 },
    wav: { mediaType: 15, contentType: "audio/wav", maxBytes: 200 * 1024 * 1024 },
  };

  let registeredMenus = [];
  let preferencePaneRegistered = false;
  let legacyMenusEnabled = true;
  let currentWindow = null;
  let addonRootURI = "";
  const activeSyncKeys = new Set();

  function prefGet(name, fallback = "") {
    try {
      const value = Zotero.Prefs.get(PREF + name, true);
      return value === undefined || value === null ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function prefSet(name, value) {
    Zotero.Prefs.set(PREF + name, value, true);
  }

  function alertUser(title, text) {
    const win = currentWindow || Services.wm.getMostRecentWindow("navigator:browser");
    Services.prompt.alert(win, title, text);
  }

  function promptUser(title, text, initial = "") {
    const win = currentWindow || Services.wm.getMostRecentWindow("navigator:browser");
    const input = { value: initial };
    const ok = Services.prompt.prompt(win, title, text, input, null, {});
    return ok ? input.value.trim() : "";
  }

  async function readText(path) {
    if (!path) return "";
    try {
      if (typeof IOUtils !== "undefined" && IOUtils.readUTF8) {
        return (await IOUtils.readUTF8(path)).trim();
      }
    } catch (err) {}
    try {
      return (await Zotero.File.getContentsAsync(path)).trim();
    } catch (err) {
      return "";
    }
  }

  function homePath(...parts) {
    const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
    if (typeof PathUtils !== "undefined" && PathUtils.join) {
      return PathUtils.join(home, ...parts);
    }
    return [home, ...parts].join(Services.appinfo.OS === "WINNT" ? "\\" : "/");
  }

  async function loadCredentials() {
    const clientId =
      prefGet("clientId") ||
      (await readText(homePath(".config", "ima", "client_id")));
    const apiKey =
      prefGet("apiKey") ||
      (await readText(homePath(".config", "ima", "api_key")));
    if (!clientId || !apiKey) {
      throw new Error("缺少 IMA 凭据。请在「工具 -> IMA Zotero 同步 -> 配置 IMA 凭据」中设置。");
    }
    return { clientId, apiKey };
  }

  async function imaPost(apiPath, body) {
    const { clientId, apiKey } = await loadCredentials();
    const response = await fetch(`${IMA_BASE_URL}/${apiPath}`, {
      method: "POST",
      headers: {
        "ima-openapi-clientid": clientId,
        "ima-openapi-apikey": apiKey,
        "ima-openapi-ctx": `skill_version=${IMA_SKILL_VERSION}`,
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
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  async function sha256Hex(input) {
    const bytes = utf8Bytes(input);
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return bytesToHex(new Uint8Array(digest));
    }
    // Duplicate protection does not require a cryptographic hash when WebCrypto
    // is unavailable. SHA-1 keeps the fallback deterministic across sessions.
    return sha1HexBytes(bytes);
  }

  function utf8Bytes(value) {
    return new TextEncoder().encode(String(value));
  }

  function bytesToHex(bytes) {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function concatBytes(...arrays) {
    const total = arrays.reduce((sum, array) => sum + array.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const array of arrays) {
      out.set(array, offset);
      offset += array.length;
    }
    return out;
  }

  function sha1Bytes(input) {
    const bytes = input instanceof Uint8Array ? input : utf8Bytes(input);
    const bitLen = bytes.length * 8;
    const withOne = bytes.length + 1;
    const paddedLen = Math.ceil((withOne + 8) / 64) * 64;
    const padded = new Uint8Array(paddedLen);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
    view.setUint32(paddedLen - 4, bitLen >>> 0, false);

    let h0 = 0x67452301;
    let h1 = 0xefcdab89;
    let h2 = 0x98badcfe;
    let h3 = 0x10325476;
    let h4 = 0xc3d2e1f0;
    const words = new Uint32Array(80);
    const rotl = (value, bits) => ((value << bits) | (value >>> (32 - bits))) >>> 0;

    for (let offset = 0; offset < paddedLen; offset += 64) {
      for (let i = 0; i < 16; i++) {
        words[i] = view.getUint32(offset + i * 4, false);
      }
      for (let i = 16; i < 80; i++) {
        words[i] = rotl(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1);
      }

      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;

      for (let i = 0; i < 80; i++) {
        let f;
        let k;
        if (i < 20) {
          f = (b & c) | (~b & d);
          k = 0x5a827999;
        } else if (i < 40) {
          f = b ^ c ^ d;
          k = 0x6ed9eba1;
        } else if (i < 60) {
          f = (b & c) | (b & d) | (c & d);
          k = 0x8f1bbcdc;
        } else {
          f = b ^ c ^ d;
          k = 0xca62c1d6;
        }
        const temp = (rotl(a, 5) + f + e + k + words[i]) >>> 0;
        e = d;
        d = c;
        c = rotl(b, 30);
        b = a;
        a = temp;
      }

      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
    }

    const out = new Uint8Array(20);
    const outView = new DataView(out.buffer);
    [h0, h1, h2, h3, h4].forEach((value, index) => outView.setUint32(index * 4, value, false));
    return out;
  }

  function sha1HexBytes(input) {
    return bytesToHex(sha1Bytes(input));
  }

  async function sha1Hex(input) {
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const digest = await crypto.subtle.digest("SHA-1", utf8Bytes(input));
      return bytesToHex(new Uint8Array(digest));
    }
    return sha1HexBytes(input);
  }

  async function hmacSha1Hex(key, message) {
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        utf8Bytes(key),
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"],
      );
      const signature = await crypto.subtle.sign("HMAC", cryptoKey, utf8Bytes(message));
      return bytesToHex(new Uint8Array(signature));
    }

    let keyBytes = utf8Bytes(key);
    if (keyBytes.length > 64) keyBytes = sha1Bytes(keyBytes);
    const innerPad = new Uint8Array(64);
    const outerPad = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      const byte = keyBytes[i] || 0;
      innerPad[i] = byte ^ 0x36;
      outerPad[i] = byte ^ 0x5c;
    }
    return bytesToHex(sha1Bytes(concatBytes(outerPad, sha1Bytes(concatBytes(innerPad, utf8Bytes(message))))));
  }

  async function buildCosAuthorization({ secretId, secretKey, method, pathname, headers, startTime, expiredTime }) {
    const keyTime = `${startTime};${expiredTime}`;
    const signKey = await hmacSha1Hex(secretKey, keyTime);
    const headerKeys = Object.keys(headers).sort();
    const httpHeaders = headerKeys.map((key) => `${key.toLowerCase()}=${encodeURIComponent(headers[key])}`).join("&");
    const httpString = `${method.toLowerCase()}\n${pathname}\n\n${httpHeaders}\n`;
    const stringToSign = `sha1\n${keyTime}\n${await sha1Hex(httpString)}\n`;
    const signature = await hmacSha1Hex(signKey, stringToSign);
    const headerList = headerKeys.map((key) => key.toLowerCase()).join(";");
    return [
      "q-sign-algorithm=sha1",
      `q-ak=${secretId}`,
      `q-sign-time=${keyTime}`,
      `q-key-time=${keyTime}`,
      `q-header-list=${headerList}`,
      "q-url-param-list=",
      `q-signature=${signature}`,
    ].join("&");
  }

  async function fileInfo(path) {
    const stat = await IOUtils.stat(path);
    const fileName = PathUtils.filename(path);
    const ext = (fileName.split(".").pop() || "").toLowerCase();
    const type = SUPPORTED_FILES[ext];
    if (!type) throw new Error(`不支持的附件类型：${fileName}`);
    if (stat.size > type.maxBytes) throw new Error(`Attachment is too large for IMA: ${fileName}`);
    return { path, fileName, ext, size: stat.size, lastModified: Math.floor(stat.lastModified / 1000), ...type };
  }

  async function readBytes(path) {
    if (typeof IOUtils !== "undefined" && IOUtils.read) {
      return await IOUtils.read(path);
    }
    throw new Error("当前 Zotero 版本未暴露 IOUtils.read，无法上传附件。");
  }

  async function uploadToCos(file, credential) {
    const bytes = await readBytes(file.path);
    const hostname = `${credential.bucket_name}.cos.${credential.region}.myqcloud.com`;
    const pathname = `/${credential.cos_key}`;
    const headersToSign = {
      "content-length": String(bytes.byteLength),
      host: hostname,
    };
    const authorization = await buildCosAuthorization({
      secretId: credential.secret_id,
      secretKey: credential.secret_key,
      method: "PUT",
      pathname,
      headers: headersToSign,
      startTime: String(credential.start_time || Math.floor(Date.now() / 1000)),
      expiredTime: String(credential.expired_time || Math.floor(Date.now() / 1000) + 3600),
    });
    const response = await fetch(`https://${hostname}${pathname}`, {
      method: "PUT",
      headers: {
        "Content-Type": file.contentType,
        Authorization: authorization,
        "x-cos-security-token": credential.token,
      },
      body: bytes,
    });
    if (!response.ok) {
      throw new Error(`COS upload failed for ${file.fileName}: HTTP ${response.status}`);
    }
  }

  function itemCreators(item) {
    try {
      return item.getCreators().map((creator) => ({
        firstName: creator.firstName || "",
        lastName: creator.lastName || "",
        creatorType: creator.creatorType || "",
      }));
    } catch (err) {
      return [];
    }
  }

  function itemTags(item) {
    try {
      return item.getTags().map((tag) => tag.tag).filter((tag) => tag && tag !== SYNC_TAG).sort();
    } catch (err) {
      return [];
    }
  }

  async function getZoteroItem(id) {
    if (Zotero.Items.getAsync) {
      return await Zotero.Items.getAsync(id);
    }
    return Zotero.Items.get(id);
  }

  async function attachmentSummaries(item) {
    const ids = item.getAttachments ? item.getAttachments() : [];
    const out = [];
    for (const id of ids) {
      const attachment = await getZoteroItem(id);
      const path = attachment && attachment.getFilePathAsync ? await attachment.getFilePathAsync() : "";
      if (!path) continue;
      try {
        const stat = await IOUtils.stat(path);
        out.push({ name: PathUtils.filename(path), size: stat.size, modified: stat.lastModified });
      } catch (err) {}
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function itemPayload(item) {
    const payload = {
      itemKey: item.key,
      libraryID: item.libraryID,
      itemType: item.itemType,
      title: item.getField("title") || "",
      creators: itemCreators(item),
      date: item.getField("date") || "",
      publicationTitle: item.getField("publicationTitle") || "",
      DOI: item.getField("DOI") || "",
      url: item.getField("url") || "",
      abstractNote: item.getField("abstractNote") || "",
      tags: itemTags(item),
      attachments: await attachmentSummaries(item),
    };
    payload.syncHash = await sha256Hex(stableStringify(payload));
    return payload;
  }

  function parseSyncRecords(extra) {
    const records = [];
    for (const line of String(extra || "").split(/\r?\n/)) {
      if (!line.startsWith(SYNC_MARKER_BEGIN)) continue;
      try {
        records.push(JSON.parse(line.slice(SYNC_MARKER_BEGIN.length).trim()));
      } catch (err) {}
    }
    return records;
  }

  function findSyncRecord(item, kbId) {
    return parseSyncRecords(item.getField("extra") || "").find((record) => record.kbId === kbId);
  }

  async function writeSyncRecord(item, record) {
    const extra = item.getField("extra") || "";
    const lines = extra.split(/\r?\n/).filter((line) => {
      if (!line.startsWith(SYNC_MARKER_BEGIN)) return true;
      try {
        return JSON.parse(line.slice(SYNC_MARKER_BEGIN.length).trim()).kbId !== record.kbId;
      } catch (err) {
        return false;
      }
    });
    lines.push(`${SYNC_MARKER_BEGIN} ${JSON.stringify(record)}`);
    item.setField("extra", lines.filter(Boolean).join("\n"));
    await item.saveTx();
  }

  async function addSyncTag(item) {
    const tags = item.getTags ? item.getTags().map((tag) => tag.tag).filter(Boolean) : [];
    if (tags.includes(SYNC_TAG)) return;
    item.addTag(SYNC_TAG);
    await item.saveTx();
  }

  // ---- 活动日志与统计（供控制台仪表盘使用） ----
  const ACTIVITY_LIMIT = 60;

  function readJsonPref(name, fallback) {
    try {
      const raw = prefGet(name, "");
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (err) {
      return fallback;
    }
  }

  function writeJsonPref(name, value) {
    try {
      prefSet(name, JSON.stringify(value));
    } catch (err) {}
  }

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function statNumber(name) {
    const value = Number(prefGet(name, 0));
    return Number.isFinite(value) ? value : 0;
  }

  function appendActivity(entry) {
    const log = readJsonPref("activityLog", []);
    log.unshift(entry);
    if (log.length > ACTIVITY_LIMIT) log.length = ACTIVITY_LIMIT;
    writeJsonPref("activityLog", log);
  }

  // 记录单条同步结果：更新终身计数器 + 今日计数 + 活动日志。
  function recordOutcome(result) {
    if (result.status === "synced") {
      prefSet("statSynced", statNumber("statSynced") + 1);
      if (prefGet("statTodayDate", "") !== todayKey()) {
        prefSet("statTodayDate", todayKey());
        prefSet("statTodayCount", 0);
      }
      prefSet("statTodayCount", statNumber("statTodayCount") + 1);
      if (typeof result.durationMs === "number" && result.durationMs > 0) {
        prefSet("statDurationSumMs", statNumber("statDurationSumMs") + result.durationMs);
        prefSet("statDurationCount", statNumber("statDurationCount") + 1);
      }
    } else if (result.status === "failed") {
      prefSet("statFailed", statNumber("statFailed") + 1);
    }
    appendActivity({
      ts: Date.now(),
      title: result.title || "(无标题)",
      status: result.status,
      reason: result.reason || "",
      durationMs: typeof result.durationMs === "number" ? result.durationMs : 0,
      kbName: result.kbName || "",
      folderName: result.folderName || "",
    });
  }

  async function checkCredentials() {
    try {
      await loadCredentials();
      return true;
    } catch (err) {
      return false;
    }
  }

  async function findPendingItems() {
    try {
      const libraryID = Zotero.Libraries.userLibraryID;
      const search = new Zotero.Search();
      search.libraryID = libraryID;
      search.addCondition("itemType", "isNot", "attachment");
      search.addCondition("itemType", "isNot", "note");
      const ids = await search.search();
      const itemList = await Zotero.Items.getAsync(ids);
      const pending = [];
      let totalSynced = 0;
      for (const item of itemList) {
        if (!item.isRegularItem || !item.isRegularItem()) continue;
        if (item.hasTag && item.hasTag(SYNC_TAG)) {
          totalSynced++;
          continue;
        }
        const attachments = item.getAttachments ? item.getAttachments() : [];
        if (attachments.length) pending.push(item);
      }
      return { pending, totalSynced };
    } catch (err) {
      Zotero.debug(`IMA Zotero Sync: scan pending failed: ${err.stack || err.message}`);
      return { pending: [], totalSynced: 0 };
    }
  }

  async function getDashboardData() {
    const synced = statNumber("statSynced");
    const failed = statNumber("statFailed");
    const attempts = synced + failed;
    const durCount = statNumber("statDurationCount");
    const today = prefGet("statTodayDate", "") === todayKey() ? statNumber("statTodayCount") : 0;
    let totalSynced = 0;
    let pending = 0;
    try {
      const scan = await findPendingItems();
      totalSynced = scan.totalSynced;
      pending = scan.pending.length;
    } catch (err) {}
    return {
      credentialsOk: await checkCredentials(),
      target: {
        kbName: prefGet("targetKbName", "") || "(未设置)",
        folderName: prefGet("targetFolderName", "") || "（根目录）",
      },
      stats: {
        totalSynced,
        today,
        pending,
        failed,
        successRate: attempts ? Math.round((synced / attempts) * 100) : 100,
        avgDurationSec: durCount ? Math.round(statNumber("statDurationSumMs") / durCount / 1000) : 0,
      },
      activities: readJsonPref("activityLog", []).slice(0, 30),
    };
  }

  async function syncAllPendingFromActiveWindow() {
    const win = getActiveMainWindow();
    const scan = await findPendingItems();
    if (!scan.pending.length) {
      alertUser("IMA Zotero 同步", "没有待同步的条目（所有带附件的文献都已同步）。");
      return;
    }
    const proceed = Services.prompt.confirm(
      win,
      "IMA Zotero 同步",
      `将把 ${scan.pending.length} 个待同步条目同步到默认目标，是否继续？`,
    );
    if (!proceed) return;
    await syncItems(scan.pending, win, {});
  }

  function openDashboard() {
    const win = getActiveMainWindow();
    if (!win || !win.openDialog) return;
    const existing = Services.wm.getMostRecentWindow("ima-zotero-sync:dashboard");
    if (existing) {
      existing.focus();
      return;
    }
    win.openDialog(
      "chrome://imazoterosync/content/dashboard.xhtml",
      "ima-zotero-sync-dashboard",
      "chrome,centerscreen,resizable,dialog=no,width=1040,height=780",
      win,
    );
  }

  function remoteItemName(remote) {
    return String(
      remote.title ||
        remote.name ||
        remote.file_name ||
        remote.fileName ||
        remote.media_name ||
        remote.mediaName ||
        "",
    );
  }

  function remoteParentFolderId(remote) {
    return String(remote.parent_folder_id || remote.parentFolderId || remote.folder_id || remote.folderId || "");
  }

  function remoteMediaId(remote) {
    return String(remote.media_id || remote.mediaId || remote.id || remote.content_id || "");
  }

  function extractKnowledgeItems(data) {
    if (Array.isArray(data)) return data;
    const candidates = [
      data.info_list,
      data.knowledge_list,
      data.knowledgeList,
      data.items,
      data.list,
      data.records,
      data.results,
      data.data && data.data.info_list,
      data.data && data.data.knowledge_list,
      data.data && data.data.list,
      data.data && data.data.items,
      data.data && data.data.results,
    ];
    return candidates.find((value) => Array.isArray(value)) || [];
  }

  function extractRepeatedResults(data) {
    if (Array.isArray(data)) return data;
    const candidates = [
      data.results,
      data.result_list,
      data.resultList,
      data.repeated_names,
      data.repeatedNames,
      data.items,
      data.list,
      data.data && data.data.results,
      data.data && data.data.result_list,
      data.data && data.data.list,
    ];
    const array = candidates.find((value) => Array.isArray(value));
    if (array) return array;
    if (data.results && typeof data.results === "object") {
      return Object.entries(data.results).map(([name, value]) => ({ name, ...(typeof value === "object" ? value : { is_repeated: !!value }) }));
    }
    return [];
  }

  function isRepeatedResult(result, fileName) {
    const name = result.name || result.file_name || result.fileName || result.title || "";
    if (name && name !== fileName) return false;
    return !!(result.is_repeated || result.isRepeated || result.repeated || result.exists || result.exist);
  }

  // 根目录的 folder_id 等于 knowledge_base_id；未指定文件夹时按根目录处理。
  // 返回应写入请求体的 folder_id（根目录返回空字符串表示省略该字段）。
  function normalizeFolderId(kbId, folderId) {
    if (!folderId || folderId === kbId) return "";
    return String(folderId);
  }

  async function findRemoteFileByName(fileName, kbId, folderId) {
    const data = await imaPost("openapi/wiki/v1/search_knowledge", {
      query: fileName,
      knowledge_base_id: kbId,
      cursor: "",
    });
    // search_knowledge 是知识库级（不支持 folder_id），因此用返回里的
    // parent_folder_id 做文件夹过滤：只有同名且在目标文件夹内才算已存在。
    const targetFolder = normalizeFolderId(kbId, folderId) || kbId;
    const matched = extractKnowledgeItems(data).find((item) => {
      if (remoteItemName(item) !== fileName) return false;
      const parent = remoteParentFolderId(item);
      // 部分返回根目录文件的 parent 可能为空，空值时视为根目录匹配。
      const effectiveParent = parent || kbId;
      return effectiveParent === targetFolder;
    });
    if (!matched) return null;
    return {
      fileName,
      mediaId: remoteMediaId(matched),
    };
  }

  async function uploadFileToKnowledgeBase(file, kbId, folderId) {
    const folder = normalizeFolderId(kbId, folderId);
    const remoteExisting = await findRemoteFileByName(file.fileName, kbId, folderId);
    if (remoteExisting) {
      return { skipped: true, reason: "exists", fileName: file.fileName, mediaId: remoteExisting.mediaId || "" };
    }

    const repeatedBody = {
      params: [{ name: file.fileName, media_type: file.mediaType }],
      knowledge_base_id: kbId,
    };
    if (folder) repeatedBody.folder_id = folder;
    const repeated = await imaPost("openapi/wiki/v1/check_repeated_names", repeatedBody);
    const repeatedResult = extractRepeatedResults(repeated).find((result) => isRepeatedResult(result, file.fileName));
    if (repeatedResult) {
      return { skipped: true, reason: "exists", fileName: file.fileName };
    }

    const created = await imaPost("openapi/wiki/v1/create_media", {
      file_name: file.fileName,
      file_size: file.size,
      content_type: file.contentType,
      knowledge_base_id: kbId,
      file_ext: file.ext,
    });
    const credential = created.cos_credential || created.credential || {};
    await uploadToCos(file, credential);
    const addBody = {
      media_type: file.mediaType,
      media_id: created.media_id,
      title: file.fileName,
      knowledge_base_id: kbId,
      file_info: {
        cos_key: credential.cos_key,
        file_size: file.size,
        last_modify_time: file.lastModified,
        file_name: file.fileName,
      },
    };
    if (folder) addBody.folder_id = folder;
    const added = await imaPost("openapi/wiki/v1/add_knowledge", addBody);
    return { skipped: false, mediaId: added.media_id || created.media_id, fileName: file.fileName };
  }

  async function getAttachmentFiles(item) {
    const files = [];
    const ids = item.getAttachments ? item.getAttachments() : [];
    for (const id of ids) {
      const attachment = await getZoteroItem(id);
      if (!attachment || !attachment.getFilePathAsync) continue;
      const path = await attachment.getFilePathAsync();
      if (!path) continue;
      try {
        files.push(await fileInfo(path));
      } catch (err) {
        Zotero.debug(`IMA Zotero Sync: skipping attachment: ${err.message}`);
      }
    }
    return files;
  }

  async function syncOneItem(item, kb) {
    if (!item || !item.isRegularItem || !item.isRegularItem()) {
      return { status: "skipped", title: item ? item.getField("title") : "", reason: "not a regular item" };
    }
    const payload = await itemPayload(item);
    const syncKey = `${kb.id}:${payload.libraryID}:${payload.itemKey}:${payload.syncHash}`;
    if (activeSyncKeys.has(syncKey)) {
      return { status: "skipped", title: payload.title || item.key, reason: "sync already running" };
    }
    activeSyncKeys.add(syncKey);
    try {
      const existing = findSyncRecord(item, kb.id);
      if (existing && existing.syncHash === payload.syncHash) {
        await addSyncTag(item);
        return { status: "skipped", title: payload.title || item.key, reason: "unchanged" };
      }

      const files = await getAttachmentFiles(item);
      if (!files.length) {
        return { status: "skipped", title: payload.title || item.key, reason: "no supported local attachments" };
      }

      const uploaded = [];
      for (const file of files) {
        uploaded.push(await uploadFileToKnowledgeBase(file, kb.id, kb.folderId));
      }

      await writeSyncRecord(item, {
        kbId: kb.id,
        kbName: kb.name,
        folderId: kb.folderId || "",
        folderName: kb.folderName || "",
        syncHash: payload.syncHash,
        syncedAt: new Date().toISOString(),
        uploadedFiles: uploaded.map((u) => ({ fileName: u.fileName, mediaId: u.mediaId || "", skipped: !!u.skipped })),
      });
      await addSyncTag(item);

      return { status: "synced", title: payload.title || item.key, uploaded };
    } finally {
      activeSyncKeys.delete(syncKey);
    }
  }

  async function listAddableKnowledgeBases() {
    const data = await imaPost("openapi/wiki/v1/get_addable_knowledge_base_list", { cursor: "", limit: 20 });
    const list = extractKnowledgeBases(data);
    return list.map((kb) => ({
      id: kb.kb_id || kb.id || kb.knowledge_base_id || kb.knowledgeBaseId || kb.base_id || kb.baseId,
      name: kb.kb_name || kb.name || kb.title || kb.knowledge_base_name || kb.knowledgeBaseName || kb.base_name || kb.baseName || "未命名知识库",
      type: kb.base_type || kb.type || kb.knowledge_base_type || kb.knowledgeBaseType || "",
    })).filter((kb) => kb.id);
  }

  function extractKnowledgeBases(data) {
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
  }

  function formatKnowledgeBaseChoices(bases) {
    return bases.map((kb, index) => `${index + 1}. ${kb.name}${kb.type ? ` [${kb.type}]` : ""}`).join("\n");
  }

  // IMA 把文件夹编码为 media_type=99 的条目，其 media_id 即作为 folder_id 使用；
  // 兼容另一种可能：有独立 folder_id 且无 media_id。
  function isFolderItem(it) {
    if (Number(it.media_type) === 99 || Number(it.mediaType) === 99) return true;
    const fid = it.folder_id || it.folderId;
    if (fid && !(it.media_id || it.mediaId)) return true;
    return false;
  }

  function folderIdOf(it) {
    return String(it.folder_id || it.folderId || it.media_id || it.mediaId || "");
  }

  function extractFolders(data) {
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
        if (!isFolderItem(it)) continue;
        const folderId = folderIdOf(it);
        if (!folderId || seen.has(folderId)) continue;
        const name = it.title || it.name || it.folder_name || it.folderName || "未命名文件夹";
        seen.add(folderId);
        out.push({ folderId, name: String(name) });
      }
    }
    return out;
  }

  async function listFolders(kbId, folderId) {
    const folders = [];
    let cursor = "";
    for (let page = 0; page < 20; page++) {
      const body = { cursor, limit: 50, knowledge_base_id: kbId };
      const normalized = normalizeFolderId(kbId, folderId);
      if (normalized) body.folder_id = normalized;
      const data = await imaPost("openapi/wiki/v1/get_knowledge_list", body);
      for (const folder of extractFolders(data)) folders.push(folder);
      if (data.is_end || !data.next_cursor) break;
      cursor = data.next_cursor;
    }
    return folders;
  }

  // 让用户从知识库的顶层文件夹中选一个目标文件夹（0 = 根目录）。
  // 返回 { folderId, folderName }；folderId 为空表示根目录。
  async function chooseFolder(kb) {
    let folders = [];
    try {
      folders = await listFolders(kb.id, kb.id);
    } catch (err) {
      Zotero.debug(`IMA Zotero Sync: list folders failed: ${err.stack || err.message}`);
    }
    if (!folders.length) return { folderId: "", folderName: "（根目录）" };
    const choices = ["0. （根目录）", ...folders.map((f, i) => `${i + 1}. ${f.name}`)].join("\n");
    const answer = promptUser("IMA Zotero 同步", `选择「${kb.name}」中的目标文件夹：\n\n${choices}\n\n请输入序号（0 = 根目录）：`, "0");
    const index = Number(answer);
    if (!index || Number.isNaN(index)) return { folderId: "", folderName: "（根目录）" };
    const selected = folders[index - 1];
    if (!selected) return { folderId: "", folderName: "（根目录）" };
    return { folderId: selected.folderId, folderName: selected.name };
  }

  // 解析同步目标：知识库 + 文件夹。forcePrompt 时弹窗选择文件夹，
  // 否则使用设置里保存的默认文件夹（无则根目录）。
  async function chooseTarget(options = {}) {
    const kb = await chooseKnowledgeBase(options);
    let folderId = "";
    let folderName = "（根目录）";
    if (options.forcePrompt) {
      const folder = await chooseFolder(kb);
      folderId = folder.folderId;
      folderName = folder.folderName;
    } else {
      folderId = prefGet("targetFolderId") || "";
      folderName = prefGet("targetFolderName") || "（根目录）";
    }
    return { id: kb.id, name: kb.name, folderId, folderName };
  }

  async function chooseKnowledgeBase(options = {}) {
    const forcePrompt = !!options.forcePrompt;
    let defaultId = prefGet("targetKbId");
    let defaultName = prefGet("targetKbName");
    if (!forcePrompt && defaultId && defaultName) return { id: defaultId, name: defaultName };

    const bases = await listAddableKnowledgeBases();
    if (!bases.length) throw new Error("当前账号没有可写入的 IMA 知识库。");
    const defaultIndex = Math.max(0, bases.findIndex((kb) => kb.id === defaultId));
    const answer = promptUser(
      "IMA Zotero 同步",
      `选择目标 IMA 知识库：\n\n${formatKnowledgeBaseChoices(bases)}\n\n请输入序号：`,
      String(defaultIndex + 1),
    );
    const selected = bases[Number(answer) - 1];
    if (!selected) throw new Error("未选择 IMA 知识库。");
    if (options.saveDefault) {
      prefSet("targetKbId", selected.id);
      prefSet("targetKbName", selected.name);
    }
    return selected;
  }

  function selectedItemsFromWindow(win) {
    try {
      return win && win.ZoteroPane && win.ZoteroPane.getSelectedItems ? win.ZoteroPane.getSelectedItems() : [];
    } catch (err) {
      return [];
    }
  }

  async function syncItems(items, win, options = {}) {
    currentWindow = win || currentWindow;
    if (!items.length) {
      alertUser("IMA Zotero 同步", "请先选择一个或多个 Zotero 文献条目。");
      return;
    }
    try {
      const kb = await chooseTarget(options);
      const results = [];
      for (const item of items) {
        const startedAt = Date.now();
        let result;
        try {
          result = await syncOneItem(item, kb);
        } catch (err) {
          Zotero.debug(`IMA Zotero Sync item failed: ${err.stack || err.message}`);
          result = {
            status: "failed",
            title: (item && item.getField ? item.getField("title") : "") || (item ? item.key : "(无标题)"),
            reason: err.message || String(err),
          };
        }
        result.durationMs = Date.now() - startedAt;
        result.kbName = kb.name;
        result.folderName = kb.folderName || "（根目录）";
        results.push(result);
        recordOutcome(result);
      }
      const synced = results.filter((r) => r.status === "synced").length;
      const skipped = results.filter((r) => r.status === "skipped").length;
      const failed = results.filter((r) => r.status === "failed").length;
      const reasons = results
        .filter((r) => r.status === "skipped")
        .reduce((acc, r) => {
          const key = r.reason || "skipped";
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {});
      const reasonText = Object.keys(reasons).length
        ? `\n跳过原因：${Object.entries(reasons).map(([reason, count]) => `${translateReason(reason)}: ${count}`).join("，")}`
        : "";
      const failedText = failed ? `\n失败：${failed}` : "";
      alertUser("IMA Zotero 同步", `目标知识库：${kb.name}\n目标文件夹：${kb.folderName || "（根目录）"}\n已同步：${synced}\n已跳过：${skipped}${failedText}${reasonText}`);
    } catch (err) {
      Zotero.debug(`IMA Zotero Sync failed: ${err.stack || err.message}`);
      alertUser("IMA Zotero 同步", err.message || String(err));
    }
  }

  async function syncSelectedItems(win, options = {}) {
    await syncItems(selectedItemsFromWindow(win || currentWindow), win, options);
  }

  function getMainWindows() {
    const windows = [];
    try {
      if (Zotero.getMainWindows) {
        for (const win of Zotero.getMainWindows()) {
          if (win && win.document) windows.push(win);
        }
      }
    } catch (err) {}
    try {
      const enumerator = Services.wm.getEnumerator("navigator:browser");
      while (enumerator.hasMoreElements()) {
        const win = enumerator.getNext();
        if (win && win.document && !windows.includes(win)) windows.push(win);
      }
    } catch (err) {}
    return windows;
  }

  function getActiveMainWindow() {
    try {
      const pane = Zotero.getActiveZoteroPane && Zotero.getActiveZoteroPane();
      if (pane && pane.document && pane.document.defaultView) return pane.document.defaultView;
    } catch (err) {}
    return currentWindow || getMainWindows()[0] || Services.wm.getMostRecentWindow("navigator:browser");
  }

  async function syncSelectedFromActiveWindow(options = {}) {
    const win = getActiveMainWindow();
    await syncSelectedItems(win, options);
  }

  async function dryRunOneItem(item, kb) {
    if (!item || !item.isRegularItem || !item.isRegularItem()) {
      return { status: "skipped", title: item ? item.getField("title") : "", reason: "not a regular item" };
    }
    const payload = await itemPayload(item);
    const local = findSyncRecord(item, kb.id);
    const files = await getAttachmentFiles(item);
    if (!files.length) {
      return {
        status: "skipped",
        title: payload.title || item.key,
        reason: "no supported local attachments",
        attachmentCount: 0,
        localMatch: !!(local && local.syncHash === payload.syncHash),
        remoteMatch: false,
      };
    }
    if (local && local.syncHash === payload.syncHash) {
      return {
        status: "unchanged",
        title: payload.title || item.key,
        attachmentCount: files.length,
        localMatch: true,
        remoteMatch: false,
        fileNames: files.map((file) => file.fileName),
      };
    }
    const remoteMatches = [];
    for (const file of files) {
      remoteMatches.push(await findRemoteFileByName(file.fileName, kb.id, kb.folderId));
    }
    const existingCount = remoteMatches.filter(Boolean).length;
    return {
      status: existingCount === files.length ? "remote-files-exist" : "would-sync",
      title: payload.title || item.key,
      attachmentCount: files.length,
      existingCount,
      localMatch: !!(local && local.syncHash === payload.syncHash),
      remoteMatch: existingCount > 0,
      fileNames: files.map((file) => file.fileName),
    };
  }

  async function dryRunItems(items, win, options = {}) {
    currentWindow = win || currentWindow;
    if (!items.length) {
      alertUser("IMA Zotero 同步预演", "请先选择一个或多个 Zotero 文献条目。");
      return;
    }
    try {
      const kb = await chooseTarget(options);
      const results = [];
      for (const item of items) {
        results.push(await dryRunOneItem(item, kb));
      }
      const counts = results.reduce((acc, result) => {
        acc[result.status] = (acc[result.status] || 0) + 1;
        return acc;
      }, {});
      const lines = [
        `目标知识库：${kb.name}`,
        `目标文件夹：${kb.folderName || "（根目录）"}`,
        `检查条目数：${results.length}`,
        ...Object.entries(counts).map(([status, count]) => `${translateStatus(status)}：${count}`),
        "",
        ...results.slice(0, 8).map((result) => `${translateStatus(result.status)}：${result.title}（${result.attachmentCount || 0} 个附件）`),
      ];
      if (results.length > 8) lines.push(`……还有 ${results.length - 8} 个条目`);
      alertUser("IMA Zotero 同步预演", lines.join("\n"));
    } catch (err) {
      Zotero.debug(`IMA Zotero Sync dry run failed: ${err.stack || err.message}`);
      alertUser("IMA Zotero 同步预演", err.message || String(err));
    }
  }

  function translateStatus(status) {
    return (
      {
        synced: "已同步",
        skipped: "已跳过",
        unchanged: "未变化",
        failed: "失败",
        "would-sync": "将会同步",
        "remote-files-exist": "远端附件已存在",
      }[status] || status
    );
  }

  function translateReason(reason) {
    return (
      {
        unchanged: "未变化",
        exists: "远端已存在",
        "sync already running": "同步正在运行",
        "no supported local attachments": "没有可上传的本地附件",
        "not a regular item": "不是普通文献条目",
      }[reason] || reason
    );
  }

  async function dryRunSelectedItems(win, options = {}) {
    await dryRunItems(selectedItemsFromWindow(win || currentWindow), win, options);
  }

  async function dryRunSelectedFromActiveWindow(options = {}) {
    const win = getActiveMainWindow();
    await dryRunSelectedItems(win, options);
  }

  async function syncMenuManagerContext(context, event, options = {}) {
    const win =
      (event && event.target && event.target.ownerGlobal) ||
      (context && context.window) ||
      currentWindow ||
      Services.wm.getMostRecentWindow("navigator:browser");
    const items = context && context.items ? Array.from(context.items) : selectedItemsFromWindow(win);
    if (options.dryRun) {
      await dryRunItems(items, win, options);
    } else {
      await syncItems(items, win, options);
    }
  }

  async function configureCredentials() {
    const clientId = promptUser("IMA Zotero 同步", "IMA Client ID：", prefGet("clientId"));
    if (!clientId) return;
    const apiKey = promptUser("IMA Zotero 同步", "IMA API Key：", prefGet("apiKey"));
    if (!apiKey) return;
    prefSet("clientId", clientId);
    prefSet("apiKey", apiKey);
    alertUser("IMA Zotero 同步", "IMA 凭据已保存到 Zotero 设置。");
  }

  async function configureTargetKnowledgeBase() {
    try {
      const bases = await listAddableKnowledgeBases();
      if (!bases.length) throw new Error("当前账号没有可写入的 IMA 知识库。");
      const answer = promptUser("IMA Zotero 同步", `选择默认 IMA 知识库：\n\n${formatKnowledgeBaseChoices(bases)}\n\n请输入序号：`, "1");
      const selected = bases[Number(answer) - 1];
      if (!selected) return;
      prefSet("targetKbId", selected.id);
      prefSet("targetKbName", selected.name);
      const folder = await chooseFolder(selected);
      prefSet("targetFolderId", folder.folderId || "");
      prefSet("targetFolderName", folder.folderName || "（根目录）");
      alertUser("IMA Zotero 同步", `默认同步目标已保存：\n知识库：${selected.name}\n文件夹：${folder.folderName || "（根目录）"}`);
    } catch (err) {
      alertUser("IMA Zotero 同步", err.message || String(err));
    }
  }

  async function runDiagnostics() {
    try {
      await loadCredentials();
      const bases = await listAddableKnowledgeBases();
      const defaultName = prefGet("targetKbName", "(not set)");
      const defaultFolder = prefGet("targetFolderName", "（根目录）");
      alertUser(
        "IMA Zotero 同步诊断",
        [
          "IMA 凭据：正常",
          `可写入知识库：${bases.length}`,
          `默认知识库：${defaultName}`,
          `默认文件夹：${defaultFolder}`,
          `菜单模式：${legacyMenusEnabled ? "传统 XUL 备用菜单" : "Zotero MenuManager"}`,
        ].join("\n"),
      );
    } catch (err) {
      alertUser("IMA Zotero 同步诊断", err.message || String(err));
    }
  }

  function addMenuItem(doc, parent, id, label, command) {
    if (!parent || doc.getElementById(id)) return;
    const item = doc.createXULElement ? doc.createXULElement("menuitem") : doc.createElement("menuitem");
    item.id = id;
    item.setAttribute("label", label);
    item.addEventListener("command", command);
    parent.appendChild(item);
  }

  function removeNodeById(doc, id) {
    const node = doc && doc.getElementById(id);
    if (node) node.remove();
  }

  function firstExistingElement(doc, ids) {
    for (const id of ids) {
      const node = doc.getElementById(id);
      if (node) return node;
    }
    return null;
  }

  async function registerOneMenu(definition) {
    const id = Zotero.MenuManager.registerMenu(definition);
    return id && typeof id.then === "function" ? await id : id;
  }

  function buildSyncMenuEntries() {
    return [
      {
        menuType: "menuitem",
        l10nID: "ima-zotero-sync-menu-dry-run",
        label: "预演同步所选文献",
        onCommand: (event, context) => syncMenuManagerContext(context, event, { forcePrompt: true, dryRun: true }),
      },
      {
        menuType: "menuitem",
        l10nID: "ima-zotero-sync-menu-sync-default",
        label: "同步所选文献到默认知识库",
        onCommand: (event, context) => syncMenuManagerContext(context, event),
      },
      {
        menuType: "menuitem",
        l10nID: "ima-zotero-sync-menu-sync-chosen",
        label: "同步所选文献到指定知识库...",
        onCommand: (event, context) => syncMenuManagerContext(context, event, { forcePrompt: true }),
      },
      {
        menuType: "menuitem",
        l10nID: "ima-zotero-sync-menu-default-kb",
        label: "选择默认 IMA 知识库",
        onCommand: () => configureTargetKnowledgeBase(),
      },
      {
        menuType: "menuitem",
        l10nID: "ima-zotero-sync-menu-credentials",
        label: "配置 IMA 凭据",
        onCommand: () => configureCredentials(),
      },
      {
        menuType: "menuitem",
        l10nID: "ima-zotero-sync-menu-diagnostics",
        label: "运行诊断",
        onCommand: () => runDiagnostics(),
      },
    ];
  }

  async function registerMenuManagerMenus() {
    if (!Zotero.MenuManager || !Zotero.MenuManager.registerMenu) {
      return false;
    }
    try {
      registeredMenus.push(
        await registerOneMenu({
          menuID: "ima-zotero-sync-tools-menu",
          pluginID: PLUGIN_ID,
          target: "main/menubar/tools",
          menus: [
            {
              menuType: "submenu",
              l10nID: "ima-zotero-sync-menu-root",
              label: "IMA Zotero 同步",
              menus: buildSyncMenuEntries(),
            },
          ],
        }),
      );

      registeredMenus.push(
        await registerOneMenu({
          menuID: "ima-zotero-sync-item-menu",
          pluginID: PLUGIN_ID,
          target: "main/library/item",
          menus: [
            {
              menuType: "submenu",
              l10nID: "ima-zotero-sync-menu-root",
              label: "IMA Zotero 同步",
              menus: buildSyncMenuEntries(),
            },
          ],
        }),
      );

      // MenuManager 管理菜单生命周期；此时必须关闭传统 XUL 菜单，
      // 否则静态节点与 MenuManager 动态节点的 ID 冲突会破坏右键 popup
      // （表现为右键只弹出一次，之后无法再弹出）。
      legacyMenusEnabled = false;
      Zotero.debug("IMA Zotero Sync: registered menus via Zotero.MenuManager");
      return true;
    } catch (err) {
      unregisterMenuManagerMenus();
      legacyMenusEnabled = true;
      Zotero.debug(`IMA Zotero Sync: MenuManager registration failed, using legacy menus: ${err.stack || err.message}`);
      return false;
    }
  }

  function unregisterMenuManagerMenus() {
    if (!Zotero.MenuManager || !Zotero.MenuManager.unregisterMenu) {
      registeredMenus = [];
      return;
    }
    for (const id of registeredMenus) {
      try {
        Zotero.MenuManager.unregisterMenu(id);
      } catch (err) {
        Zotero.debug(`IMA Zotero Sync: failed to unregister menu ${id}: ${err.message}`);
      }
    }
    registeredMenus = [];
  }

  function registerPreferencePane(rootURI) {
    if (!Zotero.PreferencePanes || !Zotero.PreferencePanes.register) {
      Zotero.debug("IMA Zotero Sync: Zotero.PreferencePanes is unavailable");
      return false;
    }
    try {
      Zotero.PreferencePanes.register({
        pluginID: PLUGIN_ID,
        id: "ima-zotero-sync-preferences",
        src: `chrome://imazoterosync/content/preferences.xhtml`,
        label: "IMA Zotero 同步",
        stylesheets: [`chrome://imazoterosync/content/prefs.css`],
      });
      preferencePaneRegistered = true;
      return true;
    } catch (err) {
      preferencePaneRegistered = false;
      Zotero.debug(`IMA Zotero Sync: failed to register preference pane: ${err.stack || err.message}`);
      return false;
    }
  }

  function unregisterPreferencePane() {
    if (!preferencePaneRegistered || !Zotero.PreferencePanes || !Zotero.PreferencePanes.unregister) {
      preferencePaneRegistered = false;
      return;
    }
    try {
      Zotero.PreferencePanes.unregister(PLUGIN_ID);
    } catch (err) {
      Zotero.debug(`IMA Zotero Sync: failed to unregister preference pane: ${err.message}`);
    }
    preferencePaneRegistered = false;
  }

  function addToolsMenu(win) {
    const doc = win.document;
    const toolsPopup = firstExistingElement(doc, ["menu_ToolsPopup", "menu-tools-popup"]);
    if (!toolsPopup || doc.getElementById("ima-zotero-sync-tools-menu")) return;
    const menu = doc.createXULElement ? doc.createXULElement("menu") : doc.createElement("menu");
    menu.id = "ima-zotero-sync-tools-menu";
    menu.setAttribute("label", "IMA Zotero 同步");
    const popup = doc.createXULElement ? doc.createXULElement("menupopup") : doc.createElement("menupopup");
    menu.appendChild(popup);
    addMenuItem(doc, popup, "ima-zotero-sync-tools-dashboard", "打开 IMA 控制台", () => openDashboard());
    addMenuItem(doc, popup, "ima-zotero-sync-tools-sync", "同步所选文献到默认知识库", () => syncSelectedItems(win));
    addMenuItem(doc, popup, "ima-zotero-sync-tools-dry-run", "预演同步所选文献", () =>
      dryRunSelectedItems(win, { forcePrompt: true, dryRun: true }),
    );
    addMenuItem(doc, popup, "ima-zotero-sync-tools-sync-choose", "同步所选文献到指定知识库/文件夹...", () =>
      syncSelectedItems(win, { forcePrompt: true }),
    );
    addMenuItem(doc, popup, "ima-zotero-sync-tools-target", "选择默认知识库/文件夹", () => configureTargetKnowledgeBase());
    addMenuItem(doc, popup, "ima-zotero-sync-tools-credentials", "配置 IMA 凭据", () => configureCredentials());
    addMenuItem(doc, popup, "ima-zotero-sync-tools-diagnostics", "运行诊断", () => runDiagnostics());
    toolsPopup.appendChild(menu);
  }

  // 幂等地把条目菜单补进右键菜单。每次 popupshowing 都会调用，
  // 即使 Zotero 重建了菜单也能恢复；已存在则直接跳过。
  function ensureItemMenu(win) {
    const doc = win.document;
    const itemPopup = doc.getElementById("zotero-itemmenu");
    if (!itemPopup || doc.getElementById("ima-zotero-sync-item-menu")) return;
    const menu = doc.createXULElement ? doc.createXULElement("menu") : doc.createElement("menu");
    menu.id = "ima-zotero-sync-item-menu";
    menu.setAttribute("label", "IMA Zotero 同步");
    const popup = doc.createXULElement ? doc.createXULElement("menupopup") : doc.createElement("menupopup");
    menu.appendChild(popup);
    addMenuItem(doc, popup, "ima-zotero-sync-item-dashboard", "打开 IMA 控制台", () => openDashboard());
    addMenuItem(doc, popup, "ima-zotero-sync-item-sync", "同步所选文献到默认知识库", () => syncSelectedItems(win));
    addMenuItem(doc, popup, "ima-zotero-sync-item-dry-run", "预演同步所选文献", () =>
      dryRunSelectedItems(win, { forcePrompt: true, dryRun: true }),
    );
    addMenuItem(doc, popup, "ima-zotero-sync-item-sync-choose", "同步所选文献到指定知识库/文件夹...", () =>
      syncSelectedItems(win, { forcePrompt: true }),
    );
    itemPopup.appendChild(menu);
  }

  // 监听右键菜单的 popupshowing：每次弹出前确保菜单项存在。
  // 处理器包在 try/catch 里，绝不会因异常卡死 popup（避免“只弹一次”）。
  function installItemMenuListener(win) {
    const doc = win.document;
    const itemPopup = doc.getElementById("zotero-itemmenu");
    if (!itemPopup || itemPopup._imaSyncShowingHandler) return;
    const handler = () => {
      try {
        ensureItemMenu(win);
      } catch (err) {
        Zotero.debug(`IMA Zotero Sync: build item menu failed: ${err.stack || err.message}`);
      }
    };
    itemPopup.addEventListener("popupshowing", handler);
    itemPopup._imaSyncShowingHandler = handler;
  }

  function addMenus(win) {
    if (!win || !win.document) return;
    addToolsMenu(win);
    ensureItemMenu(win);
    installItemMenuListener(win);
  }

  function addMenusToOpenWindows() {
    for (const win of getMainWindows()) {
      currentWindow = currentWindow || win;
      scheduleMenuInstall(win);
    }
  }

  function scheduleMenuInstall(win) {
    addMenus(win);
    try {
      win.setTimeout(() => addMenus(win), 750);
      win.setTimeout(() => addMenus(win), 2000);
    } catch (err) {}
  }

  function removeMenus(win) {
    if (!win || !win.document) return;
    const doc = win.document;
    const itemPopup = doc.getElementById("zotero-itemmenu");
    if (itemPopup && itemPopup._imaSyncShowingHandler) {
      try {
        itemPopup.removeEventListener("popupshowing", itemPopup._imaSyncShowingHandler);
      } catch (err) {}
      itemPopup._imaSyncShowingHandler = null;
    }
    for (const id of ["ima-zotero-sync-item-menu", "ima-zotero-sync-tools-menu"]) {
      removeNodeById(doc, id);
    }
  }

  IMAZoteroSync = {
    async startup(data = {}) {
      addonRootURI = data.rootURI || "";
      Zotero.IMAZoteroSync = IMAZoteroSync;
      registerPreferencePane(data.rootURI || "");
      // 统一使用静态 XUL 注入 + popupshowing 监听。
      // Zotero 9 的 MenuManager 在条目右键菜单上会出现空白项，且右键
      // 仅能弹出一次（拆除阶段异常导致 popup 卡死），故不再使用。
      legacyMenusEnabled = true;
      addMenusToOpenWindows();
    },
    async shutdown() {
      unregisterPreferencePane();
      unregisterMenuManagerMenus();
      for (const win of getMainWindows()) removeMenus(win);
      if (Zotero.IMAZoteroSync === IMAZoteroSync) {
        delete Zotero.IMAZoteroSync;
      }
    },
    async install() {},
    async uninstall() {},
    syncSelectedFromActiveWindow,
    dryRunSelectedFromActiveWindow,
    syncAllPendingFromActiveWindow,
    getDashboardData,
    openDashboard,
    configureTargetKnowledgeBase,
    configureCredentials,
    runDiagnostics,
    listKnowledgeBases: () => listAddableKnowledgeBases(),
    listFolders: (kbId, folderId) => listFolders(kbId, folderId),
    async testConnection() {
      await loadCredentials();
      const bases = await listAddableKnowledgeBases();
      return { ok: true, count: bases.length };
    },
    onMainWindowLoad({ window }) {
      currentWindow = window;
      if (legacyMenusEnabled) scheduleMenuInstall(window);
    },
    onMainWindowUnload({ window }) {
      removeMenus(window);
      if (currentWindow === window) currentWindow = null;
    },
    async onPrefsEvent(type, data = {}) {
      if (type !== "load" || !data.window) return;
      const win = data.window;
      try {
        if (!win.IMAZoteroSyncPrefs) {
          Services.scriptloader.loadSubScript(`${data.rootURI || addonRootURI}content/preferences.js`, win);
        }
        win.IMAZoteroSyncPrefs?.init?.();
      } catch (err) {
        Zotero.debug(`IMA Zotero Sync: failed to initialize preference pane: ${err.stack || err.message}`);
      }
    },
  };
})();

async function startup(data, reason) {
  await IMAZoteroSync.startup(data, reason);
}

async function shutdown(data, reason) {
  await IMAZoteroSync.shutdown(data, reason);
}

async function install(data, reason) {
  await IMAZoteroSync.install(data, reason);
}

async function uninstall(data, reason) {
  await IMAZoteroSync.uninstall(data, reason);
}

function onMainWindowLoad(data) {
  IMAZoteroSync.onMainWindowLoad(data);
}

function onMainWindowUnload(data) {
  IMAZoteroSync.onMainWindowUnload(data);
}

async function onPrefsEvent(type, data) {
  await IMAZoteroSync.onPrefsEvent(type, data);
}
