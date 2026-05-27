#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_MODEL = 'gpt-5.4';
const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
const DEFAULT_SIZE = '1024x1536';
const DEFAULT_QUALITY = 'high';
const DEFAULT_RETRIES = 3;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PSD_SIGNATURE = Buffer.from('8BPS', 'ascii');

const LAYER_PRESETS = {
  ecommerce: ['subject', 'background', 'text', 'logo', 'decoration'],
  product: ['product', 'shadow-reflection', 'background', 'label-text', 'logo'],
  poster: ['main-subject', 'background', 'headline-text', 'body-text', 'logo', 'decoration'],
  character: ['character', 'background', 'props', 'lighting-effects', 'text'],
  generic: ['subject', 'background', 'text', 'logo'],
};

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const eqIndex = token.indexOf('=');
    if (eqIndex > 2) {
      args[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function help() {
  return `image-layer-psd CLI

Usage:
  node image_layer_psd_cli.js run --mode official --permission-code "$OPENAI_API_KEY" --prompt "..." --preset ecommerce --out-dir output/layers --output output/result.psd
  node image_layer_psd_cli.js generate-base --prompt "..." --output output/base.png
  node image_layer_psd_cli.js split-layers --base-image output/base.png --prompt "..." --preset product --out-dir output/layers
  node image_layer_psd_cli.js build-psd --layers-json output/layers/layers.json --output output/result.psd
  node image_layer_psd_cli.js qc --layers-json output/layers/layers.json --psd output/result.psd

Commands:
  generate-base   Generate a coherent base PNG from prompt or image input.
  split-layers    Generate one transparent PNG per layer contract item.
  build-psd       Assemble layer PNGs into a real multi-layer PSD.
  qc              Check PSD signature, layer names, PNG sizes, and transparency.
  run             Generate/copy base, split layers, build PSD, QC, and retry failed layers.

Common options:
  --mode official|proxy             default: official
  --permission-code TEXT            official OpenAI key; OPENAI_API_KEY also works
  --api-key TEXT                    proxy key; GPT_IMAGE_API_KEY also works
  --base-url URL                    official/proxy base URL
  --prompt TEXT
  --image PATH_OR_DATA_URL          source/reference image
  --base-image PATH                 existing base PNG for split-layers
  --preset NAME                     ecommerce|product|poster|character|generic
  --layers LIST                     comma-separated explicit layer names
  --out-dir DIR                     default: output/image-layer-psd
  --output PATH                     PSD path or base PNG path depending on command
  --model NAME                      default: gpt-5.4
  --image-model NAME                default: gpt-image-2
  --size WxH                        default: 1024x1536
  --quality VALUE                   default: high
  --previous-failure TEXT           failure note appended to layer prompts
  --max-retries N                   run command retries failed layers, default: 1

Secrets are read from args or env vars and are never printed.`;
}

function stringValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function integerValue(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireValue(name, value) {
  if (!value) throw new Error(`Missing required value: ${name}`);
  return value;
}

function redactedSummary(summary) {
  return JSON.stringify(summary, null, 2);
}

function slugifyLayerName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'layer';
}

function layerContract(args = {}) {
  const raw = stringValue(args.layers, process.env.IMAGE_LAYER_PSD_LAYERS);
  const layers = raw
    ? raw.split(',').map((item) => slugifyLayerName(item)).filter(Boolean)
    : LAYER_PRESETS[(stringValue(args.preset, process.env.IMAGE_LAYER_PSD_PRESET) || 'generic').toLowerCase()] || LAYER_PRESETS.generic;
  return [...new Set(layers)];
}

function normalizeEndpointCandidates(baseUrl) {
  const normalized = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!normalized) return [];
  const candidates = [];
  if (/\/responses$/i.test(normalized)) {
    candidates.push(normalized);
  } else if (/\/v\d+$/i.test(normalized) || /\/openai\/v\d+$/i.test(normalized)) {
    candidates.push(`${normalized}/responses`);
  } else if (/api\.openai\.com$/i.test(normalized)) {
    candidates.push(`${normalized}/v1/responses`);
  } else {
    candidates.push(`${normalized}/responses`);
    candidates.push(`${normalized}/v1/responses`);
  }
  candidates.push(normalized.replace(/\/openai\/v1\/responses$/i, '/v1/responses'));
  candidates.push(normalized.replace(/\/openai\/v1$/i, '/v1/responses'));
  candidates.push(normalized.replace(/\/v1$/i, '/v1/responses'));
  return [...new Set(candidates)];
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

function readImageDataUrl(value) {
  if (!value) return null;
  if (String(value).startsWith('data:image/')) return String(value);
  const absolutePath = path.resolve(String(value));
  const buffer = fs.readFileSync(absolutePath);
  return `data:${mimeFromPath(absolutePath)};base64,${buffer.toString('base64')}`;
}

function buildBasePrompt(prompt) {
  return `${prompt}

Create one coherent finished image. Do not create a collage of layers. Keep the composition suitable for later separation into Photoshop production layers.`;
}

function layerRole(layerName) {
  if (/(background)/.test(layerName)) return 'background';
  if (/(text|headline|body|label)/.test(layerName)) return 'text';
  if (/(logo|brand)/.test(layerName)) return 'logo';
  if (/(shadow|reflection|decoration|props|lighting|effects)/.test(layerName)) return 'decoration';
  return 'subject';
}

function buildLayerPrompt(basePrompt, layerName, previousFailure = '') {
  const role = layerRole(layerName);
  const retryText = previousFailure
    ? `\nPrevious failed layer attempt:\n${previousFailure}\nFix only this failure. Keep canvas size, composition alignment, and layer role unchanged.\n`
    : '';
  const common = `Base request:\n${basePrompt}\n\nTarget layer: ${layerName}\nCanvas: keep the same composition, size, and alignment as the reference image.\n`;

  if (role === 'background') {
    return `${common}
Create only the completed background layer as a PNG.
Requirements:
- remove the main subject/product/person and all foreground elements from this layer
- fill and inpaint the area behind removed objects
- no transparent holes, cutout silhouettes, copied subject residue, text, or logo
- keep this layer mostly opaque and full-canvas
${retryText}`;
  }

  if (role === 'text') {
    return `${common}
Create only the visible text/typography layer as a transparent-background PNG.
Requirements:
- include only text marks that belong on the design
- no background pixels
- no subject/product pixels
- preserve approximate placement, scale, and color from the reference
${retryText}`;
  }

  if (role === 'logo') {
    return `${common}
Create only the logo or brand mark layer as a transparent-background PNG.
Requirements:
- include only logo/brand pixels
- no background pixels
- no unrelated product/person/background pixels
- preserve approximate placement and proportions from the reference
${retryText}`;
  }

  if (role === 'decoration') {
    return `${common}
Create only the ${layerName} auxiliary production layer as a transparent-background PNG.
Requirements:
- include only the named decorative, prop, shadow, reflection, or lighting element
- no background pixels except soft transparency required by the element
- no main subject, text, or logo unless physically part of this element
${retryText}`;
  }

  return `${common}
Create only the main ${layerName} foreground layer as a transparent-background PNG.
Requirements:
- keep the subject/product identity, shape, color, material, lighting, and edge detail
- remove all background pixels
- do not include text, logo, props, or background unless physically part of the subject
- clean transparent edges suitable for Photoshop compositing
${retryText}`;
}

function buildPayload(args, prompt, inputImage) {
  const imageModel = stringValue(args['image-model'], process.env.GPT_IMAGE_MODEL) || DEFAULT_IMAGE_MODEL;
  return {
    model: stringValue(args.model, process.env.GPT_IMAGE_TEXT_MODEL) || DEFAULT_MODEL,
    input: inputImage
      ? [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: inputImage },
            ],
          },
        ]
      : prompt,
    tools: [
      {
        type: 'image_generation',
        model: imageModel,
        size: stringValue(args.size, process.env.GPT_IMAGE_SIZE) || DEFAULT_SIZE,
        quality: stringValue(args.quality, process.env.GPT_IMAGE_QUALITY) || DEFAULT_QUALITY,
        output_format: 'png',
      },
    ],
    tool_choice: { type: 'image_generation' },
    stream: true,
  };
}

