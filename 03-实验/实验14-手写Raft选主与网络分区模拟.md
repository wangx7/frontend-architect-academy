---
title: 实验 14 · 手写 Raft 选主（含日志新旧度校验）与网络分区防脑裂模拟
---

# 实验 14｜手写 Raft 选主（含日志新旧度校验）与网络分区防脑裂模拟

> 📖 **关联教程**：[第 16 讲：数据落盘与分布式：B+ 树、事务、Redis 与 Raft](../01-教程/第16讲-数据落盘与分布式B+树索引事务Redis与Raft.md)  
> 🔍 **关联概念**：[概念 20：CAP 定理与 Raft 多数派共识](../02-概念/20-CAP定理与Raft多数派共识.md)

## 1. 实验目标与教学模型边界声明

### 1.1 本实验真正验证的核心安全机制
1. **严格多数派交集（Quorum = `Math.floor(N/2) + 1`）防双主脑裂**：在 5 节点集群分裂为 `[A, B]`（2 节点少数派孤岛）与 `[C, D, E]`（3 节点多数派阵营）时，验证少数派孤岛既无法选出新主，其上的旧主也无法提交任何新写入；
2. **选举限制——候选人日志新旧度检查（Raft 论文 §5.4.1 Log Up-to-Date Check）**：验证在多数派阵营 `[C, D, E]` 中，如果日志落后的节点 `D` 抢先发起选举，握有最新已提交日志的节点 `C` 会**拒绝投票给 `D`**，从而防止落后节点当选覆盖已提交数据！
3. **高任期压制（Term Suppression）**：验证网络恢复后，低任期旧主 `A` 遇到高任期新主 `C` 时自动退位回 `Follower`。

### 1.2 教学模拟器与生产级 Raft 实现（如 etcd / TiKV）的边界说明
为了将代码控制在 90 行内方便阅读，本教学模拟器做了以下确定性简化（生产系统不可省略）：
- **网络与时钟模型**：本脚本采用同步方法调用模拟 RPC 与确定性调用顺序；生产级 Raft 运行在异步不可靠网络上，依赖 `150ms ~ 300ms` **随机化选举超时定时器（Randomized Election Timeout）** 避免活锁平票；
- **状态持久化（Persistence）**：生产级 Raft 在改变 `currentTerm`、`votedFor` 或追加 `log[]` 后，必须在回复 RPC 前调用 `fsync` 落盘，防止节点重启后同一任期投出两张选票；
- **日志冲突修复与跨任期提交（论文 §5.4.2）**：生产级 Raft 包含完整的 `AppendEntries` `prevLogIndex/prevLogTerm` 递减回溯修复以及“仅通过统计当前任期日志副本数来推进 `commitIndex`”的完整状态机。

---

## 2. 复制即跑代码

新建 `lab14-raft-split-brain.mjs`，运行 `node lab14-raft-split-brain.mjs`：

