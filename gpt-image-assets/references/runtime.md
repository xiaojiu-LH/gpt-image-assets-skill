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

When `--output-format psd` is passed, `output_format` becomes `psd` and the prompt is strengthened with layered PSD requirements when `--layered-psd` is present.

Direct `official` and `proxy` modes:

1. Build the Responses payload.
2. If `--image` is present, convert the local image into a data URL and send a multimodal user message.
3. Post to `/responses` using the selected endpoint.
4. Parse either SSE or JSON.
5. Extract `image_generation_call.result`.
6. Decode base64 to bytes.
7. Validate file signature:
   - PNG: standard PNG signature.
   - PSD: `8BPS`.
8. Write to the requested output path.

## Output Format Behavior

PNG is the default and safest output.

PSD is an endpoint capability, not something the CLI can synthesize after the fact. The CLI can request PSD, add layer instructions, and verify the returned bytes, but it cannot convert a flattened PNG into a true layered PSD.

If PSD fails:

- If the endpoint rejects `output_format: psd`, switch endpoint or fallback to PNG.
- If the endpoint returns PNG while PSD was requested, the CLI fails with a format mismatch.
- If Photoshop opens the PSD but layer quality is poor, retry with `--previous-failure`.

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
