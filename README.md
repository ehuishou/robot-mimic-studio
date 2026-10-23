# Robot Studio · 机器人动作实验室

基于 Vite + TypeScript + Three.js 的机器人展示与骨骼调试工作台。
已实现机器人工作台、手机端 MediaPipe 姿态识别与第三阶段双上臂动作映射。支持同页模拟输入和本机摄像头驱动；跨设备 WebSocket 尚未实现。

展示地址：[打开 Robot Studio](https://121.199.30.133/) · [手机姿态识别](https://121.199.30.133/pose.html) · [机器人动作映射](https://121.199.30.133/mapping.html)

GitHub：[ehuishou/robot-mimic-studio](https://github.com/ehuishou/robot-mimic-studio)（私有仓库）

实际验收记录：[第一阶段](docs/verification-2026-10-23.md) · [第二阶段](docs/stage-02-verification.md) · [第三阶段](docs/stage-03-verification.md)

## 运行

使用 Node.js 22.12+ 或 24 LTS；本机实际验证版本为 Node.js 24.22.1。

```powershell
npm ci
npm run prepare:pose
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
截图和结果写入 `artifacts/`（不进入版本库）。本机已有 Edge 时，可设置 `BROWSER_CHANNEL=msedge` 使用 Edge 执行同一验证。

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
`/opt/robot-studio/current` 指向当前发布，独立服务名为 `robot-studio`，HTTP 监听 80，配置证书后同时在 443 提供 HTTPS；HTTP 请求跳转到 HTTPS，ACME 验证路径保留 HTTP。
服务器需要 Node.js 22+、systemd、tar、curl；首次配置 HTTPS 还需要 Python 3、venv、pip。80 和 443 端口均须可公开访问。
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
手机摄像头使用 HTTPS。首次启用时，将第二阶段部署完成后在服务器运行 `bash /opt/robot-studio/current/deploy/setup-https.sh`。脚本使用独立 Python 虚拟环境中的 Certbot 5.4.0 / acme 5.4.0，通过 HTTP webroot 为公网 IP 申请 shortlived 证书，安装 TLS 配置与每天两次的续期定时器。密钥留在服务器，由 systemd credentials 交给动态用户服务。续期成功后重启应用加载证书；正常发布复用证书与定时器。可用 `systemctl list-timers robot-studio-certbot.timer` 和 `journalctl -u robot-studio-certbot` 查看维护状态。

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
2. 完成真实手机上的授权、停止摄像头及五分钟运行验收。
3. 第二阶段已提供独立手机页及同源模型/WASM，后续保持资源版本一致。
4. 在接入动作映射前统一图像/世界坐标、左右方向、置信度与关节旋转约定。
5. 用模拟关键点先验证目标模型骨骼，再实现后续 WebSocket 通信。

## 手机端姿态识别（阶段 02）

本地运行先执行 `npm run prepare:pose`，再打开 `http://localhost:5173/pose.html`；生产构建自动准备资源。
手机访问公网 HTTPS 地址，点击“启动摄像头”并授权，默认优先后置摄像头，可切换前置或选择浏览器列出的具体镜头；仅有一个摄像头时由浏览器使用可用设备。
localhost 的安全上下文例外只适用于访问设备本身，手机访问电脑局域网 HTTP 地址不能据此获得摄像头权限。

识别使用锁定的 `@mediapipe/tasks-vision` 1.1.1 和官方 Lite 模型，单人、VIDEO、CPU 模式，不生成分割掩码。
模型为 5,777,746 字节，资源脚本校验 SHA-256，WASM/loader 来自同一安装包。来源和路径见 [资源说明](public/mediapipe/README.md)。
媒体图像在本机处理；手机页 CSP 将联网目标限制为本站，项目不上传图像、不录制、不添加遥测。

后置画面与骨架按原始方向显示，仅明确为前置的摄像头进行镜像预览；坐标数据保持原始左右约定；归一化图像坐标用于绘制，worldLandmarks 单独保存，不混用。
界面显示有效点数 / 返回点数及实际完成的推理 FPS。可见度阈值为 0.5，低置信度点及相关连线不绘制。
推理最多约 20 次/秒，使用视频帧回调（或 RAF 降级）并跳过重复帧。
停止、离开页面或切入后台会取消循环、停止所有 tracks、关闭推理实例并清空视频；返回后手动重新启动。
启动期间也可停止；延迟返回的摄像头和识别实例会释放。

默认请求 1280 × 720，界面显示设备实际提供的分辨率。授权后列出可用摄像头，选择镜头时先停止旧流再重新启动识别。若设备通过 `getCapabilities().zoom` 开放变焦，则按实际最小值、最大值及步长启用滑块，以 `applyConstraints` 调整摄像头，并显示 `getSettings().zoom` 返回的倍率。变焦请求串行处理，不进行 CSS 放大；失败后恢复已应用倍率。不支持或未返回实际倍率时提供提示。广角、长焦及倍率范围取决于手机与浏览器提供的能力，不承诺光学变焦、特定焦距或画质提升。

模块位于 `src/mobile/`（页面控制、布局、样式）和 `src/pose/`（摄像头、推理、绘制、类型）。
三个 HTML 入口分别构建，模型工作台不会加载 MediaPipe 引擎；映射页仅在主动启动摄像头时加载识别引擎。

```powershell
npm run test:pose
# 使用已安装的 Edge：
$env:BROWSER_CHANNEL = 'msedge'
npm run test:pose
```

自动化使用模拟摄像头和真实 MediaPipe/WASM，覆盖权限拒绝、模型/WASM 失败、延迟授权取消、无人、停止/重启、退出和窄屏，以及后置 HD 约束、前后/具体镜头切换、变焦串行应用、变焦失败及停止期间的资源清理。
可选真实人体图片验证：将 Google 官方测试图 `https://storage.googleapis.com/mediapipe-assets/pose.jpg` 下载到 `artifacts/pose-fixture.jpg`，设置 `POSE_PERSON=1`；设置 `POSE_DURATION=300` 执行桌面五分钟采样。测试图不进入仓库或发布包。

第二阶段实际检查和待验收项目见 [第二阶段验证记录](docs/stage-02-verification.md)。模拟视频与桌面运行结果不代表已完成真机摄像头、指示灯、温升或移动浏览器内存验收。

## 第三阶段：机器人动作映射

打开 `/mapping.html`，默认使用模拟姿态，不申请相机权限。选择“只抬左臂”“只抬右臂”“双臂外展”或“双臂前伸”检查动作；也可选低置信度、缺失点、异常坐标与向上限位场景。

切换输入方式为“摄像头识别”，点击启动后使用本机视频推理驱动同页机器人。默认后摄；设备开放相应能力时可切换具体镜头和原生变焦。前摄只镜像预览，输入的解剖左右保持不变。无需 WebSocket，尚不支持一台手机发送动作到另一台电脑。

暂停跟随会冻结当前旋转，重置会恢复模型初始位置、四元数和缩放并暂停；点击继续跟随后重新驱动。摄像头停止、切源或后台切换时会清理采集；后台后跟随保持暂停，需要手动继续。观察面板显示实际骨骼、世界坐标置信度、方向、目标/实际四元数及跟踪/保持/回中状态。绿色箭头表示输入，灰色表示实际臂向。

当前内置模型绑定：11→13 对应 LeftUpperArm→LeftForearm，12→14 对应 RightUpperArm→RightForearm。前臂到手部的实际配置也已记录，默认禁用，本版只驱动上臂。世界坐标按 `(x,-y,-z)` 转入场景，父旋转参与求解，使用最小摆动、固定扭转约定、最大 160° 摆角和时间相关 SLERP；单侧无有效新观察超过 250ms 后平滑回中。不宣称恢复肩关节轴向扭转、精确关节角或完整人体动作。

当前没有交付用 `robot.glb`，内置程序化骨架验证不算实际 GLB 验收。外部 GLB 的动作映射须附带 `public/models/robot.mapping.json`，缺失或不匹配时显示警告并保留模型浏览，不猜测名称。格式为 `{ "version": 1, "bindings": [...] }`；每项包括 `side`（left/right）、`segment`（upperArm/forearm）、`enabled`、`bonePath`、`endPath`、实际 `expectedBoneName` / `expectedEndName`、弧度 `maxSwingRadians` 和单位四元数 `axisCorrection`（xyzw）。

`bonePath` / `endPath` 为从导入模型根节点逐层走过的 `children` 数组索引，不能从名字或临时 UUID 猜测；名称和父子关系也会核验。当前支持直接相连的肩肘链和正的均匀缩放变换；负缩放、非均匀缩放、剪切及不支持的链会被停用。上臂参考方向和初始旋转取自实际模型；配置中的前臂段目前不会启用，待增加肘关节专属求解后接入。

新增模块：`src/retarget/`（适配、配置、模拟、求解、调试）、`src/mapping/`（页面）、`src/mobile/capturePanel.ts`（与阶段二共享的采集面板）。

```powershell
npm run test:retarget
# 可选：沿用上文的官方人体测试图片，执行桌面真实模型驱动和 5 分钟采样
$env:POSE_PERSON = '1'
$env:MAPPING_DURATION = '300'
npm run test:retarget
```

新增自动化结果输出到 `artifacts/retarget-browser-results.json`，截图为 `mapping-desktop.png`、`mapping-mobile.png` 和 `mapping-camera.png`。桌面模拟相机和合成 GLB 夹具均不能替代实际手机和实际交付 GLB 验收。
