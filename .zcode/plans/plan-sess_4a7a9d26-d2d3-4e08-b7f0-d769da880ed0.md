## 方案A：新增 6 个自定义 agent（cc-mn/cc-db/cc-zp/cc-ali/codexdb/codexdba）

### 核心机制（已通过代码验证）
- Orca 的 PTY 用 `zsh -l`（login + 交互式，读 `~/.zshrc`）启动，`launchCmd` 作为一行命令 `proc.write(cmd + '\n')` 写入该 shell 执行。
- 你的 `cc-mn` 等是 `.zshrc` 加载的 **zsh 函数**，`codexdb`/`codexdba` 是 PATH 上的**脚本**——两者在此环境下都可直接调用，**无需新建 wrapper 脚本**。
- `promptInjectionMode: 'argv'`（同 claude）：prompt 作为参数拼到命令后，最终执行 `cc-mn "<prompt>"`，函数内 `"$@"` 透传给 claude。✓

### 改动文件（4 个源文件，纯新增条目）

**1. `src/shared/types.ts:2449`** — `TuiAgent` 联合类型追加 6 个成员：
```ts
  | 'ante'
  | 'cc-mn' | 'cc-db' | 'cc-zp' | 'cc-ali'  // claude + 各 provider
  | 'codexdb' | 'codexdba'                    // codex --profile doubao-*
```

**2. `src/shared/tui-agent-config.ts`** — `TUI_AGENT_CONFIG` 表追加 6 条。模式参照 `claude`/`codex` 既有条目：
```ts
'cc-mn': {
  detectCmd: 'cc-mn',           // 注:函数不在PATH,detectCmd探测会miss
  launchCmd: 'cc-mn',           // 但launchCmd直接调函数名,shell里可用
  expectedProcess: 'claude',
  promptInjectionMode: 'argv',
  draftPromptFlag: '--prefill'  // 复用claude的prefill机制
},
// cc-db / cc-zp / cc-ali 同构,只改 launchCmd 和 key
'codexdb': {
  detectCmd: 'codexdb',
  launchCmd: 'codexdb',         // 脚本已在 ~/.local/bin,PATH可检测到
  expectedProcess: 'codex',
  promptInjectionMode: 'argv',
  preflightTrust: 'codex',
  draftPasteReadySignal: 'codex-composer-prompt'
},
// codexdba 同构
```

**3. `src/shared/agent-kind.ts`** — `TUI_AGENT_KIND_BY_AGENT` 追加 6 条映射（复用现有枚举值，不改 `AGENT_KIND_VALUES`）：
```ts
'cc-mn': 'claude-code', 'cc-db': 'claude-code', 'cc-zp': 'claude-code', 'cc-ali': 'claude-code',
'codexdb': 'codex', 'codexdba': 'codex',
```

**4. `src/shared/tui-agent-display-names.ts`** — `TUI_AGENT_DISPLAY_NAMES` 追加 6 条（`satisfies Record<TuiAgent,...>` 编译校验要求）：
```ts
'cc-mn': 'CC (MiniMax)', 'cc-db': 'CC (Doubao)', 'cc-zp': 'CC (Zhipu)', 'cc-ali': 'CC (Aliyun)',
'codexdb': 'Codex (Doubao Coding)', 'codexdba': 'Codex (Doubao Agent)',
```

### 需要你手动操作的 UI 部分（零代码）
改完后在 Orca **Settings → Agents** 面板，由于 `cc-*` 是函数无法被 PATH 检测，需要用 **`agentCmdOverrides`** 把它"挂"到一个已检测到的 agent 上？——

**等等，这里有个阻塞点需要重新核实**：agent 的检测和启动是分离的。`detectCmd` 决定是否在 UI 显示为"已安装"，`launchCmd` 决定实际跑什么。我需要确认：如果 `detectCmd` 探测不到（函数不在 PATH），Orca 是完全隐藏这个 agent（UI 不可选），还是仍允许手动添加/启动。

这个点决定了 cc-* 能否真正用起来。**我需要先做一步代码核实**（读 detection 如何影响 UI 可用性），再定最终方案。如果隐藏，则 cc-* 需要 fallback 到 wrapper 脚本方案（让它们出现在 PATH 上）。

### 验证步骤
1. `pnpm typecheck` —— 4 个文件的 exhaustive 校验必须全过
2. `pnpm dev` —— 启动后在 worktree 新建 agent tab，看 6 个新 agent 是否可选
3. 实测 `cc-mn`/`codexdb` 能否正确启动并接收 prompt

### 待确认的阻塞点
上面那个"detectCmd miss 是否导致 UI 隐藏"的问题，我建议：**退出 plan mode 后先做一步快速代码核实**（5 分钟），根据结果决定 cc-* 用"函数直调"还是"补 wrapper 脚本"。这不影响 codexdb/codexdba（脚本在 PATH，必能检测）。

---
**关于更新机制**（你已选"改1行只提示不自动装"）：
- 改 `src/main/updater.ts:1392`：`autoUpdater.autoInstallOnAppQuit = true` → `false`
- 效果：保留自动检测 + UI 提示新 release，但永不自动下载/安装，完全手动控制。