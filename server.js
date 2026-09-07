
import express from "express";
import crypto from "crypto";
import ccxt from "ccxt";

const app = express();
app.use(express.json({limit:"1mb"}));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const OWNER_EMAIL = process.env.OWNER_EMAIL || "sprajapati9833@gmail.com";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "SHIVPOOJAN";

// In-memory sessions/credentials: secrets never go to localStorage or frontend after connect.
// Restarting server clears sessions and exchange credentials.
const sessions = new Map();

function cookie(req,name){
  const raw=req.headers.cookie||"";
  const part=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="));
  return part?decodeURIComponent(part.slice(name.length+1)):"";
}
function newSession(){
  const id=crypto.randomBytes(32).toString("hex");
  sessions.set(id,{loggedIn:true, connections:{}});
  return id;
}
function getSession(req){
  const sid=cookie(req,"tradeai_sid");
  const s=sessions.get(sid);
  return s ? {sid,s} : null;
}
function auth(req,res,next){
  const x=getSession(req);
  if(!x) return res.status(401).json({ok:false,error:"Login required"});
  req.session=x.s; req.sid=x.sid; next();
}
function hmacHex(secret,data){
  return crypto.createHmac("sha256",secret).update(data).digest("hex");
}
async function jsonFetch(url,opts={}){
  const r=await fetch(url,opts);
  const text=await r.text();
  let data; try{ data=JSON.parse(text) }catch{ data={raw:text} }
  if(!r.ok) throw new Error(data?.msg || data?.message || data?.error || `HTTP ${r.status}`);
  return data;
}

async function coinDcxBalance(c){
  const timestamp=Date.now();
  const body=JSON.stringify({timestamp});
  const signature=hmacHex(c.secret,body);
  const data=await jsonFetch("https://api.coindcx.com/exchange/v1/users/balances",{
    method:"POST",
    headers:{
      "content-type":"application/json",
      "X-AUTH-APIKEY":c.apiKey,
      "X-AUTH-SIGNATURE":signature
    },
    body
  });
  const assets=(Array.isArray(data)?data:[]).filter(x=>Number(x.balance||0)!==0 || Number(x.locked_balance||0)!==0)
    .map(x=>({asset:x.currency,free:Number(x.balance||0),locked:Number(x.locked_balance||0),total:Number(x.balance||0)+Number(x.locked_balance||0)}));
  return {assets, raw:data};
}

async function deltaBalance(c){
  const method="GET", timestamp=Math.floor(Date.now()/1000).toString(), path="/v2/wallet/balances", query="", body="";
  const signature=hmacHex(c.secret, method+timestamp+path+query+body);
  const data=await jsonFetch("https://api.india.delta.exchange"+path,{
    headers:{
      "accept":"application/json",
      "api-key":c.apiKey,
      "signature":signature,
      "timestamp":timestamp,
      "User-Agent":"tradeai-pro-node",
      "content-type":"application/json"
    }
  });
  const assets=(data.result||[]).filter(x=>Number(x.balance||0)!==0 || Number(x.available_balance||0)!==0)
    .map(x=>({asset:x.asset_symbol,free:Number(x.available_balance||0),locked:Number(x.blocked_margin||0),total:Number(x.balance||0)}));
  return {assets, equity:data?.meta?.net_equity || null, raw:data};
}

function ccxtExchange(platform,c){
  const common={apiKey:c.apiKey, secret:c.secret, enableRateLimit:true};
  if(platform==="Binance") return new ccxt.binance(common);
  if(platform==="Bybit") return new ccxt.bybit(common);
  if(platform==="OKX") return new ccxt.okx({...common,password:c.passphrase||""});
  if(platform==="KuCoin") return new ccxt.kucoin({...common,password:c.passphrase||""});
  throw new Error("Unsupported CCXT platform");
}
async function ccxtBalance(platform,c){
  const ex=ccxtExchange(platform,c);
  const b=await ex.fetchBalance();
  const assets=[];
  for(const asset of Object.keys(b.total||{})){
    const total=Number(b.total[asset]||0), free=Number((b.free||{})[asset]||0), used=Number((b.used||{})[asset]||0);
    if(total!==0 || free!==0 || used!==0) assets.push({asset,free,locked:used,total});
  }
  return {assets, raw:null};
}
async function getBalance(platform,c){
  if(platform==="CoinDCX") return coinDcxBalance(c);
  if(platform==="Delta Exchange") return deltaBalance(c);
  if(["Binance","Bybit","OKX","KuCoin"].includes(platform)) return ccxtBalance(platform,c);
  throw new Error(`${platform} does not have a compatible direct balance connector in this package.`);
}

