// The phone's connection to the Bystander server: one session per incident,
// live state pushed up, call events streamed down.

export async function fetchHealth() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

const EVENTS = ['hello', 'call', 'line', 'relay', 'agent-delta'];

export class Link {
  constructor({ onEvent = () => {}, getIncident }) {
    this.onEvent = onEvent;
    this.getIncident = getIncident;
    this.id = null;
    this.token = null;
    this.source = null;
    this.inFlight = false;
    this.again = false;
    this.timer = null;
  }

  async open() {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ incident: this.getIncident() }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Server error ${res.status}`);
    this.id = body.id;
    this.token = body.token;
    this.source = new EventSource(`/api/sessions/${encodeURIComponent(this.id)}/events?token=${encodeURIComponent(this.token)}`);
    for (const type of EVENTS) {
      this.source.addEventListener(type, (e) => {
        try {
          this.onEvent(type, JSON.parse(e.data));
        } catch (err) {
          console.error('[bystander] bad event', type, err);
        }
      });
    }
    this.source.onerror = () => this.onEvent('connection', { ok: false });
    this.source.onopen = () => this.onEvent('connection', { ok: true });
    this.timer = setInterval(() => this.push(), 1500);
    return this;
  }

  post(action, body) {
    return fetch(`/api/sessions/${encodeURIComponent(this.id)}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-session-token': this.token },
      body: JSON.stringify(body || {}),
    });
  }

  // Sends the latest incident. Calls made while a send is in flight collapse
  // into one follow-up send.
  async push() {
    if (!this.id) return;
    if (this.inFlight) {
      this.again = true;
      return;
    }
    this.inFlight = true;
    try {
      await this.post('state', { incident: this.getIncident() });
    } catch {
      // The next tick retries.
    } finally {
      this.inFlight = false;
      if (this.again) {
        this.again = false;
        this.push();
      }
    }
  }

  async call() {
    const res = await this.post('call');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Could not start the call (${res.status})`);
    return body.call;
  }

  async hangup() {
    if (!this.id) return;
    try {
      await this.post('hangup');
    } catch {
      // Ignore; the call times out on its own.
    }
  }

  close() {
    clearInterval(this.timer);
    this.source?.close();
    this.source = null;
  }
}
