---
title: 概念 17 · TLS 1.3 握手与数字证书信任链
---

# 概念 17｜TLS 1.3 握手与数字证书信任链（HTTPS 的秘密）

> **一句话人话定义**：HTTPS 要在公开网络上建立安全信道，核心靠三步机制——**① 用临时椭圆曲线密钥交换（ECDHE）让双方在不传输私钥的前提下协商出共享秘密；② 用 HKDF 密钥派生算法将共享秘密与握手上下文扩展为双向独立的对称加密流量密钥；③ 用 CA 数字证书链与对完整握手记录的私钥签名（`CertificateVerify`）粉碎中间人冒充！**

## 1. 它被什么痛点逼出来的？

明文 HTTP 在经过公共 Wi-Fi、运营商路由节点时，面临三大安全威胁：**窃听（内容被偷看）**、**篡改（响应被注入广告或恶意脚本）**、**冒充（黑客钓鱼服务器伪装成真银行）**。
要同时防住这三件事，必须解开三个环环相扣的密码学死结：
1. **对称加密钥匙怎么安全交接？**（AES-GCM 对称加解密极快，但如果把对称钥匙直接明文发到网上，窃听者也能拿到钥匙）；
2. **如何在不传输秘密的前提下，让双方算出同一个秘密，且保证“就算未来某天服务器证书私钥泄露，过去录下的加密流量也绝对解不开（前向安全）”？**
3. **如何证明对面跟我协商钥匙的真的是 `bank.com`，并且整个握手过程没有一个字节被中间人掉包？**

---

## 2. 第一层（直观模型）：用“单向调色盘 + 公证处钢印”建立直觉

我们先用一个零数学门槛的**单向调色盘模型**，建立对 **ECDHE（临时椭圆曲线迪菲-赫尔曼密钥交换）** 的第一直觉：
- 假设世界上有一条单向物理法则：**把两种颜料混在一起极其容易；但给任何人看混合后的颜料，绝对无法逆向拆出原来的私密颜料！**

```text
【公开参数】：全网公开一种底色 Y（对应的真实协议参数：椭圆曲线基点 G 与模数 p）

【第 1 步：双方各自生成“用完即焚的临时私钥”】
  - 浏览器本地随机生成临时私钥 a（私密红），混上公开底色算出临时公钥 A = a·G（橙色），发给服务器；
  - 服务器本地随机生成临时私钥 b（私密蓝），混上公开底色算出临时公钥 B = b·G（绿色），发给浏览器。

【第 2 步：双方各自把“对方的临时公钥”与“自己的临时私钥”结合】
  - 浏览器在本地计算：a · B = a · (b · G) = Z
  - 服务器在本地计算：b · A = b · (a · G) = Z
  ──► 双方从未在网上传输过 a 和 b，却在各自本地算出了完全相同的共享秘密 Z！
```

---

## 3. 第二层（真实协议机制）：从共享秘密 `Z` 到 TLS 1.3 真实握手全链路

建立直观模型后，作为架构师，我们必须把上面简化的“调色盘”还原为 **RFC 8446（TLS 1.3 规范）** 中的三项真实工程机制：

### 机制一：ECDHE 共享秘密 `Z` 并不直接当 AES 密钥用，而是经由 `HKDF` 派生出多把方向独立的钥匙！

在真实 TLS 1.3 中，ECDHE 算出来的原始共享秘密 `Z` 具有一定的数学结构，**绝不会直接拿去当 AES-GCM 的密钥**，而是送入 **HKDF（基于 HMAC 的提取与扩展密钥派生函数）**，结合截至当前的**握手消息摘要（Transcript Hash）**，按阶段派生出一整套各司其职的密钥树：

