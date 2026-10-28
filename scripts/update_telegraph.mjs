import https from 'node:https';

const ACCESS_TOKEN = '038ce64a4889c4bb2246ab179668dfa1c4225ebddb03d32c8f87be0c9714';
const GH_PAGES_BASE = 'https://oramasj.github.io/codecraft-studio-il';

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function normalizeUrl(oldUrl) {
  if (!oldUrl || typeof oldUrl !== 'string') return oldUrl;
  if (!oldUrl.includes('trycloudflare.com') && !oldUrl.includes('localhost') && !oldUrl.includes('127.0.0.1')) {
    return oldUrl;
  }
  try {
    const parsed = new URL(oldUrl);
    let pathname = parsed.pathname;
    if (pathname.startsWith('/previews/')) {
      pathname = pathname.replace('/previews/', '/');
    }
    if (!pathname || pathname === '/') {
      pathname = '/index.html';
    }
    return `${GH_PAGES_BASE}${pathname}`;
  } catch (err) {
    return `${GH_PAGES_BASE}/index.html`;
  }
}

function transformNodes(nodes) {
  if (!nodes) return nodes;
  if (Array.isArray(nodes)) {
    return nodes.map(transformNodes);
  }
  if (typeof nodes === 'string') {
    let text = nodes;
    if (text.includes('בביט למספר 054-6373001')) {
      text = text.replace('בביט למספר 054-6373001', 'בביט / פייבוקס למספר 054-6373001 (קוד שחרור: 2800)');
    }
    return text;
  }
  if (typeof nodes === 'object') {
    const newNode = { ...nodes };
    if (newNode.attrs) {
      newNode.attrs = { ...newNode.attrs };
      if (newNode.attrs.href) {
        newNode.attrs.href = normalizeUrl(newNode.attrs.href);
      }
    }
    if (newNode.children) {
      newNode.children = transformNodes(newNode.children);
    }
    return newNode;
  }
  return nodes;
}

async function editWithRetry(page, transformed, maxRetries = 5) {
  const bodyStr = JSON.stringify({
    access_token: ACCESS_TOKEN,
    path: page.path,
    title: page.title,
    author_name: page.author_name || 'CodeCraft Studio IL',
    content: transformed,
    return_content: false
  });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const editRes = await request(`https://api.telegra.ph/editPage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      },
      body: bodyStr
    });

    if (editRes.ok) {
      return { ok: true };
    }

    const floodMatch = (editRes.error || '').match(/FLOOD_WAIT_(\d+)/);
    if (floodMatch) {
      const waitSec = parseInt(floodMatch[1], 10) + 1;
      console.log(`    ⏳ Telegraph rate limit: waiting ${waitSec}s before retrying (attempt ${attempt}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      continue;
    }

    return { ok: false, error: editRes.error };
  }
  return { ok: false, error: 'Max retries exceeded' };
}

async function run() {
  console.log('Fetching page list...');
  const listRes = await request(`https://api.telegra.ph/getPageList?access_token=${ACCESS_TOKEN}&limit=50`);
  if (!listRes.ok) {
    throw new Error(`Failed to list pages: ${JSON.stringify(listRes)}`);
  }

  const pages = listRes.result.pages;
  console.log(`Found ${pages.length} pages.`);

  let updatedCount = 0;
  for (const p of pages) {
    console.log(`\nProcessing: ${p.title} (${p.path})`);
    const pageRes = await request(`https://api.telegra.ph/getPage/${encodeURIComponent(p.path)}?return_content=true`);
    if (!pageRes.ok) {
      console.error(`  Error fetching ${p.path}:`, pageRes.error);
      continue;
    }

    const currentContent = pageRes.result.content;
    const transformed = transformNodes(currentContent);

    const editRes = await editWithRetry(p, transformed);

    if (editRes.ok) {
      console.log(`  ✅ Successfully updated ${p.path}`);
      updatedCount++;
    } else {
      console.error(`  ❌ Failed to update ${p.path}:`, editRes.error);
    }

    // Safe delay to prevent rate limiting
    await new Promise(r => setTimeout(r, 2500));
  }

  console.log(`\n🎉 Completed! Updated ${updatedCount}/${pages.length} Telegraph pages.`);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
