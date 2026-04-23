const https = require('https');

/**
 * InstagramChecker
 *
 * Strategy (in order):
 *  1. RapidAPI Instagram scraper (most reliable from Railway IPs)
 *  2. Unofficial public profile endpoint (backup)
 *  3. Instagram web page status code check (last resort)
 *
 * Status mapping:
 *  - Profile found & not private banned → ACTIVE
 *  - Profile not found / deactivated / banned indicators → BANNED
 */
class InstagramChecker {
  constructor() {
    this.rapidApiKey = process.env.RAPIDAPI_KEY;
    this.useRapidApi = !!this.rapidApiKey;
    if (!this.useRapidApi) {
      console.warn('[CHECKER] ⚠️  No RAPIDAPI_KEY set — falling back to direct checks (may be blocked on Railway).');
    }
  }

  /**
   * Main entry: check an Instagram username.
   * Returns: { status: 'ACTIVE' | 'BANNED', detail: string }
   */
  async check(username) {
    const errors = [];

    // Strategy 1: RapidAPI
    if (this.useRapidApi) {
      try {
        const result = await this._checkViaRapidApi(username);
        return result;
      } catch (err) {
        errors.push(`RapidAPI: ${err.message}`);
      }
    }

    // Strategy 2: Instagram public JSON endpoint
    try {
      const result = await this._checkViaPublicJson(username);
      return result;
    } catch (err) {
      errors.push(`PublicJSON: ${err.message}`);
    }

    // Strategy 3: HTTP status code check
    try {
      const result = await this._checkViaHttpStatus(username);
      return result;
    } catch (err) {
      errors.push(`HTTPStatus: ${err.message}`);
    }

    throw new Error(`All check methods failed: ${errors.join(' | ')}`);
  }

  // ─── Strategy 1: RapidAPI Instagram Scraper ────────────────────────────────
  async _checkViaRapidApi(username) {
    // Primary: instagram-scraper-api2.p.rapidapi.com
    // Fallback hosts tried in order
    const hosts = [
      {
        host: 'instagram-scraper-api2.p.rapidapi.com',
        path: `/v1/info?username_or_id_or_url=${encodeURIComponent(username)}`,
      },
      {
        host: 'instagram-looter2.p.rapidapi.com',
        path: `/profile?username=${encodeURIComponent(username)}`,
      },
    ];

    for (const endpoint of hosts) {
      try {
        const data = await this._httpGet(endpoint.host, endpoint.path, {
          'x-rapidapi-host': endpoint.host,
          'x-rapidapi-key': this.rapidApiKey,
        });

        // instagram-scraper-api2 response shape
        if (data && data.data) {
          const profile = data.data;
          // is_private_banned or account suspended
          if (profile.is_private_banned || profile.account_type === 'SUSPENDED') {
            return { status: 'BANNED', detail: 'RapidAPI: profile suspended/banned' };
          }
          // Account exists and is accessible
          return { status: 'ACTIVE', detail: `RapidAPI: @${username} found, ${profile.follower_count || '?'} followers` };
        }

        // instagram-looter2 response shape
        if (data && data.graphql && data.graphql.user) {
          return { status: 'ACTIVE', detail: `RapidAPI(looter): @${username} found` };
        }

        // If we got a 404-like response in JSON
        if (data && (data.status === 404 || data.message === 'user not found')) {
          return { status: 'BANNED', detail: 'RapidAPI: user not found (banned/deleted)' };
        }
      } catch (err) {
        // Try next host
        continue;
      }
    }

    throw new Error('RapidAPI: no valid response from any host');
  }

  // ─── Strategy 2: Instagram public web JSON ─────────────────────────────────
  async _checkViaPublicJson(username) {
    const data = await this._httpGet(
      'www.instagram.com',
      `/${username}/?__a=1&__d=dis`,
      {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      }
    );

    if (data && data.graphql && data.graphql.user) {
      return { status: 'ACTIVE', detail: 'PublicJSON: profile found' };
    }

    return { status: 'BANNED', detail: 'PublicJSON: no user data (banned/deleted/private)' };
  }

  // ─── Strategy 3: HTTP status code ──────────────────────────────────────────
  async _checkViaHttpStatus(username) {
    const statusCode = await this._httpStatusOnly('www.instagram.com', `/${username}/`);

    if (statusCode === 200) {
      return { status: 'ACTIVE', detail: `HTTP: 200 OK for @${username}` };
    } else if (statusCode === 404) {
      return { status: 'BANNED', detail: `HTTP: 404 — @${username} not found (banned/deleted)` };
    } else if (statusCode === 302 || statusCode === 301) {
      // Redirect often means login required → treat as potentially active
      return { status: 'ACTIVE', detail: `HTTP: ${statusCode} redirect (profile exists)` };
    } else {
      throw new Error(`HTTP: unexpected status ${statusCode}`);
    }
  }

  // ─── HTTP Helpers ──────────────────────────────────────────────────────────

  _httpGet(host, path, headers = {}) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: host,
        path,
        method: 'GET',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; InstagramMonitorBot/1.0)',
          ...headers,
        },
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode === 404) {
            resolve({ status: 404, message: 'user not found' });
            return;
          }
          if (res.statusCode >= 400 && res.statusCode !== 404) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('Invalid JSON response'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      req.end();
    });
  }

  _httpStatusOnly(host, path) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: host,
        path,
        method: 'HEAD',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      };

      const req = https.request(options, (res) => {
        resolve(res.statusCode);
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
  }
}

module.exports = InstagramChecker;