```text
ECDHE 原始共享秘密 Z  +  握手上下文摘要 Hash(ClientHello || ServerHello)
   │
   ▼  【HKDF-Extract & HKDF-Expand-Label 密钥派生流水线】
Handshake Secret（握手阶段主秘密）
   ├──► client_handshake_traffic_secret  （专门加密：客户端 ──► 服务端 的后续握手消息）
   └──► server_handshake_traffic_secret  （专门加密：服务端 ──► 客户端 的证书与签名消息！）
   │
   ▼  【再次结合完整握手摘要派生】
Master Secret（应用数据阶段主秘密）
   ├──► client_application_traffic_secret_0 ──► 派生出客户端发数据的 AES-GCM Key + IV
   └──► server_application_traffic_secret_0 ──► 派生出服务端回数据的 AES-GCM Key + IV
```
**注意这个精妙设计**：浏览器发给服务器的加密钥匙，和服务器回给浏览器的加密钥匙**根本不是同一把钥匙**！而且连服务器发过来的数字证书（`Certificate`）本身，在 TLS 1.3 里都是用握手密钥加密传输的，窃听者连你访问的具体子证书细节都看不到！

---

### 机制二：`CertificateVerify` 签名的不是单个公钥，而是整段握手记录的 Transcript Hash！

为了证明对面真的是 `bank.com` 且握手参数没被中间人篡改：
1. **证书信任链校验（Chain of Trust）**：
   服务器发来证书链：`Root CA（操作系统内置信任根） ──签名──► Intermediate CA（中间证书） ──签名──► bank.com 服务器证书（内含服务器长期公钥 K_pub）`。浏览器逐级向上验签，并核对域名（SAN 扩展）与有效期。
2. **`CertificateVerify` 全上下文防篡改签名**：
   服务器并不是只对自己的临时公钥 `B` 签名，而是对**从 `ClientHello` 开始到 `Certificate` 为止所有握手报文拼接后的哈希值（`Transcript-Hash`）**，用服务器证书的长期私钥 `K_priv` 进行数字签名！
   - 浏览器用证书里的 `K_pub` 验签通过后，同时证明了两件事：**① 对面确实握有 `bank.com` 的真私钥；② 从握手第一秒到现在，双方协商的加密套件、随机数、临时公钥 `A` 和 `B` 没有任何一个比特被中间人掉包或降级！**

---

### 机制三：什么才是真正的“前向安全（Forward Secrecy / PFS）”？

很多文章误以为“前向安全是因为每次刷新网页都换新钥匙”。**准确定义并非如此**：
- **前向安全的真实定义**：即使服务器的**长期证书私钥 `K_priv`** 在三年后被黑客窃取，黑客拿着这把长期私钥，也**无法解密今天抓包录制下来的历史加密流量**。
- **它是如何实现的？**
  因为服务器的长期私钥 `K_priv` **只用于握手时的身份签名（防冒充），根本不参与加密业务数据**！真正用来派生业务加密钥匙的是每次会话随机生成的 **ECDHE 临时私钥 `a` 和 `b`**。一旦握手完成派生出流量密钥后，浏览器和服务器会立即从内存中**彻底销毁临时私钥 `a` 和 `b`**（阅后即焚）。没有了 `a` 和 `b`，即便未来拿到 `K_priv`，面对当年录下的公开值 `A` 和 `B` 也无从反推会话密钥！

---

## 4. 第三层（边界与反例）：连接复用、会话恢复（PSK）与 `0-RTT` 的安全折中

