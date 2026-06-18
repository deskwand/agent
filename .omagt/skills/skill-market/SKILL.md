---
name: skill-market
version: 1.2.0
description: "Skill 市场——搜索、安装、更新和管理扩展 Skill。当用户需要的能力本地没有对应 Skill 时触发。"
builtin: true
author: omagt
license: MIT
allowed-tools: "read,write,shell,internal_browser_*"
metadata:
  tags: [skill, market, install, package-manager]
  category: meta
---

# Skill 市场

## 假设（Assumptions）

- **内置浏览器可用**：`internal_browser_new_page` / `internal_browser_snapshot` 用于搜 SPA 市场。若无（如当前在 eagent 平台），回退到 `shell curl` 搜 SSR 源或 API
- **shell curl/tar 可用**：下载 Skill 包的底层手段。macOS/Linux 自带；Windows 若无 tar，用 PowerShell Expand-Archive
- **Skill 以 SKILL.md 为入口**：一个 Skill = 一个包含 SKILL.md 的目录
- **GitHub 仓库双分支**：默认先试 `main`，404 回退 `master`
- **递归依赖上限**：最多 3 层，超限报告让用户决策
- **市场源可能不可达**：任一源超时 10s 即跳过，试下一个
- **安装即生效**：omagt agent-runner 检测 skillsSignature 变化后，下一条消息自动重建 pi session，无需手动重启

## 搜索

1. 按优先级依次搜索：skills.sh → skillhub.cn → ClawHub → GitHub topics
2. SSR 源直接 web_fetch / curl；SPA 源用内置浏览器打开 → snapshot 提取结果
3. 返回候选列表（名称 + 简短描述），让用户选择，不要自作主张安装

## 安装

搜索命中后，从搜索结果中提取 GitHub 仓库地址（owner/repo），然后：

```
# 1. 探测分支
curl -sIL -o /dev/null -w "%{http_code}" \
  "https://api.github.com/repos/{owner}/{repo}" | 取 default_branch

# 2. 下载完整仓库 tarball（保证 SKILL.md + 所有引用文件都在）
curl -sL "https://github.com/{owner}/{repo}/archive/{branch}.tar.gz" \
  -o /tmp/skill-{name}.tar.gz

# 3. 探测 tar 内顶层目录名
tar -tzf /tmp/skill-{name}.tar.gz | head -1

# 4. 提取 SKILL.md 所在目录 → ~/.omagt/skills/{skill-name}/
tar -xzf /tmp/skill-{name}.tar.gz -C /tmp/skill-extract/
# 情况A：仓库根目录有 SKILL.md → 提取整个 repo → 重命名
# 情况B：SKILL.md 在 {repo}/skills/{name}/ → 只提取该子目录
# 原则：以 SKILL.md 所在目录为 skill 根目录

# 5. 清理临时文件
rm -rf /tmp/skill-*
```

## 验证（必须执行）

安装后立即验证，不通过则报告失败原因：

1. `cat ~/.omagt/skills/{name}/SKILL.md | head -5` — 确认文件完整可读
2. 检查 frontmatter 有 `name` 和 `version` 字段
3. 若 requires 声明了 bins：逐一 `which {bin}` 检查
4. 若 requires 声明了 skills：检查本地 `~/.omagt/skills/{dep}/` 存在，缺则递归安装（上限 3 层）

## 更新

覆盖安装：重复安装流程，写入前先备份旧目录 → 验证通过后删备份，失败则回滚。

## 卸载

`rm -rf ~/.omagt/skills/{name}/`。若其他 Skill 依赖它，先警告。

## 市场源参考

| 源 | 类型 | 搜索方式 |
|----|------|---------|
| skills.sh | SSR | `curl https://skills.sh/search?q={keyword}` |
| skillhub.cn | SPA | 内置浏览器搜 |
| ClawHub | SPA | 内置浏览器搜 |
| GitHub topics | SSR | `curl https://github.com/topics/agent-skills` |
| agentskills.io | 标准 | 仅格式参考，不作搜索源 |

搜索时按顺序，首个有结果即用，全部无结果报告"未找到"。不要把搜索结果列表喂给用户评——先给精简摘要让用户选。

## 示例流程

```
用户："装飞书文档 skill"
  → web_fetch skills.sh 搜 lark → 找到 larksuite/cli
  → 确认用户要装 larksuite/cli
  → curl tarball → tar 提取 → 写到 ~/.omagt/skills/lark-cli/
  → 验证 SKILL.md 完整
  → 报告：已安装。omagt 检测到新 Skill，下条消息即可用。
```
