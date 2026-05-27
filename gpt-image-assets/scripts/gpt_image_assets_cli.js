#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_MODEL = 'gpt-5.4';
const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
const DEFAULT_SIZE = '1024x1536';
const DEFAULT_QUALITY = 'high';
const DEFAULT_OUTPUT_FORMAT = 'png';
const DEFAULT_DIRECT_RETRIES = 3;
const SUPPORTED_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'jpg', 'webp', 'psd']);
const PSD_TOOLCHAINS = new Set(['auto', 'endpoint', 'local']);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const WEBP_RIFF = Buffer.from('RIFF', 'ascii');
const WEBP_WEBP = Buffer.from('WEBP', 'ascii');

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
  return `gpt-image-assets CLI

Usage:
  node gpt_image_assets_cli.js generate --mode official --permission-code "$OPENAI_API_KEY" --prompt "..." --output out.png
  node gpt_image_assets_cli.js generate --mode proxy --base-url "$GPT_IMAGE_BASE_URL" --api-key "$GPT_IMAGE_API_KEY" --prompt "..."
  node gpt_image_assets_cli.js generate --mode proxy --output-format psd --layered-psd --layers "subject,background,text,logo" --prompt "..."

Common generate options:
  --prompt TEXT
  --image PATH_OR_DATA_URL
  --output PATH                     default: generated-image.<output-format>
  --model NAME                      default: gpt-5.4
  --image-model NAME                default: gpt-image-2
  --size WxH                        default: 1024x1536
  --quality VALUE                   default: high
  --output-format png|jpeg|webp|psd default: png
  --format png|jpeg|webp|psd        alias for --output-format
  --psd-toolchain auto|endpoint|local
                                    auto: official PSD uses local PNG->PSD, proxy PSD requests endpoint PSD
  --layered-psd                     add a strict layered PSD production prompt; true layers require endpoint PSD
  --layers LIST                     comma-separated PSD layers, e.g. "subject,background,text,logo"
  --layer-preset NAME               ecommerce|product|poster|character|generic
  --previous-failure TEXT           feed the last PSD QC failure back into the prompt
  --retries N                       direct official/proxy retries, default: 3

Secrets are read from arguments or environment variables and are never printed.`;
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

