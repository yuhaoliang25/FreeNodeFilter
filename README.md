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
