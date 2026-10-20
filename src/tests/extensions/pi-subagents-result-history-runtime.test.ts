/**
 * 运行期回归：实际注册的 GET_RESULT 在 live 记录被真实 cleanup 删掉之后，
 * 仍然要能按 ID 取回当前父会话保存的结果。
 *
 * 每个场景在独立 Node 进程里跑真实扩展工厂 + 真实 AgentManager（见 fixtures/
 * subagent-result-harness.mjs）。这里不 mock 第三方模块，也不替代产品工具：
 * 断言针对的是真实 execute 的返回文本与真实 manager 的记录表。
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { it } from "vitest";

const ROOT = process.cwd();
const FIXTURE = pathToFileURL(
  resolve(ROOT, "src/tests/extensions/fixtures/subagent-result-harness.mjs"),
).href;

/** 在真实 Node 进程里执行一段场景代码；失败时抛出带 stderr 的错误。 */
function run(body: string): string {
  try {
    return execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
        import assert from "node:assert/strict";
        import { createHarness } from ${JSON.stringify(FIXTURE)};
        const h = await createHarness(${JSON.stringify(ROOT)});
        try { ${body} } finally { await h.close(); }
        `,
      ],
      {
        cwd: ROOT,
        env: { ...process.env, PI_PACKAGE_DIR: "" },
        timeout: 60_000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).toString();
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? "";
    throw new Error(`${String(error)}\n--- fixture stderr ---\n${stderr}`);
  }
}

it("actual tool reads an old persisted result after a live miss", () => {
  run(`
    h.parent.appendCustomEntry('subagents:record', {
      id: 'old-id', status: 'completed', result: 'ANSWER-A'
    });
    const result = await h.execute('get_subagent_result', {agent_id:'old-id', wait:true, verbose:true});
    assert.match(result.content[0].text, /ANSWER-A/);
    assert.match(result.content[0].text, /Full conversation is unavailable/);
  `);
});

it("unknown ids and non-terminal-only snapshots still report not found", () => {
  run(`
    const missing = await h.execute('get_subagent_result', {agent_id:'never-existed'});
    assert.match(missing.content[0].text, /Agent not found/);
    h.parent.appendCustomEntry('subagents:result-state', {id:'started-only', status:'running'});
    const started = await h.execute('get_subagent_result', {agent_id:'started-only'});
    assert.match(started.content[0].text, /Agent not found/);
  `);
});

it("a completed run with no saved output says so instead of returning nothing", () => {
  run(`
    h.parent.appendCustomEntry('subagents:record', {id:'empty-id', status:'completed', result:''});
    const result = await h.execute('get_subagent_result', {agent_id:'empty-id'});
    assert.match(result.content[0].text, /No final output was saved\\./);
    assert.doesNotMatch(result.content[0].text, /Agent not found/);
  `);
});

const resumeRecord = `
  const subscribers = new Set();
  const child = {
    messages: [], subscribe: fn => { subscribers.add(fn); return () => subscribers.delete(fn); },
    abort: async () => {}, dispose: () => {},
    prompt: async () => {
      child.messages.push({role:'assistant', content:[{type:'text', text:'ANSWER-B'}], stopReason:'stop'});
    },
  };
  const record = {id:'resume-id', type:'Explore', description:'resume regression',
    status:'completed', result:'ANSWER-A', toolUses:0, startedAt:Date.now(), completedAt:Date.now(),
    isBackground:true, resultConsumed:true, session:child, compactionCount:0,
    lifetimeUsage:{input:0, output:0, cacheWrite:0, cacheRead:0, cost:0}};
  h.manager.agents.set(record.id, record);
  h.parent.appendCustomEntry('subagents:record', {
    id:record.id, status:record.status, result:record.result
  });
`;

const runForegroundResume = `
  await h.execute('Agent', {subagent_type:'Explore', resume:record.id,
    prompt:'next step', description:'resume regression', run_in_background:false});
  record.completedAt = Date.now() - 660_000;
  h.manager.cleanup();
  assert.equal(h.manager.getRecord(record.id), undefined);
  const result = await h.execute('get_subagent_result', {agent_id:record.id});
`;

it("background result followed by a foreground resume survives TTL with the NEW output", () => {
  run(`
    ${resumeRecord}
    ${runForegroundResume}
    assert.match(result.content[0].text, /ANSWER-B/);
    assert.doesNotMatch(result.content[0].text, /ANSWER-A/);
  `);
});

it("a failed foreground resume reports the new failure, not the old answer", () => {
  run(`
    ${resumeRecord}
    child.prompt = async () => { throw new Error('NEW-FAILURE'); };
    await h.execute('Agent', {subagent_type:'Explore', resume:record.id,
      prompt:'next step', description:'resume regression', run_in_background:false});
    record.completedAt = Date.now() - 660_000;
    h.manager.cleanup();
    const result = await h.execute('get_subagent_result', {agent_id:record.id});
    assert.match(result.content[0].text, /Status: error/);
    assert.match(result.content[0].text, /NEW-FAILURE/);
    assert.doesNotMatch(result.content[0].text, /ANSWER-A/);
  `);
});

it("an in-flight foreground resume records a start barrier instead of leaving the old snapshot newest", () => {
  run(`
    ${resumeRecord}
    let release;
    child.prompt = () => new Promise(resolve => { release = resolve; });
    const running = h.execute('Agent', {subagent_type:'Explore', resume:record.id,
      prompt:'next step', description:'resume regression', run_in_background:false});
    try {
      assert.equal(record.status, 'running');
      const latest = h.parent.getEntries()
        .filter(e => ['subagents:record','subagents:result-state'].includes(e.customType)
          && e.data?.id === record.id).at(-1);
      assert.equal(latest.customType, 'subagents:result-state');
    } finally {
      release();
      await running;
    }
  `);
});

it("the tools still report a live running agent and refuse a steered-out-of-scope id", () => {
  run(`
    const live = {id:'live-id', type:'Explore', description:'live', status:'running',
      toolUses:0, startedAt:Date.now()};
    h.manager.agents.set(live.id, live);
    h.parent.appendCustomEntry('subagents:record', {id:live.id, status:'completed', result:'OLD'});
    const result = await h.execute('get_subagent_result', {agent_id:live.id});
    assert.match(result.content[0].text, /still running/);
    assert.doesNotMatch(result.content[0].text, /OLD/);
    const steer = await h.execute('steer_subagent', {agent_id:'never-existed', message:'hi'});
    assert.match(steer.content[0].text, /Agent not found/);
    h.manager.agents.delete(live.id);
  `);
});

it("a live nested record is still refused, and history is not used to bypass ownership", () => {
  run(`
    const nested = {id:'nested-id', type:'Explore', description:'nested', status:'completed',
      toolUses:0, startedAt:Date.now(), completedAt:Date.now(), parentAgentId:'owner-id',
      result:'NESTED-ANSWER'};
    h.manager.agents.set(nested.id, nested);
    h.parent.appendCustomEntry('subagents:record', {id:nested.id, status:'completed', result:'NESTED-ANSWER'});
    const result = await h.execute('get_subagent_result', {agent_id:nested.id});
    assert.match(result.content[0].text, /Agent not found/);
    h.manager.agents.delete(nested.id);
  `);
});

it("an alias reference is not resolved from history (exact ID only)", () => {
  run(`
    h.parent.appendCustomEntry('subagents:record', {
      id:'aliased-id', status:'completed', result:'ANSWER-A', handle:'explore-2', alias:'turing'
    });
    for (const agent_id of ['@turing', 'explore-2', 'aliased']) {
      const result = await h.execute('get_subagent_result', {agent_id});
      assert.match(result.content[0].text, /Agent not found/);
    }
  `);
});

// —— 真实 TTL、父会话边界与资源释放 ——
// 这里用真实 AgentManager 的 cleanup/clearCompleted，不替换实现，也不让记录
// 留在表里充当「通过」。

it("evicts both read and unread records but still returns the saved output", () => {
  run(`
    for (const resultConsumed of [false, true]) {
      const id = 'ttl-' + resultConsumed;
      const record = {id, type:'Explore', description:'TTL', status:'completed',
        result:'SAVED-'+id, toolUses:0, startedAt:Date.now()-700_000,
        completedAt:Date.now()-660_000, resultConsumed};
      h.manager.agents.set(id, record);
      h.parent.appendCustomEntry('subagents:record', {...record});
      if (!resultConsumed) {
        h.manager.clearCompleted(true);
        assert.equal(h.manager.getRecord(id), record);
      }
      h.manager.cleanup();
      assert.equal(h.manager.getRecord(id), undefined);
      for (let i=0; i<2; i++) {
        const result = await h.execute('get_subagent_result', {agent_id:id});
        assert.match(result.content[0].text, new RegExp('SAVED-'+id));
        assert.equal(h.manager.getRecord(id), undefined);
      }
    }
  `);
});

it("a branch switch keeps access to the parent session history; another parent has none", () => {
  run(`
    const anchor = h.parent.appendCustomEntry('anchor', {});
    h.parent.appendCustomEntry('subagents:record', {
      id:'branch-id', status:'completed', result:'BRANCH-ANSWER'
    });
    h.parent.branch(anchor);
    h.parent.appendCustomEntry('other-branch', {});
    assert.equal(h.parent.getBranch().some(e => e.customType === 'subagents:record'), false);
    const result = await h.execute('get_subagent_result', {agent_id:'branch-id'});
    assert.match(result.content[0].text, /BRANCH-ANSWER/);
    h.setParent(h.SessionManager.inMemory());
    const foreign = await h.execute('get_subagent_result', {agent_id:'branch-id'});
    assert.match(foreign.content[0].text, /Agent not found/);
  `);
});

it("cleanup releases the child session exactly once, and retrieval never resurrects it", () => {
  run(`
    let shutdowns = 0, disposals = 0;
    const child = {extensionRunner:{hasHandlers:() => true, emit: async () => {shutdowns++;}},
      dispose: () => {disposals++;}};
    const record = {id:'dispose-id', type:'Explore', description:'dispose', status:'completed',
      toolUses:0, startedAt:0, completedAt:Date.now()-660_000, session:child};
    h.manager.agents.set(record.id, record);
    h.parent.appendCustomEntry('subagents:record', {
      id:record.id, status:'completed', result:'RELEASED'
    });
    h.manager.cleanup();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(shutdowns, 1);
    assert.equal(disposals, 1);
    const first = await h.execute('get_subagent_result', {agent_id:record.id});
    const second = await h.execute('get_subagent_result', {agent_id:record.id});
    assert.match(first.content[0].text, /RELEASED/);
    assert.match(second.content[0].text, /RELEASED/);
    assert.equal(h.manager.getRecord(record.id), undefined);
    assert.equal(h.manager.listAgents().length, 0);
    assert.equal(shutdowns, 1);
    assert.equal(disposals, 1);
  `);
});

it("a live record still wins over history, and running/queued records are never evicted", () => {
  run(`
    const record = {id:'live-id', type:'Explore', description:'live', status:'running',
      toolUses:0, startedAt:Date.now()-700_000};
    h.manager.agents.set(record.id, record);
    h.parent.appendCustomEntry('subagents:record', {id:record.id, status:'completed', result:'OLD'});
    h.manager.cleanup();
    assert.equal(h.manager.getRecord(record.id), record);
    const result = await h.execute('get_subagent_result', {agent_id:record.id});
    assert.match(result.content[0].text, /still running/);
    assert.doesNotMatch(result.content[0].text, /OLD/);
    h.manager.agents.delete(record.id);
  `);
});

it("keeps the exact 10-minute boundary and never evicts queued records", () => {
  run(`
    const originalNow = Date.now;
    Date.now = () => 2_000_000;
    try {
      const make = (id, status, completedAt) => ({id, type:'Explore', description:'boundary',
        status, toolUses:0, startedAt:0, completedAt});
      const kept = make('boundary', 'completed', 1_400_000);
      const evicted = make('past', 'completed', 1_399_999);
      const queued = make('queued', 'queued', 0);
      for (const r of [kept, evicted, queued]) h.manager.agents.set(r.id, r);
      h.manager.cleanup();
      assert.equal(h.manager.getRecord(kept.id), kept);
      assert.equal(h.manager.getRecord(evicted.id), undefined);
      assert.equal(h.manager.getRecord(queued.id), queued);
      h.manager.agents.delete(queued.id);
    } finally { Date.now = originalNow; }
  `);
});

it("history snapshots survive a completed run with a partial status", () => {
  run(`
    for (const status of ['stopped', 'aborted', 'steered', 'error']) {
      const id = 'partial-' + status;
      h.parent.appendCustomEntry('subagents:record', {
        id, status, result:'PARTIAL-'+status, error: status === 'error' ? 'boom' : undefined
      });
      const result = await h.execute('get_subagent_result', {agent_id:id});
      const text = result.content[0].text;
      assert.match(text, new RegExp('PARTIAL-'+status));
      assert.match(text, /partial|incomplete/i);
      assert.match(text, new RegExp('Status: ' + status));
    }
  `);
});

// —— 写侧屏障：onStart 回调与排队续跑 ——
// 这两个入口不经过 Agent 工具的前台分支，所以必须单独验证它们的落盘位置：
// 屏障写早了会在嵌套子代理上留下不属于它的条目，写晚了（在 persistAgentResult
// 之后）就等于没写 —— 旧答案会重新变成最新快照。

it("the background onStart barrier is written for top-level agents only", () => {
  run(`
    const onStart = h.manager.onStart;
    assert.equal(typeof onStart, 'function');
    const topLevel = {id:'bg-top', type:'Explore', description:'bg', status:'running',
      toolUses:0, startedAt:Date.now()};
    onStart(topLevel);
    const mine = e => e.customType === 'subagents:result-state' && e.data?.id === topLevel.id;
    assert.equal(h.parent.getEntries().filter(mine).length, 1);
    assert.equal(h.parent.getEntries().filter(mine).at(-1).data.status, 'running');

    const nested = {id:'bg-nested', type:'Explore', description:'nested', status:'running',
      toolUses:0, startedAt:Date.now(), parentAgentId:'owner-id'};
    onStart(nested);
    assert.equal(h.parent.getEntries().some(e => e.data?.id === nested.id), false);
  `);
});

it("a queued background resume writes a queued barrier, so the old answer is not served", () => {
  run(`
    ${resumeRecord}
    h.manager.setMaxConcurrent(1);
    h.manager.runningBackground = 1; // 池满：下一次后台续跑只能排队
    try {
      const started = await h.execute('Agent', {subagent_type:'Explore', resume:record.id,
        prompt:'next step', description:'resume regression', run_in_background:true});
      assert.match(started.content[0].text, /queued/i);
      assert.equal(record.status, 'queued');
      const latest = h.parent.getEntries()
        .filter(e => ['subagents:record','subagents:result-state'].includes(e.customType)
          && e.data?.id === record.id).at(-1);
      assert.equal(latest.customType, 'subagents:result-state');
      assert.equal(latest.data.status, 'queued');
      // 屏障的用处：排队期间旧答案不能被当成这一次的结果。live 记录优先，
      // 所以这里答的是「排队中、还没有输出」而不是上一次的 ANSWER-A。
      const result = await h.execute('get_subagent_result', {agent_id:record.id});
      assert.doesNotMatch(result.content[0].text, /ANSWER-A/);
      assert.match(result.content[0].text, /Status: queued/);
    } finally {
      h.manager.runningBackground = 0;
    }
  `);
});
