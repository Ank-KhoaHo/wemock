# FAQ

## Does it send my data anywhere?

No. Mocks live in your browser (`chrome.storage.local`). wemock makes no network calls of its own.

## Does it run on every site I visit?

No. Only on `localhost`, `127.0.0.1`, and the sites you switch on, one at a time. See
[Install](install.md#switch-it-on-for-a-site).

## Why does a mocked call not show in the Network tab?

It never leaves the page, so the network never sees it. The wemock [Log](checking.md#the-log) and the
[Console line](checking.md#the-console-line) do.

## Is code in a code mock safe?

It runs in a sandboxed extension page with no access to your page or to wemock, and stops after
one second. wemock never downloads code.

## What does it work with?

`fetch`, `XMLHttpRequest`, and libraries built on them, axios included. React, axios, Angular
`HttpClient` and a real ASP.NET Core SignalR hub are part of the tests. Every row, button and
field works from the keyboard.

## Why a mockingbird?

It hears a call once and sings it back. That is the whole product.

← [Limits](limits.md) · [Back to the guide](README.md)
