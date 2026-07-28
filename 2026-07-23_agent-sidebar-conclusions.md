# SPEC: Agent Sidebar Auto-Reveal and Conclusions

## 背景

当前左侧项目列表已经能展示 worktree 下的 Agent 行，但如果对应 Agent 正在运行，而它所在的项目分组、父级分组、Pinned 分组或 Host 分组处于折叠状态，用户需要手动展开才能看到状态。`codexdb` 和 `codexdba` 已经作为 Codex wrapper agent 接入，但在 UI 上仍然和普通 `codex` 使用同一套 OpenAI 图标，不容易区分。右侧 AI Vault/会话区域已有历史会话和 Agent 状态信息，但 Agent 结束时最后的结论性回复没有被集中提取出来，用户需要进入具体 Agent 或会话才能查看。

## 目标

- 当某个 worktree 或 folder workspace 下存在仍在运行、等待或阻塞中的 Agent 时，左侧列表默认展开能看到该 Agent 的必要分组。
- 为 `codexdb` 和 `codexdba` 提供区别于普通 `codex` 的图标表现，并且两者之间也可区分。
- 在右侧区域增加一个轻量的“Agent 结论”入口，展示最近结束的 Agent 最后回复预览，点击后能展开查看已捕获内容，并尽量跳转到对应 Agent/Pane 或打开原始会话日志。
- 方案必须遵守现有 UI 规范：使用 `docs/STYLEGUIDE.md`、`src/renderer/src/assets/main.css` tokens、现有 shadcn/lucide 组件体系，不引入孤立色值或新的视觉体系。

## 非目标

- 不重做左侧列表的信息架构。
- 不改变 Agent 运行、恢复、保留 retained agent 的底层协议。
- 不把所有 AI Vault 历史会话重新分类为 `codexdb` / `codexdba`；如果历史数据无法可靠识别 wrapper profile，先保持为 `codex`。
- 不在本阶段实现复杂的用户自定义结论管理、搜索、标签或长期归档。
- 初版不承诺在 worktree/folder workspace 删除后继续展示状态源中的结论；删除后如 retained agent 被 prune，结论自然消失。
- 初版不承诺仅依赖 `lastAssistantMessage` 展示完整 transcript；完整内容查看必须依赖可匹配的 AI Vault session log。

## 当前代码依据

- 左侧列表的折叠状态在 `src/renderer/src/components/sidebar/WorktreeList.tsx` 中通过 `effectiveCollapsedGroups` 派生后传入 `buildRows()` 和 `addHostSectionRows()`。
- 分组 key 可通过 `src/renderer/src/components/sidebar/worktree-list-groups.ts` 的 `getGroupKeysForWorktree()` 计算；Host 分组由 `src/renderer/src/components/sidebar/host-section-rows.ts` 使用 `host:${host.id}`。
- folder workspace reveal 需要先用 `parseWorkspaceKey()` 识别 workspace id，并复用 `src/renderer/src/components/sidebar/worktree-list-folder-reveal.ts` 中的祖先展开逻辑。
- live agent worktree 已有工具函数 `getWorktreeIdsWithLiveAgent()`，定义在 `src/renderer/src/lib/worktree-activity-state.ts`，它基于新鲜的非 done Agent 状态返回 worktree id。
- Agent 图标统一入口在 `src/renderer/src/lib/agent-catalog.tsx` 的 `AgentIcon()`；当前 `codex`、`codexdb`、`codexdba` 都会进入 `isCodexRuntimeAgentType()` 分支并显示 OpenAI 图标。
- AI Vault 的 `AiVaultAgent` 当前不包含 `codexdb` / `codexdba`，这两个 wrapper agent 的 session 在 Vault 侧应按 `codex` 匹配；运行态 UI 仍需保留原始 `runtimeAgent` 用于图标和标签。
- `ai-vault-original-pane.ts` 当前按 `entry.agentType === session.agent` 严格匹配；为了让 wrapper agent 能定位 Vault session 和原 Pane，需要引入统一的 runtime-to-vault agent 归一化函数。
- Agent 状态类型 `AgentStatusEntry` 已包含 `lastAssistantMessage`，但它是状态预览字段，并且长度受 `AGENT_STATUS_ASSISTANT_MESSAGE_MAX_LENGTH` 限制。`DashboardAgentRowMessage.tsx` 已经使用 `CommentMarkdown` 渲染该字段。
- retained agent 会被 `pruneRetainedAgents(existingWorktreeIds)` 清理，因此 live/retained 状态源不能支持“删除 worktree 后仍展示结论”的初版承诺。
- 右侧 AI Vault 主面板在 `src/renderer/src/components/right-sidebar/AiVaultPanel.tsx`，适合作为结论小框的容器入口；其 workspace/project scope、host scope、Agent 类型和搜索条件需要传入结论 selector，避免小框展示范围与列表范围不一致。
- `AiVaultSessionVirtualList` 的展开状态是组件内部 state，初版不从结论小框外部驱动虚拟列表滚动和展开；可复用的完整内容入口是 `openAiVaultSessionLogInOrca()`。
- folder workspace 的 host 解析应统一复用完整 host 优先级逻辑，避免 `worktree-list-host-filtering.ts` 与 `host-section-rows.ts` 生成不同 host key。

