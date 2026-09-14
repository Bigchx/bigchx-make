# 安装 Bigchx Make

主页：<https://skills.bigchx.com/>。从 [GitHub 仓库](https://github.com/Bigchx/bigchx-make) 下载完整 [技能 ZIP](https://github.com/Bigchx/bigchx-make/archive/refs/heads/main.zip)，解压后将 `bigchx-make-main/` 重命名为 `bigchx-make/`。私有仓库需要先登录 GitHub；仅下载 SKILL.md 无法运行算法。

1. 放入客户端支持的技能目录。Codex 常见个人目录为 `~/.codex/skills/bigchx-make/`，Windows 为 `%USERPROFILE%\.codex\skills\bigchx-make\`；Claude Code 常见目录为 `~/.claude/skills/bigchx-make/`。自定义目录以客户端实际配置为准。
2. 安装 Node.js 22.12+（推荐 24），在技能目录运行：

```sh
npm ci --omit=dev
node scripts/run.mjs help
node scripts/check-update.mjs --force
```

3. 重新加载客户端或开启新会话，用 `$bigchx-make` 指定任务和图片。安装依赖需要网络，图片计算在本地执行。

## 从旧技能迁移

旧名 `bigchx-pixel-color` 更名为 `bigchx-make`。先备份旧技能目录，在新名称目录安装完整包，再从客户端技能搜索路径移除旧副本，避免新旧说明同时被加载。保留用户的原图、输出作品和项目文件；安装包不包含这些内容。不要同时把新包再安装成旧名称。

2.0.0 保留中间项目 schema 1，可继续读取原 `project.json.gz` 并换色或导出；新文件名为 `bigchx-make-model.3mf`，3MF 中的自定义耗材元数据文件为 `Metadata/bigchx-make-materials.json`。引用旧输出文件名的自定义脚本需要随之调整。

普通聊天客户端未必支持本地技能安装。实际文件处理需要看图、读写文件和 Node.js 或浏览器操作能力；上传一份技能文档不会自动增加执行工具。没有本地环境时，可以直接使用[浏览器工作台](https://skills.bigchx.com/workbench/)完成图片分色、配色和模型导出。

更新规则见 [版本机制](updates.md)，发布流程见 [维护说明](releasing.md)。依赖安装、技能写入和重新加载均遵守当前客户端的权限设置。
