# gpt-image-assets

[中文说明](README.zh.md) | English

> Turn GPT-Image-2 generation into a reusable Agent Skill: generate PNG/JPEG/WebP images via official OpenAI or third-party Responses-compatible APIs.

`gpt-image-assets` is an [Agent Skills](https://agentskills.io/)-compatible image generation skill. It can run in any skills-compatible AI agent runtime that can load `SKILL.md` and execute the bundled Node script.

For layered PSD conversion from generated images, use the companion skill [`image-layer-psd`](https://github.com/xiaojiu-LH/image-layer-psd-skill).

It keeps only two direct access paths:

- `official`: official OpenAI API key / permission code.
- `proxy`: third-party or private Responses-compatible endpoint.

It can request and validate:

- PNG/JPEG/WebP images

Navigation: Examples · Installation and Usage · How It Works · Repository Structure · Security

---

## Examples

This section can later be replaced or expanded with real screenshots, before/after comparisons, or full agent traces. The current examples are text-only drafts.

### Example 1: PNG Generation

User:

```text
Generate a clean premium ecommerce hero image for a transparent-shell retro radio on a white background.
```

The agent chooses PNG output and calls either official mode or proxy mode:

```bash
node scripts/gpt_image_assets_cli.js generate \
  --mode proxy \
  --base-url "$GPT_IMAGE_BASE_URL" \
  --api-key "$GPT_IMAGE_API_KEY" \
  --prompt "A clean white-background product poster featuring a transparent-shell retro radio" \
  --output-format png \
  --output output/radio.png
```

The final answer should include the output path, access mode, endpoint or provider, byte size, and revised prompt when available.

### Example 2: Image-To-Image

User:

```text
Use this reference portrait, keep the pose, and turn it into a premium magazine cover photo.
```

The agent passes the reference image through `--image`:

```bash
node scripts/gpt_image_assets_cli.js generate \
  --mode proxy \
  --base-url "$GPT_IMAGE_BASE_URL" \
  --api-key "$GPT_IMAGE_API_KEY" \
  --prompt "Keep the subject pose and transform the image into a premium magazine cover photo" \
  --image /absolute/path/reference.png \
  --output-format png \
  --output output/cover.png
```

---

## Installation And Usage

### Option 1: Ask A Compatible Runtime To Install It

In your skills-compatible agent runtime, ask:

```text
Install this skill: https://github.com/xiaojiu-LH/gpt-image-assets-skill
```

If you use a generic Agent Skills installer, install this repository as a skill source. The runtime should discover `gpt-image-assets/SKILL.md`; the actual skill directory inside the repository is `gpt-image-assets/`.

### Option 2: Manual Installation

Clone the repository, then copy the whole `gpt-image-assets/` directory into your runtime's skills directory:

```bash
git clone https://github.com/xiaojiu-LH/gpt-image-assets-skill.git
cd gpt-image-assets-skill
```

```text
skills/
└── gpt-image-assets/
    ├── SKILL.md
    ├── scripts/
    ├── references/
    └── agents/
```

The directory name must be `gpt-image-assets`, and the `name` field in `SKILL.md` must also be `gpt-image-assets`.

### Direct CLI Usage

Run from the skill root:

```bash
cd gpt-image-assets
node scripts/gpt_image_assets_cli.js generate
```

Official API:

```bash
node scripts/gpt_image_assets_cli.js generate \
  --mode official \
  --permission-code "$OPENAI_API_KEY" \
  --prompt "A cinematic rainy cyberpunk street scene at night" \
  --output-format png \
  --output output/cyber-rain.png
```

Third-party proxy:

```bash
node scripts/gpt_image_assets_cli.js generate \
  --mode proxy \
  --base-url "$GPT_IMAGE_BASE_URL" \
  --api-key "$GPT_IMAGE_API_KEY" \
  --provider-name "$GPT_IMAGE_PROVIDER" \
  --prompt "A cute transparent-background robot sticker" \
  --size 1024x1024 \
  --output-format png \
  --output output/robot-sticker.png
```

---

## How It Works

`gpt-image-assets` does three things:

1. **Choose the access path**  
   Select `official` or `proxy` based on the user's available credentials and endpoint. Reserved capacity, purchase keys, quota APIs, sessions, and relay job polling are intentionally absent.

2. **Build the Responses request**  
   The CLI creates a Responses payload with an `image_generation` tool. The default text model is `gpt-5.4`; the default image model is `gpt-image-2`.

3. **Parse and write the output**  
   The CLI supports SSE and JSON Responses output, extracts `image_generation_call.result`, decodes base64, writes the local file, and validates the format signature.

---

## Repository Structure

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

The repository root also contains:

```text
README.md
README.zh.md
scripts/validate_skill.sh
```

`SKILL.md` is the Agent Skills entrypoint. `references/` contains on-demand documentation, and `scripts/` contains the executable CLI.

---

## Security

- Never commit API keys, provider keys, or proxy tokens.
- Pass credentials through environment variables, local shell variables, or the runtime's secret manager.
- Do not print credentials in logs or final answers.
- Do not add reserved capacity, purchase keys, sessions, quota APIs, or relay job polling back into the skill.

---

## Validation

```bash
bash scripts/validate_skill.sh
```

On Windows without GNU bash/WSL, at least run:

```powershell
node --check gpt-image-assets\scripts\gpt_image_assets_cli.js
node gpt-image-assets\scripts\gpt_image_assets_cli.js --help
```
