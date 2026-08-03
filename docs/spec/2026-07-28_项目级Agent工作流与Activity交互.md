# SPEC：项目级 Agent 工作流与 Activity 交互

> 节点输入输出、提示词变量、循环和判定的目标配置模型已由
> `2026-07-31_通用工作流配置与相对历史变量.md` 取代。本文件中的 V1
> Produce/Review/Artifact/Aggregate/四态 Decision 仅保留为现有实现与历史 Run 的迁移背景。

## 1. 文档定位

- 日期：2026-07-28
- 状态：已完成（按 2026-08-03 收口范围）
- 适用范围：Orca 左侧导航、Workflows 中间主窗口、右侧 Workflow Activity / Agent Activity、Orchestration Runtime
- 前置能力：现有 Agent Activity、Agent 生命周期身份、定向发送 Prompt、Orchestration Run / Task / Dispatch / Worker
- Phase 0 验证：从 Agent Activity 向指定空闲 Agent 发送固定内容 `hi`，已于 2026-07-28 手工验证通过

本文定义 Orca 的项目级 Agent 工作流能力。用户可以编辑工作流模板，把当前项目中的活跃 Agent 分配到模板节点，启动多 Agent 工作流，并通过右侧 Workflow Activity 查看当前进度和完整历史。

### 1.1 当前完成范围

本 SPEC 以 macOS 本机 Git Worktree / Folder Workspace 的产品代码、数据库迁移、自动化和可构建 App 为完成合同：

- Windows、Linux、WSL 的安装包和运行验证移至未来独立需求。
- SSH Workflow 远程执行暂不交付并由 capability preflight 安全拒绝；Runtime Host、Relay 的跨 Host 验证移至未来需求。
- 截图、录屏、真实 Agent 操作和其他人工验收由用户另行执行，不属于 SPEC 完成门槛。
- V1 兼容运行与编辑、V2 通用编排、运行历史、恢复和可靠性均按本机自动化证据完成。
- 本范围后续发现的产品调优或能力扩展作为新需求处理，不重新打开本 SPEC。

本文同时冻结以下信息架构：

1. 左侧导航在 `Tasks`、`Automations` 下方新增一级入口 `Workflows`。
2. Workflows 的模板列表、模板编辑、运行准备和运行详情使用中间主窗口，即当前 Terminal / Agent 输入区域所在的主内容区。
3. 工作流的应用、当前项目选择、Agent 分配状态、运行、暂停、继续、人工决定和当前运行概览位于右侧当前工作区面板。
4. 右侧面板中 `Workflow Activity` 位于 `Agent Activity` 上方。
5. Agent Activity 的活跃 Agent 可以拖入中间工作流节点，也必须提供非拖拽的点击选择和新建 Agent 方式。

## 2. 背景与问题

Orca 当前已经能够：

- 识别 Agent 的 working、waiting、blocked、idle、done 状态。
- 在 Agent Activity 中展示当前 Agent 和最近完成结论。
- 展开和复制 Agent 最终结论。
- 根据 worktree、tab、Pane 和 Agent lifecycle 安全定位当前 Agent。
- 向指定活跃 Agent 的终端发送 Prompt。
- 通过 Orchestration 创建 Run、Task、Dispatch 和 Worker。
- 复用已有 Agent 终端或创建新 Agent。
- 接收 `worker_done`、heartbeat、question、decision gate 和 escalation。

但这些能力目前仍是独立操作，缺少项目级工作流：

1. 用户不能保存“谁产出、谁评审、谁判定、何时修改”的模板。
2. Agent Activity 以单个 Agent 为中心，不能回答整个任务执行到哪个步骤。
3. 一个 Agent 的最终结论不会自动成为下一个 Agent 的输入。
4. 多个评审 Agent 的意见没有汇总、判定和回传机制。
5. 缺少评审轮次和“达到最高轮次后停在评审”的控制。
6. 当前 Agent Activity 的运行时状态不能代替长期、可回顾的工作流记录。
7. 用户无法在一个项目上下文中通过一次“运行”操作启动完整协作流程。

因此，需要在现有 Orchestration 之上增加一层可编辑、可持久化、可恢复的 Workflow 控制面，而不是重新实现 Agent 通信。

## 3. 产品目标

### 3.1 用户目标

用户应能完成以下操作：

1. 从左侧点击 `Workflows`。
2. 在中间窗口新建或编辑工作流模板。
3. 在右侧选择当前项目或工作区，并应用选中的模板。
4. 从右侧 Agent Activity 把活跃 Agent 拖入中间模板节点，或在角色槽中创建新的 Agent。
5. 填写任务目标，点击一次“运行”。
6. 系统自动把节点 Prompt 发送给对应 Agent。
7. 上一个节点完成后，系统自动把其完整最终结论传给下一个节点。
8. 在右侧 Workflow Activity 查看当前在哪个节点、由哪些 Agent 工作。
9. 多轮评审、判定和修改自动进行，直到通过、需要人工决定、失败或达到最高评审轮次。
10. 以后可以从 Workflows 中间窗口回顾完整运行记录。

### 3.2 业务目标

首批支持三个内置模板：

1. `SPEC 编写与评审`
2. `代码实现与评审`
3. `SPEC → 实现完整流程`

三者共享同一个通用循环：

```text
产出
  ↓
评审（一个或多个 Agent 并行）
  ↓
判定（确定性规则，必要时调用判定 Agent）
  ├─ 通过 → 完成
  ├─ 需要修改且未到上限 → 回到产出 Agent
  ├─ 需要人工决定 → 等待用户
  └─ 已到最高轮次 → 停留在最终评审
```

### 3.3 工程目标

1. 复用现有定向 Prompt 发送能力和 Orchestration Dispatch。
2. 工作流推进由持久化状态机控制，不依赖 React 页面是否打开。
3. 每次状态转换可恢复、可追踪、可防重复执行。
4. 支持本机 Git Worktree 和 Folder Workspace；SSH Workflow 暂时安全拒绝。
5. 工作流模板和运行实例严格分离。
6. Agent Activity 的最终结论成为工作流交接的主要人类可读内容。
7. 真实 SPEC、文件、代码 Diff 和测试结果仍是事实依据，不能只依赖结论摘要。

## 4. 非目标

- 第一版不实现完全自由的 BPMN 工作流设计器。
- 第一版不允许任意脚本节点、网络请求节点或插件节点。
- 第一版不自动提交、推送、合并或删除分支。
- 第一版不自动接受破坏性操作或高风险 Agent 请求。
- 第一版不允许判定 Agent 自由创建任意节点或绕过轮次上限。
- 第一版不把完整 Terminal transcript 作为默认工作流记录。
- 第一版不跨无关项目拖入 Agent。
- 第一版不以 Prompt 文本发送成功代替任务完成。
- 第一版不把 Agent Activity 的截断预览当作完整交接内容。
- 第一版不要求模板写入项目仓库；仓库级导入、导出和团队共享后续实现。

## 5. 信息架构

### 5.1 左侧一级导航

左侧导航顺序要求：

```text
Tasks
Automations
Workflows
...
```

要求：

- `Workflows` 是独立一级入口，不属于 `Tasks` 或 `Automations` 的子页面。
- `Workflows` 的显示不依赖 `Automations` 是否隐藏。
- 使用现有侧栏按钮样式、选中态、间距和图标体系。
- 使用 `lucide-react` 已有 `Workflow` 图标，不引入新图标库。
- 点击后进入新的 `activeView = 'workflows'`。
- 应增加 `openWorkflowsPage()`，行为与 `openAutomationsPage()`、`openActivityPage()` 一致。
- 模板选择和 Run Draft 状态必须可恢复，但 Workflows 临时标签不跨应用重启自动恢复；重启后从
  Workflow Activity 的“继续配置”重新进入。
- 左侧入口不是唯一入口；右侧 Workflow Activity 和按需打开的中间工作区标签必须共用
  `openWorkflowsPage()`。

### 5.2 中间主窗口

`Workflows` 不是常驻标签。只有用户进入运行配置，或从左侧入口、Workflow Activity 显式打开时，
才在 Terminal、Editor、Browser、Simulator 等中间标签旁增加临时工作区标签。该标签必须提供
与普通标签一致的关闭按钮和关闭快捷键；关闭后返回打开前的工作内容，不删除未启动的 Run Draft，
也不销毁或移动原有工作区标签。

运行配置完成并成功启动 Workflow 后，临时标签自动关闭；运行状态继续由右侧 Workflow Activity
承载。用户仍可从 Workflow Activity 按需重新打开运行详情。分屏时标签只显示在当前聚焦 Pane，
Workflows 内容也只在该 Pane 中打开。

没有当前工作区时，允许以无项目全页回退方式进入模板管理，但不得伪造项目或执行 Host 上下文。

Workflows 中间主窗口承担：

- 模板列表
- 模板新建
- 模板复制
- 模板编辑
- 模板只读预览
- 独立的运行配置页面
- 节点 Agent 分配结果
- 独立的运行详情与历史页面
- Prompt 输入和 Agent 最终结论查看

中间主窗口不承担：

- 当前工作区选择
- 运行中的暂停、继续、取消和人工判定主操作

右侧完成当前工作区和模板选择，并以“配置并运行”进入中间运行配置页面；完整目标、Agent
分配、运行前检查和启动确认不得压缩在右侧窄栏内。运行中的高频控制仍位于右侧面板。

### 5.3 右侧当前工作区面板

进入 Workflows 后，右侧面板必须继续可见，不得像 Tasks、Automations、Activity 一样被统一抑制。

右侧面板保持当前项目和工作区上下文，并从上到下展示：

```text
当前项目 / 工作区

Workflow Activity
  - 打开 Workflows
  - 选择模板
  - 进入运行配置
  - 继续未完成的运行配置
  - 当前运行
  - 运行控制
  - 等待用户的决定

Agent Activity
  - 当前活跃 Agent
  - 状态
  - 最终结论
  - 拖拽与点击分配
```

要求：

- Workflow Activity 标题栏始终提供直接打开 Workflows 的入口，不依赖空态、Draft 或 Run 状态。
- Workflows 页面打开时，右侧自动切换到能够同时显示 Workflow Activity 和 Agent Activity 的上下文。
- 右侧仍绑定当前项目/工作区，不把 Workflows 误当成无项目的全局运行环境。
- 当前没有活动项目或工作区时，可以编辑模板，但“配置并运行”和“运行”必须禁用并解释原因。
- 右侧模板选择只决定下一次显式创建的 Run Draft，不得因为模板列表加载或中间编辑器选中首项而
  自动创建 Draft。
- 用户切换工作区时，未启动的运行准备不能静默切换目标；必须提示保留、切换或放弃。
- 正在运行的 Workflow 永久绑定创建时的项目、工作区和执行主机，不跟随 UI 焦点漂移。

### 5.4 普通工作区中的右侧面板

用户返回 Terminal、Editor 或 Browser 等普通工作区后，右侧仍应显示：

- 当前工作区正在运行的 Workflow Activity。
- 当前 Workflow 所属 Agent 的状态。
- 等待用户的决定。
- 跳转到 Workflows 运行详情的入口。

用户不必一直停留在 Workflows 页面才能观察和控制工作流。

## 6. Workflows 中间窗口设计

### 6.1 页面模式

中间窗口包含三种明确模式：

1. `Templates`
2. `Run setup`
3. `Run history`

模式必须在页面标题和面包屑中清楚显示，不能只依靠画布内容猜测。

### 6.2 Templates 模式

布局建议：

```text
┌ 模板列表 ─────┬ 模板画布 ─────────────────────────┐
│ 内置模板       │ [产出] → [评审] → [判定] → [完成] │
│ 我的模板       │                                    │
│ 项目模板       │ 选中节点后显示配置                 │
└───────────────┴────────────────────────────────────┘
```

模板列表支持：

- 搜索
- 新建
- 复制
- 重命名
- 删除自定义模板
- 查看版本
- 按内置、个人、项目范围分组

内置模板不能直接修改。用户修改内置模板时，必须先复制为自定义模板。

### 6.3 模板节点

第一版只支持以下节点类型：

```ts
type WorkflowNodeType = 'produce' | 'review' | 'decide' | 'human-gate' | 'complete'
```

节点显示：

- 节点名称
- 节点角色
- 单 Agent 或多 Agent
- 是否必填
- Prompt 模板摘要
- 输入来源
- 输出去向
- 评审轮次信息
- 失败策略

### 6.4 模板编辑能力

第一版允许：

- 添加受支持节点。
- 删除非必需节点。
- 调整节点顺序。
- 设置角色名称。
- 设置节点 Agent 工作指令，并通过受控占位符引用本轮输入。
- 设置节点是否允许多个 Agent。
- 设置多个 Agent 是并行还是依次执行。
- 设置评审通过策略。
- 设置最高评审轮次。
- 设置失败重试次数。
- 设置是否启用判定 Agent。
- 设置需要人工确认的条件。

第一版不允许：

- 任意环形连线。
- 没有退出条件的循环。
- 从完成节点返回其他节点。
- 绕过人工 Gate。
- 判定 Agent 指向模板中不存在的节点。

界面可以提供节点拖放排序和有限连线，但保存时必须转换成受约束的 Workflow Definition，并通过 Schema 校验。

#### 6.4.1 节点 Prompt 模板与占位符

每个需要 Agent 的节点除 `promptTemplateKey` 外，还可以保存 `promptInstructions`。前者选择
Orca 管理的任务类型和系统执行协议，后者是用户可编辑的节点工作指令模板。

第一版冻结以下占位符：

