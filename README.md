# Pi Agent Ask

A [Pi](https://pi.dev/) extension that lets your agent ask you a structured question and keep working while you answer.

`ask_user` opens an interactive form — single-select, multi-select, preview panes, free-form answers, and per-question or per-option notes. With `background: true`, the agent continues independent work and your answer arrives between turns (or wakes an idle agent); `wait_for_answers` blocks only when the agent genuinely needs the answer.

## Install

Install [Pi](https://pi.dev/), then:

```bash
pi install npm:@saifymatteo/pi-agent-ask
```

Or install directly from GitHub:

```bash
pi install git:github.com/saifymatteo/pi-agent-ask
```

Remove any other `pi-ask` installation so only one extension provides `ask_user`, then reload Pi.

## Tools

- `ask_user` — the interactive question form. Foreground by default; `background: true` queues it and returns a receipt.
- `wait_for_answers` — blocks until all outstanding background forms are answered, without a built-in timeout.

Questions can be `single`, `multi`, or `preview`. The extension opens only in TUI mode; outside TUI, `ask_user` returns a cancelled result containing the normalized pending questions.

## Features

- tabbed multi-question flow with single/multi/preview types
- inline free-form answers and `@` file-path autocomplete
- question notes, option notes, and an elaborate/continue path
- background question queue, opened one form at a time in FIFO order
- automatic recovery of an interrupted form across startup, resume, and fork
- best-effort notification when a question is waiting
- optional `herdr:blocked` status while a form waits (for [Herdr](https://github.com/maudelv/pi-ask/tree/feat/herdr-blocked-state))
- `/ask-settings` and an in-form settings overlay

## Trimmed fork

This is a trimmed fork. It keeps the interactive form UI, the background queue, `wait_for_answers`, journal-based form recovery, and Herdr status. It removes the agent-facing history tools, the bundled skill, the config system-prompt line, and external UI negotiation. The agent-facing surface is two tools with a short description and four prompt guidelines.

- [configuration](docs/configuration.md)
- [tool contract](docs/contract.md)
- [integration events](docs/remote-events.md)

## Credits

Forked from [alexshpunt/pi-agent-ask](https://github.com/alexshpunt/pi-agent-ask), which builds on [eko24ive/pi-ask](https://github.com/eko24ive/pi-ask). Herdr blocked-state support comes from [maudelv's fork](https://github.com/maudelv/pi-ask/tree/feat/herdr-blocked-state). The original project README lives at the upstream repository linked above.

## License

[MIT](LICENSE)
