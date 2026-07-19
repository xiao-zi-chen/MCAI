package com.kya.pvprobo.monitoring;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.plugin.Plugin;

public final class MonitoringServer implements AutoCloseable {
    private static final Gson GSON = new GsonBuilder().create();

    private final Plugin plugin;
    private final MonitoringStore store;
    private final RecordingCatalog recordingCatalog;
    private final Logger logger;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private HttpServer server;

    public MonitoringServer(Plugin plugin, MonitoringStore store, RecordingCatalog recordingCatalog) {
        this.plugin = plugin;
        this.store = store;
        this.recordingCatalog = recordingCatalog;
        this.logger = plugin.getLogger();
    }

    public void start() {
        if (!plugin.getConfig().getBoolean("monitoring.enabled", true)) {
            return;
        }
        try {
            String host = plugin.getConfig().getString("monitoring.host", "127.0.0.1");
            int port = plugin.getConfig().getInt("monitoring.port", 25582);
            InetAddress address = InetAddress.getByName(host);
            server = HttpServer.create(new InetSocketAddress(address, port), 50);
            server.createContext("/", this::handle);
            server.setExecutor(executor);
            server.start();
            logger.info("PVPRobo monitoring dashboard listening on http://" + host + ":" + port + "/");
        } catch (IOException | RuntimeException exc) {
            logger.log(Level.SEVERE, "PVPRobo monitoring server failed", exc);
        }
    }

    private void handle(HttpExchange exchange) throws IOException {
        try {
            String path = exchange.getRequestURI().getPath();
            if (!authorized(exchange)) {
                sendText(exchange, 401, "Unauthorized\n", "text/plain; charset=utf-8");
                return;
            }
            switch (path) {
                case "/", "/index.html" -> sendText(exchange, 200, dashboardHtml(), "text/html; charset=utf-8");
                case "/api/summary" -> sendJson(exchange, store.summary());
                case "/api/player-history" -> sendJson(exchange, Map.of("samples", store.playerHistory()));
                case "/api/recordings" -> sendJson(exchange, recordingCatalog.scan());
                case "/api/status" -> sendJson(exchange, status());
                default -> sendText(exchange, 404, "Not found\n", "text/plain; charset=utf-8");
            }
        } finally {
            exchange.close();
        }
    }

    private Map<String, Object> status() {
        Map<String, Object> status = new LinkedHashMap<>();
        status.put("summary", store.summary());
        status.put("player_history", store.playerHistory());
        status.put("recordings", recordingCatalog.scan());
        return status;
    }

    private boolean authorized(HttpExchange exchange) {
        String token = plugin.getConfig().getString("monitoring.auth-token", "");
        if (token == null || token.isBlank()) {
            return true;
        }
        String header = exchange.getRequestHeaders().getFirst("X-PVPRobo-Token");
        if (token.equals(header)) {
            return true;
        }
        String query = exchange.getRequestURI().getRawQuery();
        return query != null && query.contains("token=" + token);
    }

    private void sendJson(HttpExchange exchange, Object body) throws IOException {
        sendText(exchange, 200, GSON.toJson(body), "application/json; charset=utf-8");
    }

