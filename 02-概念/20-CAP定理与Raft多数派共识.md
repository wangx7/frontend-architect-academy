---
title: 概念 20 · CAP 定理与 Raft 多数派共识
---

# 概念 20｜CAP 定理与 Raft 多数派共识

> **一句话人话定义**：
> - **CAP 定理**：当跨节点通信发生**网络分区（Partition Tolerance，P）**导致节点之间无法同步消息时，系统无法同时保证**线性一致性（Consistency，C：所有读操作都能读到最新已写入的值）**与**完美可用性（Availability，A：每个非故障节点都必须对读写请求返回非错误响应）**；
> - **Raft 共识算法**：通过**任期号（Term）+ 严格多数派交集（Quorum）+ 候选人日志新旧度检查（Log Up-to-Date Check）+ 当前任期日志提交约束**，确保在网络分区或节点宕机时，集群不会产生双主覆盖已提交数据的“脑裂（Split-Brain）”。

## 1. 它们被什么痛点逼出来的？

如果业务数据只存在 **1 台** 服务器上，主板损坏或机房断电就会导致服务彻底中断（单点故障 SPOF）。
为了高可用，工程上会将同一份数据复制到多台机器（如 5 节点集群）。但一旦引入多机复制，只要机房间的网线中断，把 5 台机器切成互相无法通信的两半——**左边孤岛 `[A, B]`（含原主库 A）** 与 **右边孤岛 `[C, D, E]`**：
1. 右边 3 台机器收不到原主库 A 的心跳，准备选出新主库 C 接收客户端写入；
2. 左边的原主库 A 若继续接收客户端写入，两边账本就会分叉冲突（**脑裂 Split-Brain**）；
3. 更凶险的是：**万一右边某个日志严重落后的节点当选了新主库，岂不是会把之前已经向用户承诺成功的写入记录覆盖弄丢？**

为了在理论上厘清分布式复制的边界，并在工程上安全地实现故障自动切换，诞生了 **CAP 定理** 与 **Raft / Paxos / ZAB 等共识协议**。

---

## 2. 第一层（直观模型）：多数派交集（Quorum）为什么能防双主？

先建立最核心的**抽屉原理（多数派交集直觉）**：
在一个拥有 `N = 5` 台机器的集群中，规定**严格过半数（Quorum）门槛为 `Math.floor(5 / 2) + 1 = 3` 票**。
- 无论网线怎么断，5 台机器**绝不可能同时分裂出两个都拥有 `>= 3` 台机器的阵营**；
- 任何两个包含至少 3 台机器的集合（例如上次确认写入的 `{A, B, C}` 与本次投票选新主的 `{C, D, E}`），**中间至少有 1 台重叠的见证人机器（`C`）**！

```text
          5 节点集群（总票数 N = 5，严格多数派门槛 Quorum = 3 票）

   【少数派分区：仅 A、B 两台】          ⚡️ 网络分区 P ⚡️        【多数派分区：C、D、E 三台】
  ┌──────────────────────────────┐                            ┌────────────────────────────────┐
  │ 原主库 A (Term = 1)          │                            │ C 发起 Term = 2 选举           │
  │ 从库 B                       │                            │ 拿到 C、D、E 共 3 票 (>= 3)    │
  └──────────────┬───────────────┘                            │ ──► C 当选 Term = 2 新主库！   │
                 ▼                                            └───────────────┬────────────────┘
   客户端向旧主 A 发起写入：                                                  ▼
   A 仅能拿到 {A, B} 2 个确认 (< 3)，                         客户端向新主 C 发起写入：
   无法推进 commitIndex，拒绝向客户端确认成功！               C 拿到 {C, D, E} 3 个确认 (>= 3)，
                                                              安全推进 commitIndex 并返回成功！
```

---

## 3. 第二层（真实协议机制）：为什么真实的 Raft 绝不只是一个“多数派计数器”？

如果只看上面的直观模型，很容易产生一个致命误解：*“是不是只要拿到 3 票就能当老大、只要写满 3 台就算实现了 Raft？”*
**绝对不是！** 在 Ongaro & Ousterhout 的 Raft 论文（*In Search of an Understandable Consensus Algorithm, §5*）中，一个能投入生产的 Raft 状态机必须满足以下 **四大安全机制**：

### 机制一：持久化状态先行（Persistent State on Stable Storage）
每个节点在回复任何 RPC 请求之前，必须将以下三个核心变量**强制刷入非易失磁盘（`fsync`）**：
1. **`currentTerm`**：节点已知的最新任期号（防止节点重启后忘记自己已经见过更高任期）；
2. **`votedFor`**：当前任期内把选票投给了谁（防止节点在同任期内重启后“一女二嫁”投出两张票，破坏每任期单 Leader 铁律！）；
3. **`log[]`**：包含 `(term, index, command)` 的预写日志条目数组。

