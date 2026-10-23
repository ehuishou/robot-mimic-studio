# Robot Studio · 机器人动作实验室

基于 Vite + TypeScript + Three.js 的机器人展示与骨骼调试工作台。
当前只实现第一阶段；MediaPipe、动作映射、WebSocket 尚未实现。

## 运行

使用 Node.js 22.12+ 或 24 LTS；本机实际验证版本为 Node.js 24.22.1。

```powershell
npm ci
npm run dev
```

默认访问 http://localhost:5173 。页面支持鼠标拖动旋转、滚轮缩放、右键平移；
也提供正面、侧面、透视视角、网格、骨架、自动旋转和重置视角按钮。

## 模型与骨骼

将有使用授权的 GLB 文件放在 `public/models/robot.glb`，刷新页面即可加载。
模型会等比例缩放、水平居中并贴合地面。当前仓库没有附带第三方 GLB。
如果文件缺失、请求失败、15 秒请求超时、文件无效或解析失败，会显示原因并启用内置备用机器人。
备用模型由基础几何体和 17 个实际 THREE.Bone 节点构成，可直接验证关节运动。

外部模型的名称和层级始终来自 GLTFLoader 解析结果，没有预设 GLB 骨骼命名。
同名和未命名骨骼使用不同内部 ID；面板中的每个按钮对应一个真实骨骼对象。
没有骨骼的 GLB 仍可浏览，旋转调试会禁用。当前不播放模型动画，以免覆盖手动调整。

调试滑块的角度是相对模型初始姿势的**局部 XYZ 欧拉旋转偏移**，不是世界旋转。
旋转通过 `初始四元数 × 偏移四元数` 应用；重置恢复各骨骼初始位置、四元数和缩放。
调试选中的骨骼显示小坐标轴，骨架工具按钮显示完整骨架。
面板 FPS 是当前浏览器实际渲染采样，不能作为手机推理或端到端性能结果。

外部纹理应与 GLB 一起部署，建议直接嵌入 GLB。
当前未配置 Draco、Meshopt、KTX2 解码器；这类模型需要转换或添加相应解码器。

## 模块职责

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | 页面状态、事件协调、模型初始化、页面退出/HMR 清理 |
| `src/scene/StudioScene.ts` | 渲染器、相机、轨道控制、灯光、地面、辅助线、FPS 和尺寸适配 |
| `src/robot/model.ts` | GLB 请求与解析、降级、模型归一化、共享资源释放 |
| `src/robot/fallback.ts` | 几何体机器人、真实父子骨骼与外观 |
| `src/robot/bones.ts` | 骨骼遍历、初始变换快照、局部旋转与重置 |
| `src/ui/layout.ts` | 页面和检查器布局 |
| `src/ui/icons.ts` | 内联 SVG 图标 |
| `src/style.css` | 深色界面、手机适配、焦点与交互样式 |
| `tests/robot.test.ts` | 姿态、层级、重置和共享资源释放测试 |
| `scripts/verify-browser.mjs` | Chromium 交互、模型异常与响应式验证 |
| `deploy/server.mjs` | 生产静态文件服务、正确 MIME、缓存和路径限制 |
| `deploy/robot-studio.service` | 独立 systemd 服务 |
| `deploy/deploy.ps1` | 构建、打包、上传、版本目录与服务更新 |

页面退出会取消渲染循环、取消请求、移除监听、断开 ResizeObserver、释放控制器、
几何体、材质、纹理、蒙皮骨架、阴影和渲染器。浏览器往返缓存保留页面时不销毁资源。

## 验证

```powershell
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run dev
# 在另一个终端运行；默认连接 http://127.0.0.1:5173
npm run test:browser
```

浏览器脚本会验证：模型缺失时的备用模型、关节调整和重置、骨骼搜索、工具按钮、
390px 窄屏、有真实 skin/joints 结构的合成 GLB、无骨骼 GLB、损坏文件与 WebGL 上下文丢失。
合成 GLB 仅为自动化夹具，不代表已验证任何第三方机器人资产。
截图和结果写入 `artifacts/`（不进入版本库）。

可以改用生产构建验证：

```powershell
npm run build
$env:PORT = '5173'
node deploy/server.mjs
# 在另一个终端运行 npm run test:browser
```

GitHub Actions 在推送与 PR 时运行单元测试、类型检查、构建及生产页面 Chromium 检查。

## 服务器部署

默认部署到 `121.199.30.133` 的 `/opt/robot-studio/releases/<版本时间>/`。
`/opt/robot-studio/current` 指向当前发布，独立服务名为 `robot-studio`，监听 80 端口。
服务器需要 Node.js 22+、systemd、tar、curl，80 端口应空闲且可访问。
服务使用 systemd 动态用户和仅绑定端口的能力运行。
SSH 私钥仅从本机路径读取，不会被打包或提交。

```powershell
powershell -ExecutionPolicy Bypass -File deploy/deploy.ps1
```

脚本默认使用用户指定的 SSH 地址和密钥，也可用 `-Server`、`-KeyPath` 参数覆盖。
重复部署会保留旧版本，`/opt/robot-studio/previous-release` 记录上一次发布目录。

服务排查：

```bash
systemctl status robot-studio
journalctl -u robot-studio -n 50 --no-pager
curl -I http://127.0.0.1/
readlink -f /opt/robot-studio/current
```

回滚时确认 `previous-release` 指向的旧版本，再将 `current` 软链接切回该版本并重启服务。
后续手机摄像头阶段需要配置 HTTPS，目前 HTTP 展示页只运行三维模型。

## 常见问题

- **显示内置机器人**：当前没有提供 GLB；这是正常降级。放入正确路径后重新构建、部署。
- **GLB 变成 HTML 或文件无效**：检查实际请求是否被网站重写成首页，文件是否为二进制 GLB。
- **模型没有骨骼**：确认导出时包含 Armature、Skin 和骨骼。查看器不会猜测或伪造骨骼。
- **骨骼动了但模型没动**：检查网格是否有正确的 skin 权重与关节绑定。
- **WebGL 无法启动**：使用支持 WebGL 2 的现代浏览器，启用硬件加速，检查显卡驱动。
- **模型压缩格式报错**：当前没有额外解码器，可先使用未压缩 GLB。
- **模型 404 日志**：未放置 GLB 时可能出现单次资源 404，随后备用模型正常运行；不进行循环重试。
- **构建出现体积提示**：Three.js 与加载器会产生较大的 JS 包；应按真实网络负载再决定分包策略。
- **服务器外网不可达**：分别检查服务状态、本机 HTTP、安全组及防火墙的 80 端口。

## 下一阶段前置条件

1. 选定有使用授权且具备合适骨架的目标机器人 GLB，记录真实骨骼和初始姿势。
2. 保留本阶段工作台，为手机姿态识别新增独立页面。
3. 确定 MediaPipe 模型/WASM 来源、版本及部署方式，并为手机访问配置 HTTPS。
4. 在接入动作映射前统一图像/世界坐标、左右方向、置信度与关节旋转约定。
5. 用模拟关键点先验证目标模型骨骼，再实现后续 WebSocket 通信。
