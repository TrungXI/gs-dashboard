import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const token = sp.get('token') ?? '69-940214f0e803120fcfc9183ee4df89d5';
  const eventId = sp.get('eventId') ?? '';
  const leagueId = sp.get('leagueId') ?? '';
  const t = sp.get('t') ?? String(Date.now());
  const agentId = token.split('-')[0] ?? '69';

  const upstream =
    `https://zenandfe.com/?token=${encodeURIComponent(token)}&agentId=${agentId}` +
    `&lng=vi&eventId=${eventId}&leagueId=${leagueId}&sportId=1` +
    `&loginUrl=https%3A%2F%2Fhdbet.pub%2F%3Fmodal%3DLOGIN` +
    `&registerUrl=https%3A%2F%2Fhdbet.pub%2F%3Fmodal%3DSIGN_UP&gamePart=2&t=${t}`;

  try {
    const res = await fetch(upstream, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi,en;q=0.5',
        Referer: 'https://zenandfe.com/',
      },
      cache: 'no-store',
    });

    if (!res.ok) return new Response(`Upstream ${res.status}`, { status: 502 });

    let html = await res.text();

    // Absolute base URL for the proxy so injected JS can call /api/gs-backend
    const origin = `${req.nextUrl.protocol}//${req.nextUrl.host}`;

    // Intercept be.sb21.net API calls → route through /api/gs-backend (bypasses CORS)
    const jsIntercept = `<script id="__gs_intercept">
(function(){
  var BE='https://be.sb21.net', PX='${origin}/api/gs-backend';
  var _f=window.fetch.bind(window);
  window.fetch=function(u,o){
    if(typeof u==='string'&&u.startsWith(BE)) u=PX+u.slice(BE.length);
    else if(u&&u.url&&u.url.startsWith(BE)) u=new Request(PX+u.url.slice(BE.length),u);
    return _f(u,o);
  };
  var _o=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    if(typeof u==='string'&&u.startsWith(BE)) u=PX+u.slice(BE.length);
    return _o.apply(this,arguments);
  };
})();
</script>`;

    // CSS: hide everything, make .visibility cover the full viewport
    const cssInject = `<style id="__gs_visibility">
html,body{margin:0;padding:0;overflow:hidden;background:#000;width:100vw;height:100vh;}
.wrapper-header,.wraper-left,.match-component,.wrap-border-first-match,
.handicap-match-header,.med-match-header{display:none!important;}
.container-fluid,.row,.wraper-right,.sport-detail-container,.sport-detail-component,
.main-content,.main-wapper{width:100%!important;height:100vh!important;max-width:none!important;padding:0!important;margin:0!important;overflow:hidden!important;}
.visibility{position:fixed!important;top:0!important;left:0!important;bottom:0!important;right:0!important;width:100vw!important;height:100vh!important;z-index:99999!important;display:block!important;background:#000;}
.match-live-streaming,.soccer-live-streaming,.live-stream-video,
.iframe-live,#iframeVideo,.gsVideoLive,.gsVideoDetail,
.ant-media-player-container,.video-container,.video-js,video{width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;}
</style>`;

    // 1. Add <base> so all relative asset URLs resolve to zenandfe.com
    html = html.replace('<head>', '<head>\n<base href="https://zenandfe.com/">\n');
    // 2. Inject intercept script before any other script runs
    html = html.replace('<head>', `<head>\n${jsIntercept}\n`);
    // 3. Inject CSS just before </head>
    html = html.replace('</head>', `${cssInject}\n</head>`);

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  } catch (e) {
    return new Response(`Proxy error: ${String(e)}`, { status: 500 });
  }
}
