import { promises as fsp } from 'node:fs'
import { addCustomTab, extendServerRpc, onDevToolsInitialized } from '@nuxt/devtools-kit'
import type { BirpcGroup } from 'birpc'
import type { Nuxt } from '@nuxt/schema'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SpriteCollection } from '../types/types'
import type { ClientFunctions, CollectionDTO, ServerFunctions } from './types'

/**
 * Projects internal SpriteCollection[] to the serializable DTO used by DevTools.
 * `componentName` is only included when createUseComponents is on — otherwise no
 * such component was ever registered, and showing one would be misleading.
 * Exported for unit testing.
 */
export function projectCollections(
  collections: SpriteCollection[],
  injectedCollectionNames: Set<string>,
  createUseComponents: boolean,
): CollectionDTO[] {
  return collections.map(col => ({
    name: col.name,
    icons: col.icons.map(icon => ({
      id: icon.id,
      ...(createUseComponents ? { componentName: icon.componentName } : {}),
    })),
    iconCount: col.icons.length,
    injected: injectedCollectionNames.has(col.name),
  }))
}

/**
 * Resolves a preview request (collectionName + iconId) to an absolute file path.
 * Returns null for unknown collection, unknown icon id, or traversal-like inputs.
 * Because collection names and icon ids are derived from sanitized filenames,
 * path traversal is impossible — but the lookup ensures it by construction.
 * Exported for unit testing.
 */
export function resolveIconPreviewPath(
  collectionName: string,
  iconId: string,
  collections: SpriteCollection[],
): string | null {
  const col = collections.find(c => c.name === collectionName)
  if (!col) return null
  const icon = col.icons.find(i => i.id === iconId)
  if (!icon) return null
  return icon.absolutePath
}

/**
 * Joins `path` onto `nuxt.options.app.baseURL`, the same way `@nuxt/devtools` itself
 * builds its own route paths — the DevTools tab iframe `src`, the middleware mount
 * path, and the client's own preview-image URLs must all agree on this, or they
 * silently diverge the moment a host app sets a non-root `baseURL` (e.g. served under
 * a subpath behind a reverse proxy). Exported for unit testing.
 */
export function resolveDevtoolsRoute(nuxt: Nuxt, path: string): string {
  return `${nuxt.options.app.baseURL || '/'}${path}`.replace(/\/+/g, '/')
}

