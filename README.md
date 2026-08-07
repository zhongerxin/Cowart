# Cowart

Cowart 是一个面向 Codex 的原生无限画布 widget 插件。它基于 tldraw 提供可视化画布，用于构思、标注、生成图片和根据标注图迭代图片。画布由 MCP widget 直接打开，数据默认保存到当前用户项目的 `canvas/` 目录，而不是保存到插件仓库里。

仓库同时遵循 [Agent Plugins v1.0.0](https://agent-plugins.org/specification)：根目录的 `plugin.json`、`skills/` 和 `mcp.json` 提供可移植插件入口；`.codex-plugin/plugin.json`、`.mcp.json` 和 `.agents/plugins/marketplace.json` 保留 Codex 专用的界面与安装元数据。

English README: [README.en.md](README.en.md)

## 功能

- 在 Codex 中打开一个原生 tldraw 无限画布 widget；正常使用不再通过网页浏览器或 in-app browser 打开本地页面。
- 在当前项目目录中持久化画布页面和图片资源。
- 在画布中创建 AI 图片框，直接输入 prompt、选择参考图，并让 Codex 按选中框的位置和比例生成图片后替换它。
- 创建 16:9 的 `AI HTML` 框，通过 prompt 和参考图生成可运行的单文件 HTML，并直接嵌入画布继续编辑或迭代。
- 创建 `AI Slides`，将图片和 HTML 组织成演示文稿，或让 Codex 按指定页数生成一组 16:9 HTML 页面；支持缩略图预览和全屏播放。
- 标注好图片后，可从画布里直接提交标注截图，让 Codex 根据标注生成干净的新图并放到原图旁边。
- 通过 Cowart MCP 工具读取选择状态、保存画布、插入图片或 HTML，并保存到页面本地资源目录。

## 安装

### 让 Codex 自动安装

把下面这段发给 Codex：

```text
请通过 Cowart 仓库自带的 Git marketplace 安装 Cowart Codex 插件。
先运行 codex plugin marketplace add zhongerxin/Cowart --ref main，
再运行 codex plugin add cowart@cowart-github，并用 codex plugin list 确认插件已启用。
不要把仓库 clone 到 personal marketplace。安装完成后请告诉我开启一个新任务，
以便加载 Cowart 的新技能和 MCP 工具。
```

### 手动安装

先把 Cowart 的 Git 仓库注册为 Codex marketplace：

```bash
codex plugin marketplace add zhongerxin/Cowart --ref main
```

再从这个 marketplace 安装并检查 Cowart：

```bash
codex plugin add cowart@cowart-github
codex plugin list
```

如果 `cowart-github` 已经注册，可以跳过第一条 `marketplace add` 命令。安装后请开启一个新的 Codex 任务，让新的 skill 和 MCP 工具完整加载。

Codex 会在启动插件系统时自动检查这个 Git marketplace，并在远程 `main` 分支发生变化后刷新已安装的 Cowart。需要立即检查更新时，可以手动运行：

```bash
codex plugin marketplace upgrade cowart-github
```

更新完成后同样建议开启一个新任务。

## 使用

### 打开画布

在 Codex 中说：

```text
Open the Cowart canvas for this project.
```

Cowart 会通过 `render_cowart_canvas_widget` 打开 Codex 原生 widget，不需要再启动本地网页服务或手动打开 in-app browser。`scripts/start-canvas.sh` 只保留为本地开发 fallback。

画布数据会保存在当前项目目录下：

```text
canvas/pages/<page-id>/cowart-canvas.json
canvas/pages/<page-id>/assets/
```

![在 Codex 中打开 Cowart 画布](assets/open-canvas.png)

### 生成新图

1. 打开 Cowart 画布。
2. 在画布里创建并选中一个 `AI 图片` 框。
3. 在弹出的生成面板里输入 prompt，也可以选择一张或多张参考图，然后点击发送。

Cowart 会把 prompt、参考图和选中 `AI 图片` 框的尺寸信息发送给 Codex。Codex 会按这个框的位置和比例生成图片，然后把 `AI 图片` 框替换成普通图片形状。

![使用 Cowart 生成并插入新图](assets/generate-image.png)

### 根据标注图生成新图

1. 在 Cowart 画布中对图片做标注。
2. 选中被标注的图片，点击 `按标注修改`。
3. Cowart 会导出包含原图、箭头和标注文字的截图，并通过 widget bridge 发送给 Codex。

Codex 会读取截图里的标注和箭头，生成去掉标注痕迹的新图，并把结果放在原图旁边。原图和标注不会被删除或移动。你也可以手动把 Cowart 标注截图发给 Codex，走同样的修订流程。

![根据 Cowart 标注截图生成修订图](assets/annotation-edit.png)

### 生成 AI HTML

1. 在工具栏中创建并选中一个 `AI HTML` 框；新建框默认是 `1024 × 576`（16:9）。
2. 在框下方的生成面板中输入 prompt，也可以选择或粘贴一张或多张参考图。
3. 点击发送后，Codex 会生成完整可运行的单文件 HTML，并把它嵌入选中的 `AI HTML` 框。

生成后的 HTML 会作为画布中的嵌入页面保存在当前 page 的 `assets/` 目录。选中它后可以下载渲染图、直接编辑文本，也可以结合画布标注继续修改 HTML，或根据 HTML 和标注生成图片。

![编辑 Cowart AI HTML](assets/edit-html.png)

### 创建和演示 AI Slides

1. 在工具栏中创建一个 `AI Slides`。默认外框是 `1048 × 600`，对应一页 `1024 × 576`（16:9）内容和四周各 `12px` 的留白。
2. 可以把画布中的图片或 HTML 拖入 Slides，也可以复制图片后选中 Slides，再粘贴进去；内容会自动按顺序横向排列。
3. 空 Slides 被选中时会显示生成面板。输入整套演示的描述、按需添加参考图，并选择 3、5、10 页或自定义页数；默认是 5 页。
4. 发送后，Codex 会生成指定数量、视觉与叙事连贯的独立 16:9 HTML 页面，并依次加入当前 Slides。Slides 已有内容时不再显示生成面板。
5. 选中 Slides 后点击 `演示 Slides`，可以通过左侧缩略图预览和切换页面，也可以进入全屏播放。全屏时支持方向键、空格键和点击静态画面翻页；HTML 自身的按钮、链接和表单交互会保留，播放控制栏固定在顶部。

![演示和切换 Cowart AI Slides](assets/view-slides.png)

## 技能

- `cowart:cowart-open-canvas`：打开 Cowart 原生画布 widget。
- `cowart:cowart-image-gen`：接收画布内 prompt 和参考图，用生成图片替换选中的 `AI 图片` 框；没有选中框时也可以把生成图插入当前页面。
- `cowart:cowart-image-edit`：根据画布提交或用户提供的 Cowart 标注截图生成修订图。

## 本地开发

```bash
npm install
npm run dev
npm run build
```

本地开发时仍可以直接启动 Vite 画布服务，并指定用户项目目录：

```bash
./scripts/start-canvas.sh /path/to/user/project
```

常用环境变量：

- `COWART_PORT`：本地服务端口，默认 `43217`。
- `COWART_PROJECT_DIR`：画布数据所属的用户项目目录。
- `COWART_CANVAS_DIR`：画布数据目录，默认是 `$COWART_PROJECT_DIR/canvas`。

## 开发者

ZHONG XIN  
zhongxin123456@gmail.com  
https://www.jiqiren.ai

## 致谢

Cowart 的画布能力基于 [tldraw/tldraw](https://github.com/tldraw/tldraw) 实现。
