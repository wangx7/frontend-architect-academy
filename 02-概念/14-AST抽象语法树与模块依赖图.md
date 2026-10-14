---
title: 概念 14 · AST 抽象语法树与模块依赖图
---

# 概念 14｜AST 抽象语法树与模块依赖图

> **一句话人话定义**：
> - **AST（抽象语法树）**：你写的代码在电脑眼里只是一串死板的字符串（`"const a = 1 + 2"`），编译器会先把它拆解成一棵**用普通 JS 对象拼成的树状积木**——从此 Babel、Vite、Vue 编译器、ESLint 就能像修改普通对象属性一样，自动检查和改写你的代码；
> - **模块依赖图（Module Graph）**：顺着每个文件顶部的 `import` 语句画出的**文件引用关系网**，它是按需热更新（HMR）、代码分包和 Tree Shaking（摇树删死代码）的唯一导航地图！

## 1. 它们被什么痛点逼出来的？

每天写前端代码时，有四件习以为常的事其实背后藏着同一个魔法：
1. 你写了浏览器根本不认识的 `.vue` 单文件组件、JSX 或 TypeScript 类型，为什么保存后自动变成了浏览器认识的纯 `.js`？
2. 团队规定生产环境严禁留下 `console.log(...)`，如果全项目有 800 个文件，怎么在打包时自动把所有 `console.log(foo(1, 2))` 干净利落地删掉？
3. **为什么不能用正则表达式（`code.replace(...)`）去改代码？**
   试想一下：如果代码里有一句字符串 `'请勿删除 console.log("你好")'`，或者括号里嵌套了三层函数调用 `console.log(a(b(c)))`，正则表达式根本分不清哪个是字符串里的普通文字、哪个是真正在调用的代码，一替换就会把整个项目改报错！
4. 你从 `lodash-es` 里只 `import { debounce } from 'lodash-es'`，为什么打包工具能精准地只把 `debounce` 留下来，把其余 300 个没用到的函数全部删掉（**Tree Shaking**）？

为了让程序**真正“看懂”代码的语法结构与文件之间的引用关系**，编译器科学家发明了 **AST（抽象语法树）** 与 **模块依赖图（Module Graph）**。

---

## 2. 逐帧慢放：一行代码是怎么经历“拆积木 ──► 改积木 ──► 拼回代码”的？

### 镜头一：编译器三部曲（词法切块 Tokenizer ──► 语法建树 Parser ──► 改造生成 Codegen）

我们拿最简单的一行代码 `"const a = 1 + 2"`，看编译器是怎么分三步把它改写成 `"var a = 1 * 2"` 的：

```text
【第 1 步：词法切块（Tokenizer / Lexer）—— 挨个字符扫描，切成有身份标签的“单词积木（Tokens）”】
  原始字符串 ： "const a = 1 + 2"
        │
        ▼
  单词积木流 ： [ 关键字:const ] ──► [ 标识符:a ] ──► [ 符号:= ] ──► [ 数字:1 ] ──► [ 符号:+ ] ──► [ 数字:2 ]

══════════════════════════════════════════════════════════════════════════════════

【第 2 步：语法建树（Parser）—— 按语法主从关系，把单词积木拼成一棵嵌套的 JS 对象树（AST）！】
  Program (整篇程序根节点)
    └── VariableDeclaration (变量声明语句，属性 kind: "const")
          └── VariableDeclarator (声明项)
                ├── id   : Identifier (变量名节点，属性 name: "a")
                └── init : BinaryExpression (二元运算表达式，属性 operator: "+")
                             ├── left  : Literal (字面量节点，属性 value: 1)
                             └── right : Literal (字面量节点，属性 value: 2)

══════════════════════════════════════════════════════════════════════════════════

【第 3 步：遍历改造与代码生成（Transform & Codegen）—— 直接改对象属性，再把树印回字符串！】
  你的插件只需顺着这棵树往下走（深度优先遍历）：
  1. 看到 VariableDeclaration 节点 ──► 把 node.kind 从 "const" 改成 "var"！
  2. 看到 BinaryExpression 节点   ──► 把 node.operator 从 "+" 改成 "*"！
  3. 调用生成器（Codegen）把改完的树重新拼回字符串 ──► 输出："var a = 1 * 2"！
```

看到没有？一旦代码变成了这棵由普通 `{ type, kind, operator, left, right }` 组成的 JS 对象树，**写编译插件就跟平时改一个普通嵌套 JSON 对象一样简单，再也不用写天书般的正则表达式了**！

---

### 镜头二：模块依赖图（Module Graph）与 Tree Shaking（摇树优化）的真相

看完了单个文件内部的 AST，再把视角拉高到整个项目的几百个文件。
当 Vite 或 Rollup 启动时，会从入口文件 `main.js` 出发，通过 AST 找出里面所有的 `import` 语句，顺藤摸瓜画出一张**模块依赖图**：

```text
                   ┌──(静态 import)──► Header.vue
                   │
  入口 main.js ────┼──(静态 import)──► math.js ──► 内部导出了两个函数：
                   │                               ├── ✅ export function add()      (被 main.js 实名点名使用了！)
                   │                               └── 🍂 export function unusedFn() (全图没有任何箭头指向它！)
                   │
                   └──(动态 import())─► OrderPage.vue (虚线箭头：打包时单独切成一个懒加载小文件 chunk！)
```

