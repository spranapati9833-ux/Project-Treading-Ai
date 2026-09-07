import express from "express";
import crypto from "crypto";
import ccxt from "ccxt";

const app = express();

app.use(express.json({ limit: "1mb" }));

// index.html repository ke root me hai
app.use(express.static("."));

const PORT = process.env.PORT || 3000;

const OWNER_EMAIL =
  process.env.OWNER_EMAIL || "sprajapati9833@gmail.com";

const OWNER_PASSWORD =
  process.env.OWNER_PASSWORD || "SHIVPOOJAN";

// Server restart hone par login sessions aur API connections clear ho jayenge.
// Production me database + encrypted secret storage use karna better hai.
const sessions = new Map();

function getCookie(req, name) {
  const raw = req.headers.cookie || "";

  const part = raw
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="));

  if (!part) return "";

  return decodeURIComponent(
    part.slice(name.length + 1)
  );
}

function createSession() {
  const id = crypto.randomBytes(32).toString("hex");

  sessions.set(id, {
    loggedIn: true,
    connections: {}
  });

  return id;
}

function getSession(req) {
  const sid = getCookie(req, "tradeai_sid");

  if (!sid) return null;

  const session = sessions.get(sid);

  if (!session) return null;

  return {
    sid,
    session
  };
}

function requireLogin(req, res, next) {
  const found = getSession(req);

  if (!found) {
    return res.status(401).json({
      ok: false,
      error: "Login required"
    });
  }

  req.sessionId = found.sid;
  req.session = found.session;

  next();
}

function hmacSha256(secret, text) {
  return crypto
    .createHmac("sha256", secret)
    .update(text)
    .digest("hex");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = {
      raw: text
    };
  }

  if (!response.ok) {
    throw new Error(
      data?.msg ||
      data?.message ||
      data?.error ||
      `HTTP ${response.status}`
    );
  }

  return data;
}

// =============================
// COINDCX
// =============================

async function getCoinDcxBalance(credentials) {
  const timestamp = Date.now();

  const body = JSON.stringify({
    timestamp
  });

  const signature = hmacSha256(
    credentials.secret,
    body
  );

  const data = await fetchJson(
    "https://api.coindcx.com/exchange/v1/users/balances",
    {
      method: "POST",

      headers: {
        "content-type": "application/json",
        "X-AUTH-APIKEY": credentials.apiKey,
        "X-AUTH-SIGNATURE": signature
      },

      body
    }
  );

  const assets = (Array.isArray(data) ? data : [])
    .filter((item) => {
      return (
        Number(item.balance || 0) !== 0 ||
        Number(item.locked_balance || 0) !== 0
      );
    })
    .map((item) => {
      const free = Number(item.balance || 0);

      const locked = Number(
        item.locked_balance || 0
      );

      return {
        asset: item.currency,
        free,
        locked,
        total: free + locked
      };
    });

  return {
    assets
  };
}

// =============================
// DELTA EXCHANGE INDIA
// =============================

async function getDeltaBalance(credentials) {
  const method = "GET";

  const timestamp = Math.floor(
    Date.now() / 1000
  ).toString();

  const path = "/v2/wallet/balances";

  const query = "";

  const body = "";

  const message =
    method +
    timestamp +
    path +
    query +
    body;

  const signature = hmacSha256(
    credentials.secret,
    message
  );

  const data = await fetchJson(
    "https://api.india.delta.exchange" + path,
    {
      headers: {
        accept: "application/json",

        "api-key":
          credentials.apiKey,

        signature,

        timestamp,

        "User-Agent":
          "TradeAI-Pro",

        "content-type":
          "application/json"
      }
    }
  );

  const assets = (data.result || [])
    .filter((item) => {
      return (
        Number(item.balance || 0) !== 0 ||
        Number(
          item.available_balance || 0
        ) !== 0
      );
    })
    .map((item) => ({
      asset:
        item.asset_symbol,

      free:
        Number(
          item.available_balance || 0
        ),

      locked:
        Number(
          item.blocked_margin || 0
        ),

      total:
        Number(
          item.balance || 0
        )
    }));

  return {
    assets,

    equity:
      data?.meta?.net_equity ||
      null
  };
}