### 机制二：选举限制——日志新旧度检查（Log Up-to-Date Check，论文 §5.4.1）
请思考一个尖锐问题：
在上面的 `[C, D, E]` 多数派分区里，假设一条已提交的日志当时同步到了 `{A, B, C}` 三台机器（凑够 3 台已提交），而 **`D` 和 `E` 当时网络慢，还没有收到这条日志**！
现在网线断了，`[C, D, E]` 在一起。如果落后的 `D` 先发起选举，`C` 和 `E` 能不能无脑给 `D` 投票？
**绝对不能！如果让落后的 `D` 当选新 Leader，`D` 就会用自己的残缺日志覆盖掉 `C` 身上的已提交记录，造成数据丢失！**

因此 Raft 规定：**投票者在收到 `RequestVote` 时，必须比对候选人最后一条日志（`lastLogTerm, lastLogIndex`）是否至少和自己一样新**：
1. 先比最后一条日志的**任期号 `lastLogTerm`**：任期号大的更新；
2. 若任期号相同，再比**日志长度 `lastLogIndex`**：日志更长的更新。
- 当落后的 `D` 向握有最新已提交日志的 `C` 拉票时，**`C` 发现 `D` 的日志比自己旧，当场投反对票**！`D` 只能拿到 `D` 和 `E` 两票（`< 3`），落选！
- 而当握有最新日志的 `C` 发起选举时，`C`、`D`、`E` 检查发现 `C` 的日志不比自己旧，全票通过！**这就从数学上保证了：当选的新 Leader 身上一定包含所有已提交的日志！**

### 机制三：日志复制与提交约束（Log Matching & Commit Rule，论文 §5.4.2）
1. **日志匹配与冲突修复（`AppendEntries` 一致性检查）**：Leader 发送日志时会附带前一条日志的 `(prevLogIndex, prevLogTerm)`，若 Follower 对不上则拒绝接收，Leader 会递减 `nextIndex` 找到双方的最后共同祖先，强制覆盖 Follower 上未提交的冲突分叉日志；
2. **仅直接提交当前任期的日志（图 8 安全约束）**：Leader 只有当**自己当前任期（`currentTerm`）**产生的新日志被复制到多数派节点后，才推进 `commitIndex`（并顺带间接提交此前旧任期遗留的日志），防止旧任期未提交完的日志在多次主从切换中被覆盖。

---

## 4. 第三层（边界与反例）：精准区分 CAP 边界与主流共识协议家族

| 常见概念混淆 | 架构师必须掌握的严格边界说明 |
| :--- | :--- |
| **误区 1：“CAP 就是随时在强一致（CP）和最终一致（AP）里二选一”** | **严格定义与 PACELC 扩展**：<br>1. 在 Gilbert & Lynch 对 CAP 的形式化证明中，**`C` 特指线性一致性（Linearizability）**，**`A` 特指每个非故障节点都必须返回非错误响应**，而这种二选一的强制冲突**仅在发生网络分区（`P`）时触发**；<br>2. 在没有发生网络分区的正常运行时（99.99% 的时间），系统并非没有权衡——此时面临的是 **PACELC 定理**中的 **`E (Else) -> L (Latency 延迟) vs C (Consistency 一致性)`**：即为了保证强一致（等待多数派节点跨机房网络往返确认），就必须付出更高的写入延迟！ |
| **误区 2：“ZooKeeper、etcd、Kafka 全都用的是 Raft 协议”** | **严格协议区分**：<br>虽然它们都使用了“多数派 Quorum + 领导者复制”的核心思想，但底层协议并不相同：<br>- **使用 Raft 的系统**：**etcd**（Kubernetes 控制面存储）、**Consul**、**TiKV / TiDB**、**CockroachDB**、**Kafka KRaft**（Kafka 3.x+ 替代 ZooKeeper 的内置共识引擎）；<br>- **使用 ZAB（ZooKeeper Atomic Broadcast）协议的系统**：**Apache ZooKeeper**（ZAB 诞生早于 Raft，采用 `epoch + counter` 事务 ID `zxid` 而非 Raft 的独立 `Term + Index`）；<br>- **使用 Paxos / Multi-Paxos 的系统**：Google **Chubby**、**Spanner**、**OceanBase**。 |
| **误区 3：“只要过了 Raft 多数派，客户端读任何节点都能读到最新值”** | **Follower 滞后读边界（Read Index / Lease Read）**：<br>写入只需 3/5 节点确认即返回成功，意味着剩下 2 台 Follower 此时可能还没收到最新数据！如果客户端直接连那 2 台慢 Follower 读数据，就会读到旧值（破坏线性一致性）。在 Raft 中，要实现**线性一致读（Linearizable Read）**，必须走 Leader 确认自己仍是合法主库（**ReadIndex 机制**或基于时钟租约的 **LeaseRead**）后才能返回数据。 |