| 占位符                   | 对应输入              | 运行时内容                                                   |
| ------------------------ | --------------------- | ------------------------------------------------------------ |
| `{{rootGoal}}`           | `root-goal`           | Workflow Run 的根目标                                        |
| `{{upstreamCompletion}}` | `upstream-completion` | 当前输入 Artifact 的产出 Step 完整结论，或最近的上游完整结论 |
| `{{artifactRevision}}`   | `artifact-revision`   | 冻结 Artifact 的 ID、种类、摘要、不可变快照位置和 Manifest   |
| `{{reviewAggregate}}`    | `review-aggregate`    | 当前 Artifact 对应的去重评审汇总与判定                       |
| `{{decision}}`           | `decision`            | 最近一次结构化判定                                           |
| `{{workflowName}}`       | 系统上下文            | Workflow 模板名称和版本                                      |
| `{{nodeName}}`           | 系统上下文            | 当前节点名称                                                 |
| `{{round}}`              | 系统上下文            | 当前评审或修改轮次                                           |

交互和校验要求：

- 节点配置提供多行工作指令编辑器、占位符说明和一键插入。
- 插入带输入来源的占位符时，自动启用对应 `inputBindings`。
- 保存时拒绝未知或未闭合占位符；占位符需要的输入未绑定时拒绝保存。
- 已知占位符在本轮没有对应数据时省略其所在段落，不得把原始占位符或空值说明发送给 Agent。
- 用户工作指令只负责描述本节点要完成的工作，不能覆盖身份、Host、Workspace、Artifact
  冻结约束、输出 Schema 或回执路径。
- Orca 在每次 Step Dispatch 前使用当时持久化的 Run/Step/Artifact/Review/Decision 快照渲染，
  并把最终实际发送的完整 Prompt 保存到 Step 历史。
- Workflow 直接发送渲染后的节点工作内容和精简结果格式，不附加通用 Orchestration
  Preamble、heartbeat、ask、escalation、check 或 `worker_done` CLI 教程。
- 旧的 V1 模板或历史快照缺少 `promptInstructions` 时，按 `promptTemplateKey` 使用对应内置默认工作指令，
  保证历史数据可读取和重试语义稳定。

### 6.5 节点角色槽

模板编辑态的节点显示“角色要求”，不保存某个当前活跃 Agent：

```text
SPEC 编写
需要：1 个产出 Agent
默认类型：任意
```

应用模板进入 Run setup 后，同一个节点显示“运行分配槽”：

```text
SPEC 编写
已分配：Codex · Agent lifecycle ...
```

模板角色和运行时 Agent 身份必须严格分离。

### 6.6 保存和版本

每次保存模板生成新的递增版本。

正在运行的 Workflow 保存启动时的模板完整快照：

- 后续编辑模板不影响正在运行的实例。
- 历史记录继续显示当时的节点、Prompt 和配置。
- 删除模板不能删除历史运行。

### 6.7 Workflow Definition V1

M1 必须冻结可直接实现和验证的 discriminated-union Schema，不能只声明节点类型数组。

```ts
type WorkflowDefinitionV1 = {
  schemaVersion: 1
  entryNodeId: string
  defaults: {
    retryPolicy: WorkflowRetryPolicy
  }
  roleSlots: WorkflowRoleSlot[]
  nodes: WorkflowNodeDefinitionV1[]
  transitions: WorkflowTransitionV1[]
}

type WorkflowRetryPolicy = {
  maxAttempts: number
  backoffMs: number
  onExhausted: 'fail-run' | 'wait-human'
}

type WorkflowReviewPolicyV1 = {
  minReviewers: number
  completion: 'all-required'
  onReviewerFailure: 'fail-run' | 'wait-human'
  timeoutMs: number | null
  maxReviewRounds: number
}

type WorkflowRoleSlot = {
  id: string
  label: string
  required: boolean
  minAgents: number
  maxAgents: number
  execution: 'single' | 'parallel' | 'sequential'
  allowedAgentStates: ['idle']
}

type WorkflowInputBinding =
  | 'root-goal'
  | 'upstream-completion'
  | 'artifact-revision'
  | 'review-aggregate'
  | 'decision'

type WorkflowNodeBase = {
  id: string
  name: string
  roleSlotIds: string[]
  promptTemplateKey: string | null
  promptInstructions?: string | null
  inputBindings: WorkflowInputBinding[]
  retryPolicy: WorkflowRetryPolicy
}

type WorkflowNodeDefinitionV1 =
  | (WorkflowNodeBase & {
      type: 'produce'
      artifactKind: 'spec' | 'code'
      outputSchema: 'workflow.completion/v1'
    })
  | (WorkflowNodeBase & {
      type: 'review'
      reviewPolicy: WorkflowReviewPolicyV1
      outputSchema: 'workflow.review-result/v1'
    })
  | (WorkflowNodeBase & {
      type: 'decide'
      mode: 'rules' | 'rules-then-agent'
      outputSchema: 'workflow.decision/v1'
    })
  | (WorkflowNodeBase & {
      type: 'human-gate'
      waitingReasons: WorkflowWaitingReason[]
      allowedActions: WorkflowResolutionAction[]
      outputSchema: 'workflow.human-resolution/v1'
    })
  | (WorkflowNodeBase & {
      type: 'complete'
      outcome: 'succeeded'
      outputSchema: null
    })

type WorkflowTransitionV1 = {
  id: string
  from: string
  when:
    | 'step:succeeded'
    | 'decision:approve'
    | 'decision:revise'
    | 'decision:request-human'
    | 'decision:stop-at-review'
    | 'human:approve'
    | 'human:revise'
    | 'human:end'
  to: string | 'run:completed' | 'run:cancelled' | 'run:review-limit-reached'
}
```

Schema 校验必须覆盖：

- Definition、Node、Role Slot、Transition ID 均在各自范围内唯一。
- `entryNodeId`、Transition 起点和节点目标都存在。
- `complete` 没有 Agent 槽、Prompt 或出边。
- `produce` 只能输出版本化 Completion 和 Artifact。
- `review` 至少有一个 Reviewer，且并行/串行语义明确。
- `decide` 只能产生声明的四种决定。
- `human-gate` 的 waiting reason 和动作来自冻结枚举。
- 所有非终态节点都有合法出边。
- 只允许 Review → Decide → Produce 形成受 `maxReviewRounds` 约束的修改循环。
- 不允许从 Complete 返回、绕过 Human Gate 或指向不存在的节点。
- `retryPolicy.maxAttempts` 与 `maxReviewRounds` 分开校验。
- 未知字段、未知 Schema 版本和未知 Prompt key 拒绝保存。
- `promptInstructions` 最长 20,000 字符；未知、未闭合或缺少对应 `inputBindings` 的占位符拒绝保存。

三个内置模板必须以受版本控制的标准 JSON fixture 落库，并对完整 JSON 做快照测试；不能只测试“能被解析”。

### 6.8 三个内置模板的标准拓扑

以下 JSON 冻结节点和 Transition；实现中的标准 fixture 必须包含 6.7 的全部公共字段、固定 Prompt key、角色槽和输出 Schema，并与本节做快照对应。

#### SPEC 编写与评审

```json
{
  "schemaVersion": 1,
  "entryNodeId": "spec-produce",
  "nodes": [
    {
      "id": "spec-produce",
      "type": "produce",
      "roleSlotIds": ["spec-author"],
      "artifactKind": "spec",
      "outputSchema": "workflow.completion/v1"
    },
    {
      "id": "spec-review",
      "type": "review",
      "roleSlotIds": ["spec-reviewers"],
      "reviewPolicy": {
        "minReviewers": 1,
        "completion": "all-required",
        "onReviewerFailure": "wait-human",
        "timeoutMs": 3600000,
        "maxReviewRounds": 3
      },
      "outputSchema": "workflow.review-result/v1"
    },
    {
      "id": "spec-decide",
      "type": "decide",
      "roleSlotIds": ["spec-decider"],
      "mode": "rules-then-agent",
      "outputSchema": "workflow.decision/v1"
    },
    {
      "id": "spec-human",
      "type": "human-gate",
      "roleSlotIds": [],
      "outputSchema": "workflow.human-resolution/v1"
    },
    {
      "id": "complete",
      "type": "complete",
      "roleSlotIds": [],
      "outcome": "succeeded",
      "outputSchema": null
    }
  ],
  "transitions": [
    {
      "id": "spec-produce-succeeded",
      "from": "spec-produce",
      "when": "step:succeeded",
      "to": "spec-review"
    },
    {
      "id": "spec-review-succeeded",
      "from": "spec-review",
      "when": "step:succeeded",
      "to": "spec-decide"
    },
    {
      "id": "spec-decision-approved",
      "from": "spec-decide",
      "when": "decision:approve",
      "to": "complete"
    },
    {
      "id": "spec-decision-revise",
      "from": "spec-decide",
      "when": "decision:revise",
      "to": "spec-produce"
    },
    {
      "id": "spec-decision-human",
      "from": "spec-decide",
      "when": "decision:request-human",
      "to": "spec-human"
    },
    {
      "id": "spec-decision-limit",
      "from": "spec-decide",
      "when": "decision:stop-at-review",
      "to": "run:review-limit-reached"
    },
    {
      "id": "spec-human-approved",
      "from": "spec-human",
      "when": "human:approve",
      "to": "complete"
    },
    {
      "id": "spec-human-revise",
      "from": "spec-human",
      "when": "human:revise",
      "to": "spec-produce"
    },
    { "id": "spec-human-end", "from": "spec-human", "when": "human:end", "to": "run:cancelled" }
  ]
}
```

#### 代码实现与评审

```json
{
  "schemaVersion": 1,
  "entryNodeId": "code-produce",
  "nodes": [
    {
      "id": "code-produce",
      "type": "produce",
      "roleSlotIds": ["implementer"],
      "artifactKind": "code",
      "outputSchema": "workflow.completion/v1"
    },
    {
      "id": "code-review",
      "type": "review",
      "roleSlotIds": ["code-reviewers"],
      "reviewPolicy": {
        "minReviewers": 1,
        "completion": "all-required",
        "onReviewerFailure": "wait-human",
        "timeoutMs": 3600000,
        "maxReviewRounds": 3
      },
      "outputSchema": "workflow.review-result/v1"
    },
    {
      "id": "code-decide",
      "type": "decide",
      "roleSlotIds": ["code-decider"],
      "mode": "rules-then-agent",
      "outputSchema": "workflow.decision/v1"
    },
    {
      "id": "code-human",
      "type": "human-gate",
      "roleSlotIds": [],
      "outputSchema": "workflow.human-resolution/v1"
    },
    {
      "id": "complete",
      "type": "complete",
      "roleSlotIds": [],
      "outcome": "succeeded",
      "outputSchema": null
    }
  ],
  "transitions": [
    {
      "id": "code-produce-succeeded",
      "from": "code-produce",
      "when": "step:succeeded",
      "to": "code-review"
    },
    {
      "id": "code-review-succeeded",
      "from": "code-review",
      "when": "step:succeeded",
      "to": "code-decide"
    },
    {
      "id": "code-decision-approved",
      "from": "code-decide",
      "when": "decision:approve",
      "to": "complete"
    },
    {
      "id": "code-decision-revise",
      "from": "code-decide",
      "when": "decision:revise",
      "to": "code-produce"
    },
    {
      "id": "code-decision-human",
      "from": "code-decide",
      "when": "decision:request-human",
      "to": "code-human"
    },
    {
      "id": "code-decision-limit",
      "from": "code-decide",
      "when": "decision:stop-at-review",
      "to": "run:review-limit-reached"
    },
    {
      "id": "code-human-approved",
      "from": "code-human",
      "when": "human:approve",
      "to": "complete"
    },
    {
      "id": "code-human-revise",
      "from": "code-human",
      "when": "human:revise",
      "to": "code-produce"
    },
    { "id": "code-human-end", "from": "code-human", "when": "human:end", "to": "run:cancelled" }
  ]
}
```

#### SPEC → 实现完整流程

