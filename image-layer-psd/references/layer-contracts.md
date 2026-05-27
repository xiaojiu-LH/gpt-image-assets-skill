# Layer Contracts

Use a fixed contract before generation. Do not improvise layer names after files are generated.

## Presets

| Preset | Layers |
|---|---|
| `ecommerce` | `subject,background,text,logo,decoration` |
| `product` | `product,shadow-reflection,background,label-text,logo` |
| `poster` | `main-subject,background,headline-text,body-text,logo,decoration` |
| `character` | `character,background,props,lighting-effects,text` |
| `generic` | `subject,background,text,logo` |

## Layer Roles

- `subject`, `product`, `main-subject`, `character`: transparent PNG, only the main foreground object or person.
- `background`: completed opaque scene with foreground removed and no empty silhouette.
- `text`, `headline-text`, `body-text`, `label-text`: transparent PNG containing only visible text marks.
- `logo`: transparent PNG containing only logo or brand mark.
- `decoration`, `props`, `lighting-effects`, `shadow-reflection`: transparent PNG with only auxiliary production elements.

## Naming Rules

- Use lowercase ASCII slugs in file names.
- Use the same names in `layers.json`, PSD layer records, QC reports, and retry notes.
- If the user names exact layers, preserve their intent but normalize file names to slugs.
