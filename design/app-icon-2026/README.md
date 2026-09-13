# Monight · 一页月光

为 Monight（墨页）设计的 macOS App 图标方案，2026-09-09。

现已在 Icon Composer 中导入、保存并重新打开验证原生工程 `Monight.icon`。使用第 27 代 Liquid Glass 预览，完成五个图层、三个材质组和六种系统外观的导出。

以「一页月光」表达 PDF 阅读与舒适夜读：前方的磨砂书页代表正在阅读的文档，后方蓝色书页表达阅读的延续，暖白月牙呼应 Monight 的名字与夜间视觉调节。两条简化阅读线保留文档识别，墨蓝底色延续产品的深色界面与蓝色强调色。

## 交付文件

- `Monight.icon/`：原生 Icon Composer 文档包，可直接用 Icon Composer 打开。内部 `icon.json` 保存材质与背景设置，`Assets/` 包含全部五个 SVG，无需引用外部文件。
- `monight-native-default-1024.png`：Icon Composer 实际渲染并导出的 1024px 默认外观。
- `Monight Exports/`：Icon Composer 导出的 Default、Dark、Clear Light、Clear Dark、Tinted Light、Tinted Dark 六种 1024px 外观预览。导出菜单的平台为共享的 iOS / macOS；文件名中的 `iOS` 由工具自动生成。

以下文件保留第一阶段的静态设计，便于与原生材质结果对照：

- `monight-icon.svg`：1024 × 1024 可编辑矢量源稿，包含命名图层与静态材质效果。
- `png/1024x1024.png`：高清主图，图标外缘为透明背景。
- `png/`：16、32、64、128、256、512、1024px PNG 导出。
- `monight.icns`：由项目已安装的 Tauri CLI 生成的 macOS 静态图标容器。
- `monight.iconset/`：标准命名的各尺寸 PNG，便于查看和后续封装。
- `icon-composer-layers/`：用于继续制作原生分层图标的五个 SVG 素材。
- `prompt.txt`：最初的 imagegen 视觉提示词，保留设计意图。

## 苹果设计依据

