# 第一阶段验收记录 · 2026-10-23

## 交付位置

- 展示地址：http://121.199.30.133/
- GitHub 私有仓库：https://github.com/ehuishou/robot-mimic-studio
- 主分支：main
- 初始功能提交：2d025e0631effba8c8c91e0099110d1af74a494c
- 服务器发布目录：/opt/robot-studio/releases/20261023-155623
- 当前软链接：/opt/robot-studio/current
- systemd 服务：robot-studio，端口 80，已启用开机启动。

## 实际执行结果

| 检查 | 结果 |
| --- | --- |
| `npm run dev -- --port 5173` | Vite 正常启动，页面可访问 |
| `npm run typecheck` | 通过（也由 build 执行） |
| `npm run build` | 通过；Three.js 包存在大于 500 kB 的构建体积提示 |
| `npm test` | 4 项通过：关节带动子节点、初始姿势四元数、重复/未命名骨骼、共享资源释放 |
| 本地 `npm run test:browser` | 使用本机 Edge 无头浏览器，通过全部场景 |
| 公网 `TEST_URL=http://121.199.30.133 npm run test:browser` | 使用本机 Edge 无头浏览器，通过全部场景 |
| 公网首页 | HTTP 200，`text/html; charset=utf-8` |
| 服务器本机首页 | HTTP 200 |
| 服务器缺失模型地址 | HTTP 404，符合备用模型触发条件 |
| 服务状态 | active / running，检查时自动重启次数为 0 |
| GitHub Actions 首次运行 | success，https://github.com/ehuishou/robot-mimic-studio/actions/runs/39920943059 |

浏览器验证的实际覆盖：

1. 缺失 GLB 自动显示带 17 个真实骨骼的备用机器人。
2. 选择关节、旋转滑块、重置姿势、搜索骨骼均正常。
3. 调整关节后画布截图像素变化；子骨骼实际世界位置变化另由单元测试确认。
4. 网格、骨架、自动旋转、预设视角和重置视角均可操作。
5. 1440px 桌面与 390px 手机尺寸截图已生成，390px 无横向溢出。
6. GLTFLoader 可读取合成测试 GLB 的实际蒙皮骨骼名称。
7. 无骨骼 GLB 正常显示并禁用关节调试。
8. 损坏/错误格式 GLB 降级为备用机器人。
9. WebGL 上下文丢失显示恢复提示。
10. 未发现意外的控制台错误和未捕获异常；缺失模型的预期单次 404 除外。

浏览器截图和 JSON 报告在本机 `artifacts/`，不纳入 Git。
GitHub Actions 另外在 Linux Chromium 上执行生产构建的同一套浏览器验证并保存工件。
本机 Chromium 下载缓慢，实际本地与公网检查使用已安装 Edge；未将下载成功视为验证前提。

## 限制与后续

- 当前未提供真实第三方 GLB；线上展示的是内置几何体机器人。
- 有骨骼和无骨骼 GLB 的自动检查使用合成夹具，不代表特定商用模型已验收。
- 未进行手机实机测试或长时间内存压力测试。
- 未实现 MediaPipe、动作映射、WebSocket 或跨设备端到端性能测量。
- 手机摄像头阶段需要 HTTPS、MediaPipe 模型与 WASM 资源，以及独立识别页面。
- 动作映射阶段需要目标 GLB 的授权、真实骨骼映射、初始姿势和坐标约定。

首次 SSH 部署遇到 Windows 转义问题，已改为上传 LF 编码的独立 Linux 脚本，重试部署成功。
部署脚本保留旧版本，并通过服务器本机 HTTP 健康检查确认启动结果。