盯着这张图，前端工程化里最重要的两个问题瞬间迎刃而解：
1. **为什么 Tree Shaking（摇树删死代码）要求你必须写 ES Module（`import { add } from './math'`），而不能写 CommonJS（`const m = require(path)`）？**
   - 因为 ES Module 的 `import` 是**静态声明**（规定必须写在文件最顶层，不允许嵌在 `if` 里拼接变量名），打包工具不用运行代码，光扫一眼 AST 就能 100% 确定：“`main.js` 只拉住了 `math.js` 里的 `add`，根本没人碰 `unusedFn`！”——于是在最终打包产物里直接把枯黄的叶子 `unusedFn` 摇落删掉！
   - 而 CommonJS 的 `require(getDynamicName())` 是**动态执行**的，不到代码真正跑起来那一刻，鬼知道它要加载哪个模块、读哪个属性？打包工具不敢乱删，只能把整个文件全包进去！
2. **为什么修改了 `Header.vue`，Vite 的热更新（HMR）能在 10 毫秒内只刷新 `Header.vue` 而不刷新整页？**
   因为 Vite 内存里实时存着上面这张依赖图！当你保存 `Header.vue` 时，Vite 在图里一看：`Header.vue` 本身就是一个热更新边界，直接通过 WebSocket 通知浏览器重新请求 `Header.vue` 这一个模块即可，跟旁边的 `OrderPage.vue` 毫无关系！

---

## 3. 代码逐行带入走读：30 行手写迷你编译器（词法切块 + AST 转换 + 代码生成）

不用装任何第三方库，复制下面 30 行代码到终端运行，你就亲手写出了人生第一个把 `const` 转成 `var`、并把加法改成乘法的编译器：

```js
// 1. 词法切块（Tokenizer）：把代码字符串切成单词积木数组
function tokenize(code) {
  return code.trim().split(/\s+/) // 简化演示：按空格切分为 ['const', 'a', '=', '1', '+', '2']
}

// 2. 语法建树（Parser）：把积木数组拼成结构化的 AST 对象树
function parse(tokens) {
  return {
    type: 'VariableDeclaration',
    kind: tokens[0],          // 'const'
    id: { type: 'Identifier', name: tokens[1] }, // 'a'
    init: {
      type: 'BinaryExpression',
      operator: tokens[4],    // '+'
      left: { type: 'Literal', value: Number(tokens[3]) },  // 1
      right: { type: 'Literal', value: Number(tokens[5]) }  // 2
    }
  }
}

// 3. 插件转换（Transform）：像改普通 JS 对象一样修改 AST 节点属性！
function transform(ast) {
  if (ast.kind === 'const') ast.kind = 'var'            // 降级语法：const -> var
  if (ast.init.operator === '+') ast.init.operator = '*' // 改写运算：+ -> *
  return ast
}

// 4. 代码生成（Codegen）：把改好后的 AST 树重新印回代码字符串
function generate(ast) {
  return `${ast.kind} ${ast.id.name} = ${ast.init.left.value} ${ast.init.operator} ${ast.init.right.value};`
}

const source = 'const a = 1 + 2'
const ast = parse(tokenize(source))
console.log('生成的 AST 树:', JSON.stringify(ast))
console.log('编译转换后的新代码:', generate(transform(ast))) // 输出: var a = 1 * 2;
```

---

## 4. 前后端架构双视角落地

| 场景维度 | 前端架构中的核心体现 | 后端与系统架构中的核心体现 |
| :--- | :--- | :--- |
| **工程化与质量门禁** | 1. **自定义 ESLint 规则**：团队禁止在业务代码里直接调用 `localStorage.setItem`（要求统一走带过期时间的存储 SDK），只需写一个 10 行的 ESLint AST 规则，拦截 `MemberExpression (object.name === 'localStorage')` 自动标红报错；<br>2. **大版本平滑升级（Codemod）**：用 `jscodeshift` 批量扫描全项目 AST，把几百个页面里的旧组件 `<OldButton type="primary">` 自动改写为新语法，10 分钟干完人工一周的活；<br>3. **Vue 3 编译时优化**：Vue 3 模板编译器通过分析模板 AST，给动态节点打上 `PatchFlags` 靶向标记，Diff 时直接跳过 90% 的静态节点。 | 1. **SQL 解析与分库分表中间件（如 ShardingSphere）**：数据库收到一条 SQL 字符串后，第一步就是用词法/语法分析器生成 **SQL AST**，分析 `WHERE` 条件里的分片键并改写表名路由；<br>2. **网关动态规则引擎与 DSL 编译器**：将安全风控人员配置的规则表达式编译为内存 AST 高速求值。 |

> 🔙 **返回主线教程**：[第 07 讲：Vue 响应式、编译优化与快速 Diff](../01-教程/第07讲-Vue响应式编译优化与快速Diff.md) ｜ [第 10 讲：构建引擎原理：Vite、Rollup 与 AST 插件](../01-教程/第10讲-构建引擎原理Vite-Rollup与AST插件.md)  
> 🧪 **亲手验证本概念**：[实验 07：手写迷你 AST 代码转换器](../03-实验/实验07-手写迷你AST代码转换器.md)  
> 👉 **下一篇概念**：[概念 15｜同源策略、CORS 预检与 CSP](./15-同源策略CORS预检与CSP.md)