```json
{
  "schemaVersion": 1,
  "entryNodeId": "spec-produce",
  "nodes": [
    {
      "id": "spec-produce",
      "type": "produce",
      "roleSlotIds": ["spec-author"],
      "artifactKind": "spec",
      "outputSchema": "workflow.completion/v1"
    },
    {
      "id": "spec-review",
      "type": "review",
      "roleSlotIds": ["spec-reviewers"],
      "reviewPolicy": {
        "minReviewers": 1,
        "completion": "all-required",
        "onReviewerFailure": "wait-human",
        "timeoutMs": 3600000,
        "maxReviewRounds": 3
      },
      "outputSchema": "workflow.review-result/v1"
    },
    {
      "id": "spec-decide",
      "type": "decide",
      "roleSlotIds": ["spec-decider"],
      "mode": "rules-then-agent",
      "outputSchema": "workflow.decision/v1"
    },
    {
      "id": "spec-human",
      "type": "human-gate",
      "roleSlotIds": [],
      "outputSchema": "workflow.human-resolution/v1"
    },
    {
      "id": "code-produce",
      "type": "produce",
      "roleSlotIds": ["implementer"],
      "artifactKind": "code",
      "outputSchema": "workflow.completion/v1"
    },
    {
      "id": "code-review",
      "type": "review",
      "roleSlotIds": ["code-reviewers"],
      "reviewPolicy": {
        "minReviewers": 1,
        "completion": "all-required",
        "onReviewerFailure": "wait-human",
        "timeoutMs": 3600000,
        "maxReviewRounds": 3
      },
      "outputSchema": "workflow.review-result/v1"
    },
    {
      "id": "code-decide",
      "type": "decide",
      "roleSlotIds": ["code-decider"],
      "mode": "rules-then-agent",
      "outputSchema": "workflow.decision/v1"
    },
    {
      "id": "code-human",
      "type": "human-gate",
      "roleSlotIds": [],
      "outputSchema": "workflow.human-resolution/v1"
    },
    {
      "id": "complete",
      "type": "complete",
      "roleSlotIds": [],
      "outcome": "succeeded",
      "outputSchema": null
    }
  ],
  "transitions": [
    {
      "id": "spec-produce-succeeded",
      "from": "spec-produce",
      "when": "step:succeeded",
      "to": "spec-review"
    },
    {
      "id": "spec-review-succeeded",
      "from": "spec-review",
      "when": "step:succeeded",
      "to": "spec-decide"
    },
    {
      "id": "spec-decision-approved",
      "from": "spec-decide",
      "when": "decision:approve",
      "to": "code-produce"
    },
    {
      "id": "spec-decision-revise",
      "from": "spec-decide",
      "when": "decision:revise",
      "to": "spec-produce"
    },
    {
      "id": "spec-decision-human",
      "from": "spec-decide",
      "when": "decision:request-human",
      "to": "spec-human"
    },
    {
      "id": "spec-decision-limit",
      "from": "spec-decide",
      "when": "decision:stop-at-review",
      "to": "run:review-limit-reached"
    },
    {
      "id": "spec-human-approved",
      "from": "spec-human",
      "when": "human:approve",
      "to": "code-produce"
    },
    {
      "id": "spec-human-revise",
      "from": "spec-human",
      "when": "human:revise",
      "to": "spec-produce"
    },
    { "id": "spec-human-end", "from": "spec-human", "when": "human:end", "to": "run:cancelled" },
    {
      "id": "code-produce-succeeded",
      "from": "code-produce",
      "when": "step:succeeded",
      "to": "code-review"
    },
    {
      "id": "code-review-succeeded",
      "from": "code-review",
      "when": "step:succeeded",
      "to": "code-decide"
    },
    {
      "id": "code-decision-approved",
      "from": "code-decide",
      "when": "decision:approve",
      "to": "complete"
    },
    {
      "id": "code-decision-revise",
      "from": "code-decide",
      "when": "decision:revise",
      "to": "code-produce"
    },
    {
      "id": "code-decision-human",
      "from": "code-decide",
      "when": "decision:request-human",
      "to": "code-human"
    },
    {
      "id": "code-decision-limit",
      "from": "code-decide",
      "when": "decision:stop-at-review",
      "to": "run:review-limit-reached"
    },
    {
      "id": "code-human-approved",
      "from": "code-human",
      "when": "human:approve",
      "to": "complete"
    },
    {
      "id": "code-human-revise",
      "from": "code-human",
      "when": "human:revise",
      "to": "code-produce"
    },
    { "id": "code-human-end", "from": "code-human", "when": "human:end", "to": "run:cancelled" }
  ]
}
```

标准 fixture 还必须固定：

- 每个角色槽的 `required/minAgents/maxAgents/execution/allowedAgentStates`。
- 每个节点的 `promptTemplateKey/inputBindings/retryPolicy`。
- 模板默认 `maxReviewRounds`。
- 内置模板 ID、名称、范围和版本号。

标准值如下，fixture 不得自行选择其他默认值：

| Role Slot ID     | required | min/max | execution | allowed state |
| ---------------- | -------: | ------: | --------- | ------------- |
| `spec-author`    |       是 |     1/1 | single    | idle          |
| `spec-reviewers` |       是 |     1/8 | parallel  | idle          |
| `spec-decider`   |       否 |     0/1 | single    | idle          |
| `implementer`    |       是 |     1/1 | single    | idle          |
| `code-reviewers` |       是 |     1/8 | parallel  | idle          |
| `code-decider`   |       否 |     0/1 | single    | idle          |

| Node ID        | name          | Prompt key                | inputBindings                                                       | retry                   |
| -------------- | ------------- | ------------------------- | ------------------------------------------------------------------- | ----------------------- |
| `spec-produce` | SPEC 编写     | `builtin.spec.produce.v1` | root-goal, review-aggregate                                         | 2 attempts / wait-human |
| `spec-review`  | SPEC 评审     | `builtin.spec.review.v1`  | root-goal, upstream-completion, artifact-revision                   | 2 attempts / wait-human |
| `spec-decide`  | SPEC 判定     | `builtin.spec.decide.v1`  | root-goal, artifact-revision, review-aggregate                      | 2 attempts / wait-human |
| `spec-human`   | SPEC 人工决定 | null                      | artifact-revision, review-aggregate, decision                       | 0 attempts              |
| `code-produce` | 代码实现      | `builtin.code.produce.v1` | root-goal, upstream-completion, artifact-revision, review-aggregate | 2 attempts / wait-human |
| `code-review`  | 代码评审      | `builtin.code.review.v1`  | root-goal, upstream-completion, artifact-revision                   | 2 attempts / wait-human |
| `code-decide`  | 代码判定      | `builtin.code.decide.v1`  | root-goal, artifact-revision, review-aggregate                      | 2 attempts / wait-human |
| `code-human`   | 代码人工决定  | null                      | artifact-revision, review-aggregate, decision                       | 0 attempts              |
| `complete`     | 完成          | null                      | decision                                                            | 0 attempts              |

标准 fixture 还必须为所有 Produce、Review、Decide 节点固定 `promptInstructions`。默认文本使用
6.4.1 的命名占位符，把根目标、上游完整结论、冻结 Artifact、评审汇总和判定按节点需要传递到下一轮；
Human Gate 与 Complete 的 `promptInstructions` 为 `null`。

三个模板的 Review Policy 固定为：

```json
{
  "minReviewers": 1,
  "completion": "all-required",
  "onReviewerFailure": "wait-human",
  "timeoutMs": 3600000,
  "maxReviewRounds": 3
}
```

`timeoutMs = 3600000` 表示 60 分钟；自定义模板可以显式设为 `null` 表示不自动超时。每个 Review 节点的 `WorkflowReviewPolicyV1.maxReviewRounds` 是唯一轮次上限来源，不再从 Definition defaults 读取第二个值。`SPEC → 实现完整流程` 的 SPEC Review 和代码 Review 分别计数，不能共享一个累计轮次。Human Gate 的 waiting reason 和 action 使用 8.6 的完整冻结枚举与矩阵。

6.8 的拓扑 JSON、上述角色槽表和节点合同表共同生成完整标准 fixture；生成后的完整 JSON 是运行时入库、版本快照和测试快照的唯一 Seed，不允许 Renderer 另建隐式默认值。

## 7. 右侧选择和独立运行配置

### 7.1 选择模板并进入运行配置

当前工作区没有 Run 时，右侧 Workflow Activity 显示：

```text
当前工作区：Orca / feature/...
选择工作流：[SPEC 编写与评审 ▾]

[配置并运行]
```

模板下拉列表和模板编辑器可以复用同一个选中模板状态，但模板列表首次加载不得把自动选中的
第一项解释为用户已应用。只有点击“配置并运行”后才：

1. 创建未启动的 Workflow Run Draft。
2. 锁定项目、工作区和执行主机。
3. 中间窗口进入独立的“运行配置”页面。
4. 中间节点显示 Agent 分配槽。
5. 右侧 Agent Activity 进入可分配状态。

“运行配置”页面按一个明确流程承载：

1. 本次使用的工作流模板。
2. 本次任务目标。
3. 节点角色和 Agent 分配。
4. 运行前检查及具体恢复动作。
5. 最终启动确认。

Workflow 尚未启动且处于 Draft 或 Ready 时，模板选择保持可编辑。切换模板必须复用当前 Run：

- 保留任务目标、项目、工作区和执行主机。
- 清空旧模板的角色分配和运行前检查结果。
- 写入新的模板版本快照并回到 Draft。
- 记录新的 `template-applied` 事件。
- 不创建一个留在历史中的废弃 Draft。
- 选择当前相同模板和相同版本时必须是无副作用操作，不得清空既有分配。
- 模板列表必须从 Draft 锁定的 Execution Host 和 Project 范围读取，不得因当前界面切换到其他
  工作区而从错误 Runtime 加载模板。

`workflow.runUpdate`、`workflow.runAssign`、`workflow.runPrepare` 和模板切换只允许修改 Draft 或
Ready。running、paused、waiting、completed、failed 或 cancelled Run 必须拒绝这些配置写入，
不得被配置 RPC 重新改回 Draft。

Draft 或 Ready 存在时，右侧不再重复完整表单，只显示模板、配置状态和“继续配置”。

### 7.2 Agent 拖入节点

拖拽来源：

- 右侧 Agent Activity 中状态明确为 idle 的当前 Agent 行。
- working、waiting、blocked、done 或 completed 行不能进入拖拽 payload。

拖拽目标：

- 中间 Run setup 中的节点角色槽。

拖拽只创建运行时角色分配，不移动 Terminal、Tab、Pane 或 Agent 会话。

点击角色槽时，用户既可选择同一 Draft Workspace 和 Execution Host 上的当前 idle Agent，也可
创建新 Agent。设置页“已安装”目录和 Workflow 角色槽都必须提供直接的“新建智能体”入口。
创建表单必须允许选择已安装且启用的 Agent、输入本次会话的启动命令，并仅在该 Agent 支持时
显示 YOLO 权限配置。命令和权限只影响本次 Agent 会话，不修改全局设置。

Agent 名称不在创建表单中另行输入；它以设置页 Agent 目录名称为初始唯一来源。新 Agent 的终端标签、
右侧 Agent Activity 和 Workflow 分配选择器必须使用同一名称；用户后续重命名实际终端标签时，
Agent Activity 和 Workflow 必须改为读取该实际标签名称。新 Agent 进入 idle 后自动
分配到发起创建的角色槽。

每次分配记录至少包含：

```ts
type WorkflowAgentAssignment = {
  nodeId: string
  slotId: string
  worktreeId: string
  executionHostId: string
  paneKey: string
  agentLifecycleId: string
  providerSessionId: string | null
  runtimeAgent: string | null
}
```

实际 Dispatch 前必须重新解析终端 Handle 并校验：

- Worktree 仍相同。
- Execution Host 仍相同。
- Pane 仍存在。
- Agent lifecycle 未变化。
- Provider Session 没有明确冲突。
- Agent 没有回到 Shell。

校验失败时不得把 Prompt 发给同一 Pane 上的新进程。

### 7.3 非拖拽分配

拖拽不是唯一入口。

要求：

- 点击角色槽可以打开可搜索 Agent 选择器。
- Agent 选择器显示 Agent 类型、状态、工作区和当前任务。
- 键盘可以完成选择。
- 触屏和无精确鼠标环境可以完成同样操作。
- 并行角色槽中移除一个 Agent 只能删除该 lifecycle assignment，不能清空同槽其他 Agent。
- 分配和取消分配必须有清晰的可见动作。

### 7.4 可分配状态

Agent 分为：

| 状态                          | 是否可分配 | 行为                             |
| ----------------------------- | ---------: | -------------------------------- |
| `idle`                        |         是 | 可立即运行                       |
| `working`                     |       可选 | 默认不可立即运行；允许配置为排队 |
| `waiting` / permission        |         否 | 等待用户处理后再分配             |
| `blocked`                     |         否 | 必须先解除阻塞                   |
| transport disconnected        |         否 | 等待重连或重新分配               |
| completed 且无当前 Agent 证据 |         否 | 只能查看历史                     |

第一版默认只允许把 `idle` Agent 分配为“立即运行”。

### 7.5 任务目标

右侧 Run setup 必须提供任务目标输入框。

要求：

- 任务目标是整个 Workflow 的根目标。
- 节点 `promptInstructions` 可以通过 `{{rootGoal}}` 引用根目标和本轮输入，但不能替代 Run 中持久化的根目标。
- 目标为空时不能运行。
- 任务目标保存到 Workflow Run，不写回模板。
- 支持多行 Markdown。
- 显示当前项目、工作区和模板版本。

### 7.6 运行前检查

点击“运行”前检查：

- 所有必填节点已分配 Agent。
- 多 Agent 节点达到最小人数。
- 任务目标非空。
- 模板版本有效。
- 当前工作区仍存在。
- 所有立即运行 Agent 当前可接收任务。
- 最高评审轮次合法。
- 不存在无退出条件的流程。
- Folder Workspace 所需能力可用；SSH Workflow 场景明确返回不支持。

检查失败时显示具体节点和恢复动作，不能只显示“无法运行”。

## 8. Workflow Activity

### 8.1 位置

Workflow Activity 固定显示在右侧 Agent Activity 上方。

### 8.2 无运行状态

无活动 Workflow 时显示：

- 当前工作区没有运行中的 Workflow。
- 最近一个完成 Workflow 的简要结果，可选。
- 模板选择。
- “配置并运行”入口。
- “打开 Workflows”入口。

### 8.3 运行中摘要

最小摘要：

```text
SPEC 编写与评审
第 2 / 3 轮 · 评审中

当前：
Claude 1 · 评审中
Codex 2 · 评审中

[查看详情] [暂停]
```

必须回答：

- 当前 Workflow 是什么。
- 当前处于哪个节点。
- 当前是第几轮。
- 哪些 Agent 正在工作。
- 是否等待用户。
- 是否失败或达到轮次上限。

### 8.4 节点进度

Workflow Activity 使用紧凑步骤条：

```text
编写 ✓ → 评审 ● → 判定 ○ → 修改 ○
```

状态：

- `queued`
- `waiting-agent`
- `running`
- `waiting-reviewers`
- `waiting-human`
- `succeeded`
- `failed`
- `skipped`
- `review-limit-reached`

颜色只用于状态，不为角色新增装饰色。复用现有：

