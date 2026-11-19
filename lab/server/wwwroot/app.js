// The lab's page: each button makes one call and writes what came back into its <output>.
// Results are plain text, so a test reads exactly what the page received.
const show = (key, value) => {
  const el = document.querySelector(`[data-r="${key}"]`);
  el.textContent = typeof value === 'string' ? value : JSON.stringify(value);
};

async function call(key, url, init) {
  show(key, '...');
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    show(key, `${res.status} ${text}`);
  } catch (err) {
    show(key, `failed: ${err.message}`);
  }
}

const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);

on('products', () => call('products', '/api/products'));
on('product', () => call('product', '/api/products/7'));
on('category', () => call('category', '/api/categories/tea/products/4'));
on('search', () => call('search', '/api/products/search?q=green&page=1&sort=price'));
on('price', () => call('price', '/api/price/7?qty=12'));
on('status', () => call('status', '/api/orders/1042/status'));
on('checkout', () => call('checkout', '/api/checkout', json({ cart: 'c-1042' })));
on('cart', () => call('cart', '/api/cart', json({ productId: 7, qty: 2 })));
on('cart-coupon', () => call('cart-coupon', '/api/cart', json({ productId: 7, qty: 2, coupon: 'TEA10' })));
on('me', () => call('me', '/api/me'));
on('me-auth', () => call('me-auth', '/api/me', { headers: { authorization: 'Bearer lab' } }));
on('recommendations', () => call('recommendations', '/api/recommendations'));

on('xhr', () => {
  show('xhr', '...');
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/products/3');
  xhr.onload = () => show('xhr', `${xhr.status} ${xhr.responseText}`);
  xhr.onerror = () => show('xhr', 'failed');
  xhr.send();
});

on('axios', async () => {
  show('axios', '...');
  try {
    const res = await window.axios.get('/api/products/5');
    show('axios', `${res.status} ${JSON.stringify(res.data)}`);
  } catch (err) {
    show('axios', `failed: ${err.response ? err.response.status : err.message}`);
  }
});

on('image', async () => {
  show('image', '...');
  const res = await fetch('/api/products/7/image');
  const blob = await res.blob();
  document.getElementById('image-out').src = URL.createObjectURL(blob);
  show('image', `${res.status} ${blob.type} ${blob.size} bytes`);
});

on('assistant', () => {
  show('assistant', '...');
  const parts = [];
  const es = new EventSource('/api/assistant');
  es.onmessage = (e) => {
    parts.push(e.data);
    show('assistant', parts.join(' '));
    if (parts.length >= 5) es.close();
  };
  es.onerror = () => {
    es.close();
    show('assistant', parts.length ? parts.join(' ') : 'failed');
  };
});

const graphql = (key, operationName) =>
  call(key, '/graphql', json({ operationName, query: `query ${operationName} { x }`, variables: {} }));
on('graphql-products', () => graphql('graphql-products', 'GetProducts'));
on('graphql-order', () => graphql('graphql-order', 'GetOrder'));

on('ws', () => {
  show('ws', '...');
  const got = [];
  const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws/echo`);
  ws.onmessage = (e) => {
    got.push(e.data);
    show('ws', got.join(' | '));
    if (got.length === 1) ws.send('ping');
    if (got.length >= 2) ws.close();
  };
  ws.onerror = () => show('ws', 'failed');
});

on('hub', async () => {
  show('hub', '...');
  const lines = [];
  const add = (line) => {
    lines.push(line);
    show('hub', lines.join(' | '));
  };
  const conn = new signalR.HubConnectionBuilder().withUrl('/hubs/orders').build();
  conn.on('Notify', (text, n) => add(`Notify ${text} ${n}`));
  conn.on('StatusChanged', (id, status) => add(`StatusChanged ${id} ${status}`));
  try {
    await conn.start();
    const sub = await conn.invoke('Subscribe', 1042);
    add(`Subscribe ${JSON.stringify(sub)}`);
    const price = await conn.invoke('GetPrice', 7);
    add(`GetPrice ${JSON.stringify(price)}`);
    try {
      await conn.invoke('Fail');
    } catch (err) {
      add(`Fail ${err.message.includes('The lab says no') ? 'HubException' : err.message}`);
    }
    const streamed = await new Promise((resolve, reject) => {
      const items = [];
      conn.stream('StreamPrices', 3).subscribe({
        next: (item) => items.push(item.price),
        complete: () => resolve(items),
        error: reject,
      });
    });
    add(`StreamPrices ${streamed.join(',')}`);
    await new Promise((r) => setTimeout(r, 800));
  } catch (err) {
    add(`failed: ${err.message}`);
  } finally {
    await conn.stop();
  }
});

on('many', async () => {
  show('many', '...');
  const started = performance.now();
  let ok = 0;
  let mocked = 0;
  // Ten at a time, as a busy page does, so the browser's connection limit is not the bottleneck.
  for (let from = 1; from <= 900; from += 10) {
    const batch = [];
    for (let n = from; n < from + 10 && n <= 900; n++) {
      batch.push(
        fetch(`/api/items/${n}`).then(async (res) => {
          if (res.ok) ok++;
          const body = await res.json().catch(() => ({}));
          if (body && body.mocked) mocked++;
        }),
      );
    }
    await Promise.all(batch);
  }
  show('many', `${ok} of 900 ok, ${mocked} mocked, ${Math.round(performance.now() - started)} ms`);
});
