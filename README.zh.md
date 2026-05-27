# gpt-image-assets

中文 | [English](README.md)

> 把 GPT-Image-2 生图能力沉淀成一个可复用的 Agent Skill：普通出 PNG/JPEG/WebP，官方路径可本地转扁平 PSD，代理路径可请求分层 PSD。

`gpt-image-assets` 是一个基于 [Agent Skills](https://agentskills.io/) 协议的通用生图 skill。它可以在任何 skills-compatible 的 AI agent runtime 中运行，只要该 runtime 能读取 `SKILL.md`，并允许执行本 skill 内的 Node 脚本。

本仓库也包含配套 skill：`image-layer-psd`。它用于把产品图需求或原图拆成独立 PNG 图层，本地组装成多图层 PSD，并执行图层质检与失败重试。

它只保留两种清晰的调用入口：

- `official`：OpenAI 官方 API key / permission code。
- `proxy`：第三方或私有的 Responses-compatible 接口。

它可以生成：

- PNG/JPEG/WebP 图片
- 由官方 PNG 输出本地转换得到的扁平 PSD 文件
- 所选 proxy endpoint 支持的分层 PSD 素材

导航：效果示例 · 安装及使用方式 · 工作原理 · 仓库结构 · 安全说明

---

## 效果示例

这部分后续可以补充真实截图、生成前后的对比图、Photoshop 图层面板截图，或者 agent 的完整调用记录。当前先保留文字版示例，方便你后面替换成视觉案例。

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

### 示例三：分层 PSD 素材

用户：

```text
帮我做一张床品电商主图，要能进 PS 里逐层修改。人物、背景、文字、logo 分开。
```

Agent 会选择 `psd` 输出，并加入分层约束：

```bash
node scripts/gpt_image_assets_cli.js generate \
  --mode proxy \
  --base-url "$GPT_IMAGE_BASE_URL" \
  --api-key "$GPT_IMAGE_API_KEY" \
  --prompt "电商床品主图，真实摄影质感，模特躺在床上，暖色自然光" \
  --output-format psd \
  --layered-psd \
  --layer-preset ecommerce \
  --layers "subject,background,text,logo,decoration" \
  --output output/bedding-main.psd
```

如果 PSD 打开后发现主体边缘粘背景、背景有空洞、文字没有独立图层，Agent 会带着失败原因重试：

```bash
node scripts/gpt_image_assets_cli.js generate \
  --mode proxy \
  --base-url "$GPT_IMAGE_BASE_URL" \
  --api-key "$GPT_IMAGE_API_KEY" \
  --prompt "电商床品主图，真实摄影质感，模特躺在床上，暖色自然光" \
  --output-format psd \
  --layered-psd \
  --layers "subject,background,text,logo,decoration" \
  --previous-failure "subject layer edge contains background pixels; background has an empty silhouette under the pillow" \
  --output output/bedding-main-retry.psd
```

### 示例四：官方接口生成扁平 PSD

用户：

```text
用 OpenAI 官方接口生成图片，但最后给我 PSD 文件。
```

Agent 会先向官方接口请求 PNG，再用本地工具链转换成可由 Photoshop 打开的扁平 PSD：

```bash
node scripts/gpt_image_assets_cli.js generate \
  --mode official \
  --permission-code "$OPENAI_API_KEY" \
  --prompt "一张白底高级电商主图，主体是一台透明外壳复古收音机" \
  --output-format psd \
  --psd-toolchain local \
  --output output/radio.psd
```

注意：这种 PSD 是有效的 Photoshop 文件，但不是语义分层 PSD。需要主体、背景、文字、logo 独立图层时，应使用支持 PSD 的第三方代理。

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

官方接口转本地扁平 PSD：

```bash
node scripts/gpt_image_assets_cli.js generate \
  --mode official \
  --permission-code "$OPENAI_API_KEY" \
  --prompt "一张白底高级电商主图，主体是一台透明外壳复古收音机" \
  --output-format psd \
  --psd-toolchain local \
  --output output/radio.psd
```

---

## 工作原理

`gpt-image-assets` 做四件事：

1. **选择调用入口**  
   根据用户提供的信息，在 `official` 和 `proxy` 之间选择。没有保留购买码、额度、session 或 relay job 逻辑，减少绑定和不透明状态。

2. **构造 Responses 请求**  
   CLI 生成带 `image_generation` tool 的 Responses payload。默认文本模型为 `gpt-5.4`，图像模型为 `gpt-image-2`，可通过参数或环境变量覆盖。

3. **解析与写入文件**  
   CLI 支持 SSE 和 JSON 两种返回形式，提取 `image_generation_call.result`，解码 base64，并写入本地输出路径。

4. **校验或转换输出格式**  
   PNG/JPEG/WebP 必须通过文件签名校验；PSD 必须以 `8BPS` 开头。使用本地 PSD 工具链时，CLI 会先校验源 PNG，再转换成扁平 PSD，并校验最终 PSD。

分层 PSD 的核心流程是：

```text
需求 / 原图
→ 定层规范：subject / background / text / logo / decoration
→ 套分层提示词：透明主体、背景补全、图层命名
→ 请求 endpoint 输出 PSD
→ 校验文件签名
→ 人工或工具质检图层质量
→ 不合格则带 previous-failure 重试
```

本地 PSD 流程是：

```text
需求 / 原图
→ 官方 endpoint 返回 PNG
→ PNG 文件签名校验
→ 本地 PNG 解码 + PSD 写入
→ 生成扁平 PSD 文件
→ PSD 文件签名校验
```

---

## 仓库结构

```text
gpt-image-assets/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── references/
│   ├── access-modes.md
│   ├── layered-psd-workflow.md
│   └── runtime.md
└── scripts/
    └── gpt_image_assets_cli.js
```

```text
image-layer-psd/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── references/
│   ├── layer-contracts.md
│   ├── prompt-templates.md
│   └── qc-rubric.md
└── scripts/
    └── image_layer_psd_cli.js
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
- 除非输出文件通过 PSD 签名校验，否则不要宣称 PSD 生成成功。
- 区分本地扁平 PSD 和 endpoint 分层 PSD；本地 PNG-to-PSD 工具链不能宣称生成了独立图层。
- OpenAI 官方接口当前输出 PNG/JPEG/WebP；如果用户需要官方路径下的 PSD 容器，使用 `--psd-toolchain local`。

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
