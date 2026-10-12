// Finds a way to ask Claude for a second opinion:
// 1. the SecondLook server, when it runs with an Anthropic API key, or
// 2. Claude inside the claude.ai viewer, when the page is a hosted artifact.
// Without either, the on-device check still works on its own.

import { buildStandalonePrompt, normalizeAiResult } from './prompt.js';

export class AiError extends Error {
  constructor(message, code = 'upstream_error') {
    super(message);
    this.code = code;
  }
}

// Codes after which the AI check stays unavailable for this visit.
export const PERMANENT_CODES = new Set([
  'not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'not_configured',
]);

const VIEWER_COPY = {
  not_granted: 'You chose not to let this page use Claude. The on-device check still works.',
  sampling_disabled: 'Claude is not available on this account. The on-device check still works.',
  rate_limited: 'Too many checks at once. Wait a minute, then try again.',
  session_expired: 'Sign in to Claude again, then try again.',
  refused: 'Claude could not check this message. The on-device verdict still applies.',
  invalid_json: 'The answer came back garbled. Try again.',
  image_rejected: 'That image could not be read. Try a PNG or JPG screenshot.',
  images_unavailable: 'Screenshots cannot be sent from here. Paste the text instead.',
  prompt_too_large: 'That message is too long. Paste just the important part.',
};

function copyFor(code) {
  return VIEWER_COPY[code] || 'The AI check did not finish. Try again.';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function serverProvider() {
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  try {
    const res = await fetch('api/health', { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const health = await res.json();
    return {
      id: 'server',
      ready: Boolean(health.ai),
      label: 'Claude, through this SecondLook server',
      supportsImages: true,
      imageTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      async analyze({ text, language, localSummary, image, signal }) {
        if (!health.ai) throw new AiError('The AI second opinion is off. Start the server with an ANTHROPIC_API_KEY to turn it on.', 'not_configured');
        const body = { text, language, localSummary };
        if (image) body.image = { mediaType: image.type, data: await blobToBase64(image) };
        let response;
        try {
          response = await fetch('api/analyze', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          });
        } catch (err) {
          if (err?.name === 'AbortError') throw new AiError('', 'cancelled');
          throw new AiError('Could not reach the SecondLook server. Check that it is still running.');
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new AiError(data.error || copyFor(data.code), data.code || 'upstream_error');
        return normalizeAiResult(data.result);
      },
    };
  } catch {
    return null;
  }
}

async function viewerProvider() {
  const runtime = typeof window !== 'undefined' ? window.claude : null;
  if (!runtime?.use) return null;
  const sample = await runtime.use('sample');
  if (!sample) return null;
  const limits = await sample.limits().catch(() => null);
  return {
    id: 'viewer',
    ready: true,
    label: 'Claude, on your own Claude account',
    supportsImages: Boolean(limits?.images),
    imageTypes: limits?.images?.mediaTypes || [],
    async analyze({ text, language, localSummary, image, signal }) {
      const options = { signal, modelTier: 'default', cache: false };
      if (image) options.images = [image];
      try {
        const raw = await sample.json(buildStandalonePrompt({ text, language, localSummary, hasImage: Boolean(image) }), options);
        return normalizeAiResult(raw);
      } catch (err) {
        const code = err?.code || 'upstream_error';
        throw new AiError(code === 'cancelled' ? '' : copyFor(code), code);
      }
    },
  };
}

// Resolves to a provider (possibly with ready: false) or null.
export async function findAiProvider() {
  const server = await serverProvider();
  if (server?.ready) return server;
  const viewer = await viewerProvider().catch(() => null);
  return viewer || server;
}
