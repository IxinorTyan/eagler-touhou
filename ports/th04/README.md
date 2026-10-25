# TH04 主项目接入

此目录提供 TH04 普通版与两人、三人合作模式的主项目适配。主项目管理安装、存档、成员、准备、开局；现有 `th04-coop-lab` 提供 PC-98 模拟器与游戏同步内核。

在 monorepo 根目录运行：

```powershell
node ports/th04/scripts/dev.mjs
```

打开 `http://127.0.0.1:18340/?test=th04`，选择 TH04 单人入口，或从联机大厅创建 TH04 房间。脚本将本地 `../th04-coop-lab` 导出为 Runtime 与约 95 MiB 的 DATA，并同时启动主 Launcher 和主 Relay。按 Ctrl+C 关闭两个服务。前端源文件变化后先运行 `npm --prefix launcher run build:ui-rewrite`。

构建输入须包含完整 `web/`，包括本地游戏镜像、音频与 WASM。`content/source.json` 记录输入哈希；游戏资源保留在被忽略的 `content/`，适配代码位于 `web/`。来源与连接方式见 `../../docs/migration/th04-eagler-20261025.md`。源历史子树连接与导出基点在正式迁入源仓库时登记，当前适配目录不代表完成了 Git 来源历史迁移。

封面使用 THBWiki 收藏的原版包装高清扫描，单人和联机卡片共用。运行 `python launcher/scripts/prepare-pc98-cover-artwork.py` 下载 TH01–TH05 原图到 `games/host-artwork/originals/`，同时生成轻量 WebP 封面，并在本目录的 `artwork/` 保存 TH04 封面与来源哈希。首次生成后启动开发服务即可显示；Host 组装使用 `--game-dir=th04=ports/th04` 读取同一封面。原图与生成资源保存在 Git 忽略目录中。

验证入口：

```powershell
node ports/th04/tests/contracts.mjs
node ports/th04/tests/transport.mjs
node ports/th04/tests/browser.mjs
node ports/th04/tests/launcher-browser.mjs
node ports/th04/tests/launcher-room-browser.mjs
```

`transport.mjs` 验证全员结束屏障；`browser.mjs` 使用真实 WASM 与本地 Relay 验证 Runtime 协议；后两项要求开发服务正在运行，通过真实 Launcher 安装并启动游戏。房间测试覆盖建房、加入、落座、检查游戏、准备、开局、展开后键盘移动、原生暂停菜单退出、同房第二局和离开房间。`PC98_TEST_PLAYERS=3`、`PC98_TEST_RELAY=1`、`PC98_TEST_ROLLBACK=1` 分别切换 Runtime 协议测试的人数、强制中继和回滚。截图与报告写入 `.cache/`。

普通版文件位于 `/savesth04`，多人版位于 `/savesth04mp`，使用主项目可直接读取的 IDBFS v21 `FILE_DATA` 格式。文件导入、导出与 `.th04r` 录像列表共用主项目入口。`build-eagler/NOTICE.html` 保留 DOSBox-X、NP2 和 Phosphor Icons 的来源及许可证全文。构建在暂存目录完成后替换导出目录，失败的适配不会覆盖上次成功结果。

当前是 `testOnly` 接入预览。[TH01](../th01/README.md)、[TH02](../th02/README.md)、[TH03](../th03/README.md) 和 [TH05](../th05/README.md) 也有独立适配入口。主项目录像播放工作台、观战与正式来源历史合并按作品能力分别登记；此预览标题使用隔离的原生实例，离开后由主项目重建 Runtime 并重新预载。
