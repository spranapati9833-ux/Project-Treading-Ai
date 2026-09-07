TRADEAI PRO REAL CONNECTOR

WHAT WORKS
- Login-first web app.
- Real API credential verification and real wallet/balance retrieval for:
  Binance, CoinDCX, Delta Exchange India, Bybit, OKX, KuCoin.
- Each platform uses only its own selected adapter.
- API secrets are kept in Node server memory, not browser localStorage.
- Real connected balance/assets appear in Wallet & Balance and dashboard.
- Binance public candles feed the dashboard chart and indicator bias.

NOT UNIVERSALLY DIRECT
- XM / MT5 requires a MetaTrader terminal/bridge service.
- TradingView is mainly charting/alerts and is not a universal wallet/broker balance API.
Those buttons are intentionally marked Bridge Required instead of pretending to connect.

RUN LOCALLY
1. Install Node.js 18+.
2. Open terminal in this folder.
3. Run: npm install
4. Set environment variables OWNER_EMAIL and OWNER_PASSWORD in your hosting provider.
5. Run: npm start
6. Open http://localhost:3000

DEFAULT OWNER LOGIN (change before public deployment)
Email: sprajapati9833@gmail.com
Password: SHIVPOOJAN

SECURITY
- For first testing, create read-only API keys with withdrawals disabled.
- Do not paste secret keys into static HTML-only versions.
- Production deployment should use HTTPS, persistent encrypted credential storage or a secrets manager,
  CSRF protection, rate limiting, audit logs, and stronger user authentication.
- This package does not auto-place trades. Add trade endpoints only after you have validated permissions,
  order sizing, symbol mapping, and risk controls for each exchange.
