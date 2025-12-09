// functions/article/[[slug]].js

export async function onRequest(context) {
  const { request, env, params, waitUntil } = context;
  const slug = params.slug[0];

  // 1. Setup Caching Key
  const cacheUrl = new URL(request.url);
  const cacheKey = new Request(cacheUrl.toString(), request);
  const cache = caches.default;

  // 2. Check Cache First (The Rate Limit Saver)
  let response = await cache.match(cacheKey);
  if (response) {
    console.log(`Cache Hit for ${slug}`);
    return response;
  }

  // 3. If Cache Miss, Fetch from Supabase
  console.log(`Cache Miss for ${slug} - Fetching DB`);
  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_KEY = env.SUPABASE_SERVICE_KEY;

  // We fetch EVERYTHING here (content, title, author, etc)
  const apiUrl = `${SUPABASE_URL}/rest/v1/posts?slug=eq.${slug}&select=*,authors(*),categories(*)`;

  const apiResponse = await fetch(apiUrl, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Accept': 'application/vnd.pgrst.object+json'
    }
  });

  if (!apiResponse.ok || apiResponse.status === 404) {
    // Redirect to home on 404
    return Response.redirect(new URL('/', request.url).toString(), 302);
  }

  const article = await apiResponse.json();

  // 4. Fetch the HTML Template
  const templateRes = await env.ASSETS.fetch(new URL('/article.html', request.url));
  const htmlStream = templateRes.body;

  // 5. Inject Data using HTMLRewriter (Server-Side Rendering)
  const rewriter = new HTMLRewriter()
    // SEO Meta Tags
    .on('title', { element: e => e.setInnerContent(`${article.title} | The Limelight`) })
    .on('meta[name="description"]', { element: e => e.setAttribute('content', article.excerpt || '') })
    .on('meta[property="og:title"]', { element: e => e.setAttribute('content', article.title) })
    .on('meta[property="og:image"]', { element: e => e.setAttribute('content', article.image_url) })
    
    // CONTENT Injection (This stops the client from needing to fetch!)
    .on('.article-title', { element: e => e.setInnerContent(article.title) })
    .on('.category-tag', { element: e => {
       e.setInnerContent(article.categories?.name || 'Article');
       e.setAttribute('href', `/index.html?categories=${article.categories?.slug}`);
    }})
    .on('.featured-image', { element: e => e.setAttribute('src', article.image_url) })
    .on('#articleBody', { element: e => e.setInnerContent(article.content, { html: true }) })
    
    // Inject a small script to tell Frontend "Data is already here"
    .on('head', { element: e => e.append(`<script>window.SERVER_PRELOADED = true;</script>`, { html: true }) });

  response = rewriter.transform(templateRes);

  // 6. Cache the Response for X time (e.g., 1 hour = 3600 seconds)
  // This essentially creates a Static Page for 1 hour.
  response.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  
  // Store in cache (waitUntil ensures the response is returned without waiting for cache write)
  context.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
}
