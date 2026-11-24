const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const TurndownService = require('turndown');

const app = express();
app.use(cors());
app.use(express.json());

// RapidAPI Security Middleware
const verifyRapidAPI = (req, res, next) => {
  const proxySecret = req.headers['x-rapidapi-proxy-secret'];
  if (process.env.RAPIDAPI_SECRET && proxySecret !== process.env.RAPIDAPI_SECRET) {
    return res.status(403).json({ error: 'Unauthorized: Access allowed only via RapidAPI' });
  }
  next();
};

// Health Check Route (Render ke liye)
app.get('/', (req, res) => {
  res.json({ status: 'Active', apis: ['AI Markdown Extractor', 'SEO & Link Analyzer', 'India Utility Validator'] });
});

// ==========================================
// API 1: AI / LLM URL to Clean Markdown API
// ==========================================
app.get('/v1/ai/markdown', verifyRapidAPI, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Query parameter "url" is required' });

  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 10000
    });

    const dom = new JSDOM(response.data, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) return res.status(422).json({ error: 'Could not extract readable content from URL' });

    const turndownService = new TurndownService({ headingStyle: 'atx' });
    const markdown = turndownService.turndown(article.content);

    res.json({
      success: true,
      url,
      title: article.title,
      author: article.byline || null,
      excerpt: article.excerpt || null,
      wordCount: markdown.split(/\s+/).length,
      markdown
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch URL', details: err.message });
  }
});

// ==========================================
// API 2: SEO Meta Tags & Link Extractor API
// ==========================================
app.get('/v1/seo/analyze', verifyRapidAPI, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Query parameter "url" is required' });

  try {
    const startTime = Date.now();
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBot/1.0)' },
      timeout: 10000
    });
    const loadTimeMs = Date.now() - startTime;

    const $ = cheerio.load(response.data);
    const title = $('title').text().trim();
    const description = $('meta[name="description"]').attr('content') || '';
    const canonical = $('link[rel="canonical"]').attr('href') || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';

    const headings = {
      h1: $('h1').map((_, el) => $(el).text().trim()).get(),
      h2: $('h2').map((_, el) => $(el).text().trim()).get()
    };

    const links = { internal: [], external: [] };
    const domain = new URL(url).hostname;

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href.startsWith('http')) {
        if (href.includes(domain)) links.internal.push(href);
        else links.external.push(href);
      }
    });

    res.json({
      success: true,
      url,
      loadTimeMs,
      meta: {
        title,
        titleLength: title.length,
        description,
        descriptionLength: description.length,
        canonical,
        ogImage
      },
      headings,
      linksCount: {
        internal: links.internal.length,
        external: links.external.length
      },
      sampleExternalLinks: [...new Set(links.external)].slice(0, 20)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'SEO analysis failed', details: err.message });
  }
});

// ==========================================
// API 3: India Utility (IFSC + Format Validator)
// ==========================================
app.get('/v1/india/ifsc', verifyRapidAPI, async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Query parameter "code" (IFSC) is required' });

  const cleanIfsc = code.trim().toUpperCase();
  const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;

  if (!ifscRegex.test(cleanIfsc)) {
    return res.status(400).json({ valid: false, error: 'Invalid IFSC format' });
  }

  try {
    // Razorpay ke public IFSC database se live bank details fetch karna
    const { data } = await axios.get(`https://ifsc.razorpay.com/${cleanIfsc}`);
    res.json({ valid: true, data });
  } catch (err) {
    res.status(404).json({ valid: false, error: 'IFSC code not found in RBI directory' });
  }
});

app.get('/v1/india/validate', verifyRapidAPI, (req, res) => {
  const { gst, pan } = req.query;
  const results = {};

  if (gst) {
    const cleanGst = gst.trim().toUpperCase();
    const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    results.gst = {
      input: cleanGst,
      validFormat: gstRegex.test(cleanGst),
      stateCode: gstRegex.test(cleanGst) ? cleanGst.substring(0, 2) : null
    };
  }

  if (pan) {
    const cleanPan = pan.trim().toUpperCase();
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    results.pan = {
      input: cleanPan,
      validFormat: panRegex.test(cleanPan),
      holderType: panRegex.test(cleanPan) ? cleanPan[3] : null // P=Individual, C=Company, F=Firm
    };
  }

  if (!gst && !pan) {
    return res.status(400).json({ error: 'Provide either "gst" or "pan" query parameter' });
  }

  res.json({ success: true, results });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
