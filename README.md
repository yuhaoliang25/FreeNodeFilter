# FreeNodeFilter

自动聚合公开免费代理节点，并用 Mihomo 对节点做严格的协议过滤、去重和实际网络测试。

## 流程

`抓取 → 解析 → 标准化 → 去重 → 协议校验 → Google 连通性 → 多轮稳定性测试 → 生成订阅`

### 订阅

- `subscriptions/all.yaml`：通过基础协议检查的节点
- `subscriptions/google.yaml`：至少一次 Google 测试成功
- `subscriptions/stable.yaml`：多轮测试成功率 ≥ 80%

### Google 测试

默认使用 `https://www.google.com/generate_204`，每个节点默认测试 3 轮。Mihomo 的 group delay API 可以一次测试指定代理组中的节点，并支持 `expected` 状态码；这里要求 HTTP 204。citeturn0search0

项目不会把“能解析”当成“能用”，也不会把一次成功直接当成稳定。

## 数据源

仅聚合公开可访问的免费节点源。节点本身由第三方发布，项目不提供节点服务。

## 自动更新

GitHub Actions 定期抓取、过滤、启动 Mihomo，并执行 Google 多轮测试后生成订阅。

## 长期信誉

`data/reputation.json` 会根据历史测试批次维护节点状态。连续失败会进入 `degraded`，最近 6 次测试全部失败则进入 `quarantine`；被隔离的节点不会进入 `best.yaml`。这样可以避免节点偶尔恢复一次就立即回到高质量池。

## 支持的订阅格式

采集层支持 Clash/Mihomo YAML、Base64 包装的订阅，以及常见的 VLESS、VMess、Trojan、Shadowsocks URI；同时尽量保留 WebSocket、gRPC、TLS、SNI、Reality 等传输参数。所有节点仍需经过 Mihomo 实际连通性测试，格式支持不代表节点可用。

## 失败诊断

每批测试后，最多对 100 个未完全成功的节点进行二次诊断。通过 Mihomo 选中节点后，经本地 HTTP 代理再次访问测试 URL，并尝试区分 DNS、TLS、连接拒绝、超时等常见失败类型；诊断结果保存在 `data/diagnostics.json`。


## 探索与利用

Stage 1 的测试名额采用探索/利用策略：约 70% 分配给已有较好历史表现的节点，20% 保留给新节点，10% 用于重新观察降级节点。这样可以避免测试池长期只围绕旧节点，同时给新来源和恢复中的节点保留机会。


## 节点身份

系统使用稳定的 endpoint identity 追踪节点，而不是依赖订阅中的显示名称。身份由协议、服务器、端口、认证信息、传输方式、TLS/SNI 及 Reality 关键参数组成；因此同一节点改名后仍有机会继承历史信誉，而关键连接参数发生变化时会被视为新的身份。
