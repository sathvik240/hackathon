// In-memory incident sessions and their live event streams (Server-Sent
// Events). One session per emergency or training run. The bystander's phone
// listens to its own session; dispatcher consoles listen to all of them.

import crypto from 'node:crypto';
import { sanitizeIncident } from '../public/js/core/incident.js';

const IDLE_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_TRANSCRIPT = 200;

export const newId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

export function openStream(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  res.on('close', () => clearInterval(ping));
}

export function sendEvent(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

export class SessionStore {
  constructor() {
    this.sessions = new Map();
    this.dispatchers = new Set();
  }

  create(incident) {
    const session = {
      id: newId(),
      token: newId(18),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      incident: { ...sanitizeIncident(incident), receivedAt: Date.now() },
      transcript: [],
      call: { status: 'idle', transport: null },
      seenReports: new Set(),
      pendingUpdates: [],
      listeners: new Set(),
      voice: null,
      turn: null,
    };
    this.sessions.set(session.id, session);
    this.sweep();
    return session;
  }

  get(id) {
    return typeof id === 'string' ? this.sessions.get(id) || null : null;
  }

  authorize(id, token) {
    const session = this.get(id);
    return session && safeEqual(session.token, token) ? session : null;
  }

  update(session, incident) {
    session.incident = { ...sanitizeIncident(incident), receivedAt: Date.now() };
    session.updatedAt = Date.now();
    this.emit(session, 'state', { incident: session.incident });
  }

  addLine(session, who, text, id = newId(6)) {
    const line = { id, who, text, at: Date.now() };
    session.transcript.push(line);
    if (session.transcript.length > MAX_TRANSCRIPT) session.transcript.shift();
    this.emit(session, 'line', line);
    return line;
  }

  setCall(session, patch) {
    session.call = { ...session.call, ...patch };
    session.updatedAt = Date.now();
    this.emit(session, 'call', { call: publicCall(session.call), incident: session.incident });
  }

  emit(session, type, data) {
    for (const res of session.listeners) sendEvent(res, type, data);
    if (session.incident.mode !== 'emergency') return;
    for (const res of this.dispatchers) sendEvent(res, type, { sessionId: session.id, ...data });
  }

  listen(session, res) {
    openStream(res);
    session.listeners.add(res);
    res.on('close', () => session.listeners.delete(res));
    sendEvent(res, 'hello', summary(session));
  }

  listenAll(res) {
    openStream(res);
    this.dispatchers.add(res);
    res.on('close', () => this.dispatchers.delete(res));
    const active = [...this.sessions.values()]
      .filter((s) => s.incident.mode === 'emergency')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5)
      .map(summary);
    sendEvent(res, 'hello', { sessions: active });
  }

  sweep(now = Date.now()) {
    for (const [id, s] of this.sessions) {
      if (now - s.updatedAt > IDLE_TTL_MS) {
        for (const res of s.listeners) res.end();
        this.sessions.delete(id);
      }
    }
  }
}

export function publicCall(call) {
  const { key, ...rest } = call;
  return rest;
}

export function summary(session) {
  return {
    sessionId: session.id,
    incident: session.incident,
    call: publicCall(session.call),
    transcript: session.transcript.slice(-40),
  };
}
