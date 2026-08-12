# QASMA Public Workbench

这是 QASMA v3.2 的公开前端仓库，只呈现整体思路、多 Agent 架构骨架与可视化工作台。仓库不包含搜索后端、Python 实现、训练代码、真实实验数据、模型调用配置或内部研究文档。

## QASMA v3.2

QASMA（Quantum Architecture Search Multi-Agent）把量子架构搜索组织成一个“提出假设—生成候选—确定性验证—证据反馈”的闭环：LLM Agent 负责需要创造力的科学推理，编译器、求解器与评价器负责裁决可验证事实。

常驻的五个 LLM 角色是：

- Scientific Director：设定轮次目标并调度搜索方向；
- Theory & Grammar Architect：提出可证伪机制并定义本轮搜索语法；
- Theory Evolver：从理论结构生成完整候选；
- Empirical Evolver：根据成功、失败与资源瓶颈改进候选；
- Independent Critic：独立攻击候选假设并提出反例测试。

SOTA Research Agent 与 Novelty Evolver 是按任务触发的可选角色。所有候选随后经过规范化与去重、开放式 Typed DSL、契约编译、多保真评价和证书归档。评价从低成本结构检查逐级推进到完整或可认证评价，有限的高成本预算只分配给信息价值最高的候选。

Typed DSL 不是封闭白名单。架构同时保留可认证 block、底层 primitive 与开放实证三种候选通道，使新结构可以先接受数值或求解器验证，再晋升为可复用组件。每轮结果写入 append-only evidence 与研究档案，并反馈给下一轮 Director、Grammar Architect 和 Evolver。

```text
任务与治理
  → Scientific Director
  → Theory & Grammar Architect
  → Theory / Empirical / Novelty Evolvers
  → 候选规范化与去重
  → Typed DSL 与契约编译
  → 低成本评价 + Independent Critic
  → 多保真路由
  → 完整评价与证书
  → Evidence / Archive
  ↺ 下一轮搜索
```

## 仓库内容

```text
architecture/     公开的节点、连接、阶段与接口骨架
workbench/        纯 HTML/CSS/JavaScript 可视化工作台
  data/           明确标注为演示用途的脱敏合成数据
scripts/          无依赖的本地静态文件服务
```

## 本地查看

需要 Node.js 18 或更高版本：

```bash
npm run dev
```

然后访问终端输出的本地地址。工作台包含工作流画布、运行总览、候选浏览器和事件时间线；所有数值均为界面演示数据，不构成研究结果或 SOTA 声明。

## 公开边界

- 不包含任何 Python 文件或可执行搜索后端；
- 不包含原仓库 `docs/`、比赛材料、报告、缓存、日志和结果目录；
- 不包含真实 API、密钥、provider、模型名称或内部源码路径；
- `architecture/qasma-v3.2.json` 是前端展示契约，不是完整实现规范。
