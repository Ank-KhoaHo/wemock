// A26: a real Angular app using HttpClient the way apps do: provideHttpClient with a functional
// interceptor that adds the auth header, a service per resource, observables, and unsubscribe to cancel.
import { Component, inject, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { HttpClient, HttpErrorResponse, HttpInterceptorFn, HttpResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

const auth: HttpInterceptorFn = (req, next) =>
  next(req.url.endsWith('/api/me') ? req.clone({ setHeaders: { Authorization: 'Bearer abc' } }) : req);

type Result = { status: number; body: unknown };

@Component({
  selector: 'app-root',
  template: `
    <h1>Angular shop</h1>
    <pre id="products">{{ products() }}</pre>
    <button id="run" (click)="run()">Run</button>
    <pre id="out">{{ out() }}</pre>
  `,
})
class App {
  private http = inject(HttpClient);
  products = signal('');
  out = signal('');

  constructor() {
    this.get('/api/products').then((r) => this.products.set(JSON.stringify(r)));
  }

  private async get(url: string): Promise<Result> {
    try {
      const r = await firstValueFrom(this.http.get(url, { observe: 'response', responseType: 'text' }));
      return this.result(r);
    } catch (e) {
      return this.error(e);
    }
  }

  private result(r: HttpResponse<string>): Result {
    let body: unknown = r.body;
    try {
      body = JSON.parse(r.body ?? '');
    } catch {
      // keep the text
    }
    return { status: r.status, body };
  }

  private error(e: unknown): Result {
    if (e instanceof HttpErrorResponse) {
      let body: unknown = e.error;
      try {
        body = typeof e.error === 'string' ? JSON.parse(e.error) : e.error;
      } catch {
        // keep it
      }
      return { status: e.status, body };
    }
    throw e;
  }

  async run(): Promise<void> {
    const out: Record<string, unknown> = {};
    out['user'] = await this.get('/api/users/7');
    const polls: Result[] = [];
    for (let i = 0; i < 3; i++) polls.push(await this.get('/api/orders/1/status'));
    out['polls'] = polls;
    try {
      const r = await firstValueFrom(this.http.post('/api/cart', { sku: 'tea', qty: 2 }, { observe: 'response', responseType: 'text' }));
      out['cart'] = this.result(r);
    } catch (e) {
      out['cart'] = this.error(e);
    }
    out['me'] = await this.get('/api/me');
    out['slow'] = await new Promise((resolve) => {
      const sub = this.http.get('/api/slow', { responseType: 'text' }).subscribe({
        next: (v) => resolve(v),
        error: (e) => resolve(String(e)),
      });
      setTimeout(() => {
        sub.unsubscribe();
        resolve('unsubscribed');
      }, 50);
    });
    out['real'] = await this.get('/api/goals');
    (window as unknown as { __results: unknown }).__results = out;
    this.out.set(JSON.stringify(out));
  }
}

bootstrapApplication(App, { providers: [provideHttpClient(withInterceptors([auth]))] }).catch((e) => console.error(e));
