# 📸 Instagram Monitor Bot

A Discord bot that monitors up to **10 Instagram accounts** 24/7 and alerts you when an account gets **banned** or **unbanned** — deployable on Railway in minutes.

---

## ✨ Features

- 🟢 Detects when an account is **ACTIVE** (monitoring for ban)
- 🔴 Detects when an account is **BANNED** (monitoring for unban)
- 📢 Sends instant alerts to your Discord channel on any status change
- ⚡ Monitors up to **10 accounts simultaneously**
- 🔄 Concurrent checking with configurable interval (1–60 min)
- 🛡️ 3-layer check strategy: RapidAPI → Public JSON → HTTP status
- 🚂 One-click deploy to **Railway**

---

## 🚀 Setup Guide

### Step 1 — Create a Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → give it a name
3. Go to **Bot** tab → click **Add Bot**
4. Copy the **Token** (this is your `DISCORD_TOKEN`)
5. Go to **OAuth2 → General** → copy the **Application ID** (this is your `CLIENT_ID`)
6. Under **Bot → Privileged Gateway Intents**, enable:
   - ✅ Message Content Intent
7. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Send Messages`, `Embed Links`, `Use Slash Commands`
   - Copy the generated URL and open it to invite the bot to your server

---

### Step 2 — Get a RapidAPI Key (Required for Railway)

Railway's IPs are datacenter IPs — Instagram blocks direct requests from them. RapidAPI routes around this.

1. Sign up at [rapidapi.com](https://rapidapi.com)
2. Search for **"Instagram Scraper API2"** and subscribe (free tier available)
3. Copy your **RapidAPI Key** from the API dashboard

---

### Step 3 — Deploy to Railway

1. Push this project to a GitHub repo
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub Repo**
3. Select your repo
4. Go to **Variables** tab and add:

| Variable | Value |
|---|---|
| `DISCORD_TOKEN` | Your Discord bot token |
| `CLIENT_ID` | Your Discord Application ID |
| `RAPIDAPI_KEY` | Your RapidAPI key |
| `CHECK_INTERVAL_MINUTES` | `5` (or your preferred interval) |

5. Railway will auto-deploy. Your bot is now live 24/7! ✅

---

## 🎮 Commands

| Command | Description |
|---|---|
| `/add <username>` | Add an Instagram account to monitor |
| `/add <username> <label>` | Add with a custom label/nickname |
| `/remove <username>` | Remove an account from monitoring |
| `/check <username>` | Force an immediate status check |
| `/status` | View the full monitoring dashboard |
| `/list` | List all monitored accounts |
| `/interval <minutes>` | Change check frequency (1–60 min) |
| `/setchannel` | Set the current channel for alerts |
| `/clear` | Remove all monitored accounts |
| `/help` | Show command reference |

---

## 📢 Alert Messages

When a status changes, the bot sends an embed like:

**Account Banned:**
> 🔴 **Account Banned — @example**
> ⛔ Account is BANNED / Inactive
> 🔄 Monitoring for unban...

**Account Active:**
> 🟢 **Account Active — @example**
> ✅ Account is ACTIVE
> 📡 Monitoring for ban...

---

## ⚙️ Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | ✅ | — | Discord bot token |
| `CLIENT_ID` | ✅ | — | Discord application ID |
| `RAPIDAPI_KEY` | ✅ Recommended | — | RapidAPI key for Instagram scraper |
| `CHECK_INTERVAL_MINUTES` | ❌ | `5` | Minutes between each check cycle |

---

## 🔧 How It Works

1. **Bot starts** → registers slash commands with Discord
2. **You add accounts** with `/add`
3. **Every N minutes**, all accounts are checked concurrently (3 at a time to avoid rate limits)
4. On **first check** → bot sends the current status to your alert channel
5. On **status change** → bot immediately sends a new alert
6. **Checking strategy** (in order):
   - 🥇 RapidAPI Instagram Scraper (most reliable from cloud IPs)
   - 🥈 Instagram public JSON endpoint (backup)
   - 🥉 HTTP status code check (last resort)

---

## 🛠️ Local Development

```bash
# Clone and install
git clone <your-repo>
cd instagram-monitor-bot
npm install

# Configure
cp .env.example .env
# Edit .env with your values

# Run
npm run dev
```

---

## 📝 Notes

- Account states are stored **in memory** — they reset when the bot restarts. This is intentional for simplicity; Railway restarts are rare.
- The bot does not store any Instagram credentials — it only reads public profile availability.
- Instagram rate limits: with 10 accounts checked every 5 min via RapidAPI, you'll use ~2,880 API calls/day. Check your RapidAPI plan limits.