function boolValue(value) {
  return value === true || ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function requireValue(name, value) {
  if (!value) {
    throw new Error(`Missing required value: ${name}`);
  }
  return value;
}

function unique(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

function normalizeDirectEndpointCandidates(baseUrl) {
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

  return unique(candidates);
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

function readImageDataUrl(value) {
  if (!value) return null;
  if (String(value).startsWith('data:image/')) return String(value);

  const absolutePath = path.resolve(String(value));
  const buffer = fs.readFileSync(absolutePath);
  return `data:${mimeFromPath(absolutePath)};base64,${buffer.toString('base64')}`;
}

function normalizeOutputFormat(args = {}) {
  const value = stringValue(args['output-format'], args.format, process.env.GPT_IMAGE_OUTPUT_FORMAT) || DEFAULT_OUTPUT_FORMAT;
  const normalized = value.toLowerCase() === 'jpg' ? 'jpeg' : value.toLowerCase();
  if (!SUPPORTED_OUTPUT_FORMATS.has(normalized)) {
    throw new Error(`Unsupported output format: ${value}. Supported formats: png, jpeg, webp, psd`);
  }
  return normalized;
}

function normalizePsdToolchain(args = {}) {
  const value = stringValue(args['psd-toolchain'], process.env.GPT_IMAGE_PSD_TOOLCHAIN) || 'auto';
  const normalized = value.toLowerCase();
  if (!PSD_TOOLCHAINS.has(normalized)) {
    throw new Error(`Unsupported PSD toolchain: ${value}. Supported values: auto, endpoint, local`);
  }
  return normalized;
}

function resolveRequestOutputFormat(outputFormat, mode, psdToolchain) {
  if (outputFormat !== 'psd') return outputFormat;
  if (psdToolchain === 'local') return 'png';
  if (psdToolchain === 'endpoint') return 'psd';
  return mode === 'official' ? 'png' : 'psd';
}

function boolArg(args, key, envName = '') {
  return boolValue(args[key]) || (envName ? boolValue(process.env[envName]) : false);
}

function layerList(args = {}) {
  const raw = stringValue(args.layers, process.env.GPT_IMAGE_LAYERS);
  if (raw) {
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const preset = (stringValue(args['layer-preset'], process.env.GPT_IMAGE_LAYER_PRESET) || 'generic').toLowerCase();
  if (preset === 'ecommerce' || preset === 'product') return ['subject/product', 'background', 'text', 'logo', 'decoration'];
  if (preset === 'poster') return ['main subject', 'background', 'headline text', 'subtitle/body text', 'logo/brand mark', 'decoration'];
  if (preset === 'character') return ['character', 'background', 'props', 'lighting/effects', 'text'];
  return ['subject', 'background', 'text', 'logo'];
}

function buildLayeredPsdPrompt(prompt, args = {}) {
  const layers = layerList(args);
  const previousFailure = stringValue(args['previous-failure'], process.env.GPT_IMAGE_PREVIOUS_FAILURE);
  const layerText = layers.map((layer, index) => `${index + 1}. ${layer}`).join('\n');
  const failureText = previousFailure
    ? `\nPrevious failed attempt to fix:\n${previousFailure}\nCorrect the specific failure above in this generation.\n`
    : '';

  return `${prompt}

Create an editable layered PSD file, not a flattened final image.

Layer contract:
${layerText}

Hard requirements:
- Output must be a PSD file with independent, named layers.
- Keep the main subject on a transparent-background layer with clean edges.
- Complete and inpaint the background behind removed foreground objects; no holes, empty silhouettes, or copied subject residue.
- Put visible text and logos on separate editable layers whenever they exist.
- Use clear layer names matching the layer contract.
- Keep visual composition coherent after any single layer is moved, hidden, or replaced.
- Do not flatten all content into one bitmap layer.
${failureText}
Quality target: this file should open in Photoshop and allow layer-by-layer editing for ecommerce or marketing production.`;
}

function buildPayload(args, inputImage, requestOutputFormat = null, endpointLayeredPsd = null) {
  const prompt = requireValue('prompt', stringValue(args.prompt, process.env.PROMPT));
  const imageModel = stringValue(args['image-model'], process.env.GPT_IMAGE_MODEL) || DEFAULT_IMAGE_MODEL;
  const outputFormat = requestOutputFormat || normalizeOutputFormat(args);
  const wantsLayeredPsd =
    endpointLayeredPsd === null
      ? outputFormat === 'psd' || boolArg(args, 'layered-psd', 'GPT_IMAGE_LAYERED_PSD')
      : endpointLayeredPsd;
  const finalPrompt = wantsLayeredPsd ? buildLayeredPsdPrompt(prompt, args) : prompt;

  return {
    model: stringValue(args.model, process.env.GPT_IMAGE_TEXT_MODEL) || DEFAULT_MODEL,
    input: inputImage
      ? [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: finalPrompt },
              { type: 'input_image', image_url: inputImage },
            ],
          },
        ]
      : finalPrompt,
    tools: [
      {
        type: 'image_generation',
        model: imageModel,
        size: stringValue(args.size, process.env.GPT_IMAGE_SIZE) || DEFAULT_SIZE,
        quality: stringValue(args.quality, process.env.GPT_IMAGE_QUALITY) || DEFAULT_QUALITY,
        output_format: outputFormat,
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
  const result = {
    responseId: null,
    createdTool: null,
    finalCall: null,
    outputText: '',
    error: null,
  };

  function captureOutputItem(item) {
    if (!item || typeof item !== 'object') return;

    if (item.type === 'image_generation_call') {
      result.finalCall = item;
      return;
    }

    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part.type === 'output_text' && part.text) {
          result.outputText += part.text;
        }
      }
    }
  }

  function handleEvent(obj) {
    if (obj.response && obj.response.id) {
      result.responseId = obj.response.id;
    }

    if (
      (obj.type === 'response.created' || obj.type === 'response.in_progress') &&
      obj.response &&
      Array.isArray(obj.response.tools) &&
      obj.response.tools[0] &&
      !result.createdTool
    ) {
      result.createdTool = obj.response.tools[0];
    }

    if (obj.type === 'response.output_text.delta' && obj.delta) {
      result.outputText += obj.delta;
    }

    if (obj.type === 'response.output_item.done' && obj.item) {
      captureOutputItem(obj.item);
    }

    if (
      (obj.type === 'response.completed' || obj.type === 'response.incomplete') &&
      obj.response &&
      Array.isArray(obj.response.output)
    ) {
      for (const item of obj.response.output) {
        captureOutputItem(item);
      }
    }

    if (obj.type === 'error' && obj.error) {
      result.error = obj.error;
    }

    if (obj.type === 'response.failed' && obj.response && obj.response.error && !result.error) {
      result.error = obj.response.error;
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let splitIndex;
    while ((splitIndex = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, splitIndex);
      buffer = buffer.slice(splitIndex + 2);
      const lines = block.split(/\r?\n/);
      const dataLines = [];

      for (const line of lines) {
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      }

      const dataText = dataLines.join('\n');
      if (!dataText || dataText === '[DONE]') continue;

      try {
        handleEvent(JSON.parse(dataText));
      } catch {
        // Ignore malformed chunks from intermediary relays.
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
  if (typeof copy.body === 'string' && copy.body.length > 600) {
    copy.body = `${copy.body.slice(0, 600)}...`;
  }
  if (copy.error && typeof copy.error === 'object') {
    copy.error = JSON.stringify(copy.error).slice(0, 600);
  }
  return copy;
}

async function tryDirectEndpoint(endpoint, apiKey, payload) {
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
    const finalCall = sse.finalCall;
    if (finalCall && finalCall.result) {
      return {
        ok: true,
        endpoint,
        imageBase64: finalCall.result,
        meta: {
          responseId: sse.responseId,
          createdTool: sse.createdTool,
          finalCall,
          outputText: sse.outputText || '',
        },
      };
    }
    return {
      ok: false,
      endpoint,
      status: response.status,
      contentType,
      error: sse.error || 'SSE finished without image_generation_call.result',
      retryable: true,
    };
  }

  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      endpoint,
      status: response.status,
      contentType,
      body: text,
      retryable: false,
    };
  }

  const finalCall = findImageGenerationCall(parsed);
  if (finalCall && finalCall.result) {
    return {
      ok: true,
      endpoint,
      imageBase64: finalCall.result,
      meta: {
        responseId: parsed.id || parsed.response?.id || null,
        createdTool: Array.isArray(parsed.tools) ? parsed.tools[0] : null,
        finalCall,
        outputText: '',
      },
    };
  }

  return {
    ok: false,
    endpoint,
    status: response.status,
    contentType,
    body: text,
    retryable: false,
  };
}

async function generateDirect(args, mode, requestOutputFormat = null) {
  const apiKey =
    mode === 'official'
      ? stringValue(args['permission-code'], args['api-key'], process.env.OPENAI_API_KEY, process.env.GPT_IMAGE_OFFICIAL_PERMISSION_CODE)
      : stringValue(args['api-key'], args['permission-code'], process.env.GPT_IMAGE_API_KEY);
  requireValue(mode === 'official' ? 'permission-code or OPENAI_API_KEY' : 'api-key or GPT_IMAGE_API_KEY', apiKey);

  const baseUrl =
    mode === 'official'
      ? stringValue(args['base-url'], process.env.OPENAI_BASE_URL) || 'https://api.openai.com/v1'
      : requireValue('base-url or GPT_IMAGE_BASE_URL', stringValue(args['base-url'], process.env.GPT_IMAGE_BASE_URL));

  const inputImage = readImageDataUrl(stringValue(args.image, process.env.GPT_IMAGE_INPUT_IMAGE));
  const payload = buildPayload(args, inputImage, requestOutputFormat, requestOutputFormat === 'psd');
  const endpoints = normalizeDirectEndpointCandidates(baseUrl);
  const retries = Math.max(1, integerValue(args.retries || process.env.GPT_IMAGE_RETRIES, DEFAULT_DIRECT_RETRIES));
  let lastFailure = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    for (const endpoint of endpoints) {
      try {
        const result = await tryDirectEndpoint(endpoint, apiKey, payload);
        if (result.ok) {
          return {
            ...result,
            mode,
            providerName: stringValue(args['provider-name']) || (mode === 'official' ? 'official' : 'proxy'),
            attempt,
          };
        }

        lastFailure = { ...result, attempt };
        if (result.retryable === false) break;
      } catch (error) {
        lastFailure = {
          endpoint,
          attempt,
          error: String(error),
          retryable: true,
        };
      }
    }
  }

  throw new Error(`Generation failed: ${JSON.stringify(summarizeFailure(lastFailure))}`);
}

function writeOutput(outputPath, buffer) {
  const absoluteOutput = path.resolve(outputPath || 'generated-image.png');
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(absoluteOutput, buffer);
  return {
    output: absoluteOutput,
    bytes: fs.statSync(absoluteOutput).size,
  };
}

function defaultOutputPath(args, outputFormat) {
  return stringValue(args.output, process.env.OUTPUT) || `generated-image.${outputFormat}`;
}

function detectBufferFormat(buffer) {
  if (buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return 'png';
  if (buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) return 'jpeg';
  if (buffer.subarray(0, 4).equals(WEBP_RIFF) && buffer.subarray(8, 12).equals(WEBP_WEBP)) return 'webp';
  if (buffer.subarray(0, 4).toString('ascii') === '8BPS') return 'psd';
  return 'unknown';
}

function validateOutputBuffer(buffer, expectedFormat) {
  const detectedFormat = detectBufferFormat(buffer);
  if (detectedFormat !== expectedFormat) {
    throw new Error(
      `Generated file format mismatch: requested ${expectedFormat}, received ${detectedFormat}. ` +
        'If PSD is not supported by the selected endpoint, retry with --output-format png or use a PSD-capable proxy.'
    );
  }
  return detectedFormat;
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function parsePng(buffer) {
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('Local PSD toolchain requires PNG input from the image endpoint.');
  }

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

  if (!width || !height || !idatParts.length) {
    throw new Error('Invalid PNG: missing IHDR or IDAT data.');
  }
  if (bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth for local PSD toolchain: ${bitDepth}. Expected 8-bit PNG.`);
  }
  if (interlace !== 0) {
    throw new Error('Unsupported interlaced PNG for local PSD toolchain.');
  }

  const colorChannels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!colorChannels) {
    throw new Error(`Unsupported PNG color type for local PSD toolchain: ${colorType}.`);
  }

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
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value, 0);
  return buffer;
}

function pngToFlattenedPsdBuffer(pngBuffer) {
  const { width, height, rgba } = parsePng(pngBuffer);
  const pixelCount = width * height;
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

  const header = Buffer.concat([
    Buffer.from('8BPS', 'ascii'),
    writeUInt16(1),
    Buffer.alloc(6),
    writeUInt16(4),
    writeUInt32(height),
    writeUInt32(width),
    writeUInt16(8),
    writeUInt16(3),
  ]);

  return Buffer.concat([
    header,
    writeUInt32(0),
    writeUInt32(0),
    writeUInt32(0),
    writeUInt16(0),
    r,
    g,
    b,
    a,
  ]);
}

function redactedSummary(summary) {
  return JSON.stringify(summary, null, 2);
}

async function commandGenerate(args) {
  const mode = stringValue(args.mode, process.env.GPT_IMAGE_MODE) || 'official';
  const outputFormat = normalizeOutputFormat(args);
  const psdToolchain = normalizePsdToolchain(args);
  const requestOutputFormat = resolveRequestOutputFormat(outputFormat, mode, psdToolchain);
  const localPsdToolchain = outputFormat === 'psd' && requestOutputFormat === 'png';
  let result = null;

  if (mode === 'official' || mode === 'proxy') {
    result = await generateDirect(args, mode, requestOutputFormat);
    result.imageBuffer = Buffer.from(result.imageBase64, 'base64');
    delete result.imageBase64;
  } else {
    throw new Error(`Unsupported mode: ${mode}. Only official and proxy are supported in this Agent Skill.`);
  }

  const sourceDetectedFormat = validateOutputBuffer(result.imageBuffer, requestOutputFormat);
  if (localPsdToolchain) {
    result.imageBuffer = pngToFlattenedPsdBuffer(result.imageBuffer);
  }
  const detectedFormat = validateOutputBuffer(result.imageBuffer, outputFormat);
  const outputInfo = writeOutput(defaultOutputPath(args, outputFormat), result.imageBuffer);
  const finalCall = result.meta?.finalCall || null;

  process.stdout.write(
    redactedSummary({
      ok: true,
      mode: result.mode || mode,
      providerName: result.providerName || null,
      endpoint: result.endpoint || null,
      output: outputInfo.output,
      bytes: outputInfo.bytes,
      requestedFormat: outputFormat,
      requestOutputFormat,
      detectedFormat,
      sourceDetectedFormat,
      psdToolchain: outputFormat === 'psd' ? (localPsdToolchain ? 'local-png-to-flattened-psd' : 'endpoint') : null,
      flattenedPsd: localPsdToolchain || null,
      responseId: result.meta?.responseId || null,
      image: finalCall
        ? {
            type: finalCall.type,
            model: finalCall.model || null,
            quality: finalCall.quality || null,
            size: finalCall.size || null,
            output_format: finalCall.output_format || null,
            revised_prompt: finalCall.revised_prompt || null,
          }
        : null,
    }) + '\n'
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'generate';

  if (args.help || args.h || command === 'help') {
    process.stdout.write(`${help()}\n`);
    return;
  }

  if (typeof fetch !== 'function') {
    throw new Error('Node 18+ is required because this script uses global fetch');
  }

  if (command === 'generate') {
    await commandGenerate(args);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(
    redactedSummary({
      ok: false,
      error: String(error && error.message ? error.message : error),
      status: error && error.status ? error.status : null,
      body: error && error.body ? summarizeFailure(error.body) : null,
    }) + '\n'
  );
  process.exit(1);
});
