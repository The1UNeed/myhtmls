---
name: myhtmls
description: Create and upload static HTML drafts to myhtmls.dev, or read and implement plans supplied as myhtmls.dev URLs. Use whenever a user provides a myhtmls.dev URL or asks to publish a plan, proposal, brief, architecture note, or similar artifact with myhtmls.
---

# myhtmls

## Read a myhtmls URL

When a user supplies a `myhtmls.dev` URL, fetch the uploaded HTML immediately with the shell. Do not use web search or a browser to retrieve it.

1. Remove a trailing slash, then append `/raw` unless the URL already ends in `/raw`.
2. Run `curl --fail --silent --show-error --location --max-time 30 --output /tmp/myhtmls.html '<raw-url>'`.
3. Read `/tmp/myhtmls.html` as the user's artifact and continue the requested task.

A web-search refusal is not evidence that myhtmls rejected the request. If `curl` fails, report its actual status or network error; do not substitute search results.

## Document Rules

Create one complete static HTML document, capped at 512 KB.

Allowed:

- Semantic HTML.
- Inline CSS or a `<style>` block.
- Normal document metadata such as charset, viewport, and title.
- Links to ordinary HTTPS pages.
- Images from HTTPS or data URLs when necessary.
- An inline classic `<script>` only when interactivity materially helps. Scripts run in a browser sandbox that blocks storage, fetch, forms, frames, and cookies — keep pages useful without JavaScript.

Do not include:

- External or module scripts (`<script src>`, `type="module"`).
- Inline event handlers such as `onclick`, `onload`, or `onerror`.
- `javascript:` URLs.
- Forms.
- Iframes, embeds, objects, or applets.
- Meta refresh redirects.
- Secrets, tokens, private URLs, or local filesystem paths.

## Upload Flow

1. Write the HTML file locally.
2. Run:

   ```sh
   npx myhtmls upload <file path>
   ```

3. Return the myhtmls URL to the user.

The CLI prints both a draft URL and a `Raw HTML` URL. Either works for any client; hand the `Raw HTML` URL to another agent when you want the most explicit form.

If the same local file was uploaded before, the CLI updates the existing draft and its URL stays stable. To force a new draft, use:

```sh
npx myhtmls upload <file path> --new
```

Uploads require an API key (`myhtmls auth set <key>` once, stored in `~/.myhtmls`).

## Viewer Behavior

Every myhtmls URL serves the exact uploaded HTML, byte for byte, to every client — browsers, curl, and agent fetch tools alike. There is no wrapper page or consent step: fetching a myhtmls URL always yields the draft content itself. The `/raw` suffix is an alias that returns the same bytes.