```js
// lab14-raft-split-brain.mjs —— 模拟 5 节点 Raft 选主、§5.4.1 日志新旧度校验、网络分区防脑裂与任期压制
import assert from 'node:assert/strict'

export class RaftNode {
  constructor(id, cluster, initialLog = []) {
    this.id = id
    this.cluster = cluster
    this.role = 'Follower' // 'Follower' | 'Candidate' | 'Leader'
    this.currentTerm = 1
    this.votedFor = null
    this.log = [...initialLog] // 格式: [{ term: 1, cmd: 'SET x=1' }]
  }

  getLastLogMeta() {
    if (this.log.length === 0) return { lastLogTerm: 0, lastLogIndex: 0 }
    return {
      lastLogTerm: this.log[this.log.length - 1].term,
      lastLogIndex: this.log.length
    }
  }

  // Raft 论文 §5.4.1 选举安全核心：候选人的日志必须至少和投票者一样新！
  isLogUpToDate(candLastTerm, candLastIndex) {
    const { lastLogTerm, lastLogIndex } = this.getLastLogMeta()
    if (candLastTerm !== lastLogTerm) return candLastTerm > lastLogTerm
    return candLastIndex >= lastLogIndex
  }

  // 发起选举拉票
  startElection() {
    this.role = 'Candidate'
    this.currentTerm += 1
    this.votedFor = this.id
    let votes = 1 // 投给自己 1 票
    const { lastLogTerm, lastLogIndex } = this.getLastLogMeta()

    for (const peer of this.cluster.getReachablePeers(this.id)) {
      if (peer.onRequestVote(this.id, this.currentTerm, lastLogTerm, lastLogIndex)) {
        votes++
      }
    }

    const quorum = Math.floor(this.cluster.nodes.length / 2) + 1 // 5 节点需 3 票
    if (votes >= quorum) {
      this.role = 'Leader'
      return { elected: true, term: this.currentTerm, votes, leader: this.id }
    }
    this.role = 'Follower'
    return { elected: false, term: this.currentTerm, votes, leader: null }
  }

  // 处理投票请求 RPC
  onRequestVote(candId, candTerm, candLastTerm, candLastIndex) {
    if (candTerm > this.currentTerm) {
      this.currentTerm = candTerm
      this.role = 'Follower'
      this.votedFor = null
    }
    if (candTerm < this.currentTerm) return false

    const availableToVote = this.votedFor === null || this.votedFor === candId
    if (availableToVote && this.isLogUpToDate(candLastTerm, candLastIndex)) {
      this.votedFor = candId
      return true
    }
    return false
  }

  // Leader 尝试提交客户端写入（必须复制到多数派节点才允许提交）
  tryReplicateCommand(cmd) {
    if (this.role !== 'Leader') {
      return { committed: false, reason: `节点 ${this.id} 不是 Leader` }
    }
    const reachable = [this, ...this.cluster.getReachablePeers(this.id)]
    const quorum = Math.floor(this.cluster.nodes.length / 2) + 1

    // 先检查并同步任期
    for (const peer of reachable) {
      if (peer.currentTerm > this.currentTerm) {
        this.currentTerm = peer.currentTerm
        this.role = 'Follower'
        this.votedFor = null
        return { committed: false, reason: `发现更高任期 Term=${peer.currentTerm}，旧主 ${this.id} 自动退位！` }
      }
    }

    if (reachable.length < quorum) {
      return {
        committed: false,
        acks: reachable.length,
        reason: `仅连通 ${reachable.length}/${this.cluster.nodes.length} 台 (< 多数派 ${quorum} 台)，拒绝提交防脑裂！`
      }
    }

    const entry = { term: this.currentTerm, cmd }
    reachable.forEach(n => n.log.push(entry))
    return { committed: true, acks: reachable.length, entry }
  }
}

export class RaftCluster {
  constructor(nodeConfigs) {
    this.partitionGroups = null
    this.nodes = nodeConfigs.map(cfg => new RaftNode(cfg.id, this, cfg.log))
  }
  getNode(id) { return this.nodes.find(n => n.id === id) }
  getReachablePeers(fromId) {
    return this.nodes.filter(n => n.id !== fromId && this.canCommunicate(fromId, n.id))
  }
  canCommunicate(a, b) {
    if (!this.partitionGroups) return true
    const gA = this.partitionGroups.find(g => g.includes(a))
    const gB = this.partitionGroups.find(g => g.includes(b))
    return gA === gB
  }
}

// ================= 4 阶段全链路演练 =================
// 初始状态：A 为第 1 任期 Leader，且日志 #2 已同步到 {A, B, C} 多数派；而 D、E 仅同步到日志 #1
const committedLog = [{ term: 1, cmd: '转入100' }, { term: 1, cmd: '扣减20' }]
const laggingLog   = [{ term: 1, cmd: '转入100' }]

const cluster = new RaftCluster([
  { id: 'A', log: committedLog },
  { id: 'B', log: committedLog },
  { id: 'C', log: committedLog },
  { id: 'D', log: laggingLog },
  { id: 'E', log: laggingLog }
])
cluster.getNode('A').role = 'Leader'

console.log('=== 阶段 1：光缆被挖断！集群裂为少数派 [A, B] 与多数派 [C, D, E] ===')
cluster.partitionGroups = [['A', 'B'], ['C', 'D', 'E']]

const oldLeaderWrite = cluster.getNode('A').tryReplicateCommand('孤岛非法扣款50')
console.log('旧主 A 在 [A,B] 孤岛尝试写入 ->', oldLeaderWrite)
assert.equal(oldLeaderWrite.committed, false)

console.log('\n=== 阶段 2：多数派分区中，日志落后的节点 D 抢先发起选举 ===')
const dElection = cluster.getNode('D').startElection()
console.log('落后节点 D 选举结果 (被 C 凭 §5.4.1 日志新旧度检查拦截!) ->', dElection)
assert.equal(dElection.elected, false)

console.log('\n=== 阶段 3：多数派分区中，拥有完整已提交日志的节点 C 发起选举并写入 ===')
const cElection = cluster.getNode('C').startElection()
console.log('完整日志节点 C 选举结果 ->', cElection)
assert.equal(cElection.elected, true)

const newLeaderWrite = cluster.getNode('C').tryReplicateCommand('多数派合法扣款30')
console.log('新主 C 在 [C,D,E] 阵营提交写入 ->', newLeaderWrite)
assert.equal(newLeaderWrite.committed, true)

console.log('\n=== 阶段 4：光缆修复，网络分区消失，旧主 A 遇到高任期自动退位 ===')
cluster.partitionGroups = null
const afterHeal = cluster.getNode('A').tryReplicateCommand('旧主试图再次发号施令')
console.log('网络恢复后旧主 A 尝试写入 ->', afterHeal)
assert.equal(cluster.getNode('A').role, 'Follower')
```