async function readSseResult(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const result = { responseId: null, finalCall: null, error: null, outputText: '' };

  function captureItem(item) {
    if (!item || typeof item !== 'object') return;
    if (item.type === 'image_generation_call') result.finalCall = item;
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part.type === 'output_text' && part.text) result.outputText += part.text;
      }
    }
  }

  function handleEvent(obj) {
    if (obj.response && obj.response.id) result.responseId = obj.response.id;
    if (obj.type === 'response.output_item.done' && obj.item) captureItem(obj.item);
    if (obj.type === 'response.output_text.delta' && obj.delta) result.outputText += obj.delta;
    if ((obj.type === 'response.completed' || obj.type === 'response.incomplete') && obj.response && Array.isArray(obj.response.output)) {
      for (const item of obj.response.output) captureItem(item);
    }
    if (obj.type === 'error' && obj.error) result.error = obj.error;
    if (obj.type === 'response.failed' && obj.response && obj.response.error) result.error = obj.response.error;
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let splitIndex;
    while ((splitIndex = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, splitIndex);
      buffer = buffer.slice(splitIndex + 2);
      const dataText = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (!dataText || dataText === '[DONE]') continue;
      try {
        handleEvent(JSON.parse(dataText));
      } catch {
        // Ignore malformed chunks from relays.
      }
    }
  }
  return result;
}

