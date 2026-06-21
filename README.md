# IMA Zotero 同步

把 Zotero 中选中的文献附件一键同步到 **腾讯 IMA 知识库**（[ima.qq.com](https://ima.qq.com)），支持指定知识库与文件夹、自动去重，并提供一个可视化的「同步控制台」。

> 适用于 Zotero 7 / 8 / 9（`strict_min_version` 6.999）。当前版本：**0.2.28**。

---

## ✨ 功能特性

- **选中即同步**：在文献条目上右键，或用工具菜单，把所选文献的本地附件上传到 IMA 知识库。
- **指定知识库 + 文件夹**：可设置默认目标，也可每次临时选择；支持 IMA 的多级文件夹。
- **可视化控制台**：独立窗口，含统计仪表盘（总同步数 / 今日 / 待同步 / 成功率 / 平均用时 / 失败数）、快捷操作、最近活动列表，以及内置「设置」标签页。
- **自动去重**：上传前检查目标文件夹内是否已存在同名文件，并按内容哈希跳过未变化的条目，避免重复上传。
- **同步标记**：成功后给条目打上 `IMA已上传` 标签，便于在 Zotero 中筛选。
- **凭据灵活**：凭据可存在 Zotero 设置里，也可读取 `~/.config/ima/client_id` 与 `~/.config/ima/api_key`。
- **预演（Dry-run）**：不上传、不写入，只检查哪些会同步 / 已存在 / 未变化。
- **诊断**：一键检查凭据、可写知识库数量、默认目标是否正常。

---

## 📦 安装

1. 下载 `ima-zotero-sync-<版本>.xpi`。
2. Zotero → **工具 → 插件**（Tools → Add-ons）。
3. 右上角齿轮 ⚙ → **Install Add-on From File…** → 选择该 `.xpi`。
4. **重启 Zotero**（菜单与控制台在启动时注册，必须重启才生效）。

升级时直接安装新版 `.xpi` 覆盖即可，无需先卸载。

> 💡 **自动更新**：插件已接入 GitHub Releases 自动更新。装好后，Zotero 会定期检查
> [本仓库的最新 Release](https://github.com/CrazyHalfDay/ima-zotero-sync/releases/latest)，
> 发现新版本时在「工具 → 插件」里提示并自动升级。也可在插件列表里手动「检查更新」。

---

## 🚀 快速开始

1. 打开控制台：文献右键 →「打开 IMA 控制台」，或 工具菜单 → IMA Zotero 同步 →「打开 IMA 控制台」。
2. 切到 **⚙ 设置** 标签页：
   - 填入 **Client ID** 和 **API Key**（在 [ima.qq.com/agent-interface](https://ima.qq.com/agent-interface) 获取）→「保存凭据」→「测试连接」。
   - 「加载可写入知识库」→ 选中一个知识库。
   - 「浏览所选知识库的文件夹」→（可逐级进入）→「设为默认文件夹」。不设置则默认上传到知识库根目录。
3. 回到 **📊 仪表盘**，在 Zotero 主界面选中一篇或多篇文献，点「🔄 同步所选文献」。
4. 到 IMA 中确认文件已进入对应知识库 / 文件夹。

---

## 🖱️ 入口一览

| 位置 | 提供的操作 |
| --- | --- |
| **条目右键菜单**（IMA Zotero 同步） | 打开控制台、同步到默认目标、预演、同步到指定知识库/文件夹 |
| **工具菜单**（IMA Zotero 同步） | 同上，外加配置凭据、选择默认目标、运行诊断 |
| **同步控制台**（独立窗口） | 仪表盘 + 设置，几乎所有功能的集中入口 |
| **Zotero 设置 → IMA Zotero 同步** | 凭据、知识库、文件夹的传统设置页（与控制台设置等价） |

---

## 📊 同步控制台

独立窗口，顶部可切换「📊 仪表盘 / ⚙ 设置」，并可滚动。

**仪表盘统计卡片**

| 卡片 | 含义 |
| --- | --- |
| 总同步数 | 库内已打 `IMA已上传` 标签的文献数（含历史） |
| 今日同步 | 当天成功同步的条目数 |
| 待同步 | 有本地附件但尚未同步的文献数 |
| 成功率 | 自安装本版本后累计的 成功 /（成功 + 失败） |
| 平均用时 | 每条成功同步的平均耗时 |
| 失败数 | 累计同步失败次数 |

**快捷操作**：同步所选文献、预演所选文献、同步全部待同步（会先确认数量）、去设置默认目标、去设置凭据、运行诊断。

**最近活动**：列出最近的同步记录（标题、目标知识库/文件夹、状态、耗时、相对时间），✅ 成功 / ❌ 失败 / ⏭ 跳过。

---

## 📄 支持的附件类型与大小

| 类型 | 扩展名 | 单文件上限 |
| --- | --- | --- |
| PDF / Word / PPT / 音频 | pdf, doc, docx, ppt, pptx, mp3, wav | 200 MB |
| 图片 | png, jpg, jpeg | 30 MB |
| Excel / CSV / 文本 / Markdown | xls, xlsx, csv, txt, md | 10 MB |

仅上传文献条目下的本地附件，不上传额外的元数据 Markdown。

---

## 🔁 去重机制

1. **本地哈希**：每个条目按稳定元数据 + 附件名/大小/修改时间计算 `syncHash`，写入 Zotero `Extra` 字段：

   ```text
   IMA-Zotero-Sync: {"kbId":"...","kbName":"...","folderId":"...","folderName":"...","syncHash":"...","syncedAt":"..."}
   ```

   同一条目再次同步到同一知识库且哈希未变 → 跳过。`IMA已上传` 标签本身不计入哈希。

2. **远端检查**：上传前在目标 **文件夹内** 按文件名查重，并调用 IMA `check_repeated_names`。已存在的同名文件不会重复上传。

> 提示：同名文件只有在 **同一文件夹** 内才算"已存在"；不同文件夹互不影响。

---

## 🔒 数据与隐私

- **凭据**：从控制台/设置页保存的 Client ID、API Key 存储在 Zotero 设置中；也可改用 `~/.config/ima/client_id` 和 `~/.config/ima/api_key` 文件，避免写入 Zotero 设置。
- **同步记录**：写在每个条目的 `Extra` 字段（`IMA-Zotero-Sync:` 行）。
- **统计与活动日志**：存在 Zotero 设置中（活动日志最多保留最近 60 条）。

---

## ❓ 常见问题

- **右键菜单只弹一次/之后不再出现**：早期版本因菜单 ID 冲突导致，已在 0.2.20 起改用 `popupshowing` 幂等注入修复。
- **文件夹列表是空的**：先确认该知识库根目录下确有文件夹。IMA 把文件夹编码为 `media_type=99` 的条目，插件已据此识别（0.2.25 起）。
- **控制台无法滚动**：0.2.28 起根容器已支持上下滚动、顶栏吸顶。
- **同步到了根目录而非指定文件夹**：确认「设为默认文件夹」后顶部横幅显示的目标文件夹正确。

---

## ⚠️ 已知限制

- 同步为 **手动触发**，无自动/定时同步。
- 暂不支持对 IMA 中已存在的文件做 **原地更新**：条目元数据变化会更新本地同步标记，未变化则跳过。
- 统计中的「成功率 / 平均用时 / 失败数」从安装本版本后开始累计，不含历史同步。
- IMA 知识库 OpenAPI 暂不支持给文件打标签，因此本插件不提供 IMA 端标签功能。

---

## 🛠️ 从源码打包

本目录即插件源码（`manifest.json` 在根目录）。打包成 `.xpi` 就是把以下内容用 **正斜杠路径** 压缩为 zip 并改后缀：

```
manifest.json
bootstrap.js
prefs.js
content/
locale/
```

PowerShell 示例：

```powershell
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$src = "$PWD"
$out = "$PWD\ima-zotero-sync.xpi"
$bs = [char]92; $fs = [char]47
$files = Get-ChildItem -Recurse -File -Path manifest.json,bootstrap.js,prefs.js,content,locale
$zip = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
foreach ($f in $files) {
  $rel = ($f.FullName.Substring($src.Length + 1)).Replace($bs, $fs)
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel) | Out-Null
}
$zip.Dispose()
```

> 注意：ZIP 内的路径必须用正斜杠 `/`，且 `manifest.json` 必须在压缩包根目录，否则 Zotero 无法识别。

跨平台脚本（Linux/macOS，需 `zip`）：

```bash
scripts/build-xpi.sh build/ima-zotero-sync.xpi
```

---

## 🚀 发布与自动更新（维护者）

自动更新基于 Zotero 的 `update_url` 机制 + GitHub Releases，全流程由 GitHub Actions 完成。

**工作原理**

- `manifest.json` 的 `update_url` 指向
  `https://github.com/CrazyHalfDay/ima-zotero-sync/releases/latest/download/update.json`
  （`releases/latest/download/` 永远解析到最新 Release 的同名资源）。
- 每次发布时，Actions 会生成 `update.json`（列出最新版本号与对应 `.xpi` 下载地址）
  和打包好的 `.xpi`，一起作为 Release 资源上传。
- Zotero 读取 `update.json`，比对版本，提示并下载新版 `.xpi`。

**发布一个新版本**

1. 改 `manifest.json` 里的 `version`（如 `0.2.29`），提交到 `main`。
2. 到仓库 **Actions → Release → Run workflow** 点一下按钮。
3. 工作流自动执行：读取 manifest 版本 → 打包 `.xpi` → 生成 `update.json`
   → 创建（或更新）标签 `v0.2.29` 对应的 Release 并上传两者。
4. 已安装用户随后会自动收到更新提示。

> 工作流仅手动触发（`workflow_dispatch`），按 `manifest.json` 当前版本号发布；
> 使用默认的 `GITHUB_TOKEN`（已通过 `permissions: contents: write` 授权），无需额外密钥。

---

## 📁 项目结构

```
manifest.json                     插件清单（id、版本、兼容范围）
bootstrap.js                      启动/关闭引导
prefs.js                          默认偏好
content/
  scripts/imazoterosync.js        主逻辑：同步、菜单、IMA API、统计、控制台桥接
  dashboard.xhtml / .js / .css    同步控制台窗口（仪表盘 + 设置）
  preferences.xhtml / .js         Zotero 设置页
  prefs.css                       设置页样式
  icons/icon.png / icon@2x.png    插件图标（48 / 96 px）
locale/en-US/ima-zotero-sync.ftl  本地化文案
scripts/
  build-xpi.sh                    打包 .xpi
  gen-update-json.py              从 manifest 生成 update.json
.github/workflows/release.yml     打标签自动构建 + 发布 + 自动更新
```

---

## 📄 许可

个人/研究用途的原型插件。IMA 为腾讯的产品，使用其 OpenAPI 需遵守 IMA 的服务条款。
