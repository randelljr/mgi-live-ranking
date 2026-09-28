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

const posts = JSON.parse(
  fs.readFileSync(path.join(__dirname, "posts.json"), "utf8")
);

const latestPath = path.join(__dirname, "data", "latest.json");
const historyPath = path.join(__dirname, "data", "history.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function score(row) {
  return (
    Number(row.likes || 0) +
    Number(row.comments || 0) +
    Number(row.reposts || 0) * 2
  );
}

function parseCount(value) {
  if (value == null) return null;

  const text = String(value)
    .trim()
    .toLowerCase()
    .replace(/\s/g, "");

  const match = text.match(/^([\d.,]+)([km])?$/i);

  if (!match) return null;

  let numberText = match[1];

  /*
    Ejemplos:
    68,400  -> 68400
    68.4k   -> 68400
    181k    -> 181000
  */

  if (
    numberText.includes(",") &&
    !numberText.includes(".") &&
    /^\d{1,3}(,\d{3})+$/.test(numberText)
  ) {
    numberText = numberText.replace(/,/g, "");
  } else {
    numberText = numberText.replace(/,/g, ".");
  }

  let number = Number(numberText);

  if (!Number.isFinite(number)) return null;

  if (match[2]?.toLowerCase() === "k") {
    number *= 1000;
  }

  if (match[2]?.toLowerCase() === "m") {
    number *= 1000000;
  }

  return Math.round(number);
}

/*
  PRUEBA TEMPORAL:
  Solo Ecuador será leído realmente desde Instagram.

  Los otros 9 países conservarán sus números actuales.

  El objetivo es descubrir qué información pública entrega Instagram
  al navegador automático de GitHub Actions.
*/

