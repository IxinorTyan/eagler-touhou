# TH05 主项目接入

[原仓库说明](README-UPSTREAM.md) · [来源与子树维护](../../docs/migration/th05-eagler-20261025.md)

TH05 普通版与两人、三人合作模式共用主启动器的安装、文件与房间入口。主项目管理房间成员、选人、准备和开局；`th05-coop-lab` 的 DOSBox-X fast core 与确定性联机内核继续负责原版游戏、输入、音频和确认帧。

在 monorepo 根目录运行：

```powershell
npm --prefix launcher run build:ui-rewrite
node ports/th05/scripts/dev.mjs
```

打开 <http://127.0.0.1:18350/?test=th05>。单人入口安装本地资源并启动原版标题；联机大厅提供灵梦、魔理沙、魅魔、幽香四名角色。房间小窗用于预览，展开画面后使用主项目键盘映射。原生暂停菜单的退出操作会同步结束全员游戏，再由主项目预载同一房间的下一局。

开发脚本从本目录代码和 `../th05-coop-lab/web/` 资源 导出 Runtime 与约 94 MiB DATA，同时启动主 Launcher 和主 Relay。可用 `PC98_LAUNCHER_PORT`、`PC98_RELAY_PORT` 修改默认的 18350、18351 端口。前端源文件变化后重新构建前端。

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

本目录为 `testOnly` 适配预览。来源历史登记见 [迁移记录](../../docs/migration/th05-eagler-20261025.md)，其中登记完整来源历史、Git 子树连接点与导出基点。手机触控、离线重载、异网长局和完整通关属于正式验收项目。

单人游戏保留原有浏览器练习器。点击画面右上角“练习 / 辅助”，或按 F12 选择机体、难度、关卡、Boss 与攻击阶段；Backspace 展开辅助菜单，F1–F5、U 切换辅助，Tab 显示信息，Shift+F 从已确认的目标重新练习。

辅助菜单与信息浮层沿用原布局，放在画面右侧信息区；F12 完整设置面板随实际画面缩放并可滚动，打开时进入原生暂停。参数表单、练习结果与快捷重试继续由浏览器控制。面板与结果弹窗打开时，主项目触控按钮暂时隐藏；移动手势从游戏画布开始，面板内保留点选与滚动。

特定跳关沿用原资源预载与后台预备实例：目标就绪后准备下一次起点，Shift+F 使用已确认的目标与最新辅助选项，预备实例在激活前保持冻结。高级设置中的预备快速重试选项可控制后台准备。练习 REP 存入主项目录像文件空间。手机可直接操作浏览器面板；合作房间使用原有同步内核。

统一练习器验证：启动包含 TH02、TH04、TH05 的主 Launcher 后运行 `node common/tests/pc98-practice-browser.mjs`。测试使用真实模拟器验证目标阶段、浏览器表单、辅助开关、后台预备完成与命中、暂停起点冻结、预备开关、右侧布局与窄屏面板。设置 `PC98_PRACTICE_MOBILE=1` 可验证移动浏览器面板与画面触控移动。

构建器默认使用当前 `ports/th05/web` 的代码；通过 `--assets=<原运行时 web 目录>` 提供游戏资源和预编译核心。`PC98_ASSETS_DIR` 可覆盖开发脚本默认的资源路径。源码基线与资源清单见 [source-import.json](source-import.json)，每次构建的实际输入哈希写入 `content/source.json`。