    private void sendText(HttpExchange exchange, int status, String body, String contentType) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", contentType);
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private String dashboardHtml() {
        return """
            <!doctype html>
            <html lang="en">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <title>PVPRobo Monitoring</title>
              <style>
                :root { color-scheme: light; --ink:#17202a; --muted:#64748b; --line:#d7dee8; --panel:#f8fafc; --panel2:#eef6f3; --accent:#087f5b; --accent2:#2563eb; --warn:#9a3412; --bad:#b91c1c; }
                * { box-sizing: border-box; }
                body { margin:0; font:14px/1.45 system-ui, -apple-system, Segoe UI, sans-serif; color:var(--ink); background:#ffffff; }
                header { padding:18px 24px 14px; border-bottom:1px solid var(--line); display:flex; align-items:end; justify-content:space-between; gap:16px; }
                h1 { margin:0; font-size:22px; letter-spacing:0; }
                main { padding:20px 24px; display:grid; gap:18px; }
                .toolbar { display:flex; align-items:center; gap:10px; color:var(--muted); flex-wrap:wrap; }
                .dot { width:9px; height:9px; border-radius:999px; background:var(--accent); display:inline-block; }
                .metrics { display:grid; grid-template-columns:repeat(4, minmax(130px, 1fr)); gap:12px; }
                .metric, section { border:1px solid var(--line); border-radius:8px; background:var(--panel); }
                .metric { padding:12px; min-height:104px; display:grid; gap:8px; }
                .label { color:var(--muted); font-size:12px; text-transform:uppercase; }
                .value { font-size:28px; font-weight:700; margin-top:4px; }
                .bar { height:9px; border-radius:999px; background:#dbe4ee; overflow:hidden; }
                .bar > span { display:block; height:100%; width:0%; background:var(--accent); transition:width .25s ease; }
                .bar.backend > span { background:var(--accent2); }
                .grid { display:grid; grid-template-columns:minmax(0, 1.5fr) minmax(280px, .8fr); gap:18px; align-items:start; }
                section { padding:14px; overflow:hidden; }
                h2 { margin:0 0 10px; font-size:16px; }
                canvas { width:100%; height:220px; border:1px solid var(--line); border-radius:6px; background:#fff; display:block; }
                .duel-card { display:grid; gap:10px; }
                .phase-pill { width:max-content; max-width:100%; padding:5px 9px; border-radius:999px; background:#dceee8; color:var(--accent); font-weight:700; }
                .kv { display:grid; grid-template-columns:100px minmax(0, 1fr); gap:8px; }
                .kv div:nth-child(odd) { color:var(--muted); }
                .players { display:flex; gap:8px; flex-wrap:wrap; }
                .chip { border:1px solid var(--line); border-radius:999px; background:#fff; padding:5px 9px; }
                .record-bars { display:grid; gap:8px; }
                .record-row { display:grid; grid-template-columns:minmax(110px, 1fr) 90px; gap:10px; align-items:center; }
                .hint { margin-top:8px; color:var(--muted); font-size:12px; }
                table { width:100%; border-collapse:collapse; background:#fff; border-radius:6px; overflow:hidden; }
                th, td { padding:8px 10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
                th { color:var(--muted); font-weight:600; font-size:12px; }
                code { font-family:ui-monospace, SFMono-Regular, Consolas, monospace; font-size:12px; }
                .muted { color:var(--muted); }
                .ok { color:var(--accent); font-weight:700; }
                .warn { color:var(--warn); font-weight:700; }
                @media (max-width: 900px) { .grid { grid-template-columns:1fr; } }
                @media (max-width: 760px) { header { align-items:start; flex-direction:column; } .metrics { grid-template-columns:repeat(2, 1fr); } main { padding:14px; } .kv { grid-template-columns:82px minmax(0, 1fr); } }
              </style>
            </head>
            <body>
              <header><h1>PVPRobo Monitoring</h1><div class="toolbar"><span class="dot"></span><span id="stamp">Connecting</span><span id="domain"></span></div></header>
              <main>
                <div class="metrics">
                  <div class="metric"><div class="label">Human Slots</div><div id="human-slots" class="value">-</div><div class="bar"><span id="human-bar"></span></div></div>
                  <div class="metric"><div class="label">Backend Online</div><div id="backend-online" class="value">-</div><div class="bar backend"><span id="backend-bar"></span></div><div class="muted" id="capacity-note">-</div></div>
                  <div class="metric"><div class="label">Duel Phase</div><div id="phase" class="value">-</div><div class="muted" id="duel-mode">-</div></div>
                  <div class="metric"><div class="label">Recorded Steps</div><div id="steps" class="value">-</div><div class="muted" id="episodes">-</div></div>
                </div>
                <div class="grid">
                  <section><h2>Player History</h2><canvas id="chart" width="1200" height="260"></canvas><div class="hint">Line shows public human players; backend bot accounts are excluded.</div></section>
                  <section class="duel-card"><h2>Active Duel</h2><div id="phase-pill" class="phase-pill">-</div><div class="kv"><div>Mode</div><div id="duel-mode-full">-</div><div>Episode</div><div><code id="episode-id">-</code></div><div>Winner</div><div id="winner">-</div><div>Hits</div><div id="hits">-</div></div></section>
                </div>
                <section><h2>Current Players</h2><div id="players" class="players"></div></section>
                <div class="grid">
                  <section><h2>Recording Volume</h2><div id="recording-meta" class="muted"></div><div id="record-bars" class="record-bars"></div></section>
                  <section><h2>Dataset Health</h2><div class="kv"><div>Manifest</div><div id="manifest">-</div><div>Episodes</div><div id="episode-count">-</div><div>Directory</div><div><code id="record-dir">-</code></div></div></section>
                </div>
                <section><h2>Recent Recordings</h2><table><thead><tr><th>Episode</th><th>Mode</th><th>Difficulty</th><th>Steps</th><th>Actors</th><th>Files</th></tr></thead><tbody id="recordings"></tbody></table></section>
              </main>
              <script>
                async function get(path) { const response = await fetch(path, {cache:'no-store'}); if (!response.ok) throw new Error(path); return response.json(); }
                function text(id, value) { document.getElementById(id).textContent = value; }
                function pct(value, max) { return Math.max(0, Math.min(100, max <= 0 ? 0 : (value / max) * 100)); }
                function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
                function niceMax(value) {
                  const raw = Math.max(1, Math.ceil(value));
                  if (raw <= 3) return 3;
                  if (raw <= 5) return 5;
                  if (raw <= 10) return 10;
                  return Math.ceil(raw / 5) * 5;
                }
                function timeLabel(value) {
                  const date = new Date(value);
                  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
                }
                function draw(samples) {
                  const canvas = document.getElementById('chart'); const ctx = canvas.getContext('2d');
                  ctx.clearRect(0,0,canvas.width,canvas.height);
                  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
                  const values = samples.map(s => Number(s.public_human_players ?? s.online_players ?? 0));
                  const max = niceMax(Math.max(0, ...values));
                  const left = 54; const right = canvas.width - 18; const top = 24; const bottom = 216; const height = bottom - top;
                  ctx.strokeStyle = '#d7dee8'; ctx.lineWidth = 1; ctx.fillStyle = '#64748b'; ctx.font = '13px system-ui';
                  for (let i=0;i<=max;i++) { const y = bottom - height * i / max; ctx.beginPath(); ctx.moveTo(left,y); ctx.lineTo(right,y); ctx.stroke(); ctx.fillText(String(i), 20, y + 4); }
                  ctx.strokeStyle = '#93a4b8'; ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, bottom); ctx.lineTo(right, bottom); ctx.stroke();
                  const tickCount = Math.min(4, Math.max(0, samples.length - 1));
                  for (let i=0;i<=tickCount;i++) { const idx = tickCount === 0 ? samples.length - 1 : Math.round((samples.length - 1) * i / tickCount); const x = left + (right-left) * (tickCount === 0 ? 0 : i/tickCount); ctx.fillText(timeLabel(samples[idx]?.timestamp), Math.min(x, right - 54), 244); }
                  const points = samples.map((s, i) => ({x: left + (right-left) * (samples.length <= 1 ? 0 : i/(samples.length-1)), y: bottom - height * Number(s.public_human_players ?? s.online_players ?? 0) / max}));
                  if (points.length) {
                    ctx.beginPath(); ctx.moveTo(points[0].x, bottom); points.forEach(p => ctx.lineTo(p.x, p.y)); ctx.lineTo(points[points.length - 1].x, bottom); ctx.closePath(); ctx.fillStyle = 'rgba(8,127,91,.12)'; ctx.fill();
                    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y)); ctx.strokeStyle = '#087f5b'; ctx.lineWidth = 3; ctx.stroke();
                    ctx.fillStyle = '#087f5b'; points.slice(-18).forEach(p => { ctx.beginPath(); ctx.arc(p.x,p.y,3,0,Math.PI*2); ctx.fill(); });
                  }
                }
                function files(ep) { return (ep.npz_exists && ep.jsonl_exists) ? '<span class="ok">complete</span>' : '<span class="warn">missing</span>'; }
                function renderPlayers(players) { document.getElementById('players').innerHTML = players.length ? players.map(p => `<span class="chip">${escapeHtml(p)}</span>`).join('') : '<span class="muted">No players online</span>'; }
                function renderHits(hitCounts) { return Object.entries(hitCounts || {}).map(([name, hits]) => `${escapeHtml(name)} ${hits}`).join(' | ') || '-'; }
                function renderRecordBars(episodes) {
                  const recent = [...episodes].slice(-8).reverse(); const max = Math.max(1, ...recent.map(ep => Number(ep.steps || 0)));
                  document.getElementById('record-bars').innerHTML = recent.length ? recent.map(ep => `<div class="record-row"><div><code>${escapeHtml(ep.episode_id || '-')}</code><div class="bar"><span style="width:${pct(Number(ep.steps || 0), max)}%"></span></div></div><div>${Number(ep.steps || 0)} steps</div></div>`).join('') : '<div class="muted">No recorded episodes yet</div>';
                }
                async function refresh() {
                  const [summary, history, recordings] = await Promise.all([get('/api/summary'), get('/api/player-history'), get('/api/recordings')]);
                  const online = Number(summary.online_players || 0); const maxPlayers = Number(summary.max_players || 0); const humans = Number(summary.public_human_players || 0); const maxHumans = Number(summary.max_human_players || 0); const duel = summary.duel || {}; const episodes = recordings.episodes || [];
                  text('stamp', 'Updated ' + new Date().toLocaleTimeString()); text('domain', summary.server_domain || ''); text('human-slots', maxHumans > 0 ? `${humans}/${maxHumans}` : humans); text('backend-online', online);
                  text('capacity-note', `${online}/${maxPlayers || 0} backend slots; bots ${summary.bot_players || 0}`); document.getElementById('human-bar').style.width = pct(humans, maxHumans || 1) + '%'; document.getElementById('backend-bar').style.width = pct(online, maxPlayers || 1) + '%';
                  text('phase', duel.phase || '-'); text('duel-mode', duel.active ? (duel.mode || '-') : 'idle'); text('duel-mode-full', duel.mode || '-'); text('phase-pill', duel.phase || 'idle');
                  text('episode-id', duel.episode_id || '-'); text('winner', duel.winner || '-'); text('hits', renderHits(duel.hit_counts)); text('steps', recordings.total_steps || 0); text('episodes', `${recordings.episode_count || 0} episodes`);
                  text('manifest', recordings.manifest_present ? 'present' : 'missing'); text('episode-count', recordings.episode_count || 0); text('record-dir', recordings.directory || '-');
                  document.getElementById('recording-meta').textContent = `Total steps ${recordings.total_steps || 0}; source ${recordings.record_source || '-'}`;
                  renderPlayers(summary.players || []); renderRecordBars(episodes);
                  document.getElementById('recordings').innerHTML = episodes.slice(-25).reverse().map(ep => `<tr><td><code>${escapeHtml(ep.episode_id || '-')}</code></td><td>${escapeHtml(ep.mode || '-')}</td><td>${escapeHtml(ep.difficulty || '-')}</td><td>${Number(ep.steps || 0)}</td><td>${(ep.actors || []).map(a => escapeHtml(a.name) + ':' + escapeHtml(a.role)).join('<br>')}</td><td>${files(ep)}</td></tr>`).join('');
                  draw(history.samples || []);
                }
                refresh().catch(console.error); setInterval(() => refresh().catch(console.error), 5000);
              </script>
            </body>
            </html>
            """;
    }

    @Override
    public void close() {
        if (server != null) {
            server.stop(0);
            server = null;
        }
        executor.shutdownNow();
    }
}
