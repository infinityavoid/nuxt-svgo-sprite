import { promises as fsp } from 'node:fs'
import { addCustomTab, extendServerRpc, onDevToolsInitialized } from '@nuxt/devtools-kit'
import type { BirpcGroup } from 'birpc'
import type { Nuxt } from '@nuxt/schema'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SpriteCollection } from '../types/types'
import type { ClientFunctions, CollectionDTO, ServerFunctions } from './types'

/**
 * Projects internal SpriteCollection[] to the serializable DTO used by DevTools.
 * Exported for unit testing.
 */
export function projectCollections(
  collections: SpriteCollection[],
  injectedCollectionNames: Set<string>,
): CollectionDTO[] {
  return collections.map(col => ({
    name: col.name,
    icons: col.icons.map(icon => ({
      id: icon.id,
      componentName: icon.componentName,
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

function clientHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SVG Sprite</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      background: #0f172a;
      color: #e2e8f0;
      padding: 16px;
    }
    h1 { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #f8fafc; }
    .collection { margin-bottom: 24px; }
    .collection-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid #1e293b;
    }
    .collection-name { font-weight: 600; font-size: 13px; color: #94a3b8; }
    .badge {
      font-size: 11px;
      background: #1e293b;
      border-radius: 4px;
      padding: 1px 6px;
      color: #64748b;
    }
    .injected-badge {
      font-size: 11px;
      background: #14532d;
      border-radius: 4px;
      padding: 1px 6px;
      color: #86efac;
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
      background: #1e293b;
      cursor: pointer;
      transition: background 0.15s;
    }
    .icon-card:hover { background: #273448; }
    .icon-preview {
      width: 32px;
      height: 32px;
      object-fit: contain;
      filter: invert(1);
    }
    .icon-id {
      font-size: 10px;
      color: #64748b;
      text-align: center;
      word-break: break-all;
      line-height: 1.3;
    }
    .icon-card:hover .icon-id { color: #94a3b8; }
    .empty { color: #475569; font-style: italic; }
    #status { color: #64748b; font-size: 12px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <h1>SVG Sprite Collections</h1>
  <div id="status">Connecting…</div>
  <div id="app"></div>
  <script>
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
          var src = '/__nuxt-svgo-sprite/svg/' + encodeURIComponent(col.name) + '/' + encodeURIComponent(icon.id);
          return '<div class="icon-card" title="' + esc(icon.componentName) + '">'
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
 * Handles one request to the /__nuxt-svgo-sprite middleware: the client HTML shell
 * at "/" and raw SVG previews at "/svg/{collection}/{iconId}". Exported (separately
 * from its registration on the Vite dev server) for unit testing.
 */
export function createDevtoolsMiddleware(
  collectionsRef: { current: SpriteCollection[] },
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/'

    if (url === '/' || url === '') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(clientHtml())
      return
    }

    const svgMatch = url.match(/^\/svg\/([^/]+)\/([^/]+)$/)
    if (svgMatch) {
      const colName = decodeURIComponent(svgMatch[1]!)
      const iconId = decodeURIComponent(svgMatch[2]!)
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
): () => Promise<void> {
  let rpc: BirpcGroup<ClientFunctions, ServerFunctions> | undefined

  addCustomTab({
    name: 'nuxt-svgo-sprite',
    title: 'SVG Sprite',
    icon: 'carbon:svg',
    view: { type: 'iframe', src: '/__nuxt-svgo-sprite' },
  })

  onDevToolsInitialized(() => {
    rpc = extendServerRpc<ClientFunctions, ServerFunctions>(
      'NUXT_SVGO_SPRITE',
      {
        getCollections: () =>
          projectCollections(collectionsRef.current, injectedCollectionNames),
      },
    )
  })

  nuxt.hook('vite:serverCreated', (viteServer) => {
    viteServer.middlewares.use('/__nuxt-svgo-sprite', createDevtoolsMiddleware(collectionsRef))
  })

  return async () => {
    await rpc?.broadcast.refresh.asEvent()
  }
}
