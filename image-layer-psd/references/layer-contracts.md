# 图层规范

生成前必须先固定图层规范。不要在图层文件生成后再临时发挥或改名。

## 预设

| 预设 | 图层 |
|---|---|
| `ecommerce` | `subject,background,text,logo,decoration` |
| `product` | `product,shadow-reflection,background,label-text,logo` |
| `poster` | `main-subject,background,headline-text,body-text,logo,decoration` |
| `character` | `character,background,props,lighting-effects,text` |
| `generic` | `subject,background,text,logo` |

## 图层职责

- `subject`、`product`、`main-subject`、`character`：透明 PNG，只包含主要前景物体或人物。
- `background`：完整的不透明背景，前景被移除后必须补全，不能留下空洞或剪影。
- `text`、`headline-text`、`body-text`、`label-text`：透明 PNG，只包含可见文字。
- `logo`：透明 PNG，只包含 logo 或品牌标志。
- `decoration`、`props`、`lighting-effects`、`shadow-reflection`：透明 PNG，只包含辅助生产元素。

## 命名规则

- 文件名使用小写 ASCII slug。
- `layers.json`、PSD 图层记录、QC 报告和重试说明必须使用同一套名称。
- 如果用户指定了精确图层名，保留其语义，但文件名仍规范化为 slug。
