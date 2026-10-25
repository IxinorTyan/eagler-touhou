# TH02 主项目适配

`ports/th02` 将《东方封魔录》的 PC-98 DOSBox-X 运行时接入 Eagler Touhou。主项目负责 Package Store 安装、`/savesth02` 与 `/savesth02mp` 文件空间、房间成员、准备状态和开局；运行时继续使用封魔录的原生盘片与游戏逻辑。

在 monorepo 根目录运行：

```powershell
npm --prefix launcher run build:ui-rewrite
node ports/th02/scripts/dev.mjs
```

打开 `http://127.0.0.1:18320/?test=th02`。脚本从相邻 `../th02-coop-lab` 构建运行时及本地 `content/th02.data`，并启动主 Launcher 与 Relay。主项目存档文件为 `HUUHI.DAT`，设置文件为 `HUUMA.CFG`；它们从游戏磁盘 `HUMAROKU` 导出。合作模式支持两人和三人，保留原项目的三种机体射击配置。

可重复验证：

```powershell
node ports/th02/tests/contracts.mjs
node ports/th02/tests/transport.mjs
node ports/th02/tests/browser.mjs
node ports/th02/tests/launcher-browser.mjs
node ports/th02/tests/launcher-room-browser.mjs
```

`browser.mjs` 使用真实模拟器、WASM 和 DATA 检查单人、联机输入同步、Relay 与资源加载；Launcher 测试从主项目验证安装和房间流程。`PC98_TEST_PLAYERS=3`、`PC98_TEST_RELAY=1`、`PC98_TEST_ROLLBACK=1` 可切换运行人数、Relay 路由和回滚配置。日志与截图写入 `.cache/`。

入口仍标记为 `testOnly`。适配由主项目提供房间与存档界面，DOSBox-X 内继续运行原来的封魔录。原实验仓库不被构建脚本修改。来源提交与 Git 子树状态见 [迁移登记](../../docs/migration/th02-eagler-20261025.md)。

本地验收覆盖主 Launcher 单人安装与呈现、双人建房与加入、座位、预载、游戏检查、准备开局、键盘按下与释放、协议结束后同房再开，以及离开房间。真实 DOSBox-X 三人 Relay 回滚模式已推进超过 480 个确认帧。游戏原生暂停菜单退出、移动设备与远程网络另作验收；多人录像工作台与观战为后续接入项。

封面采用 THBWiki 原版外包装扫描，来源链接与 SHA-256 保存在 `artwork/cover-source.json`。
