# TH05 主项目接入

TH05 普通版与两人、三人合作模式共用主启动器的安装、文件与房间入口。主项目管理房间成员、选人、准备和开局；`th05-coop-lab` 的 DOSBox-X fast core 与确定性联机内核继续负责原版游戏、输入、音频和确认帧。

在 monorepo 根目录运行：

```powershell
npm --prefix launcher run build:ui-rewrite
node ports/th05/scripts/dev.mjs
```

打开 <http://127.0.0.1:18350/?test=th05>。单人入口安装本地资源并启动原版标题；联机大厅提供灵梦、魔理沙、魅魔、幽香四名角色。房间小窗用于预览，展开画面后使用主项目键盘映射。原生暂停菜单的退出操作会同步结束全员游戏，再由主项目预载同一房间的下一局。

开发脚本从完整的 `../th05-coop-lab/web/` 导出 Runtime 与约 94 MiB DATA，同时启动主 Launcher 和主 Relay。可用 `PC98_LAUNCHER_PORT`、`PC98_RELAY_PORT` 修改默认的 18350、18351 端口。前端源文件变化后重新构建前端。

封面使用 THBWiki 收藏的原版包装高清扫描，单人和联机卡片共用。运行 `python launcher/scripts/prepare-pc98-cover-artwork.py` 下载 TH01–TH05 原图到 `games/host-artwork/originals/`，同时生成轻量 WebP 封面，并在本目录的 `artwork/` 保存 TH05 封面与来源哈希。首次生成后启动开发服务即可显示；Host 组装使用 `--game-dir=th05=ports/th05` 读取同一封面。原图与生成资源保存在 Git 忽略目录中。

普通版的 `GENSOU.SCR`、`MIKO.CFG` 从 DOSBox 虚拟文件系统导出到 `/savesth05`，下一次启动前导回原生文件；多人文件命名空间为 `/savesth05mp`。两者使用主项目 IDBFS v21 `FILE_DATA` 格式。单人浏览器录制的 `.th05r` 文件进入主项目录像列表；主项目录像播放工作台与多人录像、观战另行接入。多人局原版分数提取也属于后续验收范围。

验证入口：

```powershell
node ports/th05/tests/contracts.mjs
node ports/th05/tests/transport.mjs
node ports/th05/tests/launcher-browser.mjs
node ports/th05/tests/launcher-room-browser.mjs
$env:PC98_TEST_PLAYERS='3'
$env:PC98_TEST_RELAY='1'
$env:PC98_TEST_ROLLBACK='1'
node ports/th05/tests/browser.mjs --net-only
```

Launcher 测试要求开发服务已启动。实际 Chromium/WASM 验证覆盖单人安装、原生标题、存档提取，主大厅建房、加入、落座、检查游戏、准备、双人直连开局、主键盘移动、原生退出、同房第二局，以及三人中继回滚模式的确认帧推进和全员退出。截图与报告位于 `.cache/`。

构建会校验生成目录的依赖闭包，记录每个来源文件的 SHA-256 与来源提交，并在完整暂存构建成功后替换输出。`build-eagler/NOTICE.html` 包含 DOSBox-X、NP2 与 Phosphor Icons 的来源及许可证。资源、生成代码和测试产物分别保存在被忽略的 `content/`、`build-eagler/`、`.cache/` 中。

本目录为 `testOnly` 适配预览。来源历史登记见 [迁移记录](../../docs/migration/th05-eagler-20261025.md)，Git 子树连接点和导出基点待原仓库源码正式迁入时登记。手机触控、离线重载、异网长局和完整通关属于正式验收项目。