---

## 5. 可独立运行代码：带“日志新旧度检查（§5.4.1）”的 5 节点 Raft 选主与防脑裂验证

```js
// raft-safety-sim.mjs —— 直接用 node 运行，验证：(1) 2 vs 3 分区防脑裂 (2) 落后节点因日志不够新被拒投！
export class SafeRaftNode {
  constructor(id, log = []) {
    this.id = id
    this.currentTerm = 1
    this.votedFor = null
    this.role = 'Follower'
    this.log = log // 数组元素格式: { term, cmd }
  }

  lastLogInfo() {
    if (this.log.length === 0) return { lastTerm: 0, lastIndex: 0 }
    return {
      lastTerm: this.log[this.log.length - 1].term,
      lastIndex: this.log.length
    }
  }

  // Raft 论文 §5.4.1 核心安全检查：判断候选人的日志是否至少和本节点一样新
  isCandidateLogUpToDate(candLastTerm, candLastIndex) {
    const { lastTerm, lastIndex } = this.lastLogInfo()
    if (candLastTerm !== lastTerm) return candLastTerm > lastTerm
    return candLastIndex >= lastIndex
  }

  onRequestVote(candId, candTerm, candLastTerm, candLastIndex) {
    if (candTerm > this.currentTerm) {
      this.currentTerm = candTerm
      this.role = 'Follower'
      this.votedFor = null
    }
    if (candTerm < this.currentTerm) return false
    const canVote = this.votedFor === null || this.votedFor === candId
    // 必须同时满足：【本任期尚未投给别人】且【候选人日志不比我旧】！
    if (canVote && this.isCandidateLogUpToDate(candLastTerm, candLastIndex)) {
      this.votedFor = candId
      return true
    }
    return false
  }
}

export function runElection(candidate, partitionPeers, totalClusterNodes = 5) {
  candidate.currentTerm += 1
  candidate.role = 'Candidate'
  candidate.votedFor = candidate.id
  let votes = 1
  const { lastTerm, lastIndex } = candidate.lastLogInfo()

  for (const peer of partitionPeers) {
    if (peer.id === candidate.id) continue
    if (peer.onRequestVote(candidate.id, candidate.currentTerm, lastTerm, lastIndex)) {
      votes++
    }
  }
  const quorum = Math.floor(totalClusterNodes / 2) + 1
  if (votes >= quorum) {
    candidate.role = 'Leader'
    return { elected: true, leader: candidate.id, term: candidate.currentTerm, votes }
  }
  candidate.role = 'Follower'
  return { elected: false, leader: null, term: candidate.currentTerm, votes }
}

// 场景复现：A、B、C 拥有已提交的最新日志 (term:1, index:2)，而 D、E 日志落后只有 (term:1, index:1)
const A = new SafeRaftNode('A', [{ term: 1, cmd: 'x=1' }, { term: 1, cmd: 'x=2' }])
const B = new SafeRaftNode('B', [{ term: 1, cmd: 'x=1' }, { term: 1, cmd: 'x=2' }])
const C = new SafeRaftNode('C', [{ term: 1, cmd: 'x=1' }, { term: 1, cmd: 'x=2' }])
const D = new SafeRaftNode('D', [{ term: 1, cmd: 'x=1' }]) // 落后节点！
const E = new SafeRaftNode('E', [{ term: 1, cmd: 'x=1' }]) // 落后节点！

// 网络分裂为 [A, B] (少数派) 与 [C, D, E] (多数派)：
console.log('1. 少数派分区 [A, B] 中 A 尝试选主:', runElection(A, [A, B], 5))
// 输出: elected: false (仅 2 票 < 3 票)

console.log('2. 多数派分区 [C, D, E] 中【日志落后的 D】抢先发起选主:', runElection(D, [C, D, E], 5))
// 输出: elected: false (C 发现 D 日志比自己旧拒投，D 仅拿到 D、E 共 2 票 < 3 票，成功阻止数据丢失！)

console.log('3. 多数派分区 [C, D, E] 中【握有完整日志的 C】发起选主:', runElection(C, [C, D, E], 5))
// 输出: elected: true, leader: 'C', votes: 3 (C、D、E 全票通过，安全接管集群！)
```

> 🔙 **返回主线教程**：[第 16 讲：数据落盘与分布式：B+ 树、事务、Redis 与 Raft](../01-教程/第16讲-数据落盘与分布式B+树索引事务Redis与Raft.md)  
> 🧪 **亲手验证本概念**：[实验 14：手写 Raft 选主与网络分区防脑裂模拟](../03-实验/实验14-手写Raft选主与网络分区模拟.md)  
> 👉 **返回概念总览**：[02 概念 · 零黑话具象图解词典](./index.md)
