# Omarchy Trading212 Plugin

Your [Trading 212](https://www.trading212.com/) portfolio in the [Omarchy](https://omarchy.org/) status bar: how much you have invested and your P/L at a glance, with a click-to-open panel showing the full account summary and every open position.

Built for the Omarchy 4.x shell (`omarchy-shell` / Quickshell) as a `bar-widget` plugin. It does not work on Omarchy ≤ 3.x (Waybar).

## Features

- **Four bar display modes**, cycled with a **right-click**:
  | Mode | Bar shows |
  |---|---|
  | Invested + P/L | `€12.5k ▲ €322` |
  | P/L percent | `▲ 2.6%` |
  | Total value | `€12.9k` (investments + cash) |
  | Privacy | `T212 ▲` — direction only, no amounts anywhere (including the tooltip) |
- **Left-click** opens the detail panel: invested / value / P/L / free cash, plus all open positions with per-position value and P/L. **Middle-click** (or `R` in the panel) forces a refresh.
- P/L is colored with your theme's accent (profit) and urgent (loss) colors, so it follows every Omarchy theme.
- The cycled mode is persisted to `shell.json`, so it survives shell restarts.
- Records one **daily portfolio snapshot** to `~/.local/state/omarchy-trading212/history-<env>.jsonl` — the Trading 212 API exposes no history, so this builds the dataset a future graph view will draw from.

## Install

```sh
omarchy plugin add https://github.com/simasrazinskas/omarchy-trading212-plugin.git --enable
```

Then place it on the bar if it doesn't appear automatically:

```sh
omarchy bar put io.github.simasrazinskas.trading212 right
```

## Connect your Trading 212 account

The plugin talks directly to the official [Trading 212 public API](https://docs.trading212.com/api) (Invest and Stocks ISA accounts; CFD is not supported by the API).

1. In Trading 212 (app or web): **Settings → API (Beta)** → generate an API key.
   - **Read-only permissions are enough** — this plugin never places orders; granting it nothing else is safest.
   - Restricting the key to your IP is recommended by Trading 212.
   - The **secret is shown only once** at creation; copy it immediately.
2. Store the credential in your system keyring (gnome-keyring ships with Omarchy):

   ```sh
   secret-tool store --label="Trading 212 API (live)" service trading212 account live
   ```

   Paste `KEY:SECRET` at the prompt (a legacy single-token key also works — paste it as-is).
3. The widget picks it up on its next refresh — or press `R` in the panel.

### Why the keyring?

The credential is never written to a config file, never passed on a process command line, and never appears in `shell.json` or this plugin's settings. At request time the widget runs `secret-tool lookup`, and the `Authorization` header is handed to `curl` via `--config` on stdin. Locked keyring = no requests.

### Practice (demo) account

Keys are per-environment: a key generated while in Practice mode only works against the demo API. To point the widget at a practice account, store the demo key:

```sh
secret-tool store --label="Trading 212 API (demo)" service trading212 account demo
```

and set the environment in `~/.config/omarchy/shell.json` on the widget's bar entry:

```json
{ "id": "io.github.simasrazinskas.trading212", "environment": "demo" }
```

## Settings

| Key | Default | Meaning |
|---|---|---|
| `refreshIntervalSec` | `60` | Poll interval (15–3600 s). Also editable in the bar's widget settings UI. |
| `environment` | `live` | `live` or `demo`. |
| `mode` | `invested` | Current display mode; normally you just right-click instead of editing this. |

The account-summary endpoint is rate-limited to 1 request / 5 s by Trading 212, so the 60 s default is conservative; the minimum of 15 s stays well clear of it.

## IPC

```sh
omarchy-shell io.github.simasrazinskas.trading212 toggle    # open/close the panel
omarchy-shell io.github.simasrazinskas.trading212 refresh
omarchy-shell io.github.simasrazinskas.trading212 cycle     # next display mode
omarchy-shell io.github.simasrazinskas.trading212 status    # JSON state
```

## Development

```sh
tests/run                      # node unit tests + manifest validation
omarchy plugin validate .      # manifest only
```

`Model.js` is pure JavaScript (parsing + formatting) shared between the QML widget and the node test suite. `Service.qml` owns polling and keyring access; `Panel.qml` is the bar widget and popup panel.

## License

[MIT](LICENSE). Not affiliated with Trading 212 or Omarchy.
