# Request headers on real calls

Header rules change the headers of calls that go to the server: add a token, switch a feature
flag, or drop a header, without touching your app's code. Mocked calls are not affected.

## Add a rule

In the **Mocks** tab, under the scenarios, find **Header rules** and click **+ Add rule**:

| Field | Example | Meaning |
|---|---|---|
| tick box | on | the rule applies; untick it to pause it |
| method | `ANY` | which calls; `ANY` for all |
| URL pattern | `/api/*rest` | which URLs, written as in [Matching](matching.md) |
| header name | `Authorization` | the header to set |
| value | `Bearer test-token` | its new value; **empty removes the header** |

Rules save as you type. When several rules set the same header, the last one wins.

Header rules belong to the site's project, not to a scenario, so they apply whatever scenario
is active. Export and import carry them.

## Headers you cannot set

Browsers do not let a page set some headers, such as `Cookie`, `Host`, `Origin`, `Referer`,
`Content-Length`, and any `Sec-…` or `Proxy-…` header. wemock refuses them in the editor and
says why.

## See what was sent

Click a real call in the Log. **Request Headers** lists what the page sent; headers a rule
changed are marked "changed by a header rule", and removed ones "removed by a header rule".

← [Replies](replies.md) · [Back to the guide](README.md)
