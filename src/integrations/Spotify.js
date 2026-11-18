/**
 * Spotify.js
 * Conector do Spotify para o jogador ouvir a própria música enquanto joga.
 *
 * Login: OAuth 2.0 "Authorization Code + PKCE" direto no navegador (sem servidor e
 * sem segredo). O jogador cria um app grátis em developer.spotify.com e cola o
 * Client ID na aba Spotify das Configurações.
 *   Redirect URI do app: http://127.0.0.1:8080/  (o Spotify não aceita "localhost")
 *
 * Reprodução:
 *  - Premium: Web Playback SDK — o jogo vira um aparelho do Spotify e toca aqui.
 *  - Sem Premium: controle remoto (Web API) do Spotify aberto no PC/celular.
 * Extras: lista de playlists, faixa atual com capa, volume, e (opcional) troca
 * automática para uma playlist de batalha nas lutas com chefes.
 */
const AUTH = 'https://accounts.spotify.com/authorize';
const TOKEN = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const SCOPES = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state playlist-read-private';
const LS = (k, v) => (v === undefined ? localStorage.getItem('spotify.' + k) : v === null ? localStorage.removeItem('spotify.' + k) : localStorage.setItem('spotify.' + k, v));

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export class Spotify {
  constructor({ panel, audio, hud }) {
    this.panel = panel;
    this.audio = audio;
    this.hud = hud;
    this.clientId = LS('clientId') || '';
    this.battlePlaylist = LS('battle') || '';
    this.autoBattle = LS('autoBattle') === '1';
    this.player = null;
    this.deviceId = null;
    this.state = null;
    /** Vai para a página de login do Spotify (substituível em testes). */
    this.navigate = (u) => { location.href = u; };
    this._render();
  }

  get redirectUri() { return `${location.origin}${location.pathname}`; }
  get token() { return LS('access'); }
  get connected() { return !!this.token; }

  // ---------------------------------------------------------------------------
  // OAuth PKCE
  // ---------------------------------------------------------------------------
  async login() {
    if (!this.clientId) { this._msg('Cole o Client ID primeiro.'); return; }
    if (location.hostname === 'localhost') { this._msg('Abra o jogo em http://127.0.0.1:8080 (o Spotify não aceita "localhost").'); return; }
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(64)));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    LS('verifier', verifier);
    const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
    LS('state', state);
    const url = `${AUTH}?${new URLSearchParams({ client_id: this.clientId, response_type: 'code', redirect_uri: this.redirectUri, code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES, state })}`;
    this.lastAuthUrl = url;
    this.navigate(url);
  }

  /** Chamado no carregamento: troca o ?code= da volta do login por tokens. */
  async handleRedirect() {
    const q = new URLSearchParams(location.search);
    const code = q.get('code'), err = q.get('error');
    if (!code && !err) return false;
    history.replaceState(null, '', this.redirectUri);
    if (err) { this._msg(`Login cancelado (${err}).`); return false; }
    if (q.get('state') !== LS('state')) { this._msg('Falha de segurança no login (state).'); return false; }
    const r = await fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, code_verifier: LS('verifier') }) });
    if (!r.ok) { this._msg(`Erro no login: ${r.status}`); return false; }
    this._store(await r.json());
    this.hud?.toast('🎵 Spotify conectado!', 2);
    return true;
  }

  _store(t) {
    LS('access', t.access_token);
    if (t.refresh_token) LS('refresh', t.refresh_token);
    LS('expires', String(Date.now() + (t.expires_in - 60) * 1000));
  }

  async _fresh() {
    if (!this.token) return null;
    if (Date.now() < +LS('expires')) return this.token;
    const r = await fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, grant_type: 'refresh_token', refresh_token: LS('refresh') }) });
    if (!r.ok) { this.logout(); return null; }
    this._store(await r.json());
    return this.token;
  }

  logout() {
    for (const k of ['access', 'refresh', 'expires']) LS(k, null);
    this.player?.disconnect();
    this.player = null; this.deviceId = null;
    this.audio?.duckMusic(false);
    this._render();
  }

  async api(path, opts = {}) {
    const tk = await this._fresh();
    if (!tk) throw new Error('não conectado');
    const r = await fetch(API + path, { ...opts, headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    if (r.status === 204) return null;
    if (!r.ok) throw new Error(`${r.status}`);
    return r.headers.get('content-type')?.includes('json') ? r.json() : null;
  }

  // ---------------------------------------------------------------------------
  // Reprodução
  // ---------------------------------------------------------------------------
  async start() {
    if (!this.connected) { this._render(); return; }
    try {
      this.me = await this.api('/me');
      this.premium = this.me.product === 'premium';
      if (this.premium) await this._initSdk();
      this.playlists = (await this.api('/me/playlists?limit=30')).items || [];
    } catch (e) { this._msg(`Spotify: ${e.message}`); }
    this._render();
    clearInterval(this._poll);
    this._poll = setInterval(() => this.refreshState(), 5000);
    this.refreshState();
  }

  _initSdk() {
    return new Promise((resolve) => {
      window.onSpotifyWebPlaybackSDKReady = () => {
        this.player = new window.Spotify.Player({ name: 'Arquipélago (jogo)', getOAuthToken: async (cb) => cb(await this._fresh()), volume: 0.6 });
        this.player.addListener('ready', ({ device_id }) => { this.deviceId = device_id; this._render(); resolve(); });
        this.player.addListener('player_state_changed', (s) => { this.sdkState = s; this._renderTrack(); });
        this.player.addListener('authentication_error', () => this.logout());
        this.player.connect();
        setTimeout(resolve, 6000);
      };
      if (!document.getElementById('spotify-sdk')) {
        const sc = document.createElement('script');
        sc.id = 'spotify-sdk'; sc.src = 'https://sdk.scdn.co/spotify-player.js';
        document.head.appendChild(sc);
      } else window.onSpotifyWebPlaybackSDKReady();
    });
  }

  async refreshState() {
    if (!this.connected) return;
    try { this.state = await this.api('/me/player'); } catch { this.state = null; }
    this.audio?.duckMusic(!!this.state?.is_playing);
    this._renderTrack();
  }

  _dev() { return this.deviceId ? `?device_id=${this.deviceId}` : ''; }
  async toggle() { await this.api(`/me/player/${this.state?.is_playing ? 'pause' : 'play'}${this._dev()}`, { method: 'PUT' }).catch((e) => this._msg(this._noDevice(e))); setTimeout(() => this.refreshState(), 400); }
  async next() { await this.api(`/me/player/next${this._dev()}`, { method: 'POST' }).catch(() => {}); setTimeout(() => this.refreshState(), 500); }
  async prev() { await this.api(`/me/player/previous${this._dev()}`, { method: 'POST' }).catch(() => {}); setTimeout(() => this.refreshState(), 500); }
  async volume(v) { await this.api(`/me/player/volume?volume_percent=${Math.round(v * 100)}${this._dev() ? '&' + this._dev().slice(1) : ''}`, { method: 'PUT' }).catch(() => {}); }
  async playPlaylist(uri) {
    await this.api(`/me/player/play${this._dev()}`, { method: 'PUT', body: JSON.stringify({ context_uri: uri }) }).catch((e) => this._msg(this._noDevice(e)));
    setTimeout(() => this.refreshState(), 600);
  }
  _noDevice(e) { return /404/.test(e.message) ? 'Abra o Spotify em algum aparelho (ou use Premium para tocar no jogo).' : `Spotify: ${e.message}`; }

  /** Lutas com chefes: troca para a playlist de batalha (opcional). */
  setBattle(on) {
    if (!this.connected || !this.autoBattle || !this.battlePlaylist || on === this._battle) return;
    this._battle = on;
    if (on) { this._before = this.state?.context?.uri; this.playPlaylist(this.battlePlaylist); }
    else if (this._before) this.playPlaylist(this._before);
  }

  // ---------------------------------------------------------------------------
  // Interface (aba Spotify das Configurações)
  // ---------------------------------------------------------------------------
  _msg(t) { this.message = t; const m = this.panel?.querySelector('.sp-msg'); if (m) m.textContent = t; }

  _render() {
    const p = this.panel; if (!p) return;
    const pl = (this.playlists || []).map((x) => `<option value="${x.uri}">${x.name.replace(/</g, '')}</option>`).join('');
    p.innerHTML = this.connected ? `
      <div class="sp-head">🎵 Conectado${this.me ? ` como <b>${this.me.display_name || this.me.id}</b>` : ''} · ${this.premium ? (this.deviceId ? 'tocando no jogo (Premium)' : 'Premium – iniciando player…') : 'controle remoto (sem Premium)'}</div>
      <div class="sp-now"><img class="sp-cover" alt=""><div><div class="sp-track">—</div><div class="sp-artist"></div></div></div>
      <div class="row"><button data-sp="prev">⏮</button><button data-sp="toggle">⏯</button><button data-sp="next">⏭</button>
        <input type="range" min="0" max="1" step="0.05" value="0.6" data-sp="vol" title="Volume do Spotify"></div>
      <div class="row"><label>Tocar playlist</label><select data-sp="pl"><option value="">— escolha —</option>${pl}</select></div>
      <div class="row"><label>Playlist de batalha</label><select data-sp="battle"><option value="">— nenhuma —</option>${pl}</select></div>
      <div class="row"><label><input type="checkbox" data-sp="auto" ${this.autoBattle ? 'checked' : ''}> Trocar para a playlist de batalha nas lutas com chefes</label></div>
      <div class="row"><button data-sp="logout" class="danger">Desconectar</button></div>
      <p class="tip sp-msg">${this.message || ''}</p>`
      : `
      <p>Conecte sua conta do Spotify para ouvir suas músicas enquanto joga.</p>
      <ol class="tip">
        <li>Acesse <b>developer.spotify.com/dashboard</b> e clique em <b>Create app</b>.</li>
        <li>Em <b>Redirect URI</b> coloque: <code>http://127.0.0.1:8080/</code></li>
        <li>Marque <b>Web API</b> e <b>Web Playback SDK</b> e salve.</li>
        <li>Copie o <b>Client ID</b> e cole abaixo.</li>
        <li>Abra o jogo pelo endereço <b>http://127.0.0.1:8080</b> e clique em Conectar.</li>
      </ol>
      <div class="row"><label>Client ID</label><input type="text" data-sp="cid" value="${this.clientId}" placeholder="ex.: 1a2b3c4d…" style="flex:1"></div>
      <div class="row"><button data-sp="login">🎵 Conectar Spotify</button></div>
      <p class="tip">Com <b>Premium</b> a música toca dentro do jogo. Sem Premium, o jogo controla o Spotify aberto no seu PC ou celular.</p>
      <p class="tip sp-msg">${this.message || ''}</p>`;
    const q = (k) => p.querySelector(`[data-sp="${k}"]`);
    q('cid')?.addEventListener('change', (e) => { this.clientId = e.target.value.trim(); LS('clientId', this.clientId); });
    q('login')?.addEventListener('click', () => { const c = q('cid'); if (c) { this.clientId = c.value.trim(); LS('clientId', this.clientId); } this.login(); });
    q('logout')?.addEventListener('click', () => this.logout());
    q('toggle')?.addEventListener('click', () => this.toggle());
    q('next')?.addEventListener('click', () => this.next());
    q('prev')?.addEventListener('click', () => this.prev());
    q('vol')?.addEventListener('change', (e) => (this.player ? this.player.setVolume(+e.target.value) : this.volume(+e.target.value)));
    q('pl')?.addEventListener('change', (e) => e.target.value && this.playPlaylist(e.target.value));
    const b = q('battle'); if (b) { b.value = this.battlePlaylist; b.addEventListener('change', (e) => { this.battlePlaylist = e.target.value; LS('battle', this.battlePlaylist); }); }
    q('auto')?.addEventListener('change', (e) => { this.autoBattle = e.target.checked; LS('autoBattle', this.autoBattle ? '1' : '0'); });
    this._renderTrack();
  }

  _renderTrack() {
    const p = this.panel; if (!p || !this.connected) return;
    const item = this.sdkState?.track_window?.current_track || this.state?.item;
    const t = p.querySelector('.sp-track'), a = p.querySelector('.sp-artist'), img = p.querySelector('.sp-cover');
    if (!t) return;
    t.textContent = item ? item.name : 'Nada tocando';
    a.textContent = item ? (item.artists || []).map((x) => x.name).join(', ') : '';
    const src = item?.album?.images?.[0]?.url;
    if (img) { img.src = src || ''; img.style.visibility = src ? 'visible' : 'hidden'; }
  }
}
