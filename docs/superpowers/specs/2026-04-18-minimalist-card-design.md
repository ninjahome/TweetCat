# 中间栏极简卡片样式设计

## 概述

将TweetCat中间栏的推文item改造为极简卡片样式,通过间距和圆角实现清晰的视觉层次,去除多余的视觉元素。

## 设计目标

- 实现完全扁平化的极简风格
- 通过间距自然分隔卡片
- 保持良好的可读性和交互体验
- 最小化代码改动

## 视觉设计

### 核心样式决策

1. **扁平化处理**
   - 无边框
   - 无阴影
   - 无背景色差异
   - 纯粹通过留白区分卡片

2. **圆角设计**
   - 卡片圆角: 10px (中等圆角)
   - 提供现代感的同时保持简洁

3. **间距系统**
   - 卡片内边距: 保持当前 16px (padding: 0 16px 12px)
   - 卡片间距: 12px (margin-bottom)
   - 移除底部分割线 `.tweet-bottomline`

4. **交互效果**
   - 保持当前的hover背景色微变效果
   - 不添加额外的动画或阴影

### 视觉效果描述

卡片通过适度的圆角和间距形成独立的视觉单元,整体呈现干净、透气、现代的极简风格。用户hover时有轻微的背景色变化提供交互反馈。

## 技术实现

### 修改文件

`dist/css/content.css`

### 具体改动

1. **给卡片容器添加圆角和间距**
   - 目标元素: `.tweet-cardfloat`
   - 添加 `border-radius: 10px`
   - 添加 `margin-bottom: 12px`
   - 添加 `overflow: hidden` 确保内容不超出圆角边界

2. **隐藏底部分割线**
   - 目标元素: `.tweet-bottomline`
   - 设置 `display: none`

### CSS代码

```css
.tweet-cardfloat {
    width: 100%;
    min-height: 100px;
    left: 0;
    will-change: transform;
    visibility: hidden;
    scrollbar-color: rgb(185, 202, 211) rgb(247, 249, 249);
    overflow-anchor: none;
    
    /* 新增样式 */
    border-radius: 10px;
    margin-bottom: 12px;
    overflow: hidden;
}

.tweet-bottomline {
    /* 隐藏分割线 */
    display: none;
}
```

### 保持不变的部分

- `.tweet-card` 的内边距保持不变
- `.tweet-cardfloat:hover` 的背景色效果保持不变
- 所有内部元素(头像、用户名、内容、媒体、操作按钮)的布局和样式保持不变

## 兼容性考虑

### 深色模式

现有的深色模式样式会自动适配,因为:
- 圆角和间距是结构性样式,不受主题影响
- hover效果已在 `tweet_render.css` 中针对深色模式做了适配

### 响应式

当前设计不涉及响应式改动,卡片宽度由父容器 `.tweetTimeline` 控制(max-width: 600px),保持不变。

## 实现步骤

1. 修改 `dist/css/content.css` 文件
2. 更新 `.tweet-cardfloat` 样式
3. 隐藏 `.tweet-bottomline` 元素
4. 测试深色/浅色模式下的视觉效果
5. 测试hover交互效果
6. 验证内容不会超出圆角边界

## 验证标准

- [x] 卡片有10px圆角
- [x] 卡片之间有12px间距
- [x] 底部分割线已隐藏
- [x] hover效果正常工作
- [x] 深色模式下样式正常
- [x] 内容不超出圆角边界
- [x] 整体视觉呈现极简、干净

## 潜在风险

**低风险改动**:
- 仅修改CSS样式,不涉及HTML结构或JavaScript逻辑
- 改动范围小,仅2个CSS规则
- 不影响现有功能

**回滚方案**:
如需回滚,只需移除新增的3行CSS即可恢复原样。