app.post("/api/login",(req,res)=>{
  const {email,password}=req.body||{};
  if(String(email||"").toLowerCase()!==OWNER_EMAIL.toLowerCase() || password!==OWNER_PASSWORD){
    return res.status(401).json({ok:false,error:"Wrong email or password"});
  }
  const sid=newSession();
  res.setHeader("Set-Cookie",`tradeai_sid=${encodeURIComponent(sid)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
  res.json({ok:true});
});
app.post("/api/logout",auth,(req,res)=>{
  sessions.delete(req.sid);
  res.setHeader("Set-Cookie","tradeai_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  res.json({ok:true});
});
app.get("/api/me",(req,res)=>res.json({loggedIn:!!getSession(req)}));

app.get("/api/connections",auth,(req,res)=>{
  const list=Object.entries(req.session.connections).map(([platform,c])=>({
    platform,label:c.label||platform,accountId:c.accountId||"",connected:true
  }));
  res.json({ok:true,connections:list});
});

app.post("/api/connect",auth,async(req,res)=>{
  const {platform,accountId,label,apiKey,secret,passphrase}=req.body||{};
  if(!platform || !apiKey || !secret) return res.status(400).json({ok:false,error:"API Key and Secret are required."});
  const allowed=["Binance","CoinDCX","Delta Exchange","Bybit","OKX","KuCoin"];
  if(!allowed.includes(platform)) return res.status(400).json({ok:false,error:`${platform} needs a different connector/bridge and cannot be connected by this API form.`});
  if(["OKX","KuCoin"].includes(platform) && !passphrase) return res.status(400).json({ok:false,error:`${platform} also requires API passphrase.`});

  const creds={platform,accountId:String(accountId||""),label:String(label||platform),apiKey:String(apiKey),secret:String(secret),passphrase:String(passphrase||"")};
  try{
    const bal=await getBalance(platform,creds); // validates key belongs to selected platform
    req.session.connections[platform]=creds;
    res.json({ok:true,platform,label:creds.label,balance:{assets:bal.assets,equity:bal.equity||null}});
  }catch(e){
    res.status(400).json({ok:false,error:e.message || "Connection failed"});
  }
});

app.delete("/api/connect/:platform",auth,(req,res)=>{
  delete req.session.connections[decodeURIComponent(req.params.platform)];
  res.json({ok:true});
});

app.get("/api/balance/:platform",auth,async(req,res)=>{
  const platform=decodeURIComponent(req.params.platform);
  const c=req.session.connections[platform];
  if(!c) return res.status(404).json({ok:false,error:"Platform not connected"});
  try{
    const bal=await getBalance(platform,c);
    res.json({ok:true,platform,label:c.label,accountId:c.accountId,assets:bal.assets,equity:bal.equity||null});
  }catch(e){res.status(400).json({ok:false,error:e.message||"Balance fetch failed"})}
});

app.get("/api/market/klines",auth,async(req,res)=>{
  const symbol=String(req.query.symbol||"BTCUSDT").toUpperCase();
  const interval=String(req.query.interval||"15m");
  try{
    const data=await jsonFetch(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=200`);
    res.json({ok:true,candles:data.map(k=>({time:k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]}))});
  }catch(e){res.status(400).json({ok:false,error:e.message})}
});

app.listen(PORT,()=>console.log(`TradeAI Pro running on http://localhost:${PORT}`));
