# 插件图标

- `icon.png`     —— 48 × 48 px（Zotero 插件列表显示用）
- `icon@2x.png`  —— 96 × 96 px（高分屏）
- `original.png` —— 原始 logo 源图（去白边/正方形/缩放后生成上面两个文件）

由 `manifest.json` 的 `icons` 字段引用。如需更新图标，替换 `original.png` 后用 Pillow 去白边、转透明、缩放重新导出即可。
