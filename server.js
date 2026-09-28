import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const UPDATE_MINUTES = 5;
const ADMIN_KEY = process.env.ADMIN_KEY || "change-me";

const posts = JSON.parse(fs.readFileSync(path.join(__dirname,"posts.json"),"utf8"));
const latestPath = path.join(__dirname,"data","latest.json");
const historyPath = path.join(__dirname,"data","history.json");

app.use(express.json());
app.use(express.static(path.join(__dirname,"public")));

const readJSON=(p,f)=>{try{return JSON.parse(fs.readFileSync(p,"utf8"))}catch{return f}};
const writeJSON=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2));
const score=r=>Number(r.likes||0)+Number(r.comments||0)+2*Number(r.reposts||0);

function parseCount(v){
  if(v==null) return null;
  const s=String(v).trim().toLowerCase().replace(/\s/g,"");
  const m=s.match(/^([\d.,]+)([km])?$/);
  if(!m) return null;
  let n=Number(m[1].replace(/,/g,""));
  if(!Number.isFinite(n)) return null;
  if(m[2]==="k") n*=1000;
  if(m[2]==="m") n*=1000000;
  return Math.round(n);
}

async function scrapeOne(browser,post){
  const page=await browser.newPage({viewport:{width:1280,height:1200},locale:"en-US"});
  try{
    await page.goto(post.url,{waitUntil:"domcontentloaded",timeout:45000});
    await page.waitForTimeout(3500);
    const text=await page.locator("body").innerText().catch(()=> "");
    const aria=await page.locator("[aria-label]").evaluateAll(els=>els.map(e=>e.getAttribute("aria-label")||"").join("\n")).catch(()=> "");
    const hay=text+"\n"+aria;
    const get=patterns=>{
      for(const p of patterns){const m=hay.match(p); if(m) return parseCount(m[1]);}
      return null;
    };
    return {
      likes:get([/([\d.,]+[kKmM]?)\s+likes?\b/i,/likes?\s*[:·]?\s*([\d.,]+[kKmM]?)/i]),
      comments:get([/([\d.,]+[kKmM]?)\s+comments?\b/i,/comments?\s*[:·]?\s*([\d.,]+[kKmM]?)/i]),
      reposts:get([/([\d.,]+[kKmM]?)\s+reposts?\b/i,/reposts?\s*[:·]?\s*([\d.,]+[kKmM]?)/i])
    };
  } finally { await page.close().catch(()=>{}); }
}

async function scrapeAll(){
  const current=readJSON(latestPath,{rows:[]});
  const old=Object.fromEntries((current.rows||[]).map(r=>[r.country,r]));
  const browser=await chromium.launch({headless:true});
  const rows=[];
  try{
    for(const post of posts){
      let s={likes:null,comments:null,reposts:null};
      try{s=await scrapeOne(browser,post)}catch{}
      const prev=old[post.country]||{country:post.country,likes:0,comments:0,reposts:0};
      rows.push({
        country:post.country,
        likes:s.likes??prev.likes,
        comments:s.comments??prev.comments,
        reposts:s.reposts??prev.reposts
      });
    }
  } finally { await browser.close().catch(()=>{}); }
  const snap={updatedAt:new Date().toISOString(),rows};
  writeJSON(latestPath,snap);
  const h=readJSON(historyPath,[]);
  h.push(snap);
  writeJSON(historyPath,h.slice(-1000));
  return snap;
}

app.get("/api/ranking",(req,res)=>{
  const d=readJSON(latestPath,{updatedAt:null,rows:[]});
  const rows=[...d.rows].map(r=>({...r,points:score(r)})).sort((a,b)=>b.points-a.points).map((r,i)=>({...r,position:i+1}));
  res.json({updatedAt:d.updatedAt,rows});
});

app.get("/api/history",(req,res)=>res.json(readJSON(historyPath,[])));

app.post("/api/admin/manual",(req,res)=>{
  if(req.headers["x-admin-key"]!==ADMIN_KEY) return res.status(401).json({error:"unauthorized"});
  const d=readJSON(latestPath,{rows:[]});
  const row=d.rows.find(r=>r.country===req.body.country);
  if(!row) return res.status(404).json({error:"not_found"});
  for(const k of ["likes","comments","reposts"]){
    if(req.body[k]!==undefined) row[k]=Math.max(0,Math.round(Number(req.body[k])||0));
  }
  d.updatedAt=new Date().toISOString();
  writeJSON(latestPath,d);
  const h=readJSON(historyPath,[]); h.push(d); writeJSON(historyPath,h.slice(-1000));
  res.json({ok:true});
});

app.post("/api/admin/scrape",async(req,res)=>{
  if(req.headers["x-admin-key"]!==ADMIN_KEY) return res.status(401).json({error:"unauthorized"});
  try{res.json({ok:true,snapshot:await scrapeAll()})}
  catch(e){res.status(500).json({error:String(e)})}
});

let busy=false;
setInterval(async()=>{
  if(busy) return;
  busy=true;
  try{await scrapeAll()}catch(e){console.error("scrape failed",e)}
  finally{busy=false}
},UPDATE_MINUTES*60*1000);

app.listen(PORT,()=>console.log(`MGI ranking on http://localhost:${PORT}`));