## 用户体验

### 左侧自动展开

- 如果某个项目/分组下存在 live agent，用户进入左侧列表时应能直接看到对应 worktree 或 folder workspace 及其 Agent 行。
- 自动展开只影响“当前渲染效果”，不写回用户持久化折叠偏好。
- Agent 结束后，如果用户原本折叠过对应分组，分组应自然恢复为折叠。
- 初版定义为“live agent 可见性优先”：当 Agent 仍在运行时，即使用户手动折叠父级分组，下一次状态刷新仍可能展开。更复杂的“本次运行内手动覆盖”可作为后续增强。

### Agent 图标

- `codex` 继续使用现有 OpenAI 图标。
- `codexdb` 和 `codexdba` 使用同一基础 Codex 图形语言，但通过小尺寸背景、色块、角标或轮廓差异区分。
- 图标在 13px 到 16px 的行内尺寸下仍应可辨认，不能依赖过细文字。
- 颜色应使用 CSS token 或基于 token 的 `color-mix()` 类，避免在 TSX 中硬编码 hex。

### 右侧结论小框

- 当存在最近完成且带 `lastAssistantMessage` 的 Agent 时，右侧 AI Vault 顶部显示一个紧凑小框。
- 每条结论至少展示 Agent 图标、Agent 名称、所属 worktree/任务标题、完成时间或相对时间，以及一行摘要。
- 点击某条结论后展开已捕获的最后回复预览；该内容最多为现有状态字段保留的长度，不承诺等同完整 transcript。
- 如能匹配 AI Vault session log，提供“打开会话日志”；如还能定位原 pane，提供打开原 worktree 并聚焦 pane 的动作。
- 结论小框跟随 AI Vault 当前 workspace/project scope、execution host、Agent 类型和搜索条件过滤。
- 没有可展示结论时不显示空框，避免右侧噪音。

## 功能方案

### 1. live agent 自动展开

新增一个聚焦命名的纯函数模块，例如：

- `src/renderer/src/components/sidebar/live-agent-auto-reveal-groups.ts`

职责：

- 输入当前 `collapsedGroups`、worktree 列表、folder workspace 列表、repo/host/grouping 上下文、`pinnedDisplayPolicy`、live agent workspace id 集合。
- 对每个 live worktree 计算需要打开的 key：
  - 当前 groupBy 下的分组 key：复用 `getGroupKeysForWorktree()`。
  - Pinned 分组 key：`pinnedDisplayPolicy === 'single-location'` 时只移除 `PINNED_GROUP_KEY`；`pinnedDisplayPolicy === 'duplicate-in-groups'` 时只移除自然分组 key；不同时打开两个位置。
  - 父子 lineage key：沿 parent 链移除 `getLineageGroupKey(parent.id)`。
  - Host 分组 key：按统一 workspace host 解析函数移除 `host:${host.id}`。
