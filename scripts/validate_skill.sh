#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_DIR="${ROOT_DIR}/gpt-image-assets"

ROOT_DIR_ENV="${ROOT_DIR}" python3 - <<'PY'
from pathlib import Path
import os
import re
import sys
import yaml

root = Path(os.environ["ROOT_DIR_ENV"])
skill_dir = root / "gpt-image-assets"
skill_md = skill_dir / "SKILL.md"
agent_yaml = skill_dir / "agents" / "openai.yaml"

allowed_extensions = {
    ".md", ".mdx", ".txt", ".json", ".json5", ".yaml", ".yml", ".toml", ".js",
    ".cjs", ".mjs", ".ts", ".tsx", ".jsx", ".py", ".sh", ".rb", ".go", ".rs",
    ".swift", ".kt", ".java", ".cs", ".cpp", ".c", ".h", ".hpp", ".sql",
    ".csv", ".ini", ".cfg", ".env", ".xml", ".html", ".css", ".scss", ".sass",
    ".svg",
}

def fail(message):
    print(f"Agent Skills validation failed: {message}", file=sys.stderr)
    sys.exit(1)

if not skill_md.is_file():
    fail("missing gpt-image-assets/SKILL.md")

source = skill_md.read_text(encoding="utf-8")
match = re.match(r"^---\n(.*?)\n---\n(.*)$", source, re.S)
if not match:
    fail("SKILL.md must start with YAML frontmatter")

frontmatter = yaml.safe_load(match.group(1))
body = match.group(2)
if not isinstance(frontmatter, dict):
    fail("frontmatter must be a mapping")

name = frontmatter.get("name")
description = frontmatter.get("description")
license_id = frontmatter.get("license")
metadata = frontmatter.get("metadata")
compatibility = frontmatter.get("compatibility")

if name != skill_dir.name:
    fail("frontmatter name must match parent directory: gpt-image-assets")
if not re.match(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$", str(name or "")):
    fail("frontmatter name must use lowercase letters, numbers, and hyphens")
if not description or len(str(description)) > 600:
    fail("description must be present and concise")
if license_id and not isinstance(license_id, str):
    fail("license must be a string")
if compatibility is not None:
    if not isinstance(compatibility, str) or not compatibility.strip() or len(compatibility) > 500:
        fail("compatibility must be a non-empty string up to 500 characters")
if metadata is not None:
    if not isinstance(metadata, dict):
        fail("metadata must be a mapping")
    for key, value in metadata.items():
        if not isinstance(key, str) or not isinstance(value, str):
            fail("metadata must contain string keys and string values")

for required in ["official", "proxy", "png", "scripts/gpt_image_assets_cli.js"]:
    if required not in body:
        fail(f"SKILL.md body does not explain {required}")

for forbidden in ["{baseDir}", "Hermes should call", "OpenClaw", "autoGenImageSkill", "gpt_image_cli.js"]:
    if forbidden in body:
        fail(f"SKILL.md contains runtime-specific or old text: {forbidden}")

for removed in ["purchase keys", "quota APIs", "relay job polling"]:
    if removed not in body:
        fail(f"SKILL.md body must explicitly state removed path: {removed}")

refs = re.findall(r"\[[^\]]+\]\((references/[^)]+)\)", body)
missing_refs = [ref for ref in refs if not (skill_dir / ref).is_file()]
if missing_refs:
    fail(f"missing referenced files: {missing_refs}")

if not agent_yaml.is_file():
    fail("missing agents/openai.yaml")
agent = yaml.safe_load(agent_yaml.read_text(encoding="utf-8"))
default_prompt = (((agent or {}).get("interface") or {}).get("default_prompt") or "")
if "$gpt-image-assets" not in default_prompt:
    fail("agents/openai.yaml default_prompt must mention $gpt-image-assets")
if ((agent or {}).get("policy") or {}).get("allow_implicit_invocation") is not True:
    fail("agents/openai.yaml should allow implicit invocation")

bad_files = []
for path in skill_dir.rglob("*"):
    if path.is_dir():
        continue
    if path.name in {"SKILL.md"}:
        continue
    if path.suffix.lower() not in allowed_extensions:
        bad_files.append(str(path.relative_to(root)))
if bad_files:
    fail(f"non-text files are not skill-package friendly: {bad_files}")

print("Agent Skills source metadata ok")
PY

node --check "${SKILL_DIR}/scripts/gpt_image_assets_cli.js"
node "${SKILL_DIR}/scripts/gpt_image_assets_cli.js" help >/dev/null
if node "${SKILL_DIR}/scripts/gpt_image_assets_cli.js" help | grep -Eq 'reserved|redeem|quota|session|Hermes|OpenClaw|autoGenImageSkill|gpt_image_cli'; then
  echo "Agent Skills validation failed: CLI help exposes old or removed commands/text" >&2
  exit 1
fi

printf 'Agent Skills validation passed for %s\n' "${SKILL_DIR}"