- working：黄色 spinner
- waiting / permission：琥珀色
- blocked / failed：红色
- idle：中性灰
- done：绿色完成标记

### 8.5 与 Agent Activity 联动

- 点击 Workflow 节点，Agent Activity 定位并高亮对应 Agent。
- 点击 Agent Activity 行，中间窗口打开对应 Step Run 详情或现有 Agent Terminal。
- Workflow Agent 行显示所属 Workflow 和节点名称。
- 一个 Agent 同时只能拥有一个“立即执行”的 Workflow Step。
- Agent 被排队时显示队列位置或“等待当前任务完成”。

### 8.6 等待用户

出现下列情况时 Workflow Activity 必须显示持久操作区：

- 判定 Agent 请求人工决定。
- Reviewer 意见冲突且策略要求人工处理。
- 达到最高评审轮次。
- Agent 等待权限。
- Agent 身份失效，需要重新分配。
- Worker 失败且自动重试耗尽。

等待原因和动作使用冻结枚举：

```ts
type WorkflowWaitingReason =
  | 'review-request-human'
  | 'review-revision-required'
  | 'review-conflict'
  | 'review-limit-reached'
  | 'agent-unavailable'
  | 'lifecycle-mismatch'
  | 'permission-required'
  | 'transport-disconnected'
  | 'reviewer-retry-exhausted'
  | 'decision-invalid'
  | 'delivery-uncertain'
  | 'artifact-unavailable'
  | 'artifact-drifted'
  | 'completion-incomplete'

type WorkflowResolutionAction =
  | 'view-evidence'
  | 'approve'
  | 'revise'
  | 'continue-round'
  | 'retry-step'
  | 'retry-with-duplicate-risk'
  | 'reassign-agent'
  | 'wait-for-reconnect'
  | 'resolve-permission'
  | 'regenerate-artifact'
  | 'end-workflow'
```

合法动作矩阵：

| waiting reason             | 合法变更动作                                                                       | 禁止动作和前置条件                                            |
| -------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `review-request-human`     | `approve`、`revise`、`end-workflow`                                                | 必须有 Review Aggregate；需要理由                             |
| `review-revision-required` | `approve`、`revise`、`end-workflow`                                                | `revise` 执行原 Decision 的 revise Transition；人工覆盖需理由 |
| `review-conflict`          | `approve`、`revise`、`retry-step`、`end-workflow`                                  | 必须展示冲突原文；需要理由                                    |
| `review-limit-reached`     | `continue-round`、`approve`、`end-workflow`                                        | `continue-round` 明确扩展一轮；需要确认                       |
| `agent-unavailable`        | `reassign-agent`、`retry-step`、`end-workflow`                                     | 新 Agent 必须通过 Assignment 校验                             |
| `lifecycle-mismatch`       | `reassign-agent`、`end-workflow`                                                   | 禁止向原 Pane 重试，禁止人工通过                              |
| `permission-required`      | `resolve-permission`、`retry-step`、`end-workflow`                                 | 权限未解除前不能重试或通过                                    |
| `transport-disconnected`   | `wait-for-reconnect`、`reassign-agent`、`end-workflow`                             | 有未决交付时禁止重派                                          |
| `reviewer-retry-exhausted` | `retry-step`、`reassign-agent`、`end-workflow`                                     | 必需 Reviewer 不得被人工跳过                                  |
| `decision-invalid`         | `retry-step`、`reassign-agent`、`approve`、`revise`、`end-workflow`                | 人工决定需要理由和 Aggregate                                  |
| `delivery-uncertain`       | `view-evidence`、`wait-for-reconnect`、`retry-with-duplicate-risk`、`end-workflow` | 禁止人工通过；风险重试需二次确认                              |
| `artifact-unavailable`     | `regenerate-artifact`、`retry-step`、`end-workflow`                                | 禁止 Review 和人工通过                                        |
| `artifact-drifted`         | `regenerate-artifact`、`end-workflow`                                              | 禁止继续使用旧 Revision                                       |
| `completion-incomplete`    | `view-evidence`、`retry-step`、`reassign-agent`、`end-workflow`                    | 禁止从摘要推断完成或人工通过                                  |

所有等待状态都可执行只读 `view-evidence`，表中只列状态变更动作。

Engine 必须通过 `workflow.runShow` 返回合法动作 Offer：

```ts
type WorkflowResolutionContext = {
  originDecisionStepId: string
  originDecisionNodeId: string
  reviewNodeId: string
  artifactRevisionId: string
  approveTransitionId: string
  reviseTransitionId: string
}

type WorkflowResolutionOffer = {
  id: string
  runId: string
  waitingReason: WorkflowWaitingReason
  action: WorkflowResolutionAction
  originDecisionStepId: string
  reviewNodeId: string
  resolutionTransitionId:
    | WorkflowResolutionContext['approveTransitionId']
    | WorkflowResolutionContext['reviseTransitionId']
    | 'run-resolution:end-workflow'
  expectedRunVersion: number
  preconditions: string[]
  requiresReason: boolean
  requiresConfirmation: boolean
  requiredPermission: 'workflow-operate' | 'workflow-approve'
  expiresAt: string
}
```

`workflow.runResolve` 只接受 Engine 当前返回且未过期的 Offer ID，并重新验证 waiting reason、Run 版本、权限和前置条件。客户端不能直接提交任意目标状态。

进入 `waiting-human` 或 `review-limit-reached` 前，Engine 必须持久化 `WorkflowResolutionContext`。Offer 生成规则：

- `approve`：`resolutionTransitionId = approveTransitionId`，执行原 Decision 节点的 `decision:approve` Transition。
- `revise`：`resolutionTransitionId = reviseTransitionId`，执行原 Decision 节点的 `decision:revise` Transition。
- `continue-round`：同样绑定 `reviseTransitionId`，先把当前 `reviewNodeId` 的有效上限只增加一轮，再创建该 Transition 指向的 Produce/Revise Step；新 Artifact 成功后才能开始下一轮 Review。
- `end-workflow`：`resolutionTransitionId = run-resolution:end-workflow`，Run 进入 `cancelled`，并保存 termination reason。

`WorkflowTransitionV1.from` 仍只声明模板节点。Run 级人工决议不伪造一个“来源为 Run 状态”的普通 Transition，而是通过持久化 Context 安全重放 origin Decision 已冻结的 approve/revise Transition；只有 `end-workflow` 使用保留的 Run 终态 Transition。

因此：

- `SPEC → 实现完整流程` 在 SPEC 阶段人工 `approve` 必须执行 `spec-decision-approved`，进入 `code-produce`。
- 同一模板在代码阶段人工 `approve` 执行 `code-decision-approved`，进入 Complete。
- SPEC 阶段 `continue-round` 执行 `spec-decision-revise`，代码阶段执行 `code-decision-revise`。
- 不允许根据当前页面、节点名称或固定“完成”目标猜测下一步。

审计至少保存操作者、权限、原因、Offer、前后状态、关联 Step/Aggregate/Artifact、时间和幂等键。

不得在没有持久状态时只通过 Toast 提示。

## 9. Agent Activity 扩展

### 9.1 保留现有模型

继续保留：

- attention
- working
- idle
- completed
- 生命周期身份
- Provider Session 校验
- 当前优先去重
- 展开和复制最终结论
- 安全导航

Workflow 不得重新实现 Agent 当前状态判定。

### 9.2 Workflow 展示信息

参与 Workflow 的当前 Agent 行增加：

- Workflow 名称
- 节点名称
- 当前轮次
- 当前 Step 状态
- 结论已发送到哪个节点

示例：

```text
Claude · 评审 Agent                 已完成
需要修改，发现 3 个问题
SPEC 工作流 · 第 1 轮
已发送至：判定 Agent
[展开] [复制]
```

### 9.3 Agent 拖拽

仅当前 Agent 行可拖拽。

拖拽开始时携带受限的内部 assignment payload，不能把完整 Prompt、凭据或会话内容放入浏览器通用 DataTransfer。

拖拽结束后：

- 校验目标节点。
- 写入 Workflow Run Draft。
- 显示成功分配。

是否允许开始拖拽只依据 Agent Activity 当前行的 idle 状态，不在落槽时重复做 Agent 状态、
lifecycle 或 Provider Session 资格判断。运行前检查和实际 Dispatch 仍必须重新解析终端 Handle、
确认 Agent 当前可用，失败时不得发送 Prompt。

### 9.4 最终结论

Workflow 节点完成时必须保存 Agent 的完整最终结论。

要求：

- Copy 按钮和 Workflow 交接使用同一份持久化内容。
- 不从渲染后的 DOM 中复制。
- 不使用截断预览。
- 不使用 synthetic idle/status 文案。
- interrupted、cancelled 和 failed 不能作为成功结论。
- 缺少完整结论时，Step 进入 `completion-incomplete`，不能静默推进。
- 内容过大时，消息保存摘要并通过 Artifact 引用完整报告。

### 9.5 完成信号与完整内容来源

Workflow 以 Engine 批准路径中的合法结构化结果作为完成信号和完整结论来源：

- Agent 只提交不含系统身份字段的版本化业务结果。
- Engine 校验结果文件后补入 Task、Dispatch、Run、Step、lifecycle、Provider Session 和 Host。
- Engine 在内部生成 `worker_done` 审计回执并推进 Orchestration Task，Agent 不调用 Orca CLI。
- 旧运行显式发送的 `worker_done` 继续兼容，但正文、终端截屏或 Agent Activity 预览不能冒充完整结论。

Workflow 使用版本化完成信封：

```ts
type WorkflowCompletionEnvelopeV1 = {
  schema: 'workflow.completion/v1'
  taskId: string
  dispatchId: string
  workflowRunId: string
  stepRunId: string
  agentLifecycleId: string
  providerSessionId: string | null
  executionHostId: string
  outcome: 'succeeded' | 'failed'
  summary: string
  finalConclusionMarkdown: string
  artifacts: Array<{
    kind: 'spec' | 'code' | 'review-report' | 'test-report'
    locator: Record<string, unknown>
  }>
  validations: Array<{
    command: string
    result: 'passed' | 'failed' | 'not-run'
    evidence: string
  }>
  unresolved: string[]
  readyForNextStep: boolean
}
```

完整内容来源按以下优先级解析：

1. `reportPath` 指向的精简或完整 `workflow.completion/v1` JSON。
2. 兼容旧运行时，与当前 Dispatch 和 Provider Session 精确绑定、可证明未裁剪的 Agent 最终消息。
3. 兼容旧运行时，`orchestration.workerRead` 的 structured transcript 结果，仅当来源身份匹配、已读到完整最终消息且 `limited=false`、无裁剪警告。

要求：

- `reportPath` 必须在 Execution Host 上读取，经过允许路径、文件类型、大小、Schema 和 digest 校验。
- 远程 `reportPath` 不得在本机文件系统直接打开。
- Agent 写入的精简结果不得包含系统身份字段；Engine 扩展后的完整信封必须通过同一 Schema 和身份校验。
- `workerRead` 的 terminal fallback 只能作为诊断证据，不能作为完整结论。
- Provider 不支持 transcript、Session 不匹配、消息分页未读完、存在裁剪警告或无法判断最终消息时，不得降级使用摘要。
- 完整信封必须校验 taskId、dispatchId、stepRunId、lifecycle、Provider Session 和 Host。
- 校验成功后，在 Step 成功前把完整 JSON 和 Markdown 复制进 `workflow_messages`，保存 source、digest 和原始 Artifact 引用。
- 内容不可读、缺失、Schema 非法或身份不匹配时进入 `completion-incomplete`。

### 9.6 评审和判定结果 Schema

Reviewer 不返回需由中文自由文本推断的决定。统一使用：

```ts
type WorkflowReviewResultV1 = {
  schema: 'workflow.review-result/v1'
  taskId: string
  dispatchId: string
  workflowRunId: string
  stepRunId: string
  agentLifecycleId: string
  providerSessionId: string | null
  executionHostId: string
  artifactRevisionId: string
  verdict: 'approve' | 'revise' | 'request-human'
  issues: Array<{
    id: string
    severity: 'blocker' | 'major' | 'minor' | 'suggestion'
    location: string
    evidence: string
    recommendation: string
  }>
  unverified: string[]
  conclusionMarkdown: string
}

type WorkflowDecisionResultV1 = {
  schema: 'workflow.decision/v1'
  taskId: string
  dispatchId: string
  workflowRunId: string
  stepRunId: string
  agentLifecycleId: string
  providerSessionId: string | null
  executionHostId: string
  reviewAggregateId: string
  decision: 'approve' | 'revise' | 'request-human' | 'stop-at-review'
  revisionItems: string[]
  conflicts: string[]
  rationale: string
}
```

Review 与 Decision JSON 使用与完成信封相同的来源绑定、未裁剪校验和持久化规则。Schema 非法时 Step 失败或进入 `completion-incomplete`，不得从 `conclusionMarkdown` 猜测决定。

## 10. Agent 之间的交接内容

### 10.1 基本原则

Agent Activity 的完整最终结论是主要交接内容；Workflow 元数据负责控制下一步；真实文件和代码负责事实校验。

每个节点收到：

```text
原始任务目标
+ 当前项目与工作区
+ 当前工作流、节点和轮次
+ 上游 Agent 的完整最终结论
+ 相关 Artifact
+ 本节点角色 Prompt
+ 输出要求
```

### 10.2 不模拟 UI 复制粘贴

系统不得真的点击“复制”按钮再粘贴。

正确实现：

1. Agent 完成时持久化完整结论。
2. Workflow Engine 读取同一条持久化结论。
3. 生成下游节点 Prompt。
4. 通过 Orchestration Dispatch 定向发送。
5. Copy 按钮读取同一条结论供用户使用。

