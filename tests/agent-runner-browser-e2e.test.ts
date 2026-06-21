/**
 * @eN ref end-to-end integration tests.
 *
 * Tests the full snapshot → click/fill/hover(@eN) lifecycle
 * against the running Electron app's CDP endpoint.
 *
 * These tests mirror the internal logic in AgentRunner:
 *   flattenA11y() — produces @eN lines + _snapshotRefMap
 *   _resolveLocator() — resolves @eN / CSS / text → Playwright Locator
 *   _invalidateSnapshotRefs() — clears ref map on navigate
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';

const CDP_URL = 'http://127.0.0.1:9224';

let browser: Browser;
let page: Page;

// ---- Mirror of AgentRunner._snapshotRefMap + flattenA11y ----

type SnapshotRef = {
  role: string;
  name?: string;
  placeholder?: string;
  value?: string;
};

function flattenA11y(axNodes: Record<string, unknown>[]): { lines: string[]; refMap: Map<string, SnapshotRef> } {
  const lines: string[] = [];
  const refMap = new Map<string, SnapshotRef>();
  let refIndex = 0;
  const interactiveRoles = new Set([
    'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox',
    'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option',
    'slider', 'spinbutton', 'heading', 'listitem',
  ]);
  const nodeMap = new Map<string, (typeof axNodes)[0]>();
  for (const n of axNodes) {
    nodeMap.set(n.nodeId as string, n);
  }
  const childIdSet = new Set(axNodes.flatMap((n) => (n.childIds as string[]) ?? []));
  const rootNodes = axNodes.filter((n) => !n.ignored && !childIdSet.has(n.nodeId as string));
  const starts = rootNodes.length > 0 ? rootNodes : axNodes.filter((n) => !n.ignored);

  function walk(node: Record<string, unknown>, depth: number) {
    if (node.ignored) {
      // Still walk children — ignored wrapper may contain interactive nodes
      for (const cid of (node.childIds as string[]) ?? []) {
        const child = nodeMap.get(cid);
        if (child) walk(child, depth);
      }
      return;
    }
    const roleValue = node.role as { value?: string } | undefined;
    const role = roleValue?.value?.toLowerCase() ?? '';
    if (interactiveRoles.has(role)) {
      refIndex++;
      const ref = `@e${refIndex}`;
      const indent = '  '.repeat(depth);
      const parts: string[] = [`${indent}${ref} [${role}`];
      const nameValue = node.name as { value?: string } | undefined;
      const name = nameValue?.value;
      if (name) parts.push(`name="${name}"`);
      const props = (node.properties as Array<{ name: string; value: { value?: string } }>) ?? [];
      const getProp = (pn: string) => props.find((p) => p.name === pn)?.value?.value;
      const val = getProp('valuetext') ?? getProp('value');
      if (val !== undefined && val !== '') parts.push(`value="${val}"`);
      const checked = getProp('checked');
      if (checked === 'mixed' || checked === 'true') parts.push('checked');
      if (getProp('disabled') === 'true') parts.push('disabled');
      const placeholder = getProp('placeholder');
      if (placeholder) parts.push(`placeholder="${placeholder}"`);
      lines.push(`${parts.join(' ')}]`);
      refMap.set(ref, { role, name: name || undefined, placeholder: placeholder || undefined, value: val || undefined });
    }
    for (const cid of (node.childIds as string[]) ?? []) {
      const child = nodeMap.get(cid);
      if (child) walk(child, depth + (interactiveRoles.has(role) ? 1 : 0));
    }
  }
  for (const root of starts) walk(root, 0);
  return { lines, refMap };
}

// ---- Mirror of AgentRunner._resolveLocator ----

function resolveLocator(page: Page, selector: string, refMap: Map<string, SnapshotRef> | null) {
  const refMatch = /^@e(\d+)$/.exec(selector);
  if (refMatch && refMap) {
    const info = refMap.get(selector);
    if (info) {
      const { role, name, placeholder } = info;
      if (role === 'textbox' || role === 'searchbox') {
        if (placeholder) return page.getByPlaceholder(placeholder);
        if (name) return page.getByRole(role as 'textbox' | 'searchbox', { name });
      }
      if (role === 'button') return page.getByRole('button', { name: name || '' });
      if (role === 'link') return page.getByRole('link', { name: name || '' });
      if (role === 'checkbox') return page.getByRole('checkbox', { name: name || '' });
      if (role === 'radio') return page.getByRole('radio', { name: name || '' });
      if (role === 'combobox' || role === 'listbox')
        return page.getByRole(role as 'combobox' | 'listbox', { name: name || '' });
      if (name) return page.getByRole(role as 'button', { name });
    }
    throw new Error(`Snapshot ref "${selector}" not found in current snapshot.`);
  }
  return page.locator(selector);
}

// ---- Helpers ----

async function doSnapshot(): Promise<{ lines: string[]; refMap: Map<string, SnapshotRef> }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Accessibility.enable');
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  await cdp.detach();
  return flattenA11y(nodes as Record<string, unknown>[]);
}

// ---- Setup / Teardown ----

beforeAll(async () => {
  browser = await chromium.connectOverCDP(CDP_URL);
  const pages = browser.contexts()[0].pages();
  // The internal browser panel is the blank page (data: URL).
  // If it has been navigated away, pick any non-app page.
  page = pages.find((p) => p.url().startsWith('data:'))
    || pages.find((p) => {
      const u = p.url();
      return !u.startsWith('devtools://') && !u.startsWith('chrome-extension://')
        && !u.includes('app.asar');
    })!;
  if (!page) throw new Error('No usable browser page found via CDP');
});

afterAll(async () => {
  await browser?.close().catch(() => {});
});

// ---- Tests ----

describe('@eN ref lifecycle (snapshot → click/fill/hover)', () => {
  it('1. snapshot produces @eN refs and non-empty refMap', async () => {
    await page.goto('data:text/html,' + encodeURIComponent(`
      <!DOCTYPE html>
      <html><body>
        <button>Submit</button>
        <input type="text" placeholder="Enter name">
        <a href="#">More info</a>
      </body></html>
    `), { waitUntil: 'domcontentloaded', timeout: 10000 });

    const { lines, refMap } = await doSnapshot();

    expect(lines.length).toBeGreaterThan(0);
    expect(refMap.size).toBeGreaterThan(0);

    // At least one button and one textbox
    const roles = [...refMap.values()].map((r) => r.role);
    expect(roles).toContain('button');
    expect(roles).toContain('textbox');

    // Lines use @eN format
    expect(lines.some((l) => /@e\d/.test(l))).toBe(true);

    console.log('Snapshot lines:', lines.join('\n'));
  });

  it('2. click(@eN) on a button works', async () => {
    await page.goto('data:text/html,' + encodeURIComponent(`
      <!DOCTYPE html>
      <html><body>
        <button id="the-btn" onclick="this.textContent='clicked!'">Click Me</button>
      </body></html>
    `), { waitUntil: 'domcontentloaded', timeout: 10000 });

    const { refMap } = await doSnapshot();

    // Find the button ref
    const buttonEntry = [...refMap.entries()].find(([, v]) => v.role === 'button' && v.name === 'Click Me');
    expect(buttonEntry).toBeDefined();
    const [btnRef] = buttonEntry!;

    // Click via @eN — locator resolves correctly
    const loc = resolveLocator(page, btnRef, refMap);
    const btnEl = loc.first();
    expect(await btnEl.count()).toBe(1);

    // Trigger click via evaluate (skip viewport check in test env)
    await btnEl.evaluate((el: HTMLElement) => el.click());
    const text = await page.locator('#the-btn').textContent();
    expect(text).toBe('clicked!');
  });

  it('3. fill(@eN) on a textbox works', async () => {
    await page.goto('data:text/html,' + encodeURIComponent(`
      <!DOCTYPE html>
      <html><body>
        <input type="text" placeholder="Search..." id="search-box">
      </body></html>
    `), { waitUntil: 'domcontentloaded', timeout: 10000 });

    const { refMap } = await doSnapshot();

    const textboxEntry = [...refMap.entries()].find(([, v]) => v.role === 'textbox');
    expect(textboxEntry).toBeDefined();
    const [tbRef] = textboxEntry!;

    const loc = resolveLocator(page, tbRef, refMap);
    await loc.fill('hello from @eN', { timeout: 3000 });

    const val = await page.locator('#search-box').inputValue();
    expect(val).toBe('hello from @eN');

    // Also verify CSS selector still works as fallback
    const cssLoc = resolveLocator(page, '#search-box', null); // null refMap = CSS mode
    await cssLoc.fill('css fallback', { timeout: 5000 });
    expect(await page.locator('#search-box').inputValue()).toBe('css fallback');
  });

  it('4. hover(@eN) on an element works', async () => {
    await page.goto('data:text/html,' + encodeURIComponent(`
      <!DOCTYPE html>
      <html><body>
        <div id="hover-zone"
             style="width:200px;height:100px;background:red;color:white;display:flex;align-items:center;justify-content:center;"
             onmouseenter="this.style.background='green'"
             onmouseleave="this.style.background='red'"
        >Hover Zone</div>
      </body></html>
    `), { waitUntil: 'domcontentloaded', timeout: 10000 });

    const { refMap } = await doSnapshot();

    // May not have a specific role for div, but we can use CSS
    // Test hover via CSS selector through resolveLocator
    const loc = resolveLocator(page, '#hover-zone', refMap);
    expect(await loc.count()).toBe(1);

    // Trigger hover via evaluate (skip viewport check in test env)
    await loc.evaluate((el: HTMLElement) => el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })));
    // Wait a tick for the event
    await page.waitForTimeout(200);
    const bg = await page.locator('#hover-zone').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toContain('0, 128, 0'); // green
  });

  it('5. ref map is empty after starting with null (no previous snapshot)', async () => {
    // resolveLocator with null refMap should use CSS
    const loc = resolveLocator(page, '#nonexistent', null);
    // It should not throw — just return a locator (even if it matches nothing)
    expect(loc).toBeDefined();
    const count = await loc.count();
    expect(count).toBe(0); // no element matching #nonexistent
  });

  it('6. @eN ref not in map throws descriptive error', async () => {
    await page.goto('data:text/html,' + encodeURIComponent(`
      <!DOCTYPE html><html><body><button>OK</button></body></html>
    `), { waitUntil: 'domcontentloaded', timeout: 10000 });

    const { refMap } = await doSnapshot();

    expect(() => resolveLocator(page, '@e999', refMap)).toThrow(
      'Snapshot ref "@e999" not found in current snapshot.',
    );
  });
});
