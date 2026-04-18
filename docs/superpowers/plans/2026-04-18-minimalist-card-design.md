# 中间栏极简卡片样式实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将中间栏推文item改造为极简卡片样式,通过圆角和间距实现清晰的视觉层次

**Architecture:** 修改CSS样式文件,给卡片容器添加圆角和底部间距,隐藏底部分割线,实现完全扁平化的极简设计

**Tech Stack:** CSS3

---

## File Structure

**Files to modify:**
- `dist/css/content.css` - 主要样式文件,包含 `.tweet-cardfloat` 和 `.tweet-bottomline` 的样式定义

**No new files needed** - 这是纯CSS样式调整

---

### Task 1: 备份当前样式

**Files:**
- Read: `dist/css/content.css:203-222`

- [ ] **Step 1: 读取当前的卡片样式**

读取 `.tweet-cardfloat` 和 `.tweet-bottomline` 的当前样式定义,确认修改位置。

Run: Read tool on `dist/css/content.css` lines 203-222

Expected: 看到 `.tweet-cardfloat` 和 `.tweet-bottomline` 的完整样式定义

- [ ] **Step 2: 创建git分支**

```bash
git checkout -b feature/minimalist-card-ui
```

Expected: 切换到新分支 `feature/minimalist-card-ui`

- [ ] **Step 3: 提交当前状态作为基准**

```bash
git add -A
git commit -m "chore: checkpoint before minimalist card UI changes" --allow-empty
```

Expected: 创建一个检查点提交

---

### Task 2: 修改卡片容器样式

**Files:**
- Modify: `dist/css/content.css:203-216`

- [ ] **Step 1: 给 .tweet-cardfloat 添加圆角和间距**

在 `.tweet-cardfloat` 规则中添加以下三行:

```css
.tweet-cardfloat {
    width: 100%;
    min-height: 100px;
    left: 0;
    will-change: transform;
    visibility: hidden;
    scrollbar-color: rgb(185, 202, 211) rgb(247, 249, 249);
    overflow-anchor: none;
    
    /* 新增: 极简卡片样式 */
    border-radius: 10px;
    margin-bottom: 12px;
    overflow: hidden;
}
```

- [ ] **Step 2: 验证CSS语法**

Run: 
```bash
# 检查CSS文件是否有语法错误
grep -A 15 "\.tweet-cardfloat {" dist/css/content.css
```

Expected: 输出包含新添加的三行样式,格式正确

- [ ] **Step 3: 提交卡片样式改动**

```bash
git add dist/css/content.css
git commit -m "style: add border-radius and spacing to tweet cards"
```

Expected: 提交成功,包含对 `.tweet-cardfloat` 的修改

---

### Task 3: 隐藏底部分割线

**Files:**
- Modify: `dist/css/content.css` (找到 `.tweet-bottomline` 规则)

- [ ] **Step 1: 找到 .tweet-bottomline 的位置**

Run:
```bash
grep -n "\.tweet-bottomline" dist/css/content.css
```

Expected: 输出行号,通常在 140 行附近

- [ ] **Step 2: 修改 .tweet-bottomline 样式**

将 `.tweet-bottomline` 的样式改为:

```css
.tweet-bottomline {
    display: none;
}
```

或者在现有规则中添加 `display: none;`

- [ ] **Step 3: 验证修改**

Run:
```bash
grep -A 3 "\.tweet-bottomline" dist/css/content.css
```

Expected: 输出显示 `display: none;` 已添加

- [ ] **Step 4: 提交分割线隐藏改动**

```bash
git add dist/css/content.css
git commit -m "style: hide tweet bottom divider line for minimalist design"
```

Expected: 提交成功

---

### Task 4: 验证视觉效果

**Files:**
- Read: `dist/css/content.css` (验证所有改动)
- Read: `dist/css/tweet_render.css` (确认深色模式兼容)

- [ ] **Step 1: 检查所有CSS改动**

Run:
```bash
git diff main..HEAD -- dist/css/content.css
```

Expected: 显示两处改动:
1. `.tweet-cardfloat` 添加了 3 行
2. `.tweet-bottomline` 添加或修改了 `display: none`

- [ ] **Step 2: 验证深色模式样式未受影响**

Run:
```bash
grep -A 5 "tweet-cardfloat:hover" dist/css/tweet_render.css
```

Expected: 深色模式的 hover 样式仍然存在且未被修改

- [ ] **Step 3: 检查是否有CSS冲突**

Run:
```bash
# 检查是否有其他地方覆盖了 border-radius
grep -n "border-radius.*0" dist/css/content.css | grep -i tweet
```

Expected: 没有输出,或者输出不包含 `.tweet-cardfloat`

- [ ] **Step 4: 创建验证检查清单**

在终端输出以下检查清单供手动测试:

```
手动验证清单:
□ 卡片有 10px 圆角
□ 卡片之间有 12px 间距
□ 底部分割线已消失
□ hover 时背景色微变效果正常
□ 深色模式下样式正常
□ 内容(图片/视频)不超出圆角边界
□ 整体视觉呈现极简、干净
```

---

### Task 5: 最终提交和文档

**Files:**
- Modify: `docs/superpowers/specs/2026-04-18-minimalist-card-design.md` (更新验证状态)

- [ ] **Step 1: 查看所有改动**

Run:
```bash
git log --oneline feature/minimalist-card-ui ^main
```

Expected: 显示 3 个提交:
1. checkpoint
2. add border-radius and spacing
3. hide bottom divider

- [ ] **Step 2: 创建最终提交**

```bash
git add -A
git commit -m "feat: implement minimalist card design for middle column

- Add 10px border-radius to tweet cards
- Add 12px spacing between cards
- Hide bottom divider line for cleaner look
- Maintain existing hover effects

Closes: minimalist card design spec"
```

Expected: 创建包含所有改动的最终提交

- [ ] **Step 3: 更新设计文档验证状态**

在 `docs/superpowers/specs/2026-04-18-minimalist-card-design.md` 的验证标准部分,将所有复选框标记为已完成(如果手动测试通过):

```markdown
## 验证标准

- [x] 卡片有10px圆角
- [x] 卡片之间有12px间距
- [x] 底部分割线已隐藏
- [x] hover效果正常工作
- [x] 深色模式下样式正常
- [x] 内容不超出圆角边界
- [x] 整体视觉呈现极简、干净
```

- [ ] **Step 4: 提交文档更新**

```bash
git add docs/superpowers/specs/2026-04-18-minimalist-card-design.md
git commit -m "docs: mark minimalist card design as verified"
```

Expected: 文档更新已提交

---

## 测试策略

**手动测试:**
1. 在浏览器中加载扩展
2. 导航到 TweetCat 中间栏
3. 验证卡片圆角和间距
4. 测试 hover 效果
5. 切换深色/浅色模式验证兼容性
6. 检查包含图片/视频的推文,确保内容不超出圆角

**回滚方案:**
如果视觉效果不符合预期:
```bash
git checkout main -- dist/css/content.css
```

---

## 完成标准

- [ ] 所有 CSS 改动已提交
- [ ] 手动测试通过所有验证项
- [ ] 深色模式正常工作
- [ ] 设计文档已更新
- [ ] 代码已推送到远程分支(可选)

---

## 注意事项

1. **最小化改动**: 仅修改 2 个 CSS 规则,不涉及 HTML 或 JavaScript
2. **保持兼容**: 不影响现有的 hover 效果和深色模式
3. **可回滚**: 所有改动都是纯 CSS,可以轻松回滚
4. **无破坏性**: 不删除任何现有样式,仅添加和隐藏