// =============================
// CCXT EXCHANGES
// Binance / Bybit / OKX / KuCoin
// =============================

function createCcxtExchange(
  platform,
  credentials
) {
  const common = {
    apiKey:
      credentials.apiKey,

    secret:
      credentials.secret,

    enableRateLimit: true
  };

  if (platform === "Binance") {
    return new ccxt.binance(
      common
    );
  }

  if (platform === "Bybit") {
    return new ccxt.bybit(
      common
    );
  }

  if (platform === "OKX") {
    return new ccxt.okx({
      ...common,

      password:
        credentials.passphrase ||
        ""
    });
  }

  if (platform === "KuCoin") {
    return new ccxt.kucoin({
      ...common,

      password:
        credentials.passphrase ||
        ""
    });
  }

  throw new Error(
    "Unsupported exchange"
  );
}

async function getCcxtBalance(
  platform,
  credentials
) {
  const exchange =
    createCcxtExchange(
      platform,
      credentials
    );

  const balance =
    await exchange.fetchBalance();

  const assets = [];

  for (
    const asset
    of Object.keys(
      balance.total || {}
    )
  ) {
    const total =
      Number(
        balance.total?.[asset] ||
        0
      );

    const free =
      Number(
        balance.free?.[asset] ||
        0
      );

    const locked =
      Number(
        balance.used?.[asset] ||
        0
      );

    if (
      total !== 0 ||
      free !== 0 ||
      locked !== 0
    ) {
      assets.push({
        asset,
        free,
        locked,
        total
      });
    }
  }

  return {
    assets
  };
}

async function getPlatformBalance(
  platform,
  credentials
) {
  if (
    platform ===
    "CoinDCX"
  ) {
    return getCoinDcxBalance(
      credentials
    );
  }

  if (
    platform ===
    "Delta Exchange"
  ) {
    return getDeltaBalance(
      credentials
    );
  }

  if (
    [
      "Binance",
      "Bybit",
      "OKX",
      "KuCoin"
    ].includes(platform)
  ) {
    return getCcxtBalance(
      platform,
      credentials
    );
  }

  throw new Error(
    `${platform} balance connector is not available`
  );
}

// =============================
// LOGIN
// =============================

app.post(
  "/api/login",
  (req, res) => {
    const {
      email,
      password
    } = req.body || {};

    if (
      String(email || "")
        .toLowerCase() !==
        OWNER_EMAIL.toLowerCase() ||
      password !==
        OWNER_PASSWORD
    ) {
      return res
        .status(401)
        .json({
          ok: false,
          error:
            "Wrong email or password"
        });
    }

    const sessionId =
      createSession();

    res.setHeader(
      "Set-Cookie",
      `tradeai_sid=${encodeURIComponent(
        sessionId
      )}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`
    );

    res.json({
      ok: true
    });
  }
);

app.post(
  "/api/logout",
  requireLogin,
  (req, res) => {
    sessions.delete(
      req.sessionId
    );

    res.setHeader(
      "Set-Cookie",
      "tradeai_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
    );

    res.json({
      ok: true
    });
  }
);

app.get(
  "/api/me",
  (req, res) => {
    res.json({
      loggedIn:
        !!getSession(req)
    });
  }
);

// =============================
// CONNECTIONS
// =============================

app.get(
  "/api/connections",
  requireLogin,
  (req, res) => {
    const list =
      Object.entries(
        req.session
          .connections
      ).map(
        ([platform, item]) => ({
          platform,

          label:
            item.label ||
            platform,

          accountId:
            item.accountId ||
            "",

          connected: true
        })
      );

    res.json({
      ok: true,
      connections: list
    });
  }
);