| 机制场景 | 真实行为与安全边界（架构师必考权衡） |
| :--- | :--- |
| **HTTP Keep-Alive / HTTP/2 连接复用** | 浏览器刷新页面或连续发多个请求时，只要底层 TCP/TLS 连接未断开，会直接复用已协商好的对称流量密钥，**并不需要每次请求都重新做一次 ECDHE 握手**（TLS 1.3 也支持在长连接中途通过 `KeyUpdate` 消息单向滚动更新流量密钥）。 |
| **TLS 1.3 会话恢复（Session Resumption via PSK）与 `0-RTT` 边界** | 为了在连接断开重连时省去握手耗时，服务端会在首次连接后下发加密的 **NewSessionTicket（预共享密钥 PSK）**。<br>1. **`1-RTT PSK + ECDHE`**：重连时既用 PSK 免去证书验签，又依然夹带新的 ECDHE 交换——**保留完整前向安全**；<br>2. **`0-RTT Early Data` 的两大软肋**：客户端在第一个包里直接用 PSK 加密发送 HTTP 请求，此时尚未完成新的服务端 ECDHE 交换。因此 **`0-RTT` 数据首先不具备与完整握手同等的抗服务端 Ticket 密钥泄露前向安全性；其次极易遭受重放攻击（Replay Attack）**——攻击者把截获的 `0-RTT` 密文包原样重发一遍，若服务端未做一次性随机数（Anti-Replay Nonce）去重，非幂等接口就会被重复执行！ |

---

## 5. 可独立运行代码：用 Node `crypto` 完整复刻“ECDHE 协商 + HKDF 派生 + Transcript 签名验证”

```js
// tls13-core-crypto.mjs —— 直接用 node 运行，验证 ECDHE + HKDF 派生双向独立密钥 + 握手上下文签名
import crypto from 'node:crypto'

// 1. 模拟服务端长期证书密钥对（RSA/ECDSA，仅用于对握手记录签名，绝不直接加密业务数据）
const { publicKey: serverCertPubKey, privateKey: serverCertPrivKey } =
  crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })

// 2. 双方生成本次会话的临时 ECDH 密钥对（用完即焚，保障前向安全）
const clientEphemeral = crypto.createECDH('prime256v1')
const clientPubA = clientEphemeral.generateKeys()

const serverEphemeral = crypto.createECDH('prime256v1')
const serverPubB = serverEphemeral.generateKeys()

// 3. 双方各自在本地算出相同的原始共享秘密 Z
const clientZ = clientEphemeral.computeSecret(serverPubB)
const serverZ = serverEphemeral.computeSecret(clientPubA)

// 4. 计算完整握手上下文摘要 Transcript-Hash = SHA256(ClientHello_A || ServerHello_B)
const transcriptHash = crypto.createHash('sha256').update(clientPubA).update(serverPubB).digest()

// 5. 服务端用长期证书私钥对【完整握手摘要 transcriptHash】生成 CertificateVerify 签名
const signature = crypto.sign('sha256', transcriptHash, serverCertPrivKey)
const isVerified = crypto.verify('sha256', transcriptHash, serverCertPubKey, signature)

// 6. 使用 HKDF 从共享秘密 Z 和握手摘要中派生出【客户端发送密钥】与【服务端发送密钥】
const clientWriteKey = Buffer.from(crypto.hkdfSync('sha256', clientZ, transcriptHash, 'tls13 c ap traffic', 16))
const serverWriteKey = Buffer.from(crypto.hkdfSync('sha256', serverZ, transcriptHash, 'tls13 s ap traffic', 16))

console.log('1. ECDHE 共享秘密 Z 是否一致:', clientZ.equals(serverZ)) // true
console.log('2. 握手上下文 CertificateVerify 验签结果:', isVerified)   // true
console.log('3. HKDF 派生的客户端写密钥:', clientWriteKey.toString('hex'))
console.log('4. HKDF 派生的服务端写密钥:', serverWriteKey.toString('hex'), '(双向密钥彼此独立！)')
```

> 🔙 **返回主线教程**：[第 14 讲：一次请求出门：DNS、TCP、TLS 与 HTTP 演进](../01-教程/第14讲-一次请求出门DNS-TCP-TLS与HTTP演进.md)  
> 🧪 **亲手验证本概念**：[实验 11：用 net/http 手造原始 TCP 与 304 缓存](../03-实验/实验11-用net与http手造TCP与304缓存.md)  
> 👉 **下一篇概念**：[概念 18｜ACID 事务、MVCC 与 WAL 预写日志](./18-ACID事务MVCC与WAL预写日志.md)
