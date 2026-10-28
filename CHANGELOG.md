# Changelog

## 1.1.1

- Reduce agent context with shorter tool descriptions and field-local guidance while preserving the API and interactive features.
- Guide agents to use preview files for long content already on disk instead of copying it into tool calls.
- Add regression checks for guidance and schema sizes.

## 1.1.0

- Reuse compatible clipboard extensions inside Ask answers and notes through optional provider events, with built-in clipboard reading as fallback when no provider is loaded.
- Keep Alt+V and Ctrl+Alt+V available inside Ask when Pi's image-paste binding is disabled, without changing normal chat shortcuts.
- Validate provider images and clean up pending reads so late replies cannot attach to a closed editor.

## 1.0.1

- Align image integration coverage with the trimmed fork's two-tool surface.
- Publish the post-rebase standalone fork with npm provenance.

Notable changes to `@saifymatteo/pi-agent-ask` are recorded here.

This project is a trimmed fork of [alexshpunt/pi-agent-ask](https://github.com/alexshpunt/pi-agent-ask); see that repository for the history of the upstream project.
