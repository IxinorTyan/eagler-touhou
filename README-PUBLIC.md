# TH05 公网联机

公网入口复用现有 2/3 人合作、输入同步、可选回滚及暂停。服务器提供网页和房间、转发按键；每台玩家设备独立运行游戏，不传画面或声音。

## 启动

将 `lan_server.py`、`lan_relay.py`、`requirements-lan.txt` 和完整 `web/` 目录放到所有玩家都能访问的服务器，使用 Python 3.10 或更新版本：

```sh
python -m pip install -r requirements-lan.txt
python lan_server.py --network public-rtc --bind 0.0.0.0 --port 9893
```

在服务器防火墙及云安全组放行 TCP 9893，全员打开同一地址：

```text
http://服务器IP:9893/lan.html?network=public-rtc
```

Windows 可双击 `start-public.bat`。脚本启动服务；玩家仍需一个可访问的公网服务器地址或将整个服务暴露到公网的隧道地址。它不会自动获得公网 IP 或开通端口。

服务首页现在是四模式启动页，选择“公网联机”进入公网大厅。`--network public-rtc` 让不带参数的 `lan.html` 也默认创建公网房间；也可以保留原来的 `python lan_server.py`，在启动页选择“公网联机”。房主选择公网后，队友从不带参数的大厅加入也继承该房间的连接策略。房间号属于当前服务实例，全员必须访问同一实例。

## HTTPS 域名

服务绑定本机，使用支持 WebSocket 的反向代理：

```sh
python lan_server.py --network public-rtc --bind 127.0.0.1 --port 9893
```

Caddyfile 示例，将域名替换为已指向服务器的域名：

```caddyfile
game.example.com {
    reverse_proxy 127.0.0.1:9893 {
        header_up Host {http.request.host}
    }
}
```

开放 TCP 80/443，由 Caddy 管理 HTTPS；`/api/*`、`/relay` 与静态文件全部转发给同一进程。保留浏览器所使用的 Host，服务会校验请求来源。WebSocket 随页面自动使用 `ws://` 或 `wss://`。房间与中继保存在进程内，多个进程部署需要将同一局全部请求路由到同一进程。

## 连接和验收

公网默认优先 WebRTC 连接，使用 `web/netplay/udp-config.js` 配置的 STUN；直连失败时整房回退到 WebSocket 中继。STUN 不保证所有网络可穿透，可在该配置文件中接入同源 TURN 临时凭据接口。大厅“连接方式”可在建房前选择始终中继；`--network public-ws`、`network=public-ws` 以及兼容别名 `network=direct-ws` 保留强制中继行为。局域网仍默认无需 STUN 的 WebRTC。

默认关闭回滚，高延迟连接可由房主在准备前开启。回滚增加设备运算和内存占用，慢设备仍会限制全局推进速度。

普通入口已接入 TH05 专用忙等及公共优化核心，协议为 `th05-netplay/6`。回滚开启时，方向预测与预测领先上限均为 6 步，保留 12 步恢复历史。该设置减少快端反复重算，不会增加固定 6 步输入延迟。

游戏中可查看游戏帧率、每步计算耗时、往返延迟及累计输入等待比例：计算一步明显超过 16.7 ms 时，设备算力已不足以维持 60 Hz 同步步，回滚还会增加计算负担；每步计算较快而等待输入占比高时，可尝试开启回滚。WebSocket 中继使用可靠传输，网络丢包造成的阻塞仍可能影响体验。

最新核心、预测限速和原生暂停等修改尚未完成新一轮真实异地验收；不能把历史本机中继测试当作公网性能保证。当前功能、更新方法及验收范围见 [项目说明](README.md)。更新文件后重启服务，让全部玩家刷新并重新建房。

## 发行与开发资料

仓库按 `.gitignore` 保留可直接部署的服务及完整网页运行资源。浏览器测试脚本、设备数据、`reports/`、冻结构建目录和原始磁盘属于本地开发工作区，不随发行上传。服务启动不依赖这些文件。