function findImageGenerationCall(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.type === 'image_generation_call' && typeof obj.result === 'string') return obj;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findImageGenerationCall(item);
      if (found) return found;
    }
    return null;
  }
  for (const value of Object.values(obj)) {
    const found = findImageGenerationCall(value);
    if (found) return found;
  }
  return null;
}

function summarizeFailure(failure) {
  if (!failure) return null;
  const copy = { ...failure };
  if (typeof copy.body === 'string' && copy.body.length > 600) copy.body = `${copy.body.slice(0, 600)}...`;
  if (copy.error && typeof copy.error === 'object') copy.error = JSON.stringify(copy.error).slice(0, 600);
  return copy;
}

async function tryEndpoint(endpoint, apiKey, payload) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json',
    },
    body: JSON.stringify(payload),
  });
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    return {
      ok: false,
      endpoint,
      status: response.status,
      contentType,
      body: await response.text(),
      retryable: response.status === 408 || response.status === 409 || response.status === 425 || response.status === 429 || response.status >= 500,
    };
  }

  if (contentType.includes('text/event-stream')) {
    const sse = await readSseResult(response);
    if (sse.finalCall && sse.finalCall.result) {
      return { ok: true, endpoint, imageBase64: sse.finalCall.result, meta: { responseId: sse.responseId, finalCall: sse.finalCall } };
    }
    return { ok: false, endpoint, status: response.status, contentType, error: sse.error || 'SSE finished without image_generation_call.result', retryable: true };
  }

  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, endpoint, status: response.status, contentType, body: text, retryable: false };
  }

  const finalCall = findImageGenerationCall(parsed);
  if (finalCall && finalCall.result) {
    return { ok: true, endpoint, imageBase64: finalCall.result, meta: { responseId: parsed.id || parsed.response?.id || null, finalCall } };
  }
  return { ok: false, endpoint, status: response.status, contentType, body: text, retryable: false };
}

async function generatePng(args, prompt, inputImageValue) {
  const mode = stringValue(args.mode, process.env.IMAGE_LAYER_PSD_MODE) || 'official';
  const apiKey =
    mode === 'official'
      ? stringValue(args['permission-code'], args['api-key'], process.env.OPENAI_API_KEY, process.env.GPT_IMAGE_OFFICIAL_PERMISSION_CODE)
      : stringValue(args['api-key'], args['permission-code'], process.env.GPT_IMAGE_API_KEY);
  requireValue(mode === 'official' ? 'permission-code or OPENAI_API_KEY' : 'api-key or GPT_IMAGE_API_KEY', apiKey);

  const baseUrl =
    mode === 'official'
      ? stringValue(args['base-url'], process.env.OPENAI_BASE_URL) || 'https://api.openai.com/v1'
      : requireValue('base-url or GPT_IMAGE_BASE_URL', stringValue(args['base-url'], process.env.GPT_IMAGE_BASE_URL));
  const inputImage = readImageDataUrl(inputImageValue);
  const payload = buildPayload(args, prompt, inputImage);
  const endpoints = normalizeEndpointCandidates(baseUrl);
  const retries = Math.max(1, integerValue(args.retries || process.env.IMAGE_LAYER_PSD_RETRIES, DEFAULT_RETRIES));
  let lastFailure = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    for (const endpoint of endpoints) {
      try {
        const result = await tryEndpoint(endpoint, apiKey, payload);
        if (result.ok) {
          const buffer = Buffer.from(result.imageBase64, 'base64');
          validatePngBuffer(buffer);
          return { buffer, endpoint, mode, attempt, meta: result.meta };
        }
        lastFailure = { ...result, attempt };
        if (result.retryable === false) break;
      } catch (error) {
        lastFailure = { endpoint, attempt, error: String(error), retryable: true };
      }
    }
  }

  throw new Error(`Image generation failed: ${JSON.stringify(summarizeFailure(lastFailure))}`);
}

