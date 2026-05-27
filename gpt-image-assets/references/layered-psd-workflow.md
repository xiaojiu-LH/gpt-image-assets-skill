# Layered PSD Workflow

Use this reference when the user asks for PSD, Photoshop-editable material, 分层 PSD, 图层分割, 电商素材, or PS 逐层修改.

There are two PSD paths:

- Endpoint layered PSD: a PSD-capable proxy returns a real layered PSD.
- Local flattened PSD: official OpenAI returns PNG, then the CLI converts that PNG into a valid flattened PSD. This is useful when the user needs a `.psd` file container, but it does not create semantic layers.

## Goal

Do not stop at "generate one finished image." Produce a material file that can be edited in Photoshop:

- main subject isolated on transparent background
- background completed behind the subject
- text and logos on separate layers when present
- clean layer names
- no flattened single-layer result

## Workflow

1. Identify use case:
   - ecommerce product image
   - model/lifestyle photo
   - poster or detail page
   - icon/sticker
   - character or scene material
2. Lock the layer contract.
3. For true layers, generate through a PSD-capable proxy with `--output-format psd --psd-toolchain endpoint --layered-psd`.
4. Inspect the result in Photoshop or a PSD-capable viewer.
5. If failed, retry with `--previous-failure`.

For official OpenAI access only, use:

```bash
--output-format psd --psd-toolchain local
```

Report the result as a flattened PSD, not a layered PSD.

## Layer Presets

| Preset | Layers |
|---|---|
| `ecommerce` | `subject/product,background,text,logo,decoration` |
| `product` | `subject/product,background,text,logo,decoration` |
| `poster` | `main subject,background,headline text,subtitle/body text,logo/brand mark,decoration` |
| `character` | `character,background,props,lighting/effects,text` |
| `generic` | `subject,background,text,logo` |

Override with `--layers` whenever the user names exact layers.

## Prompt Contract

The CLI automatically appends a strict PSD contract when `--layered-psd` is used. The core constraints are:

- output must be a PSD file
- layers must be independent and named
- subject layer must have transparent background and clean edges
- background must be complete behind foreground objects
- text and logos must be separated when present
- file must remain visually coherent if a layer is moved, hidden, or replaced

## Quality Check

After generation, verify:

- Does the file validate as PSD?
- Does Photoshop open it?
- Are there at least the requested layers?
- Is the subject edge clean?
- Does the subject layer contain background pixels?
- Is the background complete, without holes or subject silhouettes?
- Are text and logo layers separate when requested?
- Are layer names readable and aligned to the contract?

## Retry Messages

Feed the failure back into the CLI:

```bash
--previous-failure "subject layer contains background pixels; background under subject has empty silhouette; text is flattened into background"
```

Good failure notes are specific. Avoid vague notes like "not good" or "make it better."

## Fallback

If the endpoint cannot return PSD:

1. Tell the user that the selected endpoint does not support true layered PSD output.
2. Offer local flattened PSD generation from PNG when a `.psd` container is enough.
3. Offer PNG generation where useful.
4. Offer to switch to a PSD-capable proxy.

Do not claim a layered PSD was produced when the file is actually PNG or a flattened bitmap.
