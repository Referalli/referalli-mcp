# @referalli/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for Referalli. It lets Claude, Cursor or any MCP client read your referral and affiliate program (programs, partners, referrals, fraud cases, ROI) and, with your confirmation, act on it (create partners, links and coupons, approve or void referrals, draft payout runs).

It runs locally over stdio with `npx` and talks to `https://referalli.com` with your API key. Requires Node.js 20 or later.

## 1. Get an API key

In Referalli, open **Settings → API keys** and create a key. Start with a test-mode key (`rk_test_…`). The key's scopes decide what the server can do: a read-only key gives a read-only assistant.

## 2. Add the server to your client

### Claude Code

```sh
claude mcp add --transport stdio --env REFERALLI_API_KEY=rk_test_your_key referalli -- npx -y @referalli/mcp
```

Add `--scope user` to make it available in every project. Check it with `claude mcp list`, or with `/mcp` inside a session.

### Claude Desktop

Open **Settings → Developer → Edit Config** (`claude_desktop_config.json`: `~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows) and add:

```json
{
  "mcpServers": {
    "referalli": {
      "command": "npx",
      "args": ["-y", "@referalli/mcp"],
      "env": {
        "REFERALLI_API_KEY": "rk_test_your_key"
      }
    }
  }
}
```

Restart Claude Desktop.

### Cursor

Add the same block to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "referalli": {
      "command": "npx",
      "args": ["-y", "@referalli/mcp"],
      "env": {
        "REFERALLI_API_KEY": "rk_test_your_key"
      }
    }
  }
}
```

Then enable **referalli** under **Cursor Settings → MCP**.

### Other clients

Any client that launches stdio servers works: the command is `npx -y @referalli/mcp`, with `REFERALLI_API_KEY` in its environment.

## Configuration

| Variable | Meaning |
| --- | --- |
| `REFERALLI_API_KEY` | Required. A Referalli API key. |
| `REFERALLI_API_URL` | API base URL. Default `https://referalli.com`; use `http://localhost:4000` for a local API. |

## Tools

Read tools answer directly:

| Tool | What it returns |
| --- | --- |
| `list_programs` | The affiliate programs in the organization |
| `program_overview` | Funnel and revenue for the last 30 days |
| `partner_performance` | Per-partner clicks, referrals, revenue and commissions |
| `list_referrals` | Recent referrals with attribution channel and status |
| `list_fraud_cases` | Open fraud cases awaiting review |
| `roi_summary` | Credit ROI: what granted credit cost and the cash it earned back |
| `roi_trace` | The timeline behind an ROI figure for one customer or one partner |
| `roi_patterns` | Customers or partners matching a credit-ROI pattern (for example `credit_only`) |

Write tools never act on the first call. They return a preview of exactly what would change plus a one-time confirmation token. Only a second call with `confirm: true`, that token and the same arguments, made within 5 minutes, performs the change:

`create_partner`, `create_link`, `create_coupon`, `approve_referral`, `void_referral`, `pause_referral`, `resume_referral`, `approve_due_commissions`, `create_payout_run` (a draft; no money moves), `settle_commission`.

## Links

- Docs: https://referalli.com/docs
- Issues: https://github.com/Referalli/referalli-mcp/issues
- Changelog: [CHANGELOG.md](./CHANGELOG.md)

MIT licensed.
