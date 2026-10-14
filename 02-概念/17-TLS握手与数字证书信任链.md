---
title: 概念 17 · TLS 1.3 握手与数字证书信任链
---

# 概念 17｜TLS 1.3 握手与数字证书信任链（HTTPS 的秘密）

> **一句话人话定义**：HTTPS 要在全员监听的公共网络上安全通信，靠的是两招——**① 用“调色盘数学魔法（ECDHE 密钥交换）”让双方在不传输密码本的前提下，各自在本地调出完全相同的一把对称钥匙；② 用“权威公证处签发的身份证（CA 数字证书）”防止半路有人冒充银行跟你调色！**

## 1. 它被什么痛点逼出来的？

HTTP 是明文裸奔的。如果加密传输，会遇到三个连环死结：
1. **对称加密（加解密用同一把钥匙）** 速度极快，但如果把钥匙直接通过网线发给对方，半路的黑客路由器也能截获这把钥匙！
2. **那怎么在不把钥匙发到网上的前提下，让两边拥有同一把钥匙？**（逼出了 **ECDHE 临时密钥交换**）。
3. **万一黑客在半路假扮成银行，跟你的浏览器交换钥匙怎么办（中间人攻击）？**（逼出了 **CA 数字证书与私钥签名**）。

## 2. 慢放图解：TLS 1.3 是怎么用 1 个来回（1-RTT）搞定一切的？

### 机关一：怎么隔空凑出同一把秘密钥匙，却不在网上传输秘密？（调色盘直觉）
想象一种单向颜料魔法：**把两种颜料混在一起很容易，但外人看着混合后的颜料，绝对分离不出原来的私密颜料！**
1. 浏览器在本地偷偷选一种私密颜料 $a$（客户端临时私钥，绝不发上网），混上公开底色算出混合色 $A$（客户端临时公钥），发给服务器；
2. 服务器也在本地偷偷选一种私密颜料 $b$（服务器临时私钥，绝不发上网），混上公开底色算出混合色 $B$（服务器临时公钥），发给浏览器；
3. **见证奇迹**：浏览器拿自己的私密颜料 $a + B$，服务器拿自己的私密颜料 $b + A$，两边在各自本地调出了**分毫不差的终极混合色 $S = a + b + 	ext{底色}$**！半路的黑客只看到了公开的 $A$ 和 $B$，干瞪眼算不出 $S$！

### 机关二：怎么证明对面的服务器真的是银行，不是黑客假扮的？
服务器必须出示一张由权威公证处（**CA 证书机构**）用 CA 私钥盖了钢印的 **数字证书**（里面印着：“`bank.com` 的官方公钥是 $K_{pub}$”），并且当场用服务器自己的证书私钥 $K_{priv}$ 对刚才的握手聊天记录签个名（`CertificateVerify`）！
- 浏览器用电脑出厂内置的 **CA 根证书公钥** 验一下钢印，确认证书是真的、域名也是 `bank.com`；
- 再用证书里的 `bank.com` 公钥 $K_{pub}$ 验一下服务器的当场签名——只有真银行才握有对应的私钥 $K_{priv}$，黑客伪造不出签名，当场露馅！

```text
浏览器 (Client)                                              服务器 (Server)
   │                                                            │
   ├─ 1. ClientHello：带上我的临时公钥 A ──────────────────────►│
   │                                                            │  服务器用 (自己临时私钥 b + A) 算出共享密钥 S！
   │  2. ServerHello：带上服务器临时公钥 B                      │
   │     + 数字证书 (Certificate)                               │
   │     + 私钥当场签名 (CertificateVerify)                     │
   │◄───────────────────────────────────────────────────────────┤
   │  浏览器验明证书正身与签名，并用 (自己临时私钥 a + B)       │
   │  算出同一把共享密钥 S！此后所有 HTTP 报文全用 S 对称加密！ │
```

## 3. 15 行极简代码原型：用 Node 内置 `crypto` 亲手演示 ECDH 隔空算出相同密钥

```js
import crypto from 'node:crypto'

// 1. 浏览器和服务器各自在本地生成临时密钥对（私钥绝不出门！）
const client = crypto.createECDH('prime256v1'); client.generateKeys()
const server = crypto.createECDH('prime256v1'); server.generateKeys()

// 2. 双方只把【公钥】通过网络发给对方，各自在本地调用 computeSecret
const clientSharedKey = client.computeSecret(server.getPublicKey()).toString('hex')
const serverSharedKey = server.computeSecret(client.getPublicKey()).toString('hex')

console.log('浏览器本地算出的密钥:', clientSharedKey.slice(0, 32) + '...')
console.log('服务器本地算出的密钥:', serverSharedKey.slice(0, 32) + '...')
console.log('双方密钥是否 100% 相同:', clientSharedKey === serverSharedKey) // true！
```

## 4. 前后端架构双视角落地

| 维度 | 前端架构中的体现 | 后端与系统架构中的体现 |
| :--- | :--- | :--- |
| **安全与性能实践** | 开启 **HSTS**（`Strict-Transport-Security`）强制浏览器内部直接将 `http://` 升级为 `https://`，防止第一次明文请求被劫持；杜绝 HTTPS 页面加载 HTTP 子资源（混合内容） | 在 Nginx / CDN 边缘节点进行 **TLS 终止（TLS Termination）**，启用 TLS 1.3（将握手从 2-RTT 降为 1-RTT）与 OCSP Stapling |

---

> 🔙 **返回主线教程**：[第 14 讲：一次请求出门：DNS、TCP、TLS 与 HTTP 演进](../01-教程/第14讲-一次请求出门DNS-TCP-TLS与HTTP演进.md)  
> 🧪 **亲手验证本概念**：[实验 11：用 net/http 手造原始 TCP 与 304 缓存](../03-实验/实验11-用net与http手造TCP与304缓存.md)  
> 👉 **下一篇概念**：[概念 18｜ACID 事务、MVCC 与 WAL 预写日志](./18-ACID事务MVCC与WAL预写日志.md)