### 10.3 产出 Agent 输出合同

产出节点 Prompt 必须要求 Agent：

1. 生成不含系统身份字段的精简 `workflow.completion/v1` JSON。
2. 将完整结论、Artifact、验证和未解决项写入 Engine 批准的 `reportPath`。
3. 先完成临时文件，再原子替换目标结果文件。
4. 不调用 Orca CLI，不发送 heartbeat、ask、escalation、check 或 `worker_done`。
5. Engine 自动补入身份字段、生成内部完成回执并推进。

SPEC 与代码产出共用完成信封；差异由 Artifact kind、Prompt key 和节点输出要求表达。

### 10.4 评审 Agent 输出合同

评审节点 Prompt 必须要求 Agent：

1. 生成 `workflow.review-result/v1` JSON。
2. 使用枚举 `approve`、`revise` 或 `request-human`。
3. 每个问题包含稳定 ID、严重级别、位置、证据和建议。
4. 明确记录未运行或无法确认的验证。
5. 把人类可读全文写入 `conclusionMarkdown`。

系统只读取合法 JSON 的 `verdict` 做状态转换，不从中文或 Markdown 推断。

### 10.5 多 Reviewer 汇总

多个 Reviewer 并行完成后，系统把完整结论按来源分块：

```text
【Reviewer A】
...

【Reviewer B】
...
```

随后：

- 没有判定 Agent时，由确定性规则处理。
- 有判定 Agent时，将分块结论发送给判定 Agent。
- 判定 Agent 输出去重后的问题、冲突意见、最终决定和修改清单。
- 原产出 Agent 只接收汇总后的修改清单，同时保留查看原始 Review 的链接。

## 11. 判定策略

### 11.1 确定性规则优先

默认规则：

- 所有必需 Reviewer 都通过：完成或进入下一阶段。
- 任一 Reviewer 报告 blocker：需要修改。
- Reviewer 未全部完成：继续等待。
- Reviewer 失败：按配置重试；耗尽后等待用户。
- 意见冲突：调用判定 Agent 或等待用户。
- 达到最高轮次：`review-limit-reached`。

### 11.2 判定 Agent

判定 Agent是可选节点。

只能返回：

```ts
type WorkflowDecision = 'approve' | 'revise' | 'request-human' | 'stop-at-review'
```

判定 Agent不能：

- 创建任意新节点。
- 修改最高轮次。
- 跳过人工 Gate。
- 自动合并代码。
- 自动批准高风险操作。
- 把不存在的节点作为下一步。

输出不合法时，Step 失败并进入重试或人工处理，不能猜测决定。

## 12. 评审轮次

### 12.1 定义

`maxReviewRounds` 表示单个 Review 节点最多执行多少次评审，不是 Worker 重试次数。

Run 按 `reviewNodeId` 分别保存轮次。只有一个 Review 节点的模板可以在 UI 简写为“当前轮次”；`SPEC → 实现完整流程` 必须分别显示 SPEC Review round 和代码 Review round。

例如 `maxReviewRounds = 3`：

```text
产出 V1 → 第 1 轮评审
修改 V2 → 第 2 轮评审
修改 V3 → 第 3 轮评审
第 3 轮仍需修改 → 停在最终评审
```

不得创建第 4 次修改任务。

### 12.2 达到上限

状态：

```text
review-limit-reached
```

右侧显示：

- 最终 Review 结论。
- 未解决问题数量。
- 当前 Artifact。
- 继续一轮。
- 人工通过。
- 结束 Workflow。

“继续一轮”是明确的用户动作，并写入事件记录。

## 13. Artifact 和代码安全

### 13.1 Artifact

每轮产出必须生成 Artifact Revision：

```ts
type WorkflowArtifactRevision = {
  id: string
  kind: 'spec' | 'code' | 'review-report' | 'test-report'
  revision: number
  executionHostId: string
  worktreeId: string
  locator: Record<string, unknown>
  digest: string
  manifestDigest: string
  snapshotState: 'frozen' | 'drifted' | 'unavailable'
  producedByStepRunId: string
}
```

M2 起 Artifact Revision 必须是不可变、内容寻址的快照，不能只记录当前文件的 Hash 后继续让 Reviewer 读取可变化的工作目录。

快照 Manifest 至少包含：

```ts
type WorkflowArtifactManifestV1 = {
  schema: 'workflow.artifact-manifest/v1'
  executionHostId: string
  workspaceId: string
  entries: Array<{
    path: string
    kind: 'file' | 'git-diff'
    size: number
    digest: string
    blobId: string
  }>
}
```

Blob 由负责执行的 Runtime Host 保存。Reviewer 读取 Manifest 引用的内容寻址 Blob，不读取同路径的实时文件。

如果文件过大、权限不足、远程能力不支持或内容无法冻结：

- Artifact 标记为 `unavailable`，Step 不能成功。
- 若只具备实时文件读取能力，必须在 Review 前后对照 Manifest 检测漂移。
- 一旦漂移，标记为 `drifted` 并停止 Review。
- 不得继续声称 Reviewer 基于固定 Revision。

### 13.2 SPEC

至少保存：

- 文件路径
- 内容摘要
- 内容 Hash
- 完整内容 Blob
- 版本号
- 产出 Step

Reviewer 必须读取对应版本的内容 Blob；路径只用于展示和回到工作区定位。

### 13.3 代码

Git Worktree 至少保存：

- Base SHA
- Head SHA
- Diff Hash
- 完整 Diff Blob
- Review 涉及文件的内容 Blob 或可由固定提交完整重建的定位信息
- 修改文件
- 未提交变更状态
- 产出 Worktree

Folder Workspace 至少保存：

- 相关文件清单
- 每个文件的内容 Blob 和 Hash
- 修改时间
- Manifest digest

仅保存文件清单、Hash 和修改时间不构成固定 Revision。

### 13.4 Reviewer 隔离

代码实现 Agent 独占可写实现工作区。

Reviewer 默认：

- 只读评审固定 Artifact Revision。
- 不与实现 Agent 同时修改同一实现工作区。
- Git 项目优先使用隔离 Review Worktree 或固定 Diff 快照。
- Review Worktree 的变更不自动合入实现工作区。
- Folder Workspace 使用快照和变更检测降级。

发现 Reviewer 修改实现工作区时：

- 标记 Review 违反只读约束。
- 不自动执行破坏性回滚。
- 等待用户确认如何处理。

## 14. 状态模型

### 14.1 Workflow Run 状态

```ts
type WorkflowRunStatus =
  | 'draft'
  | 'ready'
  | 'running'
  | 'paused'
  | 'waiting-human'
  | 'review-limit-reached'
  | 'completed'
  | 'failed'
  | 'cancelled'
```

### 14.2 Step Run 状态

```ts
type WorkflowStepRunStatus =
  | 'queued'
  | 'waiting-agent'
  | 'delivering'
  | 'running'
  | 'completion-incomplete'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled'
```

### 14.3 状态权威

- Renderer 只展示和请求操作。
- Workflow Engine 是 Workflow 状态权威。
- Orchestration Dispatch 是 Agent 任务生命周期权威。
- Agent lifecycle store 是当前 Agent 身份权威。
- Workflow Event 记录是恢复和审计依据。

页面关闭、Renderer 刷新或切换 activeView 不得停止 Workflow。

## 15. 持久化记录

### 15.1 表结构

在现有 Runtime SQLite 中增加独立表：

```text
workflow_templates
workflow_template_versions
workflow_runs
workflow_step_runs
workflow_agent_assignments
workflow_messages
workflow_artifact_revisions
workflow_events
```

不得把所有内容塞入现有 `tasks.result`。

### 15.2 Workflow Template

保存：

- 模板 ID
- 名称
- 范围
- 当前版本
- Definition JSON
- 创建、更新时间
- 是否内置
- 是否归档

### 15.3 Workflow Run

保存：

- 根目标
- 项目和工作区
- Execution Host
- 模板完整快照
- 当前节点
- `reviewRoundsByNodeId`
- 每个 Review 节点的有效最大轮次
- 当前 `WorkflowResolutionContext`
- `reviewRoundLimitOverridesByNodeId`
- 状态
- 开始、结束时间
- 当前 Orchestration Run ID

### 15.4 Step Run

保存：

- Node ID
- 轮次
- 尝试次数
- Agent Assignment
- Task ID
- Dispatch ID
- 实际发送 Prompt
- 版本化 Completion / Review / Decision JSON
- 完整最终结论 Markdown
- 完整内容来源：reportPath / agent-final-message / workerRead transcript
- 来源 identity、digest、读取警告和是否裁剪
- 状态
- 开始、结束时间
- 输入和输出 Artifact

### 15.5 Workflow Event

按 Run 单调递增序号保存：

```text
run-created
template-applied
agent-assigned
run-started
prompt-delivery-started
prompt-delivered
step-working
step-completed
review-collected
review-aggregate-created
decision-made
revision-requested
human-action
agent-reassigned
step-retried
run-paused
run-resumed
run-completed
run-failed
run-cancelled
completion-incomplete
artifact-drifted
resolution-offered
resolution-rejected
```

状态更新和 Event 写入必须在同一 SQLite 事务中完成。

### 15.6 回顾和导出

Run history 中按时间线展示：

- 事件时间
- 节点
- Agent
- 输入 Prompt
- 最终结论
- Artifact
- 状态变化
- 用户操作

支持导出：

- Markdown：供人阅读。
- JSON：供审计和后续工具处理。

默认不导出凭据、环境变量或未脱敏 Terminal 内容。

## 16. Workflow Engine

### 16.1 职责

Workflow Engine 负责：

- 校验模板。
- 创建 Run。
- 计算可运行节点。
- 创建或复用 Orchestration Task / Dispatch。
- 等待目标 Agent 可接收任务。
- 生成节点 Prompt。
- 接收完成结论。
- 聚合 Review。
- 执行判定。
- 控制评审轮次。
- 处理重试、暂停和恢复。
- 写入完整事件。

### 16.2 发送 Prompt

UI 的一次“运行”不能直接对所有 Terminal 做裸写入。

每个节点发送流程：

```text
节点 ready
→ 校验 Assignment
→ 解析精确终端
→ 校验 Agent lifecycle
→ 等待 Agent idle / 可接收
→ 创建 Task 和 Dispatch
→ 生成完整 Prompt
→ 通过受保护发送提交
→ 保存 delivery receipt
→ Step 进入 running
```

### 16.3 复用现有能力

优先复用：

- `orchestration.workerStart`
- `orchestration.dispatch`
- `terminal.agentStatus`
- `terminal.wait`
- guarded `terminal.send`
- `worker_done`
- `orchestration.workerRead`
- Dispatch capability
- Federation Relay
- Runtime Host 路由

普通“发送 Notes”能力可以用于第一阶段验证和人工补充消息；正式节点派发必须落到 Orchestration Task / Dispatch，确保身份、完成和恢复可追踪。

完成侧边界：

- `worker_done` 提供带 taskId/dispatchId 的完成权威和三句话摘要。
- `orchestration.workerRead` 提供按 Dispatch 读取 structured transcript 或 terminal fallback 的观察能力。
- 两者都不自动等于完整 Workflow 结论；Engine 必须按 9.5 生成和校验版本化完成信封。
- workerRead 返回 terminal fallback、裁剪或来源不确定时，只能用于诊断。

### 16.4 已完成 Agent 的再次使用

`worker_done` 后旧 Dispatch 已结束。

修改轮次必须：

1. 创建新的 Step Run。
2. 创建新的 Task / Dispatch。
3. 优先复用原 Agent Terminal。
4. 原 Agent 已关闭时，按模板策略重新分配或创建同类型 Agent。
5. 注入当前 Artifact 和汇总 Review。

不得继续把新任务写入已完成 Dispatch。

### 16.5 防重复

每次 Prompt 交付使用唯一 `deliveryId`。

唯一约束至少覆盖：

```text
(workflowRunId, stepRunId, attempt, deliveryKind)
```

应用重启后：

- 已记录 delivered 的 Prompt 不重新发送。
- delivery 状态不确定时先检查 Dispatch 和 Agent 状态。
- 无法确认时进入人工处理，不盲目重复发送。

## 17. 第一阶段验证：发送 Hi

### 17.1 目的

在实现完整 Workflow 前，验证以下最核心链路：

```text
Agent Activity 指定 Agent
→ 一次点击
→ 精确终端校验
→ 发送 `hi`
→ Agent 状态变化
→ Agent 返回最终结论
→ Agent Activity 可查看和复制
```

本阶段只验证链路，不创建 Workflow Run。2026-07-28 手工验证已通过，证明 Orca 支持从 Agent Activity 精确定位目标 Agent 并通过一次操作发送 Prompt。

该结果只证明定向发送链路可用，不代表 Workflow 状态机、自动推进、重启恢复或多 Agent 调度已经完成。

### 17.2 UI

在 Agent Activity 的当前 `idle` Agent 行增加一个小型验证按钮。

要求：

- 默认在 hover 或键盘聚焦时显示。
- 使用现有 `Button` 的 `icon-xs` 或同等级小尺寸。
- 使用 Lucide 消息类图标。
- Tooltip：`发送 Hi`。
- 无额外确认 Dialog。
- 发送中显示局部 spinner，并暂时禁用重复点击。

示例：

```text
Codex · Idle                         [发送 Hi]
```

### 17.3 可用条件

按钮只对以下 Agent 可用：

- 当前 Agent。
- 状态为 `idle`。
- Worktree 存在。
- Pane 和 PTY 存在。
- Agent lifecycle 存在。
- Execution Host 可达。
- Agent 没有等待权限。

以下状态禁用：

