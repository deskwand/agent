# Upstream provenance

The Web Access tools are adapted from [nicobailon/pi-web-access](https://github.com/nicobailon/pi-web-access), tag `v0.13.0`, commit `7bdc30a65cf77273eb9c0034647b373bda4060d7`, under the MIT License.

## File inventory

The following TypeScript files are materially adapted from the pinned upstream source and carry an attribution header:

- `brave.ts`
- `exa.ts`
- `extract.ts`
- `fetch-params.ts`
- `gemini-api.ts`
- `gemini-search.ts`
- `gemini-url-context.ts`
- `github-api.ts`
- `github-extract.ts`
- `openai-search.ts`
- `parallel.ts`
- `pdf-extract.ts`
- `perplexity.ts`
- `rsc-extract.ts`
- `ssrf-protection.ts`
- `tavily.ts`

The upstream license retained with the adapted files is:

- `LICENSE.pi-web-access`

The following integration files are DeskWand-specific rather than copied upstream:

- `cache.ts`
- `config-adapter.ts`
- `session-temp.ts`
- `types.ts`
- `web-tools.ts`

This directory also contains this inventory document. `LICENSE.pi-web-access` is an unmodified copy of the upstream MIT license.

## Scope changes

Intentionally removed:

- Pi Extension and TUI integration
- Curator, commands, shortcuts, and activity widgets
- Independent `web-search.json` configuration
- Gemini Web browser-cookie access
- YouTube, local video, and frame extraction
- Disk-persisted search-result cache

See `LICENSE.pi-web-access` for the upstream license text.
