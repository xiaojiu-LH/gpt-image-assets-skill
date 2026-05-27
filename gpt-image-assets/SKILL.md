---
name: gpt-image-assets
description: "Generate PNG images or endpoint-supported layered PSD assets with GPT-Image-2 through official OpenAI or third-party Responses-compatible APIs. Use for text-to-image, image-to-image, ecommerce visuals, Photoshop-editable PSD materials, layer-split PSD workflows, output validation, and retrying failed PSD layer quality checks."
license: MIT
compatibility: "Agent Skills-compatible runtime with Node.js 18+ and outbound network access to OpenAI or a Responses-compatible proxy."
metadata:
  version: "0.3.0"
  runtime: "node >=18"
  outputs: "png, psd"
---

# gpt-image-assets

## Overview

Use this Agent Skill when the user wants GPT-Image-2 image generation, image-to-image editing, ecommerce visuals, PNG files, or Photoshop-editable layered PSD assets.

This skill is runtime-neutral. It follows the Agent Skills directory shape: this folder is the skill root, `SKILL.md` is the discoverable instruction file, scripts live under `scripts/`, and reference material lives under `references/`.

The skill intentionally keeps only two direct access paths:

1. `official`: official OpenAI API key / permission code.
2. `proxy`: third-party or private Responses-compatible endpoint.

Do not use creator reserved capacity, purchase keys, quota APIs, session APIs, or relay job polling. Those paths are intentionally removed so the skill can run consistently in any skills-compatible agent runtime.

The bundled CLI is [scripts/gpt_image_assets_cli.js](scripts/gpt_image_assets_cli.js). Run commands from the skill root:

```bash
node scripts/gpt_image_assets_cli.js generate ...
```

If a runtime exposes an absolute skill-root variable, resolve `scripts/gpt_image_assets_cli.js` relative to that root. Do not rely on a runtime-specific placeholder in the skill instructions.

## Output Choice

Default to PNG unless the user explicitly asks for PSD, layered PSD, Photoshop-editable file, 分层 PSD, 可编辑素材, or PS 逐层修改.

| User intent | Format | Extra action |
|---|---|---|
| Normal image generation | `png` | Generate directly |
| Image-to-image edit | `png` | Pass `--image` |
| Ecommerce material that must be edited in Photoshop | `psd` | Add `--layered-psd` and a layer contract |
| PSD requested but endpoint rejects PSD | `png` fallback only after telling the user PSD is unsupported by the selected endpoint |

PNG is the stable baseline. PSD requires the selected official or proxy endpoint to actually return PSD bytes. The CLI validates file signatures: PNG must start as PNG, PSD must start with `8BPS`.

## Access Choice

Use `official` when the user provides an official OpenAI key or says to use the official path:

```bash
node scripts/gpt_image_assets_cli.js generate \
  --mode official \
  --permission-code "$OPENAI_API_KEY" \
  --prompt "一张电影感的雨夜赛博城市街景" \
  --output-format png \
  --output output/cyber-rain.png
```

Use `proxy` when the user provides a third-party endpoint, `base_url`, aggregator, gateway, provider name, or private Responses-compatible service:

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

Do not echo API keys, permission codes, provider keys, or proxy tokens. Use environment variables, local shell variables, or the runtime's secret manager.

## Image-To-Image

When the user provides a reference image or asks to edit an existing image, pass an absolute path with `--image`.

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

## Layered PSD Workflow

Use this when the user wants Photoshop-editable ecommerce or marketing assets.

1. Decide the layer contract by use case.
2. Generate with `--output-format psd --layered-psd`.
3. Use `--layers` to lock required layer names.
4. If the result fails quality checks, retry with `--previous-failure`.

Example:

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

Retry after QC failure:

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

Read [references/layered-psd-workflow.md](references/layered-psd-workflow.md) before generating PSD assets or when the user asks for 电商 PSD, 图层分割, 分层出图, or PS 可编辑素材.

## Runtime Notes

The CLI sends a Responses API request using:

- text model: default `gpt-5.4`, configurable with `--model` or `GPT_IMAGE_TEXT_MODEL`
- image tool model: default `gpt-image-2`, configurable with `--image-model` or `GPT_IMAGE_MODEL`
- output format: `png` or `psd`
- size: default `1024x1536`
- quality: default `high`

For direct official/proxy requests, it parses SSE or JSON Responses output, extracts `image_generation_call.result`, decodes base64, validates the binary signature, and writes the result to disk.

Read [references/access-modes.md](references/access-modes.md) when choosing official vs proxy. Read [references/runtime.md](references/runtime.md) when debugging endpoints, SSE parsing, output format mismatches, or Agent Skills packaging.

## Output Rules

Always return:

- absolute output path
- access mode
- endpoint host/path or provider name when available
- requested format and detected format
- byte size
- response ID when available
- revised prompt when available

Keep credentials redacted.

## Safety And Reliability

- Never print secrets.
- Do not store keys in skill files.
- Do not claim PSD success unless the written file validates as PSD.
- If official mode rejects `psd`, explain that this endpoint does not support PSD and offer proxy mode or PNG fallback.
- If the user needs exact product dimensions, logos, or text layout, recommend post-editing in PSD/Photoshop and treat generation as editable material, not final truth.