- working
- waiting / permission
- blocked
- transport disconnected
- completed history
- Pane unavailable
- identity ambiguous

Tooltip 或行内文案解释禁用原因。

### 17.4 发送内容

固定发送：

```text
hi
```

不得附加 Workflow Prompt、测试结论或其他隐式任务。

### 17.5 发送实现

复用现有定向 Agent Notes 发送链路：

1. 从 Agent Activity Item 取得 worktree 和 pane identity。
2. 解析 `tabId + leafId`。
3. 按 Worktree Owner Host 路由 Runtime。
4. 查找精确 Terminal Handle。
5. 重新校验 Agent lifecycle 和 Agent send readiness。
6. 通过 guarded bracketed paste + Enter 发送。
7. 显示发送结果。

不得：

- 通过 DOM 模拟键盘。
- 只依赖 Terminal 标题。
- 向普通 Shell 写入。
- 在身份变化后继续发送。
- 一次点击产生两次 Enter。

### 17.6 反馈

发送成功：

```text
Hi 已发送
```

发送失败必须区分：

- Agent 已关闭。
- Agent 正在工作。
- Agent 等待权限。
- Agent 身份已变化。
- Terminal 不可写。
- Runtime 不可达。
- 发送部分成功但提交失败。

### 17.7 验收标准

1. 存在多个 Agent 时，只向被点击的 Agent 发送 `hi`。
2. 目标 Agent 收到且只收到一次 `hi`。
3. 其他 Agent 和普通 Shell 不收到内容。
4. 目标 Agent 从 idle 进入 working，完成后回到 done / idle 的现有状态链路。
5. Agent 最终回复继续出现在 Agent Activity 中。
6. 最终回复可以展开和复制。
7. 发送中重复点击不会造成重复 Prompt。
8. Agent lifecycle 在发送前变化时拒绝发送。
9. waiting、blocked、working、disconnected 和 completed 行不可发送。
10. 本机路径通过；SSH Workflow 不进入派发并返回明确能力错误。

### 17.8 实际结果

- 状态：通过。
- 验证日期：2026-07-28。
- 已确认能力：从 Agent Activity 触发操作，可向对应活跃 Agent 发送固定内容 `hi`。
- 后续用途：该链路作为 Workflow 节点 Prompt 定向派发的技术基础。
- 未由本次验证覆盖的 Workflow 能力已由后续里程碑自动化收口；SSH / Runtime Host 仍属于范围外能力。

## 18. Runtime RPC

建议增加 Workflow 专用 RPC：

### 18.1 Template

```text
workflow.templateList
workflow.templateShow
workflow.templateCreate
workflow.templateUpdate
workflow.templateClone
workflow.templateArchive
```

### 18.2 Run

```text
workflow.runCreate
workflow.runAssign
workflow.runStart
workflow.runPause
workflow.runResume
workflow.runCancel
workflow.runShow
workflow.runList
workflow.runEvents
workflow.runResolve
workflow.stepRetry
workflow.stepReassign
```

要求：

- 写操作进入现有 mutation ledger。
- 所有写操作幂等。
- 每个请求验证 Run、项目、工作区和调用者权限。
- Read RPC 不依赖 Renderer 直读数据库；SSH / Runtime Host 支持移至未来需求。
- 不允许 Renderer 直接写 SQLite。
- `workflow.runShow` 返回 Engine 计算的 `WorkflowResolutionOffer[]`。
- `workflow.runResolve` 只接受当前 Offer ID、动作所需参数和幂等键；不得接受任意目标状态。
- `workflow.runResolve` 重新验证 Offer 期限、Run 版本、waiting reason、权限和前置条件。
- `workflow.runResolve` 校验 resolutionTransitionId 确实属于 origin Decision：approve 对应 `decision:approve`，revise/continue-round 对应 `decision:revise`。

## 19. 重启与恢复

Runtime 启动后扫描非终态 Workflow Run：

1. 读取最后状态和事件。
2. 对照 Orchestration Task / Dispatch。
3. 对照 Worker 状态。
4. 对照 Agent lifecycle。
5. 恢复可确定状态。
6. 无法确定时进入 `waiting-human`。

恢复要求：

- 不重复发送 Prompt。
- 不重复增加评审轮次。
- 不把旧 Dispatch 的迟到 `worker_done` 计入当前轮次。
- 不把已关闭 Agent 的 Pane 重用当作同一 Agent。
- 本机恢复遵循上述合同；Remote / SSH 恢复语义留给未来独立需求。

## 20. 项目、Worktree 与 Folder Workspace

### 20.1 模板范围

模板支持：

- 内置模板：所有项目可见。
- 个人模板：当前 Orca 用户可见。
- 项目模板：绑定 Project Identity。

第一版项目模板保存在 Runtime SQLite，不要求写入仓库。

范围与删除语义：

| 范围 | 所有者与可见性            |       可编辑 | 删除语义                                 |
| ---- | ------------------------- | -----------: | ---------------------------------------- |
| 内置 | Orca 发布版本，全项目可见 | 否，只能复制 | 不可删除，可由新版本迁移或弃用           |
| 个人 | 当前 Orca 用户            |           是 | “删除”实际归档并从默认列表隐藏           |
| 项目 | 精确 Project Identity     |           是 | “删除”实际归档，不影响其他项目或已有 Run |

要求：

- 创建项目模板时必须保存 Project Identity，不能只保存可变化的路径或仓库显示名。
- 复制内置模板时用户明确选择个人或当前项目范围。
- 不允许把项目模板静默移动到另一个项目；跨范围使用必须复制出新模板。
- 自定义模板的第一版“删除”是可恢复归档，不做物理删除。
- 已归档模板不能创建新 Draft，但已有 Draft、Run、版本快照和历史继续可读。
- 存在运行中 Run 时允许归档模板，但不影响该 Run 的模板快照。
- 模板列表、搜索、项目切换和 RPC 都必须执行范围过滤。

### 20.2 Run 范围

每个 Run 必须绑定：

- Project Identity
- Worktree / Folder Workspace ID
- Execution Host ID
- 模板版本快照

### 20.3 Git Worktree

- 产出节点可以复用当前 Worktree。
- 并行写入节点必须使用不同 Worktree。
- Review 节点优先只读或隔离 Worktree。
- 所有 Git 命令保持 Git 2.25 基线兼容。
- 不假设 GitHub；Review 术语保持 Provider 中立。

### 20.4 Folder Workspace

- 不要求 Git SHA。
- 使用文件 Artifact Revision。
- 不创建 Git Worktree。
- 写入节点默认串行，避免同目录并发修改。
- Reviewer 只读约束通过 Prompt、快照和变更检测实现。

### 20.5 SSH / Remote（未来扩展，不属于当前完成范围）

- 当前 Workflow preflight 对 SSH 安全拒绝，不创建或派发 SSH Step。
- Runtime Host / Relay 的跨 Host 验证，以及未来重新启用 SSH 时的 Execution Host、远程 Artifact 和 Host 隔离合同，另立需求处理。

## 21. 运行控制

### 21.1 Pause

Pause：

- 阻止新 Step Dispatch。
- 不强制中断已经运行的 Agent。
- 当前 Agent 完成后保存结果，但不推进下一节点。

### 21.2 Resume

Resume：

- 重新校验所有 Assignment。
- 处理已完成但尚未推进的 Step。
- 继续可运行节点。

### 21.3 Cancel

Cancel 是重要操作：

- 需要确认。
- 停止创建新 Dispatch。
- 对运行中 Agent 的处理必须明确选择“保留运行”或“请求停止”。
- 不自动删除 Worktree 或回滚文件。
- 保存取消原因和用户选择。

### 21.4 Retry

Retry：

- 创建新的 Step attempt。
- 旧 attempt 保留。
- 使用新 Dispatch ID。
- 不覆盖旧结论。
- 不增加 review round，除非确实重新进行了完整 Review。

## 22. UI 与设计系统

- 遵循 `docs/STYLEGUIDE.md`。
- 使用 `src/renderer/src/assets/main.css` 的现有 Token。
- 使用 `src/renderer/src/components/ui/` 的 shadcn primitives。
- 不新增硬编码颜色、字体大小或阴影层级。
- 颜色只表达状态。
- 拖拽目标必须有键盘和点击替代方案。
- 长 Prompt 和结论在中间窗口查看，右侧只显示摘要。
- 重要错误和等待用户状态持久显示，不只使用 Toast。
- 低频操作进入 `...` 菜单。
- 主操作每个状态最多一个：
  - 模板编辑：保存
  - 运行准备：运行
  - 等待人工：提交决定
- 所有平台快捷键使用平台判断，不硬编码 `metaKey`。
- 新增文件按具体职责命名，不使用 `helpers`、`utils`、`common`。
- 不增加任何 `max-lines` disable 或 per-file 上限放宽。

## 23. 可访问性

- 所有节点可通过键盘选择和移动。
- Agent 分配不依赖拖拽。
- Workflow 步骤条提供文本状态。
- 状态图标具有 accessible label。
- 发送 Hi 按钮具有清晰名称。
- Dialog / Sheet 使用正确焦点管理。
- Error、waiting 和 completed 不只依赖颜色区分。
- Screen reader 可以读出当前 Workflow、节点、轮次和 Agent。

## 24. 测试要求

### 24.1 Workflow Definition

- 合法内置模板。
- 完整 discriminated-union Schema 的必填字段和未知字段拒绝。
- Node、Role Slot、Transition ID 唯一性。
- 缺少完成节点。
- 无退出循环。
- 非法决定目标。
- 多 Reviewer 配置。
- Retry attempt 与 Review round 配置分离。
- `WorkflowReviewPolicyV1` 同时验证 minReviewers、completion、失败策略、timeoutMs 和 maxReviewRounds。
- 三个内置模板固定 `wait-human / 3600000ms / 3 rounds`。
- 三个内置模板标准 JSON 的完整快照。
- `SPEC → 实现完整流程` 的 SPEC 通过后进入实现、代码评审通过后进入完成。
- 内置、个人、项目模板范围过滤和 Project Identity 绑定。
- 自定义模板归档后不能新建 Draft，但历史 Run 可读。
- 版本快照不随模板编辑变化。

### 24.2 状态机

- 单产出、单 Review 通过。
- 单产出、多 Review 并行。
- Reviewer 乱序完成。
- 任一 blocker 触发修改。
- 判定 Agent 冲突处理。
- Review Aggregate 映射到冻结 waiting reason：request-human、revision-required、conflict。
- 达到最高轮次停在 Review。
- review-limit 的 approve 执行原 Decision approve Transition。
- review-limit 的 continue-round 扩展当前 Review 节点一轮并执行原 revise Transition。
- 组合模板 SPEC 阶段人工通过进入 code-produce，不直接完成。
- Retry 不错误增加 round。
- Pause 不派发新节点。
- Resume 恢复推进。
- Cancel 不删除 Artifact。

### 24.3 Prompt 交付

- 精确目标 Agent。
- lifecycle mismatch 拒绝。
- Provider Session mismatch 拒绝。
- busy Agent 排队。
- permission Agent 等待。
- terminal gone 重新分配。
- delivery 幂等。
- Runtime 重启不重复发送。

### 24.4 完成结果

- 合法结果文件由 Engine 转换为内部完成回执；Agent 不负责 `worker_done`。
- `reportPath` 完成信封的 Host、允许路径、Schema、身份和 digest 校验。
- `orchestration.workerRead` 仅接受未裁剪、来源匹配的完整最终消息。
- transcript 缺失、不可读、分页未完、terminal fallback 和裁剪警告进入 `completion-incomplete`。
- Completion、Review 和 Decision 使用版本化 JSON Schema。
- 中文或 Markdown 不用于推断 Review verdict。
- 完整结论保存。
- 截断预览不参与交接。
- synthetic 内容不参与交接。
- interrupted 不算成功。
- 大结果通过 Artifact 引用。
- Copy 和 Workflow Handoff 使用同一内容。
- Folder Workspace 与未提交 Git 内容生成内容寻址快照。
- Artifact 漂移或不可冻结时停止 Review。

### 24.5 数据库

- 新库建表。
- 从现有 schema 迁移。
- WAL 并发。
- 事务中状态和 Event 一致。
- 应用重启恢复。
- 数据库权限。
- 老用户没有 Workflow 数据时不影响普通启动性能。

### 24.6 Renderer

- Workflows 位于 Tasks、Automations 下方。
- Workflows 中间窗口路由正确。
- Workflows View 右侧面板可见。
- Workflow Activity 位于 Agent Activity 上方。
- 拖拽分配。
- 点击分配。
- 工作区切换保护。
- waiting reason 与合法动作矩阵。
- `workflow.runResolve` 只提交 Engine Offer。
- 项目模板范围、归档和历史读取。
- Run history 时间线。
- Send Hi 按钮状态与错误。
- Light / Dark。
- macOS 本机自动化。

### 24.7 Folder 与范围外 Host

- Folder Workspace 不执行 Git 假设。
- Folder Workspace 固定内容 Blob 与漂移停止。
- SSH Workflow 由 capability preflight 安全拒绝。
- Windows、Linux、WSL 和跨 Host 验证移至未来需求。

## 25. 里程碑实施与 SPEC 生命周期

### 25.1 文档职责

本文是主 SPEC，也是整体方案和实施状态的唯一事实来源，长期保留：

- 稳定的产品目标、信息架构和技术约束。
- 五个里程碑的顺序、状态和依赖关系。
- 已验收能力、实际实现偏差和仍未覆盖的边界。
- 最终 As-built 行为。

每个里程碑开始前创建一份临时里程碑 SPEC：

