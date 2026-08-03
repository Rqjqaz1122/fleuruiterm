# FleurTerm 右键菜单视觉与动画设计

## 目标

将全局右键菜单调整为紧凑的深色半透明浮层，并让菜单从用户实际右键点击的位置放大出现、沿同一位置缩回关闭。动画不得改变菜单最终坐标，也不得引入弹簧、位移或缩放抖动。

## 视觉

- 使用约 10px 圆角、半透明 raised surface、细描边与柔和多层阴影。
- 菜单项采用紧凑行高和整行 hover，disabled 与 danger 状态继续使用现有语义颜色。
- 保留现有菜单宽度、键盘操作、viewport 限制和滚动能力。
- 使用 `backdrop-filter` 增强参考图的玻璃层次，并提供无 blur 环境下仍可读的背景色。

## 动画

- 打开时从 `scale(0.82)` 与透明状态过渡到 `scale(1)`，持续 160ms。
- 关闭时从 `scale(1)` 缩回到 `scale(0.94)` 并淡出，持续 110ms。
- 使用平滑 cubic-bezier，不使用 spring、translate 或 overshoot。
- `transform-origin` 由右键坐标相对菜单最终边界的位置动态计算。
- 菜单因窗口边缘发生反向定位时，动画原点仍指向实际点击点，并限制在菜单可见边界内。
- 支持 `prefers-reduced-motion: reduce`，在减少动态效果时关闭缩放并显著缩短透明度过渡。

## 实现边界

- `AppContextMenu.vue` 负责计算动画原点并使用 Vue `Transition` 保留离场节点。
- `contextMenu` service 与各页面菜单业务动作保持不变。
- CSS 只修改全局菜单视觉和 transition classes，不影响终端、AI、SFTP 或窗口缩放。
- 按用户要求不运行自动化测试、静态检查、构建或 GUI 验证。
