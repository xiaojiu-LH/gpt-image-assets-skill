# gpt-image-assets

中文 | [English](README.md)

> 把 GPT-Image-2 生图能力沉淀成一个可复用的 Agent Skill：生成 PNG/JPEG/WebP 图片。

`gpt-image-assets` 是一个基于 [Agent Skills](https://agentskills.io/) 协议的通用生图 skill。它可以在任何 skills-compatible 的 AI agent runtime 中运行，只要该 runtime 能读取 `SKILL.md`，并允许执行本 skill 内的 Node 脚本。

如需将生成的图片转化为分层 PSD，请使用配套 skill [`image-layer-psd`](https://github.com/xiaojiu-LH/image-layer-psd-skill)。

它只保留两种清晰的调用入口：

- `official`：OpenAI 官方 API key / permission code。
- `proxy`：第三方或私有的 Responses-compatible 接口。

它可以生成：

- PNG/JPEG/WebP 图片

导航：效果示例 · 安装及使用方式 · 工作原理 · 仓库结构 · 安全说明

---

## 效果示例

这部分后续可以补充真实截图、生成前后的对比图，或者 agent 的完整调用记录。当前先保留文字版示例，方便你后面替换成视觉案例。

### 示例一：普通 PNG 生图

用户：

```text
帮我生成一张电商主图，主体是一台透明外壳复古收音机，白底，干净高级。
```

Agent 会选择 `png` 输出，调用官方接口或第三方代理：

```bash
node scripts/gpt_image_assets_cli.js generate \
  --mode proxy \
  --base-url "$GPT_IMAGE_BASE_URL" \
  --api-key "$GPT_IMAGE_API_KEY" \
  --prompt "一张白底产品海报，主体是一台透明外壳复古收音机" \
  --output-format png \
  --output output/radio.png
```

返回内容应包含输出路径、调用模式、endpoint 或 provider、文件大小、模型返回的 revised prompt 等关键元数据。

### 示例二：图生图

用户：

```text
参考这张人物图，保持姿势，把整体风格改成高端杂志封面摄影。
```

Agent 会把参考图作为 `--image` 传入：

```bash
node scripts/gpt_image_assets_cli.js generate \
  --mode proxy \
  --base-url "$GPT_IMAGE_BASE_URL" \
  --api-key "$GPT_IMAGE_API_KEY" \
  --prompt "保持人物姿势，改成高端杂志封面摄影" \
  --image /absolute/path/reference.png \
  --output-format png \
  --output output/cover.png
```

---

## 安装及使用方式

### 方式一：让兼容 runtime 安装

打开你正在使用的 agent runtime，告诉它：

```text
帮我安装这个 skill：https://github.com/xiaojiu-LH/gpt-image-assets-skill
```

如果使用支持 Agent Skills 的通用安装器，也可以把本仓库作为 skill 源安装。安装后，runtime 应能发现 `gpt-image-assets/SKILL.md`；仓库里的实际 skill 目录是 `gpt-image-assets/`。

### 方式二：手动安装

先克隆仓库，然后把 `gpt-image-assets/` 整个目录复制到你的 runtime 的 skills 目录中：

```bash
git clone https://github.com/xiaojiu-LH/gpt-image-assets-skill.git
cd gpt-image-assets-skill
```

常见结构类似：

```text
skills/
└── gpt-image-assets/
    ├── SKILL.md
    ├── scripts/
    ├── references/
    └── agents/
```

注意：目录名必须是 `gpt-image-assets`，并且 `SKILL.md` frontmatter 里的 `name` 也必须是 `gpt-image-assets`。

### 直接运行 CLI

从 skill 根目录运行：

```bash
cd gpt-image-assets
node scripts/gpt_image_assets_cli.js generate
```

官方接口：

```bash
node scripts/gpt_image_assets_cli.js generate \
  --mode official \
  --permission-code "$OPENAI_API_KEY" \
  --prompt "一张电影感的雨夜赛博城市街景" \
  --output-format png \
  --output output/cyber-rain.png
```

第三方代理：

```bash
node scripts/gpt_image_assets_cli.js generate \
  --mode proxy \
  --base-url "$GPT_IMAGE_BASE_URL" \
  --api-key "$GPT_IMAGE_API_KEY" \
  --provider-name "$GPT_IMAGE_PROVIDER" \
  --prompt "透明背景的可爱机器人贴纸" \
  --size 1024x1024 \
  --output-format png \
  --output output/robot-sticker.png
```

---

## 工作原理

`gpt-image-assets` 做三件事：

1. **选择调用入口**  
   根据用户提供的信息，在 `official` 和 `proxy` 之间选择。没有保留购买码、额度、session 或 relay job 逻辑，减少绑定和不透明状态。

2. **构造 Responses 请求**  
   CLI 生成带 `image_generation` tool 的 Responses payload。默认文本模型为 `gpt-5.4`，图像模型为 `gpt-image-2`，可通过参数或环境变量覆盖。

3. **解析与写入文件**  
   CLI 支持 SSE 和 JSON 两种返回形式，提取 `image_generation_call.result`，解码 base64，写入本地输出路径，并校验文件格式签名。

---

## 仓库结构

```text
gpt-image-assets/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── references/
│   ├── access-modes.md
│   └── runtime.md
└── scripts/
    └── gpt_image_assets_cli.js
```

根目录还包含：

```text
README.md
README.zh.md
scripts/validate_skill.sh
```

`SKILL.md` 是 Agent Skills 协议的入口文件。`references/` 存放按需读取的说明，`scripts/` 存放可执行 CLI。

---

## 安全说明

- 不要提交 API key、provider key 或 proxy token。
- 通过环境变量、本地 shell 变量或 runtime 的 secret manager 传入凭据。
- 不要在日志或最终回答中打印凭据。
- 不要把作者预留额度、购买码、session、quota 或 relay job 逻辑重新加回 skill。

---

## 验证

```bash
bash scripts/validate_skill.sh
```

如果是在没有 GNU bash / WSL 的 Windows 环境中，至少运行：

```powershell
node --check gpt-image-assets\scripts\gpt_image_assets_cli.js
node gpt-image-assets\scripts\gpt_image_assets_cli.js --help
```
