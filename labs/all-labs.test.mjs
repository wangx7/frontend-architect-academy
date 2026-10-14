/**
 * labs/all-labs.test.mjs
 * 前端架构师学院 · 核心数据结构、框架内核与分布式机制自动化断言测试套件
 * 运行方式：node --test labs/all-labs.test.mjs （或 pnpm test:labs）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

// ============================================================================
// 1. 概念 03 & 09 & 实验 08：手写双向链表 + 哈希表 O(1) LRU 缓存淘汰算法
// ============================================================================
class HandMadeLRU {
  constructor(capacity = 2) {
    this.cap = capacity
    this.map = new Map()
    this.head = { prev: null, next: null }
    this.tail = { prev: null, next: null }
    this.head.next = this.tail
    this.tail.prev = this.head
  }
  _remove(node) {
    node.prev.next = node.next
    node.next.prev = node.prev
  }
  _appendToNewest(node) {
    const last = this.tail.prev
    last.next = node
    node.prev = last
    node.next = this.tail
    this.tail.prev = node
  }
  get(key) {
    if (!this.map.has(key)) return undefined
    const node = this.map.get(key)
    this._remove(node)
    this._appendToNewest(node)
    return node.val
  }
  set(key, val) {
    if (this.map.has(key)) {
      const node = this.map.get(key)
      node.val = val
      this._remove(node)
      this._appendToNewest(node)
      return
    }
    if (this.map.size >= this.cap) {
      const oldest = this.head.next
      this._remove(oldest)
      this.map.delete(oldest.key)
    }
    const newNode = { key, val, prev: null, next: null }
    this._appendToNewest(newNode)
    this.map.set(key, newNode)
  }
}

test('概念09 & 实验08：LRU 缓存应正确提鲜热数据并淘汰最久未访问数据', () => {
  const lru = new HandMadeLRU(2)
  lru.set('Home', '首页')
  lru.set('List', '列表')
  assert.equal(lru.get('Home'), '首页') // 访问 Home 使其变为最新，List 变为最老
  lru.set('Detail', '详情')             // 超出容量 2，应淘汰 List
  assert.equal(lru.get('List'), undefined)
  assert.equal(lru.get('Home'), '首页')
  assert.equal(lru.get('Detail'), '详情')
})

// ============================================================================
// 2. 概念 05：手写带拉链法冲突解决的哈希表 MiniHashMap
// ============================================================================
class MiniHashMap {
  constructor(size = 8) {
    this.buckets = new Array(size).fill(null)
  }
  _hash(key) {
    let sum = 0
    for (const ch of String(key)) sum += ch.charCodeAt(0)
    return sum % this.buckets.length
  }
  set(key, val) {
    const idx = this._hash(key)
    for (let cur = this.buckets[idx]; cur !== null; cur = cur.next) {
      if (cur.key === key) { cur.val = val; return }
    }
    this.buckets[idx] = { key, val, next: this.buckets[idx] }
  }
  get(key) {
    for (let cur = this.buckets[this._hash(key)]; cur !== null; cur = cur.next) {
      if (cur.key === key) return cur.val
    }
    return undefined
  }
}

test('概念05：哈希表拉链法应正确处理同桶哈希冲突与原地更新', () => {
  const map = new MiniHashMap(8)
  // 'apple' (530 % 8 = 2) 与 'b' (98 % 8 = 2) 故意同桶冲突
  map.set('apple', 5)
  map.set('b', 99)
  map.set('apple', 12)
  assert.equal(map._hash('apple'), 2)
  assert.equal(map._hash('b'), 2)
  assert.equal(map.get('apple'), 12)
  assert.equal(map.get('b'), 99)
})

// ============================================================================
// 3. 概念 07：左倾红黑树（LLRB）插入、旋转与黑高平衡不变量验证
// ============================================================================
const RED = true, BLACK = false
const isRed = n => Boolean(n && n.color === RED)
function rotateLeft(h) {
  const x = h.right; h.right = x.left; x.left = h
  x.color = h.color; h.color = RED; return x
}
function rotateRight(h) {
  const x = h.left; h.left = x.right; x.right = h
  x.color = h.color; h.color = RED; return x
}
function flipColors(h) {
  h.color = RED; h.left.color = BLACK; h.right.color = BLACK
}
function insertLLRB(h, val) {
  if (!h) return { val, left: null, right: null, color: RED }
  if (val < h.val) h.left = insertLLRB(h.left, val)
  else if (val > h.val) h.right = insertLLRB(h.right, val)
  if (isRed(h.right) && !isRed(h.left)) h = rotateLeft(h)
  if (isRed(h.left) && isRed(h.left.left)) h = rotateRight(h)
  if (isRed(h.left) && isRed(h.right)) flipColors(h)
  return h
}
function countBlackHeight(node) {
  if (!node) return 1
  const leftBH = countBlackHeight(node.left)
  const rightBH = countBlackHeight(node.right)
  assert.equal(leftBH, rightBH, '红黑树任意节点左右子树黑高必须严格相等')
  return leftBH + (node.color === BLACK ? 1 : 0)
}

test('概念06 & 07：递增插入 1~100 时红黑树不退化为链表且严格满足黑高相等不变量', () => {
  let root = null
  for (let i = 1; i <= 100; i++) {
    root = insertLLRB(root, i)
    root.color = BLACK
  }
  const bh = countBlackHeight(root)
  assert.ok(bh >= 4 && bh <= 10, `黑高应在合理对数范围内，实际为 ${bh}`)
})

// ============================================================================
// 4. 概念 10 & 第 07 讲 & 实验 06：Vue 3 快速 Diff 最长递增子序列 getSequence
// ============================================================================
function getSequence(arr) {
  const p = arr.slice()
  const result = [0]
  const len = arr.length
  for (let i = 0; i < len; i++) {
    const arrI = arr[i]
    if (arrI === 0) continue
    const j = result[result.length - 1]
    if (arr[j] < arrI) {
      p[i] = j
      result.push(i)
      continue
    }
    let u = 0, v = result.length - 1
    while (u < v) {
      const c = (u + v) >> 1
      if (arr[result[c]] < arrI) u = c + 1
      else v = c
    }
    if (arrI < arr[result[u]]) {
      if (u > 0) p[i] = result[u - 1]
      result[u] = i
    }
  }
  let u = result.length
  let v = result[u - 1]
  while (u-- > 0) {
    result[u] = v
    v = p[v]
  }
  return result
}

test('概念10 & 实验06：Vue 3 getSequence 应通过前驱指针数组 p 正确回溯防篡改', () => {
  // 经典陷阱输入 [2, 6, 3, 4, 1, 5]：末尾的 1 会替换槽位 0，但依靠前驱纸条 p 仍应还原出 [2, 3, 4, 5] 的下标 [0, 2, 3, 5]
  const input = [2, 6, 3, 4, 1, 5]
  const indices = getSequence(input)
  assert.deepEqual(indices, [0, 2, 3, 5])
  assert.deepEqual(indices.map(i => input[i]), [2, 3, 4, 5])
})

// ============================================================================
// 5. 概念 12 & 实验 05：Vue 3 响应式分支切换依赖清理（cleanup）
// ============================================================================
test('概念12 & 实验05：响应式系统在三元分支切换后应彻底清理遗留依赖，杜绝无效重跑', () => {
  const targetMap = new WeakMap()
  let activeEffect = null

  function cleanup(effectFn) {
    for (const dep of effectFn.deps) dep.delete(effectFn)
    effectFn.deps.length = 0
  }

  function effect(fn) {
    const effectFn = () => {
      cleanup(effectFn)
      activeEffect = effectFn
      fn()
      activeEffect = null
    }
    effectFn.deps = []
    effectFn()
  }

  function reactive(obj) {
    return new Proxy(obj, {
      get(target, key) {
        if (activeEffect) {
          let depsMap = targetMap.get(target)
          if (!depsMap) targetMap.set(target, (depsMap = new Map()))
          let dep = depsMap.get(key)
          if (!dep) depsMap.set(key, (dep = new Set()))
          dep.add(activeEffect)
          activeEffect.deps.push(dep)
        }
        return target[key]
      },
      set(target, key, val) {
        target[key] = val
        const dep = targetMap.get(target)?.get(key)
        if (dep) [...dep].forEach(fn => fn())
        return true
      }
    })
  }

  const state = reactive({ showDetail: true, detailText: '初始详情' })
  let runCount = 0
  let rendered = ''
  effect(() => {
    runCount++
    rendered = state.showDetail ? state.detailText : '已隐藏'
  })
  assert.equal(runCount, 1)
  assert.equal(rendered, '初始详情')

  state.showDetail = false // 切换分支，此时不再读取 detailText
  assert.equal(runCount, 2)
  assert.equal(rendered, '已隐藏')

  state.detailText = '修改不再显示的详情' // 因为已 cleanup，此次修改绝不应触发 effect 重跑！
  assert.equal(runCount, 2)
})

// ============================================================================
// 6. 第 12 讲 & 实验 09：微前端 ProxySandbox 多实例隔离验证
// ============================================================================
class ProxySandbox {
  constructor(globalContext = {}) {
    const fakeWindow = Object.create(null)
    this.active = true
    this.proxy = new Proxy(fakeWindow, {
      get: (target, key) => (key in target ? target[key] : globalContext[key]),
      set: (target, key, value) => {
        if (this.active) target[key] = value
        return true
      }
    })
  }
}

test('第12讲 & 实验09：微前端 Proxy 沙箱应保证多子应用并发读写同名全局变量互不污染', () => {
  const hostGlobal = { appName: 'HostShell' }
  const appA = new ProxySandbox(hostGlobal)
  const appB = new ProxySandbox(hostGlobal)

  appA.proxy.theme = 'dark'
  appB.proxy.theme = 'light'

  assert.equal(appA.proxy.theme, 'dark')
  assert.equal(appB.proxy.theme, 'light')
  assert.equal(hostGlobal.theme, undefined)
  assert.equal(appA.proxy.appName, 'HostShell')
})

// ============================================================================
// 7. 概念 17：TLS 1.3 ECDHE + HKDF 双向流量密钥派生与握手摘要签名
// ============================================================================
test('概念17：ECDHE + HKDF 应派生一致共享秘密与独立双向流量密钥并通过签名校验', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const client = crypto.createECDH('prime256v1')
  const pubA = client.generateKeys()
  const server = crypto.createECDH('prime256v1')
  const pubB = server.generateKeys()

  const secretClient = client.computeSecret(pubB)
  const secretServer = server.computeSecret(pubA)
  assert.ok(secretClient.equals(secretServer))

  const transcriptHash = crypto.createHash('sha256').update(pubA).update(pubB).digest()
  const sig = crypto.sign('sha256', transcriptHash, privateKey)
  assert.equal(crypto.verify('sha256', transcriptHash, publicKey, sig), true)

  const cKey = Buffer.from(crypto.hkdfSync('sha256', secretClient, transcriptHash, 'c_ap', 16))
  const sKey = Buffer.from(crypto.hkdfSync('sha256', secretServer, transcriptHash, 's_ap', 16))
  assert.equal(cKey.length, 16)
  assert.equal(cKey.equals(sKey), false, '客户端与服务端两个方向的流量密钥必须彼此独立')
})

// ============================================================================
// 8. 概念 20 & 实验 14：Raft 选主（含 §5.4.1 日志新旧度检查）与网络分区防脑裂
// ============================================================================
import { RaftCluster } from '../03-实验/raft-helper.mjs'

test('概念20 & 实验14：Raft 在 2 vs 3 网络分区下应阻止少数派写入且拒绝日志落后节点当选', () => {
  const fullLog = [{ term: 1, cmd: 'A+100' }, { term: 1, cmd: 'B-20' }]
  const staleLog = [{ term: 1, cmd: 'A+100' }]
  const cluster = new RaftCluster([
    { id: 'A', log: fullLog },
    { id: 'B', log: fullLog },
    { id: 'C', log: fullLog },
    { id: 'D', log: staleLog },
    { id: 'E', log: staleLog }
  ])
  cluster.getNode('A').role = 'Leader'
  cluster.partitionGroups = [['A', 'B'], ['C', 'D', 'E']]

  // 1. 少数派旧主 A 无法提交写入
  assert.equal(cluster.getNode('A').tryReplicateCommand('bad').committed, false)
  // 2. 多数派中日志落后的 D 无法通过 C 的 §5.4.1 日志新旧度检查
  assert.equal(cluster.getNode('D').startElection().elected, false)
  // 3. 多数派中日志完整的 C 成功当选并提交写入
  const cRes = cluster.getNode('C').startElection()
  assert.equal(cRes.elected, true)
  assert.equal(cluster.getNode('C').tryReplicateCommand('ok').committed, true)
  // 4. 分区恢复后，旧主 A 遇到高任期自动退回 Follower
  cluster.partitionGroups = null
  cluster.getNode('A').tryReplicateCommand('stale_try')
  assert.equal(cluster.getNode('A').role, 'Follower')
})