function clientHtml(routePath: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SVG Sprite</title>
  <style>
    :root {
      --bg: #0f172a;
      --fg: #e2e8f0;
      --heading: #f8fafc;
      --border: #1e293b;
      --muted: #94a3b8;
      --badge-bg: #1e293b;
      --badge-fg: #64748b;
      --injected-badge-bg: #14532d;
      --injected-badge-fg: #86efac;
      --card-bg: #1e293b;
      --card-bg-hover: #273448;
      --preview-filter: invert(1);
      --empty-fg: #475569;
    }
    /* This standalone page has no signal from the DevTools UI's own theme toggle, so
       it falls back to the OS-level preference — better than always being dark. */
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #ffffff;
        --fg: #1e293b;
        --heading: #0f172a;
        --border: #e2e8f0;
        --muted: #64748b;
        --badge-bg: #f1f5f9;
        --badge-fg: #475569;
        --injected-badge-bg: #dcfce7;
        --injected-badge-fg: #166534;
        --card-bg: #f8fafc;
        --card-bg-hover: #eef2f7;
        --preview-filter: none;
        --empty-fg: #94a3b8;
      }
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      background: var(--bg);
      color: var(--fg);
      padding: 16px;
    }
    h1 { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: var(--heading); }
    .collection { margin-bottom: 24px; }
    .collection-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border);
    }
    .collection-name { font-weight: 600; font-size: 13px; color: var(--muted); }
    .badge {
      font-size: 11px;
      background: var(--badge-bg);
      border-radius: 4px;
      padding: 1px 6px;
      color: var(--badge-fg);
    }
    .injected-badge {
      font-size: 11px;
      background: var(--injected-badge-bg);
      border-radius: 4px;
      padding: 1px 6px;
      color: var(--injected-badge-fg);
    }
    .icons-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
      gap: 8px;
    }
    .icon-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
      padding: 10px 6px;
      border-radius: 8px;
      background: var(--card-bg);
      cursor: pointer;
      transition: background 0.15s;
    }
    .icon-card:hover { background: var(--card-bg-hover); }
    .icon-preview {
      width: 32px;
      height: 32px;
      object-fit: contain;
      filter: var(--preview-filter);
    }
    .icon-id {
      font-size: 10px;
      color: var(--badge-fg);
      text-align: center;
      word-break: break-all;
      line-height: 1.3;
    }
    .icon-card:hover .icon-id { color: var(--muted); }
    .empty { color: var(--empty-fg); font-style: italic; }
    #status { color: var(--badge-fg); font-size: 12px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <h1>SVG Sprite Collections</h1>
  <div id="status">Connecting…</div>
  <div id="app"></div>
  <script>
    var ROUTE_PATH = ${JSON.stringify(routePath)};
    var rpc = null;

    function connectDevtools(fn) {
      if (window.__NUXT_DEVTOOLS__) { fn(window.__NUXT_DEVTOOLS__); return; }
      var desc = Object.getOwnPropertyDescriptor(window, '__NUXT_DEVTOOLS__');
      Object.defineProperty(window, '__NUXT_DEVTOOLS__', {
        set: function(v) { if (v) fn(v); if (desc && desc.set) desc.set.call(window, v); },
        get: function() { return desc && desc.get ? desc.get.call(window) : undefined; },
        configurable: true,
      });
    }

    function esc(s) {
      // componentPrefix (and therefore componentName) comes from the user's own
      // nuxt.config, not external input, but escaping it before it lands in HTML
      // attribute values (title="...", alt="...") costs nothing and closes the
      // self-inflicted injection path. Quotes must be escaped explicitly — a
      // textContent/innerHTML round-trip does NOT escape " or ', which would break
      // out of a double-quoted attribute.
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function render(collections) {
      var app = document.getElementById('app');
      if (!collections || collections.length === 0) {
        app.innerHTML = '<p class="empty">No collections found.</p>';
        return;
      }
      app.innerHTML = collections.map(function(col) {
        var icons = col.icons.map(function(icon) {
          var src = ROUTE_PATH + '/svg/' + col.name + '/' + icon.id;
          var title = icon.componentName ? esc(icon.componentName) : esc(icon.id);
          return '<div class="icon-card" title="' + title + '">'
            + '<img class="icon-preview" src="' + src + '" alt="' + esc(icon.id) + '" onerror="this.style.opacity=0.2">'
            + '<span class="icon-id">' + esc(icon.id) + '</span>'
            + '</div>';
        }).join('');
        var badges = '<span class="badge">' + col.iconCount + ' icon' + (col.iconCount !== 1 ? 's' : '') + '</span>';
        if (col.injected) badges += ' <span class="injected-badge">auto-injected</span>';
        return '<div class="collection">'
          + '<div class="collection-header"><span class="collection-name">' + esc(col.name) + '</span>' + badges + '</div>'
          + '<div class="icons-grid">' + icons + '</div>'
          + '</div>';
      }).join('');
    }

    connectDevtools(function(client) {
      rpc = client.devtools.extendClientRpc('NUXT_SVGO_SPRITE', {
        refresh: function() {
          rpc.getCollections().then(function(cols) { render(cols); });
        }
      });
      document.getElementById('status').textContent = '';
      rpc.getCollections().then(function(cols) { render(cols); });
    });
  </script>
</body>
</html>`
}

/**
 * Handles one request to the DevTools route (mounted at `routePath`, normally
 * `/__nuxt-svgo-sprite` — see resolveDevtoolsRoute): the client HTML shell at "/" and
 * raw SVG previews at "/svg/{collection}/{iconId}". Exported (separately from its
 * registration on the Vite dev server) for unit testing.
 */
export function createDevtoolsMiddleware(
  collectionsRef: { current: SpriteCollection[] },
  routePath = '/__nuxt-svgo-sprite',
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/'

    if (url === '/' || url === '') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(clientHtml(routePath))
      return
    }

    const svgMatch = url.match(/^\/svg\/([^/]+)\/([^/]+)$/)
    if (svgMatch) {
      // Collection names and icon ids are always [A-Za-z0-9-] by construction (see
      // resolveIconPreviewPath's docstring), so no URL encoding round-trip is needed
      // here — decoding would only add a URIError throw path for malformed input.
      const colName = svgMatch[1]!
      const iconId = svgMatch[2]!
      const absPath = resolveIconPreviewPath(colName, iconId, collectionsRef.current)
      if (absPath) {
        fsp.readFile(absPath, 'utf-8')
          .then((content) => {
            res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
            // Previews are re-fetched by URL after every rebuild broadcast; caching
            // them would keep showing a stale icon after an edit until a hard refresh.
            res.setHeader('Cache-Control', 'no-cache')
            res.end(content)
          })
          .catch(() => {
            res.statusCode = 404
            res.end()
          })
        return
      }
    }

    res.statusCode = 404
    res.end()
  }
}

/**
 * Registers the Nuxt DevTools tab, RPC channel, and preview middleware.
 * Must only be called when nuxt.options.dev is true.
 * Returns a broadcastRefresh function to call after a collection rebuild.
 */
export function setupDevtools(
  nuxt: Nuxt,
  collectionsRef: { current: SpriteCollection[] },
  injectedCollectionNames: Set<string>,
  createUseComponents: boolean,
): () => Promise<void> {
  let rpc: BirpcGroup<ClientFunctions, ServerFunctions> | undefined

  // Computed once and reused for the tab iframe src, the middleware mount path, and
  // (embedded into clientHtml) the client's own preview-image URLs — all three MUST
  // agree, or they silently diverge under a non-root app.baseURL. Same
  // join-and-collapse-slashes pattern @nuxt/devtools itself uses for its own routes.
  const routePath = resolveDevtoolsRoute(nuxt, '/__nuxt-svgo-sprite')

  addCustomTab({
    name: 'nuxt-svgo-sprite',
    title: 'SVG Sprite',
    icon: 'carbon:svg',
    view: { type: 'iframe', src: routePath },
  })

  onDevToolsInitialized(() => {
    rpc = extendServerRpc<ClientFunctions, ServerFunctions>(
      'NUXT_SVGO_SPRITE',
      {
        getCollections: () =>
          projectCollections(collectionsRef.current, injectedCollectionNames, createUseComponents),
      },
    )
  })

  nuxt.hook('vite:serverCreated', (viteServer, { isClient }) => {
    // vite:serverCreated fires once per Vite server Nuxt creates — the client build,
    // the SSR build, and (under experimental.viteEnvironmentApi) potentially a third
    // — up to 3 times per dev server start. The DevTools preview middleware only
    // needs to exist on the client server, which is the one that actually serves
    // browser requests for routePath.
    if (!isClient) return
    viteServer.middlewares.use(routePath, createDevtoolsMiddleware(collectionsRef, routePath))
  })

  return async () => {
    await rpc?.broadcast.refresh.asEvent()
  }
}