- 文件统一存放在 `docs/spec/`。
- 文件名遵循 `YYYY-MM-dd_<业务目标>.md`。
- 明确引用本文。
- 只描述该里程碑的范围、非目标、实现合同、任务拆分和验收标准。
- 不复制或建立另一套整体路线图。

### 25.2 完成、回写和删除规则

里程碑 SPEC 只有同时满足以下条件才能删除：

1. 该里程碑实现完成。
2. 自动化检查和当前里程碑约定的构建检查完成。
3. 验收结果明确为通过。
4. 稳定设计、实际偏差、关键决定、验收结论和遗留边界已经回写本文。
5. 本文的里程碑状态已经更新。

主 SPEC 更新和临时里程碑 SPEC 删除必须在同一次提交中完成。删除后由 Git 历史保留原始实施合同。

自动化或构建验收失败、部分完成时：

- 不删除里程碑 SPEC。
- 将真实状态记录为进行中或失败。
- 更新剩余工作和下一次验收条件。

### 25.3 Phase 0：定向发送验证

- 状态：已完成。
- 结果：从 Agent Activity 向指定活跃 Agent 发送 `hi` 已手工验证通过。
- 结论：定向 Prompt 发送链路可以作为后续 Workflow 派发基础。
- 边界：不代表工作流状态机和多 Agent 自动协作已经实现。

### 25.4 五个实施里程碑

| 里程碑                         | 临时 SPEC                                              | 状态                       | 完成出口                                                  |
| ------------------------------ | ------------------------------------------------------ | -------------------------- | --------------------------------------------------------- |
| M1 Workflows 信息架构与模板    | —（已清理）                                            | 已完成（代码与自动化）     | 模板可视化编辑、保存、应用并完成 Agent 分配，但不自动运行 |
| M2 单产出单评审运行闭环        | —（已清理）                                            | 验收通过，临时 SPEC 已清理 | 一个产出 Agent 和一个评审 Agent 可自动完成一次端到端运行  |
| M3 多 Agent 并行评审与意见汇总 | —（已清理）                                            | 已完成（代码与自动化）     | 多 Reviewer 基于同一产物并行评审并形成可追踪汇总          |
| M4 评审循环判定与人工控制      | —（已清理）                                            | 已完成（代码与自动化）     | 修改循环、轮次上限、判定 Agent 和人工 Gate 可用           |
| M5 工作流历史恢复与可靠性      | `docs/spec/2026-07-28_工作流历史恢复与跨环境可靠性.md` | 已完成（本机代码与自动化） | 历史、导出、恢复、防重复和本机 Workspace 合同完成         |

同一时间默认只实施一个里程碑；后一里程碑以前一里程碑验收通过为开始条件。

### 25.5 M1：Workflows 信息架构与模板

当前状态（截至 2026-07-31）：

- 共享 Schema、三个内置 JSON fixture、SQLite 模板/版本/Run/Assignment/Event、mutation ledger 和 M1 Runtime RPC 已实现。
- Workflows 顶级导航、模板工作区、Run setup、Workflow Activity、idle Agent 拖拽/点击入口、运行前检查和中英文界面已实现。
- 自动化 typecheck、完整 lint 和 67 项 M1 定向测试通过；Electron main、preload、renderer 构建通过。
- macOS 开发版已手工通过内置模板查看、复制、重命名保存 v2 和归档；测试模板已归档清理。
- macOS 开发版已在真实 Git Worktree 与 Folder Workspace 中确认 Host/Workspace 锁定；Git Draft 切到 Folder Workspace 后明确保留原锁定且不迁移，点击分配两个可证明 idle 的 Codex 后运行前检查进入 `ready`，未发送 Prompt。
- 2026-07-29 冷启动实机复验通过：身份不明确的历史 idle 条目仍被后端拒绝；当前 Codex 完成普通 bootstrap 后，从 Agent Activity 专用拖拽柄拖入 `SPEC 编写 Agent`，界面与 `workflow.runShow` 均返回同一 lifecycle assignment。该轮拖拽和点击选择器共用 `workflow.runAssign`，落槽时仍执行了 Host、Workspace、Pane 和实时 idle 校验。
- M1-A1 至 M1-A17 已全部通过；稳定合同与验收边界已回写主 SPEC，临时 M1 SPEC 按用户决定清理。
- 实际新增 `workflow.runUpdate` 与 `workflow.runPrepare` 以持久化任务目标和完成运行前检查；两者不发送 Prompt。工作区漂移当前支持切回原工作区或关闭设置并保留 Draft，显式放弃 Draft 的交互仍待联合验收。
- 2026-07-30 信息架构增补最初将 Workflows 作为固定中间工作区标签；2026-07-31 根据实际使用
  反馈收敛为按需打开的临时标签：只在进入配置或显式查看时出现，可关闭且不丢弃 Draft，运行成功
  启动后自动收起；分屏时只在聚焦 Pane 显示并承载页面。
- 右侧 Workflow Activity 标题栏已增加永久直接入口，空态、Draft、运行中和历史状态均可进入
  Workflows；入口与左侧导航和中间固定标签复用同一页面状态。
- 模板编辑已由原始 Definition JSON 文本框改为受约束的纵向步骤流：第一步自动作为起点，列表
  只展示步骤顺序、执行角色和结果去向；点击步骤后才从右侧 Sheet 编辑任务类型、角色、评审规则
  和流转。角色创建与容量设置已并入对应步骤，输入绑定、重试、超时和 Human Gate 原因等低频
  合同收进“高级运行设置”；新增步骤自动排在最终完成步骤之前。
- 界面文案使用“步骤、执行角色、结果与下一步”等任务语言，隐藏模板 Key、Transition ID、毫秒
  等实现细节；内置模板提供“复制后编辑”主操作，保存前继续以 Workflow Definition V1 Schema
  校验，不允许绕过运行时合同。
- 2026-07-31 运行入口完成职责拆分：右侧 Workflow Activity 直接选择模板，并以“配置并运行”
  显式创建 Draft；Draft / Ready 只保留“继续配置”，运行后显示摘要与高频控制。中间工作区不再
  以一个分段控件混排模板、设置和历史，而是拆为独立的“工作流模板”“运行配置”“工作流运行”
  页面；任务目标、Agent 分配、运行前检查和启动确认只在运行配置页面完成。
- 2026-07-31 节点工作指令已从固定任务类型扩展为可编辑文本，并提供工作目标、上游结论、冻结
  产物、评审汇总、判定结果、工作流名、步骤名和轮次八个受控占位符。插入依赖运行输入的占位符
  会同步启用对应输入绑定；未知、未闭合或缺少绑定的占位符拒绝保存。运行时只渲染当前 Run 的
  已持久化上下文，缺失值使用明确空态，最终渲染文本仍受系统身份、Host、Workspace、冻结产物
  和结构化回执合同保护并随派发 Prompt 持久化。
- 三个内置模板已升级到版本 3 并写入默认工作指令；旧 V1 模板和历史快照缺少该字段时继续按
  `promptTemplateKey` 使用内置默认值，不要求迁移历史 Definition。
- 2026-07-31 运行配置新增模板切换：Draft / Ready 可在原 Run 内替换模板快照，保留目标和
  工作区，清空旧角色分配及运行前检查并回到 Draft。Agent 拖拽资格同时收敛为只看 Activity
  当前行是否 idle；落槽不再重复查询状态或 lifecycle，运行前检查和实际派发继续执行最终安全校验。
- 此前 7/30 信息架构增补通过 typecheck、max-lines ratchet、定向 oxlint 和本地化目录校验；
  当时按用户要求未运行测试套件，锁屏状态下未启动应用。7/31 拆分增补另通过 2 项导航定向测试、React Doctor changed
  检查和 desktop production build。实机交互由用户另行测试，不影响当前完成状态。
- 工作指令增补通过 Schema、占位符渲染、运行时上下文、数据库种子、Workflow Engine 和编辑器
  默认值切换共 37 项定向测试；typecheck、本地化目录校验、max-lines ratchet、定向 lint 和
  desktop production build 结果以本次实现收尾记录为准。实机交互由用户另行测试。
- 模板切换和 idle-only 拖拽增补通过 Run Store、Runtime RPC 与拖拽 payload 共 25 项定向测试，
  typecheck、定向 lint、本地化目录、max-lines ratchet 和 desktop production build 通过。
- 2026-07-31 代码风险复核补齐配置态守卫：只有 Draft / Ready 可修改目标、分配 Agent、执行
  运行前检查或切换模板，运行中及终态 Run 不会被配置 RPC 重新打开为 Draft；重复选择同一模板
  版本保持原分配不变，并行角色移除单个 Agent 时只删除对应 lifecycle。运行配置页固定按 Run
  锁定的 Execution Host 与项目范围加载模板，并丢弃过期异步响应；分配或切换模板持久化成功后
  才释放实际被移除的 lifecycle claim，幂等旧回执也以数据库真实前后状态计算清理范围。该轮
  22 个文件、84 项 Workflow 回归测试以及 typecheck、定向 lint、本地化目录、max-lines ratchet、
  diff check 和 desktop production build 均通过。
- 2026-07-31 Workflows 中间页进一步收敛为临时配置标签：未打开时不占标签栏，支持关闭按钮、
  中键和 `Cmd/Ctrl+W`，关闭后保留 Draft；启动成功后自动收起，运行详情仍可从 Workflow Activity
  按需重开，应用重启时也不自动恢复该临时标签。该轮 24 个文件、88 项 Workflow 回归测试及
  desktop production build 通过。

- 左侧和右侧 Workflow Activity 均可按需打开 Workflows 临时标签。
- 中间主窗口提供模板列表、可视化编辑和版本管理。
- 右侧保持当前工作区上下文。
- Workflow Activity 位于 Agent Activity 上方。
- 模板可以应用到当前工作区。
- 支持拖拽、点击选择和按角色槽创建 Agent；设置页“已安装”目录也提供直接新建入口。新建时可输入一次性命令并按 Agent 能力配置 YOLO；名称由设置目录名称派生，标签页重命名后 Workflow 跟随实际标签名称。
- 创建 Run Draft 并完成运行前检查。
- 内置三个基础模板。
- 冻结完整 Workflow Definition V1、Transition、角色槽、输入输出和重试合同。
- 冻结唯一 `WorkflowReviewPolicyV1`，包含失败策略、timeoutMs 和节点级轮次上限。
- 三个内置模板使用标准 JSON fixture 和完整快照测试。
- 支持内置、个人、项目范围以及自定义模板归档语义。
- 本里程碑不自动向 Agent 派发完整 Workflow。

### 25.6 M2：单产出单评审运行闭环

当前状态（截至 2026-07-29）：

- 持久化 Workflow Engine、Step / Message / Event / Artifact Runtime 表、`workflow.runStart` / `workflow.runEvents`、mutation ledger 和重启安全失败已实现。
- Produce 和 Review 使用 Orchestration Task / Dispatch、实时 Agent authority 复核和受保护的精确发送链路；重复启动不重复派发。
- `workflow.completion/v1`、`workflow.review-result/v1`、完整身份绑定、`completion-incomplete` 和非 approve 结果的安全失败已实现。
- Git Worktree 与 Folder Workspace 使用独立的内容寻址快照；Reviewer 消费冻结 Blob，Artifact 无法冻结或 Review 期间漂移时停止推进。
- Workflow Activity、运行详情和 Agent Activity 的 Workflow 上下文已实现；Prompt、完整结论、Task、Dispatch、delivery 和 Artifact 可追溯。
- 主进程以 Runtime、Pane、Handle、进程 incarnation 和精确 Provider Session 生成权威 lifecycle ID；Renderer 只镜像，分配、Prepare、派发和真正写入前均精确复核。
- 缺失、不可读、软链或非法 JSON 的 `reportPath` 均按 `workflow_completion_incomplete` 安全失败，不会误归类为 Agent lifecycle 不可用。
- M2 定向测试 15 个文件、83 项全部通过；typecheck、lint 和 desktop build 通过。全仓测试沙箱内仅 4 个原生/用户目录测试文件失败，同四个文件在沙箱外复跑 932 项全部通过。
- SPEC 真实复验 `workflow_run_49194441fc3283a9c6` 完成 Produce → Review → Complete，独立 Reviewer verdict=`approve`。
- 代码真实复验 `workflow_run_7d221cce92bbe5fed8` 使用 Codex Produce 和 CC MiniMax Review；冻结 Artifact `workflow_artifact_84b12db955d3142eef` 后 Reviewer verdict=`approve`、issues=`[]`，Produce、Review、Engine Complete 均 succeeded，最终写入 `run-completed #15`。
- M2-A1 至 M2-A17 已全部通过；稳定合同、实际偏差和验收结果已回写主 SPEC，临时 M2 SPEC 已清理。
- As-built 只声明同一 Runtime、本地执行 Host 的 Git Worktree/Folder Workspace；SSH、WSL 和远程 Host 在能力接入前明确拒绝启动，跨 Host 支持留给后续里程碑。

- 支持 Produce → Review → Complete。
- 一次运行定向派发到正确 Agent。
- 产出 Agent 的完整最终结论自动交给 Reviewer。
- 版本化 Completion/Review JSON 是唯一可推进结果，Engine 根据合法结果生成内部完成信号。
- 完整结果来源绑定 Dispatch、lifecycle、Provider Session 和 Host。
- Folder Workspace 与未提交 Git 内容在 Review 前形成内容寻址快照。
- Workflow Activity 展示真实当前节点。
- 保存最小但完整的 Run、Step、Prompt 和 Conclusion 记录。
- 失败时给出明确恢复动作。
- 暂不支持多 Reviewer 和修改循环。

### 25.7 M3：多 Agent 并行评审与意见汇总

