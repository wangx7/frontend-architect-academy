import { defineConfig } from 'vitepress'

const base = process.env.GITHUB_ACTIONS ? '/frontend-architect-academy/' : '/'

export default defineConfig({
  title: '前端架构师学院',
  description: '教程·概念·实验三位一体：以成为前端架构师为核心，同时打通后端与系统架构底座',
  lang: 'zh-CN',
  base,
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', href: `${base}logo.svg` }],
    ['meta', { name: 'theme-color', content: '#42b883' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: '前端架构师学院',

    socialLinks: [
      { icon: 'github', link: 'https://github.com/wangx7/frontend-architect-academy' }
    ],

    nav: [
      { text: '首页', link: '/', activeMatch: '^/$' },
      { text: '01 教程（17讲主线）', link: '/01-教程/', activeMatch: '/01-教程/' },
      { text: '02 概念（20篇图解）', link: '/02-概念/', activeMatch: '/02-概念/' },
      { text: '03 实验（14个沙盒）', link: '/03-实验/', activeMatch: '/03-实验/' },
      { text: '写作铁律', link: '/AGENT', activeMatch: '/AGENT' },
    ],

    sidebar: {
      '/01-教程/': [
        {
          text: '01 教程 · 全景地图',
          items: [
            { text: '教程总览与阅读指南', link: '/01-教程/' },
          ]
        },
        {
          text: '第一卷 · 机器与内存底座',
          collapsed: false,
          items: [
            { text: '第 01 讲｜程序是怎么跑起来的', link: '/01-教程/第01讲-程序是怎么跑起来的' },
            { text: '第 02 讲｜变量和数据住在哪个格子里', link: '/01-教程/第02讲-变量和数据住在哪个格子里' },
            { text: '第 03 讲｜一颗 CPU 如何分身服务万人', link: '/01-教程/第03讲-一颗CPU如何分身服务万人' },
          ]
        },
        {
          text: '第二卷 · 浏览器与语言框架内核',
          collapsed: false,
          items: [
            { text: '第 04 讲｜字节是怎么变成屏幕像素的', link: '/01-教程/第04讲-字节是怎么变成屏幕像素的' },
            { text: '第 05 讲｜JS 单线程与事件循环调度', link: '/01-教程/第05讲-JS单线程与事件循环调度' },
            { text: '第 06 讲｜作用域、闭包与原型链的物理真相', link: '/01-教程/第06讲-作用域闭包与原型链的物理真相' },
            { text: '第 07 讲｜Vue 响应式、编译优化与快速 Diff', link: '/01-教程/第07讲-Vue响应式编译优化与快速Diff' },
            { text: '第 08 讲｜React Fiber 架构与双框架设计权衡', link: '/01-教程/第08讲-React-Fiber架构与双框架设计权衡' },
          ]
        },
        {
          text: '第三卷 · 前端工程化与大型架构',
          collapsed: false,
          items: [
            { text: '第 09 讲｜模块化、包管理与 pnpm 硬链接拓扑', link: '/01-教程/第09讲-模块化包管理与pnpm硬链接拓扑' },
            { text: '第 10 讲｜构建引擎原理：Vite、Rollup 与 AST 插件', link: '/01-教程/第10讲-构建引擎原理Vite-Rollup与AST插件' },
            { text: '第 11 讲｜大型前端架构：状态分层、防腐蚀层与插件内核', link: '/01-教程/第11讲-大型前端架构状态分层防腐蚀层与插件内核' },
            { text: '第 12 讲｜微前端架构：JS 沙箱、样式隔离与模块联邦', link: '/01-教程/第12讲-微前端架构JS沙箱样式隔离与模块联邦' },
            { text: '第 13 讲｜前端性能治理、安全攻防与监控 SDK', link: '/01-教程/第13讲-前端性能治理安全攻防与监控SDK' },
          ]
        },
        {
          text: '第四卷 · 网络、数据库与分布式底座',
          collapsed: false,
          items: [
            { text: '第 14 讲｜一次请求出门：DNS、TCP、TLS 与 HTTP 演进', link: '/01-教程/第14讲-一次请求出门DNS-TCP-TLS与HTTP演进' },
            { text: '第 15 讲｜请求进机房：CDN、负载均衡、网关限流与 BFF', link: '/01-教程/第15讲-请求进机房CDN负载均衡网关限流与BFF' },
            { text: '第 16 讲｜数据落盘与分布式：B+ 树、事务、Redis 与 Raft', link: '/01-教程/第16讲-数据落盘与分布式B+树索引事务Redis与Raft' },
            { text: '第 17 讲｜大结局：从 git push 到金丝雀发布与秒级回滚', link: '/01-教程/第17讲-大结局从git-push到金丝雀发布与秒级回滚' },
          ]
        }
      ],

      '/02-概念/': [
        {
          text: '02 概念 · 零黑话图解字典',
          items: [
            { text: '概念词典总览（按需查阅）', link: '/02-概念/' },
          ]
        },
        {
          text: 'A 辑 · 数据结构与算法基石（从0到1慢放）',
          collapsed: false,
          items: [
            { text: '01｜内存门牌号与指针引用', link: '/02-概念/01-内存门牌号与指针引用' },
            { text: '02｜数组与连号房间', link: '/02-概念/02-数组与连号房间' },
            { text: '03｜单向链表与双向链表', link: '/02-概念/03-单向链表与双向链表' },
            { text: '04｜栈与队列（叠盘子与排队）', link: '/02-概念/04-栈与队列' },
            { text: '05｜哈希表与冲突拉链（8格储物柜）', link: '/02-概念/05-哈希表与冲突拉链' },
            { text: '06｜二叉搜索树与跷跷板旋转', link: '/02-概念/06-二叉搜索树与跷跷板旋转' },
            { text: '07｜2-3 树与红黑树（红胶水皮影戏）', link: '/02-概念/07-2-3树与红黑树' },
            { text: '08｜B 树与 B+ 树（16KB页分裂慢放）', link: '/02-概念/08-B树与B+树' },
            { text: '09｜LRU 缓存淘汰算法（哈希+双向链表）', link: '/02-概念/09-LRU缓存淘汰算法' },
            { text: '10｜最长递增子序列 LIS（Vue3 Diff专用）', link: '/02-概念/10-最长递增子序列LIS' },
          ]
        },
        {
          text: 'B 辑 · 前端内核与工程核心概念',
          collapsed: false,
          items: [
            { text: '11｜闭包背包 Context 与垃圾回收 GC', link: '/02-概念/11-闭包背包Context与垃圾回收GC' },
            { text: '12｜WeakMap 与 Vue3 响应式依赖图', link: '/02-概念/12-WeakMap与响应式依赖图' },
            { text: '13｜GPU 合成层与 BFC 布局边界', link: '/02-概念/13-合成层与BFC布局边界' },
            { text: '14｜AST 抽象语法树与模块依赖图', link: '/02-概念/14-AST抽象语法树与模块依赖图' },
            { text: '15｜同源策略、CORS 预检与 CSP', link: '/02-概念/15-同源策略CORS预检与CSP' },
          ]
        },
        {
          text: 'C 辑 · 网络、数据库与分布式概念',
          collapsed: false,
          items: [
            { text: '16｜TCP 三次握手、字节流与队头阻塞', link: '/02-概念/16-TCP三次握手与队头阻塞' },
            { text: '17｜TLS 1.3 握手与数字证书信任链', link: '/02-概念/17-TLS握手与数字证书信任链' },
            { text: '18｜ACID 事务、MVCC 与 WAL 预写日志', link: '/02-概念/18-ACID事务MVCC与WAL预写日志' },
            { text: '19｜一致性哈希圆环与令牌桶限流', link: '/02-概念/19-一致性哈希与令牌桶限流' },
            { text: '20｜CAP 定理与 Raft 多数派共识', link: '/02-概念/20-CAP定理与Raft多数派共识' },
          ]
        }
      ],

      '/03-实验/': [
        {
          text: '03 实验 · 亲手验证沙盒',
          items: [
            { text: '实验室总览与运行说明', link: '/03-实验/' },
            { text: '实验 01｜观测操作系统进程与 V8 字节码', link: '/03-实验/实验01-观测进程与V8字节码' },
            { text: '实验 02｜亲手制造爆栈、堆 GC 与多线程竞态', link: '/03-实验/实验02-爆栈堆GC与线程竞态' },
            { text: '实验 03｜制造并治愈浏览器布局抖动 (Thrashing)', link: '/03-实验/实验03-制造并治愈布局抖动' },
            { text: '实验 04｜事件循环宏微任务与时间切片调度器', link: '/03-实验/实验04-事件循环与时间切片' },
            { text: '实验 05｜手写 Vue3 响应式与分支依赖清理', link: '/03-实验/实验05-手写Vue3响应式与动态清理' },
            { text: '实验 06｜手写 Vue3 快速 Diff 与 LIS 索引算法', link: '/03-实验/实验06-手写Vue3快速Diff与LIS' },
            { text: '实验 07｜手写迷你 AST 代码转换器 (Codemod)', link: '/03-实验/实验07-手写迷你AST代码转换器' },
            { text: '实验 08｜手写 LRU 缓存与异步请求竞态锁', link: '/03-实验/实验08-手写LRU缓存与请求竞态锁' },
            { text: '实验 09｜30 行手写微前端 Proxy 隔离沙箱', link: '/03-实验/实验09-30行手写微前端Proxy沙箱' },
            { text: '实验 10｜手写前端错误捕获、白屏与性能探针', link: '/03-实验/实验10-手写前端错误与性能监控探针' },
            { text: '实验 11｜用 net/http 手造原始 TCP 与 304 缓存', link: '/03-实验/实验11-用net与http手造TCP与304缓存' },
            { text: '实验 12｜手写反向代理、健康检查与令牌桶限流', link: '/03-实验/实验12-手写反向代理与令牌桶限流' },
            { text: '实验 13｜百万数据查找压测与并发超卖复现', link: '/03-实验/实验13-百万数据索引压测与超卖复现' },
            { text: '实验 14｜手写 Raft 选主与网络分区防脑裂模拟', link: '/03-实验/实验14-手写Raft选主与网络分区模拟' },
          ]
        }
      ],
    },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索教程 / 概念 / 实验', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '无法找到相关结果',
            resetButtonTitle: '清除搜索条件',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' }
          }
        }
      }
    },

    outline: {
      level: [2, 3],
      label: '本页目录'
    },

    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdated: { text: '最后更新于' },
    returnToTopLabel: '返回顶部',
    sidebarMenuLabel: '目录菜单',
    darkModeSwitchLabel: '主题外观',

    footer: {
      message: '教程 · 概念 · 实验 三位一体 ｜ 零超纲黑话 · 内存门牌号具象推导',
      copyright: '© 2026 前端架构师学院 (Frontend Architect Academy)'
    }
  }
})
