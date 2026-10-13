# TH03 DOSBox-X 开发交接

当前工作目录为 `th03-netplay-lab`，用户已把 `th03-pc98-fast` 覆盖回此目录。先读 README.md、MIGRATION.md；原 NP21 说明存于 build/NP21-README.md、build/NP21-DEVELOPMENT.md，属于历史，不能作为当前运行验收。

用户要求由他亲自逐步试玩，本次另已明确授权本机无窗口内核诊断，可自动选人并记录执行状态。已完成 Node 内核中日文选人到战斗、切换与战斗 12 帧完整内存回滚检查；旧调度对照复现黑屏停顿。未启动浏览器、真实音频设备、服务器或两台设备联机；这些仍由用户试玩，扩大测试范围需尊重原授权。按键和玩法沿用 TH03 原设计。

入口 app.js/solo.js 和 solo-worker.js 调用 dosbox-adapter.js。dosbox-disk.js 只提取原 HDI 的 YUMEZIKU，不启动系统 DOS/VEM486。dosbox-keys.js 仅转换原生键码。原磁盘和 patches/native 文件保持。

本地 JSPI 自动 cycles，网络完整 Asyncify 固定 16000 cycles。CPU 预算从 30000 调整后，常规战斗 600 步仍推进 564 原生游戏帧；中文密集蓄力／攻击 1200 步分别推进 1129／1102 帧，30000 对照也有原作攻击／结果停顿，未见预算降低造成额外刷新不足。不要替换为上游不完整 Asyncify、禁用回滚掩盖问题，或自动退回 NP21。网络恢复同时涉及 native RAM、4 个可变全局、continuation、虚拟时间、FS 写入与 app 端 TH03 暂停/输入/音乐状态。回滚确认前不输出预测音频，回滚批次结束后才呈现画面。

build_full_rollback.cjs 的 syncSleep：零等待协作让出不增加 virtualNow，nonSkippable 真实等待至少 1 ms。此前 1/64 ms 仍让嵌套 execl 的大量调用累积额外等待，连续选人切换为约 409 步；现在为 373／374 步，旧 NP21 相同按键对照为 370 步。禁止恢复 1/64 ms 或更早的 1 ms 处理。Normal 状态下连续协作调用上限为 1048576，每个真实等待和 step 开始重置；它只保护执行次数，不修改游戏时间。step 的 Asyncify 边界保护仍为 4096 次。app 暂停桥统一使用 module.virtualNow，并通过 nativeMusic.dosRange 将扫描限制在 640 KiB 常规内存。

同一同步帧内部的 syncSleep 在 Asyncify.State.Normal 且截止时间 <= targetNow 时直接返回，真实等待到达帧边界才挂起。必须保留 Normal 状态判断：重绕时直接返回会跳过 stop_rewind，触发 unreachable。test_dosbox_yields.cjs 检查生成代码的零等待、真实等待、重绕和循环上限。--no-coalesce 仅适合同时指定旧 --yield-quantum=0.015625 的历史诊断；零等待逐次挂起会超过 step 边界限制。不能通过跳过同步输入、加速载入阶段或改变游戏时钟来掩盖切换问题；用户明确不要等待条／载入提示。更改 CPU cycles 必须同时更新 FASTBOOT、config、manifests／wire version，并用原生游戏心跳与旧预算做对照。

app 的 Lockstep 使用 snapshotStride:2，输入仍是逐帧且 MAX_ROLLBACK 仍为 12。发生奇数帧修正时恢复不晚于 dirty 的最新检查点；原生与 app 快照须一同保留 confirmed 前的检查点，confirm(prefix,retainFrom) 分别控制音频确认与快照释放。回退可能跨过一个已确认帧，所以 NativeMusic.confirmed 和 emulator.confirmedAudio 是不可回滚的输出前沿；补算时不能再次播放这些帧。不要只改快照频率而漏掉保留边界或音频去重。

snapshot-diff.wat 仍检查所有 live bytes；全零 shadow 页只读 live 页，其余页完整比较。目录占 262144 bytes，zero flags 占 65536 bytes，shadow 数据偏移 327680。每次 copyRange、init、extend 更新 flags，restore 后 refreshFlag。相邻变化页共用 before-image buffer，各页保持最早 undo；恢复必须同时还原 live 与 shadow。test_snapshot_diff.cjs 覆盖零／非零页每个字节、随机变化、连续复制和恢复标志。

Lockstep 普通时间债务最多保留两 tick，四 tick 以上长停顿恢复一 tick；对端输入等待的恢复也限制为一 tick。每次任务仍限制 4 步 / 6 ms，历史修复单独计数。test_lockstep_pacing.mjs 使用交替 24/9 ms 更新验证有足够平均 CPU 能力时不会人为跌破 50 步/秒，并保留长卡顿／断流不会爆发追赶的检查。