---

## 3. 破坏性实验：如果去掉日志新旧度检查，会发生什么？

请亲手做一个破坏性实验：把选举判断中的 \`&& this.isLogUpToDate(candLastTerm, candLastIndex)\` 去掉，再运行本实验。

在当前拓扑与调用顺序下，日志较旧的节点 D 可能获得多数票并短暂当选。这说明**仅有多数派计票而没有日志新旧度约束，并不足以保证选举安全**。

**重要的验证边界：** 当前模拟器实现了投票、日志新旧度校验、多数派判断和高任期退位，但没有实现完整的 \`AppendEntries\` 日志匹配与冲突后缀替换。因此，移除检查后，本脚本能验证“落后候选人可能当选”，**不能直接复现“已提交日志被删除”**。后者还需要额外实现日志冲突修复模型；本实验不把没有被代码实现的结果当成实测输出。

## 4. 思考题

1. **为什么在阶段 2 中，节点 `D` 发起选举失败后，节点 `C` 随后发起选举时，必须把任期号再加 1（升到 `Term = 3`），而不能继续沿用 `D` 刚才用过的 `Term = 2`？**

<details>
<summary>💡 点击展开本实验思考题参考答案</summary>

因为 Raft 的第一条投票铁律是 **“每个节点在同一个任期（Term）内最多只能投出一张选票（先到先得）”**。在阶段 2 的 `Term = 2` 中，节点 `D` 已经把 `Term = 2` 的选票投给了自己，节点 `E` 也把 `Term = 2` 的选票投给了 `D`。如果节点 `C` 不递增任期号、继续在 `Term = 2` 拉票，`D` 和 `E` 因为在 `Term = 2` 已经没有选票了，只能拒绝 `C`。只有当 `C` 超时将任期推进到全新的 `Term = 3` 时，`D` 和 `E` 的投票箱才会重置，从而全票支持日志最新的 `C` 当选！

</details>

> 🔙 **返回教程**：[第 16 讲：数据落盘与分布式：B+ 树、事务、Redis 与 Raft](../01-教程/第16讲-数据落盘与分布式B+树索引事务Redis与Raft.md) ｜ 👉 **返回实验总览**：[03 实验 · 动手验证靶场](./index.md)
