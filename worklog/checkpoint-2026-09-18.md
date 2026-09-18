# Checkpoint — 2026-09-18

## 状态

NodeProbe 正从“筛选别人订阅中的好节点”转向“建立并维护自己的节点池”。

今天已经完成：
- 订阅 YAML → 完整 Mihomo 配置转换，并解决 FLClash 导入问题。
- 增加 COUNTRY 地区池。
- 增加基于服务器 IP 的实际国家探测。
- 明确最终目标：Source 只是节点发现/信息来源，不是最终产品。
- 明确节点生命周期与 Source 轮换必须分开观察。

## 当前核心架构原则

### 1. NodeProbe 自己的节点池才是最终产品

Source 的作用是：
- 发现新节点；
- 持续提供新的候选信息；
- 提供节点变化的外部信号。

最终订阅不应该简单复制某个 Source，也不应该以“哪个 Source 更好”为最终目标。

目标流程：

Source
→ Discovery
→ Validation
→ Tracking
→ Selection
→ NodeProbe 自己的 Subscription

### 2. 长生命周期节点是核心资产

节点需要记录：
- firstSeen
- lastSeen
- 连续出现周期
- 总出现次数
- 生命周期
- 历史健康表现
- 当前健康表现
- 曾经出现过的 Source

节点状态设计方向：
NEW → PROBATION → ACTIVE → STABLE → STALE → DEAD

节点从某个 Source 消失时不能立即视为死亡。

### 3. Source 的主动轮换不能简单惩罚

“节点生命周期短”不一定意味着 Source 差。
Source 可能主动淘汰旧节点、寻找更好的节点。

因此需要观察：
- Source 每轮新增/移除多少节点；
- 节点替换比例；
- 被替换节点与新节点的质量变化；
- Source 长期是否持续产生高质量的新节点。

也就是说：
- Node Stability：用户拿到的节点是否长期稳定；
- Source Quality / Evolution：这个 Source 是否持续提供有价值的新信息。

二者不能互相替代。

### 4. 存量维护 + 增量发现

最终系统应该形成：
- 长寿命节点：作为 NodeProbe 的存量核心资产；
- 聪明的轮换 Source：作为持续的新节点发现渠道；
- 健康检测：验证节点是否仍然值得保留；
- 生命周期跟踪：决定节点是否进入 STABLE / STALE / DEAD；
- 最终 YAML：只输出 NodeProbe 自己选择的节点。

## 当前已有数据

- data/history.json：多轮健康检测历史
- data/reputation.json：节点近期信誉
- data/source-history.json：来源历史观测
- data/source-reputation.json：来源信誉
- data/source-similarity.json：来源重叠分析
- data/candidates.json：当前候选
- data/ip-geolocation.json：节点服务器 IP 地理信息
- data/country-pool.json：国家池选择记录

## 本次准备实施

增加持久化节点池：
- data/node-pool.json
- scripts/update-node-pool.js

节点池不再因为一次 Source 抓取结果消失就丢弃节点。

每轮运行：
1. 当前 Source 产生新候选；
2. 与历史 Node Pool 合并；
3. 对当前候选和历史节点一起进行健康检测；
4. 根据最新健康结果更新 Node Pool；
5. 只有经过连续缺失/失败证据后才进入 DEAD；
6. STABLE 节点优先保留；
7. 新节点仍然保留探索机会；
8. Source 轮换产生的新节点继续进入观察体系。

同时记录 Source 的节点集合变化，为以后判断“坏轮换”还是“主动优化轮换”提供时间序列数据。

## 当前不要做

- 不把 Source 排名当成最终目标。
- 不因为 Source 节点更换频繁就直接降低其信誉。
- 不因为节点一次消失就判定死亡。
- 不用单次运行结果修改核心阈值。
- 不删除已有历史数据。
- 暂不把来源相似度直接作为质量惩罚。

## 恢复入口

从最新 main 分支继续。

下一阶段重点是让 NodeProbe 真正拥有“节点记忆”，而不是每轮重新从 Source 开始。
