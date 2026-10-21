# TH05 浏览器 Replay／检查点旁观验收交接

日期：2026-10-21。验收对象为当前本地源码及随附普通运行资源，不是已部署服务。开发参考见 [TH01–04 移植交接](REPLAY-PORTING-TH01-04.md)；实现细节见 [实现说明文首](REPLAY-IMPLEMENTATION.md)。本文件与当前功能说明优先于历史插桩实验记录。

## 验收结论

浏览器检查点方案已实现，可交给 TH01–04 作为接入参考。功能链包括独立副本生成、固定周期与换面采点、文件／本机／HTTP 传输、新观众恢复、前后定位、暂停／取消、声音状态及失败回退。各作仍须接自己的输入和完整状态，不能直接宣称移植完成。

当前结论是本地功能链验收，不是完整产品稳定性签收：没有完成自然连续主线／EX 通关、全部语言／机体／人数／回滚组合的跨面遍历、实体手机及跨浏览器／异地公网长局。没有部署、重启或新建监听服务。

## 本轮补充检查及修正

1. 逐项检查生成器、普通 Worker 的捕获／恢复门、全状态 serializer、容器分区、上传重试、播放器代次和故障回退；确认捕获只在独立旁观实例，未将它接入玩家快照热路径。
2. 原有“换面采点”主要由调度单元测试证明。补充普通核心在长前史后的真实原生第 2 面加载、文件选面、新实例恢复与 HTTP 晚加入测试，不再仅凭模拟 stage 数值声称换面链通过。
3. 修复暂停定位到最终检查点时，因不再进入推进循环而没有触发完成提示的边界问题。恢复完先结算目标，再立即检查 EOF；继续保留暂停状态及声音暂停。
4. 补充启用声音后的检查点前后恢复，以及精确最终点直接恢复不执行额外历史的回归。
5. 检查 TH01–04 的现有项目架构：TH01 为原生 C++／WASM，TH02–04 为 DOSBox-X；为它们分别整理接入点及必须重写的状态清单。

首个长前史换关样本中玩家已在测试触发点前结束战斗，没有产生换面点；该次属于无效夹具，未计作通过。调整输入使来源仍有实际原生推进后再验收，没有在生产逻辑中加入无敌或跳过证明。

## 功能与证据对照

| 功能 | 核查结论与本轮证据 |
| --- | --- |
| 玩家 DOS 执行隔离 | 捕获／恢复仅允许 `verifyHistory` 且非录制、非回滚、已确认的独立实例；普通磁盘与 WASM 与 HEAD 比较。普通入口策略测试拒绝旧插桩录制和分面启动 |
| 独立检查点生成 | `test_checkpoint_builder.mjs` 验证基准、换面批尾、固定周期、尾点及失败退役；`test_checkpoint_history.cjs` 使用真实普通来源与另一核心生成器，不是观众本机已看过的缓存 |
| 固定周期、文件定位 | 3720 帧生成 0／1800／3600／3720 点；定位 1900 从 1800 补 100 步，3650 从 3600 补 50 步；退回 100 从开局，逐步证明一致 |
| 长前史原生换面 | `TH05_CHECKPOINT_STAGE=1`：来源执行 6000 帧后通过测试路由请求已有原生退场／加载，第 6002 帧观测并保存第 2 面完整点；文件选择该面后补 360 步到 6362，原生计数实际前进且证明一致 |
| 新观众／跨上下文网络恢复 | 本机及独立新 context 经实际 Python HTTP Handler 读取基准与点；普通样本使用 3600 点，换面样本使用 6002 点；到达各自 EOF 时与来源最终证明一致 |
| 传输恢复 | 故意丢检查点上传 ACK，重传幂等；首次点下载注入 503，按同一 offset 重试并验证最终 SHA；普通网络测试另覆盖输入 ACK 丢失及历史读取重试 |
| 坏点降级 | 实际发给 Worker 的 gzip 被破坏后，新建核心从确认输入重建到 1900，补 1900 步；没有放宽证明或继续使用损坏状态 |
| 控制与 EOF | 前后定位、时间条、替换目标、取消与暂停到达通过；新增最终点恢复和声音状态回归见最新 `checkpoint-history.json` |
| 文件／服务校验 | 三代容器分区、点摘要、偏移／帧／首点拒绝；Python 5 项覆盖原历史容量、身份、点分块重试、半点不可见、摘要及范围拒绝 |
| 单人浏览器录制 | 中文真实录制、普通触控、原生暂停、提前结束后玩家继续、独立 context 导入和最终客体 SHA；日文原生退出自动封存；实际压缩故障不停止玩家 |
| 旧播放策略 | 正式普通入口不加载插桩录制资源，旧游戏帧只允许播放；匹配身份的旧播放样本在独立 context 重演终点一致 |