app.post(
  "/api/connect",
  requireLogin,
  async (req, res) => {
    const {
      platform,
      accountId,
      label,
      apiKey,
      secret,
      passphrase
    } = req.body || {};

    if (
      !platform ||
      !apiKey ||
      !secret
    ) {
      return res
        .status(400)
        .json({
          ok: false,

          error:
            "API Key and Secret are required."
        });
    }

    const supported = [
      "Binance",
      "CoinDCX",
      "Delta Exchange",
      "Bybit",
      "OKX",
      "KuCoin"
    ];

    if (
      !supported.includes(
        platform
      )
    ) {
      return res
        .status(400)
        .json({
          ok: false,

          error:
            `${platform} needs a different connector or bridge.`
        });
    }

    if (
      ["OKX", "KuCoin"]
        .includes(platform) &&
      !passphrase
    ) {
      return res
        .status(400)
        .json({
          ok: false,

          error:
            `${platform} also requires an API passphrase.`
        });
    }

    const credentials = {
      platform,

      accountId:
        String(
          accountId || ""
        ),

      label:
        String(
          label ||
          platform
        ),

      apiKey:
        String(apiKey),

      secret:
        String(secret),

      passphrase:
        String(
          passphrase || ""
        )
    };

    try {
      // Real API verification
      const balance =
        await getPlatformBalance(
          platform,
          credentials
        );

      // Only save after successful verification
      req.session
        .connections[
          platform
        ] = credentials;

      res.json({
        ok: true,

        platform,

        label:
          credentials.label,

        balance: {
          assets:
            balance.assets,

          equity:
            balance.equity ||
            null
        }
      });
    } catch (error) {
      console.error(
        "Connection error:",
        platform,
        error
      );

      res
        .status(400)
        .json({
          ok: false,

          error:
            error.message ||
            "Connection failed"
        });
    }
  }
);

app.delete(
  "/api/connect/:platform",
  requireLogin,
  (req, res) => {
    const platform =
      decodeURIComponent(
        req.params.platform
      );

    delete req.session
      .connections[
        platform
      ];

    res.json({
      ok: true
    });
  }
);

// =============================
// REAL BALANCE
// =============================

app.get(
  "/api/balance/:platform",
  requireLogin,
  async (req, res) => {
    const platform =
      decodeURIComponent(
        req.params.platform
      );

    const credentials =
      req.session
        .connections[
          platform
        ];

    if (!credentials) {
      return res
        .status(404)
        .json({
          ok: false,

          error:
            "Platform not connected"
        });
    }

    try {
      const balance =
        await getPlatformBalance(
          platform,
          credentials
        );

      res.json({
        ok: true,

        platform,

        label:
          credentials.label,

        accountId:
          credentials.accountId,

        assets:
          balance.assets,

        equity:
          balance.equity ||
          null
      });
    } catch (error) {
      res
        .status(400)
        .json({
          ok: false,

          error:
            error.message ||
            "Balance fetch failed"
        });
    }
  }
);

// =============================
// LIVE MARKET DATA
// =============================

app.get(
  "/api/market/klines",
  requireLogin,
  async (req, res) => {
    const symbol =
      String(
        req.query.symbol ||
        "BTCUSDT"
      ).toUpperCase();

    const interval =
      String(
        req.query.interval ||
        "15m"
      );

    try {
      const url =
        "https://api.binance.com/api/v3/klines" +
        `?symbol=${encodeURIComponent(
          symbol
        )}` +
        `&interval=${encodeURIComponent(
          interval
        )}` +
        "&limit=200";

      const data =
        await fetchJson(url);

      const candles =
        data.map((item) => ({
          time:
            Number(item[0]),

          open:
            Number(item[1]),

          high:
            Number(item[2]),

          low:
            Number(item[3]),

          close:
            Number(item[4]),

          volume:
            Number(item[5])
        }));

      res.json({
        ok: true,
        candles
      });
    } catch (error) {
      res
        .status(400)
        .json({
          ok: false,

          error:
            error.message
        });
    }
  }
);

// =============================
// ROOT PAGE
// =============================

// index.html GitHub repository ke root me hai
app.get(
  "/",
  (req, res) => {
    res.sendFile(
      process.cwd() +
      "/index.html"
    );
  }
);

// =============================
// SERVER START
// =============================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `TradeAI Pro running on port ${PORT}`
    );
  }
);
