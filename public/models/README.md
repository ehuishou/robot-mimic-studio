# 机器人模型

项目当前附带可直接加载的 `robot.glb`。这是 Robot Mimic Studio 自有的程序化机器人资产，不依赖第三方模型；使用 Three.js `GLTFExporter` 生成，包含 17 根骨骼、蒙皮网格、顶点关节索引与权重，以及内嵌材质。

重新生成模型与对应的实际骨骼路径映射：

```bash
npm run generate:model
```

输出文件：

- `robot.glb`：可由项目 `GLTFLoader` 直接加载的 GLB 2.0 模型。
- `robot.mapping.json`：从导出后的节点层级推导的映射路径。当前仅启用双臂上臂映射；前臂、手、躯干和腿部骨骼已包含在资产中，但还未接入实时全身动作求解。

如果替换为其他有使用授权的 GLB 模型，请同步更新 `robot.mapping.json`，并使用实际导入后的骨骼层级重新验证路径。当前未配置 Draco、Meshopt 或 KTX2 解码器；压缩模型需先转换，或添加相应解码器。
