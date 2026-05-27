---
name: image-layer-psd
description: "将 GPT Image / image-2 的生图结果或原图拆成可编辑 Photoshop PSD 素材。适用于产品图定层、image-2 多轮拆层、主体/背景/文字/logo 分离、透明 PNG 图层生成、本地多图层 PSD 组装、PSD 质检，以及带失败原因重试坏层。"
license: MIT
compatibility: "Agent Skills-compatible runtime with Node.js 18+ and outbound network access to OpenAI or a Responses-compatible proxy."
metadata:
  version: "0.1.0"
  runtime: "node >=18"
  outputs: "png layers, psd, qc json"
---

# image-layer-psd

## 用途

当用户想把一张生成图或一张原图变成 Photoshop 可逐层编辑的素材时，使用这个 skill。典型目标层包括：主体、背景、文字、logo、装饰、阴影、反光，以及其他明确命名的生产图层。

这个 skill 不宣称 OpenAI 官方图像接口可以原生返回 PSD。官方图像接口输出的是 PNG/JPEG/WebP 等图片格式。这里的工作流是：多次调用 GPT Image / image-2 生成独立 PNG 图层，再在本地把这些 PNG 组装成真正的多图层 PSD。

内置 CLI 是 [scripts/image_layer_psd_cli.js](scripts/image_layer_psd_cli.js)。从 skill 根目录运行：

```bash
node scripts/image_layer_psd_cli.js run ...
```

## A-E 工作流

1. **[A] 定层规范**  
   生成前先确定 preset 或显式图层列表，不要生成后再临时改名。用途不清楚时读取 [references/layer-contracts.md](references/layer-contracts.md)。

2. **[B] 套固定提示词模板**  
   把用户需求转成每个图层的提示词：透明底主体、完整背景、独立文字、独立 logo、可选装饰/阴影层。修改提示词前读取 [references/prompt-templates.md](references/prompt-templates.md)。

3. **[C] 用 image-2 多轮生成 PNG 图层**  
   如果用户只给需求，先生成 `base.png`。如果用户给了原图，就把原图作为基准图。随后为每个图层生成一张 PNG。不要要求 image-2 直接返回 PSD。

4. **[D] 本地组装 PSD 并质检**  
   将 PNG 图层在本地组装成 PSD，然后检查 PSD 签名、图层数量、图层名称、图像尺寸、alpha 通道、主体透明度、背景空洞等。

5. **[E] 带失败原因重试**  
   质检失败时，能只重试坏层就只重试坏层，并通过 `--previous-failure` 带上失败原因。若背景补全或主体粘背景影响多层，则重跑整套拆层。

## CLI 快速开始

从文字需求完整生成：

```bash
node scripts/image_layer_psd_cli.js run \
  --mode official \
  --permission-code "$OPENAI_API_KEY" \
  --prompt "电商床品主图，真实摄影质感，模特躺在床上，暖色自然光" \
  --preset ecommerce \
  --out-dir output/bedding-layers \
  --output output/bedding.psd
```

从已有原图完整生成：

```bash
node scripts/image_layer_psd_cli.js run \
  --mode official \
  --permission-code "$OPENAI_API_KEY" \
  --image /absolute/path/source.png \
  --prompt "保留产品识别度，拆成可编辑生产图层" \
  --preset product \
  --out-dir output/product-layers \
  --output output/product.psd
```

从已有 PNG 图层组装 PSD：

```bash
node scripts/image_layer_psd_cli.js build-psd \
  --layers-json output/product-layers/layers.json \
  --output output/product.psd
```

运行质检：

```bash
node scripts/image_layer_psd_cli.js qc \
  --layers-json output/product-layers/layers.json \
  --psd output/product.psd
```

## 命令

- `generate-base`：从文字需求或参考图生成 `base.png`。
- `split-layers`：按图层规范生成每个图层 PNG，并写入 `layers.json`。
- `build-psd`：把 PNG 图层组装成真正的多图层 PSD。
- `qc`：输出 JSON 质检报告和重试原因。
- `run`：串联基准图生成、拆层、PSD 组装、质检和有限重试。

## 输出规则

始终报告：

- PSD 路径
- 图层目录
- 图层名称
- QC 结果
- QC 失败时的 retry reason
- PSD 是否由本地组装

不要打印 API key、permission code、provider key 或 proxy token。

## 质量边界

- 只有当每个图层 PNG 都是独立文件并且有独立名称时，本地组装的 PSD 才能称为真正多图层 PSD。
- image-2 生成的文字/logo 层通常是栅格图层，不是 Photoshop 原生可编辑文字层或矢量层。
- 如果用户要求精确字体、品牌标志或产品标签，交付时提醒用户进 Photoshop 检查并微调。
- 如果官方生成无法准确保留原 logo 或文字，建议用户提供原图，并只重试受影响图层。