- 一个 Review 节点可分配多个 Reviewer。
- Reviewer 基于同一 Artifact 版本并行评审。
- 独立保存每个 Reviewer 的 Prompt、结论和状态。
- 等待必需 Reviewer 完成后形成汇总意见。
- 单个 Reviewer 超时或失败时按策略处理。
- Aggregate 只映射到冻结的 review-request-human、review-revision-required 或 review-conflict。
- 暂不自动进入多轮修改。

当前 As-built（截至 2026-07-29）：

- Produce 成功后在同一事务创建全部 Reviewer Step；每个 Step 拥有独立 Assignment、Task、Dispatch、deliveryId、Prompt、结果和重试尝试。
- Reviewer 并行读取同一 `workflow.artifact-manifest/v1` 内容寻址快照；Prompt 固定 Artifact/Manifest digest、materialized snapshot 和 blobId，结构化结果继续绑定 Run、Step、Task、Dispatch、lifecycle、Provider Session 与 Host。
- Review fan-in 只接收合法 `workflow.review-result/v1`。原始 Review 独立保存；Aggregate 按模板槽位、再按 Step Run ID 稳定排序，完成先后不影响正文和判定。
- 确定性判定为 request-human 优先于 revise，revise 或 blocker 优先于 approve；冲突、来源 Step、Artifact 和原文均持久化，Aggregate 通过数据库唯一约束防重复。
- approve Aggregate 创建确定性 Decision Step 后执行冻结 approve Transition；revise/request-human 创建 Decision Step 和完整 `WorkflowResolutionContext`，进入对应冻结 waiting reason，不创建修改任务。
- Reviewer 派发失败只重试自身并使用新 Task、Dispatch 和 deliveryId；超时由 Runtime 时钟判定。重试耗尽后按共享 `WorkflowReviewPolicyV1.onReviewerFailure` 进入 `waiting-human` 或失败。
- Workflow Activity 显示轮次、完成/等待/失败计数和各 Reviewer 状态；中间详情展示 Aggregate、冲突和到原始 Review 的跳转；Agent Activity 保留 Workflow、节点、轮次和交接目标。
- 数据库新增多 Reviewer Step 唯一键、`workflow_review_aggregates`、waiting reason 和 Resolution Context，并包含既有 M2 表的迁移路径。
- 实际边界：M3 Runtime 仍只启动单 Produce/单 Review 节点拓扑；完整 SPEC → 实现跨阶段流程、重启恢复和人工动作归 M4/M5。Reviewer 工作区漂移只标记失败，不自动回滚。
- 自动化验收：类型检查、lint、M3 状态机/数据库/RPC/Renderer 定向测试和差异检查通过。全量测试的环境性失败记录在 M3 临时 SPEC，不作为 M3 路径回归。
- 历史边界：当时未执行真实 SPEC/代码多 Reviewer Agent E2E；该人工操作现由用户另行测试，不影响 M3 完成状态。

### 25.8 M4：评审循环判定与人工控制

- 评审意见可以回传原产出或实现 Agent。
- 支持多轮修改和重新评审。
- 达到最高评审轮次后停留在最终评审。
- 确定性规则优先，必要时调用判定 Agent。
- 支持通过、需要修改和需要人工决定。
- 支持暂停、继续、重试、重新分配和人工 Gate。
- 冻结 waiting reason 与合法动作矩阵，`runResolve` 只接受 Engine Offer。
- review-limit Offer 绑定 origin Decision 和原 approve/revise Transition。

当前 As-built（截至 2026-07-29）：

- 持久化 Transition Engine 使用 `workflow-decision-rules/v1`，以 Run 版本、mutation ledger 和事务事件保证同一动作只推进一次。
- Review round 与 retry attempt 独立；每轮修改创建新 Step、Task、Dispatch 和 Artifact Revision，达到上限后停在 `review-limit-reached`。
- 旧 Dispatch 的迟到 `worker_done` 仅写入幂等 `late-completion-ignored` 事件，不改变当前 round 或 Aggregate。
- 确定性规则覆盖 approve、revise、request-human 和 stop-at-review；可选判定 Agent 只能返回冻结 Schema，非法结果重试耗尽后进入人工处理。
- Human Gate 以冻结 waiting reason 矩阵生成 Engine Offer；伪造、过期、越权和旧版本 Offer 均被拒绝，人工动作保存完整审计。
- Pause、Resume、Cancel、Retry、Reassign 和 Resolve RPC 已接入；Assignment 在主进程按当前 Pane、lifecycle、Provider Session 和 Host 重新权威化。
- Workflow Activity 和运行详情显示节点、round、Reviewer 进度、等待原因和合法操作，重要动作使用确认界面。
- 自动化验收：`pnpm run typecheck`、完整 lint、17 个 M4 定向测试文件 64 项测试和 React Doctor changed check 通过。
- CC（MiniMax-M3）独立 Produce 与 Review 已返回 approve、0 blocker；评审指出的四轮测试默认超时已改为显式 15 秒。
- 实际偏差：首次实机 Run 在 Reviewer 执行期间仍有协调器代码变更，Artifact 漂移保护按合同停在人工状态；用户选择不再启动代码冻结后的第二次复验。
- 历史边界：当时未执行完整 CC 闭环、多轮和 review-limit 人工操作；这些操作现由用户另行测试，不影响 M4 完成状态。

### 25.9 M5：工作流历史恢复与可靠性

- Run history 和完整时间线。
- Prompt、Conclusion、Review、Decision 和 Artifact 详情。
- Markdown / JSON 导出。
- 应用重启后的状态恢复。
- 幂等派发和防重复执行。
- 本机 Git Worktree 和 Folder Workspace 自动化验收。
- SSH Workflow 能力安全拒绝；Windows、Linux、WSL 和跨 Host 验证移至未来需求。
- `SPEC → 实现完整流程` 的真实操作由用户另行测试。
- 长内容、远程 Artifact、断连和 Host 隔离处理。

当前 As-built（截至 2026-07-31）：

- Workflows 运行详情新增 owner-scoped Run history，可按 Workspace / Project、模板、状态、时间和关键词筛选；历史详情直接读取持久化 Step、Event、Prompt、Conclusion、Review Aggregate、Decision 和 Artifact，不依赖 Agent Activity 当前条目。
- `workflow.runExport` 从同一脱敏权威快照生成 Markdown 或 JSON，保存同一 snapshot digest，默认移除凭据形态字段、用户目录和不必要路径，并以 16 MiB 限制阻止无界 Renderer 内存占用。
- Workflow 数据库新增 delivery 状态、唯一 delivery、外部消息 receipt 和 recovery lease；Runtime 启动即扫描非终态 Run，只有 `prepared` 且没有外部 Dispatch 时可继续，证据不完整或不确定时进入 `waiting-human / delivery-uncertain`。
- delivery、完成消息、Review、Decision 和 Artifact 以数据库唯一约束、receipt、事务和 Run lease 防重复；同一 delivery 或 receipt 重放不再重复写入推进事件。
- 远程 Artifact 只显示 Execution Host 与引用，不把远程路径当作本机路径打开；Git Worktree 和 Folder Workspace 继续使用各自的快照合同。
- Run history 的 Workspace / Project、状态、模板和创建日期范围筛选已接入权威持久化查询；模板选项来自历史快照，归档模板仍可追溯。筛选后详情只保留当前结果中的 Run。
- Runtime 恢复改为逐 Run 隔离异常；单个损坏或不可读 Run 会记录带 Run ID 的诊断并继续扫描后续候选，不再阻断其他 Run 恢复。
- 长内容自动化确认超过 2 MiB 的上游结论可完整进入下一 Step，2 MiB Artifact 经内容寻址 Blob 冻结和不可变物化后字节一致；终端输入、结论 Schema、单文件快照和导出继续使用各自的安全上限。
- macOS 开发版已完成唯一一轮电脑验收：打开 Run history，以 `M2 + completed` 筛选历史 Run，读取三 Step 和 15 个持久事件，并成功导出 `workflow.run-export/v1` JSON；导出 Run 为 `workflow_run_7d221cce92bbe5fed8`。
- 本机验证通过：typecheck、完整 lint、60 项 Workflow 定向测试和 desktop build。全量测试仅有一个无关 Renderer 用例在并发下 30 秒超时，隔离复跑 2/2 通过。
- 2026-07-31 增补通过 74 项 Workflow 测试、typecheck、定向 oxlint、max-lines ratchet、React Doctor changed 和本地化目录一致性；本地化覆盖检查仍被既有未跟踪文件中的 `New role` 阻断。
- 完成结论：本机历史、导出、恢复、防重复、长内容和 Workspace 隔离合同已有自动化覆盖；SSH Workflow capability 安全拒绝。跨平台、跨 Host 和人工操作不属于当前完成范围，M5 标记完成。

## 26. 用户产品测试场景（不属于 SPEC 完成门槛）

以下场景供用户在构建产物上继续调试和体验，不决定本文完成状态；发现的问题作为新需求进入后续 SPEC。

### 26.1 SPEC 工作流

1. 用户进入 Workflows。
2. 选择 `SPEC 编写与评审`。
3. 右侧应用到当前 Orca Worktree。
4. 把一个 idle Codex 拖入“SPEC 编写”。
5. 把 Claude 和另一个 Codex 拖入“评审”。
6. 可选地把第三个 Agent 拖入“判定”。
7. 设置最高 3 轮。
8. 输入目标并运行。
9. 编写 Agent 完成后，两个 Reviewer 并行收到真实 SPEC 和完整结论。
10. Review 汇总后要求修改。
11. 原编写 Agent 收到汇总意见并产生 V2。
12. 第 2 轮通过。
13. Workflow Activity 显示完成。
14. Run history 可查看两轮 Prompt、结论、SPEC 版本和判定。

### 26.2 代码实现工作流

1. 用户应用 `代码实现与评审`。
2. 分配一个实现 Agent 和两个 Reviewer。
3. 实现 Agent 完成代码和测试。
4. 系统冻结代码 Artifact。
5. Reviewer 基于同一 Diff 评审。
6. Review 发现问题。
7. 实现 Agent收到汇总意见并修复。
8. 新 Diff 进入下一轮 Review。
9. 最终通过，但系统不自动提交、推送或合并。

### 26.3 达到上限

1. 最高轮次为 3。
2. 第 3 轮仍需修改。
3. 系统不创建第 4 次修改。
4. Workflow 进入 `review-limit-reached`。
5. 右侧显示最终问题和人工动作。
6. Offer 保存触发上限的 origin Decision Step、reviewNodeId 和 resolutionTransitionId。
7. 用户选择继续一轮时，当前 Review 节点上限增加一，执行原 revise Transition 并创建对应 Produce Step。
8. 用户选择人工通过时，执行原 approve Transition；组合模板 SPEC 阶段进入 `code-produce`，不能直接完成。
9. 用户选择结束时，Run 进入 `cancelled` 并记录 `ended-at-review`。

### 26.4 Agent 身份变化

1. Run setup 分配 Agent A。
2. 原 Pane 返回 Shell，并启动新的 Agent B。
3. 点击运行。
4. 系统检测 lifecycle mismatch。
5. Prompt 不发送给 Agent B。
6. 右侧要求重新分配。

### 26.5 应用重启

1. Reviewer 正在运行时关闭 Orca。
2. 重新打开。
3. Workflow 恢复到同一 Run。
4. 已发送 Prompt 不重复发送。
5. 已完成 Review 不重复计数。
6. Workflow Activity 显示恢复后的真实状态。

### 26.6 SPEC → 实现完整流程

1. 用户应用 `SPEC → 实现完整流程`。
2. 分配 SPEC 产出、SPEC Reviewer、实现、代码 Reviewer 和可选判定 Agent。
3. SPEC Agent 生成 `workflow.completion/v1` 和固定 SPEC Artifact Revision。
4. SPEC Reviewer 使用 `workflow.review-result/v1` 对固定 Revision 完成评审。
5. SPEC 判定通过后，Engine 按标准 Transition 进入 `code-produce`，不能直接完成 Run。
6. 实现 Agent 同时收到根目标、已通过的 SPEC 完成信封和固定 SPEC Artifact。
7. 实现 Agent 生成代码 Artifact Revision 和验证结果。
8. 代码 Reviewer 基于固定代码 Artifact 完成评审。
9. 若要求修改，只回到 `code-produce`，不得错误回到 `spec-produce`。
10. 代码判定通过后进入 Complete。
11. Run history 可追溯 SPEC、SPEC Review、实现、代码 Review、两类 Decision 和全部 Artifact。
12. 系统不自动提交、推送或合并。

## 27. 完成定义

当前收口范围满足以下条件即完成：

1. 左侧 Workflows 入口位置符合本文。
2. 模板编辑使用中间主窗口。
3. 应用、分配、运行和控制位于右侧当前工作区面板。
4. Workflow Activity 位于 Agent Activity 上方。
5. 活跃 Agent 可拖入节点，也可点击分配。
6. 一次运行能够定向派发到正确 Agent。
7. Agent 最终结论自动进入下游节点。
8. 多 Reviewer、判定、修改和轮次上限符合状态机。
9. 完整记录可在 Run history 回顾。
10. 应用重启不重复派发或丢失轮次。
11. macOS 本机 Git Worktree / Folder Workspace 合同通过自动化；SSH Workflow 明确安全拒绝。
12. 类型检查、lint、max-lines、单元测试和相关集成测试通过。
13. Windows、Linux、WSL、跨 Host 与人工产品测试不属于当前 SPEC 完成门槛。

结论：上述本机代码、自动化和构建合同已完成，本 SPEC 于 2026-08-03 收口。后续调优、平台扩展和用户测试发现的问题按新需求处理。