startup-assets.js 缓存的是按路径和 hash 区分的原始字节，不能写入修改后的存档／补丁镜像。每次读取仍校验，存储异常可退回下载。最多 4 个并行加载，已验证的 rollback.wasm 作为 wasmBinary 传给 factory。network manifest 不包含单机专用 JSPI/fast WASM，但 vendor/runtime.json 保留完整发布资源指纹。

tools/build_dosbox_runtime.cjs 从本目录 vendor-source 和 build 重建包装器及 manifests。tools/build_lockstep_runtime.py 转调此构建，--fingerprints-only 更新指纹。修改运行文件后运行 node tools/write_dosbox_manifest.cjs，再 node tools/audit_assets.mjs。需要重建 native Asyncify 时运行 tools/build_asyncify.ps1，Binaryen 132 已随开发目录复制。

旧 NP21 构建工具和浏览器测试脚本随 tools 保留作参考，不应运行旧包装器构建来覆盖 DOSBox-X。静态审计报告写入 reports/migration-static-audit.json。

diagnose_network_transition.mjs 的 --transition-rollback 在选人／切换全程保留 stride 2 和完整窗口，i367 恢复 i356 再执行 12 步并检查完整堆；--paced-transition 使用真实 Lockstep 60 Hz 调度，包含成本与一次回滚。时限改为 battleAt < 480（相同输入确认 i90），有节奏的 Node 耗时还需 < 8 秒；旧 15 秒模拟限制过宽。JP/CN 连续诊断及稀疏补算通过；关闭／开启回滚 JP 的最后完整 DOS RAM 哈希相同。诊断程序标记仅在工具内观察 FS.open，不能依赖 _emGetRunningProgram 在 overlay 时返回 MAINL／MAIN，它仍为 OP。

diagnose_np21_transition.mjs 只读 disk-maintenance/th03-netplay-lab/web 的 NP21 真内核，使用相同补丁盘、32 倍频及相同原生按键，在 Node 中提供空画布与无音频设备适配；不能运行该目录中的浏览器／联机脚本扩大测试范围。中日文测得确认到战斗 370 步，不代表实际浏览器两端已验证。

本地端口 9876，联机后端 9877；.mjs MIME 必须为 text/javascript。新 wire/schema th03-rollback/5；房间 API 仍为 th03-lan/1。旧 MHz 字段仅作兼容固定 32，不代表 DOSBox cycles 或游戏帧率。

用户再次报告选人、标题、战斗、返回选人都等待几十秒且回滚开关无差别。读取当前进程与既有 9877 的静态资源发现：服务来自 th03-pc98-fast/lan_server.py，HTTP 返回 th03-rollback/3、30000 cycles，实际 syncSleep 仍逐次增加 1 ms 且没有帧内合并。当前工作目录为 th03-netplay-lab，不能以该旧服务表现判定新版修复失败。lan_server.py 启动显示目录和版本；端口占用时读取现有静态版本并明确新版没有启动，避免继续使用旧页。未因此改动原游戏时钟或引入载入加速／等待 UI。

后续用户明确实际是手机 + PC 局域网，两端均黑屏，连接毫秒数低；NP21 在同一低性能设备正常。不能以设备性能不足解释，也不能以 PC Node 测试替代移动端验收。已将修复资源备份后同步至 th03-pc98-fast，备份清单 reports/runtime-copy-v5.json。同步期间旧 9877 服务被关闭，未完成该端口 HTTP 复核。relay_server.py 遗漏的旧 /3 校验现改为 /5。

曾获准本机浏览器诊断：19877 仅绑定 loopback，使用 web/reports/transition-browser.html 两个实际 local.html iframe 和 WebRTC。PC 首次关闭回滚切换黑屏约 0.6 秒、回选人黑屏约 1.7 秒；开启回滚连续运行后观察到回选人黑屏约 9 秒、模拟降至十余步/秒。这个双实例共享浏览器的结果不能直接归因到手机；原任务尚未解决。Node 新 --round-trip 检查认输、胜者台词确认、返回选人、再次进入战斗；NP21 返回 774 步，DOS 约 770-774 步，进入约 370 步。总时长包括结算和台词，不等于纯黑屏时长。post-Asyncify -O2 试编译没有显著提速，仅留 build 诊断文件，未替换生产 WASM。

用户最新要求“别测了，弄一个日志，我自己测”。已停止自动诊断和本次 19877 服务；未经用户再次要求，不继续运行游戏或浏览器测试。现有“日志”按钮直接下载最近 600 个每秒样本（约 10 分钟）和 100 条错误、64 条程序读取、120 条慢步骤，日志在本地，不上传。按钮同时出现在普通工具栏和播放器工具栏。原生计时／程序读取日志属于宿主观察数据，不纳入回滚状态，不改游戏时钟。日志资源加入联机 manifest，两份目录均同步，用户后续提供手机与 PC 两份日志后再定位。
