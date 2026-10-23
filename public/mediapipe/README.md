# MediaPipe 本地资源

实际使用 `@mediapipe/tasks-vision` **1.1.1**，由 package-lock.json 锁定。
初始化、VIDEO 模式、`detectForVideo(video, timestamp)`、结果坐标与 `close()` 接口，已对照该包的官方 README 和 vision.d.ts 核对。在线指南本次未能成功读取。

运行 `npm run prepare:pose` 准备资源；`npm run build` 自动执行此步骤。
生成资源不进入 Git，由锁定包及模型校验值重建，随 dist 上传至本站。

- WASM 与 JS loader：从 `node_modules/@mediapipe/tasks-vision/wasm/` 原样复制到 `public/mediapipe/wasm/`，包含 SIMD、非 SIMD 和 module 版本，绝不混用其他版本。各文件 SHA-256 写入生成的 `wasm/manifest.json`。
- 模型：Google 官方 Pose Landmarker Lite，float16，版本 1。
- 下载地址：`https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
- 本地路径：`public/mediapipe/models/pose_landmarker_lite.task`
- 已实际下载大小：5,777,746 字节。
- SHA-256：`59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`
- npm 包许可证：Apache-2.0；MediaPipe 模型说明入口：`https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker`，模型使用须遵循其模型卡及授权说明。

运行时只读取同源模型与 WASM，不从 CDN 拉取脚本。图像在浏览器中推理，不上传或录制。
该版本包的隐私说明提到 Google 使用指标；手机页通过 CSP `connect-src 'self'` 及其他资源指令阻止向外部地址发送请求，项目没有添加遥测。浏览器验证记录所有请求并检查没有外部目标。
