# Access Modes

This Agent Skill supports only two direct Responses-compatible paths.

## official

Use when the user has an official OpenAI API key or permission code.

Accepted inputs:

- `--permission-code` or `--api-key`
- `OPENAI_API_KEY`
- optional `--base-url` or `OPENAI_BASE_URL`, default `https://api.openai.com/v1`

PNG example:

```bash
node scripts/gpt_image_assets_cli.js generate \
  --mode official \
  --permission-code "$OPENAI_API_KEY" \
  --prompt "一张白底产品海报，主体是一台透明外壳复古收音机" \
  --output-format png \
  --output output/radio.png
```

PSD example, only if the selected endpoint currently supports PSD:

```bash
node scripts/gpt_image_assets_cli.js generate \
  --mode official \
  --permission-code "$OPENAI_API_KEY" \
  --prompt "电商产品主图，主体为透明外壳复古收音机，白底，高级商业摄影" \
  --output-format psd \
  --layered-psd \
  --layers "product,background,text,logo,shadow" \
  --output output/radio.psd
```

If official mode returns a format mismatch or rejects `psd`, do not keep retrying blindly. Tell the user the selected endpoint does not support PSD and switch to PNG or a PSD-capable proxy.

## proxy

Use when the user has a third-party Responses-compatible proxy, gateway, private provider, or aggregator.

Accepted inputs:

- `--base-url` or `GPT_IMAGE_BASE_URL`
- `--api-key` or `GPT_IMAGE_API_KEY`
- optional `--provider-name`

The script accepts a full `/responses` URL or a base URL such as `/v1`; it tries reasonable endpoint candidates.

PNG example:

```bash
node scripts/gpt_image_assets_cli.js generate \
  --mode proxy \
  --base-url "$GPT_IMAGE_BASE_URL" \
  --api-key "$GPT_IMAGE_API_KEY" \
  --provider-name "$GPT_IMAGE_PROVIDER" \
  --prompt "一套极简 App 图标，玻璃拟态，蓝绿配色" \
  --size 1024x1024 \
  --output-format png \
  --output output/app-icon.png
```

Layered PSD example:

```bash
node scripts/gpt_image_assets_cli.js generate \
  --mode proxy \
  --base-url "$GPT_IMAGE_BASE_URL" \
  --api-key "$GPT_IMAGE_API_KEY" \
  --provider-name "$GPT_IMAGE_PROVIDER" \
  --prompt "夏季女装电商主图，模特站在浅色棚拍背景前，左侧保留文案区" \
  --output-format psd \
  --layered-psd \
  --layer-preset ecommerce \
  --layers "model,background,headline,logo,decoration" \
  --output output/summer-fashion.psd
```

## Common Options

- `--prompt`: required for `generate`
- `--image`: optional image path or `data:image/...` URL for image-to-image
- `--output`: output file path; default is `generated-image.<output-format>`
- `--model`: text model, default `gpt-5.4`
- `--image-model`: image model, default `gpt-image-2`
- `--size`: default `1024x1536`
- `--quality`: default `high`
- `--output-format`: `png` or `psd`, default `png`
- `--format`: alias for `--output-format`
- `--layered-psd`: adds strict PSD layer instructions to the prompt
- `--layers`: comma-separated layer names
- `--layer-preset`: `ecommerce`, `product`, `poster`, `character`, or `generic`
- `--previous-failure`: describes the last failed PSD QC result for retry
- `--retries`: direct official/proxy retry count, default `3`

Never place real secrets in the skill files. Pass them through environment variables, local shell variables, or the runtime's secret manager.