- 对每个 live folder workspace 计算需要打开的 key：
  - 通过 `parseWorkspaceKey()` 区分 folder workspace id。
  - 复用 folder workspace reveal 的祖先分组展开逻辑，确保多级 Project Group 都被打开。
  - 使用与 host 分组渲染、host filter 相同的 folder workspace host 解析函数处理 host 分组 key。
- 返回新的 `Set<string>`，不修改原始 `collapsedGroups`。

host 解析必须先集中为一个共享实现，例如从 `worktree-list-host-filtering.ts` 中抽出或扩展一个具体命名模块：

- `src/renderer/src/components/sidebar/workspace-host-resolution.ts`

要求：

- worktree、project group、folder workspace、runtime folder workspace 都通过同一组 exported 函数得到 `ExecutionHostId`。
- `host-section-rows.ts`、host filter、folder path status、live agent auto reveal 都复用该实现。
- 不能继续让 `host-section-rows.ts` 维护一套私有简化解析逻辑。

`WorktreeList.tsx` 中把现有针对 `agentSendTargetWorktreeId` 的展开逻辑和 live agent 展开逻辑合并到 `effectiveCollapsedGroups` 中：

- send target 继续保持最高优先级。
- live agent 展开在同一派生 set 上执行。
- 不调用持久化设置 API。
- `live-agent-auto-reveal-groups` 只处理已预过滤的 live id；done/stale/interrupted 的状态判断留在 `getWorktreeIdsWithLiveAgent()` 或集成层。

### 2. `codexdb` / `codexdba` 图标区分

在 `AgentIcon()` 中优先处理 wrapper agent：

- `agent === 'codexdb'`：渲染 Codex/OpenAI 基础图标外加一个 Doubao Coding 风格背景或角标。
- `agent === 'codexdba'`：渲染同基础图标，但使用不同背景/角标。
- 然后再进入 `isCodexRuntimeAgentType(agent)` 的普通 `codex` 分支。

建议新增局部组件：

- `CodexProfileIcon`
- 或更具体的 `CodexDoubaoCodingIcon` / `CodexDoubaoAgentIcon`

样式放在已有 CSS token 体系中，优先使用现有语义色。如果现有 token 不足，以组件局部 class 组合 `color-mix(in srgb, var(--xxx) ...)`，并在实现时对 hover/selected/sidebar 背景进行目测验证。

### 3. Agent 结论小框

新增纯数据选择模块，例如：

- `src/renderer/src/components/right-sidebar/agent-conclusions.ts`

输出结构：

```ts
type AgentConclusionItem = {
  id: string
  paneKey: string | null
  worktreeId: string | null
  runtimeAgent: TuiAgent | null
  vaultAgent: AiVaultAgent | null
  title: string
  subtitle: string | null
  message: string
  completedAt: number
  providerSessionId: string | null
  matchedSession: AiVaultSession | null
}
```

选择规则：

- 只收集 `state === 'done'` 的 Agent。
- 排除 `interrupted === true` 的结束状态。
- `lastAssistantMessage` 必须 trim 后非空。
- live map 和 retained map 同时存在时按 pane/session 去重。
- `completedAt` 必须取 `entry.stateStartedAt`，不使用 `updatedAt` 回退；缺少 `stateStartedAt` 的 entry 不生成结论项。
- 按 `completedAt` 倒序排列；相同时间按稳定 `id` 升序排列。
- “最近”定义为通过过滤后的最新 3 条，不额外设置时间窗口。
- `runtimeAgent` 保留状态源中的真实 Agent 类型，例如 `codexdb` / `codexdba`，用于图标和展示标签。
- `vaultAgent` 使用统一归一化函数计算：`isCodexRuntimeAgentType(runtimeAgent)` 时归一为 `codex`；其他 Agent 只有在属于 `AI_VAULT_AGENTS` 时保留，否则为 `null`。
- AI Vault session 匹配使用 `executionHostId + vaultAgent + providerSessionId`，不是 `runtimeAgent`；因此 `codexdb` / `codexdba` 能匹配 Vault 中 agent 为 `codex` 的 session。
- `ai-vault-original-pane.ts` 的 `agentMatches()` 也应复用同一个归一化函数，避免 wrapper agent 无法通过现有原 Pane 定位逻辑。
- 选择器接收 AI Vault 当前 workspace/project scope、execution host、Agent 类型过滤、`filteredSessionIds` 和 `hasSearchQuery`。
- 已匹配 session 的结论只有当 `matchedSession.id` 存在于 `filteredSessionIds` 时展示；这直接复用 AI Vault 已完成的搜索、scope、host、Agent 过滤结果。
- 未匹配 session 的状态预览只在 `hasSearchQuery === false` 时允许展示，并且仍必须通过当前 workspace/project、execution host 和 Agent 类型过滤；搜索框非空时不展示未匹配结论项。

