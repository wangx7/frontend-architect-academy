---
title: 实验 14 · 手写 Raft 选主与网络分区防脑裂模拟
---

# 实验 14｜手写 Raft 选主与网络分区防脑裂模拟

> 📖 **关联教程**：[第 16 讲：数据落盘与分布式：B+ 树、事务、Redis 与 Raft](../01-教程/第16讲-数据落盘与分布式B+树索引事务Redis与Raft.md)  
> 🔍 **关联概念**：[概念 20：CAP 定理与 Raft 多数派共识](../02-概念/20-CAP定理与Raft多数派共识.md)

## 1. 实验目标

1. 用纯 Node.js 代码模拟一个由 5 个节点构成的分布式集群（A、B、C、D、E）；
2. 亲手实现基于**任期号（Term）**与**严格多数派（Quorum = 3 票）**的 Raft 核心选主机制；
3. 模拟网络分区：把集群劈成 `[A, B]`（2 台孤岛）与 `[C, D, E]`（3 台阵营），亲眼见证多数派如何选出新 Leader，而少数派孤岛因凑不齐 3 票彻底杜绝“脑裂（Split-Brain）”！

## 2. 复制即跑代码

新建 `lab14-raft-split-brain.mjs`，运行 `node lab14-raft-split-brain.mjs`：

```js
// lab14-raft-split-brain.mjs —— 60 行模拟 5 节点 Raft 选主、网络分区与防脑裂
class RaftNode {
  constructor(id, cluster) {
    this.id = id
    this.cluster = cluster
    this.role = 'Follower' // 'Follower' | 'Candidate' | 'Leader'
    this.term = 0
    this.votedFor = null
  }

  // 发起选举拉票
  startElection() {
    this.role = 'Candidate'
    this.term += 1
    this.votedFor = this.id
    let votes = 1 // 投给自己 1 票

    // 向可通信的其他节点请求投票
    for (const peer of this.cluster.getReachablePeers(this.id)) {
      if (peer.requestVote(this.term, this.id)) {
        votes++
      }
    }

    const quorum = Math.floor(this.cluster.nodes.length / 2) + 1 // 5 台中的严格过半 = 3 票
    if (votes >= quorum) {
      this.role = 'Leader'
      return { success: true, term: this.term, votes, leader: this.id }
    } else {
      this.role = 'Follower'
      return { success: false, term: this.term, votes, leader: null }
    }
  }

  // 接收拉票请求
  requestVote(candidateTerm, candidateId) {
    if (candidateTerm > this.term) {
      this.term = candidateTerm
      this.role = 'Follower'
      this.votedFor = candidateId
      return true
    }
    if (candidateTerm === this.term && (this.votedFor === null || this.votedFor === candidateId)) {
      this.votedFor = candidateId
      return true
    }
    return false // 任期过旧或本任期已投给他人，拒投！
  }
}

// 模拟网络拓扑与分区断网
class NetworkCluster {
  constructor(names) {
    this.nodes = names.map(id => new RaftNode(id, this))
    this.partition = null // 分区配置，例如 [['A', 'B'], ['C', 'D', 'E']]
  }

  getReachablePeers(fromId) {
    return this.nodes.filter(n => n.id !== fromId && this.canCommunicate(fromId, n.id))
  }

  canCommunicate(a, b) {
    if (!this.partition) return true
    // 若存在网络分区，仅同组节点可互通
    const groupA = this.partition.find(g => g.includes(a))
    const groupB = this.partition.find(g => g.includes(b))
    return groupA === groupB
  }
}

// === 测试开始 ===
const cluster = new NetworkCluster(['A', 'B', 'C', 'D', 'E'])

console.log('--- 阶段 1：网络畅通时节点 A 发起选举 ---')
const res1 = cluster.nodes[0].startElection()
console.log(`节点 A 竞选结果: ${res1.success ? '👑 成功当选 Leader' : '❌ 失败'}, 获得 ${res1.votes} 票`)

console.log('\n--- 阶段 2：发生网络分区 [A, B] ⚡️ [C, D, E] ---')
cluster.partition = [['A', 'B'], ['C', 'D', 'E']]

console.log('👉 少数派孤岛（A, B）：节点 B 发起拉票')
const resB = cluster.nodes[1].startElection()
console.log(`节点 B 竞选结果: ${resB.success ? '👑 成功' : '❌ 失败 (凑不齐法定 3 票)'}, 获得 ${resB.votes} 票`)

console.log('\n👉 多数派阵营（C, D, E）：节点 C 发起拉票')
const resC = cluster.nodes[2].startElection()
console.log(`节点 C 竞选结果: ${resC.success ? '👑 成功当选新 Leader' : '❌ 失败'}, 获得 ${resC.votes} 票`)
```

## 3. 运行输出与慢放解析

在终端执行该脚本，输出如下：

```text
--- 阶段 1：网络畅通时节点 A 发起选举 ---
节点 A 竞选结果: 👑 成功当选 Leader, 获得 5 票

--- 阶段 2：发生网络分区 [A, B] ⚡️ [C, D, E] ---
👉 少数派孤岛（A, B）：节点 B 发起拉票
节点 B 竞选结果: ❌ 失败 (凑不齐法定 3 票), 获得 2 票

👉 多数派阵营（C, D, E）：节点 C 发起拉票
节点 C 竞选结果: 👑 成功当选新 Leader, 获得 3 票
```

### 慢放解析：

1. **法定过半数（Quorum）是唯一的数学真理**：5 台机器的严格过半数是 `Math.floor(5/2) + 1 = 3` 票。
2. **小孤岛无法产生 Leader**：在 `[A, B]` 孤岛中，即使所有能通气的节点全部投赞成票，上限也只有 2 票，永远无法达到 3 票门槛。因此小孤岛绝对无法选出新主，杜绝了“双主脑裂”；
3. **大孤岛保持可用性**：在 `[C, D, E]` 多数派阵营中，依然能拿到满额的 3 票，选举合法有效，系统继续对外提供强一致服务（保证了 CP）。

## 4. 思考题

1. **为什么在分布式生产集群中，Raft / ZooKeeper 节点数通常推荐奇数（如 3 台、5 台），而不是偶数（如 4 台、6 台）？**

<details>
<summary>💡 点击展开本实验思考题参考答案</summary>

因为从容错能力的角度来看，偶数节点不仅无法提升容错上限，反而平白浪费一台机器资源并增加选举平票（Split-Vote）风险：
- **3 台集群**：多数派需要 2 票，最多允许挂掉 `3 - 2 = 1` 台；
- **4 台集群**：多数派需要 3 票（`Math.floor(4/2)+1=3`），最多依然只能挂掉 `4 - 3 = 1` 台（若挂 2 台只剩 2 台凑不够 3 票）；
- **5 台集群**：多数派需要 3 票，允许挂掉 2 台；
- **6 台集群**：多数派需要 4 票，最多依然只能挂掉 2 台。

因此，4 台机器的容错能力与 3 台完全一样，6 台与 5 台一样。奇数节点既能以最少的机器换取最高容错度，又能避免偶数分区时两边恰好各占一半（例如 2:2）导致选举永久平票。

</details>

---

> 🔙 **返回教程**：[第 16 讲：数据落盘与分布式：B+ 树、事务、Redis 与 Raft](../01-教程/第16讲-数据落盘与分布式B+树索引事务Redis与Raft.md) ｜ 🧪 **返回实验总览**：[03 实验总览](./index.md)
