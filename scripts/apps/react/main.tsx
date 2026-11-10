// A26: a real React 19 app, built with Vite, that uses fetch the way apps do: a hook that loads on
// mount, a polling loop, a POST, a call with a header, and an AbortController.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Results = Record<string, unknown>;

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const r = await fetch(url, init);
  const text = await r.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep the text
  }
  return { status: r.status, body };
}

function useProducts(): unknown {
  const [products, setProducts] = useState<unknown>(null);
  useEffect(() => {
    const ac = new AbortController();
    getJson('/api/products', { signal: ac.signal }).then(setProducts, () => {});
    return () => ac.abort();
  }, []);
  return products;
}

async function runAll(): Promise<Results> {
  const out: Results = {};
  out.user = await getJson('/api/users/7');
  const polls: unknown[] = [];
  for (let i = 0; i < 3; i++) polls.push(await getJson('/api/orders/1/status'));
  out.polls = polls;
  out.cart = await getJson('/api/cart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sku: 'tea', qty: 2 }) });
  out.me = await getJson('/api/me', { headers: { Authorization: 'Bearer abc' } });
  const ac = new AbortController();
  const slow = getJson('/api/slow', { signal: ac.signal });
  setTimeout(() => ac.abort(), 50);
  try {
    out.slow = await slow;
  } catch (e) {
    out.slow = (e as Error).name;
  }
  out.real = await getJson('/api/goals');
  return out;
}

function App() {
  const products = useProducts();
  const [results, setResults] = useState<Results | null>(null);
  return (
    <main>
      <h1>React shop</h1>
      <pre id="products">{products ? JSON.stringify(products) : ''}</pre>
      <button id="run" onClick={() => runAll().then((r) => { setResults(r); (window as unknown as { __results: Results }).__results = r; })}>Run</button>
      <pre id="out">{results ? JSON.stringify(results) : ''}</pre>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