新增展示组件，例如：

- `src/renderer/src/components/right-sidebar/AgentConclusionsBox.tsx`

放置位置：

- 集成在 `AiVaultPanel.tsx` 的 header 下方、session list 上方。

交互：

- 单击结论行切换展开状态。
- 展开内容使用现有 `CommentMarkdown` 渲染 `lastAssistantMessage` 预览，保持与 Agent 消息渲染一致。
- “打开会话日志”动作只在 `matchedSession` 存在且 `canOpenAiVaultSessionLogInOrca(matchedSession)` 为 true 时出现，点击后调用 `openAiVaultSessionLogInOrca(matchedSession)`。
- 初版不实现“在 AI Vault 虚拟列表中滚动到该 session 并展开详情”。如果后续需要该体验，必须把目标 session id、展开状态和滚动控制提升到 `AiVaultPanel`。
- “打开原 Pane”动作必须校验 pane 当前仍属于同一 worktree/session，避免 pane 被新 Agent 复用后跳转到错误上下文。

## 边界情况

- worktree 或 folder workspace 已被删除：初版不再展示仅来自 live/retained 状态源的结论；如果后续改用 AI Vault 扫描结果作为正式数据源，需要单独定义删除后展示和跳转降级规则。
- Agent 结束但没有最后回复：不生成结论项。
- Agent 最后一条消息超过 8000 字符：小框只展示当前状态字段已捕获的内容，并提供可用时的“打开会话日志”入口。
- Agent 最后一条消息是工具状态或空白：选择器应避免展示无意义内容；必要时可复用 `activity-thread-display.ts` 的 preview 逻辑。
- 同一个 Agent pane 多次完成：初版按最新 retained/status entry 展示一条。
- SSH/远程 host：只依赖已有 worktree、host、pane key 数据，不假设本地路径或本地进程。
- 多 provider：图标和标签从现有 agent catalog/label 体系获取，不写 provider 专属分支。
- 当前 AI Vault filter 缩小范围后，结论小框同步缩小范围；不会展示其他 host、workspace/project 或 Agent 类型的结论。
- 搜索框非空时，未匹配到 AI Vault session 的状态预览不展示，避免用不完整字段复制 AI Vault 搜索语义。

## 测试计划

### 单元测试

- `live-agent-auto-reveal-groups`：
  - live agent 位于已折叠 repo/project 分组时，返回 set 移除对应 key。
  - project grouping 多级父分组时，祖先 key 一并移除。
  - folder workspace 及其多级 Project Group 折叠时，祖先 key 一并移除。
  - `pinnedDisplayPolicy === 'single-location'` 时，只移除 `PINNED_GROUP_KEY`。
  - `pinnedDisplayPolicy === 'duplicate-in-groups'` 时，只移除自然分组 key。
  - 两种 pinned 策略都不会同时打开 Pinned 和自然分组。
  - lineage child worktree 有 live agent 时，父级 lineage key 一并移除。
  - local、SSH、runtime host 分组折叠时，移除统一解析后的 `host:${host.id}`。
  - runtime folder workspace 使用与 host filter 和 host section row 相同的 host id。
  - 无 live agent 时返回与输入等价的折叠 set。