换面测试只在路由返回的 JS 中，对来源和独立副本于相同帧请求已有原生加载；没有改 WASM、磁盘、生产 Worker 文件或用旧 OUT 标记。它证明关卡加载后完整状态可以移植，不能冒充自然打败 Boss 后通关。

换面夹具的路由源码参与资源身份，故 `checkpoint-stage-history.th05m` 仅供同一路由复验，不能直接导入正式播放器。普通 `checkpoint-history.th05m` 不含该夹具。

## 可复验命令与报告

本轮运行结果以各命令最终退出状态和本地报告为准。命令依赖完整开发工作区、当前 Edge 与 Playwright；每个环境变量组合应在新 PowerShell 执行。

| 命令 | 本地报告／验证对象 |
| --- | --- |
| `node tools/test_checkpoint_builder.mjs` | 调度断言，标准输出 PASS |
| `node tools/test_confirmed_history.mjs` | 确认行／文件完整性断言，标准输出 PASS |
| `python tools/test_history_service.py` | 5 项服务测试，标准输出 OK |
| `node tools/test_checkpoint_history.cjs` | `reports/checkpoint-history.json`、对应 `.th05m` |
| `$env:TH05_CHECKPOINT_STAGE='1'; node tools/test_checkpoint_history.cjs` | `reports/checkpoint-stage-history.json`、对应 `.th05m` |
| `node tools/test_network_history.cjs` | `reports/network-history.json` |
| `node tools/test_multiplayer_history.cjs` | `reports/multiplayer-history-cn-2.json`；含录制开／关的相同输入原生校验对照 |
| `node tools/test_replay_seek.cjs` | `reports/seek-test.json` |
| `node tools/test_browser_replay.cjs` | `reports/browser-replay-cn.json` |
| `$env:TH05_LANGUAGE='jp'; $env:TH05_RECORD_QUIT='1'; node tools/test_browser_replay.cjs` | `reports/browser-replay-jp.json` |
| `$env:TH05_RECORD_FAULT='1'; node tools/test_browser_replay.cjs` | `reports/browser-replay-cn-fault.json` |
| `node tools/test_browser_replay_host.mjs`、`node tools/test_external_replay_codec.mjs` | 单人调度／时钟／命令／容器断言 |
| `node tools/test_replay_browser_policy.cjs`、`node tools/test_legacy_browser_playback.cjs` | 普通入口资源策略与旧文件仅播放 |

此前跨实例底层测试还覆盖中文 720／6000 和日文 1800 帧恢复后 360 步；12000 帧样本尾部原生计数未增长，只能作为该非战斗推进状态的恢复证据。历史报告保留，不以这些样本替代本轮真实原生换面链。

报告不随默认发行仓库发布。交接时应附相应报告与测试源码；不要只传截图或将旧报告当作修改后的重新验收。

## 限制与后续验收

- 输入历史仍完整下载。首次生成／上传、共用基准下载及恢复需要时间；没有检查点的区间仍可能从头执行。
- 每局点数／大小、服务总额和历史有明确上限；超过后停止可选链路并保留已有数据，不承诺无限时长的恒定定位耗时。
- 换面点是首次观测后的完整同步边界，不保证在该面第一帧。当前 UI 对第 2–6 面列已有点，不是每面独立文件；EX、重复局次等完整场景索引仍须另验收。
- 单人 `.th05r` 仍按浏览器时钟轨迹播放，没有多人检查点式跳转。TH01–04 本轮未修改代码、未实现移植，也未执行它们的游戏回归。
- 长时内存、自然连续跨面、主线／EX 完整结算、实体手机、真实公网／代理和跨浏览器仍待验收。不把独立 context 或本机 Handler 测试称为实体跨设备公网测试。
- 不能由“没有新增 DOS 指令”推导共享宿主 CPU 对所有设备 FPS 都没有影响。原有旧插桩分面失败证据仍保留，实验入口继续禁用。

因此交付定位是“可用于开发接入的参考实现及验收模板”，不是对四作或全部 TH05 场景的最终性能／稳定性保证。
