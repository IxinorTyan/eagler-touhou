# TH01 公网联机

参考 TH03 / TH04，公网独立入口为 `lan.html?network=public`，支持双人、三人。各端运行同一游戏，只同步输入；人数、玉数、Boss 减伤、座位与连接方式由房主设置，队友加入后自动采用。三人采用房主分别连接两名队友的星形结构。

| 方式 | 输入路径 | 条件 |
| --- | --- | --- |
| UDP 自动打洞（默认） | WebRTC ICE 直接连接，TURN 可用时兜底 | 同一个公网网页与信令入口；默认 STUN |
| 强制 TURN 中继 | WebRTC 仅使用 TURN 候选 | 必须配置 TURN |
| TCP 服务器转发 | 同源 WebSocket / WSS | 安装 `requirements-relay.txt` 依赖 |

浏览器的 UDP 打洞由 WebRTC DataChannel、STUN 和 ICE 完成。默认 STUN 为 `stun:stun.cloudflare.com:3478`，无 TURN 配置仍会尝试打洞；对称 NAT、运营商或路由器限制可能使直连失败。TURN 可以通过 UDP、TCP 或 TLS 接入，连接详情以**实际选中的候选对**显示路径和协议，收集到候选不等于打洞成功。

## 临时公网入口

以下启动步骤由你手动执行；启动器不会自动配置防火墙或安装软件。

1. 如缺少 TCP 转发依赖，在本项目运行 `python -m pip install -r requirements-relay.txt`。
2. 运行 `start-lan.bat`，保持窗口打开，默认端口 **9874**。
3. 已安装 cloudflared 时运行 `start-public-tunnel.bat`。未安装可自行执行 `winget install --id Cloudflare.cloudflared --exact`。
4. 隧道窗口及 `public-test-url.txt` 会给出 UDP、强制 TURN、TCP 三种完整入口。**包括房主在内，全员打开同一个公网地址**。
5. 创建 2／3 人房间，把四位房间号告诉队友。队友在同一个公网游戏网址输入房间号加入，自动采用房主的人数、玉数、生命补偿和连接设置；全员准备后房主开始。大厅不再提供邀请链接或复制链接按钮。

隧道提供 HTTPS 网页、信令和 WSS，**不是 UDP 或 TURN 服务**。直接连接的输入不经过隧道；TCP 转发的输入经过隧道。临时隧道关闭后地址失效，重新启动会取得新地址。自定义端口时用 `python public_tunnel.py --port 你的端口`，房间服务须使用相同端口。

公网默认缓冲 6 帧，LAN 默认 3 帧；弱网络可以增至 9／12 帧。缓冲增加也会增加操作延迟。连接详情显示各队友的往返延迟、抖动估计、近 5 秒网络等待比例和下次开房的缓冲建议；三人经房主转发时估计更保守，建议不会自动调整当前局设置。

每 120 帧的状态核对改为后台进行，避免常规公网延迟造成固定周期的暂停；未核对帧达到 240 时才等待，发现差异仍停止全局。全员输入到齐才能执行相应帧。UDP 短暂中断最多等待 10 秒，浏览器若恢复原连接即可继续；明确连接失败、通道关闭或恢复超时仍停止。初次连接超过 30 秒会停止本局，可重建房间改用强制 TURN（已配置时）或 TCP 转发；不支持替换已关闭通道、局内切换、主机迁移或回滚。公网延迟超过输入缓冲时仍会产生锁步等待。

## TURN 配置

运行 `configure-turn.bat`，填写 Cloudflare TURN Key ID 和配套的专用 API Token，与 TH03 / TH04 使用同一种格式。本项目独立保存配置，**不会复制其他项目的密钥**。配置在项目根目录 `turn-config.local.json`，不在 `web/`，已加入忽略列表。配置过程不访问提供方；开始连接时才验证账号。已经配置但提供方报错时明确停止并提示原因，可重建 TCP 房间。

浏览器向同源 `/api/ice` POST `{protocol:"th01-lockstep/2",room,token,role}`。服务验证房间身份、已经开始的 RTC 房间、角色和请求频率，在房间锁之外取得临时凭据，返回前再次确认房间有效。长期 API Token 不发给浏览器。短期凭据有效 4 小时；接近 4 小时时需结束并重新建房，目前没有局内续期。

随附的 TURN 配置入口使用 Cloudflare 凭据服务。接入自建 coturn 凭据服务需要维护者适配同源认证接口，并重新生成配套的运行清单后成套发布；运行包不包含开发工具。接口须验证房间身份，返回标准 `{iceServers,iceTransportPolicy}`；强制 TURN 房间必须返回 `iceTransportPolicy:"relay"`。永久共享密钥留在服务端，不要直接修改已发布网页绕过资源校验。

## 固定公网服务器

保留 `lan_server.py`、`server.py`、`relay_server.py`、`turn_service.py`、`requirements-relay.txt` 与完整 `web/`。安装 Python 3.10+ 及依赖后手动运行：

```bash
python3 -m pip install -r requirements-relay.txt
python3 lan_server.py --bind 127.0.0.1 --port 9874 --no-browser
```

在有有效证书的 Nginx HTTPS server 中代理整个站点：

```nginx
location / {
    proxy_pass http://127.0.0.1:9874;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header Origin $http_origin;
    proxy_buffering off;
    proxy_read_timeout 120s;
}
location = /relay {
    proxy_pass http://127.0.0.1:9874;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header Origin $http_origin;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
}
```

入口：

```text
https://你的域名/lan.html?network=public
https://你的域名/lan.html?network=public&ice=relay
https://你的域名/lan.html?network=public&transport=ws
```

使用独立域名根路径，所有 `/api/*` 和 `/relay` 必须到同一个进程，保留外部 Host（含端口）与原始 Origin。房间在内存中，仅部署一个实例，重启服务需重新建房。公网 UDP 页面要求 HTTPS（本机 localhost 测试除外）。TURN 服务器须按其配置开放监听及中继端口，网页 TCP 端口不能代替这些端口。

`--stun` 可以重复设置自定义 STUN，影响 LAN 与公网自动模式；未指定时 LAN 不使用 STUN，公网使用默认 STUN。兼容 `network=public-udp`、`public-turn`、`public-ws`、`direct-ws` 及 `transport=relay` 旧参数，房间设置始终优先于入口参数。

## 连接检查与更新

开始游戏后查看连接详情，确认实际选中的候选对、协议及直连／中继路径；仅收集到候选不能证明打洞成功。请用不同网络的真实设备测试跨 NAT、TURN 和手机连接。连接失败时重新建房，选择已经配置的 TURN 或 TCP 转发。

运行包已包含游戏镜像、音乐、模拟器和同步清单，无需构建。更新时将同一版本的完整运行资源与服务端一起替换，全员刷新并重新建房；资源校验失败时检查是否混用了版本。开发工具与测试报告不随仓库分发，文件范围见 [主说明](README.md)。
