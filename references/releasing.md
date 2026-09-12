# 维护与发布

正式技能源目录为 `bigchx-make-skill/bigchx-make/`，站点源码在 `color-pro/`。`skills.bigchx.com` 提供功能介绍、安装说明、交互预览和机器可读文档；`/workbench/` 提供本地分色与结果导出。

## 单一版本来源

技能根目录 `manifest.json` 保存整包版本、模块版本、能力与规划；`releases.json` 保存真实版本记录，新版在前。package.json、package-lock.json、SKILL.md metadata.version 与整包版本一致。模块未变化可保持版本；包内容变化时提升整包版本并记录具体变更。项目状态 schema 独立维护。

## 构建与验证

在 `color-pro` 执行：

```sh
npm ci
node scripts/build-release.mjs --skill ../bigchx-make-skill/bigchx-make
npm test
npm run build
```

发布脚本检查版本、文档和算法副本一致性，生成双语主页、公开文档、版本日志与 `/skills/manifest.json`。算法主源为站点 src，打包前同步至技能 scripts/core。

ZIP 与 SHA-256 生成在 `release-artifacts/`，不进入 public、dist 或 Docker 镜像。保留版本化 ZIP 用于维护者回退，`release-artifacts/bigchx-make-skill.zip` 是待上传的当前完整包。同一版本不能覆盖成不同内容。源 manifest 不包含包自身的校验值；打包后只在公开 manifest.artifact 写入实际 SHA-256 和字节数。

## OSS 上传与网站部署

技能包统一地址：<https://oss.3dp.ing/skills/bigchx-make-skill.zip>。manifest.download、artifact.url、安装指南和更新提醒均使用此固定地址。主页不提供下载按钮或下载区，网站不托管技能 ZIP，旧下载路径返回 404。

维护者确认发布后，将 `release-artifacts/bigchx-make-skill.zip` 上传到上述 OSS 对象，再发布与它匹配的清单和网站。先验证 OSS 文件的 SHA-256 与公开清单一致，避免清单先于包上线。固定地址会随版本更新，应在 OSS 设置合适的缓存或刷新 CDN。

网站由 Docker 使用已生成页面与 public 资产构建，不需要技能源或打包产物目录。由外层代理配置 skills.bigchx.com 的 DNS、HTTPS 和容器转发。上线核对 `/`、`/zh/`、`/workbench/`、`/skills/manifest.json` 与 OSS 文件校验值。本地构建成功不代表已上传 OSS 或部署网站。