function validatePngBuffer(buffer) {
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('Expected PNG bytes from image generation endpoint.');
  }
}

function writeFileEnsured(filePath, buffer) {
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, buffer);
  return absolutePath;
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function parsePng(buffer) {
  validatePngBuffer(buffer);
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let transparency = null;
  const idatParts = [];

  while (offset + 12 <= buffer.length) {
    const length = readUInt32(buffer, offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IDAT') {
      idatParts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!width || !height || !idatParts.length) throw new Error('Invalid PNG: missing IHDR or IDAT data.');
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth: ${bitDepth}. Expected 8-bit PNG.`);
  if (interlace !== 0) throw new Error('Unsupported interlaced PNG.');
  const colorChannels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!colorChannels) throw new Error(`Unsupported PNG color type: ${colorType}.`);

  const inflated = zlib.inflateSync(Buffer.concat(idatParts));
  const scanlineLength = width * colorChannels;
  const raw = Buffer.alloc(height * scanlineLength);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const rowStart = y * scanlineLength;
    const prevRowStart = rowStart - scanlineLength;
    for (let x = 0; x < scanlineLength; x += 1) {
      const value = inflated[sourceOffset + x];
      const left = x >= colorChannels ? raw[rowStart + x - colorChannels] : 0;
      const up = y > 0 ? raw[prevRowStart + x] : 0;
      const upLeft = y > 0 && x >= colorChannels ? raw[prevRowStart + x - colorChannels] : 0;
      let decoded = value;
      if (filter === 1) decoded = value + left;
      else if (filter === 2) decoded = value + up;
      else if (filter === 3) decoded = value + Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        decoded = value + predictor;
      } else if (filter !== 0) {
        throw new Error(`Unsupported PNG filter type: ${filter}.`);
      }
      raw[rowStart + x] = decoded & 0xff;
    }
    sourceOffset += scanlineLength;
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const src = pixel * colorChannels;
    const dst = pixel * 4;
    if (colorType === 0) {
      const gray = raw[src];
      rgba[dst] = gray;
      rgba[dst + 1] = gray;
      rgba[dst + 2] = gray;
      rgba[dst + 3] = 255;
    } else if (colorType === 2) {
      rgba[dst] = raw[src];
      rgba[dst + 1] = raw[src + 1];
      rgba[dst + 2] = raw[src + 2];
      rgba[dst + 3] = 255;
      if (
        transparency &&
        raw[src] === transparency.readUInt16BE(0) &&
        raw[src + 1] === transparency.readUInt16BE(2) &&
        raw[src + 2] === transparency.readUInt16BE(4)
      ) {
        rgba[dst + 3] = 0;
      }
    } else if (colorType === 3) {
      if (!palette) throw new Error('Indexed PNG is missing PLTE chunk.');
      const index = raw[src];
      rgba[dst] = palette[index * 3] || 0;
      rgba[dst + 1] = palette[index * 3 + 1] || 0;
      rgba[dst + 2] = palette[index * 3 + 2] || 0;
      rgba[dst + 3] = transparency && index < transparency.length ? transparency[index] : 255;
    } else if (colorType === 4) {
      const gray = raw[src];
      rgba[dst] = gray;
      rgba[dst + 1] = gray;
      rgba[dst + 2] = gray;
      rgba[dst + 3] = raw[src + 1];
    } else if (colorType === 6) {
      rgba[dst] = raw[src];
      rgba[dst + 1] = raw[src + 1];
      rgba[dst + 2] = raw[src + 2];
      rgba[dst + 3] = raw[src + 3];
    }
  }

  return { width, height, rgba };
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function writeInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value, 0);
  return buffer;
}

function writeInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeInt16BE(value, 0);
  return buffer;
}

function pascalName(name) {
  const nameBuffer = Buffer.from(String(name || 'layer').slice(0, 255), 'ascii');
  const raw = Buffer.concat([Buffer.from([nameBuffer.length]), nameBuffer]);
  const padding = (4 - (raw.length % 4)) % 4;
  return Buffer.concat([raw, Buffer.alloc(padding)]);
}

function layerChannelsFromRgba(rgba, pixelCount) {
  const r = Buffer.alloc(pixelCount);
  const g = Buffer.alloc(pixelCount);
  const b = Buffer.alloc(pixelCount);
  const a = Buffer.alloc(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const src = i * 4;
    r[i] = rgba[src];
    g[i] = rgba[src + 1];
    b[i] = rgba[src + 2];
    a[i] = rgba[src + 3];
  }
  return [
    { id: 0, data: r },
    { id: 1, data: g },
    { id: 2, data: b },
    { id: -1, data: a },
  ];
}

function alphaBlend(bottom, top) {
  const output = Buffer.from(bottom);
  for (let i = 0; i < top.length; i += 4) {
    const ta = top[i + 3] / 255;
    if (ta <= 0) continue;
    const ba = output[i + 3] / 255;
    const outA = ta + ba * (1 - ta);
    if (outA <= 0) continue;
    output[i] = Math.round((top[i] * ta + output[i] * ba * (1 - ta)) / outA);
    output[i + 1] = Math.round((top[i + 1] * ta + output[i + 1] * ba * (1 - ta)) / outA);
    output[i + 2] = Math.round((top[i + 2] * ta + output[i + 2] * ba * (1 - ta)) / outA);
    output[i + 3] = Math.round(outA * 255);
  }
  return output;
}

function compositeSortScore(layer) {
  const role = layerRole(layer.name);
  if (role === 'background') return 0;
  if (/(shadow|reflection)/.test(layer.name)) return 1;
  if (role === 'subject') return 2;
  if (role === 'decoration') return 3;
  if (role === 'text') return 4;
  if (role === 'logo') return 5;
  return 3;
}

function buildPsdBuffer(layerEntries) {
  if (!layerEntries.length) throw new Error('No layers provided.');
  const decoded = layerEntries.map((entry) => {
    const png = parsePng(fs.readFileSync(path.resolve(entry.path)));
    return { ...entry, ...png };
  });
  const width = decoded[0].width;
  const height = decoded[0].height;
  const pixelCount = width * height;
  for (const layer of decoded) {
    if (layer.width !== width || layer.height !== height) {
      throw new Error(`Layer size mismatch: ${layer.name} is ${layer.width}x${layer.height}, expected ${width}x${height}`);
    }
  }

  let composite = Buffer.alloc(pixelCount * 4);
  for (const layer of [...decoded].sort((a, b) => compositeSortScore(a) - compositeSortScore(b))) {
    composite = alphaBlend(composite, layer.rgba);
  }

  const layerRecords = [];
  const layerImageData = [];
  for (const layer of decoded) {
    const channels = layerChannelsFromRgba(layer.rgba, pixelCount).map((channel) => ({
      id: channel.id,
      imageData: Buffer.concat([writeUInt16(0), channel.data]),
    }));
    const channelInfo = channels.map((channel) => Buffer.concat([writeInt16(channel.id), writeUInt32(channel.imageData.length)]));
    const extraData = Buffer.concat([
      writeUInt32(0),
      writeUInt32(0),
      pascalName(layer.name),
    ]);
    layerRecords.push(
      Buffer.concat([
        writeInt32(0),
        writeInt32(0),
        writeInt32(height),
        writeInt32(width),
        writeUInt16(channels.length),
        ...channelInfo,
        Buffer.from('8BIM', 'ascii'),
        Buffer.from('norm', 'ascii'),
        Buffer.from([255, 0, 0, 0]),
        writeUInt32(extraData.length),
        extraData,
      ])
    );
    for (const channel of channels) layerImageData.push(channel.imageData);
  }

  let layerInfo = Buffer.concat([writeInt16(decoded.length), ...layerRecords, ...layerImageData]);
  if (layerInfo.length % 2) layerInfo = Buffer.concat([layerInfo, Buffer.alloc(1)]);
  const layerAndMask = Buffer.concat([writeUInt32(layerInfo.length), layerInfo, writeUInt32(0)]);
  const compositeChannels = layerChannelsFromRgba(composite, pixelCount).map((channel) => channel.data);

  return Buffer.concat([
    Buffer.from('8BPS', 'ascii'),
    writeUInt16(1),
    Buffer.alloc(6),
    writeUInt16(4),
    writeUInt32(height),
    writeUInt32(width),
    writeUInt16(8),
    writeUInt16(3),
    writeUInt32(0),
    writeUInt32(0),
    writeUInt32(layerAndMask.length),
    layerAndMask,
    writeUInt16(0),
    ...compositeChannels,
  ]);
}

function validatePsdBuffer(buffer) {
  if (!buffer.subarray(0, 4).equals(PSD_SIGNATURE)) throw new Error('PSD signature mismatch; expected 8BPS.');
}

function readLayerMetadata(layersJsonPath) {
  const absolute = path.resolve(layersJsonPath);
  const data = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  if (!Array.isArray(data.layers)) throw new Error('layers.json must contain a layers array.');
  const baseDir = path.dirname(absolute);
  const layers = data.layers.map((layer) => ({
    name: slugifyLayerName(layer.name),
    path: path.resolve(baseDir, layer.path),
    role: layer.role || layerRole(layer.name),
  }));
  return { ...data, layers, layersJson: absolute };
}

function writeLayerMetadata(outDir, baseImage, layers) {
  const absoluteOutDir = path.resolve(outDir);
  const metadata = {
    version: 1,
    baseImage: baseImage ? path.relative(absoluteOutDir, path.resolve(baseImage)).replace(/\\/g, '/') : null,
    layers: layers.map((layer) => ({
      name: layer.name,
      role: layer.role || layerRole(layer.name),
      path: path.relative(absoluteOutDir, path.resolve(layer.path)).replace(/\\/g, '/'),
    })),
  };
  const metadataPath = path.join(absoluteOutDir, 'layers.json');
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return metadataPath;
}

function parsePsdLayerNames(buffer) {
  validatePsdBuffer(buffer);
  let offset = 26;
  const colorModeLength = buffer.readUInt32BE(offset);
  offset += 4 + colorModeLength;
  const imageResourcesLength = buffer.readUInt32BE(offset);
  offset += 4 + imageResourcesLength;
  const layerMaskLength = buffer.readUInt32BE(offset);
  offset += 4;
  if (!layerMaskLength) return [];
  const layerInfoLength = buffer.readUInt32BE(offset);
  offset += 4;
  if (!layerInfoLength) return [];
  const layerInfoEnd = offset + layerInfoLength;
  let layerCount = buffer.readInt16BE(offset);
  offset += 2;
  layerCount = Math.abs(layerCount);
  const names = [];
  for (let i = 0; i < layerCount && offset < layerInfoEnd; i += 1) {
    offset += 16;
    const channelCount = buffer.readUInt16BE(offset);
    offset += 2 + channelCount * 6;
    offset += 12;
    const extraLength = buffer.readUInt32BE(offset);
    offset += 4;
    const extraStart = offset;
    let cursor = extraStart;
    const maskLength = buffer.readUInt32BE(cursor);
    cursor += 4 + maskLength;
    const blendLength = buffer.readUInt32BE(cursor);
    cursor += 4 + blendLength;
    const nameLength = buffer[cursor];
    cursor += 1;
    names.push(buffer.subarray(cursor, cursor + nameLength).toString('ascii'));
    offset = extraStart + extraLength;
  }
  return names;
}

function pngStats(filePath) {
  const png = parsePng(fs.readFileSync(path.resolve(filePath)));
  const pixelCount = png.width * png.height;
  let transparent = 0;
  let semitransparent = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    const alpha = png.rgba[i * 4 + 3];
    if (alpha === 0) transparent += 1;
    if (alpha > 0 && alpha < 255) semitransparent += 1;
  }
  return {
    width: png.width,
    height: png.height,
    transparentRatio: transparent / pixelCount,
    semitransparentRatio: semitransparent / pixelCount,
  };
}

function qcReport(layersJsonPath, psdPath) {
  const metadata = readLayerMetadata(layersJsonPath);
  const failures = [];
  const layerStats = [];
  let canvas = null;

  for (const layer of metadata.layers) {
    if (!fs.existsSync(layer.path)) {
      failures.push(`${layer.name}: missing PNG file`);
      continue;
    }
    try {
      const stats = pngStats(layer.path);
      layerStats.push({ name: layer.name, role: layer.role, ...stats });
      if (!canvas) canvas = { width: stats.width, height: stats.height };
      if (canvas.width !== stats.width || canvas.height !== stats.height) {
        failures.push(`${layer.name}: size ${stats.width}x${stats.height} does not match canvas ${canvas.width}x${canvas.height}`);
      }
      if (layer.role === 'background' && stats.transparentRatio > 0.02) {
        failures.push(`${layer.name}: background has transparent holes (${Math.round(stats.transparentRatio * 100)}%)`);
      }
      if (layer.role !== 'background' && !/(text|logo)/.test(layer.role) && stats.transparentRatio < 0.01) {
        failures.push(`${layer.name}: foreground layer has no useful transparency`);
      }
    } catch (error) {
      failures.push(`${layer.name}: invalid PNG (${error.message})`);
    }
  }

  let psdLayerNames = [];
  if (!psdPath || !fs.existsSync(path.resolve(psdPath))) {
    failures.push('psd: missing PSD file');
  } else {
    try {
      const psdBuffer = fs.readFileSync(path.resolve(psdPath));
      validatePsdBuffer(psdBuffer);
      psdLayerNames = parsePsdLayerNames(psdBuffer);
      for (const layer of metadata.layers) {
        if (!psdLayerNames.includes(layer.name)) failures.push(`${layer.name}: missing PSD layer name`);
      }
      if (psdLayerNames.length < metadata.layers.length) failures.push(`psd: layer count ${psdLayerNames.length} is lower than contract ${metadata.layers.length}`);
    } catch (error) {
      failures.push(`psd: invalid PSD (${error.message})`);
    }
  }

  return {
    ok: failures.length === 0,
    canvas,
    expectedLayers: metadata.layers.map((layer) => layer.name),
    psdLayerNames,
    layerStats,
    failures,
    retryReason: failures.join('; '),
  };
}

async function commandGenerateBase(args) {
  const prompt = requireValue('prompt', stringValue(args.prompt, process.env.PROMPT));
  const output = path.resolve(stringValue(args.output) || path.join(stringValue(args['out-dir']) || 'output/image-layer-psd', 'base.png'));
  const result = await generatePng(args, buildBasePrompt(prompt), stringValue(args.image));
  writeFileEnsured(output, result.buffer);
  process.stdout.write(redactedSummary({ ok: true, output, bytes: result.buffer.length, endpoint: result.endpoint, responseId: result.meta?.responseId || null }) + '\n');
}

async function generateLayer(args, baseImage, layerName, previousFailure = '') {
  const prompt = requireValue('prompt', stringValue(args.prompt, process.env.PROMPT));
  const layerPrompt = buildLayerPrompt(prompt, layerName, previousFailure);
  return generatePng(args, layerPrompt, baseImage);
}

async function commandSplitLayers(args) {
  const baseImage = requireValue('base-image or image', stringValue(args['base-image'], args.image));
  const outDir = path.resolve(stringValue(args['out-dir']) || 'output/image-layer-psd');
  fs.mkdirSync(outDir, { recursive: true });
  const layers = [];
  for (const layerName of layerContract(args)) {
    const result = await generateLayer(args, baseImage, layerName, stringValue(args['previous-failure']));
    const layerPath = path.join(outDir, `${layerName}.png`);
    writeFileEnsured(layerPath, result.buffer);
    layers.push({ name: layerName, role: layerRole(layerName), path: layerPath, responseId: result.meta?.responseId || null });
  }
  const layersJson = writeLayerMetadata(outDir, baseImage, layers);
  process.stdout.write(redactedSummary({ ok: true, baseImage: path.resolve(baseImage), layersJson, layers: layers.map((layer) => ({ name: layer.name, path: layer.path })) }) + '\n');
}

function commandBuildPsd(args) {
  const layersJson = requireValue('layers-json', stringValue(args['layers-json']));
  const metadata = readLayerMetadata(layersJson);
  const output = path.resolve(stringValue(args.output) || path.join(path.dirname(path.resolve(layersJson)), 'layered-output.psd'));
  const psdBuffer = buildPsdBuffer(metadata.layers);
  validatePsdBuffer(psdBuffer);
  writeFileEnsured(output, psdBuffer);
  const layerNames = parsePsdLayerNames(psdBuffer);
  process.stdout.write(redactedSummary({ ok: true, output, bytes: psdBuffer.length, layerCount: layerNames.length, layerNames }) + '\n');
}

function commandQc(args) {
  const report = qcReport(requireValue('layers-json', stringValue(args['layers-json'])), requireValue('psd', stringValue(args.psd)));
  process.stdout.write(`${redactedSummary(report)}\n`);
  if (!report.ok) process.exitCode = 2;
}

async function commandRun(args) {
  const outDir = path.resolve(stringValue(args['out-dir']) || 'output/image-layer-psd');
  fs.mkdirSync(outDir, { recursive: true });
  let baseImage = stringValue(args['base-image']);
  if (!baseImage && stringValue(args.image)) {
    baseImage = writeFileEnsured(path.join(outDir, 'base.png'), fs.readFileSync(path.resolve(args.image)));
  }
  if (!baseImage) {
    const baseResult = await generatePng(args, buildBasePrompt(requireValue('prompt', stringValue(args.prompt, process.env.PROMPT))), null);
    baseImage = writeFileEnsured(path.join(outDir, 'base.png'), baseResult.buffer);
  }

  const layers = [];
  const retries = Math.max(0, integerValue(args['max-retries'], 1));
  for (const layerName of layerContract(args)) {
    let previousFailure = stringValue(args['previous-failure']);
    let layerPath = '';
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const result = await generateLayer(args, baseImage, layerName, previousFailure);
      layerPath = writeFileEnsured(path.join(outDir, `${layerName}.png`), result.buffer);
      const stats = pngStats(layerPath);
      const role = layerRole(layerName);
      const failed =
        (role === 'background' && stats.transparentRatio > 0.02) ||
        (role !== 'background' && !/(text|logo)/.test(role) && stats.transparentRatio < 0.01);
      if (!failed || attempt === retries) break;
      previousFailure = `${layerName}: transparency check failed during generation attempt ${attempt + 1}`;
    }
    layers.push({ name: layerName, role: layerRole(layerName), path: layerPath });
  }

  const layersJson = writeLayerMetadata(outDir, baseImage, layers);
  const output = path.resolve(stringValue(args.output) || path.join(outDir, 'layered-output.psd'));
  const psdBuffer = buildPsdBuffer(readLayerMetadata(layersJson).layers);
  validatePsdBuffer(psdBuffer);
  writeFileEnsured(output, psdBuffer);
  const report = qcReport(layersJson, output);
  process.stdout.write(redactedSummary({ ok: report.ok, output, layersJson, baseImage: path.resolve(baseImage), qc: report }) + '\n');
  if (!report.ok) process.exitCode = 2;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'help';
  if (args.help || args.h || command === 'help') {
    process.stdout.write(`${help()}\n`);
    return;
  }
  if (typeof fetch !== 'function' && ['generate-base', 'split-layers', 'run'].includes(command)) {
    throw new Error('Node 18+ is required because this script uses global fetch');
  }

  if (command === 'generate-base') return commandGenerateBase(args);
  if (command === 'split-layers') return commandSplitLayers(args);
  if (command === 'build-psd') return commandBuildPsd(args);
  if (command === 'qc') return commandQc(args);
  if (command === 'run') return commandRun(args);
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(
    redactedSummary({
      ok: false,
      error: String(error && error.message ? error.message : error),
    }) + '\n'
  );
  process.exit(1);
});