参考截至 2026-09-09 查阅的 [Apple App icons 指南](https://developer.apple.com/design/human-interface-guidelines/app-icons?changes=latest_maj_4_7&language=objc)（页面变更记录包含 2026-06-08 的 Liquid Glass 指南更新），使用简洁主体、居中构图和少量层次。按 [Icon Composer 当前介绍](https://developer.apple.com/icon-composer/) 的方向，将垂直入射光、明确的边缘高光和适度折射作为材质设计目标。

第一阶段的 `png/` 与 `monight.icns` 是手绘静态视觉设计，圆角与光影已绘制在素材中；它们不具备系统动态 Liquid Glass 效果。该阶段的外轮廓为手绘连续曲线近似。新的 `Monight.icon` 使用系统遮罩与原生 Liquid Glass 材质，`monight-native-default-1024.png` 和 `Monight Exports/` 是由该工程实际导出的静态预览。

按照 [Apple 的图层导出说明](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer?changes=l_2&language=objc)，用于原生工程的五个 SVG 使用相同的 1024 × 1024 画布，保留透明背景，不预制外框遮罩、渐变、阴影、透明材质或镜面高光。

### 已完成的原生材质

背景使用基色 `#0C182C` 的系统自动渐变。五层按从前到后的顺序组合为三个材质组：

| 材质组 | 图层 | 透光值 | 中性阴影不透明度 |
| --- | --- | --- | --- |
| Moonlight | 暖白月牙 | 0.08 | 0.25 |
| Reading Page | 阅读线、折角、前方书页 | 0.18 | 0.35 |
| Reading Session | 后方蓝色书页 | 0.40 | 0.22 |

阅读线关闭单独的 Glass Effects，以避免细线变成立体胶囊；书页和月牙保留原生边缘高光。深色与单色外观沿用系统生成策略，保持所有外观的主体形状与位置一致。Tinted 导出中的紫色是 Icon Composer 的示例着色，不是新的品牌色。

### Icon Composer 制作建议

1. 建立 1024 × 1024 的 iOS / iPadOS / macOS 图标，在工具中设置墨蓝背景，渐变可从 `#25415F` 到 `#0C182C`。
2. 按文件数字顺序导入 `icon-composer-layers/` 中的 SVG，保持画布对齐。素材已经从静态图标的内框坐标转换到完整画布坐标，无需再次放大。
3. 让后方书页带少量蓝色透光；前方书页保持较高不透明度，以保证小尺寸识别。
4. 对书页和月牙应用柔和深度、克制折射与清晰边缘高光。阅读线与前方书页保持接近的层深，避免产生悬浮按钮的效果。
5. 在 Default、Dark、Mono 模式下分别预览，保持书页与月牙的形状、位置一致，再导出原生 `.icon` 文件。

这些步骤可用于重建或继续调整工程。当前已经在 Icon Composer 中检查 Default、Dark、Mono，并查看六种外观的导出结果。

## 项目接入

项目现已使用本设计。`src-tauri/icons/` 中的 PNG、ICO、ICNS 及其他平台尺寸均从原生默认外观重新生成；`src-tauri/tauri.macos.conf.json` 在常规图标之外加入本目录的 `Monight.icon`，交由 Tauri 的 macOS 打包器处理。

运行 `npm run icons:generate` 可重新生成所有平台图标。脚本直接读取本目录的原生默认外观 PNG，并为传统 macOS ICNS 单独设置 1024px 画布上的 100px 透明留白；原生 `.icon` 本身保持未预制遮罩的独立图层。

已通过前端构建、Rust 编译和 macOS 调试 App 打包，并核对包内 `Contents/Resources/icon.icns` 与项目文件的 SHA-256 一致。此次本地环境只有 Command Line Tools，缺少 `actool`，Tauri 跳过 `Assets.car` 编译并成功使用新版静态图标。原生动态材质的打包验证仍需要提供 `actool` 的完整 Xcode 26+ 环境；Windows、Linux 与移动平台未在本机实际打包运行。

## 生成与验证

内置 imagegen 调用未返回图片，报错为当前 ChatGPT 账户不支持其请求的 `gpt-5.4-mini` 模型。最终文件采用手工 SVG 绘制，并通过项目现有 Tauri 2 CLI 渲染；未调用需要 `OPENAI_API_KEY` 的 API 生图备用流程。

第一阶段已查看 512px 和 32px PNG，核对书页与月牙的识别；高清 PNG 为 1024 × 1024 RGBA。原有设计稿 ICNS 经 Tauri CLI 成功生成。

第二阶段由 Icon Composer 建立并保存原生文档，随后精确调整文档中的渐变与材质组参数，再在 Icon Composer 中重新打开并保存，确认五层、三组、材质和背景被工具正常识别。默认、深色、单色界面预览正常，六种系统外观已成功导出，原生默认预览为 1024 × 1024、带 Alpha。后续项目接入与验证见上节。

以下命令仅重新渲染第一阶段的静态设计稿；更新 App 图标请使用上面的 `npm run icons:generate`。

第一阶段 PNG 重新导出：

```sh
./node_modules/.bin/tauri icon design/app-icon-2026/monight-icon.svg \
  -o design/app-icon-2026/png \
  -p 1024 -p 512 -p 256 -p 128 -p 64 -p 32 -p 16
```

完整平台导出可指定一个独立输出目录，随后从中选取 `icon.icns`：

```sh
./node_modules/.bin/tauri icon design/app-icon-2026/monight-icon.svg \
  -o /tmp/monight-icon-2026-platform-export
```

上述完整导出中的移动平台文件不属于本次交付的适配范围；它们还需按目标平台要求使用未遮罩底图重新制作。
