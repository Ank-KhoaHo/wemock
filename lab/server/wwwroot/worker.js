// A Web Worker's own fetch: the page's patches do not reach it.
self.onmessage = async () => {
  try {
    const res = await fetch('/api/products/10');
    self.postMessage(`${res.status} ${await res.text()}`);
  } catch (err) {
    self.postMessage(`failed: ${err.message}`);
  }
};