- `agent-conclusions`：
  - done + `lastAssistantMessage` 生成结论。
  - working/blocked/waiting 不生成结论。
  - interrupted done 不生成结论。
  - 空白 message 不生成结论。
  - 缺少 `stateStartedAt` 不生成结论。
  - `completedAt` 必须等于 `stateStartedAt`。
  - live 和 retained 重复时去重。
  - 排序和数量上限稳定，相同时间按稳定 id 排序。
  - workspace/project、host、Agent 类型和搜索条件过滤生效。
  - `codexdb` / `codexdba` 的 `runtimeAgent` 保留原值，`vaultAgent` 归一为 `codex`。
  - `codexdb` / `codexdba` 能通过 `executionHostId + codex + providerSessionId` 匹配 AI Vault session。
  - 搜索框为空时，未匹配 session 的状态预览可按 workspace/host/Agent scope 展示。
  - 搜索框非空时，未匹配 session 的状态预览不展示。
  - 已匹配 session 只有存在于 `filteredSessionIds` 时展示。
  - 超过 8000 字符的最终回复只按已捕获 preview 展示。
  - worktree/folder workspace 删除后的状态源结论不展示。

- `ai-vault-original-pane`：
  - wrapper runtime agent 与 Vault `codex` session 可以匹配 live state。
  - wrapper runtime agent 与 Vault `codex` session 可以匹配原 Pane。
  - provider session id 不一致时不能通过 wrapper 归一化误匹配。

- `AgentIcon`：
  - `codex`、`codexdb`、`codexdba` 三者渲染路径可区分。
  - 小尺寸下 class/label/aria 不丢失。

### 组件测试

- 左侧列表在分组折叠状态下，如果子 worktree 有 live agent，仍渲染对应 worktree/Agent 行。
- 右侧结论小框：
  - 有结论时显示。
  - 无结论时隐藏。
  - 点击行展开 Markdown 预览内容。
  - 匹配 AI Vault session 且 log 可打开时显示“打开会话日志”。
  - 点击“打开会话日志”调用 `openAiVaultSessionLogInOrca(matchedSession)`。
  - pane 被新 Agent 复用后，不错误跳转到旧结论的 pane。

### 手工验收

- 启动一个普通 `codex` Agent、一个 `codexdb` Agent、一个 `codexdba` Agent，确认左侧图标可区分。
- 在浅色/深色、selected/hover、13px/16px 组合下确认 `codexdb` / `codexdba` 图标可辨认。
- 折叠项目分组后启动 Agent，确认分组自动展开。
- 折叠 folder workspace 所在多级 Project Group 后启动 Agent，确认祖先分组自动展开。
- Agent 结束后，确认右侧出现最后回复预览，点击能展开；匹配会话时能打开会话日志。
- 在 SSH worktree 或非本机 host 场景确认不依赖本地路径，并且 host filter 生效。

## 实施顺序

1. 先集中 workspace/folder workspace host 解析函数，并让 host section、host filter、folder path status 和后续 auto reveal 共用。
2. 增加 live agent 自动展开纯函数和测试，覆盖 worktree、folder workspace、runtime folder workspace host 和 pinned 策略后再接入 `WorktreeList.tsx`。
3. 调整 `AgentIcon()` 中 `codexdb` / `codexdba` 的优先分支和样式。
4. 增加 runtime-to-vault agent 归一化函数，并让结论 selector 与 `ai-vault-original-pane.ts` 共用。
5. 增加 Agent 结论 selector 与单元测试，明确 preview、scope filter、`stateStartedAt` 排序、`filteredSessionIds` 搜索契约和 session log 入口。
6. 在 `AiVaultPanel.tsx` 接入 `AgentConclusionsBox`。
7. 补齐组件测试和一次手工 UI 验收。

## 待确认

- 当用户手动折叠仍有 live agent 的分组时，是否允许临时隐藏。建议初版保持 live agent 可见性优先，后续再加会话级手动覆盖。
- `codexdb` / `codexdba` 是否需要同步进入 AI Vault 的历史 Agent 类型列表。初版建议不纳入，运行态用 `runtimeAgent` 区分，Vault 匹配用 `vaultAgent: codex`。
- 是否在后续版本把 AI Vault 扫描结果升级为结论小框正式数据源，用于支持 worktree 删除后的结论展示。