async function scrapeOne(browser, post) {
  const page = await browser.newPage({
    viewport: {
      width: 1280,
      height: 1200
    },
    locale: "en-US"
  });

  try {
    console.log("\n");
    console.log("==========================================");
    console.log("INICIANDO PRUEBA:", post.country);
    console.log("URL:", post.url);
    console.log("==========================================");

    await page.goto(post.url, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    await page.waitForTimeout(5000);

    const finalUrl = page.url();

    const title = await page
      .title()
      .catch(() => "");

    const metaDescription = await page
      .locator('meta[name="description"]')
      .getAttribute("content")
      .catch(() => null);

    const ogDescription = await page
      .locator('meta[property="og:description"]')
      .getAttribute("content")
      .catch(() => null);

    const ogTitle = await page
      .locator('meta[property="og:title"]')
      .getAttribute("content")
      .catch(() => null);

    const bodyText = await page
      .locator("body")
      .innerText()
      .catch(() => "");

    const ariaText = await page
      .locator("[aria-label]")
      .evaluateAll(elements =>
        elements
          .map(element => element.getAttribute("aria-label"))
          .filter(Boolean)
          .join("\n")
      )
      .catch(() => "");

    console.log("");
    console.log("========== INSTAGRAM DEBUG ==========");
    console.log("PAÍS:", post.country);
    console.log("URL FINAL:", finalUrl);
    console.log("");
    console.log("TÍTULO:");
    console.log(title);
    console.log("");
    console.log("OG TITLE:");
    console.log(ogTitle);
    console.log("");
    console.log("META DESCRIPTION:");
    console.log(metaDescription);
    console.log("");
    console.log("OG DESCRIPTION:");
    console.log(ogDescription);
    console.log("");
    console.log("BODY:");
    console.log(bodyText.slice(0, 5000));
    console.log("");
    console.log("ARIA:");
    console.log(ariaText.slice(0, 5000));
    console.log("");
    console.log("=====================================");
    console.log("");

    const haystack = [
      ogTitle,
      ogDescription,
      metaDescription,
      bodyText,
      ariaText
    ]
      .filter(Boolean)
      .join("\n");

    function get(patterns) {
      for (const pattern of patterns) {
        const match = haystack.match(pattern);

        if (match) {
          return parseCount(match[1]);
        }
      }

      return null;
    }

    const likes = get([
      /([\d.,]+[kKmM]?)\s+likes?\b/i,
      /likes?\s*[:·]?\s*([\d.,]+[kKmM]?)/i
    ]);

    const comments = get([
      /([\d.,]+[kKmM]?)\s+comments?\b/i,
      /comments?\s*[:·]?\s*([\d.,]+[kKmM]?)/i
    ]);

    const reposts = get([
      /([\d.,]+[kKmM]?)\s+reposts?\b/i,
      /reposts?\s*[:·]?\s*([\d.,]+[kKmM]?)/i
    ]);

    console.log("========== RESULTADO DETECTADO ==========");
    console.log("Likes:", likes);
    console.log("Comentarios:", comments);
    console.log("Reposts:", reposts);
    console.log("=========================================");
    console.log("");

    return {
      likes,
      comments,
      reposts
    };

  } catch (error) {
    console.log("");
    console.log("========== ERROR ==========");
    console.log("PAÍS:", post.country);
    console.log(String(error));
    console.log("===========================");
    console.log("");

    throw error;

  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeAll() {
  const current = readJSON(latestPath, {
    rows: []
  });

  const previousByCountry = Object.fromEntries(
    (current.rows || []).map(row => [
      row.country,
      row
    ])
  );

  const browser = await chromium.launch({
    headless: true
  });

  const rows = [];

  try {
    for (const post of posts) {
      const previous =
        previousByCountry[post.country] || {
          country: post.country,
          likes: 0,
          comments: 0,
          reposts: 0
        };

      /*
        SOLO ECUADOR SE LEE EN ESTA PRUEBA.
      */

      if (post.country === "Ecuador") {
        let scraped = {
          likes: null,
          comments: null,
          reposts: null
        };

        try {
          scraped = await scrapeOne(
            browser,
            post
          );
        } catch (error) {
          console.log(
            "ERROR ECUADOR:",
            String(error)
          );
        }

        rows.push({
          country: post.country,

          likes:
            scraped.likes ??
            previous.likes,

          comments:
            scraped.comments ??
            previous.comments,

          reposts:
            scraped.reposts ??
            previous.reposts
        });

      } else {
        /*
          Los otros países conservan
          sus valores anteriores.
        */

        rows.push({
          country: post.country,
          likes: previous.likes,
          comments: previous.comments,
          reposts: previous.reposts
        });
      }
    }

  } finally {
    await browser.close().catch(() => {});
  }

  const snapshot = {
    updatedAt: new Date().toISOString(),
    rows
  };

  writeJSON(
    latestPath,
    snapshot
  );

  const history = readJSON(
    historyPath,
    []
  );

  history.push(snapshot);

  writeJSON(
    historyPath,
    history.slice(-1000)
  );

  return snapshot;
}

app.get(
  "/api/ranking",
  (req, res) => {

    const data = readJSON(
      latestPath,
      {
        updatedAt: null,
        rows: []
      }
    );

    const rows = [
      ...data.rows
    ]
      .map(row => ({
        ...row,
        points: score(row)
      }))
      .sort(
        (a, b) =>
          b.points - a.points
      )
      .map(
        (row, index) => ({
          ...row,
          position: index + 1
        })
      );

    res.json({
      updatedAt: data.updatedAt,
      rows
    });
  }
);

app.get(
  "/api/history",
  (req, res) => {

    res.json(
      readJSON(
        historyPath,
        []
      )
    );
  }
);

app.post(
  "/api/admin/manual",
  (req, res) => {

    if (
      req.headers["x-admin-key"] !==
      ADMIN_KEY
    ) {
      return res
        .status(401)
        .json({
          error: "unauthorized"
        });
    }

    const data = readJSON(
      latestPath,
      {
        rows: []
      }
    );

    const row = data.rows.find(
      row =>
        row.country ===
        req.body.country
    );

    if (!row) {
      return res
        .status(404)
        .json({
          error:
            "country_not_found"
        });
    }

    for (
      const key of [
        "likes",
        "comments",
        "reposts"
      ]
    ) {
      if (
        req.body[key] !== undefined
      ) {
        row[key] = Math.max(
          0,
          Math.round(
            Number(
              req.body[key]
            ) || 0
          )
        );
      }
    }

    data.updatedAt =
      new Date().toISOString();

    writeJSON(
      latestPath,
      data
    );

    const history = readJSON(
      historyPath,
      []
    );

    history.push(data);

    writeJSON(
      historyPath,
      history.slice(-1000)
    );

    res.json({
      ok: true
    });
  }
);

app.post(
  "/api/admin/scrape",
  async (req, res) => {

    if (
      req.headers["x-admin-key"] !==
      ADMIN_KEY
    ) {
      return res
        .status(401)
        .json({
          error: "unauthorized"
        });
    }

    try {
      const snapshot =
        await scrapeAll();

      res.json({
        ok: true,
        snapshot
      });

    } catch (error) {
      res
        .status(500)
        .json({
          error:
            String(error)
        });
    }
  }
);

let busy = false;

setInterval(
  async () => {

    if (busy) {
      return;
    }

    busy = true;

    try {
      await scrapeAll();

    } catch (error) {
      console.error(
        "scrape failed:",
        error
      );

    } finally {
      busy = false;
    }

  },
  UPDATE_MINUTES *
    60 *
    1000
);

app.listen(
  PORT,
  () => {

    console.log(
      `MGI ranking running on http://localhost:${PORT}`
    );

    console.log(
      "PRUEBA DEBUG ACTIVADA:"
    );

    console.log(
      "Solo Ecuador se intentará leer desde Instagram."
    );
  }
);
