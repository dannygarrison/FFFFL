// Serves /blog/<slug> with per-post link-preview tags.
//
// Cloudflare runs this for any request under /blog/. It fetches the site's own
// index.html and posts.json, finds the post whose slug matches, and rewrites the
// og:/twitter: meta tags before returning the page. Everything else about the
// site is unchanged — the same single-page app loads and scrolls to the post.
//
// Nothing to regenerate when you publish: the function reads posts.json at
// request time, so a new post gets a correct preview as soon as it's deployed.

const SITE = 'https://ffffleague.com';

// Must match postSlug() in index.html.
function postSlug(title) {
  return String(title || 'post')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// Body text is markdown-ish with [roster] and [lineup] blocks — strip them for
// the description, since a preview card wants one clean sentence or two.
function summarize(body, limit = 190) {
  const raw = String(body || '');
  // Prefer the intro — the text before the first "## " heading. Falling back to
  // the whole body would otherwise chain headings together into nonsense.
  const intro = raw.split(/\n##\s/)[0];
  const source = intro.trim().length > 40 ? intro : raw;
  const text = source
    .replace(/\[(roster|lineup)\][\s\S]*?\[\/\1\]/g, ' ')
    .replace(/^##\s*/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return cut.slice(0, stop > 60 ? stop : limit).trim() + '…';
}

function attr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const origin = new URL(request.url).origin;

  // env.ASSETS serves the static files in this project.
  const page = await env.ASSETS.fetch(new URL('/index.html', origin));
  let html = await page.text();

  let post = null;
  try {
    const res = await env.ASSETS.fetch(new URL('/posts.json', origin));
    if (res.ok) {
      const posts = await res.json();
      post = posts.find(p => postSlug(p.title) === params.slug) || null;
    }
  } catch (err) {
    // Fall through to the site-level card rather than erroring the page.
  }

  if (post) {
    const title = `${post.title} — FFFFL`;
    const desc = summarize(post.body);
    const url = `${SITE}/blog/${params.slug}`;

    const swaps = [
      [/<title>[^<]*<\/title>/, `<title>${attr(title)}</title>`],
      [/<meta property="og:type" content="[^"]*">/, '<meta property="og:type" content="article">'],
      [/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${attr(title)}">`],
      [/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${attr(desc)}">`],
      [/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${attr(url)}">`],
      [/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${attr(title)}">`],
      [/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${attr(desc)}">`],
      [/<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(desc)}">`],
    ];
    for (const [find, replace] of swaps) html = html.replace(find, replace);

    // Tell the page which post to open, so it doesn't need the hash.
    html = html.replace('</head>',
      `<script>window.__FFFFL_POST = ${JSON.stringify(params.slug)};</script>\n</head>`);
  }

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Short cache so an edited post's preview refreshes quickly.
      'cache-control': 'public, max-age=60',
    },
  });
}
