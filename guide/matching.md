# Matching

A mock answers a call when its method and its URL pattern match, and, if it has any, its
conditions hold.

## Method

`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, or `ANY` for all of them.

## URL pattern

| Pattern | Matches | Does not match |
|---|---|---|
| `/api/goals` | `/api/goals` | `/api/goals/7` |
| `/api/goals/:id` | `/api/goals/7` (`id` is `7`) | `/api/goals/7/steps` |
| `/files/*rest` | `/files/a`, `/files/a/b.css` | `/files` |
| `/users{/:id}` | `/users`, `/users/5` | |
| `/v1/items\:batch` | `/v1/items:batch` | |
| `https://api.example.com/x` | `/x` on that host only | `/x` on any other host |

- The query string is ignored by the pattern; use a condition to match on it.
- `:` `*` `(` `)` `{` `}` and `\` have a meaning in a pattern. Write `\:` for a literal `:`.
  Recording escapes them for you.
- Paths with spaces or non-ASCII letters, such as `/api/café`, work as typed.
- Since 1.8, a pattern with a host keeps its escapes and `{optional}` parts, as a path-only
  pattern does. Thanks to @ThanggDuongg for this fix.

## GraphQL

Many GraphQL calls share one URL. Fill **GraphQL operation** with the operation name
(`GetUser`), and the mock answers only that operation.

## Conditions

**Match only when…** adds conditions that must all hold:

- a **query** parameter has a value: `page` = `2`;
- a request **header** has a value: `x-user` = `admin`;
- fields of a **JSON body** have values: `user.role` = `admin`.

Use `*` as the value for "present, any value".

## Which mock answers

When several mocks match, wemock picks in this order:

1. the active scenario before Default;
2. within each, mocks with conditions before mocks without;
3. then from top to bottom, as the list shows them.

The first match answers. Calls no mock matches go to the server.

A mock that can never answer, because one above it always matches first, gets
a **Never answers** mark in the list. Hover over it to see which mock wins.

To see the answer for a URL without reloading, use the [Test bar](checking.md).

← [Scenarios](scenarios.md) · Next: [Replies](replies.md) →
