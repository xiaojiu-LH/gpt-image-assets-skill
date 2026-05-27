# Runtime Notes

## Scope

This Agent Skills version keeps only direct official/proxy Responses-compatible generation. It does not include reserved capacity, purchase keys, user sessions, quota APIs, or relay job polling.

## Direct Generation Contract

The CLI builds a Responses payload:

```json
{
  "model": "gpt-5.4",
  "input": "prompt or multimodal user content",
  "tools": [
    {
      "type": "image_generation",
      "model": "gpt-image-2",
      "size": "1024x1536",
      "quality": "high",
      "output_format": "png"
    }
  ],
  "tool_choice": { "type": "image_generation" },
  "stream": true
}
```

When `--output-format psd` is passed, the request format depends on `--psd-toolchain`:

- `endpoint`: send `output_format: "psd"` to the selected endpoint.
- `local`: send `output_format: "png"`, then convert the returned PNG into a flattened PSD locally.
- `auto`: use local PNG-to-PSD for `official`, and endpoint PSD for `proxy`.

Direct `official` and `proxy` modes:

1. Build the Responses payload.
2. If `--image` is present, convert the local image into a data URL and send a multimodal user message.
3. Post to `/responses` using the selected endpoint.
4. Parse either SSE or JSON.
5. Extract `image_generation_call.result`.
6. Decode base64 to bytes.
7. Validate file signature:
   - PNG: standard PNG signature.
   - JPEG: SOI signature.
   - WebP: RIFF/WEBP signature.
   - PSD: `8BPS`.
8. If local PSD toolchain is active, convert validated PNG bytes into a flattened RGB+alpha PSD and validate `8BPS`.
9. Write to the requested output path.

## Output Format Behavior

PNG is the default and safest output. JPEG and WebP are supported for endpoints that support those official output formats.

PSD has two modes:

- Endpoint PSD: the CLI requests PSD from a proxy or compatible endpoint, adds layer instructions when requested, and verifies the returned bytes.
- Local flattened PSD: the CLI requests PNG, decodes it locally, and writes a valid flattened PSD container. This is useful with official OpenAI access, but it is not a true layered PSD.

If endpoint PSD fails:

- If the endpoint rejects `output_format: psd`, switch endpoint or fallback to PNG.
- If the endpoint returns PNG while PSD was requested, the CLI fails with a format mismatch.
- If Photoshop opens the PSD but layer quality is poor, retry with `--previous-failure`.

If local PSD is used:

- Do not claim independent layers.
- Tell the user the file is a Photoshop-compatible flattened PSD.
- Use a PSD-capable proxy when subject/background/text/logo must be independently editable.

## Agent Skills Packaging

This folder is the skill root. A skills-compatible runtime should load `SKILL.md` and resolve paths relative to this directory.

Run the CLI from the skill root:

```bash
node scripts/gpt_image_assets_cli.js generate ...
```

The skill root contains:

- `SKILL.md`
- `agents/openai.yaml`
- `scripts/gpt_image_assets_cli.js`
- `references/access-modes.md`
- `references/layered-psd-workflow.md`
- `references/runtime.md`

## Security And Logging

- Do not print API keys, permission codes, or provider tokens.
- Do not commit `.env` files or generated outputs.
- Summaries may include endpoint host/path, provider name, response ID, output path, requested/detected format, byte count, and revised prompt.
- If a provider returns detailed failures, summarize status, retryability, provider, and short error text only.
