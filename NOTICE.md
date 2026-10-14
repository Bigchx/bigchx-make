# 许可范围 / Licensing scope

The root MIT LICENSE applies only to original code and documentation for which bigchx owns the copyright. Third-party material is excluded from that grant and remains subject to its own applicable license or permission. No trademark rights are granted.

根目录 MIT 许可证仅适用于 bigchx 拥有版权的原创代码和文档。第三方内容不在该授权范围内，继续适用原有许可或提供方授权；不授予任何商标权。

## Excluded material / 排除的第三方内容

- `scripts/core/bambu-filaments.js`: includes the Bambu Studio 02.08.02.61 color-catalog snapshot from `resources/profiles/BBL/filament/filaments_color_codes.json`; the embedded catalog data is not relicensed under MIT.
- `scripts/core/bambu-print-profiles.json`: contains preset data extracted from six user-provided A1/P2S/H2C projects and installed official Bambu Studio BBL profiles. These configuration sources retain their respective rights and permissions.
- Dependencies including Three.js, clipper-lib, JSZip and sharp, and their transitive dependencies, retain their own licenses and notices. Installing this package does not change those terms.

Bambu Studio snapshot version: `v02.08.02.61`, commit `926a7192574bcb9b3a732e1ec59a46d79cb45466`. That upstream version is distributed under GNU AGPLv3; its unmodified license is included in [third-party-licenses/BambuStudio-AGPL-3.0.txt](third-party-licenses/BambuStudio-AGPL-3.0.txt) for the Bambu-derived material above. The MIT grant does not replace that license or the rights of user-provided project material.

Upstream license: https://github.com/bambulab/BambuStudio/blob/926a7192574bcb9b3a732e1ec59a46d79cb45466/LICENSE

Color-catalog source: https://github.com/bambulab/BambuStudio/blob/926a7192574bcb9b3a732e1ec59a46d79cb45466/resources/profiles/BBL/filament/filaments_color_codes.json

The preset snapshot includes inherited configuration and machine G-code strings, not only color values or dimensions. This project is not an official Bambu product. These source references do not grant additional rights over third-party material.

# 来源 / Sources

Bigchx Make / bigchx-K 由 bigchx 开发，官网 https://bigchx.com/ 。本技能的 scripts/core 为配套工作台项目 color-pro 的 src 构建副本，算法及作者元数据随包保留。

官方耗材颜色及机型/工艺配置来自 Bambu Studio 02.08.02.61 的公开配置目录静态快照。Bambu 品牌和第三方数据保留各自权利。本项目不是拓竹官方产品。部署和执行技能不需要安装 Bambu Studio。

依赖包括 Three.js、clipper-lib、JSZip 和 sharp，各自保留包内许可证。发布技能不改变第三方的许可条款。技能包不包含用户图片、参考工程中的模型或个人 AMS 配置。
