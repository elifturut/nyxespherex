/* eslint-disable */
/**
 * @title NYXE — SPHEREx Time-Domain Astronomy & Citizen Science Console (Proof-of-Concept Prototype)
 * @author Elif Turut
 * @copyright © 2026 Elif Turut. All rights reserved.
 * @version 3.8 (custom logo-matched NYXE wordmark; new logo; mobile-first navigation; PDF challenge coverage retained)
 *
 * @description
 * Single-file React application (Tailwind CSS, HTML5 Canvas) for exploring multi-epoch
 * near-infrared sky data in 102 spectral bands (0.75–5.0 µm) and for recording citizen-science candidates.
 *
 *   1. Real Data       CDS hips2fits sky photographs (2MASS / AllWISE) with SIMBAD TAP (ADQL) sources;
 *                      NASA/IPAC IRSA SPHEREx Level-2 cutouts (FITS, WCS + SIP, aperture photometry,
 *                      proper-motion fit, Planck SED fit); local FITS/PNG/JPG reader (pure-JS, offline).
 *   2. Discovery Map   Real SIMBAD / IMCCE SkyBoT field (positions, proper motions, parallaxes, Solar System
 *                      ephemerides) or a procedural training sky; blink, difference, curtain and photo modes.
 *   3. Catalogue       Searchable records and a time archive of saved discoveries; JSON / CSV / VOTable and
 *                      Python (astropy) export. Interface languages: TR, EN, ES, DE, JA.
 *
 * @remarks
 * Proof-of-concept: positions, proper motions and photographs come from real services or files. The 102-band
 * SPHEREx-like spectral cubes of the Discovery Map and of the simulation are physically motivated model
 * values (Planck + molecular absorption), not SPHEREx measurements. Real SPHEREx pixels are only analysed
 * in the "Real SPHEREx Data" tab (IRSA download or user-supplied FITS files).
 *
 * @example
 * npm create vite@latest spherex -- --template react
 * // Tailwind: add <script src="https://cdn.tailwindcss.com"></script> to index.html,
 * // or `npm i tailwindcss @tailwindcss/vite` and use the tailwindcss() Vite plugin.
 * // Replace src/App.jsx with this file, then `npm run dev`.
 * // Keyboard (Discovery Map): 1–5 view mode · Space blink · F swap dates · ←/→ band (Shift ×5)
 *
 * @acknowledgement
 * This publication makes use of data products from the Spectro-Photometer for the History of the Universe,
 * Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory
 * and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration.
 */
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';


/* =====================================================================
   BÖLÜM 1 — SABİTLER
   ===================================================================== */
const W = 720;                     // kanvas / görüntü genişliği (piksel)
const H = 720;
const PLATE = 1.5;                 // arcsec / piksel (sentetik kesit ölçeği)
const ARCSEC = Math.PI / 180 / 3600;
const DEG = Math.PI / 180;
const N_BANDS = 102;
const C2 = 14387.7688;             // hc/k  [µm·K]
const AB0_UJY = 3.631e9;           // AB sıfır noktası = 3631 Jy = 3.631e9 µJy
const SOLAR_T = 5772;
const GAIN_MAX = 10;               // didaktik hareket çarpanı üst sınırı
const KAPPA_BD = 0.45;             // kahverengi cüce renk-kesimi katsayısı
const PARALLAX_T0 = 2025.2;        // paralaks fazı (Mart sonu)

// SPHEREx'in 6 lineer değişken filtre (LVF) dizisi · her dizi 17 kanal → 102 bant
const SEG_EDGES = [0.75, 1.11, 1.65, 2.42, 3.82, 4.42, 5.0];

const EPOCHS = [
  { id: 0, name: 'Epoch 1', date: 'Ocak 2025', t: 2025.0, iso: '2025-01-01' },
  { id: 1, name: 'Epoch 2', date: 'Temmuz 2025', t: 2025.5, iso: '2025-07-01' },
  { id: 2, name: 'Epoch 3', date: 'Ocak 2026', t: 2026.0, iso: '2026-01-01' },
  { id: 3, name: 'Epoch 4', date: 'Temmuz 2026', t: 2026.5, iso: '2026-07-01' },
];
const GAIN_JITTER = [1.0, 1.0012, 0.9991, 1.0008];   // epoch başına fotometrik kalibrasyon oynaması

const FLAG_CLASSES = [
  { id: 'bd', label: 'Kahverengi Cüce', color: '#FF3366' },
  { id: 'asteroid', label: 'Ana Kuşak Asteroidi', color: '#FFB454' },
  { id: 'kbo', label: 'Kuiper Kuşağı Cismi / Planet X Adayı', color: '#B58CFF' },
  { id: 'variable', label: 'Değişen Yıldız / Süpernova', color: '#7CFFB2' },
  { id: 'comet', label: 'Kuyruklu Yıldız', color: '#00F0FF' },
  { id: 'other', label: 'Diğer / Belirsiz', color: '#9AA7BD' },
];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pad2 = (n) => String(n).padStart(2, '0');

const BAND_LAMBDA = new Float64Array(N_BANDS);   // bant merkezleri [µm]
const BAND_R = new Float64Array(N_BANDS);        // λ/Δλ
for (let i = 0; i < N_BANDS; i++) {
  const seg = Math.floor(i / 17);
  const j = i % 17;
  const a = SEG_EDGES[seg];
  const b = SEG_EDGES[seg + 1];
  BAND_LAMBDA[i] = a * Math.pow(b / a, (j + 0.5) / 17);
  BAND_R[i] = 17 / Math.log(b / a);
}
function nearestBand(lam) {
  let best = 0;
  let bd = 1e9;
  for (let i = 0; i < N_BANDS; i++) {
    const d = Math.abs(BAND_LAMBDA[i] - lam);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/* =====================================================================
   BÖLÜM 2 — DETERMİNİSTİK RASTGELE SAYI ÜRETECİ
   ===================================================================== */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seedStr) {
  const r = mulberry32(xmur3(String(seedStr)));
  return {
    next: r,
    range: (a, b) => a + (b - a) * r(),
    int: (a, b) => Math.floor(a + (b - a + 1) * r()),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    normal: () => {
      let u = 0;
      while (u === 0) u = r();
      const v = r();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

/* =====================================================================
   BÖLÜM 3 — ASTRONOMİK KOORDİNATLAR (J2000)
   ===================================================================== */
function wrap360(a) { a %= 360; return a < 0 ? a + 360 : a; }

function fmtRA(raDeg, digits = 1) {
  const f = Math.pow(10, digits);
  let tot = (wrap360(raDeg) / 15) * 3600;
  tot = Math.round(tot * f) / f;
  if (tot >= 86400) tot -= 86400;
  const h = Math.floor(tot / 3600);
  const m = Math.floor((tot - h * 3600) / 60);
  const s = tot - h * 3600 - m * 60;
  return `${pad2(h)}h ${pad2(m)}m ${s.toFixed(digits).padStart(digits ? digits + 3 : 2, '0')}s`;
}
function fmtDec(decDeg, digits = 0) {
  const sign = decDeg < 0 ? '-' : '+';
  const f = Math.pow(10, digits);
  let tot = Math.abs(decDeg) * 3600;
  tot = Math.round(tot * f) / f;
  const d = Math.floor(tot / 3600);
  const m = Math.floor((tot - d * 3600) / 60);
  const s = tot - d * 3600 - m * 60;
  return `${sign}${pad2(d)}° ${pad2(m)}' ${s.toFixed(digits).padStart(digits ? digits + 3 : 2, '0')}"`;
}
const fmtRAshort = (ra) => fmtRA(ra, 0).replace(/ /g, '');
const fmtDecshort = (dec) => fmtDec(dec, 0).replace(/ /g, '');

// "14h29m42.9s" · "14 29 42.9" · "217.4287"  ve  "-62d40m46s" · "-62 40 46" · "-62.6797"
function parseAngle(str, kind) {
  const raw = String(str).replace(/\u2212/g, '-').trim();
  if (!raw) return NaN;
  const neg = raw.startsWith('-');
  const hasH = /h/i.test(raw);
  const parts = raw
    .replace(/[hHdDmMsS°′″'":,]/g, ' ')
    .replace(/[+-]/g, ' ')
    .trim()
    .split(/\s+/)
    .map(Number);
  if (!parts.length || parts.some((p) => !isFinite(p))) return NaN;
  let val = Math.abs(parts[0]) + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600;
  if (neg) val = -val;
  if (kind === 'ra' && (hasH || parts.length > 1)) val *= 15;
  return val;
}

function eqToGal(ra, dec) {
  const a = ra * DEG, d = dec * DEG;
  const aG = 192.85948 * DEG, dG = 27.12825 * DEG, lN = 122.93192 * DEG;
  const sinb = Math.sin(dG) * Math.sin(d) + Math.cos(dG) * Math.cos(d) * Math.cos(a - aG);
  const y = Math.cos(d) * Math.sin(a - aG);
  const x = Math.cos(dG) * Math.sin(d) - Math.sin(dG) * Math.cos(d) * Math.cos(a - aG);
  return { l: wrap360((lN - Math.atan2(y, x)) / DEG), b: Math.asin(clamp(sinb, -1, 1)) / DEG };
}
const OBLIQ = 23.4392911 * DEG;
function eqToEcl(ra, dec) {
  const a = ra * DEG, d = dec * DEG;
  const sinb = Math.sin(d) * Math.cos(OBLIQ) - Math.cos(d) * Math.sin(OBLIQ) * Math.sin(a);
  const lon = Math.atan2(Math.sin(a) * Math.cos(OBLIQ) * Math.cos(d) + Math.sin(d) * Math.sin(OBLIQ), Math.cos(a) * Math.cos(d));
  return { lon: wrap360(lon / DEG), lat: Math.asin(clamp(sinb, -1, 1)) / DEG };
}
function eclToEq(lon, lat) {
  const L = lon * DEG, B = lat * DEG;
  const sind = Math.sin(B) * Math.cos(OBLIQ) + Math.cos(B) * Math.sin(OBLIQ) * Math.sin(L);
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQ) * Math.cos(B) - Math.sin(B) * Math.sin(OBLIQ), Math.cos(L) * Math.cos(B));
  return { ra: wrap360(ra / DEG), dec: Math.asin(clamp(sind, -1, 1)) / DEG };
}

// Gnomonik (TAN) projeksiyon · kuzey yukarı, doğu SOLDA (gökyüzü yönelimi)
function makeWCS(ra0, dec0) {
  const a0 = ra0 * DEG, d0 = dec0 * DEG;
  const s = PLATE * ARCSEC;
  const sd0 = Math.sin(d0), cd0 = Math.cos(d0);
  return {
    ra0, dec0,
    pixToSky(x, y) {
      const xi = -(x - W / 2) * s;
      const eta = -(y - H / 2) * s;
      const den = cd0 - eta * sd0;
      const ra = a0 + Math.atan2(xi, den);
      const dec = Math.atan2((sd0 + eta * cd0) * Math.cos(ra - a0), den);
      return { ra: wrap360(ra / DEG), dec: dec / DEG };
    },
    skyToPix(ra, dec) {
      const a = ra * DEG, d = dec * DEG;
      const cosc = sd0 * Math.sin(d) + cd0 * Math.cos(d) * Math.cos(a - a0);
      const xi = (Math.cos(d) * Math.sin(a - a0)) / cosc;
      const eta = (cd0 * Math.sin(d) - sd0 * Math.cos(d) * Math.cos(a - a0)) / cosc;
      return { x: W / 2 - xi / s, y: H / 2 - eta / s };
    },
  };
}

/* =====================================================================
   BÖLÜM 4 — SPEKTRAL FİZİK  (F_ν şekilleri · Planck + soğurma/emisyon)
   ===================================================================== */
const nu = (lam, T) => Math.pow(lam, -3) / Math.expm1(C2 / (lam * T));     // B_ν(λ,T) ∝ λ⁻³ /(e^{hc/λkT}−1)
const gau = (x, c, s) => { const z = (x - c) / s; return Math.exp(-0.5 * z * z); };
const sstep = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const flat = (x, c, w, p) => Math.exp(-Math.pow(Math.abs((x - c) / w), p));  // düz tabanlı çukur/pencere

// Anakol yıldızları (O…M): Planck + H çizgileri (sıcak), H⁻ tümseği/CO/H₂O (soğuk)
function shapeStar(lam, p) {
  const T = p.T;
  let f = nu(lam, T);
  if (T > 7500) {
    const d = T > 14000 ? 0.035 : 0.085;
    const lines = [1.282, 1.875, 2.166, 3.741, 4.052, 4.654];       // Paβ, Paα, Brγ, Pfγ, Brα, Pfβ
    for (let i = 0; i < lines.length; i++) f *= 1 - d * gau(lam, lines[i], lines[i] / 60);
  } else if (T < 5200) {
    const cool = Math.min(1, (5200 - T) / 2000);
    f *= 1 + 0.05 * cool * gau(lam, 1.6, 0.14);                     // H⁻ opaklık minimumu → 1.6 µm tümseği
    f *= 1 - 0.10 * cool * gau(lam, 2.38, 0.10);                    // CO birinci overtone
    f *= 1 - 0.14 * cool * gau(lam, 4.67, 0.13);                    // CO temel bandı
    if (T < 4000) {
      f *= 1 - 0.07 * gau(lam, 1.40, 0.06);                         // H₂O
      f *= 1 - 0.10 * gau(lam, 1.90, 0.08);
      f *= 1 - 0.08 * gau(lam, 2.80, 0.20);
      f *= 1 - 0.06 * gau(lam, 4.00, 0.10);                         // SiO
    }
  }
  return f;
}

// Galaksiler: yaşlı yıldız nüfusu + sıcak toz (4-5 µm yükselişi) + 3.3 µm PAH
function shapeGalaxy(lam, p) {
  const st = shapeStar(lam, { T: 4300 }) / shapeStar(1.25, { T: 4300 });
  const dust = p.fd * 0.8 * (nu(lam, 850) / nu(4.6, 850)) * sstep(lam, 2.0, 3.6);
  const pah = p.pah * gau(lam, 3.29, 0.065) + 0.35 * p.pah * gau(lam, 3.42, 0.05);
  return st + dust + pah;
}

// T/Y tipi kahverengi cüceler · parlaklık sıcaklığı Tb(λ) = T_eff·m(λ):
//  opak CH₄/H₂O bantlarında soğuk üst atmosfer (m≈0.6), pencerelerde (Y,J,H,K,4.5 µm) derin sıcak katman
function shapeBD(lam, p) {
  const jm = p.jm;
  const win = [[1.07, 0.030, jm * 1.04], [1.27, 0.050, jm], [1.58, 0.068, jm * 0.88], [2.10, 0.085, jm * 0.78], [3.80, 0.14, 0.86]];
  let m = 0.60;
  for (let i = 0; i < win.length; i++) m += (win[i][2] - 0.60) * gau(lam, win[i][0], win[i][1]);
  m += 0.40 * flat(lam, 4.55, 0.55, 4);                              // 4-5 µm penceresi
  let f = nu(lam, p.Teff * m);
  f *= 1 - 0.10 * gau(lam, 4.67, 0.10);                              // dengesizlik CO
  f *= 1 - 0.06 * gau(lam, 4.26, 0.045);
  return f;
}

// Asteroitler: yansıyan Güneş ışığı × yansıtma + termal kuyruk (>3.5 µm)
function shapeAsteroid(lam, p) {
  const solar = nu(lam, SOLAR_T) / nu(1.25, SOLAR_T);
  let r = Math.max(0.35, 1 + p.slope * (lam - 1.25));
  if (p.type === 'S') {
    r *= 1 - 0.20 * gau(lam, 0.95, 0.09);                            // olivin-piroksen 1 µm
    r *= 1 - 0.09 * gau(lam, 1.95, 0.20);                            // 2 µm bandı
  } else if (p.type === 'C') {
    r *= 1 - 0.14 * gau(lam, 2.72, 0.07);                            // hidrate mineral (OH)
    r *= 1 - 0.05 * gau(lam, 3.10, 0.09);
  } else {
    r *= 1 - 0.04 * gau(lam, 0.90, 0.10);
  }
  const th = p.k * (nu(lam, p.Tth) / nu(5.0, p.Tth));
  return solar * r + th;
}

// Kuyruklu yıldızlar: kırmızı toz + 3.0 µm su buzu çukuru + CO₂ 4.26 / CO 4.67 / H₂O 2.7 / C–H 3.4 emisyonu
function shapeComet(lam, p) {
  const base = (l) => {
    const solar = nu(l, SOLAR_T) / nu(1.25, SOLAR_T);
    let refl = solar * Math.max(0.3, 1 + p.slope * (l - 1.25));
    refl *= 1 - p.ice * flat(l, 3.0, 0.22, 3);
    return refl + p.k * (nu(l, p.Tth) / nu(5.0, p.Tth));
  };
  let f = base(lam);
  f += p.co2 * base(4.26) * gau(lam, 4.26, 0.045);
  f += p.co * base(4.67) * gau(lam, 4.67, 0.06);
  f += p.h2o * base(2.70) * gau(lam, 2.70, 0.06);
  f += p.ch * base(3.40) * gau(lam, 3.40, 0.07);
  return f;
}

// Buzlu KBO / Centaur: çok kırmızı eğim + su buzu (1.5, 2.0, 3.0 µm) + CO₂ buzu 4.27 µm soğurması
function shapeKBO(lam, p) {
  const solar = nu(lam, SOLAR_T) / nu(1.25, SOLAR_T);
  let r = Math.max(0.25, 1 + p.slope * (lam - 1.25));
  r *= 1 - p.ice15 * gau(lam, 1.50, 0.07) - 0.7 * p.ice15 * gau(lam, 2.0, 0.09);
  r *= 1 - p.ice * flat(lam, 3.0, 0.24, 3);
  r *= 1 - p.co2 * gau(lam, 4.27, 0.04);
  return solar * r;
}

const SHAPES = { star: shapeStar, galaxy: shapeGalaxy, bd: shapeBD, asteroid: shapeAsteroid, comet: shapeComet, kbo: shapeKBO };

// Kaynağın 102 banttaki F_ν spektrumu [µJy]; referans λ'daki AB kadiri sabit tutulur
function buildSpectrum(src) {
  const f = SHAPES[src.model];
  const ref = f(src.refLam, src.p);
  const out = new Float32Array(N_BANDS);
  const F0 = AB0_UJY * Math.pow(10, -0.4 * src.abRef);
  const aj = src.redAJ || 0;
  const redRef = Math.pow(1.25 / src.refLam, 1.7);
  for (let b = 0; b < N_BANDS; b++) {
    const l = BAND_LAMBDA[b];
    let v = (F0 * f(l, src.p)) / ref;
    if (aj > 0) v *= Math.pow(10, -0.4 * aj * (Math.pow(1.25 / l, 1.7) - redRef));   // toz sönümü A_λ ∝ λ^-1.7
    out[b] = v;
  }
  return out;
}

// Zodiakal ışık: saçılan güneş ışığı + 260 K termal (3.5-4 µm'de minimum, 5 µm'e doğru yükselir)
function zodi(lam) { return nu(lam, SOLAR_T) / nu(1.25, SOLAR_T) + 0.6 * (nu(lam, 260) / nu(5.0, 260)); }
function noiseSigma(lam) { return 0.08 * Math.sqrt(1 + 1.5 * zodi(lam)); }          // µJy / piksel
function bgLevel(lam) { return 4.0 * zodi(lam); }                                    // µJy / piksel (gösterim için)
function psfFwhmPx(lam) { return (3.6 + 0.65 * lam) / PLATE; }                       // PSF FWHM [px]

// Orion bulutu: dağınık emisyon spektrumu (saçılma + 3.3 PAH + sıcak toz + Brα + H₂)
function nebulaSpec(lam) {
  const scat = 0.30 * (nu(lam, 7500) / nu(1.25, 7500));
  const pah = gau(lam, 3.29, 0.065) + 0.28 * gau(lam, 3.42, 0.06) + 0.12 * gau(lam, 3.50, 0.05);
  const dust = 0.35 * sstep(lam, 3.6, 4.9) * (0.6 + 0.4 * (lam - 3.6) / 1.4);
  const bra = 0.28 * gau(lam, 4.05, 0.035);
  const h2 = 0.10 * gau(lam, 2.12, 0.04);
  return scat + pah + dust + bra + h2;
}

/* =====================================================================
   BÖLÜM 5 — SEKTÖRLER ve SENTETİK GÖKYÜZÜ ÜRETİCİ
   ===================================================================== */
const SECTORS = [
  { id: 's1', short: 'ECL', name: 'Sektör 1', title: 'Ekliptik Düzlem', sub: 'Asteroit & Kuyruklu Yıldız Yoğun Bölge',
    ecl: { lon: 165, lat: 0 }, redMax: 0.05, nebula: false, plan: ['asteroidS', 'asteroidC', 'asteroidX', 'comet', 'snia'] },
  { id: 's2', short: 'NGP', name: 'Sektör 2', title: 'Yüksek Galaktik Enlem', sub: 'Soğuk Y-Cücesi & Gezegen X Arama Bölgesi',
    eq: { ra: 192.8595, dec: 27.1283 }, redMax: 0.02, nebula: false, plan: ['bdY', 'bdYfast', 'bdT', 'planetx', 'hpm'] },
  { id: 's3', short: 'ORI', name: 'Sektör 3', title: 'Orion Moleküler Bulutu', sub: 'Su Buzu ve PAH Emisyon Bölgesi',
    eq: { ra: 83.8221, dec: -5.3911 }, redMax: 2.2, nebula: true, plan: ['kbo', 'comet', 'bdT', 'asteroidX', 'yso'] },
  { id: 's4', short: 'USR', name: 'Sektör 4', title: 'Özel Koordinat Girişi', sub: 'Kullanıcının RA/Dec girdiği mod', custom: true },
];
const DEFAULT_CUSTOM = { raStr: '14h 29m 42.9s', decStr: "-62° 40' 46\"", ra: parseAngle('14h 29m 42.9s', 'ra'), dec: parseAngle("-62° 40' 46\"", 'dec') };

function sectorConfig(sec, custom) {
  let ra, dec;
  if (sec.ecl) { const q = eclToEq(sec.ecl.lon, sec.ecl.lat); ra = q.ra; dec = q.dec; }
  else if (sec.eq) { ra = sec.eq.ra; dec = sec.eq.dec; }
  else { ra = custom.ra; dec = custom.dec; }
  const gal = eqToGal(ra, dec);
  const ecl = eqToEcl(ra, dec);
  let plan = sec.plan;
  let redMax = sec.redMax;
  let nebula = !!sec.nebula;
  if (sec.custom) {
    const r = makeRng(`plan|${ra.toFixed(3)}|${dec.toFixed(3)}`);
    plan = [];
    if (Math.abs(ecl.lat) < 25) {
      plan.push('asteroidS', 'asteroidX');
      plan.push(r.next() < 0.6 ? 'comet' : 'asteroidC');
    } else {
      plan.push('bdT', 'bdY');
      plan.push(r.next() < 0.5 ? 'planetx' : 'hpm');
    }
    plan.push(r.next() < 0.5 ? 'snia' : 'mira');
    const ab = Math.abs(gal.b);
    redMax = ab < 8 ? 1.6 : ab < 25 ? 0.6 : 0.05;
    nebula = false;
  }
  return {
    id: sec.id, name: sec.name, title: sec.title, sub: sec.sub,
    key: sec.id + (sec.custom ? `:${ra.toFixed(4)}:${dec.toFixed(4)}` : ''),
    ra, dec, gal, ecl, plan, redMax, nebula,
  };
}

const STAR_TYPES = [
  { cls: 'O', w: 0.002, T: [28000, 42000] }, { cls: 'B', w: 0.012, T: [11000, 24000] },
  { cls: 'A', w: 0.045, T: [7800, 10500] }, { cls: 'F', w: 0.14, T: [6200, 7500] },
  { cls: 'G', w: 0.23, T: [5300, 6100] }, { cls: 'K', w: 0.30, T: [3900, 5100] },
  { cls: 'M', w: 0.271, T: [2800, 3800] },
];

function sampleMag(rng, m0, m1, alpha) {
  const u = rng.next();
  return m0 + Math.log10(1 + u * (Math.pow(10, alpha * (m1 - m0)) - 1)) / alpha;
}

function finishSource(s) {
  if (!s.vr) s.vr = [1, 1, 1, 1];
  if (s.vx === undefined) { s.vx = 0; s.vy = 0; }
  s.spec = buildSpectrum(s);
  return s;
}

// Epoch 1 → Epoch 4 yolu, çarpan = GAIN_MAX iken bile kare içinde kalsın
function placeMover(rng, vx, vy) {
  const span = ((EPOCHS[3].t - EPOCHS[0].t) * GAIN_MAX) / PLATE;
  for (let k = 0; k < 120; k++) {
    const x0 = rng.range(0.12 * W, 0.88 * W);
    const y0 = rng.range(0.12 * H, 0.88 * H);
    const x3 = x0 + vx * span, y3 = y0 + vy * span;
    if (x3 > 30 && x3 < W - 30 && y3 > 30 && y3 < H - 30) return { x0, y0 };
  }
  return { x0: W / 2 - (vx * span) / 2, y0: H / 2 - (vy * span) / 2 };
}

// Kaynağın epoch e'deki piksel konumu (özdevinim + paralaks, didaktik çarpan = gain)
function posAt(s, e, gain) {
  // Gerçek alan kaynakları: epoch başına hesaplanmış gerçek konum (özdevinim + paralaks / SkyBoT efemerisi)
  if (s.track) return s.track[e] || s.track.find(Boolean) || { x: s.x0, y: s.y0 };
  if (!s.mover) return { x: s.x0, y: s.y0 };
  const dt = EPOCHS[e].t - EPOCHS[0].t;
  const ph = 2 * Math.PI * (EPOCHS[e].t - PARALLAX_T0);
  const ph0 = 2 * Math.PI * (EPOCHS[0].t - PARALLAX_T0);
  const k = gain / PLATE;
  return {
    x: s.x0 + (s.vx * dt + s.plx * (Math.cos(ph) - Math.cos(ph0))) * k,
    y: s.y0 + (s.vy * dt + s.plx * s.plxK * (Math.sin(ph) - Math.sin(ph0))) * k,
  };
}

function makeMover(kind, rng, id, cfg) {
  const ang = rng.range(0, 2 * Math.PI);
  const base = {
    id, kind, hidden: true, mover: true, refLam: 1.25, redAJ: cfg.redMax * rng.next() * 0.3,
    plxK: 0.6, plx: 0.3,
  };
  let mu = 0;
  const rot = () => [0, 1, 2, 3].map(() => rng.range(0.86, 1.14));
  switch (kind) {
    case 'asteroidS':
      Object.assign(base, { model: 'asteroid', truth: 'asteroid', label: 'S-tipi asteroit',
        p: { type: 'S', slope: 0.30, Tth: rng.range(210, 250), k: rng.range(0.7, 1.4) }, abRef: rng.range(19.0, 20.3), plx: rng.range(0.3, 0.8), vr: rot() });
      mu = rng.range(13, 22); break;
    case 'asteroidC':
      Object.assign(base, { model: 'asteroid', truth: 'asteroid', label: 'C-tipi (karbonlu) asteroit',
        p: { type: 'C', slope: -0.05, Tth: rng.range(215, 245), k: rng.range(1.1, 2.0) }, abRef: rng.range(20.0, 21.0), plx: rng.range(0.3, 0.8), vr: rot() });
      mu = rng.range(10, 18); break;
    case 'asteroidX':
      Object.assign(base, { model: 'asteroid', truth: 'asteroid', label: 'Hızlı X-tipi asteroit',
        p: { type: 'X', slope: 0.12, Tth: rng.range(225, 255), k: rng.range(0.9, 1.5) }, abRef: rng.range(19.5, 20.3), plx: rng.range(0.3, 0.8), vr: rot() });
      mu = rng.range(20, 26); break;
    case 'comet':
      Object.assign(base, { model: 'comet', truth: 'comet', label: 'Aktif kuyruklu yıldız (CO₂ komalı)',
        p: { slope: 0.35, ice: 0.45, k: 0.8, Tth: 230, co2: rng.range(1.0, 1.5), co: 0.45, h2o: 0.35, ch: 0.30 },
        abRef: rng.range(18.8, 19.6), plx: rng.range(0.4, 0.9), vr: [1, 1.08, 0.92, 0.78],
        coma: rng.range(3.5, 5.5), tail: rng.range(16, 30), tailAng: rng.range(0, 2 * Math.PI) });
      mu = rng.range(9, 16); break;
    case 'bdT':
      Object.assign(base, { model: 'bd', truth: 'bd', label: 'T-tipi kahverengi cüce',
        p: { Teff: rng.range(900, 1200), jm: 1.38 }, refLam: 4.5, abRef: rng.range(17.6, 18.8), plx: 0.22, vr: [1, 1.02, 0.99, 1.01] });
      mu = rng.range(3.5, 6.5); break;
    case 'bdY':
      Object.assign(base, { model: 'bd', truth: 'bd', label: 'Y-tipi kahverengi cüce',
        p: { Teff: rng.range(330, 450), jm: 1.45 }, refLam: 4.5, abRef: rng.range(17.2, 18.6), plx: 0.3, vr: [1, 1.01, 1.0, 1.02] });
      mu = rng.range(4.5, 6.5); break;
    case 'bdYfast':
      Object.assign(base, { model: 'bd', truth: 'bd', label: 'Hızlı Y-tipi cüce',
        p: { Teff: rng.range(300, 380), jm: 1.45 }, refLam: 4.5, abRef: rng.range(16.8, 17.8), plx: 0.38, vr: [1, 1, 1.01, 1] });
      mu = rng.range(7.0, 8.2); break;
    case 'planetx':
      Object.assign(base, { model: 'bd', truth: 'kbo', label: 'Soğuk cisim (Planet X adayı · sentetik)',
        p: { Teff: 250, jm: 1.5 }, refLam: 4.8, abRef: rng.range(18.4, 19.2), plx: rng.range(5, 7), plxK: 0.55, vr: [1, 1, 1, 1] });
      mu = rng.range(1.0, 2.0); break;
    case 'kbo':
      Object.assign(base, { model: 'kbo', truth: 'kbo', label: 'Buzlu KBO (H₂O + CO₂ buzu)',
        p: { slope: 0.8, ice15: 0.12, ice: 0.62, co2: 0.5 }, abRef: rng.range(20.6, 21.4), plx: rng.range(2.5, 4), vr: [1, 1, 1, 1] });
      mu = rng.range(4, 9); break;
    case 'hpm':
      Object.assign(base, { model: 'star', truth: 'other', cls: 'M', label: 'Yüksek özdevinimli M cücesi (yanıltıcı)',
        p: { T: 3300 }, abRef: rng.range(17.4, 18.4), plx: 0.5 });
      mu = rng.range(8, 14); break;
    case 'snia':
      Object.assign(base, { model: 'star', truth: 'variable', cls: 'SN', label: 'Süpernova (Ia benzeri, sabit konum)',
        p: { T: 9500 }, abRef: rng.range(19.4, 20.2), vr: [0.015, 1.0, 0.33, 0.07], mover: false });
      break;
    case 'yso':
      Object.assign(base, { model: 'star', truth: 'variable', cls: 'YSO', label: 'Değişen genç yıldız (YSO)',
        p: { T: 4000 }, abRef: rng.range(18.0, 19.0), vr: [1.0, 0.28, 0.65, 1.7], mover: false });
      break;
    case 'mira':
      Object.assign(base, { model: 'star', truth: 'variable', cls: 'Mira', label: 'Mira tipi değişen',
        p: { T: 3000 }, abRef: rng.range(18.0, 18.8), vr: [0.45, 1.0, 2.1, 0.9], mover: false });
      break;
    default: break;
  }
  if (base.mover) {
    const ang2 = ang;
    base.vx = mu * Math.cos(ang2);
    base.vy = mu * Math.sin(ang2);
    const pl = placeMover(rng, base.vx, base.vy);
    base.x0 = pl.x0; base.y0 = pl.y0;
  } else {
    base.vx = 0; base.vy = 0;
    base.x0 = rng.range(0.15 * W, 0.85 * W);
    base.y0 = rng.range(0.15 * H, 0.85 * H);
  }
  return finishSource(base);
}

// Orion için fBm tabanlı filamentli bulut alanı [0..1]
function makeNebula(seed) {
  const rng = makeRng(seed);
  const out = new Float32Array(W * H);
  const octs = [[5, 1.0], [10, 0.6], [20, 0.35], [40, 0.2], [80, 0.12]];
  let sumA = 0;
  for (let o = 0; o < octs.length; o++) {
    const n = octs[o][0], amp = octs[o][1];
    sumA += amp;
    const gw = n + 2;
    const grid = new Float32Array(gw * gw);
    for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
    const cell = W / n;
    for (let y = 0; y < H; y++) {
      const fy = y / cell; const iy = Math.floor(fy); const ty = fy - iy; const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < W; x++) {
        const fx = x / cell; const ix = Math.floor(fx); const tx = fx - ix; const sx = tx * tx * (3 - 2 * tx);
        const a = grid[iy * gw + ix], b = grid[iy * gw + ix + 1], c = grid[(iy + 1) * gw + ix], d = grid[(iy + 1) * gw + ix + 1];
        out[y * W + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = out[i] / sumA;
      v = 1 - Math.abs(2 * v - 1);                       // ridge → filament görünümü
      v = Math.pow(v, 2.4);
      const dx = x - 0.38 * W, dy = y - 0.42 * H;
      v *= 0.30 + 0.70 * Math.exp(-(dx * dx + dy * dy) / (2 * Math.pow(0.40 * W, 2)));
      out[i] = v;
    }
  }
  return out;
}

function makeCosmicRays(rng) {
  const n = rng.int(26, 42);
  const arr = [];
  for (let i = 0; i < n; i++) {
    if (rng.next() < 0.55) arr.push({ x: rng.range(0, W), y: rng.range(0, H), len: 1, ang: 0, amp: rng.range(5, 70) });
    else arr.push({ x: rng.range(0, W), y: rng.range(0, H), len: rng.int(3, 9), ang: rng.range(0, Math.PI), amp: rng.range(4, 35) });
  }
  return arr;
}

function generateSky(cfg) {
  const rng = makeRng('SPHEREx-sky|' + cfg.key);
  const wcs = makeWCS(cfg.ra, cfg.dec);
  const absb = Math.abs(cfg.gal.b);
  const nStars = clamp(Math.round(170 + 720 * Math.exp(-absb / 16)), 150, 900);
  const nGal = Math.round(16 + 64 * (1 - Math.exp(-absb / 12)));
  const sources = [];
  let nextId = 1;

  for (let i = 0; i < nStars; i++) {
    const mag = sampleMag(rng, 15.2, 22.6, 0.33);
    const r = rng.next();
    let acc = 0;
    let st = STAR_TYPES[STAR_TYPES.length - 1];
    for (let k = 0; k < STAR_TYPES.length; k++) { acc += STAR_TYPES[k].w; if (r < acc) { st = STAR_TYPES[k]; break; } }
    sources.push(finishSource({
      id: nextId++, kind: 'star', model: 'star', cls: st.cls, truth: 'star', label: 'Anakol yıldızı',
      p: { T: rng.range(st.T[0], st.T[1]) }, refLam: 1.25, abRef: mag, redAJ: rng.next() * cfg.redMax,
      x0: rng.range(-4, W + 4), y0: rng.range(-4, H + 4), mover: false, hidden: false,
    }));
  }
  for (let i = 0; i < nGal; i++) {
    const mag = rng.range(17.6, 22.2);
    sources.push(finishSource({
      id: nextId++, kind: 'galaxy', model: 'galaxy', truth: 'galaxy', label: 'Galaksi',
      p: { fd: rng.next() < 0.4 ? rng.range(0.15, 0.9) : rng.range(0, 0.2), pah: rng.next() < 0.5 ? rng.range(0.05, 0.35) : 0.02 },
      refLam: 1.25, abRef: mag, redAJ: rng.next() * cfg.redMax * 0.3,
      x0: rng.range(0, W), y0: rng.range(0, H), mover: false, hidden: false,
      rad: rng.range(1.5, 4.5) * (1 + (22.2 - mag) * 0.25), q: rng.range(0.35, 1), pa: rng.range(0, Math.PI),
    }));
  }
  for (let i = 0; i < cfg.plan.length; i++) sources.push(makeMover(cfg.plan[i], rng, nextId++, cfg));

  const noise = [0, 1, 2, 3].map((e) => {
    const r = makeRng(`${cfg.key}|noise|${e}`);
    const a = new Float32Array(W * H);
    for (let i = 0; i < a.length; i += 2) {
      let u = 0;
      while (u === 0) u = r.next();
      const v = r.next();
      const m = Math.sqrt(-2 * Math.log(u));
      a[i] = m * Math.cos(2 * Math.PI * v);
      if (i + 1 < a.length) a[i + 1] = m * Math.sin(2 * Math.PI * v);
    }
    return a;
  });
  const cr = [0, 1, 2, 3].map((e) => makeCosmicRays(makeRng(`${cfg.key}|cr|${e}`)));
  const nebula = cfg.nebula ? makeNebula(`${cfg.key}|nebula`) : null;
  return {
    key: cfg.key, cfg, wcs, sources, byId: new Map(sources.map((s) => [s.id, s])),
    noise, cr, nebula, nebAmp: 1.4, nTargets: cfg.plan.length,
  };
}

/* =====================================================================
   BÖLÜM 6 — GÖRÜNTÜ SENTEZİ  (PSF sıçratma · gürültü · kozmik ışın)
   Tüm görüntüler arka plan çıkarılmış F_ν [µJy / piksel] cinsindendir.
   ===================================================================== */
const _gx = new Float32Array(512);
const _gy = new Float32Array(512);

function splatGauss(img, w, h, cx, cy, sigma, flux) {
  const R = Math.min(120, Math.ceil(4 * sigma));
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(w - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(h - 1, Math.ceil(cy + R));
  if (x1 < x0 || y1 < y0) return;
  const k = -0.5 / (sigma * sigma);
  for (let i = x0; i <= x1; i++) { const d = i + 0.5 - cx; _gx[i - x0] = Math.exp(k * d * d); }
  for (let j = y0; j <= y1; j++) { const d = j + 0.5 - cy; _gy[j - y0] = Math.exp(k * d * d); }
  const amp = flux / (2 * Math.PI * sigma * sigma);
  for (let j = y0; j <= y1; j++) {
    const ay = amp * _gy[j - y0];
    const row = j * w;
    for (let i = x0; i <= x1; i++) img[row + i] += ay * _gx[i - x0];
  }
}

// Dönük eliptik Gauss (galaksi, koma, kuyruk): sa = büyük eksen σ, sb = küçük eksen σ, theta = büyük eksen açısı
function splatEllipse(img, w, h, cx, cy, sa, sb, theta, flux) {
  const R = Math.min(170, Math.ceil(4 * Math.max(sa, sb)));
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(w - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(h - 1, Math.ceil(cy + R));
  if (x1 < x0 || y1 < y0) return;
  const c = Math.cos(theta), s = Math.sin(theta);
  const amp = flux / (2 * Math.PI * sa * sb);
  for (let j = y0; j <= y1; j++) {
    const dy = j + 0.5 - cy;
    for (let i = x0; i <= x1; i++) {
      const dx = i + 0.5 - cx;
      const u = (dx * c + dy * s) / sa;
      const v = (-dx * s + dy * c) / sb;
      const e = u * u + v * v;
      if (e > 32) continue;
      img[j * w + i] += amp * Math.exp(-0.5 * e);
    }
  }
}

// Parlak yıldızlar için kırınım dikenleri (4 kollu)
function addSpikes(img, w, h, cx, cy, flux, sigma) {
  const L = clamp(Math.round(14 + 16 * Math.log10(flux / 1000)), 12, 56);
  const a0 = flux * 0.0045;
  const k0 = Math.max(2, 2 * sigma);
  for (let k = Math.ceil(k0); k <= L; k++) {
    const v = a0 * Math.pow(k0 / k, 1.2);
    const pts = [[cx + k, cy], [cx - k, cy], [cx, cy + k], [cx, cy - k]];
    for (let q = 0; q < 4; q++) {
      const ix = Math.floor(pts[q][0]), iy = Math.floor(pts[q][1]);
      if (ix >= 0 && ix < w && iy >= 0 && iy < h) img[iy * w + ix] += v;
    }
  }
}

function drawSource(img, w, h, s, fl, x, y, sp) {
  if (s.model === 'galaxy') {
    const sc = Math.hypot(s.rad, sp), sh = Math.hypot(2.4 * s.rad, sp);
    splatEllipse(img, w, h, x, y, sc, sc * s.q, s.pa, fl * 0.62);
    splatEllipse(img, w, h, x, y, sh, sh * s.q, s.pa, fl * 0.38);
  } else if (s.model === 'comet') {
    splatGauss(img, w, h, x, y, sp, fl * 0.28);
    splatEllipse(img, w, h, x, y, Math.hypot(s.coma, sp), Math.hypot(s.coma * 0.9, sp), 0, fl * 0.42);
    const tx = x + Math.cos(s.tailAng) * s.tail * 0.5;
    const ty = y + Math.sin(s.tailAng) * s.tail * 0.5;
    splatEllipse(img, w, h, tx, ty, Math.hypot(s.tail * 0.45, sp), Math.hypot(s.coma * 0.55, sp), s.tailAng, fl * 0.30);
  } else {
    if (s.model === 'star' && !s.mover && fl > 400) {
      splatGauss(img, w, h, x, y, sp, fl * 0.94);
      splatGauss(img, w, h, x, y, sp * 2.8, fl * 0.06);               // halo
      if (fl > 1000) addSpikes(img, w, h, x, y, fl, sp);
    } else {
      splatGauss(img, w, h, x, y, sp, fl);
    }
  }
}

function drawCosmicRays(img, w, h, list) {
  for (let q = 0; q < list.length; q++) {
    const c = list[q];
    if (c.len <= 1) {
      const ix = Math.floor(c.x), iy = Math.floor(c.y);
      if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
        img[iy * w + ix] += c.amp;
        if (ix + 1 < w) img[iy * w + ix + 1] += c.amp * 0.18;
      }
    } else {
      for (let k = 0; k < c.len; k++) {
        const ix = Math.floor(c.x + Math.cos(c.ang) * k), iy = Math.floor(c.y + Math.sin(c.ang) * k);
        if (ix >= 0 && ix < w && iy >= 0 && iy < h) img[iy * w + ix] += c.amp * (0.7 + 0.3 * (((k * 7) % 3) / 2));
      }
    }
  }
}

// epoch e, bant b için tam görüntü (gürültü + bulut + kaynaklar + kozmik ışınlar)
function renderBand(sky, e, b, gain) {
  const img = new Float32Array(W * H);
  const lam = BAND_LAMBDA[b];
  const sig = noiseSigma(lam);
  const nz = sky.noise[e];
  for (let i = 0; i < img.length; i++) img[i] = nz[i] * sig;
  if (sky.nebula) {
    const amp = nebulaSpec(lam) * sky.nebAmp;
    const nf = sky.nebula;
    for (let i = 0; i < img.length; i++) img[i] += nf[i] * amp;
  }
  const sp = psfFwhmPx(lam) / 2.3548;
  const jit = GAIN_JITTER[e];
  for (let q = 0; q < sky.sources.length; q++) {
    const s = sky.sources[q];
    const fl = s.spec[b] * s.vr[e] * jit;
    if (!(fl > 1e-4)) continue;
    const p = posAt(s, e, gain);
    if (p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) continue;
    drawSource(img, W, H, s, fl, p.x, p.y, sp);
  }
  drawCosmicRays(img, W, H, sky.cr[e]);
  return img;
}

/* ---------- Görüntü önbelleği ve "spektral görünüm" sağlayıcı ---------- */
function makeCache() { return { map: new Map() }; }
function trimCache(cache) {
  while (cache.map.size > 24) cache.map.delete(cache.map.keys().next().value);
}
function getBandImage(sky, cache, e, b, gain) {
  const key = `b|${e}|${b}|${gain}`;
  let v = cache.map.get(key);
  if (!v) {
    v = { img: renderBand(sky, e, b, gain), sigma: noiseSigma(BAND_LAMBDA[b]) };
    cache.map.set(key, v);
    trimCache(cache);
  }
  return v;
}
// spec: {kind:'band', b} | {kind:'bd'} (4.5 µm fazlalığı) | {kind:'ice'} (3.0 µm buz indeksi)
function getView(sky, cache, e, spec, gain) {
  if (spec.kind === 'band') return getBandImage(sky, cache, e, spec.b, gain);
  const key = `v|${spec.kind}|${e}|${gain}`;
  let v = cache.map.get(key);
  if (v) return v;
  const img = new Float32Array(W * H);
  let sigma;
  if (spec.kind === 'bd') {
    const b16 = nearestBand(1.6), b45 = nearestBand(4.5);
    const a = getBandImage(sky, cache, e, b16, gain).img;
    const c = getBandImage(sky, cache, e, b45, gain).img;
    for (let i = 0; i < img.length; i++) img[i] = c[i] - KAPPA_BD * a[i];
    sigma = Math.hypot(noiseSigma(BAND_LAMBDA[b45]), KAPPA_BD * noiseSigma(BAND_LAMBDA[b16]));
  } else {
    const b25 = nearestBand(2.5), b30 = nearestBand(3.0), b36 = nearestBand(3.6);
    const a25 = getBandImage(sky, cache, e, b25, gain).img;
    const a30 = getBandImage(sky, cache, e, b30, gain).img;
    const a36 = getBandImage(sky, cache, e, b36, gain).img;
    for (let i = 0; i < img.length; i++) img[i] = 0.94 * 0.5 * (a25[i] + a36[i]) - a30[i];
    sigma = Math.hypot(noiseSigma(BAND_LAMBDA[b30]), 0.47 * noiseSigma(BAND_LAMBDA[b25]), 0.47 * noiseSigma(BAND_LAMBDA[b36]));
  }
  v = { img, sigma };
  cache.map.set(key, v);
  trimCache(cache);
  return v;
}

/* ---------- Piksel manipülasyonu: asinh gerilimi ve 4 mod ---------- */
function stretchParams(sigma, k) {
  const s = 3 * sigma;
  const lo = Math.asinh(-sigma / s);
  const hi = Math.asinh((1500 * sigma) / s) / k;
  return { s, lo, inv: 1 / (hi - lo) };
}

// Mod A / D için tek epoch gri tonlama (tint ile renk eğilimi)
function composeSingle(out, f, sigma, k, tint) {
  const sp = stretchParams(sigma, k);
  const r = tint[0] * 255, g = tint[1] * 255, bl = tint[2] * 255;
  for (let i = 0, p = 0; i < f.length; i++, p += 4) {
    let v = (Math.asinh(f[i] / sp.s) - sp.lo) * sp.inv;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    out[p] = v * r; out[p + 1] = v * g; out[p + 2] = v * bl; out[p + 3] = 255;
  }
}

// Mod B: Epoch A → Kırmızı (R) · Epoch B → Camgöbeği (G+B)
function composeRGB(out, f1, f2, sigma, k) {
  const sp = stretchParams(sigma, k);
  for (let i = 0, p = 0; i < f1.length; i++, p += 4) {
    let v1 = (Math.asinh(f1[i] / sp.s) - sp.lo) * sp.inv;
    let v2 = (Math.asinh(f2[i] / sp.s) - sp.lo) * sp.inv;
    v1 = v1 < 0 ? 0 : v1 > 1 ? 1 : v1;
    v2 = v2 < 0 ? 0 : v2 > 1 ? 1 : v2;
    out[p] = v1 * 255; out[p + 1] = v2 * 255; out[p + 2] = v2 * 255; out[p + 3] = 255;
  }
}

// Mod C: |Epoch B − Epoch A|, eşik altı → tam siyah
function composeDiff(out, f1, f2, sigma, thrK, k) {
  const sd = sigma * Math.SQRT2;
  const t = thrK * sd;
  const s = 3 * sd;
  const inv = 1 / Math.asinh((250 * sd) / s);
  for (let i = 0, p = 0; i < f1.length; i++, p += 4) {
    const d = Math.abs(f2[i] - f1[i]) - t;
    let v = d <= 0 ? 0 : Math.asinh(d / s) * inv * k;
    v = v > 1 ? 1 : v;
    out[p] = v * 200; out[p + 1] = v * 250; out[p + 2] = v * 255; out[p + 3] = 255;
  }
}

// Mod D: perde — solda Epoch A, sağda Epoch B
function composeCurtain(out, f1, f2, sigma, k, tint, splitX) {
  const sp = stretchParams(sigma, k);
  const sx = clamp(Math.round(splitX), 0, W);
  const r = tint[0] * 255, g = tint[1] * 255, bl = tint[2] * 255;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const idx = j * W + i;
      const f = i < sx ? f1[idx] : f2[idx];
      let v = (Math.asinh(f / sp.s) - sp.lo) * sp.inv;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      const p = idx * 4;
      out[p] = v * r; out[p + 1] = v * g; out[p + 2] = v * bl; out[p + 3] = 255;
    }
  }
}

/* =====================================================================
   BÖLÜM 7 — ÖLÇÜM: spektrum çıkarımı · astrometri · tanılama
   ===================================================================== */
// Açıklık fotometrisi: model spektrum + deterministik açıklık gürültüsü (102 bant)
function apertureSpectrum(sky, src, e) {
  const rng = makeRng(`${sky.key}|spec|${src.id}|${e}`);
  const flux = new Float32Array(N_BANDS);
  const err = new Float32Array(N_BANDS);
  const jit = GAIN_JITTER[e];
  const scale = src.model === 'comet' ? 2.4 : src.model === 'galaxy' ? 1.8 : 1;
  for (let b = 0; b < N_BANDS; b++) {
    const lam = BAND_LAMBDA[b];
    const fw = psfFwhmPx(lam);
    const nap = Math.PI * Math.pow(1.4 * fw, 2) * scale;
    const sg = (noiseSigma(lam) * Math.sqrt(nap)) / 0.92;
    flux[b] = src.spec[b] * src.vr[e] * jit + rng.normal() * sg;
    err[b] = sg;
  }
  return { flux, err };
}

function bestBand(src) {
  let vmax = 0;
  for (let i = 0; i < src.vr.length; i++) vmax = Math.max(vmax, src.vr[i]);
  let bb = 0, bv = -1;
  for (let b = 0; b < N_BANDS; b++) {
    const v = (src.spec[b] * vmax) / noiseSigma(BAND_LAMBDA[b]);
    if (v > bv) { bv = v; bb = b; }
  }
  return bb;
}

// Kaynağı bir "stamp" içinde (kendi gürültüsüyle) yeniden sentezleyip Gauss ağırlıklı centroid ölç.
// Başlangıç: tespit konumu (stamp merkezi, ±0.7 px). Pencere 3 yinelemede geniş, sonra PSF boyutuna daralır.
// Genişlemiş kaynaklarda (galaksi) etkin boyut sEff = √(σ_PSF² + (1.7·r)²) kullanılır → hata bütçesi gerçekçi olur.
function centroidStamp(sky, src, e, b, gain) {
  const half = 16, n = 2 * half + 1;
  const p = posAt(src, e, gain);
  const ox = Math.floor(p.x) - half, oy = Math.floor(p.y) - half;
  const lam = BAND_LAMBDA[b];
  const sig = noiseSigma(lam);
  const sp = psfFwhmPx(lam) / 2.3548;
  const sEff = Math.hypot(sp, (src.model === 'galaxy' ? 1.7 : 1) * (src.rad || 0));   // galaksi: 2 bileşenli profilin 2. moment boyutu ≈ 1.7·rad
  const rng = makeRng(`${sky.key}|cen|${src.id}|${e}|${b}`);
  const img = new Float32Array(n * n);
  for (let i = 0; i < img.length; i++) img[i] = rng.normal() * sig;
  const fl = src.spec[b] * src.vr[e] * GAIN_JITTER[e];
  if (fl > 1e-4) drawSource(img, n, n, src, fl, p.x - ox, p.y - oy, sp);
  let cx = half + 0.5, cy = half + 0.5;
  const swEnd = Math.max(1.2, sEff * 1.1);
  for (let it = 0; it < 10; it++) {
    const sw = it < 3 ? Math.max(swEnd, 2.5) : swEnd;
    let sx = 0, sy = 0, sv = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const dx = i + 0.5 - cx, dy = j + 0.5 - cy;
        const wgt = Math.exp((-0.5 * (dx * dx + dy * dy)) / (sw * sw));
        const v = img[j * n + i] * wgt;
        sx += v * (i + 0.5); sy += v * (j + 0.5); sv += v;
      }
    }
    if (!(sv > 0)) break;
    cx = clamp(sx / sv, 0, n); cy = clamp(sy / sv, 0, n);
  }
  const snr = fl / (sig * sEff * 3.5449);
  const err = Math.min(5, sEff / Math.max(snr, 0.3));
  return { x: ox + cx, y: oy + cy, snr, err };
}

// Epoch A → Epoch B astrometrisi: Δθ [arcsec], μ [arcsec/yıl], konum açısı, μα*, μδ
function measureAstrometry(sky, src, eA, eB, gain) {
  const b = bestBand(src);
  const cA = centroidStamp(sky, src, eA, b, gain);
  const cB = centroidStamp(sky, src, eB, b, gain);
  const dx = cB.x - cA.x, dy = cB.y - cA.y;
  const dtheta = Math.hypot(dx, dy) * PLATE;
  const dthetaErr = Math.hypot(cA.err, cB.err) * PLATE;
  const dtYr = EPOCHS[eB].t - EPOCHS[eA].t;
  const muRA = dtYr !== 0 ? (-dx * PLATE) / dtYr : 0;       // doğu SOLDA → Δα* = −Δx
  const muDec = dtYr !== 0 ? (-dy * PLATE) / dtYr : 0;
  return {
    valid: cA.snr >= 3 && cB.snr >= 3 && eA !== eB,
    band: b, cenA: cA, cenB: cB, dx, dy, dtheta, dthetaErr, dtYr,
    mu: Math.hypot(muRA, muDec), muRA, muDec,
    muErr: dtYr !== 0 ? dthetaErr / Math.abs(dtYr) : 0,
    pa: wrap360(Math.atan2(muRA, muDec) / DEG),
    signif: dthetaErr > 0 ? dtheta / dthetaErr : 0,
    gain,
  };
}

function bandAvg(sp, l0, w) {
  let sw = 0, sf = 0, n = 0;
  for (let b = 0; b < N_BANDS; b++) {
    if (Math.abs(BAND_LAMBDA[b] - l0) <= w) {
      const wt = 1 / (sp.err[b] * sp.err[b]);
      sw += wt; sf += wt * sp.flux[b]; n++;
    }
  }
  if (!n) { const b = nearestBand(l0); return { v: sp.flux[b], e: sp.err[b] }; }
  return { v: sf / sw, e: 1 / Math.sqrt(sw) };
}

// Ölçülen spektrumdan renkler, soğurma/emisyon özellikleri ve kural tabanlı sınıf önerisi
function diagnose(spA, spB) {
  const det = (x) => x.v / x.e;
  const f10 = bandAvg(spB, 1.0, 0.05), f125 = bandAvg(spB, 1.25, 0.07), f16 = bandAvg(spB, 1.6, 0.07);
  const f21 = bandAvg(spB, 2.1, 0.10), f45 = bandAvg(spB, 4.5, 0.12), f48 = bandAvg(spB, 4.8, 0.10);
  const c25 = bandAvg(spB, 2.5, 0.08), f30 = bandAvg(spB, 3.0, 0.08), c36 = bandAvg(spB, 3.6, 0.10);

  const cont30 = 0.94 * 0.5 * (c25.v + c36.v);
  const cont30e = 0.47 * Math.hypot(c25.e, c36.e);
  const iceOK = cont30 > 4 * cont30e;
  const iceDepth = iceOK ? 1 - f30.v / cont30 : NaN;
  const iceErr = iceOK ? Math.hypot(f30.e / cont30, (f30.v * cont30e) / (cont30 * cont30)) : NaN;

  const c426 = bandAvg(spB, 4.26, 0.02), cl = bandAvg(spB, 4.12, 0.04), cr = bandAvg(spB, 4.40, 0.03);
  const contCO2 = 0.5 * (cl.v + cr.v), contCO2e = 0.5 * Math.hypot(cl.e, cr.e);
  const co2OK = contCO2 > 4 * contCO2e;
  const co2x = co2OK ? c426.v / contCO2 - 1 : NaN;
  const co2e = co2OK ? Math.hypot(c426.e / contCO2, (c426.v * contCO2e) / (contCO2 * contCO2)) : NaN;

  const p33 = bandAvg(spB, 3.29, 0.05), pl = bandAvg(spB, 3.12, 0.05), pr = bandAvg(spB, 3.62, 0.08);
  const contP = 0.5 * (pl.v + pr.v), contPe = 0.5 * Math.hypot(pl.e, pr.e);
  const pahOK = contP > 4 * contPe;
  const pahx = pahOK ? p33.v / contP - 1 : NaN;
  const pahe = pahOK ? Math.hypot(p33.e / contP, (p33.v * contPe) / (contP * contP)) : NaN;

  const therm = f48.v / Math.max(f45.v, 1e-9);
  const cr1645 = f16.v / Math.max(f45.v, 1e-9);

  let sA = 0, sB = 0, eA2 = 0, eB2 = 0, snrBest = 0;
  for (let b = 0; b < N_BANDS; b++) {
    sA += spA.flux[b]; sB += spB.flux[b]; eA2 += spA.err[b] * spA.err[b]; eB2 += spB.err[b] * spB.err[b];
    snrBest = Math.max(snrBest, spB.flux[b] / spB.err[b], spA.flux[b] / spA.err[b]);
  }
  const meanA = sA / N_BANDS, meanB = sB / N_BANDS, meanE = Math.sqrt(eA2 + eB2) / N_BANDS;
  const varSig = Math.abs(meanB - meanA) / meanE;
  const varRatio = meanA > 3 * meanE ? meanB / meanA : meanB > 3 * meanE ? Infinity : 1;

  let Tc = NaN;
  if (det(f10) > 8 && det(f21) > 8) {
    const r = f10.v / f21.v;
    const g = (T) => nu(1.0, T) / nu(2.1, T);
    let lo = 2200, hi = 45000;
    if (r <= g(lo)) Tc = lo;
    else if (r >= g(hi)) Tc = hi;
    else { for (let i = 0; i < 40; i++) { const mid = 0.5 * (lo + hi); if (g(mid) < r) lo = mid; else hi = mid; } Tc = 0.5 * (lo + hi); }
  }

  const detect45 = det(f45) > 5, detect16 = det(f16) > 3, detect125 = det(f125) > 5;
  let guess;
  if (snrBest < 5) guess = { id: 'other', key: 'weak', label: 'Zayıf sinyal — sınıflandırılamadı' };
  else if (varSig > 6 && (varRatio > 1.45 || varRatio < 0.69)) guess = { id: 'variable', key: 'variable', label: 'Değişen kaynak / geçici olay (akı değişimi)' };
  else if (detect45 && (!detect16 || f16.v < 0.6 * f45.v)) {
    // 1.6 µm'de sönük, 4.5 µm'de parlak → T/Y cücesi ya da soğuk cisim (CH₄/H₂O 3 µm çukuru buz ile karışmasın diye önce bakılır)
    guess = therm > 1.3
      ? { id: 'kbo', key: 'cold', label: 'Soğuk cisim / Planet X adayı (4.8 µm termal)' }
      : { id: 'bd', key: 'bd', label: 'Kahverengi cüce (T/Y · 4.5 µm fazlalığı)' };
  } else if (iceOK && iceDepth > 0.30 && iceDepth / iceErr > 4) {
    guess = co2OK && co2x > 0.35 && co2x / co2e > 3
      ? { id: 'comet', key: 'comet', label: 'Kuyruklu yıldız (3 µm buz + CO₂ emisyonu)' }
      : { id: 'kbo', key: 'icy', label: 'Buzlu cisim · KBO / Centaur (3 µm buz çukuru)' };
  } else if (detect45 && therm > 1.25 && detect125) guess = { id: 'asteroid', key: 'asteroid', label: 'Asteroit (yansıma + termal kuyruk)' };
  else if (pahOK && pahx > 0.25 && pahx / pahe > 3) guess = { id: 'other', key: 'pah', label: 'Galaksi / PAH ışıması (3.3 µm)' };
  else guess = { id: 'other', key: 'star', label: 'Anakol yıldızı' + (isFinite(Tc) ? ` (T_renk ≈ ${Math.round(Tc / 50) * 50} K)` : '') };

  return {
    guess, snrBest, varSig, varRatio, Tc,
    colorRatio: { v: cr1645, snr: Math.min(det(f16), det(f45)) },
    thermal: therm, ice: { depth: iceDepth, err: iceErr, ok: iceOK },
    co2: { x: co2x, err: co2e, ok: co2OK }, pah: { x: pahx, err: pahe, ok: pahOK },
    meanA, meanB,
  };
}

function analyzeObject(sky, src, eA, eB, gain) {
  const posA = posAt(src, eA, gain), posB = posAt(src, eB, gain);
  const spA = apertureSpectrum(sky, src, eA), spB = apertureSpectrum(sky, src, eB);
  const astro = measureAstrometry(sky, src, eA, eB, gain);
  const cA = astro.valid ? astro.cenA : posA, cB = astro.valid ? astro.cenB : posB;
  return {
    type: 'object', src, posA, posB, spA, spB, astro,
    skyA: sky.wcs.pixToSky(cA.x, cA.y), skyB: sky.wcs.pixToSky(cB.x, cB.y),
    diag: diagnose(spA, spB),
  };
}

function analyzeBlank(sky, x, y) {
  const flux = new Float32Array(N_BANDS), err = new Float32Array(N_BANDS);
  for (let b = 0; b < N_BANDS; b++) { flux[b] = bgLevel(BAND_LAMBDA[b]); err[b] = noiseSigma(BAND_LAMBDA[b]); }
  const s = sky.wcs.pixToSky(x, y);
  return { type: 'blank', pos: { x, y }, skyA: s, skyB: s, spA: { flux, err }, spB: { flux, err } };
}

function pickSource(sky, x, y, eA, eB, gain, rad) {
  let best = null;
  let bd = rad * rad;
  for (let q = 0; q < sky.sources.length; q++) {
    const s = sky.sources[q];
    const pts = s.mover ? [posAt(s, eA, gain), posAt(s, eB, gain)] : [posAt(s, 0, gain)];
    for (let k = 0; k < pts.length; k++) {
      const dx = pts[k].x - x, dy = pts[k].y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = s; }
    }
  }
  return best;
}

/* =====================================================================
   BÖLÜM 8 — KATALOG · DEĞİŞİM TARAMASI · "NEDEN DEĞİŞTİ?" MANTIĞI
   (React'ten bağımsız saf JS: yalnız ölçüm sonuçlarına dayanır, gizli gerçeğe bakmaz)
   ===================================================================== */
const KNOWN_KINDS = ['hpm', 'yso', 'mira', 'bdT', 'asteroidC'];        // sektörde "halihazırda kayıtlı" olan hareketli/değişen cisimler
const CATS = ['bd', 'asteroid', 'comet', 'kbo', 'variable', 'star', 'galaxy', 'other'];
const V_TAN_MAX = 100;                                                 // km/s · mesafe üst sınırı için varsayım

const fin = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
function shortHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 900 + 100;
}

function catOfSource(src) {
  if (src.kind === 'star') return 'star';
  if (src.kind === 'galaxy') return 'galaxy';
  return src.truth;                                                    // bd · asteroid · comet · kbo · variable · other
}
// Gerçek alanda sıra numarası oturumlar arasında değişebilir; kalıcı kayıt anahtarı katalog adından türetilir
const objKeyOf = (sky, src) => (src.real ? `${sky.key}#${src.catId}` : `${sky.key}#${src.id}`);
// Kayıtlı bir girdinin (e.srcId / e.catId) bu gökyüzündeki kaynağı
const srcOfEntry = (sky, e) => {
  if (!sky || !e) return null;
  if (sky.real) return (e.catId && sky.byCat.get(e.catId)) || null;
  return e.srcId ? sky.byId.get(e.srcId) || null : null;
};
// Gerçek alanda hareket çarpanı uygulanmaz (×1): ölçülen hareket doğrudan fiziksel değerdir
const gainOf = (sky, g) => (sky && sky.real ? 1 : g);

// Sektörün "bilinen katalog" listesi: parlak yıldızlar + parlak galaksiler + önceden kayıtlı hareketli/değişen cisimler
const _knownMemo = new WeakMap();
function knownCatalog(sky) {
  if (_knownMemo.has(sky)) return _knownMemo.get(sky);
  if (sky.real) {                                                      // gerçek alan: SIMBAD / SkyBoT'ta kayıtlı her cisim "bilinen"dir
    const list = sky.sources.map((s) => {
      const sk = sky.wcs.pixToSky(s.x0, s.y0);
      return {
        id: s.catId, known: true, objKey: objKeyOf(sky, s), srcId: s.id, sectorId: sky.cfg.id, sectorKey: sky.key,
        cat: catOfSource(s), kind: s.kind, stype: s.cls || '', ra: sk.ra, dec: sk.dec, x: s.x0, y: s.y0, ab: s.abRef, refLam: s.refLam, firstEpoch: 0,
      };
    });
    const out = { list, ids: new Set(list.map((k) => k.srcId)), byObj: new Map(list.map((k) => [k.objKey, k])) };
    _knownMemo.set(sky, out);
    return out;
  }
  const secId = sky.cfg.id;
  const tag = secId === 's4' ? `U${shortHash(sky.key)}` : secId.toUpperCase();
  const stars = sky.sources.filter((s) => s.kind === 'star').sort((a, b) => a.abRef - b.abRef).slice(0, 14);
  const gals = sky.sources.filter((s) => s.kind === 'galaxy').sort((a, b) => a.abRef - b.abRef).slice(0, 5);
  const movers = sky.sources.filter((s) => KNOWN_KINDS.indexOf(s.kind) >= 0);
  const picked = movers.concat(stars, gals).sort((a, b) => a.id - b.id);
  const list = picked.map((s, i) => {
    const sk = sky.wcs.pixToSky(s.x0, s.y0);
    return {
      id: `SPXK-${tag}-${String(i + 1).padStart(3, '0')}`, known: true, objKey: objKeyOf(sky, s), srcId: s.id,
      sectorId: secId, sectorKey: sky.key, cat: catOfSource(s), kind: s.kind, stype: s.cls || '',
      ra: sk.ra, dec: sk.dec, x: s.x0, y: s.y0, ab: s.abRef, refLam: s.refLam, firstEpoch: 0,
    };
  });
  const out = { list, ids: new Set(list.map((k) => k.srcId)), byObj: new Map(list.map((k) => [k.objKey, k])) };
  _knownMemo.set(sky, out);
  return out;
}
const isKnownSrc = (sky, src) => knownCatalog(sky).ids.has(src.id);
// Keşfedilmeyi bekleyen hedefler: gizli ve henüz katalogda olmayanlar
const undiscoveredTargets = (sky) => sky.sources.filter((s) => s.hidden && !isKnownSrc(sky, s));

// Renk sıcaklığı (1.0 / 2.1 µm oranından) — yeterli S/N yoksa NaN
function colorTempOf(sp) {
  const f10 = bandAvg(sp, 1.0, 0.05), f21 = bandAvg(sp, 2.1, 0.10);
  if (!(f10.v / f10.e > 8 && f21.v / f21.e > 8)) return NaN;
  const r = f10.v / f21.v;
  const g = (T) => nu(1.0, T) / nu(2.1, T);
  let lo = 2200, hi = 45000;
  if (r <= g(lo)) return lo;
  if (r >= g(hi)) return hi;
  for (let i = 0; i < 40; i++) { const mid = 0.5 * (lo + hi); if (g(mid) < r) lo = mid; else hi = mid; }
  return 0.5 * (lo + hi);
}

// Belirli dalga boyunda iki epoch arasındaki akı değişimi
function bandChange(spA, spB, lam, w) {
  const a = bandAvg(spA, lam, w), b = bandAvg(spB, lam, w);
  const e = Math.hypot(a.e, b.e);
  const ok = a.v > 3 * a.e;
  return {
    lam, sig: (b.v - a.v) / e,
    pct: ok ? (b.v / a.v - 1) * 100 : null,
    pctErr: ok ? Math.hypot(b.e / a.v, (b.v * a.e) / (a.v * a.v)) * 100 : null,
    appeared: !ok && b.v > 5 * b.e,
  };
}
const CITE_BANDS = {
  comet: [[3.0, 0.08], [4.26, 0.03]], icy: [[3.0, 0.08], [4.26, 0.03]],
  asteroid: [[1.25, 0.07], [4.5, 0.12]], bd: [[1.6, 0.07], [4.5, 0.12]],
  sn: [[1.25, 0.07], [4.5, 0.12]], var: [[1.25, 0.07], [4.5, 0.12]], generic: [[1.25, 0.07], [4.5, 0.12]],
};

// İki epoch arasındaki değişimin YAPISAL açıklaması (dil-bağımsız; metin arayüzde üretilir)
function reasonOf(an, eA, eB, gain) {
  const A = an.astro, D = an.diag;
  const gkey = D.guess.key;
  const snrMin = Math.min(A.cenA.snr, A.cenB.snr);
  const minD = an.src && an.src.real ? 0.8 : 2.5;                                  // gerçek katalog konumları hassastır → daha küçük eşik
  const moved = !!(A.valid && snrMin >= 6 && A.signif > 6 && A.dtheta >= minD);
  const muPhys = A.mu / gain;
  let moveKind = 'none';
  if (moved) {
    if (gkey === 'asteroid' || gkey === 'comet') moveKind = 'ssb';
    else if (gkey === 'bd') moveKind = 'bd';
    else if (gkey === 'cold' || gkey === 'icy') moveKind = 'cold';
    else moveKind = 'star';
  }
  const ratio = D.varRatio, sig = D.varSig;
  const specChanged = sig > 5 && (!isFinite(ratio) || Math.abs(ratio - 1) > 0.04);
  const Tc = colorTempOf(D.meanB >= D.meanA ? an.spB : an.spA);
  let specKind = 'none';
  if (specChanged) {
    if (gkey === 'comet') specKind = 'comet';
    else if (gkey === 'icy') specKind = 'icy';
    else if (gkey === 'asteroid') specKind = 'asteroid';
    else if (gkey === 'bd' || gkey === 'cold') specKind = 'bd';
    else if (gkey === 'variable' || !isFinite(ratio) || ratio > 1.45 || ratio < 0.69) {
      const extreme = !isFinite(ratio) || ratio > 6 || ratio < 1 / 6;       // kaynak ortaya çıktı / kayboldu / ≥6× değişti
      const hot = extreme || (isFinite(Tc) && Tc >= 6000);                    // sıcak (mavi) renk → patlama türü geçici olay
      specKind = hot ? 'sn' : 'var';
    } else specKind = 'generic';
  }
  const cites = [];
  if (specChanged) {
    const list = CITE_BANDS[specKind] || CITE_BANDS.generic;
    for (let i = 0; i < list.length; i++) cites.push(bandChange(an.spA, an.spB, list[i][0], list[i][1]));
  }
  return {
    eA, eB, gain, guessId: D.guess.id, guessKey: gkey,
    moved, moveKind, d: fin(A.dtheta), dErr: fin(A.dthetaErr), mu: fin(A.mu), muPhys: fin(muPhys), pa: fin(A.pa), signif: fin(A.signif),
    distMax: moveKind === 'bd' || moveKind === 'star' ? fin(V_TAN_MAX / (4.74047 * Math.max(muPhys, 0.05))) : null,
    specChanged, specKind, ratio: fin(ratio), appeared: !isFinite(ratio), sig: fin(sig), Tc: fin(Tc),
    meanA: fin(D.meanA), meanB: fin(D.meanB),
    cites: cites.map((c) => ({ lam: c.lam, sig: fin(c.sig), pct: fin(c.pct), pctErr: fin(c.pctErr), appeared: c.appeared })),
    rank: (moved ? 2 : 0) + (specChanged ? 1 : 0),
  };
}

// Bir bölgedeki TÜM kaynakları tara: konum (Δθ) ve parlaklık/spektrum (ΔF) değişimi olanları bul
function scanBatch(sky, list, eA, eB, gain, items) {
  const kn = knownCatalog(sky);
  for (let i = 0; i < list.length; i++) {
    const src = list[i];
    if (sky.real && !src.track) continue;                                             // gerçek alanda sabit kaynaklar bu modelde değişemez → atla
    const an = analyzeObject(sky, src, eA, eB, gain);
    const r = reasonOf(an, eA, eB, gain);
    if (!(r.moved || r.specChanged)) continue;
    const pB = posAt(src, eB, gain), pA = posAt(src, eA, gain);
    const k = kn.byObj.get(objKeyOf(sky, src));
    items.push({
      srcId: src.id, objKey: objKeyOf(sky, src), known: !!k, knownId: k ? k.id : null, cat: catOfSource(src),
      guessId: r.guessId, guessKey: r.guessKey, reason: r, x: pB.x, y: pB.y, xA: pA.x, yA: pA.y,
      ra: an.skyB.ra, dec: an.skyB.dec,
    });
  }
}
function sortScan(items) {
  items.sort((a, b) => (b.reason.rank - a.reason.rank) || ((b.reason.d || 0) - (a.reason.d || 0)) || ((b.reason.sig || 0) - (a.reason.sig || 0)));
  items.forEach((it, i) => { it.n = i + 1; });
  return items;
}
function scanSky(sky, eA, eB, gain) {
  const items = [];
  scanBatch(sky, sky.sources, eA, eB, gain, items);
  return sortScan(items);
}
// Arayüzü dondurmayan, ilerleme bildiren sürüm
async function scanSkyChunked(sky, eA, eB, gain, onProgress) {
  const items = [];
  const step = 70;
  for (let i = 0; i < sky.sources.length; i += step) {
    scanBatch(sky, sky.sources.slice(i, i + step), eA, eB, gain, items);
    if (onProgress) onProgress(Math.min(1, (i + step) / sky.sources.length));
    await new Promise((res) => setTimeout(res, 0));
  }
  return sortScan(items);
}

// Cismin 4 epoch'taki ölçülmüş konum + parlaklık geçmişi ("zaman arşivi")
function epochHistory(sky, src, gain) {
  const b = bestBand(src);
  const out = [];
  let first = null;
  for (let e = 0; e < 4; e++) {
    const c = centroidStamp(sky, src, e, b, gain);
    const sp = apertureSpectrum(sky, src, e);
    const f = sp.flux[b], er = sp.err[b];
    const valid = c.snr >= 3 && f > 3 * er;
    if (valid && !first) first = c;
    const s = sky.wcs.pixToSky(c.x, c.y);
    out.push({
      e, valid, ra: s.ra, dec: s.dec, x: c.x, y: c.y,
      ab: valid ? -2.5 * Math.log10(f / AB0_UJY) : null, lam: BAND_LAMBDA[b],
      off: valid && first ? Math.hypot(c.x - first.x, c.y - first.y) * PLATE : null,
    });
  }
  return out;
}
/* =====================================================================
   BÖLÜM 8 — GERÇEK KATALOG SORGULARI  (CDS SIMBAD · IMCCE SkyBoT · CDS Sesame)
   ===================================================================== */
async function fetchWithTimeout(url, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { signal: ctl.signal }); } finally { clearTimeout(t); }
}

async function querySimbad(ra, dec, radiusArcsec) {
  const r = radiusArcsec / 3600;
  const adql =
    `SELECT TOP 8 main_id, otype, ra, dec, pmra, pmdec, plx_value, sp_type, ` +
    `DISTANCE(POINT('ICRS', ra, dec), POINT('ICRS', ${ra.toFixed(6)}, ${dec.toFixed(6)})) AS sep_deg ` +
    `FROM basic WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra.toFixed(6)}, ${dec.toFixed(6)}, ${r.toFixed(6)})) = 1 ` +
    `ORDER BY sep_deg`;
  const url = `https://simbad.cds.unistra.fr/simbad/sim-tap/sync?request=doQuery&lang=adql&format=json&query=${encodeURIComponent(adql)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`SIMBAD HTTP ${res.status}`);
  const j = await res.json();
  const cols = (j.metadata || []).map((m) => m.name);
  return (j.data || []).map((row) => {
    const o = {};
    cols.forEach((c, i) => { o[c] = row[i]; });
    return { id: o.main_id, otype: o.otype, ra: o.ra, dec: o.dec, pmra: o.pmra, pmdec: o.pmdec, plx: o.plx_value, sp: o.sp_type, sep: (o.sep_deg || 0) * 3600 };
  });
}

async function querySkybot(ra, dec, radiusArcsec, iso) {
  // Haritadaki gerçek alanla aynı (belgelenmiş) SkyBoT koni araması: skybotField → parseSkybot (realsky.js)
  const rDeg = Math.min(600, Math.max(1, Math.round(radiusArcsec))) / 3600;
  const rows = await skybotField(ra, dec, rDeg, iso, { ms: 9000 });
  return rows.slice(0, 8).map((r) => ({ name: r.name || 'bilinmiyor', cls: r.cls || '', mag: r.mag === null ? '' : r.mag }));
}

// Aday koordinat için eş zamanlı SIMBAD + SkyBoT (Güneş Sistemi) sorgusu
async function queryCatalogs(ra, dec, radiusArcsec, iso) {
  const out = { status: 'pending', message: '', simbad: [], skybot: { status: 'skipped', items: [] }, radius: radiusArcsec, queriedAt: new Date().toISOString() };
  const [s, k] = await Promise.allSettled([querySimbad(ra, dec, radiusArcsec), querySkybot(ra, dec, radiusArcsec, iso)]);
  if (s.status === 'fulfilled') out.simbad = s.value;
  if (k.status === 'fulfilled') out.skybot = { status: 'ok', items: k.value };
  else out.skybot = { status: 'unavailable', items: [], error: String((k.reason && k.reason.message) || k.reason) };
  if (s.status === 'rejected' && k.status === 'rejected') {
    out.status = 'offline';
    out.message = 'Katalogda Eşleşme Yok - Yeni Keşif Adayı! (Çevrimdışı: SIMBAD/SkyBoT\'a ulaşılamadı, doğrulama bekliyor)';
  } else if (s.status === 'fulfilled' && out.simbad.length > 0) {
    out.status = 'match';
    out.message = `SIMBAD: ${out.simbad.length} eşleşme · en yakın ${out.simbad[0].id} (${out.simbad[0].sep.toFixed(1)}″, ${out.simbad[0].otype || '?'})`;
  } else if (k.status === 'fulfilled' && k.value.length > 0) {
    out.status = 'match';
    out.message = `Bilinen Güneş Sistemi cismi (SkyBoT): ${k.value[0].name}`;
  } else if (s.status === 'fulfilled') {
    out.status = 'nomatch';
    out.message = 'Katalogda Eşleşme Yok - Yeni Keşif Adayı!';
  } else {
    out.status = 'offline';
    out.message = 'Katalogda Eşleşme Yok - Yeni Keşif Adayı! (SIMBAD\'e ulaşılamadı; SkyBoT sonuç vermedi — doğrulama bekliyor)';
  }
  return out;
}

// CDS Sesame ad çözücü (SIMBAD/NED/VizieR) — örn. "M42", "Barnard's Star"
async function resolveName(name) {
  const res = await fetchWithTimeout(`https://cds.unistra.fr/cgi-bin/nph-sesame/-oI/SNV?${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Sesame HTTP ${res.status}`);
  const txt = await res.text();
  const m = txt.match(/%J\s+([-+]?\d+\.?\d*)\s+([-+]?\d+\.?\d*)/);
  if (!m) throw new Error('Ad çözülemedi');
  return { ra: parseFloat(m[1]), dec: parseFloat(m[2]) };
}

/* =====================================================================
   BÖLÜM 9b — GERÇEK SPHEREx VERİSİ  (NASA/IPAC IRSA · FITS · WCS · fotometri · astrometri)
   ---------------------------------------------------------------------
   Bu bölüm tarayıcıda çalışır, API anahtarı gerektirmez:
     • IRSA TAP (ADQL) ile hedefin bulunduğu SPHEREx Seviye-2 pozlamaları bulunur,
     • IRSA kesit (cutout) servisinden yalnızca hedefin çevresi indirilir (çok eklentili FITS),
     • FITS + TAN-SIP WCS + WCS-WAVE (piksel başına dalga boyu) okunur,
     • açıklık fotometrisi (MJy/sr → µJy), ağırlık merkezi astrometrisi, özdevinim uyumu hesaplanır.
   Veri: SPHEREx (NASA/Caltech/JPL), IRSA üzerinden. Kabul metni About penceresindedir.
   ===================================================================== */
const IRSA_DEFAULT = 'https://irsa.ipac.caltech.edu';
const IRSA_KEY = 'spx_irsa_base';
const MJD_UNIX0 = 40587;
const mjdToMs = (m) => (m - MJD_UNIX0) * 86400000;
const mjdToIso = (m) => new Date(mjdToMs(m)).toISOString();
const mjdToYear = (m) => 2000 + (m - 51544.5) / 365.25;          // Jülyen yıl (J2000.0 = MJD 51544.5)
const DET_NAMES = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];
// IRSA SPHEREx Explanatory Supplement (Tablo 16) FLAGS bitleri: 0 TRANSIENT, 1 OVERFLOW, 2 SUR_ERROR, 6 NONFUNC, 7 DICHROIC, 9 MISSING_DATA,
// 10 HOT, 11 COLD, 15 NONLINEAR (topluluk aracı spxquery'nin de varsayılan reddi) + bilimsel kullanıma önerilmeyen 25 STREAK, 27 SNOWBALL, 29 SATELLITE_HALO.
// 21 SOURCE (bilinen kaynağa eşlenmiş), 19 OUTLIER, 17 PERSIST, 12 FULLSAMPLE bilgi amaçlıdır: gerçek hedefi silmemek için MASKELENMEZ.
const BAD_FLAG_BITS = [0, 1, 2, 6, 7, 9, 10, 11, 15, 25, 27, 29];
const BAD_FLAG_MASK = BAD_FLAG_BITS.reduce((m, b) => (m | (1 << b)) >>> 0, 0) >>> 0;
const ARCSEC_PER_RAD = 206264.80624709636;
const SR_PER_PIX2_ARCSEC2 = 1 / (ARCSEC_PER_RAD * ARCSEC_PER_RAD);

// IRSA'nın yayınlarda istediği kabul metni (değiştirilmeden)
const SPHEREX_ACK = 'This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration.';

class RealError extends Error {
  constructor(code, message, extra) { super(message || code); this.name = 'RealError'; this.code = code; this.extra = extra || null; }
}

/* ---------------- Hedef konumunu gözlem dönemine taşıma (özdevinim) ---------------- */
// t = { ra, dec, epoch? } (derece, ICRS; epoch yoksa J2000.0) · pmra = μα* (mas/yıl, cos δ dahil) · pmdec (mas/yıl) · yr = Jülyen yıl
function propagate(t, yr) {
  const dt = yr - (t.epoch || 2000);
  const dec = t.dec + ((t.pmdec || 0) * dt) / 3.6e6;
  const cd = Math.max(0.01, Math.cos(((t.dec + dec) / 2) * DEG));
  const ra = t.ra + ((t.pmra || 0) * dt) / (3.6e6 * cd);
  return { ra: wrap360(ra), dec };
}
function tangentOffset(ra, dec, ra0, dec0) {                      // doğu (dx) ve kuzey (dy) ofseti, yay saniyesi
  const a = ra * DEG, d = dec * DEG, a0 = ra0 * DEG, d0 = dec0 * DEG;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  return {
    dx: ((Math.cos(d) * Math.sin(a - a0)) / cosc) * ARCSEC_PER_RAD,
    dy: ((Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc) * ARCSEC_PER_RAD,
  };
}
function angSepArcsec(ra1, dec1, ra2, dec2) {
  const o = tangentOffset(ra2, dec2, ra1, dec1);
  return Math.hypot(o.dx, o.dy);
}

/* =====================================================================
   FITS OKUYUCU  (BITPIX −64…32 · IMAGE/BINTABLE · gzip)
   ===================================================================== */
async function gunzipIfNeeded(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new RealError('GZIP_UNSUPPORTED', 'Tarayıcı gzip açmayı desteklemiyor');
    try {
      const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { throw new RealError('FITS_BAD', 'gzip açılamadı: ' + (e && e.message)); }
  }
  return u8;
}

const ascii = (u8, off, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u8[off + i]); return s; };
function parseCardValue(raw) {
  let s = raw.trim();
  if (s[0] === "'") {
    let out = '';
    let i = 1;
    while (i < s.length) {
      if (s[i] === "'") { if (s[i + 1] === "'") { out += "'"; i += 2; continue; } break; }
      out += s[i++];
    }
    return out.replace(/\s+$/, '');
  }
  const slash = s.indexOf('/');
  if (slash >= 0) s = s.slice(0, slash).trim();
  if (s === 'T') return true;
  if (s === 'F') return false;
  if (s === '') return null;
  const n = Number(s.replace(/[dD]/, 'e'));
  return isFinite(n) ? n : s;
}
function fitsHeaderAt(u8, off) {
  const kv = {};
  let p = off;
  let done = false;
  while (!done) {
    if (p + 2880 > u8.length) throw new RealError('FITS_TRUNC', 'FITS başlığı kesilmiş');
    for (let c = 0; c < 36; c++) {
      const card = ascii(u8, p + c * 80, 80);
      const key = card.slice(0, 8).trim();
      if (key === 'END') { done = true; break; }
      if (!key || key === 'COMMENT' || key === 'HISTORY' || card.slice(8, 10) !== '= ') continue;
      if (!(key in kv)) kv[key] = parseCardValue(card.slice(10));
    }
    p += 2880;
  }
  return { kv, next: p };
}
function parseFits(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (u8.length < 2880 || ascii(u8, 0, 6) !== 'SIMPLE') throw new RealError('FITS_BAD', 'Bu bir FITS dosyası değil');
  const hdus = [];
  let p = 0;
  while (u8.length - p >= 2880) {
    const { kv, next } = fitsHeaderAt(u8, p);
    const bitpix = Number(kv.BITPIX) || 8;
    const naxis = Number(kv.NAXIS) || 0;
    const dims = [];
    let n = naxis ? 1 : 0;
    for (let i = 1; i <= naxis; i++) { const d = Number(kv['NAXIS' + i]) || 0; dims.push(d); n *= d; }
    const pcount = Number(kv.PCOUNT) || 0;
    const gcount = kv.GCOUNT === undefined ? 1 : Number(kv.GCOUNT) || 1;
    const bytes = naxis ? (Math.abs(bitpix) / 8) * gcount * (pcount + n) : 0;
    hdus.push({ kv, dims, bitpix, dataOff: next, dataLen: bytes, name: String(kv.EXTNAME || '').trim(), xt: String(kv.XTENSION || '').trim() });
    p = next + Math.ceil(bytes / 2880) * 2880;
  }
  return { u8, hdus };
}
const hduByName = (fits, name) => fits.hdus.find((h) => h.name.toUpperCase() === name);

// kind: 'f32' (yüzen nokta, BSCALE/BZERO uygulanır) · 'u32' (bayrak bitleri için tam sayı)
function fitsPixels(fits, hdu, kind) {
  if (hdu.dims.length < 2) throw new RealError('FITS_BAD', `${hdu.name || 'HDU'}: 2B görüntü değil`);
  const w = hdu.dims[0];
  const h = hdu.dims[1];
  const n = w * h;
  const bpp = Math.abs(hdu.bitpix) / 8;
  if (hdu.dataOff + n * bpp > fits.u8.length) throw new RealError('FITS_TRUNC', 'FITS veri bölümü kesilmiş');
  const dv = new DataView(fits.u8.buffer, fits.u8.byteOffset + hdu.dataOff, n * bpp);
  const bs = hdu.kv.BSCALE === undefined ? 1 : Number(hdu.kv.BSCALE);
  const bz = hdu.kv.BZERO === undefined ? 0 : Number(hdu.kv.BZERO);
  const out = kind === 'u32' ? new Uint32Array(n) : new Float32Array(n);
  const bp = hdu.bitpix;
  for (let i = 0; i < n; i++) {
    let v;
    if (bp === -32) v = dv.getFloat32(i * 4, false);
    else if (bp === -64) v = dv.getFloat64(i * 8, false);
    else if (bp === 32) v = dv.getInt32(i * 4, false);
    else if (bp === 16) v = dv.getInt16(i * 2, false);
    else if (bp === 8) v = dv.getUint8(i);
    else throw new RealError('FITS_BAD', 'Desteklenmeyen BITPIX ' + bp);
    if (bs !== 1 || bz !== 0) v = v * bs + bz;
    out[i] = v;
  }
  return { w, h, data: out };
}

const TFORM_SIZE = { L: 1, X: 1, B: 1, I: 2, J: 4, K: 8, A: 1, E: 4, D: 8, C: 8, M: 16, P: 8, Q: 16 };
function fitsTable(fits, hdu) {
  const kv = hdu.kv;
  const nrows = Number(kv.NAXIS2) || 0;
  const rowLen = Number(kv.NAXIS1) || 0;
  const nf = Number(kv.TFIELDS) || 0;
  const cols = [];
  let off = 0;
  for (let i = 1; i <= nf; i++) {
    const form = String(kv['TFORM' + i] || '').trim();
    const m = form.match(/^(\d*)([A-Z])/);
    if (!m) throw new RealError('FITS_BAD', 'TFORM çözülemedi: ' + form);
    const rep = m[1] === '' ? 1 : parseInt(m[1], 10);
    const code = m[2];
    const size = TFORM_SIZE[code];
    if (!size) throw new RealError('FITS_BAD', 'Desteklenmeyen TFORM ' + form);
    const nbytes = code === 'X' ? Math.ceil(rep / 8) : rep * size;
    let tdim = null;
    if (kv['TDIM' + i]) tdim = String(kv['TDIM' + i]).replace(/[()\s]/g, '').split(',').map(Number).filter((x) => isFinite(x));
    cols.push({ name: String(kv['TTYPE' + i] || '').trim().toUpperCase(), code, rep, off, nbytes, size, tdim, scal: kv['TSCAL' + i] === undefined ? 1 : Number(kv['TSCAL' + i]), zero: kv['TZERO' + i] === undefined ? 0 : Number(kv['TZERO' + i]) });
    off += nbytes;
  }
  if (off > rowLen && rowLen) throw new RealError('FITS_BAD', 'BINTABLE satır uzunluğu tutarsız');
  if (hdu.dataOff + rowLen * nrows > fits.u8.length) throw new RealError('FITS_TRUNC', 'FITS tablosu kesilmiş');
  const dv = new DataView(fits.u8.buffer, fits.u8.byteOffset + hdu.dataOff, rowLen * nrows);
  function cell(col, row) {
    const base = row * rowLen + col.off;
    if (col.code === 'A') return ascii(fits.u8, hdu.dataOff + base, col.rep).trim();
    const out = new Array(col.rep);
    for (let i = 0; i < col.rep; i++) {
      let v;
      switch (col.code) {
        case 'E': v = dv.getFloat32(base + i * 4, false); break;
        case 'D': v = dv.getFloat64(base + i * 8, false); break;
        case 'J': v = dv.getInt32(base + i * 4, false); break;
        case 'I': v = dv.getInt16(base + i * 2, false); break;
        case 'K': v = Number(dv.getBigInt64(base + i * 8, false)); break;
        case 'B': v = dv.getUint8(base + i); break;
        case 'L': v = dv.getUint8(base + i) === 84; break;
        default: throw new RealError('FITS_BAD', 'Desteklenmeyen sütun türü ' + col.code);
      }
      if (typeof v === 'number' && (col.scal !== 1 || col.zero !== 0)) v = v * col.scal + col.zero;
      out[i] = v;
    }
    return out;
  }
  return { nrows, cols, cell, col: (name) => cols.find((c) => c.name === name) };
}

/* =====================================================================
   WCS  (TAN + SIP) ve WCS-WAVE (piksel başına dalga boyu)
   Piksel koordinatları FITS gibi 1 tabanlıdır (ilk pikselin merkezi = 1.0).
   ===================================================================== */
function sipList(kv, pre) {
  const order = Number(kv[pre + '_ORDER']);
  if (!order) return null;
  const list = [];
  for (let p = 0; p <= order; p++) {
    for (let q = 0; q <= order - p; q++) {
      const c = kv[`${pre}_${p}_${q}`];
      if (typeof c === 'number' && c !== 0) list.push([p, q, c]);
    }
  }
  return list.length ? list : null;
}
function sipEval(list, u, v) {
  if (!list) return 0;
  let s = 0;
  for (let i = 0; i < list.length; i++) s += list[i][2] * Math.pow(u, list[i][0]) * Math.pow(v, list[i][1]);
  return s;
}
function makeFitsWCS(kv) {
  const need = ['CRPIX1', 'CRPIX2', 'CRVAL1', 'CRVAL2'];
  for (const k of need) if (typeof kv[k] !== 'number') throw new RealError('WCS_MISSING', 'WCS anahtarı yok: ' + k);
  const ctype = String(kv.CTYPE1 || '');
  if (ctype && !/TAN/.test(ctype)) throw new RealError('WCS_PROJ', 'Desteklenmeyen izdüşüm: ' + ctype);
  let cd;
  if (typeof kv.CD1_1 === 'number') cd = [[kv.CD1_1, kv.CD1_2 || 0], [kv.CD2_1 || 0, kv.CD2_2]];
  else {
    const c1 = kv.CDELT1 === undefined ? 1 : kv.CDELT1;
    const c2 = kv.CDELT2 === undefined ? 1 : kv.CDELT2;
    const pc = [[kv.PC1_1 === undefined ? 1 : kv.PC1_1, kv.PC1_2 || 0], [kv.PC2_1 || 0, kv.PC2_2 === undefined ? 1 : kv.PC2_2]];
    cd = [[c1 * pc[0][0], c1 * pc[0][1]], [c2 * pc[1][0], c2 * pc[1][1]]];
  }
  const det = cd[0][0] * cd[1][1] - cd[0][1] * cd[1][0];
  if (!isFinite(det) || det === 0) throw new RealError('WCS_BAD', 'WCS dönüşüm matrisi tekil');
  const inv = [[cd[1][1] / det, -cd[0][1] / det], [-cd[1][0] / det, cd[0][0] / det]];
  const A = sipList(kv, 'A');
  const B = sipList(kv, 'B');
  const a0 = kv.CRVAL1 * DEG;
  const d0 = kv.CRVAL2 * DEG;
  const sd0 = Math.sin(d0);
  const cd0 = Math.cos(d0);
  return {
    crpix: [kv.CRPIX1, kv.CRPIX2], crval: [kv.CRVAL1, kv.CRVAL2], cd, det,
    scaleArcsec: Math.sqrt(Math.abs(det)) * 3600,
    pixSr: Math.abs(det) * DEG * DEG,
    sip: !!(A || B),
    pixToSky(x, y) {
      const u = x - kv.CRPIX1;
      const v = y - kv.CRPIX2;
      const uu = u + sipEval(A, u, v);
      const vv = v + sipEval(B, u, v);
      const xi = (cd[0][0] * uu + cd[0][1] * vv) * DEG;
      const eta = (cd[1][0] * uu + cd[1][1] * vv) * DEG;
      const den = cd0 - eta * sd0;
      const ra = a0 + Math.atan2(xi, den);
      const dec = Math.atan2((sd0 + eta * cd0) * Math.cos(ra - a0), den);
      return { ra: wrap360(ra / DEG), dec: dec / DEG };
    },
    skyToPix(ra, dec) {
      const a = ra * DEG;
      const d = dec * DEG;
      const cosc = sd0 * Math.sin(d) + cd0 * Math.cos(d) * Math.cos(a - a0);
      const xi = ((Math.cos(d) * Math.sin(a - a0)) / cosc) / DEG;
      const eta = ((cd0 * Math.sin(d) - sd0 * Math.cos(d) * Math.cos(a - a0)) / cosc) / DEG;
      const uu = inv[0][0] * xi + inv[0][1] * eta;
      const vv = inv[1][0] * xi + inv[1][1] * eta;
      let u = uu;
      let v = vv;
      if (A || B) {
        for (let it = 0; it < 14; it++) {
          const nu = uu - sipEval(A, u, v);
          const nv = vv - sipEval(B, u, v);
          const conv = Math.abs(nu - u) < 1e-10 && Math.abs(nv - v) < 1e-10;
          u = nu; v = nv;
          if (conv) break;
        }
      }
      return { x: u + kv.CRPIX1, y: v + kv.CRPIX2 };
    },
  };
}

// µm cinsinden normalleştir (m, nm veya µm gelebilir)
function toMicron(v) {
  if (!isFinite(v)) return NaN;
  if (v > 0 && v < 1e-3) return v * 1e6;
  if (v > 100) return v / 1000;
  return v;
}
// WCS-WAVE: X (nx) · Y (ny) indeks vektörleri ve VALUES (m × nx × ny); m=2 → [λ_merkez, bant genişliği]
function makeWaveFn(X, Y, V, m) {
  const nx = X.length;
  const ny = Y.length;
  const addr = (ix, iy, k) => V[k + m * (ix + nx * iy)];
  const addrT = (ix, iy, k) => V[k + m * (iy + ny * ix)];
  let at = addr;
  const mx = Math.floor(nx / 2);
  const my = Math.floor(ny / 2);
  const spreadX = Math.abs(addr(nx - 1, my, 0) - addr(0, my, 0));
  const spreadY = Math.abs(addr(mx, ny - 1, 0) - addr(mx, 0, 0));
  let transposed = false;
  if (nx === ny && spreadX > 3 * spreadY) { at = addrT; transposed = true; }       // fiziksel gradyan y yönündedir
  const locate = (A, v) => {
    const n = A.length;
    if (n < 2) return 0;
    const asc = A[n - 1] >= A[0];
    let lo = 0;
    for (let i = 0; i < n - 1; i++) { if (asc ? A[i + 1] <= v : A[i + 1] >= v) lo = i + 1; else break; }
    return Math.min(lo, n - 2);
  };
  function val(x, y, k) {
    const ix = locate(X, x);
    const iy = locate(Y, y);
    const tx = (x - X[ix]) / (X[ix + 1] - X[ix]);
    const ty = (y - Y[iy]) / (Y[iy + 1] - Y[iy]);
    return (1 - tx) * (1 - ty) * at(ix, iy, k) + tx * (1 - ty) * at(ix + 1, iy, k) + (1 - tx) * ty * at(ix, iy + 1, k) + tx * ty * at(ix + 1, iy + 1, k);
  }
  const fn = (x, y) => ({ lam: toMicron(val(x, y, 0)), bw: m > 1 ? toMicron(val(x, y, 1)) : NaN });
  fn.transposed = transposed;
  fn.grid = { nx, ny, xmin: Math.min(X[0], X[nx - 1]), xmax: Math.max(X[0], X[nx - 1]), ymin: Math.min(Y[0], Y[ny - 1]), ymax: Math.max(Y[0], Y[ny - 1]) };
  return fn;
}
function readWaveTable(fits) {
  const hdu = fits.hdus.find((h) => h.xt === 'BINTABLE' && /WCS-WAVE|WAVE/i.test(h.name));
  if (!hdu) return null;
  const tb = fitsTable(fits, hdu);
  if (!tb.nrows) return null;
  const cx = tb.col('X') || tb.cols[0];
  const cy = tb.col('Y') || tb.cols[1];
  const cv = tb.col('VALUES') || tb.cols[2];
  if (!cx || !cy || !cv) return null;
  const X = tb.cell(cx, 0);
  const Y = tb.cell(cy, 0);
  const V = tb.cell(cv, 0);
  const m = V.length / (X.length * Y.length);
  if (!(m >= 1) || m !== Math.round(m) || X.length < 2 || Y.length < 2) throw new RealError('WAVE_BAD', 'WCS-WAVE tablosu çözülemedi');
  return makeWaveFn(X, Y, V, m);
}

/* =====================================================================
   POZLAMA NESNESİ  (FITS → görüntü + bayrak + varyans + WCS + dalga boyu + zaman)
   ===================================================================== */
function headerMjd(kv) {
  for (const k of ['MJD-AVG', 'MJD-MID', 'MJD-OBS', 'MJD_OBS', 'MJD-BEG']) if (typeof kv[k] === 'number' && kv[k] > 40000) return kv[k];
  const end = typeof kv['MJD-END'] === 'number' ? kv['MJD-END'] : null;
  const beg = typeof kv['MJD-BEG'] === 'number' ? kv['MJD-BEG'] : null;
  if (end && beg) return (end + beg) / 2;
  const d = kv['DATE-OBS'] || kv['DATE-BEG'] || kv.DATE;
  if (typeof d === 'string') { const ms = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(d) ? d : d + 'Z'); if (isFinite(ms)) return ms / 86400000 + MJD_UNIX0; }
  for (const k of Object.keys(kv)) if (/^MJD/.test(k) && typeof kv[k] === 'number' && kv[k] > 50000) return kv[k];
  return NaN;
}
function buildExposure(fits, meta) {
  meta = meta || {};
  const imgHdu = hduByName(fits, 'IMAGE') || fits.hdus.find((h) => h.xt !== 'BINTABLE' && h.dims.length >= 2);
  if (!imgHdu) throw new RealError('FITS_NOIMAGE', 'FITS içinde görüntü bulunamadı');
  if (imgHdu.kv.ZIMAGE) throw new RealError('FITS_COMPRESSED', 'Döşemeli sıkıştırılmış FITS desteklenmiyor');
  const im = fitsPixels(fits, imgHdu, 'f32');
  const same = (h) => h && h.dims.length >= 2 && h.dims[0] === im.w && h.dims[1] === im.h;
  const fh = hduByName(fits, 'FLAGS');
  const vh = hduByName(fits, 'VARIANCE');
  const zh = hduByName(fits, 'ZODI');
  const flags = same(fh) ? fitsPixels(fits, fh, 'u32').data : null;
  const variance = same(vh) ? fitsPixels(fits, vh, 'f32').data : null;
  let zodiMean = NaN;
  if (same(zh)) { const z = fitsPixels(fits, zh, 'f32').data; let s = 0; let n = 0; for (let i = 0; i < z.length; i++) if (isFinite(z[i])) { s += z[i]; n++; } zodiMean = n ? s / n : NaN; }
  const kvW = imgHdu.kv.CRPIX1 !== undefined ? imgHdu.kv : fits.hdus[0].kv;
  const wcs = makeFitsWCS(kvW);
  let wave = null;
  let waveNote = 'none';
  try { wave = readWaveTable(fits); if (wave) waveNote = 'wcs-wave'; } catch (e) { wave = null; }
  const kvAll = { ...fits.hdus[0].kv, ...imgHdu.kv };
  let mjd = meta.mjd;
  if (!(mjd > 0)) mjd = headerMjd(kvAll);
  if (!(mjd > 0)) throw new RealError('FITS_TIME', 'Gözlem zamanı (MJD) bulunamadı');
  let det = meta.det || '';
  if (!det && kvAll.DETECTOR !== undefined) det = /^D\d$/i.test(String(kvAll.DETECTOR)) ? String(kvAll.DETECTOR).toUpperCase() : 'D' + parseInt(kvAll.DETECTOR, 10);
  const exp = {
    id: meta.did || meta.uri || meta.name || 'exp', did: meta.did || '', uri: meta.uri || '', name: meta.name || '',
    det: det || '?', mjd, mjd0: meta.mjd0 || mjd, mjd1: meta.mjd1 || mjd, epochYear: mjdToYear(mjd), iso: mjdToIso(mjd),
    w: im.w, h: im.h, img: im.data, flags, variance, zodiMean, wcs, wave, waveNote,
    pixSr: wcs.pixSr, scale: wcs.scaleArcsec, bounds: meta.bounds || null, source: meta.source || 'irsa', header: kvAll,
  };
  validateWave(exp);
  return exp;
}
// Dalga boyu tablosu makul değilse (tablo yok / SPHEREx aralığı dışı) düzlem sınırlarından tahmin et
function validateWave(exp) {
  const cx = (exp.w + 1) / 2;
  const cy = (exp.h + 1) / 2;
  let ok = false;
  if (exp.wave) {
    const c = exp.wave(cx, cy);
    ok = isFinite(c.lam) && c.lam > 0.6 && c.lam < 5.4;
    if (ok && exp.bounds && isFinite(exp.bounds.lo) && isFinite(exp.bounds.hi)) ok = c.lam >= exp.bounds.lo * 0.93 && c.lam <= exp.bounds.hi * 1.07;
  }
  if (ok) return;
  exp.wave = null; exp.waveNote = 'none';
  if (exp.bounds && isFinite(exp.bounds.lo) && isFinite(exp.bounds.hi) && exp.bounds.hi > exp.bounds.lo) {
    const lo = exp.bounds.lo;
    const hi = exp.bounds.hi;
    const w = exp.w;
    const h = exp.h;
    // yalnız tahmin: düzlemin λ aralığının ortası (kesit küçük olduğundan)
    const mid = (lo + hi) / 2;
    exp.wave = () => ({ lam: mid, bw: (hi - lo) / 2 });
    exp.waveNote = 'plane-bounds';
    void w; void h;
  }
}

/* =====================================================================
   GÖRÜNTÜ ÖRNEKLEME · FOTOMETRİ · AĞIRLIK MERKEZİ
   x, y burada 0 tabanlı DİZİ indeksidir (FITS koordinatı = indeks + 1).
   ===================================================================== */
function pixGood(exp, i, useMask) {
  const v = exp.img[i];
  if (!isFinite(v)) return false;
  if (useMask && exp.flags && (exp.flags[i] & BAD_FLAG_MASK) !== 0) return false;
  return true;
}
function median(arr) {
  if (!arr.length) return NaN;
  const a = Float64Array.from(arr).sort();
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : 0.5 * (a[n / 2 - 1] + a[n / 2]);
}
function annulusStats(exp, x, y, rin, rout, useMask) {
  const vals = [];
  const x0 = Math.max(0, Math.floor(x - rout));
  const x1 = Math.min(exp.w - 1, Math.ceil(x + rout));
  const y0 = Math.max(0, Math.floor(y - rout));
  const y1 = Math.min(exp.h - 1, Math.ceil(y + rout));
  for (let j = y0; j <= y1; j++) {
    for (let i = x0; i <= x1; i++) {
      const d = Math.hypot(i - x, j - y);
      if (d <= rin || d > rout) continue;
      const k = j * exp.w + i;
      if (pixGood(exp, k, useMask)) vals.push(exp.img[k]);
    }
  }
  if (vals.length < 8) return { med: NaN, sig: NaN, n: vals.length };
  const med = median(vals);
  const dev = vals.map((v) => Math.abs(v - med));
  const sig = 1.4826 * median(dev);
  return { med, sig, n: vals.length };
}
// Açıklık fotometrisi: piksel başına 4×4 alt örnekleme ile kesirli kapsama
function aperturePhot(exp, x, y, o) {
  const rAp = o.rAp;
  const useMask = o.useMask !== false;
  const bg = annulusStats(exp, x, y, o.rIn, o.rOut, useMask);
  const out = { flux: NaN, err: NaN, snr: NaN, bkg: bg.med, bkgSig: bg.sig, nAp: 0, wTot: 0, wBad: 0, maskedFrac: 1, ok: false };
  if (!isFinite(bg.med)) return out;
  let sum = 0;
  let varSum = 0;
  let wTot = 0;
  let wBad = 0;
  let w2 = 0;
  const x0 = Math.max(0, Math.floor(x - rAp - 1));
  const x1 = Math.min(exp.w - 1, Math.ceil(x + rAp + 1));
  const y0 = Math.max(0, Math.floor(y - rAp - 1));
  const y1 = Math.min(exp.h - 1, Math.ceil(y + rAp + 1));
  const SS = 4;
  for (let j = y0; j <= y1; j++) {
    for (let i = x0; i <= x1; i++) {
      const dc = Math.hypot(i - x, j - y);
      let wgt;
      if (dc <= rAp - 0.72) wgt = 1;
      else if (dc >= rAp + 0.72) continue;
      else {
        let c = 0;
        for (let sj = 0; sj < SS; sj++) for (let si = 0; si < SS; si++) {
          const px = i - 0.5 + (si + 0.5) / SS;
          const py = j - 0.5 + (sj + 0.5) / SS;
          if (Math.hypot(px - x, py - y) <= rAp) c++;
        }
        wgt = c / (SS * SS);
        if (wgt === 0) continue;
      }
      wTot += wgt;
      const k = j * exp.w + i;
      if (!pixGood(exp, k, useMask)) { wBad += wgt; continue; }
      sum += wgt * (exp.img[k] - bg.med);
      w2 += wgt * wgt;
      if (exp.variance && isFinite(exp.variance[k]) && exp.variance[k] > 0) varSum += wgt * wgt * exp.variance[k];
      else varSum += wgt * wgt * (isFinite(bg.sig) ? bg.sig * bg.sig : 0);
    }
  }
  out.wTot = wTot; out.wBad = wBad; out.maskedFrac = wTot ? wBad / wTot : 1;
  if (!wTot || out.maskedFrac > 0.25) return out;
  const bgErr = isFinite(bg.sig) ? (bg.sig / Math.sqrt(Math.max(1, bg.n))) * 1.25 * (wTot - wBad) : 0;
  const sigI = Math.sqrt(varSum + bgErr * bgErr);
  const toUjy = exp.pixSr * 1e12;                              // MJy/sr · sr → MJy → µJy
  out.flux = sum * toUjy;
  out.err = sigI * toUjy;
  out.snr = out.err > 0 ? out.flux / out.err : NaN;
  out.nAp = w2 > 0 ? (wTot - wBad) : 0;
  out.ok = isFinite(out.flux) && isFinite(out.err);
  return out;
}
// Gauss pencereli ağırlık merkezi (tepe noktasından başlayıp yakınsar)
function findCentroid(exp, x0, y0, o) {
  const useMask = o.useMask !== false;
  const bg = annulusStats(exp, x0, y0, 5, 9, useMask);
  if (!isFinite(bg.med)) return null;
  const rs = o.rSearch;
  let bx = -1;
  let by = -1;
  let bv = -Infinity;
  for (let j = Math.max(1, Math.floor(y0 - rs)); j <= Math.min(exp.h - 2, Math.ceil(y0 + rs)); j++) {
    for (let i = Math.max(1, Math.floor(x0 - rs)); i <= Math.min(exp.w - 2, Math.ceil(x0 + rs)); i++) {
      if (Math.hypot(i - x0, j - y0) > rs) continue;
      let s = 0;
      let n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const k = (j + dj) * exp.w + (i + di);
        if (pixGood(exp, k, useMask)) { s += exp.img[k] - bg.med; n++; }
      }
      if (n >= 6 && s / n > bv) { bv = s / n; bx = i; by = j; }
    }
  }
  if (bx < 0) return null;
  const sg = o.sigmaC || 1.3;
  const R = Math.ceil(sg * 2.8);
  let cx = bx;
  let cy = by;
  for (let it = 0; it < 14; it++) {
    let sw = 0;
    let sx = 0;
    let sy = 0;
    for (let j = Math.max(0, Math.round(cy) - R); j <= Math.min(exp.h - 1, Math.round(cy) + R); j++) {
      for (let i = Math.max(0, Math.round(cx) - R); i <= Math.min(exp.w - 1, Math.round(cx) + R); i++) {
        const d2 = (i - cx) * (i - cx) + (j - cy) * (j - cy);
        const k = j * exp.w + i;
        if (!pixGood(exp, k, useMask)) continue;
        const v = exp.img[k] - bg.med;
        if (v <= 0) continue;
        const wgt = Math.exp(-d2 / (2 * sg * sg)) * v;
        sw += wgt; sx += wgt * i; sy += wgt * j;
      }
    }
    if (!(sw > 0)) return null;
    const nx = sx / sw;
    const ny = sy / sw;
    const shift = Math.hypot(nx - cx, ny - cy);
    cx = nx; cy = ny;
    if (shift < 0.004) break;
  }
  if (!isFinite(cx) || !isFinite(cy) || Math.hypot(cx - x0, cy - y0) > rs + 1.5) return null;
  return { x: cx, y: cy, peak: bv, bkg: bg.med, bkgSig: bg.sig };
}

const REAL_DEFAULTS = { rAp: 2.5, rIn: 5, rOut: 9, rSearch: 3.5, sigmaC: 1.3, useMask: true, minSnr: 5, sysAstroPx: 0.12 };

// Tek pozlamada hedefi ölç: yer (katalog + özdevinim) → merkez → fotometri → gökyüzü konumu → λ
function measureTarget(exp, tgt, opts) {
  const o = { ...REAL_DEFAULTS, ...(opts || {}) };
  const pred = propagate(tgt, exp.epochYear);
  const pp = exp.wcs.skyToPix(pred.ra, pred.dec);
  const px = pp.x - 1;
  const py = pp.y - 1;
  const base = { id: exp.id, did: exp.did, det: exp.det, mjd: exp.mjd, iso: exp.iso, year: exp.epochYear, predRa: pred.ra, predDec: pred.dec, predX: px, predY: py, ok: false, status: 'outside' };
  if (!(px >= 1 && py >= 1 && px <= exp.w - 2 && py <= exp.h - 2)) return base;
  const c = findCentroid(exp, px, py, o);
  const cx = c ? c.x : px;
  const cy = c ? c.y : py;
  const ph = aperturePhot(exp, cx, cy, o);
  const sky = exp.wcs.pixToSky(cx + 1, cy + 1);
  const wv = exp.wave ? exp.wave(cx + 1, cy + 1) : { lam: NaN, bw: NaN };
  const res = {
    ...base, ok: true, x: cx, y: cy, ra: sky.ra, dec: sky.dec, centroidOk: !!c,
    lam: wv.lam, bw: wv.bw, waveNote: exp.waveNote, flux: ph.flux, err: ph.err, snr: ph.snr, bkg: ph.bkg,
    maskedFrac: ph.maskedFrac, offArcsec: c ? angSepArcsec(pred.ra, pred.dec, sky.ra, sky.dec) : NaN,
  };
  if (!ph.ok) res.status = ph.maskedFrac > 0.25 ? 'masked' : 'nophot';
  else if (!c || !(ph.snr >= 3)) res.status = 'faint';
  else res.status = ph.snr >= o.minSnr ? 'detected' : 'marginal';
  // konum belirsizliği (yay saniyesi): PSF ~ 1.3 px / SNR, sistematik taban eklenir
  if (c && ph.snr > 0) {
    const sPx = Math.hypot((1.3 * 1.15) / Math.max(ph.snr, 1), o.sysAstroPx);
    res.sigmaArcsec = sPx * exp.scale;
  }
  return res;
}

/* =====================================================================
   ASTROMETRİ: ağırlıklı doğrusal uyum → özdevinim (μα*, μδ), katalogla karşılaştırma
   ===================================================================== */
function fitMotion(meas, refTarget) {
  const pts = meas.filter((m) => m.status === 'detected' && isFinite(m.ra) && isFinite(m.sigmaArcsec));
  const res = { valid: false, n: pts.length };
  if (pts.length < 3) return res;
  const ref = { ra: pts.reduce((s, p) => s + p.ra, 0) / pts.length, dec: pts.reduce((s, p) => s + p.dec, 0) / pts.length };
  const tMean = pts.reduce((s, p) => s + p.year, 0) / pts.length;
  const base = (Math.max(...pts.map((p) => p.year)) - Math.min(...pts.map((p) => p.year)));
  if (base * 365.25 < 5) return { ...res, baselineDays: base * 365.25 };
  const lin = (get) => {
    let Sw = 0; let Swt = 0; let Swtt = 0; let Swx = 0; let Swtx = 0;
    pts.forEach((p) => { const w = 1 / (p.sigmaArcsec * p.sigmaArcsec); const t = p.year - tMean; const x = get(p); Sw += w; Swt += w * t; Swtt += w * t * t; Swx += w * x; Swtx += w * t * x; });
    const D = Sw * Swtt - Swt * Swt;
    const slope = (Sw * Swtx - Swt * Swx) / D;
    const icpt = (Swx - slope * Swt) / Sw;
    let chi2 = 0;
    pts.forEach((p) => { const r = get(p) - (icpt + slope * (p.year - tMean)); chi2 += (r * r) / (p.sigmaArcsec * p.sigmaArcsec); });
    return { slope, icpt, sig: Math.sqrt(Sw / D), chi2 };
  };
  const off = pts.map((p) => tangentOffset(p.ra, p.dec, ref.ra, ref.dec));
  const idx = new Map(pts.map((p, i) => [p, i]));
  const fa = lin((p) => off[idx.get(p)].dx);
  const fd = lin((p) => off[idx.get(p)].dy);
  const nu = Math.max(1, 2 * pts.length - 4);
  const chi2red = (fa.chi2 + fd.chi2) / nu;
  const infl = Math.max(1, Math.sqrt(chi2red));                // gürültü hafife alındıysa belirsizliği büyüt
  const mua = fa.slope;
  const mud = fd.slope;
  const mu = Math.hypot(mua, mud);
  const sig = Math.hypot(fa.sig * infl * Math.abs(mua) / Math.max(mu, 1e-9), fd.sig * infl * Math.abs(mud) / Math.max(mu, 1e-9));
  const sigAxis = Math.max(fa.sig, fd.sig) * infl;
  const out = {
    valid: true, n: pts.length, baselineDays: base * 365.25, ref, tMean, chi2red,
    mua, mud, mu, pa: wrap360(Math.atan2(mua, mud) / DEG), sigMu: Math.max(sig, 1e-6), sigAxis,
    sigma: mu / Math.max(Math.max(sig, 1e-6), 1e-9),
    track: pts.map((p, i) => ({ t: p.year, dx: off[i].dx, dy: off[i].dy, s: p.sigmaArcsec })),
    fitA: { icpt: fa.icpt, slope: fa.slope }, fitD: { icpt: fd.icpt, slope: fd.slope },
  };
  if (refTarget && (refTarget.pmra || refTarget.pmdec)) {
    const ca = refTarget.pmra || 0;
    const cdc = refTarget.pmdec || 0;
    out.cat = { mua: ca / 1000, mud: cdc / 1000, mu: Math.hypot(ca, cdc) / 1000 };
    out.dMu = Math.hypot(mua - out.cat.mua, mud - out.cat.mud);
    out.dSigma = out.dMu / Math.max(sigAxis * Math.SQRT2, 1e-9);
  }
  return out;
}

/* =====================================================================
   FOTOMETRİK ANALİZ: SED, Planck uyumu, iki dönem arası parlaklık değişimi
   ===================================================================== */
function fitPlanck(pts) {
  const good = pts.filter((p) => isFinite(p.lam) && p.flux > 0 && p.err > 0 && p.snr >= 3);
  if (good.length < 4) return null;
  const lams = good.map((p) => p.lam);
  if (Math.max(...lams) / Math.min(...lams) < 1.6) return null;
  let best = null;
  const chiAt = (T) => {
    let num = 0; let den = 0;
    good.forEach((p) => { const m = nu(p.lam, T); const w = 1 / (p.err * p.err); num += w * m * p.flux; den += w * m * m; });
    const A = num / den;
    let chi2 = 0;
    good.forEach((p) => { const r = (p.flux - A * nu(p.lam, T)) / p.err; chi2 += r * r; });
    return { A, chi2 };
  };
  for (let T = 250; T <= 9000; T += 25) {
    const c = chiAt(T);
    if (isFinite(c.chi2) && (!best || c.chi2 < best.chi2)) best = { T, ...c };
  }
  if (!best) return null;
  // sağlamlık: her nokta için %5 sistematik hata tabanı ile yeniden hesapla (yıldız soğurma bantları Planck'tan sapar)
  const floorChi = () => {
    let bb = null;
    for (let T = 250; T <= 9000; T += 25) {
      let num = 0; let den = 0;
      good.forEach((p) => { const e = Math.hypot(p.err, 0.05 * p.flux); const m = nu(p.lam, T); const w = 1 / (e * e); num += w * m * p.flux; den += w * m * m; });
      const A = num / den;
      let chi2 = 0;
      good.forEach((p) => { const e = Math.hypot(p.err, 0.05 * p.flux); const r = (p.flux - A * nu(p.lam, T)) / e; chi2 += r * r; });
      if (!bb || chi2 < bb.chi2) bb = { T, A, chi2 };
    }
    return bb;
  };
  const fb = floorChi();
  return { T: fb.T, A: fb.A, chi2red: fb.chi2 / Math.max(1, good.length - 2), n: good.length };
}
// Aynı dedektör ve yakın λ'daki (|Δλ|/λ < %3) farklı tarihli ölçüm çiftleri → parlaklık oranı
function variabilityPairs(meas) {
  const det = meas.filter((m) => m.status === 'detected' && m.flux > 0 && isFinite(m.lam));
  const pairs = [];
  for (let i = 0; i < det.length; i++) {
    for (let j = i + 1; j < det.length; j++) {
      const a = det[i]; const b = det[j];
      if (a.det !== b.det) continue;
      if (Math.abs(a.lam - b.lam) / a.lam > 0.03) continue;
      if (Math.abs(b.mjd - a.mjd) < 5) continue;
      const [e, l] = a.mjd < b.mjd ? [a, b] : [b, a];
      const ratio = l.flux / e.flux;
      const sr = ratio * Math.hypot(e.err / e.flux, l.err / l.flux);
      const sig = Math.abs(ratio - 1) / Math.max(sr, 1e-9);
      pairs.push({ a: e, b: l, ratio, sigRatio: sr, sig, dLam: Math.abs(a.lam - b.lam), dDays: l.mjd - e.mjd });
    }
  }
  pairs.sort((p, q) => q.sig - p.sig);
  return pairs;
}

// Tüm ölçümlerden yapılandırılmış sonuç (çeviri UI'de yapılır)
function diagnoseReal(meas, tgt) {
  const detected = meas.filter((m) => m.status === 'detected');
  const motion = fitMotion(meas, tgt);
  const sed = fitPlanck(meas.filter((m) => m.status === 'detected' || m.status === 'marginal'));
  const pairs = variabilityPairs(meas);
  const catMu = tgt && (tgt.pmra || tgt.pmdec) ? Math.hypot(tgt.pmra || 0, tgt.pmdec || 0) / 1000 : null;
  let verdict = 'insufficient';
  if (motion.valid) {
    const sigOk = motion.sigma >= 5 && motion.mu > 0.4 * (motion.sigAxis * 3);
    if (sigOk && catMu !== null && catMu > 0.05) verdict = motion.dSigma !== undefined && motion.dSigma <= 3 ? 'pm-confirmed' : 'pm-differs';
    else if (sigOk) verdict = 'moving-unexpected';
    else verdict = 'static';
  } else if (detected.length >= 1) verdict = 'single';
  const topPair = pairs.length ? pairs[0] : null;
  const varFlag = !!topPair && topPair.sig >= 5 && Math.abs(topPair.ratio - 1) >= 0.05;
  return {
    nExp: meas.length, nDet: detected.length,
    nMasked: meas.filter((m) => m.status === 'masked').length,
    nOutside: meas.filter((m) => m.status === 'outside').length,
    nFaint: meas.filter((m) => m.status === 'faint' || m.status === 'marginal' || m.status === 'nophot').length,
    motion, sed, pairs: pairs.slice(0, 6), varFlag, topPair, catMu, verdict,
    lamMin: detected.length ? Math.min(...detected.map((m) => m.lam).filter(isFinite)) : NaN,
    lamMax: detected.length ? Math.max(...detected.map((m) => m.lam).filter(isFinite)) : NaN,
  };
}

/* =====================================================================
   ORTAK IZGARA: farklı pozlamaları aynı gökyüzü ızgarasına yeniden örnekle (blink / fark / renk)
   ===================================================================== */
function makeGrid(ra0, dec0, n, scaleArcsec) {
  const s = scaleArcsec * ARCSEC;
  const a0 = ra0 * DEG;
  const d0 = dec0 * DEG;
  const sd0 = Math.sin(d0);
  const cd0 = Math.cos(d0);
  const c = (n - 1) / 2;
  return {
    n, ra0, dec0, scale: scaleArcsec,
    pixToSky(x, y) {                                   // kuzey yukarı, doğu solda
      const xi = -(x - c) * s;
      const eta = -(y - c) * s;
      const den = cd0 - eta * sd0;
      const ra = a0 + Math.atan2(xi, den);
      const dec = Math.atan2((sd0 + eta * cd0) * Math.cos(ra - a0), den);
      return { ra: wrap360(ra / DEG), dec: dec / DEG };
    },
    skyToPix(ra, dec) {
      const a = ra * DEG;
      const d = dec * DEG;
      const cosc = sd0 * Math.sin(d) + cd0 * Math.cos(d) * Math.cos(a - a0);
      const xi = (Math.cos(d) * Math.sin(a - a0)) / cosc;
      const eta = (cd0 * Math.sin(d) - sd0 * Math.cos(d) * Math.cos(a - a0)) / cosc;
      return { x: c - xi / s, y: c - eta / s };
    },
  };
}
function resampleToGrid(exp, grid, useMask) {
  const n = grid.n;
  const out = new Float32Array(n * n).fill(NaN);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const sky = grid.pixToSky(i, j);
      const p = exp.wcs.skyToPix(sky.ra, sky.dec);
      const fx = p.x - 1;
      const fy = p.y - 1;
      if (fx < 0 || fy < 0 || fx > exp.w - 1 || fy > exp.h - 1) continue;
      const x0 = Math.min(exp.w - 2, Math.floor(fx));
      const y0 = Math.min(exp.h - 2, Math.floor(fy));
      const tx = fx - x0;
      const ty = fy - y0;
      let sum = 0;
      let wsum = 0;
      for (let dj = 0; dj < 2; dj++) {
        for (let di = 0; di < 2; di++) {
          const k = (y0 + dj) * exp.w + (x0 + di);
          if (!pixGood(exp, k, useMask)) continue;
          const wgt = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty);
          sum += wgt * exp.img[k]; wsum += wgt;
        }
      }
      if (wsum > 0.5) out[j * n + i] = sum / wsum;
    }
  }
  return out;
}
// Görüntü istatistiği: arka plan (medyan) ve gürültü (MAD)
function robustStats(arr) {
  const v = [];
  for (let i = 0; i < arr.length; i++) if (isFinite(arr[i])) v.push(arr[i]);
  if (v.length < 16) return { med: 0, sig: 1, n: v.length };
  const med = median(v);
  const sig = 1.4826 * median(v.map((x) => Math.abs(x - med)));
  return { med, sig: sig > 0 ? sig : 1e-6, n: v.length };
}
function composeReal(out, f, st, k, tint) {
  const s = 3 * st.sig;
  const lo = Math.asinh(-st.sig / s);
  const hi = Math.asinh((600 * st.sig) / s) / k;
  const inv = 1 / (hi - lo);
  const r = tint[0] * 255; const g = tint[1] * 255; const bl = tint[2] * 255;
  for (let i = 0, p = 0; i < f.length; i++, p += 4) {
    if (!isFinite(f[i])) { out[p] = 14; out[p + 1] = 18; out[p + 2] = 30; out[p + 3] = 255; continue; }
    let v = (Math.asinh((f[i] - st.med) / s) - lo) * inv;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    out[p] = v * r; out[p + 1] = v * g; out[p + 2] = v * bl; out[p + 3] = 255;
  }
}
function composeRealRGB(out, fr, fg, fb, sr, sg, sb, k) {
  const one = (f, st, i) => {
    const s = 3 * st.sig;
    const lo = Math.asinh(-st.sig / s);
    const hi = Math.asinh((600 * st.sig) / s) / k;
    const v = (Math.asinh((f[i] - st.med) / s) - lo) / (hi - lo);
    return v < 0 ? 0 : v > 1 ? 1 : v;
  };
  for (let i = 0, p = 0; i < fr.length; i++, p += 4) {
    if (!isFinite(fr[i]) || !isFinite(fg[i]) || !isFinite(fb[i])) { out[p] = 14; out[p + 1] = 18; out[p + 2] = 30; out[p + 3] = 255; continue; }
    out[p] = one(fr, sr, i) * 255; out[p + 1] = one(fg, sg, i) * 255; out[p + 2] = one(fb, sb, i) * 255; out[p + 3] = 255;
  }
}
function composeRealDiff(out, fa, fb, sa, sb, thrK, k) {
  // iki görüntüyü sağlam doğrusal oranla ölçekle (λ farkı → ortak parlaklık farkı), sonra |B − A|
  const idx = [];
  for (let i = 0; i < fa.length; i++) if (isFinite(fa[i]) && isFinite(fb[i]) && fa[i] - sa.med > 5 * sa.sig && fb[i] - sb.med > 5 * sb.sig) idx.push((fb[i] - sb.med) / (fa[i] - sa.med));
  const scale = idx.length >= 5 ? median(idx) : 1;
  const sd = Math.hypot(sb.sig, scale * sa.sig);
  const t = thrK * sd;
  const s = 3 * sd;
  const inv = 1 / Math.asinh((300 * sd) / s);
  for (let i = 0, p = 0; i < fa.length; i++, p += 4) {
    if (!isFinite(fa[i]) || !isFinite(fb[i])) { out[p] = 14; out[p + 1] = 18; out[p + 2] = 30; out[p + 3] = 255; continue; }
    const d = Math.abs((fb[i] - sb.med) - scale * (fa[i] - sa.med)) - t;
    let v = d <= 0 ? 0 : Math.asinh(d / s) * inv * k;
    v = v > 1 ? 1 : v;
    out[p] = v * 200; out[p + 1] = v * 250; out[p + 2] = v * 255; out[p + 3] = 255;
  }
  return scale;
}
// Fark görüntüsündeki en belirgin tepeler → "keşif adayı" listesi (aynı dedektör/yakın λ çifti önerilir)
function diffCandidates(fa, fb, sa, sb, grid, maxN) {
  const n = grid.n;
  const idx = [];
  for (let i = 0; i < fa.length; i++) if (isFinite(fa[i]) && isFinite(fb[i]) && fa[i] - sa.med > 5 * sa.sig && fb[i] - sb.med > 5 * sb.sig) idx.push((fb[i] - sb.med) / (fa[i] - sa.med));
  const scale = idx.length >= 5 ? median(idx) : 1;
  const sd = Math.hypot(sb.sig, scale * sa.sig);
  const d = new Float32Array(fa.length).fill(NaN);
  for (let i = 0; i < fa.length; i++) if (isFinite(fa[i]) && isFinite(fb[i])) d[i] = (fb[i] - sb.med) - scale * (fa[i] - sa.med);
  const cand = [];
  const taken = new Uint8Array(d.length);
  for (let it = 0; it < maxN * 3 && cand.length < maxN; it++) {
    let bi = -1;
    let bv = 0;
    for (let i = 0; i < d.length; i++) if (!taken[i] && isFinite(d[i]) && Math.abs(d[i]) > bv) { bv = Math.abs(d[i]); bi = i; }
    if (bi < 0 || bv < 5 * sd) break;
    const cx = bi % n;
    const cy = Math.floor(bi / n);
    for (let j = Math.max(0, cy - 7); j <= Math.min(n - 1, cy + 7); j++) for (let i = Math.max(0, cx - 7); i <= Math.min(n - 1, cx + 7); i++) taken[j * n + i] = 1;
    const sky = grid.pixToSky(cx, cy);
    cand.push({ gx: cx, gy: cy, ra: sky.ra, dec: sky.dec, sigma: bv / sd, sign: d[bi] > 0 ? 1 : -1 });
  }
  return { scale, cands: cand };
}

/* =====================================================================
   IRSA ERİŞİMİ: TAP sorgusu · kesit indirme · seçim
   ===================================================================== */
const trimSlash = (s) => String(s || '').replace(/\/+$/, '');
function irsaBase() {
  try { const v = localStorage.getItem(IRSA_KEY); if (v && /^https?:\/\//i.test(v)) return trimSlash(v); } catch (e) { /* yoksay */ }
  return IRSA_DEFAULT;
}
function setIrsaBase(v) {
  try { if (v && trimSlash(v) !== IRSA_DEFAULT) localStorage.setItem(IRSA_KEY, trimSlash(v)); else localStorage.removeItem(IRSA_KEY); } catch (e) { /* yoksay */ }
}
function netErr(e, ctl, signal) {
  if (signal && signal.aborted) return new RealError('ABORT', 'iptal edildi');
  if (ctl && ctl.__timeout) return new RealError('TIMEOUT', 'zaman aşımı');
  if (e && e.name === 'AbortError') return new RealError('ABORT', 'iptal edildi');
  return new RealError('NETWORK', String((e && e.message) || e));
}
// Gövdeyi ilerleme bildirerek indirir → Uint8Array
async function irsaGet(url, o) {
  o = o || {};
  const ctl = new AbortController();
  const signal = o.signal;
  const onAbort = () => ctl.abort();
  if (signal) { if (signal.aborted) throw new RealError('ABORT', 'iptal edildi'); signal.addEventListener('abort', onAbort, { once: true }); }
  const timer = setTimeout(() => { ctl.__timeout = true; ctl.abort(); }, o.timeoutMs || 90000);
  try {
    let res;
    try { res = await fetch(url, { signal: ctl.signal }); } catch (e) { throw netErr(e, ctl, signal); }
    if (!res.ok) {
      let body = '';
      try { body = (await res.text()).slice(0, 400); } catch (e) { /* yoksay */ }
      throw new RealError('HTTP', `HTTP ${res.status}`, { status: res.status, body });
    }
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body || !res.body.getReader) {
      try { return new Uint8Array(await res.arrayBuffer()); } catch (e) { throw netErr(e, ctl, signal); }
    }
    const rd = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      let r;
      try { r = await rd.read(); } catch (e) { throw netErr(e, ctl, signal); }
      if (r.done) break;
      chunks.push(r.value); got += r.value.length;
      if (o.onProgress) o.onProgress(got, total);
    }
    const out = new Uint8Array(got);
    let p = 0;
    chunks.forEach((c) => { out.set(c, p); p += c.length; });
    return out;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const clean = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
  if (!clean.length) return { cols: [], rows: [] };
  const cols = clean[0].map((c) => c.trim().toLowerCase());
  return { cols, rows: clean.slice(1).map((r) => { const o = {}; cols.forEach((c, i) => { o[c] = r[i] === undefined ? '' : r[i]; }); return o; }) };
}
async function irsaTap(base, adql, o) {
  const url = `${trimSlash(base)}/TAP/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent(adql)}`;
  const u8 = await irsaGet(url, { ...(o || {}), timeoutMs: 45000 });
  const text = new TextDecoder().decode(u8);
  if (/^\s*</.test(text)) {
    const m = text.match(/QUERY_STATUS[^>]*value="ERROR"[^>]*>([\s\S]*?)<\/INFO>/i) || text.match(/ERROR[^<]{0,200}/i);
    throw new RealError('TAP_ERROR', (m && (m[1] || m[0]) ? String(m[1] || m[0]).trim().slice(0, 300) : 'TAP hatası'));
  }
  return parseCsv(text);
}
function exposureQuery(ra, dec, top) {
  return 'SELECT TOP ' + (top || 400) + ' a.uri, p.obs_publisher_did, p.time_bounds_lower, p.time_bounds_upper, p.energy_bandpassname, p.energy_bounds_lower, p.energy_bounds_upper ' +
    'FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid ' +
    `WHERE CONTAINS(POINT('ICRS', ${ra.toFixed(6)}, ${dec.toFixed(6)}), p.poly) = 1 ORDER BY p.time_bounds_lower`;
}
function normalizeExposureRows(tab) {
  const out = [];
  const seen = new Set();
  tab.rows.forEach((r) => {
    const uri = (r.uri || '').trim();
    if (!uri || !/\.fits(\.gz)?$/i.test(uri.split('?')[0])) return;
    const m0 = parseFloat(r.time_bounds_lower);
    const m1 = parseFloat(r.time_bounds_upper);
    if (!isFinite(m0)) return;
    const key = uri;
    if (seen.has(key)) return;
    seen.add(key);
    const bp = String(r.energy_bandpassname || '').trim();
    const dm = bp.match(/D(\d)/i);
    const lo = parseFloat(r.energy_bounds_lower);
    const hi = parseFloat(r.energy_bounds_upper);
    out.push({
      uri, did: (r.obs_publisher_did || '').trim(), mjd0: m0, mjd1: isFinite(m1) ? m1 : m0, mjd: isFinite(m1) ? (m0 + m1) / 2 : m0,
      det: dm ? 'D' + dm[1] : bp || '?', bandpass: bp,
      lamLo: toMicron(lo), lamHi: toMicron(hi),
    });
  });
  return out;
}
// Dedektör başına zamana yayılmış perDet pozlama seç (tarih tabanı en geniş olsun)
function pickExposures(rows, perDet, maxTotal) {
  const byDet = new Map();
  rows.forEach((r) => { if (!byDet.has(r.det)) byDet.set(r.det, []); byDet.get(r.det).push(r); });
  const picked = [];
  Array.from(byDet.keys()).sort().forEach((d) => {
    const list = byDet.get(d).slice().sort((a, b) => a.mjd - b.mjd);
    const k = Math.min(perDet, list.length);
    const used = new Set();
    for (let i = 0; i < k; i++) {
      let ix = k === 1 ? Math.floor((list.length - 1) / 2) : Math.round((i * (list.length - 1)) / (k - 1));
      while (used.has(ix) && ix < list.length - 1) ix++;
      used.add(ix);
      picked.push(list[ix]);
    }
  });
  picked.sort((a, b) => a.mjd - b.mjd);
  return maxTotal && picked.length > maxTotal ? picked.slice(0, maxTotal) : picked;
}
function cutoutUrl(base, uri, ra, dec, sizeDeg) {
  let full = uri;
  if (!/^https?:\/\//i.test(full)) full = `${trimSlash(base)}/${String(full).replace(/^\/+/, '')}`;
  else if (trimSlash(base) !== IRSA_DEFAULT) full = full.replace(/^https?:\/\/irsa\.ipac\.caltech\.edu/i, trimSlash(base));
  return `${full}${full.includes('?') ? '&' : '?'}center=${ra.toFixed(6)},${dec.toFixed(6)}&size=${sizeDeg.toFixed(5)}`;
}
async function fetchExposure(base, row, ra, dec, sizeDeg, o) {
  const url = cutoutUrl(base, row.uri, ra, dec, sizeDeg);
  const u8 = await irsaGet(url, { signal: o && o.signal, timeoutMs: 150000, onProgress: o && o.onProgress });
  const bytes = await gunzipIfNeeded(u8);
  const fits = parseFits(bytes);
  return buildExposure(fits, { did: row.did, uri: row.uri, mjd: row.mjd, mjd0: row.mjd0, mjd1: row.mjd1, det: row.det, bounds: { lo: row.lamLo, hi: row.lamHi }, source: 'irsa' });
}
async function exposureFromFile(buf, name) {
  const bytes = await gunzipIfNeeded(buf);
  const fits = parseFits(bytes);
  return buildExposure(fits, { name, did: name, source: 'file' });
}
// TAP erişimi var mı? (küçük sınama sorgusu)
async function irsaPing(base, signal) {
  const tab = await irsaTap(base, 'SELECT TOP 1 p.obs_publisher_did FROM spherex.plane p', { signal });
  return tab.rows.length;
}

/* ---------------- Önerilen hedefler ---------------- */
// J2000.0 ICRS konumu + özdevinim (μα* = μα·cos δ). Kaynak: SIMBAD/Gaia; yüksek özdevinimli yakın yıldızlar
const REAL_TARGETS = [
  { id: 'barnard', name: "Barnard's Star", ra: 269.4520770, dec: 4.6933650, pmra: -801.551, pmdec: 10362.394, epoch: 2000, note: 'M4V · 1.83 pc · 10.39″/yr · J≈5.2', ch: true },
  // NASA Space Apps 2026 "Planet X and SPHEREx" sınama hedefleri (WISE 0855: görev metnindeki tam koordinat; diğerleri SIMBAD/Gaia DR3)
  { id: 'epsindb', name: 'ε Indi Ba/Bb', ra: 331.04375, dec: -56.78272, pmra: 3981.977, pmdec: -2466.832, epoch: 2000, note: 'T1+T6 brown-dwarf pair · 3.64 pc · 4.7″/yr', ch: true },
  { id: 'w0855', name: 'WISE 0855−0714', ra: 133.7951295, dec: -7.2451472, pmra: -8118, pmdec: 680, epoch: 2010.5, note: 'Y-dwarf ≈285 K · 2.28 pc · 8.1″/yr · RA 08h55m10.831s Dec −07°14′42.53″', ch: true },
  { id: 'rwaur', name: 'RW Aurigae', ra: 76.956067, dec: 30.401326, pmra: 2.641, pmdec: -27.398, epoch: 2016, note: 'T Tauri variable · dips ≈9–13 mag · ≈140 pc', ch: true },
  { id: 'rdra', name: 'R Draconis', ra: 248.17083, dec: 66.756111, pmra: 0, pmdec: 0, epoch: 2000, note: 'Mira variable · P≈245 d · V≈6.7–13.2 · position approx.', ch: true },
  { id: 'teegarden', name: "Teegarden's Star", ra: 43.253716, dec: 16.881287, pmra: 3429.083, pmdec: -3805.541, epoch: 2000, note: 'M7V · 3.83 pc · 5.12″/yr · J≈8.4' },
  { id: 'wolf359', name: 'Wolf 359', ra: 164.1205036, dec: 7.0147231, pmra: -3866.338, pmdec: -2699.215, epoch: 2000, note: 'M6V · 2.41 pc · 4.72″/yr' },
  { id: 'cyg61', name: '61 Cygni A', ra: 316.7247483, dec: 38.7494172, pmra: 4164.209, pmdec: 3249.614, epoch: 2000, note: 'K5V · 3.49 pc · 5.28″/yr' },
  { id: 'lh16', name: 'Luhman 16 (AB)', ra: 162.3282125, dec: -53.3194111, pmra: -2768.511, pmdec: 358.472, epoch: 2016, note: 'L7.5+T0.5 · 2.0 pc · 2.79″/yr' },
];
/* =====================================================================
   BÖLÜM 8b — CANLI GÖKYÜZÜ KATMANI
   · CDS hips2fits  → 2MASS / AllWISE gerçek kızılötesi gökyüzü fotoğrafı (CORS dostu; <img crossOrigin>)
   · SIMBAD TAP     → gerçek cisimler + özdevinim (pmra/pmdec) + (varsa) V/J parlaklığı
   · Yerel dosya    → saf JS (ArrayBuffer/DataView) FITS okuyucu + PNG/JPG; Zscale/asinh germe
   Her ağ çağrısı "en iyi çaba"dır: hata bir istisna olarak yakalanır, uygulama simülasyona düşer.
   NOT: 2MASS (≈1999) ve AllWISE (≈2010) SPHEREx verisi DEĞİLDİR; yalnızca aynı gökyüzü bölgesinin
   gerçek, kızılötesi referans fotoğraflarıdır (CDS hips2fits hizmeti üzerinden).
   ===================================================================== */
class SkyError extends Error {
  constructor(code, message, extra) { super(message || code); this.name = 'SkyError'; this.code = code; this.extra = extra || null; }
}

const HIPS_HOSTS = ['https://alasky.cds.unistra.fr', 'https://alaskybis.cds.unistra.fr'];
const SKY_SURVEYS = {
  nir: { hips: 'CDS/P/2MASS/color', yr: 1999.0, name: '2MASS', lam: '1.2–2.2 µm (J·H·Ks)' },
  mir: { hips: 'CDS/P/allWISE/color', yr: 2010.4, name: 'AllWISE', lam: '3.4–22 µm (W1–W4)' },
};
const SKY_PX = 600;                       // hips2fits çıktısı: 600×600
const SKY_FOVS = [0.05, 0.15, 0.3, 0.6];  // görüş alanı [derece]
const SKY_VIEW_YEAR = 2013.0;             // kadraj merkezi = hedefin bu yıldaki konumu (hızlı özdevinimli yıldızlar kadrajda kalsın)
const SKY_YEAR_MIN = 1995;
const SKY_YEAR_MAX = 2035;
const SPHEREX_YEAR = 2026.3;
const SIMBAD_TAP = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';
const SIMBAD_TOP = 25;

/* ---------------- Galeri: 5 kategori (adlar özel isimdir; kategori adları i18n'den gelir) ---------------- */
// Konumlar J2000 ICRS (epoch alanı: konumun geçerli olduğu yıl); μα* (cos δ dahil) ve μδ mas/yıl
const SKY_GALLERY = [
  { id: 'ch', emoji: '✦', items: [
    { id: 'barnard', name: "Barnard's Star", ra: 269.4520770, dec: 4.6933650, pmra: -801.551, pmdec: 10362.394, epoch: 2000, fov: 0.15 },
    { id: 'epsindb', name: 'ε Indi Ba/Bb', ra: 331.04375, dec: -56.78272, pmra: 3981.977, pmdec: -2466.832, epoch: 2000, fov: 0.15 },
    { id: 'w0855', name: 'WISE 0855−0714', ra: 133.7951295, dec: -7.2451472, pmra: -8118, pmdec: 680, epoch: 2010.5, fov: 0.15 },
    { id: 'rwaur', name: 'RW Aurigae', ra: 76.956067, dec: 30.401326, pmra: 2.641, pmdec: -27.398, epoch: 2016, fov: 0.15 },
    { id: 'rdra', name: 'R Draconis', ra: 248.17083, dec: 66.756111, pmra: 0, pmdec: 0, epoch: 2000, fov: 0.15 },
  ] },
  { id: 'pm', emoji: '◈', items: [
    { id: 'barnard', name: "Barnard's Star", ra: 269.4520770, dec: 4.6933650, pmra: -801.551, pmdec: 10362.394, epoch: 2000, fov: 0.15 },
    { id: 'teegarden', name: "Teegarden's Star", ra: 43.253716, dec: 16.881287, pmra: 3429.083, pmdec: -3805.541, epoch: 2000, fov: 0.15 },
    { id: 'wolf359', name: 'Wolf 359', ra: 164.1205036, dec: 7.0147231, pmra: -3866.338, pmdec: -2699.215, epoch: 2000, fov: 0.15 },
    { id: 'cyg61', name: '61 Cygni A', ra: 316.7247483, dec: 38.7494172, pmra: 4164.209, pmdec: 3249.614, epoch: 2000, fov: 0.15 },
    { id: 'kapteyn', name: "Kapteyn's Star", ra: 77.91908, dec: -45.018242, pmra: 6505, pmdec: -5731, epoch: 2000, fov: 0.15 },
    { id: 'lalande', name: 'Lalande 21185', ra: 165.8341, dec: 35.96989, pmra: -580, pmdec: -4777, epoch: 2000, fov: 0.15 },
  ] },
  { id: 'bd', emoji: '●', items: [
    { id: 'lh16', name: 'Luhman 16 (AB)', ra: 162.3282125, dec: -53.3194111, pmra: -2768.511, pmdec: 358.472, epoch: 2016, fov: 0.15 },
    { id: 'w0855', name: 'WISE 0855−0714', ra: 133.7951295, dec: -7.2451472, pmra: -8118, pmdec: 680, epoch: 2010.5, fov: 0.15 },
    { id: 'epsind', name: 'ε Indi (A · Ba/Bb)', ra: 330.8403, dec: -56.78597, pmra: 3966, pmdec: -2536, epoch: 2000, fov: 0.15 },
    { id: 'gl229', name: 'Gliese 229 (A · B)', ra: 92.6442, dec: -21.86464, pmra: -137, pmdec: -714, epoch: 2000, fov: 0.15 },
  ] },
  { id: 'neb', emoji: '◌', items: [
    { id: 'm42', name: 'M42 · Orion Nebulası', ra: 83.8221, dec: -5.3911, pmra: 0, pmdec: 0, epoch: 2000, fov: 0.6 },
    { id: 'rhooph', name: 'ρ Ophiuchi (L1688)', ra: 246.80, dec: -24.50, pmra: 0, pmdec: 0, epoch: 2000, fov: 0.6 },
    { id: 'm16', name: 'M16 · Kartal Nebulası', ra: 274.70, dec: -13.82, pmra: 0, pmdec: 0, epoch: 2000, fov: 0.3 },
    { id: 'carina', name: 'NGC 3372 · Carina', ra: 161.28, dec: -59.87, pmra: 0, pmdec: 0, epoch: 2000, fov: 0.6 },
  ] },
  { id: 'gal', emoji: '◎', items: [
    { id: 'm31', name: 'M31 · Andromeda', ra: 10.6847, dec: 41.2688, pmra: 0, pmdec: 0, epoch: 2000, fov: 0.6 },
    { id: 'm51', name: 'M51 · Girdap', ra: 202.4696, dec: 47.1952, pmra: 0, pmdec: 0, epoch: 2000, fov: 0.15 },
    { id: 'm82', name: 'M82 · Puro', ra: 148.9685, dec: 69.6797, pmra: 0, pmdec: 0, epoch: 2000, fov: 0.15 },
    { id: 'm104', name: 'M104 · Sombrero', ra: 189.9976, dec: -11.6231, pmra: 0, pmdec: 0, epoch: 2000, fov: 0.15 },
    { id: 'cena', name: 'Centaurus A', ra: 201.3651, dec: -43.0191, pmra: 0, pmdec: 0, epoch: 2000, fov: 0.3 },
  ] },
  { id: 'exo', emoji: '◍', items: [
    { id: 'trappist', name: 'TRAPPIST-1', ra: 346.6220, dec: -5.04128, pmra: 930.8, pmdec: -479.0, epoch: 2000, fov: 0.15 },
    { id: 'proxima', name: 'Proxima Centauri', ra: 217.4290, dec: -62.67947, pmra: -3781.741, pmdec: 769.465, epoch: 2000, fov: 0.15 },
    { id: 'tauceti', name: 'Tau Ceti', ra: 26.0170, dec: -15.93747, pmra: -1721.6, pmdec: 854.9, epoch: 2000, fov: 0.15 },
    { id: '51peg', name: '51 Pegasi', ra: 344.3667, dec: 20.7688, pmra: 207.3, pmdec: 60.2, epoch: 2000, fov: 0.15 },
    { id: '55cnc', name: '55 Cancri', ra: 133.1492, dec: 28.3308, pmra: -485.5, pmdec: -233.5, epoch: 2000, fov: 0.15 },
  ] },
];
const SKY_DEFAULT_TARGET = SKY_GALLERY[0].items[0];

/* ---------------- Kadraj · izdüşüm ---------------- */
// Kadraj merkezi: hedefin SKY_VIEW_YEAR yılındaki konumu (özdevinimsizse hedefin kendisi)
function skyViewCenter(tg) {
  const c = propagate({ ra: tg.ra, dec: tg.dec, pmra: tg.pmra || 0, pmdec: tg.pmdec || 0, epoch: tg.epoch || 2000 }, SKY_VIEW_YEAR);
  return { ra: c.ra, dec: c.dec };
}
// hips2fits TAN kadrajı: kuzey yukarı, doğu solda; fov = en büyük kenarın açısı (derece). S: piksel kenarı.
function skyToHips(ra, dec, c, fov, S) {
  const o = tangentOffset(ra, dec, c.ra, c.dec);
  const sc = (fov * 3600) / S;
  return { x: S / 2 - o.dx / sc, y: S / 2 - o.dy / sc };
}
function hipsToSky(x, y, c, fov, S) {
  const sc = (fov * 3600) / S;
  const xi = ((S / 2 - x) * sc) / ARCSEC_PER_RAD;
  const eta = ((S / 2 - y) * sc) / ARCSEC_PER_RAD;
  const a0 = c.ra * DEG;
  const d0 = c.dec * DEG;
  const den = Math.cos(d0) - eta * Math.sin(d0);
  const ra = a0 + Math.atan2(xi, den);
  const dec = Math.atan2((Math.sin(d0) + eta * Math.cos(d0)) * Math.cos(ra - a0), den);
  return { ra: wrap360(ra / DEG), dec: dec / DEG };
}
const smoothstep = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
// SPHEREx bant dalga boyuna göre 2MASS (0) ↔ AllWISE (1) karışımı
const skyBlend = (lamUm) => smoothstep(2.4, 3.2, lamUm);

/* ---------------- hips2fits fotoğraf yükleyici ---------------- */
function hipsUrl(key, ra, dec, fov, px, host = 0) {
  const s = SKY_SURVEYS[key];
  return `${HIPS_HOSTS[host]}/hips-image-services/hips2fits?hips=${s.hips}&width=${px}&height=${px}&fov=${fov}&projection=TAN&coordsys=icrs&ra=${wrap360(ra).toFixed(6)}&dec=${dec.toFixed(6)}&format=jpg`;
}
function loadImg(url, cors, ms) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let done = false;
    let tm = null;
    const fin = (ok, v) => {
      if (done) return;
      done = true;
      clearTimeout(tm);
      img.onload = null; img.onerror = null;
      if (ok) resolve(v); else { try { img.src = ''; } catch (e) { /* yoksay */ } reject(v); }
    };
    tm = setTimeout(() => fin(false, new SkyError('TIMEOUT', 'zaman aşımı')), ms);
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => fin(true, img);
    img.onerror = () => fin(false, new SkyError('IMG', 'görüntü yüklenemedi'));
    img.src = url;
  });
}
const _photoCache = new Map();
// Önce crossOrigin="anonymous" (Canvas'tan okunabilir); CORS başlığı yoksa aynı adres başsız yüklenir (yalnızca GÖRÜNTÜLEME;
// piksel okunamaz). Sonra yedek ayna (alaskybis) denenir.
function loadSkyPhoto(key, ra, dec, fov, px, o = {}) {
  const ck = [key, wrap360(ra).toFixed(5), dec.toFixed(5), fov, px].join('|');
  if (_photoCache.has(ck)) return _photoCache.get(ck);
  const ms = o.timeoutMs || 10000;
  const p = (async () => {
    let last = null;
    for (let h = 0; h < HIPS_HOSTS.length; h++) {
      const url = hipsUrl(key, ra, dec, fov, px, h);
      try { return { img: await loadImg(url, true, ms), cors: true, url, host: h, key }; } catch (e) { last = e; }
      try { return { img: await loadImg(url, false, ms), cors: false, url, host: h, key }; } catch (e) { last = e; }
    }
    throw last || new SkyError('IMG', 'görüntü yüklenemedi');
  })();
  _photoCache.set(ck, p);
  p.catch(() => { _photoCache.delete(ck); });
  if (_photoCache.size > 40) _photoCache.delete(_photoCache.keys().next().value);
  return p;
}
function withDeadline(promise, ms, code = 'TIMEOUT') {
  return new Promise((resolve, reject) => {
    const tm = setTimeout(() => reject(new SkyError(code, 'zaman aşımı')), ms);
    promise.then((v) => { clearTimeout(tm); resolve(v); }, (e) => { clearTimeout(tm); reject(e); });
  });
}
function skyThumbUrl(tg, px = 112) { return hipsUrl('nir', tg.ra, tg.dec, tg.fov || 0.15, px, 0); }

/* ---------------- SIMBAD TAP (JSON) ---------------- */
const adqlCone = (ra, dec, rDeg) => `1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${wrap360(ra).toFixed(6)}, ${dec.toFixed(6)}, ${rDeg}))`;
async function simbadRows(adql, ms) {
  const url = `${SIMBAD_TAP}?request=doQuery&lang=adql&format=json&query=${encodeURIComponent(adql)}`;
  const res = await fetchWithTimeout(url, ms);
  if (!res.ok) throw new SkyError('HTTP', `SIMBAD HTTP ${res.status}`, { status: res.status });
  let j;
  try { j = await res.json(); } catch (e) { throw new SkyError('JSON', 'SIMBAD yanıtı JSON değil'); }
  const cols = (j.metadata || []).map((m) => m.name);
  if (!Array.isArray(j.data)) throw new SkyError('JSON', 'SIMBAD yanıtı anlaşılamadı');
  return j.data.map((row) => { const o = {}; cols.forEach((c, i) => { o[c] = row[i]; }); return o; });
}
const numOrNull = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
// Koni sorgusu: merkeze en yakın SIMBAD_TOP cisim (konum ICRS, dönem J2000.0) + özdevinim
async function simbadCone(ra, dec, rDeg, o = {}) {
  const top = o.top || SIMBAD_TOP;
  const c = `${wrap360(ra).toFixed(6)}, ${dec.toFixed(6)}`;
  const adql = `SELECT TOP ${top} main_id, ra, dec, otype, pmra, pmdec, plx_value, sp_type, ` +
    `DISTANCE(POINT('ICRS', ra, dec), POINT('ICRS', ${c})) AS sep FROM basic WHERE ${adqlCone(ra, dec, rDeg)} ORDER BY sep`;
  const rows = await simbadRows(adql, o.ms || 9000);
  const out = [];
  rows.forEach((r) => {
    const rr = numOrNull(r.ra); const dd = numOrNull(r.dec);
    if (rr === null || dd === null) return;
    out.push({
      id: String(r.main_id || '?').replace(/\s+/g, ' ').trim(), ra: rr, dec: dd, otype: String(r.otype || '').trim(),
      pmra: numOrNull(r.pmra), pmdec: numOrNull(r.pmdec), plx: numOrNull(r.plx_value), sp: String(r.sp_type || '').trim(),
      sep: numOrNull(r.sep) === null ? 0 : r.sep * 3600, epoch: 2000, V: null, J: null,
    });
  });
  return out;
}
// Parlaklık (V, J): SIMBAD "allfluxes" görünümü — en iyi çaba; hata olursa sessizce atlanır
async function simbadMags(ra, dec, rDeg, o = {}) {
  const adql = `SELECT TOP 200 main_id, V, J FROM basic JOIN allfluxes ON basic.oid = allfluxes.oidref WHERE ${adqlCone(ra, dec, rDeg)}`;
  const rows = await simbadRows(adql, o.ms || 9000);
  const m = new Map();
  rows.forEach((r) => m.set(String(r.main_id || '').replace(/\s+/g, ' ').trim(), { V: numOrNull(r.V), J: numOrNull(r.J) }));
  return m;
}
function mergeMags(objs, mags) {
  objs.forEach((ob) => { const m = mags.get(ob.id); if (m) { ob.V = m.V; ob.J = m.J; } });
  return objs;
}
// SIMBAD türünden sınıf: pm · bd · gal · neb · pl · var · star
const GAL_TYPES = new Set(['G', 'GiG', 'GiC', 'GiP', 'AGN', 'SyG', 'Sy1', 'Sy2', 'QSO', 'Bla', 'rG', 'IG', 'LIN', 'SBG', 'H2G', 'EmG', 'BiC', 'ClG', 'GrG', 'PaG', 'LSB', 'AG?', 'G?', 'Q?']);
const NEB_TYPES = new Set(['HII', 'PN', 'RNe', 'Cl*', 'OpC', 'GlC', 'As*', 'SFR', 'MoC', 'Cld', 'ISM', 'Cir', 'SNR', 'Neb', 'DNe', 'bub', 'HH', 'Y*O', 'cor', 'Cl?', 'PN?']);
function otypeCat(ot) {
  const o = String(ot || '');
  if (o === 'BD*' || o === 'BD?' || o === 'Y*?' || o === 'brownD*' || /^(L|T|Y)dwarf/i.test(o)) return 'bd';
  if (o === 'PM*' || o === 'PM?') return 'pm';
  if (GAL_TYPES.has(o)) return 'gal';
  if (NEB_TYPES.has(o)) return 'neb';
  if (o === 'Pl' || o === 'Pl?') return 'pl';
  if (/^(V\*|Mi\*|Ir\*|LP\*|EB\*|RR\*|Ce\*|Er\*|Fl\*|BY\*|RS\*|dS\*|Pu\*|SB\*)/.test(o)) return 'var';
  return 'star';
}
const SKY_CAT_COLOR = { pm: '#E3B567', bd: '#F0587A', gal: '#8E9BC2', neb: '#5B9DFF', pl: '#8FD3E6', var: '#8FE0B5', star: '#A9A6C0' };
const objMu = (ob) => Math.hypot(ob.pmra || 0, ob.pmdec || 0);          // mas/yıl
const hasPm = (ob) => objMu(ob) > 0.5;
const objAt = (ob, yr) => propagate({ ra: ob.ra, dec: ob.dec, pmra: ob.pmra || 0, pmdec: ob.pmdec || 0, epoch: ob.epoch || 2000 }, yr);
const simbadUrl = (id) => `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(id)}`;

/* =====================================================================
   v3.5 — "Planet X and SPHEREx" görev metni (NASA Space Apps 2026) için eklenen motor parçaları
   · Gaia DR3 / AllWISE bindirmesi (CDS VizieR TAP, CORS dostu; hata olursa sessizce atlanır)
   · SPHEREx FLAGS bit sözlüğü (kontaminasyon/üstveri paneli ve bayrak bindirmesi)
   · Çerçeve toplama (coadd) · URL ile koordinat (?ra=&dec=&fov=) ve gömme bağlantısı
   VERİ SÜRÜMÜ GÜNCELLEMESİ: yeni SPHEREx yayınları IRSA TAP'tan canlı gelir → yeniden derleme gerekmez.
   Başka bir arşiv/ayna için tek nokta: IRSA_DEFAULT (veya arayüzde Ayarlar → IRSA adresi).
   ===================================================================== */
const VIZIER_TAP = 'https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync';
const OVERLAY_SURVEYS = {
  gaia: { table: 'I/355/gaiadr3', ra: 'RA_ICRS', dec: 'DE_ICRS', pmra: 'pmRA', pmdec: 'pmDE', mag: 'Gmag', id: 'Source', epoch: 2016.0, color: '#8FE0B5', name: 'Gaia DR3' },
  wise: { table: 'II/328/allwise', ra: 'RAJ2000', dec: 'DEJ2000', pmra: 'pmRA', pmdec: 'pmDE', mag: 'W1mag', id: 'AllWISE', epoch: 2010.56, color: '#E3B567', name: 'AllWISE' },
};
const OVERLAY_MAX_DEG = 0.3;                 // bindirme sorgusunun en büyük yarıçapı (derece)
// Merkez + yarıçaptaki kaynaklar: [{id, ra, dec, pmra, pmdec, mag, epoch, hasPm}] (parlaktan sönüğe)
async function vizierCone(key, ra, dec, rDeg, o = {}) {
  const sv = OVERLAY_SURVEYS[key];
  const q = (c) => '"' + c + '"';
  const adql = `SELECT TOP ${o.top || 250} ${[sv.ra, sv.dec, sv.pmra, sv.pmdec, sv.mag, sv.id].map(q).join(', ')} FROM ${q(sv.table)} ` +
    `WHERE 1=CONTAINS(POINT('ICRS', ${q(sv.ra)}, ${q(sv.dec)}), CIRCLE('ICRS', ${wrap360(ra).toFixed(6)}, ${dec.toFixed(6)}, ${Math.min(rDeg, OVERLAY_MAX_DEG).toFixed(5)})) ORDER BY ${q(sv.mag)}`;
  const url = `${VIZIER_TAP}?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent(adql)}`;
  const res = await fetchWithTimeout(url, o.ms || 12000);
  if (!res.ok) throw new SkyError('HTTP', `VizieR HTTP ${res.status}`, { status: res.status });
  const text = await res.text();
  if (/^\s*</.test(text)) throw new SkyError('JSON', 'VizieR yanıtı CSV değil');
  const out = [];
  parseCsv(text).rows.forEach((r) => {
    const rr = parseFloat(r[sv.ra]); const dd = parseFloat(r[sv.dec]);
    if (!isFinite(rr) || !isFinite(dd)) return;
    const pa = parseFloat(r[sv.pmra]); const pd = parseFloat(r[sv.pmdec]); const m = parseFloat(r[sv.mag]);
    out.push({ id: String(r[sv.id] || '').trim(), ra: rr, dec: dd, pmra: isFinite(pa) ? pa : 0, pmdec: isFinite(pd) ? pd : 0, mag: isFinite(m) ? m : NaN, epoch: sv.epoch, hasPm: isFinite(pa) && isFinite(pd) });
  });
  return out;
}

// SPHEREx Seviye-2 FLAGS bitleri (IRSA Explanatory Supplement). kind: bad = ölçümden çıkarılır · info = bilgi (çıkarılmaz) · contam = komşu/kalıntı kirlenmesi
const SPHEREX_FLAGS = [
  { bit: 0, name: 'TRANSIENT', kind: 'bad', d: 'cosmic-ray / transient hit' },
  { bit: 1, name: 'OVERFLOW', kind: 'bad', d: 'saturated / overflow' },
  { bit: 2, name: 'SUR_ERROR', kind: 'bad', d: 'sample-up-the-ramp fit error' },
  { bit: 6, name: 'NONFUNC', kind: 'bad', d: 'non-functional pixel' },
  { bit: 7, name: 'DICHROIC', kind: 'bad', d: 'dichroic-edge region' },
  { bit: 9, name: 'MISSING_DATA', kind: 'bad', d: 'missing data' },
  { bit: 10, name: 'HOT', kind: 'bad', d: 'hot pixel' },
  { bit: 11, name: 'COLD', kind: 'bad', d: 'cold pixel' },
  { bit: 15, name: 'NONLINEAR', kind: 'bad', d: 'non-linear response' },
  { bit: 25, name: 'STREAK', kind: 'contam', d: 'streak (e.g. satellite / bright-source trail)' },
  { bit: 27, name: 'SNOWBALL', kind: 'contam', d: 'snowball (large cosmic-ray event)' },
  { bit: 29, name: 'SATELLITE_HALO', kind: 'contam', d: 'halo around a satellite trail' },
  { bit: 17, name: 'PERSIST', kind: 'contam', d: 'persistence from an earlier bright exposure' },
  { bit: 21, name: 'SOURCE', kind: 'contam', d: 'pixel mapped to a catalogued source (possible blend)' },
  { bit: 19, name: 'OUTLIER', kind: 'info', d: 'outlier in the sample ramp' },
  { bit: 12, name: 'FULLSAMPLE', kind: 'info', d: 'full-sample readout region' },
];
const FLAG_KIND_COLOR = { bad: '#F0587A', contam: '#E3B567', info: '#8DB9FF' };
const flagHas = (v, bit) => ((v >>> bit) & 1) === 1;
// Izgara piksellerine en yakın komşu ile bayrak maskesi (Uint32)
function resampleFlags(exp, grid) {
  const n = grid.n;
  const out = new Uint32Array(n * n);
  if (!exp.flags) return out;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const s = grid.pixToSky(i, j);
      const p = exp.wcs.skyToPix(s.ra, s.dec);
      const x = Math.round(p.x - 1); const y = Math.round(p.y - 1);
      if (x < 0 || y < 0 || x >= exp.w || y >= exp.h) continue;
      out[j * n + i] = exp.flags[y * exp.w + x] >>> 0;
    }
  }
  return out;
}
// Bir pozlamanın tüm kesitinde ve hedef açıklığında bayrak sayımı
function flagSummary(exp, tgt, rAp) {
  if (!exp || !exp.flags) return null;
  const all = SPHEREX_FLAGS.map(() => 0); const ap = all.slice();
  let nAp = 0; let anyAll = 0; let anyAp = 0;
  const pr = propagate(tgt, exp.epochYear);
  const pp = exp.wcs.skyToPix(pr.ra, pr.dec);
  const cx = pp.x - 1; const cy = pp.y - 1; const r2 = rAp * rAp;
  for (let y = 0; y < exp.h; y++) {
    for (let x = 0; x < exp.w; x++) {
      const inAp = (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2;
      if (inAp) nAp++;
      const v = exp.flags[y * exp.w + x] >>> 0;
      if (!v) continue;
      anyAll++; if (inAp) anyAp++;
      for (let q = 0; q < SPHEREX_FLAGS.length; q++) if (flagHas(v, SPHEREX_FLAGS[q].bit)) { all[q]++; if (inAp) ap[q]++; }
    }
  }
  return { total: exp.w * exp.h, nAp, all, ap, anyAll, anyAp };
}
// Ortak ızgaradaki çerçeveleri arka plan çıkarılmış ortalama ile toplar (rastgele gürültü ≈ 1/√N)
function stackFrames(frames, idxs) {
  const n2 = frames[idxs[0]].f.length;
  const out = new Float32Array(n2); const cnt = new Uint16Array(n2);
  idxs.forEach((i) => {
    const { f, st } = frames[i];
    for (let k = 0; k < n2; k++) { const v = f[k]; if (isFinite(v)) { out[k] += v - st.med; cnt[k]++; } }
  });
  for (let k = 0; k < n2; k++) out[k] = cnt[k] ? out[k] / cnt[k] : NaN;
  return { f: out, st: robustStats(out), n: idxs.length };
}

/* ---------------- URL ile sorgu: ?ra=&dec=&fov=  (+ name · pane · view · mode · lang · embed · auto) ---------------- */
// ra/dec: derece ya da 17h57m48s / +04°41′36″ ; fov: derece (Aladin ile aynı)
function parseUrlInit(search) {
  let q;
  try { q = new URLSearchParams(search || ''); } catch (e) { return null; }
  const has = (k) => q.has(k) && String(q.get(k)).trim() !== '';
  const out = { embed: q.get('embed') === '1' || q.get('embed') === 'true', auto: q.get('auto') === '1' || q.get('auto') === 'true' };
  if (has('ra') && has('dec')) {
    const ra = parseAngle(q.get('ra'), 'ra'); const dec = parseAngle(q.get('dec'), 'dec');
    if (isFinite(ra) && isFinite(dec) && dec >= -89.9 && dec <= 89.9) out.target = { ra: wrap360(ra), dec };
  }
  if (has('fov')) { const f = Number(String(q.get('fov')).replace(',', '.')); if (isFinite(f) && f > 0) out.fov = clamp(f, 0.01, 2); }
  if (has('name')) out.name = String(q.get('name')).slice(0, 80);
  if (has('pane') && /^(sky|irsa)$/.test(q.get('pane'))) out.pane = q.get('pane');
  if (has('view') && /^(real|map|catalog)$/.test(q.get('view'))) out.view = q.get('view');
  if (has('mode') && /^(single|blink|diff|rgb|movie|sum)$/.test(q.get('mode'))) out.mode = q.get('mode');
  if (has('lang') && LANGS.some((l) => l.code === q.get('lang'))) out.lang = q.get('lang');
  return out;
}
function shareBaseUrl() {
  try {
    const l = window.location;
    if (/^(https?|file):$/.test(l.protocol)) return l.origin === 'null' ? `${l.protocol}//${l.pathname}` : `${l.origin}${l.pathname}`;
  } catch (e) { /* yoksay */ }
  return '';
}
// p: {ra, dec, fov(derece), name?, pane?, mode?, lang?, embed?, auto?}
function buildShareUrl(p) {
  const q = new URLSearchParams();
  q.set('ra', wrap360(p.ra).toFixed(5));
  q.set('dec', p.dec.toFixed(5));
  if (p.fov) q.set('fov', String(Math.round(p.fov * 10000) / 10000));
  if (p.name) q.set('name', p.name);
  if (p.pane) q.set('pane', p.pane);
  if (p.mode && p.mode !== 'single') q.set('mode', p.mode);
  if (p.lang) q.set('lang', p.lang);
  if (p.embed) q.set('embed', '1');
  if (p.auto) q.set('auto', '1');
  return `${shareBaseUrl()}?${q.toString()}`;
}
const embedSnippet = (url) => `<iframe src="${url}" title="NYXE · SPHEREx" width="100%" height="680" style="border:0" allow="fullscreen" loading="lazy"></iframe>`;

/* =====================================================================
   GERMELER: Zscale · asinh · paletler
   ===================================================================== */
function sampleFinite(data, maxN = 24000) {
  const n = data.length;
  const step = Math.max(1, Math.floor(n / maxN));
  const out = new Float32Array(Math.ceil(n / step));
  let k = 0;
  for (let i = 0; i < n; i += step) { const v = data[i]; if (v === v && v !== Infinity && v !== -Infinity) out[k++] = v; }
  return out.subarray(0, k);
}
// IRAF/astropy ZScaleInterval (contrast 0.25, krej 2.5, 5 yineleme)
function zscaleRange(sample, contrast = 0.25) {
  const n = sample.length;
  if (!n) return { lo: 0, hi: 1 };
  const s = Float32Array.from(sample).sort();
  const zmin = s[0];
  const zmax = s[n - 1];
  if (n < 16 || !(zmax > zmin)) return { lo: zmin, hi: zmax > zmin ? zmax : zmin + 1 };
  const med = n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
  const mid = (n - 1) / 2;
  const good = new Uint8Array(n).fill(1);
  let slope = 0;
  for (let it = 0; it < 5; it++) {
    let sx = 0; let sy = 0; let sxx = 0; let sxy = 0; let m = 0;
    for (let i = 0; i < n; i++) if (good[i]) { const xi = i - mid; sx += xi; sy += s[i]; sxx += xi * xi; sxy += xi * s[i]; m++; }
    const den = m * sxx - sx * sx;
    if (m < 2 || den === 0) break;
    slope = (m * sxy - sx * sy) / den;
    const icpt = (sy - slope * sx) / m;
    let ss = 0;
    for (let i = 0; i < n; i++) if (good[i]) { const r = s[i] - (icpt + slope * (i - mid)); ss += r * r; }
    const sg = Math.sqrt(ss / m);
    let rej = 0;
    for (let i = 0; i < n; i++) if (good[i]) { const r = s[i] - (icpt + slope * (i - mid)); if (Math.abs(r) > 2.5 * sg) { good[i] = 0; rej++; } }
    if (!rej || m - rej < Math.max(5, n * 0.5)) break;
  }
  const sl = slope / contrast;
  let lo = Math.max(zmin, med - mid * sl);
  let hi = Math.min(zmax, med + (n - 1 - mid) * sl);
  if (!(hi > lo)) { lo = zmin; hi = zmax; }
  return { lo, hi };
}
function medMad(sample) {
  const n = sample.length;
  if (!n) return { med: 0, mad: 1 };
  const s = Float32Array.from(sample).sort();
  const med = n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = Math.abs(s[i] - med);
  d.sort();
  const mad = (n % 2 ? d[(n - 1) >> 1] : 0.5 * (d[n / 2 - 1] + d[n / 2])) * 1.4826;
  return { med, mad: mad > 0 ? mad : 1 };
}
const PALETTES = {
  gray: [[0, 0, 0, 0], [1, 255, 255, 255]],
  ir: [[0, 0, 0, 0], [0.28, 96, 8, 12], [0.55, 235, 96, 18], [0.8, 255, 205, 110], [1, 255, 250, 235]],
};
const _lutCache = {};
function paletteLut(name) {
  if (_lutCache[name]) return _lutCache[name];
  const st = PALETTES[name] || PALETTES.gray;
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const u = i / 255;
    let k = 0;
    while (k < st.length - 2 && u > st[k + 1][0]) k++;
    const a = st[k]; const b = st[k + 1];
    const f = clamp((u - a[0]) / (b[0] - a[0] || 1), 0, 1);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * f;
  }
  _lutCache[name] = lut;
  return lut;
}
const ASINH_SOFT = 0.12;
function stretch01(v, lo, hi, asinhOn) {
  let x = (v - lo) / (hi - lo || 1);
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  return asinhOn ? Math.asinh(x / ASINH_SOFT) / Math.asinh(1 / ASINH_SOFT) : x;
}

/* =====================================================================
   YEREL DOSYA ÇERÇEVELERİ  (FITS · PNG · JPG)
   frame = { kind, name, w, h, data (Float32, w*h), flipY, rgba?, ds, wcs?, yr?, meta, cache }
   FITS: veri satırı 0 = ALT satır (flipY); ds = orijinale göre blok-ortalama faktörü
   ===================================================================== */
const FRAME_MAX = 2048;
function dateToYear(s) {
  if (typeof s !== 'string' || !s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}/.test(s) ? (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) || s.length <= 10 ? s : s + 'Z') : s;
  const ms = Date.parse(iso);
  return isFinite(ms) ? 2000 + (ms - Date.UTC(2000, 0, 1, 12)) / (365.25 * 86400000) : null;
}
function headerYear(kv) {
  if (typeof kv['MJD-OBS'] === 'number' && kv['MJD-OBS'] > 20000) return mjdToYear(kv['MJD-OBS']);
  if (typeof kv.MJD_OBS === 'number' && kv.MJD_OBS > 20000) return mjdToYear(kv.MJD_OBS);
  return dateToYear(kv['DATE-OBS']) ?? dateToYear(kv.DATE_OBS) ?? dateToYear(kv.DATE) ?? null;
}
function finishFrame(fr) {
  fr.cache = {};
  return fr;
}
async function frameFromFits(input, name) {
  const u8 = await gunzipIfNeeded(input);
  const fits = parseFits(u8);
  const ok = fits.hdus.filter((h) => h.dims.length >= 2 && h.dims[0] > 1 && h.dims[1] > 1 && (h.xt === '' || h.xt === 'IMAGE'));
  const hdu = ok.find((h) => h.name.toUpperCase() === 'IMAGE') || ok[0];
  if (!hdu) {
    if (fits.hdus.some((h) => h.kv.ZIMAGE === true)) throw new RealError('FITS_COMPRESSED', 'Sıkıştırılmış (tile) FITS');
    throw new RealError('FITS_NOIMAGE', 'FITS içinde 2B görüntü yok');
  }
  const px = fitsPixels(fits, hdu, 'f32');
  const prim = fits.hdus[0].kv;
  let wcs = null;
  try { wcs = makeFitsWCS(hdu.kv); } catch (e) {
    try { wcs = makeFitsWCS({ ...prim, ...hdu.kv }); } catch (e2) { wcs = null; }
  }
  const kv = { ...prim, ...hdu.kv };
  const fr = finishFrame({
    kind: 'fits', name, w: px.w, h: px.h, origW: px.w, origH: px.h, data: px.data, flipY: true, rgba: null, ds: 1, wcs,
    yr: headerYear(kv),
    meta: { object: String(kv.OBJECT || '').trim(), dateObs: String(kv['DATE-OBS'] || '').trim(), bunit: String(kv.BUNIT || '').trim(), bitpix: hdu.bitpix, ext: hdu.name || 'PRIMARY', telescop: String(kv.TELESCOP || kv.OBSERVAT || '').trim(), instrume: String(kv.INSTRUME || '').trim(), planes: hdu.dims.length >= 3 ? hdu.dims[2] : 1 },
  });
  return downsampleFrame(fr, FRAME_MAX);
}
function imageToCanvasData(img, name, maxDim = FRAME_MAX) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) throw new SkyError('EMPTY', 'boş görüntü');
  const f = Math.min(1, maxDim / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * f));
  const h = Math.max(1, Math.round(ih * f));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, w, h);
  const id = cx.getImageData(0, 0, w, h);
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.2126 * id.data[i * 4] + 0.7152 * id.data[i * 4 + 1] + 0.0722 * id.data[i * 4 + 2];
  return finishFrame({ kind: 'image', name, w, h, origW: iw, origH: ih, data: lum, flipY: false, rgba: id.data, ds: 1, wcs: null, yr: null, meta: { object: '', dateObs: '', bunit: '', bitpix: 8, ext: 'IMAGE' } });
}
function frameFromImageBytes(u8, name) {
  return new Promise((resolve, reject) => {
    const mime = u8[0] === 0x89 ? 'image/png' : u8[0] === 0xff ? 'image/jpeg' : u8[0] === 0x47 ? 'image/gif' : u8[0] === 0x52 ? 'image/webp' : 'image/bmp';
    const url = URL.createObjectURL(new Blob([u8], { type: mime }));
    const img = new Image();
    img.onload = () => { try { const fr = imageToCanvasData(img, name); URL.revokeObjectURL(url); resolve(fr); } catch (e) { URL.revokeObjectURL(url); reject(e); } };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new SkyError('FORMAT', 'görüntü çözülemedi')); };
    img.src = url;
  });
}
// Dosyayı içeriğine bakarak tanır (uzantıya güvenmez): gzip → FITS · 'SIMPLE' → FITS · PNG/JPG/GIF/WEBP/BMP → görüntü
async function readLocalFrame(file) {
  const name = (file && file.name) || 'dosya';
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (u8.length < 16) throw new SkyError('EMPTY', 'dosya boş');
  const isGz = u8[0] === 0x1f && u8[1] === 0x8b;
  const isFits = isGz || String.fromCharCode(u8[0], u8[1], u8[2], u8[3], u8[4], u8[5]) === 'SIMPLE';
  if (isFits) return frameFromFits(u8, name);
  const isImg = (u8[0] === 0x89 && u8[1] === 0x50) || (u8[0] === 0xff && u8[1] === 0xd8) || (u8[0] === 0x47 && u8[1] === 0x49) || (u8[0] === 0x52 && u8[1] === 0x49) || (u8[0] === 0x42 && u8[1] === 0x4d);
  if (isImg) return frameFromImageBytes(u8, name);
  throw new SkyError('FORMAT', 'desteklenmeyen dosya türü');
}
function downsampleFrame(fr, maxDim) {
  const f = Math.ceil(Math.max(fr.w, fr.h) / maxDim);
  if (f <= 1) return fr;
  const nw = Math.ceil(fr.w / f);
  const nh = Math.ceil(fr.h / f);
  const out = new Float32Array(nw * nh);
  const rgba = fr.rgba ? new Uint8ClampedArray(nw * nh * 4) : null;
  for (let J = 0; J < nh; J++) {
    for (let I = 0; I < nw; I++) {
      let s = 0; let n = 0; let r = 0; let g = 0; let b = 0; let a = 0;
      const j1 = Math.min(fr.h, (J + 1) * f);
      const i1 = Math.min(fr.w, (I + 1) * f);
      for (let j = J * f; j < j1; j++) {
        for (let i = I * f; i < i1; i++) {
          const v = fr.data[j * fr.w + i];
          if (v === v && v !== Infinity && v !== -Infinity) { s += v; n++; }
          if (rgba) { const q = (j * fr.w + i) * 4; r += fr.rgba[q]; g += fr.rgba[q + 1]; b += fr.rgba[q + 2]; a += fr.rgba[q + 3]; }
        }
      }
      out[J * nw + I] = n ? s / n : NaN;
      if (rgba) { const m = Math.max(1, (j1 - J * f) * (i1 - I * f)); const q = (J * nw + I) * 4; rgba[q] = r / m; rgba[q + 1] = g / m; rgba[q + 2] = b / m; rgba[q + 3] = a / m; }
    }
  }
  return finishFrame({ ...fr, w: nw, h: nh, data: out, rgba, ds: fr.ds * f });
}
// Ekran/veri piksel indeksi (i,j; 0 tabanlı, piksel merkezi tamsayı) ↔ gökyüzü
const fitsXY = (fr, i, j) => ({ x: i * fr.ds + (fr.ds - 1) / 2 + 1, y: j * fr.ds + (fr.ds - 1) / 2 + 1 });
function frameSky(fr, i, j) {
  if (!fr.wcs) return null;
  const p = fitsXY(fr, i, j);
  return fr.wcs.pixToSky(p.x, p.y);
}
function frameSkyToData(fr, ra, dec) {
  if (!fr.wcs) return null;
  const p = fr.wcs.skyToPix(ra, dec);
  return { i: (p.x - 1 - (fr.ds - 1) / 2) / fr.ds, j: (p.y - 1 - (fr.ds - 1) / 2) / fr.ds };
}
// veri indeksi → tuval (CSS öncesi) koordinatı
const dataToCanvas = (fr, i, j) => ({ x: i + 0.5, y: fr.flipY ? fr.h - j - 0.5 : j + 0.5 });
const canvasToData = (fr, x, y) => ({ i: x - 0.5, j: fr.flipY ? fr.h - y - 0.5 : y - 0.5 });
function frameCenterSky(fr) {
  const s = frameSky(fr, (fr.w - 1) / 2, (fr.h - 1) / 2);
  if (!s) return null;
  const c = frameSky(fr, 0, 0);
  const d = frameSky(fr, fr.w - 1, fr.h - 1);
  const rad = c && d ? Math.min(0.25, angSepArcsec(c.ra, c.dec, d.ra, d.dec) / 3600 / 2 * 1.02) : 0.1;
  return { ra: s.ra, dec: s.dec, radiusDeg: Math.max(0.01, rad) };
}
function frameStats(fr) {
  if (fr.cache.stats) return fr.cache.stats;
  const smp = sampleFinite(fr.data);
  let mn = Infinity; let mx = -Infinity;
  for (let i = 0; i < smp.length; i++) { if (smp[i] < mn) mn = smp[i]; if (smp[i] > mx) mx = smp[i]; }
  const z = zscaleRange(smp);
  const mm = medMad(smp);
  fr.cache.stats = { n: smp.length, min: smp.length ? mn : 0, max: smp.length ? mx : 1, zlo: z.lo, zhi: z.hi, med: mm.med, mad: mm.mad };
  return fr.cache.stats;
}
// stretch: 'zasinh' (Zscale + asinh, varsayılan) · 'zlin' (Zscale doğrusal) · 'mmasinh' (Min–Maks + asinh)
function frameToRgba(fr, o = {}) {
  const palette = o.palette || 'gray';
  const stretch = o.stretch || 'zasinh';
  const out = new Uint8ClampedArray(fr.w * fr.h * 4);
  if (fr.kind === 'image' && fr.rgba && !o.enhance) { out.set(fr.rgba); return out; }
  const st = frameStats(fr);
  const lo = stretch === 'mmasinh' ? st.min : st.zlo;
  const hi = stretch === 'mmasinh' ? st.max : st.zhi;
  const asinhOn = stretch !== 'zlin';
  const lut = paletteLut(palette);
  for (let j = 0; j < fr.h; j++) {
    const rj = fr.flipY ? fr.h - 1 - j : j;
    for (let i = 0; i < fr.w; i++) {
      const v = fr.data[j * fr.w + i];
      const q = (rj * fr.w + i) * 4;
      if (!(v === v) || v === Infinity || v === -Infinity) { out[q] = 10; out[q + 1] = 14; out[q + 2] = 24; out[q + 3] = 255; continue; }
      const k = Math.round(stretch01(v, lo, hi, asinhOn) * 255) * 3;
      out[q] = lut[k]; out[q + 1] = lut[k + 1]; out[q + 2] = lut[k + 2]; out[q + 3] = 255;
    }
  }
  return out;
}
/* ---------------- İki çerçeveyi hizalama + fark ---------------- */
function sampleBilinear(d, w, h, x, y) {
  if (!(x >= -0.5 && y >= -0.5 && x <= w - 0.5 && y <= h - 0.5)) return NaN;
  const xc = clamp(x, 0, w - 1);
  const yc = clamp(y, 0, h - 1);
  const x0 = Math.floor(xc); const y0 = Math.floor(yc);
  const x1 = Math.min(w - 1, x0 + 1); const y1 = Math.min(h - 1, y0 + 1);
  const fx = xc - x0; const fy = yc - y0;
  const a = d[y0 * w + x0]; const b = d[y0 * w + x1]; const c = d[y1 * w + x0]; const e = d[y1 * w + x1];
  if (!(isFinite(a) && isFinite(b) && isFinite(c) && isFinite(e))) {
    const nn = d[Math.round(yc) * w + Math.round(xc)];
    return isFinite(nn) ? nn : NaN;
  }
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}
// other → base ızgarası. mode: 'same' (aynı ızgara) · 'wcs' (gökyüzü koordinatlarıyla) · 'scaled' (yalnızca ölçekleme; yaklaşık)
function alignFrame(base, other) {
  const w = base.w; const h = base.h;
  if (base.wcs && other.wcs) {
    let maxd = 0;
    const pts = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [(w - 1) / 2, (h - 1) / 2]];
    for (const [i, j] of pts) {
      const s = frameSky(base, i, j);
      const q = frameSkyToData(other, s.ra, s.dec);
      maxd = Math.max(maxd, Math.hypot(q.i - i, q.j - j));
    }
    if (other.w === w && other.h === h && maxd < 0.5) return { data: other.data, mode: 'same', flipY: other.flipY === base.flipY };
    const out = new Float32Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const s = frameSky(base, i, j);
        const q = frameSkyToData(other, s.ra, s.dec);
        out[j * w + i] = sampleBilinear(other.data, other.w, other.h, q.i, q.j);
      }
    }
    return { data: out, mode: 'wcs', flipY: other.flipY === base.flipY };
  }
  if (other.w === w && other.h === h) return { data: other.data, mode: 'same', flipY: other.flipY === base.flipY };
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) out[j * w + i] = sampleBilinear(other.data, other.w, other.h, ((i + 0.5) * other.w) / w - 0.5, ((j + 0.5) * other.h) / h - 0.5);
  }
  return { data: out, mode: 'scaled', flipY: other.flipY === base.flipY };
}
// Fark görüntüsü: her çerçeve (medyan, MAD) ile ölçeklenir → Epoch 2 − Epoch 1 (σ biriminde). Kırmızı = E1'de parlak, camgöbeği = E2'de parlak.
function diffFrames(a, b) {
  const al = alignFrame(a, b);
  let bd = al.data;
  if (!al.flipY) {                          // biri FITS (alt-yukarı) öbürü görüntü (üst-aşağı): satırları çevir
    const t = new Float32Array(a.w * a.h);
    for (let j = 0; j < a.h; j++) t.set(bd.subarray((a.h - 1 - j) * a.w, (a.h - j) * a.w), j * a.w);
    bd = t;
  }
  const sa = frameStats(a);
  const sb = medMad(sampleFinite(bd));
  const d = new Float32Array(a.w * a.h);
  let nan = 0;
  for (let i = 0; i < d.length; i++) {
    const x = (a.data[i] - sa.med) / sa.mad;
    const y = (bd[i] - sb.med) / sb.mad;
    const v = y - x;
    if (v === v && isFinite(v)) d[i] = v; else { d[i] = 0; nan++; }
  }
  return { w: a.w, h: a.h, d, mode: al.mode, flipY: a.flipY, nanFrac: nan / d.length };
}
function diffToRgba(df) {
  const out = new Uint8ClampedArray(df.w * df.h * 4);
  const norm = Math.asinh(40 / 3);
  for (let j = 0; j < df.h; j++) {
    const rj = df.flipY ? df.h - 1 - j : j;
    for (let i = 0; i < df.w; i++) {
      const v = df.d[j * df.w + i];
      const u = clamp(Math.asinh(v / 3) / norm, -1, 1);
      const q = (rj * df.w + i) * 4;
      const m = Math.abs(u);
      if (u >= 0) { out[q] = 14 + 200 * m; out[q + 1] = 18 + 237 * m; out[q + 2] = 30 + 225 * m; }
      else { out[q] = 14 + 241 * m; out[q + 1] = 18 + 33 * m; out[q + 2] = 30 + 72 * m; }
      out[q + 3] = 255;
    }
  }
  return out;
}
// Çevrimdışı yedek: gökyüzü fotoğrafı yokken kanvasa çizilen yapay yıldız tozu (tohumlu; asla boş-siyah değil)
function skyPlaceholder(ctx, S, seed) {
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S * 0.75);
  g.addColorStop(0, '#0e1730'); g.addColorStop(1, '#04060c');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  let s = (Math.floor(seed * 1000) || 7) >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 160; i++) {
    const x = rnd() * S; const y = rnd() * S; const r = 0.4 + rnd() * rnd() * 1.8; const a = 0.15 + rnd() * 0.55;
    ctx.fillStyle = `rgba(${200 + Math.floor(rnd() * 55)},${215 + Math.floor(rnd() * 40)},255,${a})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }
}
/* =====================================================================
   BÖLÜM 8c — GERÇEK ALAN (Keşif Haritası için)
   Haritanın 18′×18′ karesi için GERÇEK katalog verisinden, harita motoruyla uyumlu bir gökyüzü kurar:
     · SIMBAD TAP  → karedeki gerçek cisimler: koordinat (ICRS/J2000), özdevinim, paralaks, tür, V/J/K parlaklığı
     · SkyBoT      → her epoch tarihinde karenin içinden geçen GERÇEK asteroit/kuyruklu yıldızlar (efemeris)
   Konumlar (özdevinim + paralaks) her epoch için gerçek verilerden hesaplanır.
   DÜRÜSTLÜK NOTU: görüntü pikselleri ve 102 bantlı spektrumlar katalog parlaklığına ölçeklenmiş MODELLERDEN
   (Planck/şablon) üretilir; SPHEREx'in ölçtüğü spektrum değildir. Gerçek ölçüm için "SPHEREx pikselleri · IRSA"
   panelini, gerçek fotoğraf için haritadaki "Gerçek fotoğraf" kipini kullanın. Ağ yoksa uygulama simülasyona döner.
   ===================================================================== */
const RS_TOP = 1500;                                         // SIMBAD'den en parlak (J) cisimlerden en çok bu kadarı
const RS_RADIUS = ((W / 2) * Math.SQRT2 * PLATE) / 3600 * 1.01;   // kareyi köşegeniyle kapsayan koni yarıçapı [derece] ≈ 0.214°
const RS_PM_MIN = 30;                                        // mas/yıl · bunun altı bu zaman aralığında "sabit" sayılır
const RS_EDGE = 60;                                          // kare dışında tutulan şerit [piksel]
const RS_SIMBAD_MS = 14000;
const RS_SKYBOT_MS = 7000;
const SKYBOT_BASES = [
  'https://ssp.imcce.fr/webservices/skybot/skybotconesearch_query.php',
  'https://ssp.imcce.fr/webservices/skybot/api/conesearch.php',
];
const jdOfIso = (iso) => Date.parse(iso + 'T00:00:00Z') / 86400000 + 2440587.5;

/* ---------------- SIMBAD: karedeki cisimler (+ V/J/K) ---------------- */
function simbadFieldAdql(ra, dec, rDeg, top, cols) {
  const c = cols.join(', ');
  const any = cols.map((x) => `${x} IS NOT NULL`).join(' OR ');
  return `SELECT TOP ${top} main_id, ra, dec, otype, pmra, pmdec, plx_value, sp_type, ${c} FROM basic JOIN allfluxes ON basic.oid = allfluxes.oidref ` +
    `WHERE ${adqlCone(ra, dec, rDeg)} AND (${any}) ORDER BY ${cols.indexOf('J') >= 0 ? 'J' : cols[0]}`;
}
function normSimbadRow(r) {
  const ra = numOrNull(r.ra), dec = numOrNull(r.dec);
  if (ra === null || dec === null) return null;
  return {
    id: String(r.main_id || '?').replace(/\s+/g, ' ').trim(), ra, dec, otype: String(r.otype || '').trim(),
    pmra: numOrNull(r.pmra), pmdec: numOrNull(r.pmdec), plx: numOrNull(r.plx_value), sp: String(r.sp_type || '').trim(),
    V: numOrNull(r.V), J: numOrNull(r.J), K: numOrNull(r.K), epoch: 2000,
  };
}
async function simbadField(ra, dec, rDeg, o = {}) {
  const top = o.top || RS_TOP;
  const attempts = [['V', 'J', 'K'], ['V', 'J']];                // ilk sorgu reddedilirse (sütun adı farkı) sade sürüm
  let last = null;
  for (let i = 0; i < attempts.length; i++) {
    try {
      const rows = await simbadRows(simbadFieldAdql(ra, dec, rDeg, top, attempts[i]), o.ms || RS_SIMBAD_MS);
      return rows.map(normSimbadRow).filter(Boolean);
    } catch (e) {
      last = e;
      if (!(e instanceof SkyError) || e.code !== 'HTTP') break;    // ağ/zaman aşımı: ikinci deneme anlamsız
    }
  }
  throw last || new SkyError('HTTP', 'SIMBAD yanıtı alınamadı');
}

/* ---------------- SkyBoT: epoch tarihinde karedeki Güneş Sistemi cisimleri ---------------- */
function skybotFieldUrl(base, ra, dec, rDeg, iso) {
  return `${base}?-ep=${jdOfIso(iso).toFixed(5)}&-ra=${wrap360(ra).toFixed(6)}&-dec=${dec.toFixed(6)}&-rd=${rDeg.toFixed(4)}&-mime=json&-output=basic&-loc=500`;
}
// "09 56 23.21" · "09:56:23.2" · 149.0967 (derece) · 9.9398 (saat) → derece; belirsiz sayılarda koniye uyan yorum seçilir
function skybotAngle(v, kind, ref, rDeg) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string' && /[\s:hdms°]/i.test(v.trim()) && /\d[\s:hdms°]+\d/i.test(v.trim())) {
    const a = parseAngle(v.trim().replace(/:/g, ' '), kind === 'ra' ? 'ra' : 'dec');
    return isFinite(a) ? a : null;
  }
  const x = typeof v === 'number' ? v : parseFloat(v);
  if (!isFinite(x)) return null;
  if (kind !== 'ra') return x;
  const cands = [x, x * 15];
  let best = null; let bd = 1e9;
  cands.forEach((c) => { const d = Math.abs(((c - ref + 540) % 360) - 180); if (d < bd) { bd = d; best = c; } });
  return best;
}
const keyOf = (r, re) => { const k = Object.keys(r).find((x) => re.test(x)); return k === undefined ? undefined : r[k]; };
function parseSkybot(txt, ra0, dec0, rDeg) {
  let arr = null;
  try {
    const j = JSON.parse(txt);
    arr = Array.isArray(j) ? j : Array.isArray(j.data) ? j.data : Array.isArray(j.results) ? j.results : Array.isArray(j.rows) ? j.rows : null;
    if (!arr && j && typeof j === 'object' && Array.isArray(j.columns) && Array.isArray(j.rows)) arr = null;
  } catch (e) {
    // boru (|) ayraçlı metin: "# Num | Name | RA(h) | ..." başlığı
    const lines = String(txt).split(/\r?\n/).filter((l) => l.trim());
    const head = lines.find((l) => /^#.*\|/.test(l) && /name/i.test(l));
    if (head) {
      const cols = head.replace(/^#\s*/, '').split('|').map((c) => c.trim());
      arr = lines.filter((l) => !/^#/.test(l)).map((l) => { const p = l.split('|').map((c) => c.trim()); const o = {}; cols.forEach((c, i) => { o[c] = p[i]; }); return o; });
    }
  }
  if (!arr) throw new SkyError('JSON', 'SkyBoT yanıtı anlaşılamadı');
  const out = [];
  arr.forEach((r) => {
    if (!r || typeof r !== 'object') return;
    const raD = skybotAngle(keyOf(r, /^ra(\s|\(|$)/i), 'ra', ra0, rDeg);
    const decD = skybotAngle(keyOf(r, /^dec?(\s|\(|$)/i), 'dec', dec0, rDeg);
    if (raD === null || decD === null) return;
    if (angSepArcsec(raD, decD, ra0, dec0) > rDeg * 3600 * 1.25) return;       // yanlış çözülmüş koordinat → at
    const name = String(keyOf(r, /^name/i) || keyOf(r, /^num/i) || '?').trim();
    const num = keyOf(r, /^num/i);
    const cls = String(keyOf(r, /^(class|type)/i) || '').trim();
    const mag = parseFloat(keyOf(r, /^v(mag)?(\b|\s|\()/i) !== undefined ? keyOf(r, /^v(mag)?(\b|\s|\()/i) : keyOf(r, /^mag/i));
    out.push({ name, num: num === undefined || num === '' || Number(num) < 0 ? '' : String(num).trim(), cls, mag: isFinite(mag) ? mag : null, ra: raD, dec: decD });
  });
  return out;
}
async function skybotField(ra, dec, rDeg, iso, o = {}) {
  let last = null;
  for (let i = 0; i < SKYBOT_BASES.length; i++) {
    try {
      const res = await fetchWithTimeout(skybotFieldUrl(SKYBOT_BASES[i], ra, dec, rDeg, iso), o.ms || RS_SKYBOT_MS);
      if (!res.ok) throw new SkyError('HTTP', `SkyBoT HTTP ${res.status}`);
      return parseSkybot(await res.text(), ra, dec, rDeg);
    } catch (e) { last = e; }
  }
  throw last || new SkyError('HTTP', 'SkyBoT yanıtı alınamadı');
}

/* ---------------- Tüm gerçek veriyi topla (SIMBAD zorunlu · SkyBoT isteğe bağlı) ---------------- */
async function fetchRealField(cfg, o = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new SkyError('OFFLINE', 'çevrimdışı');
  const rDeg = RS_RADIUS;
  const part = o.onPart || (() => {});
  const simbadP = simbadField(cfg.ra, cfg.dec, rDeg, { top: o.top, ms: o.ms }).then((v) => { part('simbad', 'ok', v.length); return v; }, (e) => { part('simbad', 'fail'); throw e; });
  const skyP = EPOCHS.map((ep) => skybotField(cfg.ra, cfg.dec, rDeg, ep.iso, { ms: o.skybotMs }).then(
    (rows) => { part('skybot', 'ok', rows.length); return { status: 'ok', rows }; },
    (e) => { part('skybot', 'fail'); return { status: 'fail', rows: [], error: String((e && e.message) || e) }; }));
  const [simbad, ...skybot] = await Promise.all([simbadP, ...skyP]);
  return { ra: cfg.ra, dec: cfg.dec, simbad, skybot, fetchedAt: new Date().toISOString() };
}

/* ---------------- SIMBAD türü / tayf türü → model ---------------- */
const SP_TEFF = { O: [42000, 30000], B: [30000, 10500], A: [9700, 7600], F: [7300, 6100], G: [5950, 5300], K: [5200, 3900], M: [3800, 2400], L: [2300, 1400], T: [1300, 600], Y: [500, 300] };
const JK_TEFF = [[-0.15, 20000], [0.0, 9000], [0.2, 6800], [0.4, 5700], [0.55, 5000], [0.7, 4400], [0.85, 3900], [1.0, 3500], [1.2, 3100], [1.6, 2700]];
function teffFromJK(jk) {
  if (jk === null || !isFinite(jk)) return null;
  if (jk <= JK_TEFF[0][0]) return JK_TEFF[0][1];
  for (let i = 1; i < JK_TEFF.length; i++) {
    if (jk <= JK_TEFF[i][0]) { const a = JK_TEFF[i - 1], b = JK_TEFF[i]; return a[1] + ((b[1] - a[1]) * (jk - a[0])) / (b[0] - a[0]); }
  }
  return JK_TEFF[JK_TEFF.length - 1][1];
}
// { T, cls } — tayf türü varsa ondan, yoksa J−K renginden; hiçbiri yoksa null
function stellarTeff(sp, jk) {
  const s = String(sp || '').trim();
  if (/^D[ABOQZCX]?\d?/.test(s) && !/^DM/.test(s)) return { T: 12000, cls: 'WD' };
  const m = s.match(/^(?:sd|esd|usd|d|g)?\s*([OBAFGKMLTY])\s*(\d+(?:\.\d+)?)?/i);
  if (m) {
    const c = m[1].toUpperCase();
    const sub = clamp(m[2] ? parseFloat(m[2]) : 5, 0, 9.9);
    const r = SP_TEFF[c];
    return { T: r[0] + ((r[1] - r[0]) * sub) / 10, cls: s.slice(0, 8) };
  }
  const T = teffFromJK(jk);
  return T ? { T, cls: '?' } : null;
}
// Katalog parlaklığı → AB (referans dalga boyunda)
function refMag(ob) {
  if (ob.J !== null) return { refLam: 1.25, ab: ob.J + 0.91 };
  if (ob.K !== null) return { refLam: 2.16, ab: ob.K + 1.85 };
  if (ob.V !== null) return { refLam: 0.55, ab: ob.V + 0.02 };
  return null;
}
// Dünya'nın yörüngesinden doğan paralaks kayması (ekliptik formülü): Δλ·cosβ = ϖ sin(λ☉−λ) · Δβ = −ϖ sinβ cos(λ☉−λ)
function parallaxShift(q, plxMas, tYear) {
  const ec = eqToEcl(q.ra, q.dec);
  const d = (tYear - 2000) * 365.25;
  const g = (357.528 + 0.9856003 * d) * DEG;
  const sunLon = (280.460 + 0.9856474 * d + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const p = plxMas / 3.6e6;                                           // derece
  const lon = ec.lon * DEG, lat = ec.lat * DEG;
  const dl = (p * Math.sin(sunLon - lon)) / Math.max(0.05, Math.cos(lat));
  const db = -p * Math.sin(lat) * Math.cos(sunLon - lon);
  return eclToEq(ec.lon + dl, ec.lat + db);
}
function realTrackOf(ob, wcs, withPlx) {
  const out = [];
  for (let e = 0; e < EPOCHS.length; e++) {
    const t = EPOCHS[e].t;
    let q = propagate({ ra: ob.ra, dec: ob.dec, pmra: ob.pmra || 0, pmdec: ob.pmdec || 0, epoch: ob.epoch || 2000 }, t);
    if (withPlx && ob.plx > 0) q = parallaxShift(q, ob.plx, t);
    out.push(wcs.skyToPix(q.ra, q.dec));
  }
  return out;
}
const inFrame = (p, m) => p.x >= -m && p.x <= W + m && p.y >= -m && p.y <= H + m;

// SIMBAD satırı → motor kaynağı (null: kare dışı ya da parlaklığı yok)
function realSourceOf(ob, wcs, id, stats) {
  const mg = refMag(ob);
  if (!mg) { stats.noMag += 1; return null; }
  const mu = Math.hypot(ob.pmra || 0, ob.pmdec || 0);
  const mover = mu >= RS_PM_MIN;
  const tr = realTrackOf(ob, wcs, mover);
  if (!tr.some((p) => inFrame(p, RS_EDGE))) { stats.out += 1; return null; }
  const cat = otypeCat(ob.otype);
  const jk = ob.J !== null && ob.K !== null ? ob.J - ob.K : null;
  const sp = stellarTeff(ob.sp, jk);
  const src = {
    id, real: true, catId: ob.id, otype: ob.otype, hidden: false, redAJ: 0, plx: 0, plxK: 0, vx: 0, vy: 0,
    refLam: mg.refLam, abRef: mg.ab, x0: tr[0].x, y0: tr[0].y, mover, mu, plxMas: ob.plx || 0, sp: ob.sp || '',
    mags: { V: ob.V, J: ob.J, K: ob.K }, simbad: { pmra: ob.pmra || 0, pmdec: ob.pmdec || 0, ra: ob.ra, dec: ob.dec },
  };
  if (mover) src.track = tr;
  if (cat === 'gal') {
    Object.assign(src, { kind: 'galaxy', model: 'galaxy', truth: 'galaxy', label: ob.id, p: { fd: 0.25, pah: 0.12 }, rad: clamp(1.5 * (1 + (22.2 - mg.ab) * 0.25), 2, 12), q: 0.7, pa: 0.6 });
    stats.gal += 1;
  } else if (cat === 'neb') {
    Object.assign(src, { kind: 'robj', model: 'galaxy', truth: 'other', label: ob.id, p: { fd: 0.6, pah: 0.3 }, rad: clamp(1.5 * (1 + (22.2 - mg.ab) * 0.2), 2, 10), q: 0.8, pa: 0.3 });
    stats.other += 1;
  } else if (cat === 'bd' || (sp && /^[LTY]/.test(sp.cls))) {
    const T = sp && sp.T ? sp.T : 1000;
    Object.assign(src, { kind: 'rbd', model: 'bd', truth: 'bd', cls: sp ? sp.cls : '', label: ob.id, p: { Teff: T, jm: T < 600 ? 1.45 : T < 1500 ? 1.38 : 1.15 } });
    stats.bd += 1;
  } else {
    const T = sp ? sp.T : 5000;
    const base = { model: 'star', cls: sp ? sp.cls : '?', label: ob.id, p: { T } };
    if (cat === 'var') { Object.assign(src, base, { kind: 'rvar', truth: 'variable' }); stats.variable += 1; }
    else if (mu >= 200) { Object.assign(src, base, { kind: 'rhpm', truth: 'star' }); stats.pm += 1; }
    else { Object.assign(src, base, { kind: 'star', truth: 'star' }); stats.star += 1; }
  }
  return finishSource(src);
}

// SkyBoT satırı (epoch e) → asteroit / kuyruklu yıldız / Centaur-KBO kaynağı. Aynı cisim birden çok epoch'ta görünürse birleştirilir.
function realMinorBodies(skybot, wcs, firstId, stats) {
  const map = new Map();
  skybot.forEach((res, e) => {
    if (!res || res.status !== 'ok') return;
    res.rows.forEach((r) => {
      const k = r.num ? `#${r.num}` : r.name;
      let b = map.get(k);
      if (!b) { b = { key: k, name: r.name, num: r.num, cls: r.cls, mag: r.mag, pos: [null, null, null, null] }; map.set(k, b); }
      b.pos[e] = wcs.skyToPix(r.ra, r.dec);
      if (b.mag === null && r.mag !== null) b.mag = r.mag;
    });
  });
  const out = [];
  let id = firstId;
  Array.from(map.values()).forEach((b) => {
    const first = b.pos.find(Boolean);
    if (!first) return;
    const V = b.mag !== null ? b.mag : 21;
    const cls = b.cls || '';
    const isComet = /comet|^c\//i.test(cls) || /^[CPD]\//.test(b.name) || /^\d+P\//.test(b.name);
    const isKbo = /centaur|kbo|tno|trans|plutino|cubewano|scattered|sdo/i.test(cls);
    const src = {
      id, real: true, catId: b.num ? `${b.num} ${b.name}`.trim() : b.name, otype: cls || 'SSO', hidden: false, redAJ: 0, plx: 0, plxK: 0, vx: 0, vy: 0,
      mover: true, track: b.pos, x0: first.x, y0: first.y, mu: 0, plxMas: 0, sp: '', cls: cls, mags: { V, J: null, K: null },
      vr: b.pos.map((p) => (p ? 1 : 0)), label: b.name, refLam: 1.25,
    };
    if (isComet) Object.assign(src, { kind: 'rcom', model: 'comet', truth: 'comet', abRef: V - 0.4, p: { slope: 0.35, ice: 0.3, k: 0.8, Tth: 230, co2: 0.6, co: 0.2, h2o: 0.2, ch: 0.2 }, coma: 4, tail: 20, tailAng: 0.8 });
    else if (isKbo) Object.assign(src, { kind: 'rkbo', model: 'kbo', truth: 'kbo', abRef: V - 1.4, p: { slope: 0.8, ice15: 0.1, ice: 0.4, co2: 0.3 } });
    else {
      const outer = /outer|hilda|trojan/i.test(cls); const neo = /neo|mars|amor|apollo|aten|atira/i.test(cls);
      Object.assign(src, { kind: 'rast', model: 'asteroid', truth: 'asteroid', abRef: V - 0.6, p: { type: 'X', slope: 0.12, Tth: neo ? 275 : outer ? 190 : 235, k: 1.0 } });
    }
    out.push(finishSource(src));
    id += 1;
    stats.ast += 1;
  });
  return out;
}

/* ---------------- Gerçek alan gökyüzü (generateSky ile aynı şekil) ---------------- */
function buildRealSky(cfg, field) {
  const key = cfg.key + '|real';
  const wcs = makeWCS(cfg.ra, cfg.dec);
  const stats = { rows: field.simbad.length, star: 0, pm: 0, variable: 0, bd: 0, gal: 0, other: 0, ast: 0, noMag: 0, out: 0 };
  const sources = [];
  let nextId = 1;
  // Ad sırasıyla numaralandır: aynı cisim kümesi her yüklemede aynı kimliği alır (kayıtlar oturumlar arası tutarlı kalır)
  const rowsByName = field.simbad.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  rowsByName.forEach((ob) => { const s = realSourceOf(ob, wcs, nextId, stats); if (s) { sources.push(s); nextId += 1; } });
  const minor = realMinorBodies(field.skybot, wcs, nextId, stats);
  minor.forEach((s) => sources.push(s));
  const noise = [0, 1, 2, 3].map((e) => {
    const r = makeRng(`${key}|noise|${e}`);
    const a = new Float32Array(W * H);
    for (let i = 0; i < a.length; i += 2) {
      let u = 0;
      while (u === 0) u = r.next();
      const v = r.next();
      const m = Math.sqrt(-2 * Math.log(u));
      a[i] = m * Math.cos(2 * Math.PI * v);
      if (i + 1 < a.length) a[i + 1] = m * Math.sin(2 * Math.PI * v);
    }
    return a;
  });
  const shown = sources.length;
  return {
    key, cfg, wcs, sources, byId: new Map(sources.map((s) => [s.id, s])), byCat: new Map(sources.map((s) => [s.catId, s])),
    noise, cr: [[], [], [], []], nebula: null, nebAmp: 0, nTargets: 0,
    real: {
      ...stats, shown, movers: sources.filter((s) => s.track).length, fetchedAt: field.fetchedAt,
      skybot: field.skybot.map((r) => ({ status: r.status, n: r.rows.length })),
      skybotOk: field.skybot.some((r) => r.status === 'ok'),
      truncated: field.simbad.length >= RS_TOP,
    },
  };
}
/* =====================================================================
   BÖLÜM 20 — ÇEVRİMDIŞI DEMO: SPHEREx Seviye-2 BİÇİMİNDE SENTETİK FITS KESİTLERİ
   IRSA'ya erişilemediğinde (ör. CORS) seçili hedef için tarayıcıda SENTETİK kesitler üretilir ve
   gerçek analiz hattından (FITS ayrıştırma → WCS+SIP → açıklık fotometrisi → özdevinim/SED uyumu) geçirilir.
   Bu bir SİMÜLASYONDUR: gerçek SPHEREx verisi değildir; arayüzde ve dışa aktarımlarda öyle etiketlenir.
   ===================================================================== */
// FITS kart / başlık / ikili yardımcıları (tarayıcı: Uint8Array + DataView)
function demoCard(key, val) {
  let v;
  if (typeof val === 'string') v = ("'" + val.replace(/'/g, "''")).padEnd(9, ' ') + "'";
  else if (typeof val === 'boolean') v = val ? 'T' : 'F';
  else if (Number.isInteger(val)) v = String(val);
  else v = Number(val).toExponential(12).replace('e+', 'E+').replace('e-', 'E-');
  const s = key.padEnd(8, ' ') + '= ' + (typeof val === 'string' ? v.padEnd(20, ' ') : v.padStart(20, ' '));
  return s.slice(0, 80).padEnd(80, ' ');
}
function demoHeader(cards) {
  let s = cards.map((c) => demoCard(c[0], c[1])).join('') + 'END'.padEnd(80, ' ');
  while (s.length % 2880) s += ' ';
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 127;
  return u;
}
function demoPad(u8) {
  const n = (2880 - (u8.length % 2880)) % 2880;
  if (!n) return u8;
  const o = new Uint8Array(u8.length + n);
  o.set(u8);
  return o;
}
function demoF32(arr) { const b = new Uint8Array(arr.length * 4); const dv = new DataView(b.buffer); for (let i = 0; i < arr.length; i++) dv.setFloat32(i * 4, arr[i], false); return b; }
function demoI32(arr) { const b = new Uint8Array(arr.length * 4); const dv = new DataView(b.buffer); for (let i = 0; i < arr.length; i++) dv.setInt32(i * 4, arr[i] | 0, false); return b; }
function demoConcat(list) {
  let n = 0;
  list.forEach((u) => { n += u.length; });
  const o = new Uint8Array(n);
  let p = 0;
  list.forEach((u) => { o.set(u, p); p += u.length; });
  return o;
}
function demoErf(x) {
  const s = Math.sign(x); const a = Math.abs(x); const t = 1 / (1 + 0.3275911 * a);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
}

/**
 * Tek bir SPHEREx-benzeri kesit (bayt dizisi). o = { w, h, ra0, dec0, scale ("/px), rot (derece), mjd, det (1..6), lamC (µm),
 *   stars:[{ra,dec,flux(µJy),fwhm(px)}], zodi, noise (MJy/sr), seed }
 * Yapı: birincil HDU + IMAGE (MJy/sr) + FLAGS + VARIANCE + ZODI + PSF + WCS-WAVE (RA---TAN-SIP).
 */
function buildDemoFitsBytes(o) {
  const w = o.w; const h = o.h;
  const s = o.scale / 3600; const th = (o.rot * Math.PI) / 180;
  const pc = [[-Math.cos(th) * s, Math.sin(th) * s], [Math.sin(th) * s, Math.cos(th) * s]];
  const kvW = {
    CRPIX1: (w + 1) / 2, CRPIX2: (h + 1) / 2, CRVAL1: o.ra0, CRVAL2: o.dec0, CTYPE1: 'RA---TAN-SIP', CTYPE2: 'DEC--TAN-SIP',
    CDELT1: 1, CDELT2: 1, PC1_1: pc[0][0], PC1_2: pc[0][1], PC2_1: pc[1][0], PC2_2: pc[1][1],
    A_ORDER: 2, B_ORDER: 2, A_2_0: 2e-5, A_1_1: -1e-5, B_0_2: 1.5e-5, B_1_1: 0.8e-5,
  };
  const wcs = makeFitsWCS(kvW);
  const rng = makeRng(o.seed);
  const Om = wcs.pixSr;
  const img = new Float32Array(w * h); const zodi = new Float32Array(w * h); const vari = new Float32Array(w * h); const flags = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) { zodi[i] = o.zodi * (1 + 0.0004 * (i % w)); vari[i] = o.noise * o.noise; }
  o.stars.forEach((st) => {
    const p = wcs.skyToPix(st.ra, st.dec);
    const cx = p.x - 1; const cy = p.y - 1;
    const sg = (st.fwhm || 2.3) / 2.35482;
    for (let j = Math.max(0, Math.floor(cy - 8)); j <= Math.min(h - 1, Math.ceil(cy + 8)); j++) {
      for (let i = Math.max(0, Math.floor(cx - 8)); i <= Math.min(w - 1, Math.ceil(cx + 8)); i++) {
        const fx = 0.5 * (demoErf((i + 0.5 - cx) / (sg * Math.SQRT2)) - demoErf((i - 0.5 - cx) / (sg * Math.SQRT2)));
        const fy = 0.5 * (demoErf((j + 0.5 - cy) / (sg * Math.SQRT2)) - demoErf((j - 0.5 - cy) / (sg * Math.SQRT2)));
        img[j * w + i] += (st.flux * 1e-12 * fx * fy) / Om;                       // µJy → MJy/sr
        if (Math.hypot(i - cx, j - cy) < 3) flags[j * w + i] |= 1 << 21;          // "source" biti: maskelenmemeli
      }
    }
  });
  for (let i = 0; i < w * h; i++) img[i] += zodi[i] + o.noise * rng.normal();

  const imgHdr = [
    ['XTENSION', 'IMAGE'], ['BITPIX', -32], ['NAXIS', 2], ['NAXIS1', w], ['NAXIS2', h], ['PCOUNT', 0], ['GCOUNT', 1],
    ['EXTNAME', 'IMAGE'], ['BUNIT', 'MJy/sr'], ['DETECTOR', o.det], ['MJD-OBS', o.mjd], ['MJD-END', o.mjd + 0.0012],
    ['CTYPE1', kvW.CTYPE1], ['CTYPE2', kvW.CTYPE2], ['CRPIX1', kvW.CRPIX1], ['CRPIX2', kvW.CRPIX2], ['CRVAL1', kvW.CRVAL1], ['CRVAL2', kvW.CRVAL2],
    ['CDELT1', 1], ['CDELT2', 1], ['PC1_1', pc[0][0]], ['PC1_2', pc[0][1]], ['PC2_1', pc[1][0]], ['PC2_2', pc[1][1]],
    ['A_ORDER', 2], ['B_ORDER', 2], ['A_2_0', kvW.A_2_0], ['A_1_1', kvW.A_1_1], ['B_0_2', kvW.B_0_2], ['B_1_1', kvW.B_1_1],
  ];
  const ext = (name, dataBuf, bitpix) => demoConcat([demoHeader([['XTENSION', 'IMAGE'], ['BITPIX', bitpix], ['NAXIS', 2], ['NAXIS1', w], ['NAXIS2', h], ['PCOUNT', 0], ['GCOUNT', 1], ['EXTNAME', name]]), demoPad(dataBuf)]);

  // WCS-WAVE: 11×11 ızgara, VALUES (2,11,11): [λ_merkez µm, bant genişliği µm] (doğrusal değişken süzgeç)
  const NX = 11; const NY = 11;
  const X = []; const Y = [];
  for (let i = 0; i < NX; i++) { X.push(Math.round(1 + (i * (w - 1)) / (NX - 1))); Y.push(Math.round(1 + (i * (h - 1)) / (NY - 1))); }
  const lamAt = (x, y) => o.lamC - 1.8e-4 * (y - (h + 1) / 2) + 2e-6 * (x - (w + 1) / 2);
  const vals = new Float32Array(2 * NX * NY);
  for (let iy = 0; iy < NY; iy++) for (let ix = 0; ix < NX; ix++) { const l = lamAt(X[ix], Y[iy]); vals[2 * (ix + NX * iy)] = l; vals[1 + 2 * (ix + NX * iy)] = l / 41; }
  const rowBuf = demoConcat([demoI32(X), demoI32(Y), demoF32(vals)]);
  const tabHdr = demoHeader([['XTENSION', 'BINTABLE'], ['BITPIX', 8], ['NAXIS', 2], ['NAXIS1', rowBuf.length], ['NAXIS2', 1], ['PCOUNT', 0], ['GCOUNT', 1], ['TFIELDS', 3],
    ['TTYPE1', 'X'], ['TFORM1', NX + 'J'], ['TTYPE2', 'Y'], ['TFORM2', NY + 'J'], ['TTYPE3', 'VALUES'], ['TFORM3', 2 * NX * NY + 'E'], ['TDIM3', `(2,${NX},${NY})`], ['EXTNAME', 'WCS-WAVE']]);
  const psfHdr = demoHeader([['XTENSION', 'IMAGE'], ['BITPIX', -32], ['NAXIS', 3], ['NAXIS1', 11], ['NAXIS2', 11], ['NAXIS3', 3], ['PCOUNT', 0], ['GCOUNT', 1], ['EXTNAME', 'PSF']]);
  return demoConcat([
    demoHeader([['SIMPLE', true], ['BITPIX', 8], ['NAXIS', 0], ['EXTEND', true]]),
    demoHeader(imgHdr), demoPad(demoF32(img)),
    ext('FLAGS', demoI32(flags), 32),
    ext('VARIANCE', demoF32(vari), -32),
    ext('ZODI', demoF32(zodi), -32),
    psfHdr, demoPad(demoF32(new Float32Array(11 * 11 * 3).fill(0.001))),
    tabHdr, demoPad(rowBuf),
  ]);
}

// İki ziyaret (≈1 yıl arayla) × 6 dedektör: (MJD farkı, dedektör, merkez λ µm). Eşleşen dedektör/λ çiftleri özdevinimi ölçmeyi sağlar.
const DEMO_VISITS = [
  { mjd0: 60815.2, roll: 12 }, { mjd0: 61175.4, roll: 47 },
];
const DEMO_BANDS = [[0.00, 2, 1.30], [0.35, 3, 2.00], [0.80, 4, 3.10], [1.30, 5, 4.10], [1.65, 6, 4.70], [2.10, 1, 0.95]];
const DEMO_T_TARGET = 3300;     // K · hedefin model SED'i (M cücesi benzeri Planck)
const DEMO_FLUX_1P3 = 4000;     // µJy @ 1.3 µm

// Hedef için sentetik pozlamalar (gerçek ayrıştırıcıdan geçmiş `exposure` nesneleri; source = 'demo')
function makeDemoExposures(target) {
  const seedBase = `demo|${target.name}|${target.ra.toFixed(4)}|${target.dec.toFixed(4)}`;
  const specs = [];
  DEMO_VISITS.forEach((v, vi) => DEMO_BANDS.forEach((b, bi) => specs.push({ vi, bi, mjd: v.mjd0 + b[0], det: b[1], lamC: b[2], roll: v.roll })));
  const mid = propagate(target, mjdToYear(DEMO_VISITS[0].mjd0 + 0.5 * (DEMO_VISITS[1].mjd0 - DEMO_VISITS[0].mjd0)));
  // sabit alan yıldızları (tüm pozlamalarda aynı gökyüzü konumları)
  const fr = makeRng(seedBase + '|field');
  const fieldStars = [];
  for (let i = 0; i < 16; i++) {
    const dx = (fr.next() - 0.5) * 0.9 * 72 * 6.15; const dy = (fr.next() - 0.5) * 0.9 * 72 * 6.15;     // yay saniyesi
    fieldStars.push({ ra: mid.ra + dx / 3600 / Math.cos(mid.dec * Math.PI / 180), dec: mid.dec + dy / 3600, A: 120 + 1400 * fr.next() * fr.next(), T: 5200 + 1800 * fr.next() });
  }
  const jr = makeRng(seedBase + '|jitter');
  const out = [];
  specs.forEach((sp, i) => {
    const pos = propagate(target, mjdToYear(sp.mjd));
    const jx = (jr.next() - 0.5) * 6; const jy = (jr.next() - 0.5) * 6;                     // işaretleme kayması (piksel)
    const ra0 = mid.ra + (jx * 6.15) / 3600 / Math.cos(mid.dec * Math.PI / 180); const dec0 = mid.dec + (jy * 6.15) / 3600;
    const lam = sp.lamC;
    const stars = fieldStars.map((f) => ({ ra: f.ra, dec: f.dec, flux: f.A * (nu(lam, f.T) / nu(1.3, f.T)), fwhm: 2.1 + 0.25 * lam }));
    stars.push({ ra: pos.ra, dec: pos.dec, flux: DEMO_FLUX_1P3 * (nu(lam, DEMO_T_TARGET) / nu(1.3, DEMO_T_TARGET)), fwhm: 2.1 + 0.25 * lam });
    const bytes = buildDemoFitsBytes({ w: 72, h: 72, ra0, dec0, scale: 6.15, rot: sp.roll + 3 * sp.bi, mjd: sp.mjd, det: sp.det, lamC: lam, stars, zodi: 0.25 + 0.08 * sp.bi, noise: 0.012, seed: `${seedBase}|${i}` });
    const ex = buildExposure(parseFits(bytes), { name: `DEMO_simulated_${String(i + 1).padStart(2, '0')}_D${sp.det}.fits`, did: `demo:${i + 1}`, source: 'demo' });
    out.push(ex);
  });
  return out;
}
/* =====================================================================
   BÖLÜM 19 — PYTHON (ASTROPY) ANALİZ BETİĞİ DIŞA AKTARIMI
   Seçili cismin ölçülen koordinatlarını, özdevinimini, sınıfını ve 102 bantlı spektrumunu
   gömen, doğrudan çalıştırılabilir bir .py dosyası üretir (astropy · astroquery · matplotlib).
   Saf fonksiyonlar: arayüzden bağımsız, Node'da sınanabilir.
   ===================================================================== */
const PY_AUTHOR = 'Elif Turut';
const PY_TOOL = 'NYXE — SPHEREx Time-Domain Astronomy & Citizen Science Console (Proof-of-Concept Prototype)';

// Python sayı/dizge/dizi yazımı (NaN/∞ → None; dizgeler JSON kaçışıyla — geçerli Python sabiti)
function pyNum(x, sig) {
  const v = Number(x);
  if (x === null || x === undefined || !isFinite(v)) return 'None';
  return String(Number(v.toPrecision(sig || 9)));
}
function pyStr(s) { return JSON.stringify(String(s === null || s === undefined ? '' : s)).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
function pyArr(arr, sig) {
  if (!arr) return 'None';
  const parts = Array.from(arr, (v) => { const n = pyNum(v, sig || 7); return n === 'None' ? 'float("nan")' : n; });
  const lines = [];
  for (let i = 0; i < parts.length; i += 6) lines.push('    ' + parts.slice(i, i + 6).join(', ') + ',');
  return 'np.array([\n' + lines.join('\n') + '\n], dtype=float)';
}
function pySlug(s) { return String(s || 'object').normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'object'; }
function pyFileName(d) { return `nyxe_${pySlug(d.label)}_analysis.py`; }
const pyDoc = (s) => String(s === null || s === undefined ? '' : s).replace(/\\/g, '/').replace(/"""/g, "'''").replace(/[\r\n]+/g, ' ');
function pyBool(b) { return b ? 'True' : 'False'; }

/**
 * d = {
 *   label, consoleId, origin: 'model'|'synthetic'|'irsa', generatedAt (ISO),
 *   ra, dec (derece, epoch B, ICRS), raA, decA, epochA:{name,iso}, epochB:{name,iso},
 *   mu:{ra, dec, err, gain, valid}  (″/yıl, ölçülen; fiziksel = ölçülen / gain),
 *   catalog: {id, otype, sp, V, J, K, pmra, pmdec, plx} | null,
 *   diag: {measuredClass, measuredKey, catalogueClass, knownId, savedId},
 *   features: {iceDepth, iceErr, co2, co2Err, pah, pahErr, colorRatio, thermal, Tc, varSig, varRatio},
 *   lam: number[], A: {flux, err}|null, B: {flux, err}, nBands, note
 * }
 */
function buildPythonScript(d) {
  const originText = {
    model: [
      'REAL catalogue data: this object\'s position, proper motion and parallax come from SIMBAD (CDS, Strasbourg)',
      'or, for Solar System bodies, SkyBoT (IMCCE, Paris Observatory). The 102-band spectrum below is a MODEL',
      '(Planck / template spectra scaled to the catalogue magnitude) and is NOT a SPHEREx measurement.',
    ],
    synthetic: [
      'SYNTHETIC training sky: coordinates, motions (multiplied by a didactic gain, see PM_GAIN) and the 102-band',
      'spectra were generated by the console\'s simulation engine (Planck + molecular absorption). Nothing in this',
      'file is a real observation.',
    ],
    irsa: [
      'REAL SPHEREx Level-2 measurement (NASA/IPAC IRSA): wavelengths and fluxes are aperture photometry of the target',
      'on the downloaded cutouts; they are not a regular 102-band grid, and epochs A/B are not paired spectra.',
    ],
  }[d.origin] || [];
  const ack = d.origin === 'irsa'
    ? '\nAcknowledgement: This publication makes use of data products from the Spectro-Photometer for the History of the Universe,\nEpoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the\nCalifornia Institute of Technology, and is funded by the National Aeronautics and Space Administration.\n'
    : '';
  const f = d.features || {};
  const mu = d.mu || {};
  const cat = d.catalog || null;
  const dg = d.diag || {};
  const hasA = !!(d.A && d.A.flux);
  const fname = pyFileName(d);
  const L = [];
  const P = (s) => L.push(s);

  P('#!/usr/bin/env python3');
  P('# -*- coding: utf-8 -*-');
  P('"""');
  P(`${PY_TOOL}`);
  P('Object analysis script (exported from the console)');
  P('');
  P(`Object ........ ${pyDoc(d.label)}`);
  P(`Console ID .... ${pyDoc(d.consoleId || '-')}`);
  P(`Generated ..... ${d.generatedAt}`);
  P(`Author ........ ${PY_AUTHOR}`);
  P(`Copyright ..... (c) ${new Date(d.generatedAt).getUTCFullYear() || 2026} Elif Turut. All rights reserved.`);
  P('');
  P('DATA PROVENANCE (read before citing)');
  originText.forEach((l) => P('  ' + l));
  if (d.note) P('  ' + pyDoc(d.note));
  if (ack) P(ack.trimEnd());
  P('');
  P('Requirements ... Python >= 3.9;  pip install numpy astropy astroquery matplotlib');
  P(`Usage ......... python ${fname} [--no-simbad] [--no-show] [--out figure.png]`);
  P('"""');
  P('');
  P('from __future__ import annotations');
  P('');
  P('import argparse');
  P('import math');
  P('import sys');
  P('');
  P('import matplotlib');
  P('import numpy as np');
  P('');
  P('if "--no-show" in sys.argv:          # headless run (servers, CI): do not open a window');
  P('    matplotlib.use("Agg")');
  P('');
  P('import astropy.units as u');
  P('import matplotlib.pyplot as plt');
  P('from astropy.coordinates import SkyCoord');
  P('from astropy.time import Time');
  P('from matplotlib.ticker import LogFormatter');
  P('');
  P('# ' + '-'.repeat(76));
  P('# 1) Embedded measurement (values as shown in the console at export time)');
  P('# ' + '-'.repeat(76));
  P('OBJECT = {');
  P(`    "name": ${pyStr(d.label)},`);
  P(`    "console_id": ${pyStr(d.consoleId || '')},`);
  P(`    "diagnosed_class": ${pyStr(dg.measuredClass || '')},      # class inferred from the measured spectrum`);
  P(`    "diagnosis_key": ${pyStr(dg.measuredKey || '')},`);
  P(`    "catalogue_class": ${pyStr(dg.catalogueClass || '')},     # known catalogue type, if the object is already catalogued`);
  P(`    "known_catalogue_id": ${pyStr(dg.knownId || '')},`);
  P(`    "saved_record_id": ${pyStr(dg.savedId || '')},`);
  P(`    "data_origin": ${pyStr(d.origin)},                         # "model" | "synthetic" | "irsa"`);
  P('}');
  P('');
  P(`EPOCH_A_ISO = ${pyStr(d.epochA.iso)}       # ${String(d.epochA.name).replace(/[\r\n]+/g, ' ')}`);
  P(`EPOCH_B_ISO = ${pyStr(d.epochB.iso)}       # ${String(d.epochB.name).replace(/[\r\n]+/g, ' ')}`);
  P('');
  P('# Measured centroid positions, ICRS, degrees');
  P(`RA_A_DEG, DEC_A_DEG = ${pyNum(d.raA, 10)}, ${pyNum(d.decA, 10)}      # epoch A`);
  P(`RA_DEG, DEC_DEG = ${pyNum(d.ra, 10)}, ${pyNum(d.dec, 10)}            # epoch B (current position)`);
  P('');
  P('# Measured proper motion between the two epochs, arcsec / yr (mu_alpha* already includes cos(dec))');
  P(`MU_RA_ARCSEC_YR = ${pyNum(mu.ra, 7)}       # muRA`);
  P(`MU_DEC_ARCSEC_YR = ${pyNum(mu.dec, 7)}      # muDec`);
  P(`MU_ERR_ARCSEC_YR = ${pyNum(mu.err, 5)}`);
  P(`PM_VALID = ${pyBool(mu.valid)}`);
  P(`PM_GAIN = ${pyNum(mu.gain === undefined ? 1 : mu.gain, 6)}      # >1: didactic amplification of the synthetic sky; physical mu = measured mu / PM_GAIN`);
  P('');
  if (cat) {
    P('# Catalogue values (SIMBAD / SkyBoT) used to build the sky');
    P('CATALOGUE = {');
    P(`    "id": ${pyStr(cat.id)}, "otype": ${pyStr(cat.otype || '')}, "sp_type": ${pyStr(cat.sp || '')},`);
    P(`    "pmra_mas_yr": ${pyNum(cat.pmra, 8)}, "pmdec_mas_yr": ${pyNum(cat.pmdec, 8)}, "plx_mas": ${pyNum(cat.plx, 6)},`);
    P(`    "V": ${pyNum(cat.V, 5)}, "J": ${pyNum(cat.J, 5)}, "K": ${pyNum(cat.K, 5)},`);
    P('}');
  } else {
    P('CATALOGUE = None');
  }
  P('');
  P('# Diagnostics computed by the console (indicative; see the functions below for an independent estimate)');
  P('CONSOLE_DIAGNOSTICS = {');
  P(`    "ice_3um_depth": ${pyNum(f.iceDepth, 5)}, "ice_3um_depth_err": ${pyNum(f.iceErr, 5)},`);
  P(`    "co2_4p26um_excess": ${pyNum(f.co2, 5)}, "co2_4p26um_excess_err": ${pyNum(f.co2Err, 5)},`);
  P(`    "pah_3p3um_excess": ${pyNum(f.pah, 5)}, "pah_3p3um_excess_err": ${pyNum(f.pahErr, 5)},`);
  P(`    "color_ratio_1p6_over_4p5": ${pyNum(f.colorRatio, 5)}, "thermal_4p8_over_4p5": ${pyNum(f.thermal, 5)},`);
  P(`    "color_temperature_K": ${pyNum(f.Tc, 6)}, "flux_variability_sigma": ${pyNum(f.varSig, 5)}, "flux_ratio_B_over_A": ${pyNum(f.varRatio, 5)},`);
  P('}');
  P('');
  P(`# ${d.nBands} spectral channels, wavelengths in micron (SPHEREx range 0.75-5.0 um)`);
  P(`BAND_LAMBDA = ${pyArr(d.lam, 6)}`);
  P('');
  P(`# F_nu in microJansky (uJy) with 1-sigma uncertainties`);
  P(`FLUX_A = ${hasA ? pyArr(d.A.flux, 6) : 'None'}      # epoch A`);
  P(`ERR_A = ${hasA ? pyArr(d.A.err, 5) : 'None'}`);
  P(`FLUX_B = ${pyArr(d.B.flux, 6)}      # epoch B`);
  P(`ERR_B = ${pyArr(d.B.err, 5)}`);
  P('');
  P('# Spectral features highlighted in the plot: (window, left continuum window, right continuum window), micron');
  P('FEATURES = {');
  P('    "H2O ice 3.0 um": {"win": (2.85, 3.15), "left": (2.45, 2.70), "right": (3.55, 3.80), "color": "tab:blue"},');
  P('    "CO2 4.26 um": {"win": (4.22, 4.30), "left": (4.08, 4.18), "right": (4.36, 4.46), "color": "tab:red"},');
  P('    "CH4 1.6 um": {"win": (1.58, 1.72), "left": (1.42, 1.52), "right": (1.80, 1.90), "color": "tab:green"},');
  P('    "CH4 3.3 um": {"win": (3.22, 3.38), "left": (2.45, 2.70), "right": (3.55, 3.80), "color": "tab:olive"},');
  P('}');
  P('');
  // ---- sabit (statik) Python gövdesi ----
  P(PY_BODY.replace(/\{\{FILE\}\}/g, fname.replace(/\.py$/, '')));
  return L.join('\n') + '\n';
}

const PY_BODY = String.raw`# ` + '-'.repeat(76) + String.raw`
# 2) Coordinates, proper motion (astropy)
# ` + '-'.repeat(76) + String.raw`
def build_coordinates():
    """ICRS SkyCoord objects at both epochs, carrying the measured proper motion."""
    pm_ra = (MU_RA_ARCSEC_YR / PM_GAIN) * u.arcsec / u.yr if MU_RA_ARCSEC_YR is not None else 0 * u.arcsec / u.yr
    pm_dec = (MU_DEC_ARCSEC_YR / PM_GAIN) * u.arcsec / u.yr if MU_DEC_ARCSEC_YR is not None else 0 * u.arcsec / u.yr
    t_a, t_b = Time(EPOCH_A_ISO, scale="utc"), Time(EPOCH_B_ISO, scale="utc")
    coord_a = SkyCoord(ra=RA_A_DEG * u.deg, dec=DEC_A_DEG * u.deg, frame="icrs",
                       pm_ra_cosdec=pm_ra, pm_dec=pm_dec, obstime=t_a)
    coord_b = SkyCoord(ra=RA_DEG * u.deg, dec=DEC_DEG * u.deg, frame="icrs",
                       pm_ra_cosdec=pm_ra, pm_dec=pm_dec, obstime=t_b)
    return coord_a, coord_b


# ` + '-'.repeat(76) + String.raw`
# 3) Catalogue validation with astroquery.simbad (needs internet access)
# ` + '-'.repeat(76) + String.raw`
def _cell(row, cols, *names):
    """First non-masked, non-NaN value among the given (case-insensitive) column names."""
    for name in names:
        key = cols.get(name)
        if key is None:
            continue
        value = row[key]
        if np.ma.is_masked(value):
            continue
        if isinstance(value, bytes):
            value = value.decode("utf-8", "replace")
        try:
            if isinstance(value, (float, np.floating)) and not np.isfinite(value):
                continue
        except TypeError:
            pass
        return value
    return None


def simbad_crossmatch(coord_b, mu_total_arcsec_yr):
    """Query SIMBAD around the measured position and return the best proper-motion-corrected match.

    SIMBAD positions refer to epoch J2000, so the search radius grows with the proper motion and every
    candidate is moved to the epoch of the measurement before it is compared.
    """
    try:
        from astroquery.simbad import Simbad
    except ImportError:
        print("  astroquery is not installed (pip install astroquery) - skipping the SIMBAD check.")
        return None

    dt_yr = coord_b.obstime.jyear - 2000.0
    radius = min(600.0, 8.0 + abs(mu_total_arcsec_yr) * max(dt_yr, 0.0) * 1.3) * u.arcsec
    simbad = None
    for fields in (("pmra", "pmdec", "plx_value", "otype", "sp_type"),   # astroquery >= 0.4.8 (TAP based)
                   ("pmra", "pmdec", "plx", "otype", "sp")):               # older astroquery
        try:
            simbad = Simbad()
            simbad.add_votable_fields(*fields)
            break
        except Exception:                                                   # unknown field names -> try the other set
            simbad = None
    if simbad is None:
        simbad = Simbad()

    centre = SkyCoord(coord_b.ra, coord_b.dec, frame="icrs")
    try:
        table = simbad.query_region(centre, radius=radius)
    except Exception as exc:                                                # no network, timeout, service error
        print(f"  SIMBAD query failed ({type(exc).__name__}: {exc}).")
        return None
    if table is None or len(table) == 0:
        print(f"  SIMBAD: no object within {radius.to(u.arcsec).value:.0f} arcsec.")
        return None

    cols = {name.lower(): name for name in table.colnames}
    best = None
    for row in table:
        ra_raw, dec_raw = _cell(row, cols, "ra"), _cell(row, cols, "dec")
        if ra_raw is None or dec_raw is None:
            continue
        try:
            ra_deg, dec_deg = float(ra_raw), float(dec_raw)                 # new API: degrees
        except (TypeError, ValueError):                                     # old API: sexagesimal strings
            sc = SkyCoord(str(ra_raw), str(dec_raw), unit=(u.hourangle, u.deg))
            ra_deg, dec_deg = sc.ra.deg, sc.dec.deg
        pmra = float(_cell(row, cols, "pmra") or 0.0)                       # mas / yr (mu_alpha*)
        pmdec = float(_cell(row, cols, "pmdec") or 0.0)
        ra_now = ra_deg + pmra * dt_yr / 3.6e6 / max(math.cos(math.radians(dec_deg)), 1e-6)
        dec_now = dec_deg + pmdec * dt_yr / 3.6e6
        sep = SkyCoord(ra_now * u.deg, dec_now * u.deg).separation(centre).arcsec
        if best is None or sep < best["sep_arcsec"]:
            best = {
                "main_id": str(_cell(row, cols, "main_id") or "?").strip(),
                "otype": str(_cell(row, cols, "otype") or "").strip(),
                "sp_type": str(_cell(row, cols, "sp_type", "sp") or "").strip(),
                "pmra": pmra, "pmdec": pmdec,
                "plx": _cell(row, cols, "plx_value", "plx"),
                "sep_arcsec": float(sep),
            }
    return best


# ` + '-'.repeat(76) + String.raw`
# 4) Simple, independent feature-depth estimate (linear continuum between two side windows)
# ` + '-'.repeat(76) + String.raw`
def window_mean(lam, flux, err, lo, hi):
    """Inverse-variance weighted mean flux and its error inside [lo, hi] um."""
    m = (lam >= lo) & (lam <= hi) & np.isfinite(flux) & np.isfinite(err) & (err > 0)
    if not m.any():
        return np.nan, np.nan, np.nan
    w = 1.0 / np.square(err[m])
    return float(np.sum(w * flux[m]) / np.sum(w)), float(1.0 / np.sqrt(np.sum(w))), float(np.mean(lam[m]))


def feature_depth(lam, flux, err, spec):
    """Fractional depth (>0 absorption, <0 emission) of a feature relative to a linear continuum."""
    f0, e0, x0 = window_mean(lam, flux, err, *spec["win"])
    fl, el, xl = window_mean(lam, flux, err, *spec["left"])
    fr, er, xr = window_mean(lam, flux, err, *spec["right"])
    if not np.all(np.isfinite([f0, fl, fr, xl, xr])) or xr == xl:
        return np.nan, np.nan
    t = (x0 - xl) / (xr - xl)
    cont = fl + (fr - fl) * t
    cont_err = math.hypot((1.0 - t) * el, t * er)
    if cont <= 0:
        return np.nan, np.nan
    depth = 1.0 - f0 / cont
    depth_err = math.hypot(e0 / cont, f0 * cont_err / cont ** 2)
    return depth, depth_err


# ` + '-'.repeat(76) + String.raw`
# 5) Plot: 102-band spectrum with ice / CO2 / CH4 bands
# ` + '-'.repeat(76) + String.raw`
def plot_spectrum(out_path, show):
    lam = BAND_LAMBDA
    fig, (ax, ax2) = plt.subplots(2, 1, figsize=(10.5, 7.6), sharex=True,
                                  gridspec_kw={"height_ratios": [3.0, 1.35], "hspace": 0.06})
    for label, spec in FEATURES.items():
        lo, hi = spec["win"]
        ax.axvspan(lo, hi, color=spec["color"], alpha=0.18, lw=0)
        ax2.axvspan(lo, hi, color=spec["color"], alpha=0.18, lw=0)
        ax.text(0.5 * (lo + hi), 0.985, label, transform=ax.get_xaxis_transform(), rotation=90,
                va="top", ha="center", fontsize=8, color=spec["color"])

    series = []
    if FLUX_A is not None:
        series.append(("Epoch A  " + EPOCH_A_ISO, FLUX_A, ERR_A, "tab:red"))
    series.append(("Epoch B  " + EPOCH_B_ISO if FLUX_A is not None else "Measured spectrum", FLUX_B, ERR_B, "tab:cyan" if FLUX_A is not None else "k"))
    for name, flux, err, color in series:
        ax.errorbar(lam, flux, yerr=err, fmt="o-", ms=3, lw=1, elinewidth=0.7, color=color, label=name, alpha=0.9)
    positive = all(np.all(f[np.isfinite(f)] > 0) for _, f, _, _ in series)
    if positive:
        ax.set_yscale("log")
        log_fmt = LogFormatter(base=10, labelOnlyBase=False, minor_thresholds=(2, 0.4))   # plain numbers (20, 30, 50 ...)
        ax.yaxis.set_major_formatter(log_fmt)
        ax.yaxis.set_minor_formatter(log_fmt)
    ax.set_ylabel(r"$F_\nu$  [$\mu$Jy]")
    ax.set_xlim(0.7, 5.05)
    ax.grid(alpha=0.25, which="both")
    ax.legend(loc="lower left", fontsize=9, framealpha=0.85)
    title = OBJECT["name"]
    if OBJECT["diagnosed_class"]:
        title += "  -  " + OBJECT["diagnosed_class"]
    ax.set_title(title, fontsize=12)

    if FLUX_A is not None:
        with np.errstate(divide="ignore", invalid="ignore"):
            ratio = FLUX_B / FLUX_A
            ratio_err = ratio * np.hypot(ERR_B / FLUX_B, ERR_A / FLUX_A)
        ax2.errorbar(lam, ratio, yerr=ratio_err, fmt="o-", ms=3, lw=1, elinewidth=0.7, color="tab:purple")
        ax2.axhline(1.0, color="gray", lw=0.8, ls="--")
        ax2.set_ylabel("F(B) / F(A)")
        finite = ratio[np.isfinite(ratio)]
        if finite.size:
            lo, hi = np.percentile(finite, [2, 98])
            pad = 0.15 * max(hi - lo, 0.2)
            ax2.set_ylim(min(lo, 1.0) - pad, max(hi, 1.0) + pad)
    else:
        with np.errstate(divide="ignore", invalid="ignore"):
            ax2.plot(lam, FLUX_B / ERR_B, "o-", ms=3, lw=1, color="tab:purple")
        ax2.set_ylabel("S/N per channel")
    ax2.set_xlabel(r"Wavelength  $\lambda$  [$\mu$m]")
    ax2.grid(alpha=0.25)
    fig.text(0.995, 0.005, "Console export - " + OBJECT["data_origin"] + " data", ha="right", va="bottom", fontsize=7, color="gray")
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    print(f"  figure saved: {out_path}")
    if show:
        plt.show()
    plt.close(fig)


# ` + '-'.repeat(76) + String.raw`
# 6) Main
# ` + '-'.repeat(76) + String.raw`
def main():
    parser = argparse.ArgumentParser(description="Analysis of one object exported from the NYXE time-domain console (SPHEREx).")
    parser.add_argument("--no-simbad", action="store_true", help="skip the SIMBAD catalogue check (offline use)")
    parser.add_argument("--no-show", action="store_true", help="do not open a plot window (save the PNG only)")
    parser.add_argument("--out", default="{{FILE}}.png", help="output figure (default: %(default)s)")
    args = parser.parse_args()

    print("=" * 78)
    print(OBJECT["name"], "  [", OBJECT["console_id"], "]")
    print("data origin:", OBJECT["data_origin"], "| diagnosed class:", OBJECT["diagnosed_class"] or "-")
    print("=" * 78)

    coord_a, coord_b = build_coordinates()
    print("Position (ICRS), epoch A  :", coord_a.to_string("hmsdms", precision=2), "   ", EPOCH_A_ISO)
    print("Position (ICRS), epoch B  :", coord_b.to_string("hmsdms", precision=2), "   ", EPOCH_B_ISO)
    shift = coord_a.separation(coord_b).arcsec
    print(f"Displacement A -> B       : {shift:.3f} arcsec")
    mu_total = math.hypot(MU_RA_ARCSEC_YR or 0.0, MU_DEC_ARCSEC_YR or 0.0)
    if PM_VALID:
        print(f"Measured proper motion    : mu_RA* = {MU_RA_ARCSEC_YR:+.4f}  mu_Dec = {MU_DEC_ARCSEC_YR:+.4f} arcsec/yr "
              f"(total {mu_total:.4f} +/- {MU_ERR_ARCSEC_YR or 0:.4f})")
        if PM_GAIN != 1.0:
            print(f"  didactic gain x{PM_GAIN:g} -> physical mu = {mu_total / PM_GAIN:.4f} arcsec/yr")
    else:
        print("Measured proper motion    : not significant / not measurable for this epoch pair")
    if CATALOGUE:
        cat_mu = math.hypot(CATALOGUE["pmra_mas_yr"] or 0.0, CATALOGUE["pmdec_mas_yr"] or 0.0) / 1000.0
        print(f"Catalogue                 : {CATALOGUE['id']} ({CATALOGUE['otype']}) mu = {cat_mu:.4f} arcsec/yr")

    print("\nSpectral features (independent linear-continuum estimate, epoch B):")
    for label, spec in FEATURES.items():
        depth, err = feature_depth(BAND_LAMBDA, FLUX_B, ERR_B, spec)
        if np.isfinite(depth):
            tag = "absorption" if depth > 0 else "emission"
            print(f"  {label:<14s} depth = {depth:+.3f} +/- {err:.3f}  ({tag}, {abs(depth) / err:.1f} sigma)")
        else:
            print(f"  {label:<14s} not measurable (continuum too faint or band not covered)")

    if not args.no_simbad:
        print("\nSIMBAD cross-match (astroquery):")
        match = simbad_crossmatch(coord_b, mu_total / PM_GAIN)
        if match:
            print(f"  nearest PM-corrected match: {match['main_id']}  type={match['otype'] or '?'}  sp={match['sp_type'] or '?'}")
            print(f"  separation {match['sep_arcsec']:.2f} arcsec | catalogue pm = ({match['pmra']:+.1f}, {match['pmdec']:+.1f}) mas/yr")
            if PM_VALID:
                d_ra = (MU_RA_ARCSEC_YR / PM_GAIN) * 1000.0 - match["pmra"]
                d_dec = (MU_DEC_ARCSEC_YR / PM_GAIN) * 1000.0 - match["pmdec"]
                print(f"  measured - catalogue pm = ({d_ra:+.1f}, {d_dec:+.1f}) mas/yr")
            if match["sep_arcsec"] > 5.0:
                print("  -> no counterpart within 5 arcsec: the object may be uncatalogued (candidate for follow-up).")

    print()
    plot_spectrum(args.out, show=not args.no_show)


if __name__ == "__main__":
    main()`;

/* ---------------- Arayüz verisinden betik verisi ---------------- */
// Seçili cismin analizi (analyzeObject çıktısı) → betik veri sözlüğü
function pyDataFromAnalysis(o) {
  const tEn = makeT('en');
  const { an, eA, eB, gain } = o;
  const src = an.src; const A = an.astro; const D = an.diag;
  const real = !!src.real;
  const sA = an.skyA, sB = an.skyB;
  const cat = real ? {
    id: src.catId, otype: src.otype || '', sp: src.sp || '', V: src.mags ? src.mags.V : null, J: src.mags ? src.mags.J : null, K: src.mags ? src.mags.K : null,
    pmra: src.simbad ? src.simbad.pmra : null, pmdec: src.simbad ? src.simbad.pmdec : null, plx: src.plxMas || null,
  } : null;
  const label = o.label || (real ? src.catId : (o.knownId || `Candidate #${src.id}`));
  return {
    label, consoleId: o.consoleId || (real ? src.catId : o.knownId || `#${src.id}`),
    origin: real ? 'model' : 'synthetic', generatedAt: new Date().toISOString(),
    ra: sB.ra, dec: sB.dec, raA: sA.ra, decA: sA.dec,
    epochA: { name: EPOCHS[eA].name || EPOCHS[eA].date, iso: EPOCHS[eA].iso }, epochB: { name: EPOCHS[eB].name || EPOCHS[eB].date, iso: EPOCHS[eB].iso },
    mu: { ra: A.muRA, dec: A.muDec, err: A.muErr, gain: real ? 1 : gain, valid: !!A.valid },
    catalog: cat,
    diag: {
      measuredClass: guessLabel(tEn, D.guess.key, D.Tc), measuredKey: D.guess.key,
      catalogueClass: o.knownId || real ? kindLabel(tEn, src) : '', knownId: o.knownId || (real ? src.catId : ''), savedId: o.savedId || '',
    },
    features: {
      iceDepth: D.ice.ok ? D.ice.depth : null, iceErr: D.ice.ok ? D.ice.err : null, co2: D.co2.ok ? D.co2.x : null, co2Err: D.co2.ok ? D.co2.err : null,
      pah: D.pah.ok ? D.pah.x : null, pahErr: D.pah.ok ? D.pah.err : null, colorRatio: D.colorRatio.v, thermal: D.thermal, Tc: D.Tc,
      varSig: D.varSig, varRatio: isFinite(D.varRatio) ? D.varRatio : null,
    },
    lam: Array.from(BAND_LAMBDA), nBands: N_BANDS,
    A: eA !== eB ? { flux: Array.from(an.spA.flux), err: Array.from(an.spA.err) } : null,
    B: { flux: Array.from(an.spB.flux), err: Array.from(an.spB.err) },
    note: real ? 'Positions: epoch-propagated catalogue positions (proper motion + ecliptic parallax); centroids measured on the model frames.' : '',
  };
}

// Gerçek SPHEREx (IRSA) ölçümünü içeren kayıt → betik veri sözlüğü (düzensiz λ ızgarası)
function pyDataFromRealPayload(rp, o) {
  const det = (rp.meas || []).filter((m) => m.status === 'detected' && isFinite(m.lam) && isFinite(m.flux)).sort((a, b) => a.lam - b.lam);
  const isos = det.map((m) => String(m.iso || '').slice(0, 10)).filter(Boolean).sort();
  const mo = rp.motion && rp.motion.valid ? rp.motion : null;
  const tg = rp.target || {};
  const demo = rp.source === 'demo';
  return {
    label: o.label || tg.name || 'target', consoleId: o.consoleId || '', origin: demo ? 'synthetic' : 'irsa', generatedAt: new Date().toISOString(),
    ra: o.ra !== undefined ? o.ra : tg.ra, dec: o.dec !== undefined ? o.dec : tg.dec, raA: o.ra !== undefined ? o.ra : tg.ra, decA: o.dec !== undefined ? o.dec : tg.dec,
    epochA: { name: 'first detection', iso: isos[0] || '' }, epochB: { name: 'last detection', iso: isos[isos.length - 1] || isos[0] || '' },
    mu: { ra: mo ? mo.mua : null, dec: mo ? mo.mud : null, err: mo ? mo.sigMu : null, gain: 1, valid: !!mo },
    catalog: { id: tg.name, otype: '', sp: '', V: null, J: null, K: null, pmra: tg.pmra, pmdec: tg.pmdec, plx: null },
    diag: { measuredClass: o.className || '', measuredKey: rp.verdict || '', catalogueClass: '', knownId: '', savedId: o.savedId || '' },
    features: { iceDepth: null, iceErr: null, co2: null, co2Err: null, pah: null, pahErr: null, colorRatio: null, thermal: null, Tc: rp.sed ? rp.sed.T : null, varSig: null, varRatio: rp.topPair ? rp.topPair.ratio : null },
    lam: det.map((m) => m.lam), nBands: det.length,
    A: null, B: { flux: det.map((m) => m.flux), err: det.map((m) => m.err) },
    note: demo ? 'SIMULATED offline demo cutouts (not SPHEREx data).' : `${det.length} detections of ${rp.nExp} exposures; ${isos.length ? 'dates ' + isos[0] + ' to ' + isos[isos.length - 1] : ''}.`,
  };
}

// Tarayıcıdan indirme (UTF-8, doğrudan çalıştırılabilir)
function downloadPython(d) {
  const name = pyFileName(d);
  downloadText(name, buildPythonScript(d), 'text/x-python;charset=utf-8');
  return name;
}
/* =====================================================================
   BÖLÜM 9 — ÇOK DİLLİ ARAYÜZ  (TR · EN · ES · DE · JA)
   T_ROWS her anahtar için [tr, en, es, de, ja] sırasıyla metin tutar;
   TRANSLATIONS = { tr:{…}, en:{…}, es:{…}, de:{…}, ja:{…} } buradan üretilir.
   {param} yer tutucuları t(anahtar, {param: değer}) ile doldurulur.
   ===================================================================== */
const LANGS = [
  { code: 'en', short: 'EN', name: 'English', locale: 'en-GB' },
  { code: 'tr', short: 'TR', name: 'Türkçe', locale: 'tr-TR' },
  { code: 'es', short: 'ES', name: 'Español', locale: 'es-ES' },
  { code: 'de', short: 'DE', name: 'Deutsch', locale: 'de-DE' },
  { code: 'ja', short: 'JA', name: '日本語', locale: 'ja-JP' },
];
const T_ROWS = {
  // ───────── Uygulama · üst bar · ortak ─────────
  'app.subtitle': ['Zaman Alanlı Astronomi · Kitle Kaynaklı Keşif', 'Time-Domain Astronomy · Citizen Science', 'Astronomía de dominio temporal · Ciencia ciudadana', 'Zeitbereichsastronomie · Bürgerwissenschaft', '時間領域天文学 · 市民科学'],
  'tab.map': ['Keşif Haritası', 'Sky Explorer', 'Mapa de exploración', 'Entdeckerkarte', '探査マップ'],
  'tab.catalog': ['Gökyüzü Kataloğu & Zaman Arşivi', 'Sky Catalog & Time Archive', 'Catálogo del cielo y archivo temporal', 'Himmelskatalog & Zeitarchiv', '天体カタログ＆時間アーカイブ'],
  'tab.catalogShort': ['Katalog & Arşiv', 'Catalog & Archive', 'Catálogo', 'Katalog & Archiv', 'カタログ'],
  'badge.synthetic': ['SENTETİK VERİ', 'SYNTHETIC DATA', 'DATOS SINTÉTICOS', 'SYNTHETISCHE DATEN', '合成データ'],
  'training': ['Eğitim modu', 'Training mode', 'Modo entrenamiento', 'Trainingsmodus', 'トレーニングモード'],
  'lang.label': ['Dil', 'Language', 'Idioma', 'Sprache', '言語'],
  'sector.label': ['Sektör', 'Sector', 'Sector', 'Sektor', 'セクター'],
  'sec.s1.short': ['Ekliptik', 'Ecliptic', 'Eclíptica', 'Ekliptik', '黄道'],
  'sec.s2.short': ['Yüksek Enlem', 'High Latitude', 'Alta latitud', 'Hohe Breite', '高銀緯'],
  'sec.s3.short': ['Orion', 'Orion', 'Orión', 'Orion', 'オリオン'],
  'sec.s4.short': ['Özel Koordinat', 'Custom Coords', 'Coord. propias', 'Eigene Koord.', '任意座標'],
  'sec.s1.title': ['Ekliptik Düzlem', 'Ecliptic Plane', 'Plano de la eclíptica', 'Ekliptikebene', '黄道面'],
  'sec.s2.title': ['Yüksek Galaktik Enlem', 'High Galactic Latitude', 'Alta latitud galáctica', 'Hohe galaktische Breite', '高銀緯領域'],
  'sec.s3.title': ['Orion Moleküler Bulutu', 'Orion Molecular Cloud', 'Nube molecular de Orión', 'Orion-Molekülwolke', 'オリオン分子雲'],
  'sec.s4.title': ['Özel Koordinat', 'Custom Coordinates', 'Coordenadas propias', 'Eigene Koordinaten', '任意座標'],
  'sec.s1.sub': ['Asteroit ve kuyruklu yıldız yoğun bölge', 'Asteroid- and comet-rich region', 'Región rica en asteroides y cometas', 'Asteroiden- und kometenreiche Region', '小惑星・彗星の多い領域'],
  'sec.s2.sub': ['Soğuk Y cücesi ve Gezegen X arama bölgesi', 'Cold Y-dwarf and Planet X search region', 'Búsqueda de enanas Y frías y Planeta X', 'Suchgebiet für kalte Y-Zwerge und Planet X', '低温Y型矮星・惑星X探索領域'],
  'sec.s3.sub': ['Su buzu ve PAH emisyon bölgesi', 'Water-ice and PAH emission region', 'Región de hielo de agua y emisión PAH', 'Wassereis- und PAH-Emissionsgebiet', '水氷とPAH放射の領域'],
  'sec.s4.sub': ['RA/Dec’i siz girersiniz', 'You enter the RA/Dec', 'Usted introduce RA/Dec', 'Sie geben RA/Dec ein', 'RA/Decを自分で入力'],
  'custom.ra': ['RA (J2000)', 'RA (J2000)', 'AR (J2000)', 'RA (J2000)', '赤経 (J2000)'],
  'custom.dec': ['Dec (J2000)', 'Dec (J2000)', 'Dec (J2000)', 'Dek (J2000)', '赤緯 (J2000)'],
  'custom.create': ['Sektörü Oluştur', 'Create Sector', 'Crear sector', 'Sektor erzeugen', 'セクターを作成'],
  'custom.name': ['Ada göre bul', 'Find by name', 'Buscar por nombre', 'Nach Name suchen', '名前で検索'],
  'custom.namePh': ['M42, Barnard’s Star…', 'M42, Barnard’s Star…', 'M42, Estrella de Barnard…', 'M42, Barnards Pfeilstern…', 'M42、バーナード星…'],
  'custom.hint': ['Biçimler: “14h 29m 42.9s” veya “217.4287” · “-62 40 46” veya “-62.6797”. Varsayılan: Proxima Cen alanı.', 'Formats: “14h 29m 42.9s” or “217.4287” · “-62 40 46” or “-62.6797”. Default: the Proxima Cen field.', 'Formatos: “14h 29m 42.9s” o “217.4287” · “-62 40 46” o “-62.6797”. Por defecto: campo de Próxima Cen.', 'Formate: „14h 29m 42.9s“ oder „217.4287“ · „-62 40 46“ oder „-62.6797“. Standard: Proxima-Cen-Feld.', '形式: 「14h 29m 42.9s」または「217.4287」・「-62 40 46」または「-62.6797」。既定: ケンタウルス座プロキシマ付近。'],
  'custom.bad': ['Geçersiz koordinat. RA 0–360° (veya saat), Dec −89…+89° olmalı.', 'Invalid coordinate. RA must be 0–360° (or hours), Dec −89…+89°.', 'Coordenada no válida. AR 0–360° (u horas), Dec −89…+89°.', 'Ungültige Koordinate. RA 0–360° (oder Stunden), Dek −89…+89°.', '座標が無効です。赤経は0–360°（または時）、赤緯は−89〜+89°。'],
  'custom.resolving': ['Ad çözülüyor (CDS Sesame)…', 'Resolving name (CDS Sesame)…', 'Resolviendo nombre (CDS Sesame)…', 'Name wird aufgelöst (CDS Sesame)…', '名前を解決中（CDS Sesame）…'],
  'custom.resolved': ['{name} → RA {ra}, Dec {dec}. “Sektörü Oluştur”a basın.', '{name} → RA {ra}, Dec {dec}. Press “Create Sector”.', '{name} → AR {ra}, Dec {dec}. Pulse «Crear sector».', '{name} → RA {ra}, Dek {dec}. „Sektor erzeugen“ drücken.', '{name} → 赤経 {ra}、赤緯 {dec}。「セクターを作成」を押してください。'],
  'custom.failed': ['Ad çözülemedi (çevrimdışı olabilirsiniz): {msg}', 'Could not resolve name (you may be offline): {msg}', 'No se pudo resolver el nombre (¿sin conexión?): {msg}', 'Name nicht auflösbar (evtl. offline): {msg}', '名前を解決できません（オフラインの可能性）: {msg}'],
  'common.close': ['Kapat', 'Close', 'Cerrar', 'Schließen', '閉じる'],
  'common.delete': ['Sil', 'Delete', 'Eliminar', 'Löschen', '削除'],
  'common.yr': ['yıl', 'yr', 'año', 'Jahr', '年'],
  'common.moreInfo': ['Ne işe yarar?', 'What is this?', '¿Para qué sirve?', 'Wozu dient das?', 'これは何？'],

  // ───────── Görüntüleme modları ─────────
  'mode.blink.n': ['Göz Kırpma', 'Blink', 'Parpadeo', 'Blinken', 'ブリンク'],
  'mode.blink.s': ['Blink', 'Flicker compare', 'Comparador alterno', 'Blink-Vergleich', '点滅比較'],
  'mode.rgb.n': ['Kırmızı-Mavi Fark', 'Red-Blue Difference', 'Diferencia rojo-azul', 'Rot-Blau-Differenz', '赤青差分'],
  'mode.rgb.s': ['RGB', 'RGB composite', 'Compuesto RGB', 'RGB-Komposit', 'RGB合成'],
  'mode.diff.n': ['Sadece Değişenler', 'Changes Only', 'Solo cambios', 'Nur Änderungen', '変化のみ'],
  'mode.diff.s': ['Fark', 'Subtraction', 'Sustracción', 'Subtraktion', '差分'],
  'mode.split.n': ['Perde Kaydırıcı', 'Curtain Slider', 'Cortina deslizante', 'Vorhang-Schieber', 'カーテンスライダー'],
  'mode.split.s': ['Split', 'Split view', 'Vista dividida', 'Geteilte Ansicht', '分割表示'],
  'tip.mode.blink': ['İki tarih arasında hızla gidip gelir. Hareket eden veya parlaklığı değişen cisimler “zıplar” ya da yanıp söner; yıldızlar yerinde durur.', 'Flips rapidly between the two dates. Anything that moves or changes brightness appears to jump or flash, while stars stay still.', 'Alterna rápidamente entre las dos fechas. Lo que se mueve o cambia de brillo “salta” o parpadea; las estrellas permanecen quietas.', 'Wechselt schnell zwischen den beiden Daten. Was sich bewegt oder heller/dunkler wird, springt oder blinkt; Sterne bleiben ruhig.', '2つの日付を素早く切り替えます。動く天体や明るさが変わる天体は跳ねたり点滅したりし、恒星は動きません。'],
  'tip.mode.rgb': ['1. tarihi kırmızıya, 2. tarihi camgöbeğine boyar. Sabit yıldızlar beyaz görünür; hareket eden cisim yan yana bir kırmızı ve bir mavi nokta olur.', 'Paints date 1 red and date 2 cyan. Fixed stars look white; a moving object shows as a red dot next to a cyan dot.', 'Pinta la fecha 1 de rojo y la 2 de cian. Las estrellas fijas se ven blancas; un objeto en movimiento aparece como un punto rojo junto a uno cian.', 'Färbt Datum 1 rot und Datum 2 cyan. Feste Sterne erscheinen weiß; ein bewegtes Objekt wird zu einem roten Punkt neben einem cyanfarbenen.', '日付1を赤、日付2をシアンで表示。静止した恒星は白、動く天体は赤い点とシアンの点が並んで見えます。'],
  'tip.mode.diff': ['İki görüntüyü birbirinden çıkarır. Değişmeyen her şey siyaha döner; yalnızca hareket eden veya parlaklığı değişen şeyler kalır.', 'Subtracts one image from the other. Everything unchanged turns black; only what moved or changed brightness remains.', 'Resta una imagen de la otra. Todo lo que no cambia se vuelve negro; solo queda lo que se movió o cambió de brillo.', 'Zieht die Bilder voneinander ab. Alles Unveränderte wird schwarz; nur Bewegtes oder Helligkeitsänderungen bleiben.', '2枚の画像を引き算します。変化のない部分は黒になり、動いたもの・明るさが変わったものだけが残ります。'],
  'tip.mode.split': ['Çizginin solunda 1. tarih, sağında 2. tarih görünür. Çizgiyi sürükleyerek aynı noktayı iki tarihte karşılaştırın.', 'Shows date 1 left of a draggable line and date 2 on the right. Drag the line to compare the same spot on both dates.', 'Muestra la fecha 1 a la izquierda de una línea arrastrable y la 2 a la derecha. Arrastre la línea para comparar el mismo punto.', 'Zeigt links der ziehbaren Linie Datum 1, rechts Datum 2. Linie ziehen, um dieselbe Stelle zu vergleichen.', 'ドラッグできる線の左に日付1、右に日付2を表示。線を動かして同じ場所を比較できます。'],

  // ───────── Sol panel: tarihler · tarama ─────────
  'dates.title': ['Tarih Karşılaştırma', 'Compare Dates', 'Comparar fechas', 'Datumsvergleich', '日付の比較'],
  'dates.d1': ['1. Tarih (eski)', 'Date 1 (earlier)', 'Fecha 1 (anterior)', 'Datum 1 (früher)', '日付1（前）'],
  'dates.d2': ['2. Tarih (yeni)', 'Date 2 (later)', 'Fecha 2 (posterior)', 'Datum 2 (später)', '日付2（後）'],
  'dates.dt': ['Aralık: {dt} yıl', 'Span: {dt} yr', 'Intervalo: {dt} años', 'Zeitraum: {dt} Jahre', '間隔: {dt}年'],
  'scan.btn': ['Değişimleri Otomatik Tara', 'Scan for Changes', 'Buscar cambios automáticamente', 'Änderungen automatisch suchen', '変化を自動スキャン'],
  'scan.btnLong': ['İki Tarih Arasındaki Değişimleri Otomatik Bul', 'Find Changes Between Two Dates Automatically', 'Encontrar cambios entre dos fechas automáticamente', 'Änderungen zwischen zwei Daten automatisch finden', '2つの日付間の変化を自動検出'],
  'scan.running': ['Taranıyor… %{p}', 'Scanning… {p}%', 'Analizando… {p}%', 'Suche läuft… {p}%', 'スキャン中… {p}%'],
  'scan.found': ['{n} değişim bulundu · {k} yeni aday', '{n} changes found · {k} new candidates', '{n} cambios · {k} candidatos nuevos', '{n} Änderungen · {k} neue Kandidaten', '{n}件の変化 · 新候補{k}件'],
  'scan.none': ['Bu iki tarih arasında belirgin değişim bulunamadı.', 'No significant change found between these two dates.', 'No se encontraron cambios significativos entre estas fechas.', 'Zwischen diesen Daten wurde keine signifikante Änderung gefunden.', 'この2つの日付の間に有意な変化は見つかりませんでした。'],
  'scan.hint': ['İki tarih seçip taramayı başlatın: hareket eden ve parlaklığı değişen cisimler burada listelenir.', 'Pick two dates and start the scan: moving and brightness-changing objects are listed here.', 'Elija dos fechas e inicie el análisis: aquí se listan los objetos que se mueven o cambian de brillo.', 'Zwei Daten wählen und Suche starten: bewegte und helligkeitsveränderliche Objekte erscheinen hier.', '2つの日付を選んでスキャンを開始すると、動く天体・明るさが変わる天体がここに並びます。'],
  'scan.new': ['Yeni aday', 'New candidate', 'Candidato nuevo', 'Neuer Kandidat', '新候補'],
  'scan.inCatalog': ['Katalogda', 'In catalog', 'En catálogo', 'Im Katalog', 'カタログ登録済'],
  'scan.rowMove': ['{d}″ yer değiştirdi', 'moved {d}″', 'se movió {d}″', '{d}″ bewegt', '{d}″移動'],
  'scan.rowFlux': ['parlaklık {p}', 'brightness {p}', 'brillo {p}', 'Helligkeit {p}', '明るさ {p}'],
  'scan.stale': ['Tarihler değişti — sonuçlar eski. Yeniden tarayın.', 'Dates changed — results are outdated. Scan again.', 'Las fechas cambiaron — resultados desactualizados. Analice de nuevo.', 'Daten geändert — Ergebnisse veraltet. Erneut suchen.', '日付が変わりました。結果は古いので再スキャンしてください。'],
  'tip.dates': ['Karşılaştırmak için iki zaman seçin. SPHEREx gökyüzünü altı ayda bir yeniden gözlediği için tarihler arasındaki farklar hareketi ve değişkenliği ortaya çıkarır.', 'Pick two moments to compare. SPHEREx re-observes the sky every six months, so differences between dates reveal motion and variability.', 'Elija dos momentos para comparar. SPHEREx vuelve a observar el cielo cada seis meses; las diferencias revelan movimiento y variabilidad.', 'Zwei Zeitpunkte zum Vergleichen wählen. SPHEREx beobachtet den Himmel alle sechs Monate neu; Unterschiede zeigen Bewegung und Veränderlichkeit.', '比較する2つの時期を選びます。SPHERExは半年ごとに空を再観測するため、日付間の差から動きや変光が分かります。'],
  'tip.scan': ['Bu alandaki her cismi iki tarihte otomatik ölçer; yer değiştirenleri (Δθ) ve parlaklığı/rengi değişenleri (ΔF) listeler. Her sonuca sade bir dille “neden” açıklaması eklenir.', 'Automatically measures every object in this field on both dates and lists those that moved (Δθ) or changed brightness/colour (ΔF). Each result gets a plain-language explanation of why.', 'Mide automáticamente cada objeto del campo en ambas fechas y lista los que se movieron (Δθ) o cambiaron de brillo/color (ΔF), con una explicación sencilla de la causa.', 'Misst jedes Objekt dieses Feldes an beiden Daten und listet bewegte (Δθ) sowie helligkeits-/farbveränderte (ΔF) auf – jeweils mit einfacher Erklärung der Ursache.', 'この領域の全天体を2つの日付で自動測定し、動いた天体（Δθ）や明るさ・色が変わった天体（ΔF）を一覧にします。各結果に原因の平易な説明が付きます。'],

  // ───────── Sol panel: filtreler · ayarlar ─────────
  'filters.title': ['Hazır Spektral Keşif Filtreleri', 'Ready-made Discovery Filters', 'Filtros de descubrimiento', 'Fertige Entdeckungsfilter', '発見フィルター'],
  'filters.off': ['Filtreyi kapat', 'Turn filter off', 'Quitar filtro', 'Filter aus', 'フィルターを解除'],
  'filter.bd.n': ['Kahverengi Cüce Avcısı', 'Brown Dwarf Hunter', 'Cazador de enanas marrones', 'Brauner-Zwerg-Jäger', '褐色矮星ハンター'],
  'filter.bd.s': ['1.6 µm / 4.5 µm renk kesimi', '1.6 µm / 4.5 µm colour cut', 'Corte de color 1,6 / 4,5 µm', 'Farbschnitt 1,6 / 4,5 µm', '1.6 / 4.5 µm 色選別'],
  'filter.ice.n': ['Su Buzu & Kuyruklu Yıldız', 'Water Ice & Comets', 'Hielo de agua y cometas', 'Wassereis & Kometen', '水氷と彗星'],
  'filter.ice.s': ['3.0 µm buz soğurma çukuru', '3.0 µm ice absorption dip', 'Absorción de hielo a 3,0 µm', '3,0-µm-Eisabsorption', '3.0 µm 氷吸収'],
  'filter.therm.n': ['Gezegen X Termal', 'Planet X Thermal', 'Planeta X térmico', 'Planet X thermisch', '惑星X熱放射'],
  'filter.therm.s': ['4.8 µm soğuk cisim bandı', '4.8 µm cold-body band', 'Banda de cuerpos fríos 4,8 µm', '4,8-µm-Band kalter Körper', '4.8 µm 低温天体バンド'],
  'filter.bd.help': ['Yıldızlar silinir; çok soğuk cüceler ve termal ışıma yapan cisimler kalır.', 'Ordinary stars are removed; very cold dwarfs and thermally glowing bodies remain.', 'Se eliminan las estrellas; quedan enanas muy frías y cuerpos con brillo térmico.', 'Normale Sterne verschwinden; sehr kalte Zwerge und thermisch leuchtende Körper bleiben.', '通常の恒星が消え、非常に低温の矮星や熱放射する天体が残ります。'],
  'filter.ice.help': ['Buz soğurması olan cisimler (kuyruklu yıldız, buzlu KBO) parlak görünür.', 'Objects with ice absorption (comets, icy KBOs) shine out.', 'Los objetos con absorción de hielo (cometas, KBO helados) destacan.', 'Objekte mit Eisabsorption (Kometen, eisige KBOs) leuchten hervor.', '氷の吸収を持つ天体（彗星・氷のKBO）が明るく見えます。'],
  'filter.therm.help': ['200–400 K’lik soğuk cisimler kendi ısılarıyla en parlak burada görünür.', 'Cold bodies of 200–400 K glow brightest here from their own heat.', 'Los cuerpos fríos de 200–400 K brillan aquí por su propio calor.', 'Kalte Körper von 200–400 K leuchten hier durch Eigenwärme am hellsten.', '200–400 Kの低温天体が自らの熱で最も明るく見えます。'],
  'tip.filters': ['Her filtre gökyüzünü farklı bir kızılötesi “renkte” gösterir ve belirli bir cisim türünü öne çıkarır.', 'Each filter shows the sky in a different infrared “colour” that makes one kind of object stand out.', 'Cada filtro muestra el cielo en un «color» infrarrojo distinto que resalta un tipo de objeto.', 'Jeder Filter zeigt den Himmel in einer anderen Infrarot-„Farbe“, die eine Objektart hervorhebt.', '各フィルターは空を異なる赤外線の「色」で表示し、特定の種類の天体を際立たせます。'],
  'tip.filter.bd': ['Kahverengi cüceler kısa dalga boyunda ışıyamayacak kadar soğuktur ama 4.5 µm’de parlar. Bu filtre sıradan yıldızları çıkarıp yalnızca çok soğuk cisimleri bırakır.', 'Brown dwarfs are too cold to shine at short wavelengths but glow at 4.5 µm. This filter subtracts ordinary stars so only very cold bodies remain.', 'Las enanas marrones son demasiado frías para brillar en longitudes cortas, pero brillan a 4,5 µm. Este filtro resta las estrellas normales y deja solo cuerpos muy fríos.', 'Braune Zwerge sind zu kalt für kurze Wellenlängen, leuchten aber bei 4,5 µm. Der Filter zieht normale Sterne ab; nur sehr kalte Körper bleiben.', '褐色矮星は温度が低く短波長では光りませんが、4.5 µmで輝きます。このフィルターは通常の恒星を引き算し、非常に低温の天体だけを残します。'],
  'tip.filter.ice': ['Su buzu 3.0 µm’de ışığı yutar. Kuyruklu yıldızlar ve dış Güneş Sistemi’nin buzlu cisimleri, buz “çukuru” çevresinden ayrıştığı için burada parlak görünür.', 'Water ice absorbs light at 3.0 µm. Comets and icy outer-Solar-System bodies look bright here because their ice “dip” stands out from the surroundings.', 'El hielo de agua absorbe luz a 3,0 µm. Cometas y cuerpos helados del Sistema Solar exterior destacan aquí porque su «hendidura» de hielo resalta.', 'Wassereis absorbiert bei 3,0 µm Licht. Kometen und eisige Körper des äußeren Sonnensystems fallen hier auf, weil ihr Eis-„Loch“ hervortritt.', '水氷は3.0 µmで光を吸収します。彗星や外縁天体は氷の「くぼみ」が目立つため、ここで明るく見えます。'],
  'tip.filter.therm': ['4.8 µm’de 200–400 K’lik soğuk cisimler kendi ısılarıyla parlar. Varsayımsal Gezegen X gibi uzaktaki soğuk bir gezegeni aramak için en uygun bant budur.', 'At 4.8 µm cold bodies (200–400 K) glow from their own heat. This is the band to look for a far-away cold planet such as the hypothetical Planet X.', 'A 4,8 µm los cuerpos fríos (200–400 K) brillan por su calor propio. Es la banda ideal para buscar un planeta frío y lejano como el hipotético Planeta X.', 'Bei 4,8 µm leuchten kalte Körper (200–400 K) durch Eigenwärme. Ideal, um einen fernen kalten Planeten wie den hypothetischen Planet X zu suchen.', '4.8 µmでは200–400 Kの低温天体が自らの熱で輝きます。仮説上の惑星Xのような遠方の低温惑星を探すのに最適なバンドです。'],
  'settings.title': ['Görüntü Ayarları', 'Image Settings', 'Ajustes de imagen', 'Bildeinstellungen', '画像設定'],
  'settings.blinkHz': ['Blink hızı', 'Blink rate', 'Velocidad de parpadeo', 'Blink-Rate', 'ブリンク速度'],
  'settings.bright': ['Parlaklık kazancı', 'Brightness gain', 'Ganancia de brillo', 'Helligkeitsverstärkung', '明るさゲイン'],
  'settings.thr': ['Çıkarma eşiği', 'Subtraction threshold', 'Umbral de resta', 'Subtraktionsschwelle', '差分しきい値'],
  'settings.gain': ['Hareketi büyütme çarpanı', 'Motion exaggeration', 'Exageración del movimiento', 'Bewegungsverstärkung', '動きの誇張倍率'],
  'settings.gainHelp': ['Sentetik gökyüzünde gerçek hareketler piksel altı kalacağından, tespiti kolaylaştırmak için büyütülür. Panelde ölçülen μ bu çarpana bölünerek fiziksel değere indirgenir.', 'Real motions would be sub-pixel in this synthetic sky, so they are exaggerated to be visible. The measured μ is divided by this factor to give the physical value.', 'Los movimientos reales serían subpíxel en este cielo sintético, así que se exageran para verlos. El μ medido se divide por este factor para obtener el valor físico.', 'Echte Bewegungen wären hier subpixelgroß und werden zur Sichtbarkeit verstärkt. Das gemessene μ wird durch diesen Faktor auf den physikalischen Wert zurückgerechnet.', 'この合成空では実際の動きがサブピクセルになるため、見やすいよう誇張しています。測定されたμをこの倍率で割ると物理値になります。'],
  'settings.markers': ['Katalog işaretlerini göster', 'Show catalog markers', 'Mostrar marcas del catálogo', 'Katalogmarkierungen zeigen', 'カタログ印を表示'],
  'tip.settings': ['Görüntüyü ince ayarlayın: blink hızı, parlaklık, çıkarma eşiği ve hareketin ne kadar büyütüleceği.', 'Fine-tune the picture: blink rate, brightness, subtraction threshold and how strongly motions are exaggerated.', 'Ajuste la imagen: velocidad de parpadeo, brillo, umbral de resta y exageración del movimiento.', 'Bild feinjustieren: Blink-Rate, Helligkeit, Subtraktionsschwelle und Bewegungsverstärkung.', '画像を微調整します: ブリンク速度、明るさ、差分しきい値、動きの誇張度。'],

  // ───────── Orta: dalga boyu · kanvas ─────────
  'wave.title': ['Dalga Boyu (102 Spektral Bant)', 'Wavelength (102 Spectral Bands)', 'Longitud de onda (102 bandas)', 'Wellenlänge (102 Spektralbänder)', '波長（102バンド）'],
  'wave.band': ['Bant {n}/102 · R ≈ {r}', 'Band {n}/102 · R ≈ {r}', 'Banda {n}/102 · R ≈ {r}', 'Band {n}/102 · R ≈ {r}', 'バンド {n}/102 · R ≈ {r}'],
  'wave.filterActive': ['Filtre aktif: {name}', 'Filter active: {name}', 'Filtro activo: {name}', 'Filter aktiv: {name}', 'フィルター有効: {name}'],
  'tip.wave': ['SPHEREx kızılötesi ışığı 102 dar “renge” (0.75–5 µm) ayırır. Kaydırıcıyla gökyüzünü bu renklerden herhangi birinde görün; farklı cisimler farklı renklerde parlar.', 'SPHEREx splits infrared light into 102 narrow “colours” (0.75–5 µm). Slide to view the sky in any one of them; different objects shine at different colours.', 'SPHEREx separa la luz infrarroja en 102 «colores» estrechos (0,75–5 µm). Deslice para ver el cielo en cualquiera; cada objeto brilla en colores distintos.', 'SPHEREx zerlegt Infrarotlicht in 102 schmale „Farben“ (0,75–5 µm). Schieben Sie, um den Himmel in einer davon zu sehen; verschiedene Objekte leuchten in verschiedenen Farben.', 'SPHERExは赤外線を102の細かい「色」（0.75–5 µm）に分けます。スライダーで好きな色の空を表示でき、天体ごとに輝く色が違います。'],
  'ctl.zoomIn': ['Yakınlaştır', 'Zoom in', 'Acercar', 'Vergrößern', '拡大'],
  'ctl.zoomOut': ['Uzaklaştır', 'Zoom out', 'Alejar', 'Verkleinern', '縮小'],
  'ctl.reset': ['Görünümü sıfırla', 'Reset view', 'Restablecer vista', 'Ansicht zurücksetzen', '表示をリセット'],
  'ctl.save': ['Görüntüyü PNG kaydet', 'Save image as PNG', 'Guardar imagen PNG', 'Bild als PNG speichern', 'PNGで保存'],
  'ctl.play': ['Blink’i başlat', 'Start blinking', 'Iniciar parpadeo', 'Blinken starten', 'ブリンク開始'],
  'ctl.pause': ['Blink’i durdur', 'Pause blinking', 'Pausar parpadeo', 'Blinken pausieren', 'ブリンク停止'],
  'hud.dates': ['A: {a} · B: {b}', 'A: {a} · B: {b}', 'A: {a} · B: {b}', 'A: {a} · B: {b}', 'A: {a} · B: {b}'],
  'hud.filter': ['FİLTRE: {name}', 'FILTER: {name}', 'FILTRO: {name}', 'FILTER: {name}', 'フィルター: {name}'],
  'compass.n': ['K', 'N', 'N', 'N', '北'],
  'compass.e': ['D', 'E', 'E', 'O', '東'],
  'sky.sources': ['{n} kaynak', '{n} sources', '{n} fuentes', '{n} Quellen', '{n}個の天体'],
  'sky.targets': ['{n} keşfedilmeyi bekleyen hareketli/değişen cisim', '{n} moving/variable objects waiting to be found', '{n} objetos móviles/variables por descubrir', '{n} bewegte/veränderliche Objekte warten auf Entdeckung', '発見を待つ移動・変光天体 {n}個'],
  'sky.found': ['Keşfedilen: {a}/{b}', 'Found: {a}/{b}', 'Descubiertos: {a}/{b}', 'Entdeckt: {a}/{b}', '発見済: {a}/{b}'],
  'sky.fov': ['{w}′ × {h}′ · {s}″/piksel', '{w}′ × {h}′ · {s}″/px', '{w}′ × {h}′ · {s}″/px', '{w}′ × {h}′ · {s}″/Px', '{w}′ × {h}′ · {s}″/px'],
  'sky.zoom': ['yakınlaştırma ×{z}', 'zoom ×{z}', 'zoom ×{z}', 'Zoom ×{z}', 'ズーム ×{z}'],
  'building': ['Sentetik gökyüzü sentezleniyor…', 'Synthesising the sky…', 'Sintetizando el cielo…', 'Himmel wird synthetisiert…', '合成の空を生成中…'],
  'building.sub': ['yıldızlar · galaksiler · 102 bant spektrum · kozmik ışınlar', 'stars · galaxies · 102-band spectra · cosmic rays', 'estrellas · galaxias · espectros de 102 bandas · rayos cósmicos', 'Sterne · Galaxien · 102-Band-Spektren · kosmische Strahlung', '恒星 · 銀河 · 102バンドのスペクトル · 宇宙線'],
  'tip.sector': ['Hangi gökyüzü bölgesini inceleyeceğinizi seçin: ekliptik (asteroit, kuyruklu yıldız), Samanyolu’ndan uzak bölge (soğuk cüceler, Gezegen X), Orion bulutu (buz ve toz) ya da kendi koordinatlarınız.', 'Choose which patch of sky to study: along the ecliptic (asteroids, comets), far from the Milky Way (cold dwarfs, Planet X), the Orion cloud (ice and dust) or your own coordinates.', 'Elija qué parte del cielo estudiar: la eclíptica (asteroides, cometas), lejos de la Vía Láctea (enanas frías, Planeta X), la nube de Orión (hielo y polvo) o sus coordenadas.', 'Wählen Sie das Himmelsgebiet: Ekliptik (Asteroiden, Kometen), fern der Milchstraße (kalte Zwerge, Planet X), Orion-Wolke (Eis und Staub) oder eigene Koordinaten.', '調べる空の領域を選びます: 黄道（小惑星・彗星）、天の川から離れた領域（低温矮星・惑星X）、オリオン雲（氷とダスト）、または任意の座標。'],
  'tip.training': ['Eğitim modu, gizli cisimlerin gerçekte ne olduğunu gösterir; böylece tahminlerinizi kontrol edebilirsiniz. Gerçek bir “kör arama” için kapatın.', 'Training mode reveals what each hidden object really is so you can check your guesses. Turn it off for a true blind search.', 'El modo entrenamiento revela qué es realmente cada objeto oculto para comprobar sus hipótesis. Desactívelo para una búsqueda a ciegas.', 'Der Trainingsmodus zeigt, was jedes verborgene Objekt wirklich ist – zum Überprüfen Ihrer Vermutungen. Für eine echte Blindsuche ausschalten.', 'トレーニングモードでは隠れた天体の正体が表示され、予想を確認できます。本格的なブラインド探索ではオフにします。'],
  'tip.custom': ['Herhangi bir RA/Dec (J2000) girin; o noktada merkezlenmiş sentetik bir alan oluşturulur. İsterseniz “M42” gibi bir adı koordinata çevirebilirsiniz (internet gerekir).', 'Enter any RA/Dec (J2000) to generate a synthetic field centred there. You can also turn a name like “M42” into coordinates (needs internet).', 'Introduzca cualquier AR/Dec (J2000) para generar un campo sintético centrado allí. También puede convertir un nombre como «M42» en coordenadas (requiere internet).', 'Geben Sie beliebige RA/Dek (J2000) ein; es entsteht ein synthetisches Feld dort. Namen wie „M42“ lassen sich in Koordinaten umwandeln (Internet nötig).', '任意のRA/Dec（J2000）を入力すると、その位置を中心とした合成領域を生成します。「M42」などの名前も座標に変換できます（要インターネット）。'],

  // ───────── Tarih · tarama · haritadaki ek metinler ─────────
  'epoch.n': ['Epoch {n}', 'Epoch {n}', 'Época {n}', 'Epoche {n}', 'エポック{n}'],
  'dates.firstVsNow': ['İlk Kayıt Tarihi ile Şimdiyi Karşılaştır', 'Compare First Record Date with Now', 'Comparar la fecha del primer registro con ahora', 'Datum der Ersterfassung mit jetzt vergleichen', '最初の記録日と現在を比較'],
  'dates.firstVsNowShort': ['İlk kayıt ↔ şimdi', 'First record ↔ now', 'Primer registro ↔ ahora', 'Ersterfassung ↔ jetzt', '最初の記録 ↔ 現在'],
  'tip.compareFirst': ['Seçili cismin kataloğa ilk girdiği tarihi en son tarihle (Temmuz 2026) karşılaştırır. Hiçbir cisim seçili değilse ilk dönem (Ocak 2025) kullanılır. Cismin zaman içinde ne kadar değiştiğini tek bakışta görmek için idealdir.', 'Compares the date the selected object first entered the catalog with the latest date (July 2026). If no object is selected the first epoch (January 2025) is used. Ideal for seeing at a glance how much an object has changed over time.', 'Compara la fecha en que el objeto seleccionado entró por primera vez al catálogo con la fecha más reciente (julio de 2026). Si no hay objeto seleccionado se usa la primera época (enero de 2025). Ideal para ver de un vistazo cuánto ha cambiado un objeto con el tiempo.', 'Vergleicht das Datum, an dem das gewählte Objekt erstmals im Katalog stand, mit dem neuesten Datum (Juli 2026). Ist kein Objekt gewählt, wird die erste Epoche (Januar 2025) verwendet. Ideal, um auf einen Blick zu sehen, wie stark sich ein Objekt im Lauf der Zeit verändert hat.', '選んだ天体が最初にカタログに入った日と最新の日付（2026年7月）を比べます。天体を選んでいないときは最初のエポック（2025年1月）を使います。天体が時間とともにどれだけ変わったかが一目で分かります。'],
  'scan.title': ['Değişim Taraması', 'Change Scan', 'Búsqueda de cambios', 'Änderungssuche', '変化のスキャン'],
  'scan.at': ['Tarama zamanı: {ts}', 'Scanned at: {ts}', 'Análisis realizado: {ts}', 'Suche durchgeführt: {ts}', 'スキャン日時: {ts}'],
  'scan.rowNew': ['yeni ortaya çıktı', 'newly appeared', 'apareció de nuevo', 'neu aufgetaucht', '新たに出現'],
  'settings.keys': ['Kısayollar: 1–4 mod · Boşluk blink aç/kapa · F tarih çevir · ← → bant (Shift = ×5) · tekerlek: yakınlaştır · sürükle: kaydır', 'Shortcuts: 1–4 mode · Space start/stop blink · F flip date · ← → band (Shift = ×5) · wheel: zoom · drag: pan', 'Atajos: 1–4 modo · Espacio iniciar/parar parpadeo · F cambiar fecha · ← → banda (Mayús = ×5) · rueda: zoom · arrastrar: desplazar', 'Tastenkürzel: 1–4 Modus · Leertaste Blinken an/aus · F Datum wechseln · ← → Band (Umschalt = ×5) · Mausrad: Zoom · Ziehen: Verschieben', 'ショートカット: 1–4 モード ・ スペース ブリンク開始/停止 ・ F 日付切替 ・ ← → バンド（Shift = ×5）・ ホイール: ズーム ・ ドラッグ: 移動'],
  'tip.gain': ['Bu sentetik gökyüzünde gerçek hareketler görülemeyecek kadar küçük olurdu; bu yüzden hareketler bu çarpanla büyütülür. Ölçülen özdevinimi çarpana bölerek fiziksel değeri bulursunuz.', 'In this synthetic sky real motions would be too tiny to see, so they are exaggerated by this factor. Divide the measured proper motion by the factor to get the physical value.', 'En este cielo sintético los movimientos reales serían demasiado pequeños para verse, así que se exageran con este factor. Divida el movimiento propio medido entre el factor para obtener el valor físico.', 'In diesem synthetischen Himmel wären echte Bewegungen zu winzig, um sichtbar zu sein, daher werden sie mit diesem Faktor verstärkt. Teilen Sie die gemessene Eigenbewegung durch den Faktor, um den physikalischen Wert zu erhalten.', 'この合成の空では実際の動きが小さすぎて見えないため、この倍率で誇張しています。測定した固有運動をこの倍率で割ると物理的な値になります。'],
  'modes.title': ['Görüntüleme modu', 'Viewing mode', 'Modo de visualización', 'Darstellungsmodus', '表示モード'],
  'wave.prev': ['Önceki bant', 'Previous band', 'Banda anterior', 'Vorheriges Band', '前のバンド'],
  'wave.next': ['Sonraki bant', 'Next band', 'Banda siguiente', 'Nächstes Band', '次のバンド'],
  'sky.aria': ['SPHEREx gökyüzü kanvası', 'SPHEREx sky canvas', 'Lienzo del cielo SPHEREx', 'SPHEREx-Himmelsleinwand', 'SPHERExの空のキャンバス'],
  'sky.targetsShort': ['{n} hedef', '{n} targets', '{n} objetivos', '{n} Ziele', '目標{n}'],
  'tip.tab.map': ['Ana sayfa: gökyüzünü iki farklı tarihte karşılaştırdığınız harita, otomatik değişim taraması ve tıkladığınız cismin analizi burada.', 'The main page: the sky map where you compare two dates, the automatic change scan and the analysis of any object you click.', 'La página principal: el mapa del cielo donde compara dos fechas, la búsqueda automática de cambios y el análisis de cualquier objeto que pulse.', 'Die Hauptseite: die Himmelskarte zum Vergleich zweier Daten, die automatische Änderungssuche und die Analyse jedes angeklickten Objekts.', 'メインページ。2つの日付を比べる空の地図、自動の変化スキャン、クリックした天体の解析がここにあります。'],
  'tip.tab.catalog': ['Bilinen cisimlerin ve sizin kaydettiğiniz keşiflerin aranabilir arşivi. Her kayıt zaman damgası, değişimin fiziksel nedeni ve notlarınızla saklanır; JSON/CSV olarak dışa aktarılabilir.', 'A searchable archive of known objects and the discoveries you saved. Every entry is kept with a timestamp, the physical reason for its change and your notes, and can be exported as JSON/CSV.', 'Un archivo con búsqueda de los objetos conocidos y de los descubrimientos que usted guardó. Cada registro conserva marca de tiempo, la causa física de su cambio y sus notas, y puede exportarse como JSON/CSV.', 'Ein durchsuchbares Archiv bekannter Objekte und Ihrer gespeicherten Entdeckungen. Jeder Eintrag wird mit Zeitstempel, der physikalischen Ursache seiner Änderung und Ihren Notizen gespeichert und lässt sich als JSON/CSV exportieren.', '既知の天体と、あなたが保存した発見を検索できるアーカイブです。各項目はタイムスタンプ、変化の物理的な原因、あなたのメモとともに保存され、JSON/CSVで書き出せます。'],

  // ───────── Sağ panel: teşhis · zaman çizelgesi · spektrum · teknik ─────────
  'empty.title': ['Haritada bir cisme tıklayın', 'Click an object on the map', 'Haga clic en un objeto del mapa', 'Klicken Sie ein Objekt auf der Karte an', '地図上の天体をクリックしてください'],
  'empty.body': ['Cismin ne olduğunu, iki tarih arasında ne değiştiğini ve nedenini sade bir dille burada göreceksiniz.', 'Here you will see, in plain language, what the object is, what changed between the two dates and why.', 'Aquí verá, en lenguaje sencillo, qué es el objeto, qué cambió entre las dos fechas y por qué.', 'Hier sehen Sie in einfacher Sprache, was das Objekt ist, was sich zwischen den beiden Daten geändert hat und warum.', 'その天体が何か、2つの日付の間に何が変わったか、その理由を、やさしい言葉でここに表示します。'],
  'empty.s1': ['Soldan iki tarih seçin.', 'Pick two dates on the left.', 'Elija dos fechas a la izquierda.', 'Wählen Sie links zwei Daten.', '左で2つの日付を選びます。'],
  'empty.s2': ['“Değişimleri Otomatik Tara”ya basın.', 'Press “Scan for Changes”.', 'Pulse «Buscar cambios automáticamente».', 'Drücken Sie „Änderungen automatisch suchen“.', '「変化を自動スキャン」を押します。'],
  'empty.s3': ['Haritadaki numaralı halkalardan birine tıklayın.', 'Click one of the numbered rings on the map.', 'Haga clic en uno de los anillos numerados del mapa.', 'Klicken Sie auf einen der nummerierten Ringe auf der Karte.', '地図上の番号付きの輪をクリックします。'],
  'blank.title': ['Boş koordinat', 'Empty coordinate', 'Coordenada vacía', 'Leere Koordinate', '空の座標'],
  'blank.body': ['Burada ölçülebilir bir cisim yok. Aşağıdaki grafik bu noktadaki arka plan (zodiakal ışık) spektrumudur. İsterseniz koordinatı bir notla yine de kataloğa kaydedebilirsiniz.', 'There is no measurable object here. The graph below is the background (zodiacal light) spectrum at this point. You can still save the coordinate to the catalog with a note.', 'Aquí no hay ningún objeto medible. El gráfico inferior es el espectro de fondo (luz zodiacal) en este punto. Aun así puede guardar la coordenada en el catálogo con una nota.', 'Hier gibt es kein messbares Objekt. Das Diagramm unten zeigt das Hintergrundspektrum (Zodiakallicht) an dieser Stelle. Sie können die Koordinate trotzdem mit einer Notiz im Katalog speichern.', 'ここには測定できる天体がありません。下のグラフはこの地点の背景（黄道光）のスペクトルです。メモを付けて座標だけをカタログに保存することもできます。'],
  'diag.title': ['Akıllı Cisim Teşhisi & Değişim Nedeni', 'Smart Object Diagnosis & Reason for Change', 'Diagnóstico inteligente y causa del cambio', 'Intelligente Objektdiagnose & Ursache der Änderung', 'スマート天体診断と変化の原因'],
  'diag.auto': ['Ölçümden otomatik teşhis', 'Automatic diagnosis from measurements', 'Diagnóstico automático a partir de mediciones', 'Automatische Diagnose aus Messungen', '測定からの自動診断'],
  'diag.known': ['Katalogda kayıtlı: {id}', 'In the catalog: {id}', 'Registrado en el catálogo: {id}', 'Im Katalog: {id}', 'カタログ登録済み: {id}'],
  'diag.new': ['Katalogda yok — yeni aday', 'Not in the catalog — new candidate', 'No está en el catálogo — candidato nuevo', 'Nicht im Katalog — neuer Kandidat', 'カタログになし — 新候補'],
  'diag.truth': ['GERÇEK', 'TRUTH', 'REALIDAD', 'WAHRHEIT', '正解'],
  'tip.diag': ['Bu kart, ölçümlerden otomatik üretilmiş bir tanıdır: cismin ne olabileceği, iki tarih arasında neyin değiştiği ve bunun fiziksel nedeni. Kartın rengi cismin türünü gösterir; “Nedeni” satırı bilimsel açıklamadır.', 'This card is an automatic diagnosis built from the measurements: what the object might be, what changed between the two dates and the physical reason. The card colour shows the object type; the “Reason” line is the scientific explanation.', 'Esta tarjeta es un diagnóstico automático basado en las mediciones: qué podría ser el objeto, qué cambió entre las dos fechas y la causa física. El color indica el tipo de objeto; la línea «Causa» es la explicación científica.', 'Diese Karte ist eine automatische Diagnose aus den Messungen: was das Objekt sein könnte, was sich zwischen den beiden Daten geändert hat und die physikalische Ursache. Die Kartenfarbe zeigt den Objekttyp; die Zeile „Ursache“ ist die wissenschaftliche Erklärung.', 'このカードは測定から自動で作られた診断です。天体が何か、2つの日付の間に何が変わったか、その物理的な原因を示します。色は天体の種類を表し、「原因」の行が科学的な説明です。'],
  'tl.title': ['Zaman Çizelgesi · Geçmiş Kayıtlar', 'Timeline · Past Records', 'Cronología · registros pasados', 'Zeitleiste · frühere Aufzeichnungen', 'タイムライン・過去の記録'],
  'tl.first': ['ilk kayıt', 'first record', 'primer registro', 'Ersterfassung', '最初の記録'],
  'tl.none': ['bu dönemde görünmüyor / ölçülemedi', 'not visible / not measurable in this epoch', 'no visible / no medible en esta época', 'in dieser Epoche nicht sichtbar / nicht messbar', 'この時期は見えない／測定不可'],
  'tl.saved': ['Kataloğa kaydedildi: {ts}', 'Saved to the catalog: {ts}', 'Guardado en el catálogo: {ts}', 'Im Katalog gespeichert: {ts}', 'カタログに保存: {ts}'],
  'tip.timeline': ['Cismin dört gözlem tarihindeki ölçülmüş konumu ve parlaklığı (AB kadir: sayı küçüldükçe cisim parlar). “+…″” değeri, ilk kayıttan bu yana toplam kaymayı gösterir. Sabit bir yıldızın konumu hiç değişmez.', 'The object’s measured position and brightness on the four observation dates (AB magnitude: the smaller the number, the brighter the object). “+…″” is the total shift since the first record. A steady star never changes position.', 'La posición y el brillo medidos del objeto en las cuatro fechas de observación (magnitud AB: cuanto menor el número, más brillante). «+…″» es el desplazamiento total desde el primer registro. Una estrella estable nunca cambia de posición.', 'Gemessene Position und Helligkeit des Objekts an den vier Beobachtungsdaten (AB-Größe: je kleiner die Zahl, desto heller). „+…″“ ist die Gesamtverschiebung seit der Ersterfassung. Ein ruhiger Stern ändert nie seine Position.', '4回の観測日における天体の測定位置と明るさです（ABマグニチュード: 数字が小さいほど明るい）。「+…″」は最初の記録からの総移動量で、動かない恒星の位置は変わりません。'],
  'spec.title': ['Kızılötesi Parmak İzi', 'Infrared Fingerprint', 'Huella dactilar infrarroja', 'Infraroter Fingerabdruck', '赤外線の指紋'],
  'spec.bg': ['Arka plan / piksel', 'Background / pixel', 'Fondo / píxel', 'Hintergrund / Pixel', '背景／ピクセル'],
  'spec.hint': ['Grafiğe tıklayarak dalga boyunu seçin. Renkli şeritler su buzu, metan, CO₂ ve CO’nun ışığı yuttuğu veya yaydığı bölgelerdir.', 'Click the graph to choose a wavelength. The coloured bands mark where water ice, methane, CO₂ and CO absorb or emit light.', 'Haga clic en el gráfico para elegir una longitud de onda. Las franjas de color marcan dónde el hielo de agua, el metano, el CO₂ y el CO absorben o emiten luz.', 'Auf das Diagramm klicken, um eine Wellenlänge zu wählen. Die farbigen Bänder zeigen, wo Wassereis, Methan, CO₂ und CO Licht absorbieren oder abgeben.', 'グラフをクリックして波長を選びます。色付きの帯は、水氷・メタン・CO₂・COが光を吸収または放射する領域です。'],
  'abs.h2o': ['Su buzu', 'Water ice', 'Hielo de agua', 'Wassereis', '水氷'],
  'abs.ch4': ['Metan', 'Methane', 'Metano', 'Methan', 'メタン'],
  'chart.ab': ['AB kadir', 'AB mag', 'mag AB', 'AB-Mag.', 'ABマグ'],
  'chart.limit': ['λ (µm) · boş üçgen = 3σ üst limit', 'λ (µm) · open triangle = 3σ upper limit', 'λ (µm) · triángulo vacío = límite superior 3σ', 'λ (µm) · offenes Dreieck = 3σ-Obergrenze', 'λ (µm)・白抜き三角＝3σ上限'],
  'tip.spectrum': ['SPHEREx’in 102 rengindeki ışık miktarı cismin “parmak izidir”. Su buzu 3.0 µm’de, metan 1.65 ve 3.3 µm’de, CO₂ 4.26 µm’de, CO ise 4.67 µm’de ışıkla etkileşir; spektrumdaki çukur ve tümsekler cismin neyden yapıldığını ele verir.', 'The amount of light in each of SPHEREx’s 102 colours is the object’s “fingerprint”. Water ice interacts with light at 3.0 µm, methane at 1.65 and 3.3 µm, CO₂ at 4.26 µm and CO at 4.67 µm; the dips and bumps in the spectrum reveal what the object is made of.', 'La cantidad de luz en cada uno de los 102 colores de SPHEREx es la «huella dactilar» del objeto. El hielo de agua interactúa con la luz a 3,0 µm, el metano a 1,65 y 3,3 µm, el CO₂ a 4,26 µm y el CO a 4,67 µm; las hendiduras y abultamientos del espectro revelan de qué está hecho el objeto.', 'Die Lichtmenge in jeder der 102 SPHEREx-Farben ist der „Fingerabdruck“ des Objekts. Wassereis wechselwirkt bei 3,0 µm mit Licht, Methan bei 1,65 und 3,3 µm, CO₂ bei 4,26 µm und CO bei 4,67 µm; die Senken und Wölbungen im Spektrum verraten, woraus das Objekt besteht.', 'SPHERExの102色それぞれの光の量が、その天体の「指紋」です。水氷は3.0 µm、メタンは1.65 µmと3.3 µm、CO₂は4.26 µm、COは4.67 µmで光と相互作用し、スペクトルのくぼみや盛り上がりから天体の成分が分かります。'],
  'tech.title': ['Teknik Verileri Göster', 'Show Technical Data', 'Mostrar datos técnicos', 'Technische Daten anzeigen', '技術データを表示'],
  'tip.tech': ['Yukarıdaki yorumların dayandığı ham ölçümler. Meraklılar ve uzmanlar içindir; her kutunun yanındaki ⓘ o değerin ne anlama geldiğini açıklar.', 'The raw measurements behind the interpretation above. Meant for the curious and for experts; the ⓘ next to each box explains what the value means.', 'Las mediciones en bruto en las que se basa la interpretación anterior. Para curiosos y expertos; el ⓘ junto a cada casilla explica qué significa el valor.', 'Die Rohmessungen hinter der obigen Deutung. Für Neugierige und Fachleute; das ⓘ neben jedem Feld erklärt die Bedeutung des Werts.', '上の解釈のもとになった生の測定値です。興味のある方や専門家向けで、各ボックスの ⓘ がその値の意味を説明します。'],
  'metric.dtheta': ['Açısal yer değiştirme Δθ', 'Angular displacement Δθ', 'Desplazamiento angular Δθ', 'Winkelverschiebung Δθ', '角変位 Δθ'],
  'metric.mu': ['Özdevinim μ', 'Proper motion μ', 'Movimiento propio μ', 'Eigenbewegung μ', '固有運動 μ'],
  'metric.pa': ['Konum açısı PA', 'Position angle PA', 'Ángulo de posición PA', 'Positionswinkel PA', '位置角 PA'],
  'metric.color': ['Renk F(1.6)/F(4.5)', 'Colour F(1.6)/F(4.5)', 'Color F(1,6)/F(4,5)', 'Farbe F(1,6)/F(4,5)', '色 F(1.6)/F(4.5)'],
  'metric.thermal': ['Termal F(4.8)/F(4.5)', 'Thermal F(4.8)/F(4.5)', 'Térmico F(4,8)/F(4,5)', 'Thermisch F(4,8)/F(4,5)', '熱放射 F(4.8)/F(4.5)'],
  'metric.ice': ['H₂O buz çukuru 3.0 µm', 'H₂O ice dip at 3.0 µm', 'Hendidura de hielo H₂O a 3,0 µm', 'H₂O-Eisabsorption bei 3,0 µm', '3.0 µm H₂O氷の吸収'],
  'metric.co2': ['CO₂ 4.26 µm', 'CO₂ 4.26 µm', 'CO₂ 4,26 µm', 'CO₂ 4,26 µm', 'CO₂ 4.26 µm'],
  'metric.pah': ['PAH 3.3 µm', 'PAH 3.3 µm', 'PAH 3,3 µm', 'PAH 3,3 µm', 'PAH 3.3 µm'],
  'metric.flux': ['Akı değişimi B/A', 'Flux change B/A', 'Cambio de flujo B/A', 'Flussänderung B/A', 'フラックス変化 B/A'],
  'metric.tc': ['Renk sıcaklığı', 'Colour temperature', 'Temperatura de color', 'Farbtemperatur', '色温度'],
  'm.pa.sub': ['μα* {ra} · μδ {dec} ″/yıl (doğu +, kuzey +)', 'μα* {ra} · μδ {dec} ″/yr (east +, north +)', 'μα* {ra} · μδ {dec} ″/año (este +, norte +)', 'μα* {ra} · μδ {dec} ″/Jahr (Ost +, Nord +)', 'μα* {ra} · μδ {dec} ″/年（東＋、北＋）'],
  'm.color.red': ['kızıl · cüce adayı', 'red · dwarf candidate', 'rojo · posible enana', 'rot · Zwerg-Kandidat', '赤い・矮星候補'],
  'm.color.star': ['yıldız benzeri', 'star-like', 'similar a una estrella', 'sternähnlich', '恒星的'],
  'm.color.mid': ['ara değer', 'intermediate', 'intermedio', 'dazwischen', '中間'],
  'm.therm.rise': ['soğuk/termal yükseliş', 'cold/thermal rise', 'subida térmica/fría', 'kalter/thermischer Anstieg', '低温・熱的な増加'],
  'm.therm.flat': ['düz', 'flat', 'plano', 'flach', '平坦'],
  'm.ice.na': ['süreklilik yetersiz', 'continuum too faint', 'continuo insuficiente', 'Kontinuum zu schwach', '連続光が不足'],
  'm.co2.emis': ['emisyon (koma)', 'emission (coma)', 'emisión (coma)', 'Emission (Koma)', '輝線（コマ）'],
  'm.co2.abs': ['soğurma (buz)', 'absorption (ice)', 'absorción (hielo)', 'Absorption (Eis)', '吸収（氷）'],
  'm.co2.none': ['belirgin değil', 'not significant', 'no significativo', 'nicht signifikant', '有意でない'],
  'm.na': ['ölçülemedi', 'not measurable', 'no medible', 'nicht messbar', '測定不可'],
  'm.pah.sub': ['sürekliliğe göre', 'relative to continuum', 'respecto al continuo', 'relativ zum Kontinuum', '連続光に対して'],
  'm.flux.new': ['yeni kaynak', 'new source', 'fuente nueva', 'neue Quelle', '新天体'],
  'm.tc.sub': ['1.0 / 2.1 µm oranından', 'from the 1.0 / 2.1 µm ratio', 'de la razón 1,0 / 2,1 µm', 'aus dem 1,0/2,1-µm-Verhältnis', '1.0／2.1 µm比から'],
  'm.band': ['ölçüm bandı {lam} µm', 'measured at {lam} µm', 'medido a {lam} µm', 'gemessen bei {lam} µm', '測定波長 {lam} µm'],
  'm.astro.same': ['A ve B tarihleri aynı — farklı tarihler seçin.', 'Dates A and B are the same — pick different dates.', 'Las fechas A y B son iguales: elija fechas distintas.', 'Daten A und B sind gleich — bitte unterschiedliche wählen.', 'AとBの日付が同じです。別の日付を選んでください。'],
  'm.astro.invalid': ['Cisim bu iki tarihten birinde çok sönük (S/N < 3): konumu ölçülemedi. Geçici bir olay ya da çok zayıf bir kaynak olabilir.', 'The object is too faint on one of these two dates (S/N < 3): its position could not be measured. It may be a transient or a very weak source.', 'El objeto es demasiado débil en una de las dos fechas (S/N < 3): no se pudo medir su posición. Puede ser un evento transitorio o una fuente muy débil.', 'Das Objekt ist an einem der beiden Daten zu schwach (S/N < 3): Position nicht messbar. Es könnte ein Transient oder eine sehr schwache Quelle sein.', 'この2つの日付のどちらかで天体が暗すぎ（S/N < 3）、位置を測れませんでした。突発天体か非常に暗い天体かもしれません。'],
  'tip.metric.dtheta': ['Cismin iki tarih arasında gökyüzünde ne kadar yer değiştirdiği, yay saniyesi (″) cinsinden. 1″, bir derecenin 3600’de biridir. Sabit bir yıldızda bu değer sıfıra yakın çıkar.', 'How far the object moved across the sky between the two dates, in arcseconds (″). 1″ is 1/3600 of a degree. For a steady star this value is close to zero.', 'Cuánto se desplazó el objeto por el cielo entre las dos fechas, en segundos de arco (″). 1″ es 1/3600 de grado. En una estrella estable este valor es casi cero.', 'Wie weit sich das Objekt zwischen den beiden Daten am Himmel bewegt hat, in Bogensekunden (″). 1″ ist 1/3600 Grad. Bei einem ruhigen Stern liegt der Wert nahe null.', '2つの日付の間に天体が空の上でどれだけ動いたかを、秒角（″）で表します。1″は1度の3600分の1で、動かない恒星ではほぼゼロになります。'],
  'tip.metric.mu': ['Özdevinim: cismin yıllık yer değiştirme hızı (″/yıl). Yakın yıldızlar ve kahverengi cüceler büyük değer gösterir. Altındaki ≈ değeri, didaktik çarpana bölünmüş fiziksel tahmindir.', 'Proper motion: the object’s yearly rate of shift (″/yr). Nearby stars and brown dwarfs show large values. The ≈ value below is the physical estimate after dividing by the didactic gain.', 'Movimiento propio: la velocidad anual de desplazamiento del objeto (″/año). Las estrellas cercanas y las enanas marrones muestran valores grandes. El valor ≈ de abajo es la estimación física tras dividir por el factor didáctico.', 'Eigenbewegung: die jährliche Verschiebungsrate des Objekts (″/Jahr). Nahe Sterne und Braune Zwerge zeigen große Werte. Der ≈-Wert darunter ist die physikalische Schätzung nach Division durch den didaktischen Faktor.', '固有運動: 天体が1年あたりに動く量（″/年）です。近くの恒星や褐色矮星では大きな値になります。下の≈の値は、誇張倍率で割った物理的な推定値です。'],
  'tip.metric.pa': ['Hareket yönü: kuzeyden (0°) başlayıp doğuya (90°) doğru ölçülen açı; örneğin 90° tam doğuya kayma demektir. Altındaki μα* (doğu-batı) ve μδ (kuzey-güney) hareketin bileşenleridir; artı değer doğu ve kuzey demektir.', 'Direction of motion: the angle measured from north (0°) toward east (90°); for example 90° means due east. The μα* (east–west) and μδ (north–south) values below are the components of the motion; positive means east and north.', 'Dirección del movimiento: ángulo medido desde el norte (0°) hacia el este (90°); por ejemplo, 90° significa justo hacia el este. Los valores μα* (este–oeste) y μδ (norte–sur) de abajo son las componentes del movimiento; positivo significa este y norte.', 'Bewegungsrichtung: der von Nord (0°) über Ost (90°) gemessene Winkel; 90° bedeutet zum Beispiel genau nach Osten. Die Werte μα* (Ost-West) und μδ (Nord-Süd) darunter sind die Bewegungskomponenten; positiv heißt Ost und Nord.', '動きの向き。北（0°）から東（90°）の向きに測った角度で、たとえば90°は真東への移動です。下の μα*（東西）と μδ（南北）は動きの成分で、正の値は東と北を表します。'],
  'tip.metric.color': ['1.6 µm’deki ışığın 4.5 µm’dekine oranı. Düşük (< 0.6) değer çok kızıl/soğuk bir cisme, yani kahverengi cüce adayına; yüksek (> 2) değer sıradan bir yıldıza işaret eder.', 'The ratio of the light at 1.6 µm to that at 4.5 µm. A low value (< 0.6) means a very red/cold object, i.e. a brown-dwarf candidate; a high value (> 2) means an ordinary star.', 'La razón entre la luz a 1,6 µm y a 4,5 µm. Un valor bajo (< 0,6) indica un objeto muy rojo/frío, es decir, una posible enana marrón; un valor alto (> 2) indica una estrella normal.', 'Das Verhältnis des Lichts bei 1,6 µm zu dem bei 4,5 µm. Ein niedriger Wert (< 0,6) bedeutet ein sehr rotes/kaltes Objekt, also einen Braunen-Zwerg-Kandidaten; ein hoher Wert (> 2) einen normalen Stern.', '1.6 µmの光と4.5 µmの光の比です。低い値（< 0.6）は非常に赤く低温の天体、つまり褐色矮星候補を、高い値（> 2）は通常の恒星を示します。'],
  'tip.metric.thermal': ['4.8 µm’deki ışığın 4.5 µm’dekine oranı. 1.3’ten büyükse cisim kendi ısısıyla parlıyor demektir (soğuk cisim ya da Gezegen X adayı).', 'The ratio of the light at 4.8 µm to that at 4.5 µm. Above 1.3 the object is glowing from its own heat (a cold body or a Planet X candidate).', 'La razón entre la luz a 4,8 µm y a 4,5 µm. Por encima de 1,3 el objeto brilla por su propio calor (cuerpo frío o candidato a Planeta X).', 'Das Verhältnis des Lichts bei 4,8 µm zu dem bei 4,5 µm. Über 1,3 leuchtet das Objekt durch Eigenwärme (kalter Körper oder Planet-X-Kandidat).', '4.8 µmの光と4.5 µmの光の比です。1.3を超えると天体が自らの熱で光っていることを意味します（低温天体や惑星X候補）。'],
  'tip.metric.ice': ['3.0 µm’de su buzunun ışığı yutmasından oluşan çukurun derinliği. Derin çukur (> %30) buzlu bir cisme (kuyruklu yıldız, Kuiper kuşağı cismi) işaret eder.', 'Depth of the dip made by water ice absorbing light at 3.0 µm. A deep dip (> 30 %) points to an icy object (comet, Kuiper Belt object).', 'Profundidad de la hendidura que produce el hielo de agua al absorber luz a 3,0 µm. Una hendidura profunda (> 30 %) apunta a un objeto helado (cometa, objeto del cinturón de Kuiper).', 'Tiefe der Senke, die Wassereis durch Lichtabsorption bei 3,0 µm erzeugt. Eine tiefe Senke (> 30 %) deutet auf ein eisiges Objekt hin (Komet, Kuipergürtel-Objekt).', '水氷が3.0 µmで光を吸収してできるくぼみの深さです。深いくぼみ（> 30 %）は氷の天体（彗星やカイパーベルト天体）を示します。'],
  'tip.metric.co2': ['4.26 µm’de karbondioksit. Artı değer parlama (emisyon) demektir ve kuyruklu yıldız komasında görülür; eksi değer buzda soğurmadır.', 'Carbon dioxide at 4.26 µm. A positive value is brightening (emission), seen in a comet’s coma; a negative value is absorption in ice.', 'Dióxido de carbono a 4,26 µm. Un valor positivo es un aumento de brillo (emisión), típico de la coma de un cometa; uno negativo es absorción en hielo.', 'Kohlendioxid bei 4,26 µm. Ein positiver Wert bedeutet Aufhellung (Emission), wie in der Koma eines Kometen; ein negativer Wert ist Absorption in Eis.', '4.26 µmの二酸化炭素です。正の値は増光（輝線）で彗星のコマに見られ、負の値は氷による吸収です。'],
  'tip.metric.pah': ['3.3 µm’de PAH (çok halkalı aromatik hidrokarbon) ışıması: toz bulutlarında ve yıldız oluşturan galaksilerde görülen organik moleküller.', 'PAH (polycyclic aromatic hydrocarbon) emission at 3.3 µm: organic molecules seen in dust clouds and star-forming galaxies.', 'Emisión de PAH (hidrocarburos aromáticos policíclicos) a 3,3 µm: moléculas orgánicas presentes en nubes de polvo y galaxias con formación estelar.', 'PAH-Emission (polyzyklische aromatische Kohlenwasserstoffe) bei 3,3 µm: organische Moleküle in Staubwolken und sternbildenden Galaxien.', '3.3 µmのPAH（多環芳香族炭化水素）放射です。ダスト雲や星形成銀河に見られる有機分子です。'],
  'tip.metric.flux': ['İkinci tarihteki ortalama parlaklığın birinciye oranı. ×1 değişmedi, ×2 iki kat parladı, ×0.5 yarıya söndü demektir. Altındaki sayı değişimin istatistiksel anlamlılığıdır (σ; 5’in üstü güvenilirdir).', 'The ratio of the average brightness on the second date to the first. ×1 means unchanged, ×2 twice as bright, ×0.5 half as bright. The number below is the statistical significance (σ; above 5 is reliable).', 'La razón entre el brillo medio de la segunda fecha y el de la primera. ×1 significa sin cambio, ×2 el doble de brillo, ×0,5 la mitad. El número de abajo es la significancia estadística (σ; por encima de 5 es fiable).', 'Das Verhältnis der mittleren Helligkeit am zweiten zum ersten Datum. ×1 heißt unverändert, ×2 doppelt so hell, ×0,5 halb so hell. Die Zahl darunter ist die statistische Signifikanz (σ; über 5 ist verlässlich).', '2つ目の日付の平均の明るさを1つ目で割った比です。×1は変化なし、×2は2倍の明るさ、×0.5は半分です。下の数字は統計的な有意度（σ。5を超えれば信頼できます）です。'],
  'tip.metric.tc': ['Cismin renginden hesaplanan yüzey sıcaklığı. Mavi/sıcak cisimlerde yüksek, kızıl/soğuk cisimlerde düşük çıkar.', 'The surface temperature calculated from the object’s colour. High for blue/hot objects, low for red/cold ones.', 'La temperatura superficial calculada a partir del color del objeto. Alta en objetos azules/calientes, baja en rojos/fríos.', 'Die aus der Farbe des Objekts berechnete Oberflächentemperatur. Hoch bei blauen/heißen Objekten, niedrig bei roten/kalten.', '天体の色から計算した表面温度です。青く高温の天体では高く、赤く低温の天体では低くなります。'],
  'save.title': ['Kataloğa Kaydet & Not Ekle', 'Save to Catalog & Add Note', 'Guardar en el catálogo y añadir nota', 'Im Katalog speichern & Notiz hinzufügen', 'カタログに保存＆メモ追加'],
  'save.cat': ['Tür / kategori', 'Type / category', 'Tipo / categoría', 'Typ / Kategorie', '種類／カテゴリ'],
  'save.note': ['Notunuz (otomatik bilimsel neden önceden yazılıdır, istediğiniz gibi düzenleyin)', 'Your note (the automatic scientific reason is pre-filled — edit freely)', 'Su nota (la causa científica automática ya está incluida; edítela libremente)', 'Ihre Notiz (die automatische wissenschaftliche Ursache ist vorausgefüllt — frei bearbeitbar)', 'メモ（自動の科学的な原因が入力済み。自由に編集できます）'],
  'save.notePh': ['Gözlemlerinizi yazın…', 'Write your observations…', 'Escriba sus observaciones…', 'Beobachtungen eintragen…', '観察内容を記入…'],
  'save.resetNote': ['Otomatik nota geri dön', 'Restore the automatic note', 'Restaurar la nota automática', 'Automatische Notiz wiederherstellen', '自動メモに戻す'],
  'save.btn': ['Tarih Damgasıyla Kataloğa Kaydet', 'Save to Catalog with Timestamp', 'Guardar en el catálogo con marca de fecha', 'Mit Zeitstempel im Katalog speichern', 'タイムスタンプ付きでカタログに保存'],
  'save.done': ['Kaydedildi: {id}', 'Saved: {id}', 'Guardado: {id}', 'Gespeichert: {id}', '保存しました: {id}'],
  'save.at': ['Kayıt zamanı: {ts}', 'Saved at: {ts}', 'Guardado el: {ts}', 'Gespeichert am: {ts}', '保存日時: {ts}'],
  'save.openCatalog': ['Katalogda aç', 'Open in the catalog', 'Abrir en el catálogo', 'Im Katalog öffnen', 'カタログで開く'],
  'tip.save': ['Cismi koordinatı, tarih damgası ve bilimsel değişim nedeniyle birlikte kataloğa kaydeder. Daha sonra Katalog sekmesinde bulabilir, not ekleyebilir ve dışa aktarabilirsiniz. Kayıt ayrıca SIMBAD ve SkyBoT’ta canlı doğrulanır.', 'Saves the object to the catalog together with its coordinates, a timestamp and the scientific reason for its change. Later you can find it on the Catalog tab, add notes and export it. The entry is also checked live against SIMBAD and SkyBoT.', 'Guarda el objeto en el catálogo con sus coordenadas, una marca de tiempo y la causa científica de su cambio. Después podrá encontrarlo en la pestaña Catálogo, añadir notas y exportarlo. El registro también se comprueba en vivo con SIMBAD y SkyBoT.', 'Speichert das Objekt mit Koordinaten, Zeitstempel und der wissenschaftlichen Ursache seiner Änderung im Katalog. Später finden Sie es im Reiter Katalog, können Notizen hinzufügen und es exportieren. Der Eintrag wird außerdem live gegen SIMBAD und SkyBoT geprüft.', '天体を座標・タイムスタンプ・変化の科学的な原因とともにカタログへ保存します。後からカタログのタブで探したり、メモを追加したり、書き出したりできます。SIMBADとSkyBoTでのライブ照合も行われます。'],

  // ───────── Kategoriler · türler · otomatik teşhis adları ─────────
  'cat.bd': ['Kahverengi Cüce', 'Brown Dwarf', 'Enana marrón', 'Brauner Zwerg', '褐色矮星'],
  'cat.asteroid': ['Asteroit', 'Asteroid', 'Asteroide', 'Asteroid', '小惑星'],
  'cat.comet': ['Kuyruklu Yıldız', 'Comet', 'Cometa', 'Komet', '彗星'],
  'cat.kbo': ['Gezegen X / Kuiper Adayı', 'Planet X / Kuiper Candidate', 'Candidato a Planeta X / Kuiper', 'Planet-X-/Kuiper-Kandidat', '惑星X／カイパー候補'],
  'cat.variable': ['Değişen Yıldız / Süpernova', 'Variable Star / Supernova', 'Estrella variable / Supernova', 'Veränderlicher Stern / Supernova', '変光星／超新星'],
  'cat.star': ['Yıldız', 'Star', 'Estrella', 'Stern', '恒星'],
  'cat.galaxy': ['Galaksi', 'Galaxy', 'Galaxia', 'Galaxie', '銀河'],
  'cat.other': ['Diğer / Belirsiz', 'Other / Unclear', 'Otro / Incierto', 'Sonstiges / Unklar', 'その他／不明'],

  'ctab.all': ['Tümü', 'All', 'Todos', 'Alle', 'すべて'],
  'ctab.mine': ['Yeni Keşiflerim', 'My New Discoveries', 'Mis nuevos descubrimientos', 'Meine neuen Entdeckungen', '私の新発見'],
  'ctab.known': ['Bilinen Katalog Cisimleri', 'Known Catalog Objects', 'Objetos conocidos del catálogo', 'Bekannte Katalogobjekte', '既知のカタログ天体'],
  'ctab.bd': ['Kahverengi Cüceler', 'Brown Dwarfs', 'Enanas marrones', 'Braune Zwerge', '褐色矮星'],
  'ctab.sb': ['Kuyruklu Yıldızlar / Asteroitler', 'Comets / Asteroids', 'Cometas / Asteroides', 'Kometen / Asteroiden', '彗星／小惑星'],
  'ctab.px': ['Gezegen X Adayları', 'Planet X Candidates', 'Candidatos a Planeta X', 'Planet-X-Kandidaten', '惑星X候補'],
  'ctab.var': ['Değişen Yıldızlar / Süpernovalar', 'Variable Stars / Supernovae', 'Estrellas variables / Supernovas', 'Veränderliche Sterne / Supernovae', '変光星／超新星'],

  'kind.star': ['Anakol yıldızı ({cls})', 'Main-sequence star ({cls})', 'Estrella de la secuencia principal ({cls})', 'Hauptreihenstern ({cls})', '主系列星（{cls}）'],
  'kind.galaxy': ['Galaksi', 'Galaxy', 'Galaxia', 'Galaxie', '銀河'],
  'kind.hpm': ['Yüksek özdevinimli yakın yıldız', 'Nearby high-proper-motion star', 'Estrella cercana de gran movimiento propio', 'Nahe Stern mit hoher Eigenbewegung', '固有運動の大きい近傍恒星'],
  'kind.yso': ['Genç yıldız nesnesi (YSO)', 'Young stellar object (YSO)', 'Objeto estelar joven (YSO)', 'Junges stellares Objekt (YSO)', '若い星状天体（YSO）'],
  'kind.mira': ['Mira tipi değişen yıldız', 'Mira-type variable star', 'Estrella variable tipo Mira', 'Veränderlicher Stern vom Mira-Typ', 'ミラ型変光星'],
  'kind.bdT': ['T cücesi (kahverengi cüce)', 'T dwarf (brown dwarf)', 'Enana T (enana marrón)', 'T-Zwerg (Brauner Zwerg)', 'T型矮星（褐色矮星）'],
  'kind.bdY': ['Y cücesi (çok soğuk kahverengi cüce)', 'Y dwarf (very cold brown dwarf)', 'Enana Y (enana marrón muy fría)', 'Y-Zwerg (sehr kalter Brauner Zwerg)', 'Y型矮星（非常に低温の褐色矮星）'],
  'kind.bdYfast': ['Hızlı hareketli Y cücesi', 'Fast-moving Y dwarf', 'Enana Y de movimiento rápido', 'Schnell bewegter Y-Zwerg', '高速移動のY型矮星'],
  'kind.planetx': ['Gezegen X adayı', 'Planet X candidate', 'Candidato a Planeta X', 'Planet-X-Kandidat', '惑星X候補'],
  'kind.kbo': ['Kuiper kuşağı cismi', 'Kuiper Belt object', 'Objeto del cinturón de Kuiper', 'Kuipergürtel-Objekt', 'カイパーベルト天体'],
  'kind.snia': ['Ia tipi süpernova', 'Type Ia supernova', 'Supernova de tipo Ia', 'Supernova vom Typ Ia', 'Ia型超新星'],
  'kind.comet': ['Kuyruklu yıldız', 'Comet', 'Cometa', 'Komet', '彗星'],
  'kind.asteroidS': ['S tipi asteroit (taşlı)', 'S-type asteroid (stony)', 'Asteroide tipo S (rocoso)', 'S-Typ-Asteroid (steinig)', 'S型小惑星（岩石質）'],
  'kind.asteroidC': ['C tipi asteroit (karbonlu)', 'C-type asteroid (carbonaceous)', 'Asteroide tipo C (carbonáceo)', 'C-Typ-Asteroid (kohlenstoffreich)', 'C型小惑星（炭素質）'],
  'kind.asteroidX': ['X tipi asteroit (metalik)', 'X-type asteroid (metallic)', 'Asteroide tipo X (metálico)', 'X-Typ-Asteroid (metallisch)', 'X型小惑星（金属質）'],

  'guess.weak': ['Zayıf sinyal — sınıflandırılamadı', 'Weak signal — cannot be classified', 'Señal débil: no se puede clasificar', 'Schwaches Signal — nicht klassifizierbar', '信号が弱く分類不能'],
  'guess.variable': ['Değişen kaynak', 'Variable source', 'Fuente variable', 'Veränderliche Quelle', '変光天体'],
  'guess.cold': ['Çok soğuk cisim (Y cücesi / Gezegen X benzeri)', 'Very cold body (Y dwarf / Planet X-like)', 'Cuerpo muy frío (enana Y / similar a Planeta X)', 'Sehr kalter Körper (Y-Zwerg / Planet-X-ähnlich)', '非常に低温の天体（Y型矮星／惑星X型）'],
  'guess.bd': ['Kahverengi cüce adayı', 'Brown-dwarf candidate', 'Candidata a enana marrón', 'Brauner-Zwerg-Kandidat', '褐色矮星の候補'],
  'guess.comet': ['Kuyruklu yıldız adayı (gaz komalı)', 'Comet candidate (gas coma)', 'Candidato a cometa (coma de gas)', 'Kometenkandidat (Gaskoma)', '彗星候補（ガスのコマ）'],
  'guess.icy': ['Buzlu cisim (Kuiper kuşağı / çekirdek)', 'Icy body (Kuiper Belt / nucleus)', 'Cuerpo helado (cinturón de Kuiper / núcleo)', 'Eisiger Körper (Kuipergürtel / Kern)', '氷の天体（カイパーベルト／核）'],
  'guess.asteroid': ['Asteroit (kayaç yüzeyli)', 'Asteroid (rocky surface)', 'Asteroide (superficie rocosa)', 'Asteroid (felsige Oberfläche)', '小惑星（岩石の表面）'],
  'guess.pah': ['PAH yayan toz / yıldız oluşturan galaksi', 'PAH-emitting dust / star-forming galaxy', 'Polvo con emisión PAH / galaxia con formación estelar', 'PAH-emittierender Staub / sternbildende Galaxie', 'PAH放射のダスト／星形成銀河'],
  'guess.star': ['Yıldız', 'Star', 'Estrella', 'Stern', '恒星'],

  'row.known': ['Kayıtlı', 'Registered', 'Registrado', 'Registriert', '登録済み'],
  'row.mine': ['Keşfim', 'My discovery', 'Mi descubrimiento', 'Meine Entdeckung', '私の発見'],
  'common.clear': ['Temizle', 'Clear', 'Borrar', 'Löschen', 'クリア'],

  // ───────── Katalog sekmesi ─────────
  'catalog.title': ['Gökyüzü Kataloğu & Zaman Arşivi', 'Sky Catalog & Time Archive', 'Catálogo del cielo y archivo temporal', 'Himmelskatalog & Zeitarchiv', '天体カタログ＆タイムアーカイブ'],
  'catalog.search': ['Katalogda ara', 'Search the catalog', 'Buscar en el catálogo', 'Katalog durchsuchen', 'カタログを検索'],
  'catalog.searchPh': ['İsim, RA/Dec (ör. 83.82 -5.39), tür veya not…', 'Name, RA/Dec (e.g. 83.82 -5.39), type or note…', 'Nombre, RA/Dec (p. ej. 83.82 -5.39), tipo o nota…', 'Name, RA/Dec (z. B. 83.82 -5.39), Typ oder Notiz…', '名前、RA/Dec（例 83.82 -5.39）、種類、メモ…'],
  'catalog.export': ['Dışa aktar', 'Export', 'Exportar', 'Exportieren', 'エクスポート'],
  'catalog.cats': ['Kategoriler', 'Categories', 'Categorías', 'Kategorien', 'カテゴリ'],
  'catalog.allSectors': ['Tüm sektörler', 'All sectors', 'Todos los sectores', 'Alle Sektoren', 'すべてのセクター'],
  'catalog.onlyChanged': ['Yalnızca değişenleri göster', 'Show only changed objects', 'Mostrar solo los que cambiaron', 'Nur veränderte Objekte zeigen', '変化した天体のみ表示'],
  'catalog.saveAll': ['Yeni adayların hepsini kaydet ({n})', 'Save all new candidates ({n})', 'Guardar todos los candidatos nuevos ({n})', 'Alle neuen Kandidaten speichern ({n})', '新候補をすべて保存（{n}）'],
  'catalog.loading': ['Sektör gökyüzü hazırlanıyor…', 'Preparing the sector sky…', 'Preparando el cielo del sector…', 'Sektorhimmel wird vorbereitet…', 'セクターの空を準備中…'],
  'catalog.count': ['{n} / {total} kayıt', '{n} / {total} entries', '{n} / {total} registros', '{n} / {total} Einträge', '{n} / {total} 件'],
  'catalog.stored': ['Kayıtlar bu tarayıcıda saklanır', 'Entries are stored in this browser', 'Los registros se guardan en este navegador', 'Einträge werden in diesem Browser gespeichert', '記録はこのブラウザに保存されます'],
  'catalog.empty': ['Bu sektörde henüz kayıt yok.', 'There are no entries in this sector yet.', 'Aún no hay registros en este sector.', 'In diesem Sektor gibt es noch keine Einträge.', 'このセクターにはまだ記録がありません。'],
  'catalog.noResults': ['Aramanızla eşleşen kayıt yok. Başka bir isim, koordinat ya da kategori deneyin.', 'Nothing matches your search. Try another name, coordinate or category.', 'Ningún registro coincide con su búsqueda. Pruebe otro nombre, coordenada o categoría.', 'Keine Treffer für Ihre Suche. Versuchen Sie einen anderen Namen, eine andere Koordinate oder Kategorie.', '検索に一致する記録がありません。別の名前・座標・カテゴリをお試しください。'],
  'catalog.pick': ['Soldan bir kayıt seçin', 'Pick an entry on the left', 'Elija un registro a la izquierda', 'Wählen Sie links einen Eintrag', '左から項目を選んでください'],
  'catalog.pickBody': ['Seçtiğiniz cismin iki tarih arasındaki değişimini, bilimsel nedenini, geçmiş kayıtlarını ve notlarınızı burada göreceksiniz. “Haritada Göster” düğmesi haritayı tam o cisme odaklar.', 'You will see the selected object’s change between the two dates, its scientific reason, its past records and your notes here. The “Show on Map” button focuses the map right on it.', 'Aquí verá el cambio del objeto elegido entre las dos fechas, su causa científica, sus registros pasados y sus notas. El botón «Mostrar en el mapa» centra el mapa justo en él.', 'Hier sehen Sie die Änderung des gewählten Objekts zwischen den beiden Daten, ihre wissenschaftliche Ursache, frühere Aufzeichnungen und Ihre Notizen. „Auf Karte zeigen“ richtet die Karte genau darauf aus.', '選んだ天体の2つの日付間の変化、科学的な原因、過去の記録、あなたのメモがここに表示されます。「地図で表示」を押すと地図がその天体に合わせて移動します。'],
  'catalog.logs': ['Son tarama kayıtları', 'Recent scan logs', 'Registros de búsquedas recientes', 'Letzte Suchprotokolle', '最近のスキャン履歴'],
  'catalog.show': ['Haritada Göster & İncele', 'Show on Map & Inspect', 'Mostrar en el mapa e inspeccionar', 'Auf Karte zeigen & untersuchen', '地図で表示して調べる'],
  'catalog.changeTitle': ['Değişim & Nedeni', 'Change & Reason', 'Cambio y causa', 'Änderung & Ursache', '変化とその原因'],
  'catalog.noAnalysis': ['İki tarih için ölçüm yok. Önce Değişim Taraması çalıştırın ya da haritada bu cismi inceleyin.', 'No measurement for the two dates. Run a change scan first, or inspect this object on the map.', 'No hay medición para las dos fechas. Ejecute primero una búsqueda de cambios o inspeccione este objeto en el mapa.', 'Keine Messung für die beiden Daten. Führen Sie zuerst eine Änderungssuche aus oder untersuchen Sie das Objekt auf der Karte.', 'この2つの日付の測定がありません。先に変化スキャンを実行するか、地図でこの天体を調べてください。'],
  'catalog.snapshot': ['Kayıt anındaki analiz · {ts}', 'Analysis at the time of saving · {ts}', 'Análisis en el momento de guardar · {ts}', 'Analyse zum Zeitpunkt des Speicherns · {ts}', '保存時点の解析・{ts}'],
  'catalog.delete': ['Kaydı sil', 'Delete entry', 'Eliminar registro', 'Eintrag löschen', '記録を削除'],
  'catalog.confirmDelete': ['{id} kaydı ve notları silinsin mi?', 'Delete entry {id} and its notes?', '¿Eliminar el registro {id} y sus notas?', 'Eintrag {id} und seine Notizen löschen?', '{id} とそのメモを削除しますか？'],

  'live.title': ['Canlı Katalog Doğrulaması', 'Live Catalog Check', 'Verificación en vivo del catálogo', 'Live-Katalogprüfung', 'ライブカタログ照合'],
  'live.check': ['SIMBAD & SkyBoT’ta sorgula', 'Query SIMBAD & SkyBoT', 'Consultar SIMBAD y SkyBoT', 'In SIMBAD & SkyBoT abfragen', 'SIMBADとSkyBoTで照会'],

  'net.pending': ['SIMBAD ve SkyBoT sorgulanıyor…', 'Querying SIMBAD and SkyBoT…', 'Consultando SIMBAD y SkyBoT…', 'SIMBAD und SkyBoT werden abgefragt…', 'SIMBADとSkyBoTに照会中…'],
  'net.nomatch': ['Katalogda Eşleşme Yok - Yeni Keşif Adayı!', 'No Catalog Match - New Discovery Candidate!', '¡Sin coincidencia en el catálogo: candidato a nuevo descubrimiento!', 'Keine Übereinstimmung im Katalog – neuer Entdeckungskandidat!', 'カタログに一致なし – 新発見の候補！'],
  'net.offline': ['Katalogda Eşleşme Yok - Yeni Keşif Adayı! (Çevrimdışı: SIMBAD/SkyBoT’a ulaşılamadı, doğrulama bekliyor)', 'No Catalog Match - New Discovery Candidate! (Offline: SIMBAD/SkyBoT unreachable, verification pending)', '¡Sin coincidencia en el catálogo: candidato a nuevo descubrimiento! (Sin conexión: SIMBAD/SkyBoT inaccesibles, verificación pendiente)', 'Keine Übereinstimmung im Katalog – neuer Entdeckungskandidat! (Offline: SIMBAD/SkyBoT nicht erreichbar, Prüfung ausstehend)', 'カタログに一致なし – 新発見の候補！（オフライン: SIMBAD/SkyBoTに接続できず、確認待ち）'],
  'net.match': ['Katalogda eşleşme var: SIMBAD’de {n} kayıt · en yakını {id} ({sep}″, {otype})', 'Catalog match: {n} SIMBAD record(s) · closest {id} ({sep}″, {otype})', 'Coincidencia en el catálogo: {n} registro(s) en SIMBAD · el más cercano {id} ({sep}″, {otype})', 'Katalogtreffer: {n} SIMBAD-Eintrag/Einträge · nächster {id} ({sep}″, {otype})', 'カタログに一致: SIMBADに{n}件 ・ 最も近いのは {id}（{sep}″、{otype}）'],
  'net.matchSkybot': ['Güneş Sistemi cismi eşleşmesi (SkyBoT): {name}', 'Solar System body match (SkyBoT): {name}', 'Coincidencia con un cuerpo del Sistema Solar (SkyBoT): {name}', 'Treffer bei einem Sonnensystemkörper (SkyBoT): {name}', '太陽系天体と一致（SkyBoT）: {name}'],
  'net.skybotDown': ['SkyBoT şu anda yanıt vermiyor; yalnızca SIMBAD sonucu gösteriliyor.', 'SkyBoT is not responding right now; only the SIMBAD result is shown.', 'SkyBoT no responde ahora; solo se muestra el resultado de SIMBAD.', 'SkyBoT antwortet derzeit nicht; es wird nur das SIMBAD-Ergebnis gezeigt.', 'SkyBoTは現在応答がないため、SIMBADの結果のみ表示しています。'],
  'net.recheck': ['Yeniden sorgula', 'Check again', 'Consultar de nuevo', 'Erneut abfragen', '再照会'],

  'notes.title': ['Notlarım', 'My Notes', 'Mis notas', 'Meine Notizen', '私のメモ'],
  'notes.none': ['Henüz not yok.', 'No notes yet.', 'Aún no hay notas.', 'Noch keine Notizen.', 'まだメモはありません。'],
  'notes.ph': ['Yeni not ekleyin…', 'Add a new note…', 'Añada una nota nueva…', 'Neue Notiz hinzufügen…', '新しいメモを追加…'],
  'notes.add': ['Notu ekle', 'Add note', 'Añadir nota', 'Notiz hinzufügen', 'メモを追加'],

  'v.blank': ['Eğitim: Burada gerçekte hiçbir kaynak yoktu.', 'Training: there was really no source here.', 'Entrenamiento: aquí en realidad no había ninguna fuente.', 'Training: hier gab es in Wahrheit keine Quelle.', 'トレーニング: ここには実際には天体がありませんでした。'],
  'v.static': ['Eğitim: Bu sabit bir cisimdi ({label}); hareketli bir keşif değil.', 'Training: this was a static object ({label}), not a moving discovery.', 'Entrenamiento: era un objeto estático ({label}), no un descubrimiento en movimiento.', 'Training: das war ein ruhendes Objekt ({label}), keine bewegte Entdeckung.', 'トレーニング: これは静止した天体（{label}）で、動く発見ではありません。'],
  'v.ok': ['Eğitim: Doğru! Gerçek tür: {label}.', 'Training: correct! True type: {label}.', 'Entrenamiento: ¡correcto! Tipo real: {label}.', 'Training: richtig! Wahrer Typ: {label}.', 'トレーニング: 正解！ 本当の種類: {label}。'],
  'v.wrongClass': ['Eğitim: Gerçek tür {label} — seçtiğiniz kategori farklı.', 'Training: the true type is {label} — you chose a different category.', 'Entrenamiento: el tipo real es {label}; usted eligió otra categoría.', 'Training: der wahre Typ ist {label} — Sie haben eine andere Kategorie gewählt.', 'トレーニング: 本当の種類は {label} です。選んだカテゴリは異なります。'],

  // ───────── "Neden değişti?" — otomatik bilimsel açıklamalar ─────────
  'why.cause': ['Nedeni:', 'Reason:', 'Causa:', 'Ursache:', '原因:'],
  'why.head.move': ['{eA} → {eB} arasında {d}″ yer değiştirdi (özdevinim ≈ {mu}″/yıl, yön {pa}°).', 'Between {eA} → {eB} it moved {d}″ (proper motion ≈ {mu}″/yr, direction {pa}°).', 'Entre {eA} → {eB} se desplazó {d}″ (movimiento propio ≈ {mu}″/año, dirección {pa}°).', 'Zwischen {eA} → {eB} verschob es sich um {d}″ (Eigenbewegung ≈ {mu}″/Jahr, Richtung {pa}°).', '{eA} → {eB} の間に {d}″ 移動（固有運動 ≈ {mu}″/年、方向 {pa}°）。'],
  'why.head.flux': ['{eA} → {eB}: parlaklık ×{ratio} ({pct}%) değişti — {sig}σ anlamlılıkla.', '{eA} → {eB}: brightness changed ×{ratio} ({pct}%) — at {sig}σ significance.', '{eA} → {eB}: el brillo cambió ×{ratio} ({pct}%), con una significancia de {sig}σ.', '{eA} → {eB}: Helligkeit änderte sich um ×{ratio} ({pct}%) — mit {sig}σ Signifikanz.', '{eA} → {eB}: 明るさが ×{ratio}（{pct}%）変化 — 有意度 {sig}σ。'],
  'why.head.new': ['{eA} → {eB}: önceki tarihte görünmeyen yeni bir kaynak ortaya çıktı ({sig}σ).', '{eA} → {eB}: a new source that was invisible on the earlier date appeared ({sig}σ).', '{eA} → {eB}: apareció una fuente nueva, invisible en la fecha anterior ({sig}σ).', '{eA} → {eB}: eine neue Quelle, die am früheren Datum unsichtbar war, ist aufgetaucht ({sig}σ).', '{eA} → {eB}: 前の日付では見えなかった新しい天体が現れました（{sig}σ）。'],
  'why.head.stable': ['{eA} → {eB}: konumda ve parlaklıkta anlamlı bir değişim yok.', '{eA} → {eB}: no significant change in position or brightness.', '{eA} → {eB}: sin cambio significativo de posición ni de brillo.', '{eA} → {eB}: keine signifikante Änderung von Position oder Helligkeit.', '{eA} → {eB}: 位置にも明るさにも有意な変化はありません。'],
  'why.stable': ['Cisim iki tarih arasında sabit görünüyor. Sıradan bir yıldız ya da galaksiden beklediğimiz gibi; yer değiştirme ve parlaklık farkı ölçüm hatası sınırları içinde.', 'The object looks steady between the two dates, as expected of an ordinary star or galaxy; the shift and brightness difference are within measurement error.', 'El objeto parece estable entre las dos fechas, como cabe esperar de una estrella o galaxia normal; el desplazamiento y la diferencia de brillo están dentro del error de medida.', 'Das Objekt wirkt zwischen den beiden Daten stabil, wie bei einem gewöhnlichen Stern oder einer Galaxie zu erwarten; Verschiebung und Helligkeitsunterschied liegen innerhalb der Messfehler.', '天体は2つの日付の間で安定しているように見えます。通常の恒星や銀河で期待される通りで、移動量と明るさの差は測定誤差の範囲内です。'],
  'why.cite.lead': ['Ölçülen: {list}', 'Measured: {list}', 'Medido: {list}', 'Gemessen: {list}', '測定値: {list}'],
  'why.cite.pct': ['{lam} µm: {pct}% (±{err}%)', '{lam} µm: {pct}% (±{err}%)', '{lam} µm: {pct}% (±{err}%)', '{lam} µm: {pct}% (±{err}%)', '{lam} µm: {pct}%（±{err}%）'],
  'why.cite.new': ['{lam} µm: yeni ortaya çıktı', '{lam} µm: newly appeared', '{lam} µm: apareció de nuevo', '{lam} µm: neu aufgetaucht', '{lam} µm: 新たに出現'],
  'why.cite.sig': ['{lam} µm: {sig}σ', '{lam} µm: {sig}σ', '{lam} µm: {sig}σ', '{lam} µm: {sig}σ', '{lam} µm: {sig}σ'],

  'why.move.ssb': ['Güneş Sistemi cismi (asteroit ya da kuyruklu yıldız). Cisim Güneş çevresindeki yörüngesinde ilerlediği için, neredeyse hiç kımıldamayan fon yıldızlarının önünde iki gözlem arasında yer değiştirmiş görünür. Bu kadar hızlı bir kayma, onun yıldızlardan çok daha yakın, yani Güneş Sistemi’nin içinde olduğunu gösterir.', 'A Solar System body (asteroid or comet). Because it travels along its orbit around the Sun, it appears to shift between the two observations against background stars that hardly move at all. A shift this fast means it is far closer than the stars — inside the Solar System.', 'Un cuerpo del Sistema Solar (asteroide o cometa). Como avanza por su órbita alrededor del Sol, parece desplazarse entre las dos observaciones frente a unas estrellas de fondo que apenas se mueven. Un desplazamiento tan rápido indica que está mucho más cerca que las estrellas: dentro del Sistema Solar.', 'Ein Körper des Sonnensystems (Asteroid oder Komet). Weil er sich auf seiner Bahn um die Sonne bewegt, scheint er sich zwischen den beiden Beobachtungen vor den kaum bewegten Hintergrundsternen zu verschieben. Eine so schnelle Verschiebung heißt, dass er weit näher ist als die Sterne — innerhalb des Sonnensystems.', '太陽系の天体（小惑星または彗星）。太陽のまわりの軌道を進むため、ほとんど動かない背景の星に対して、2回の観測の間に位置がずれて見えます。これほど速いずれは、恒星よりはるかに近い、つまり太陽系の内側にあることを意味します。'],
  'why.move.bd': ['Yakındaki soğuk bir kahverengi cüce. Rengi kızıl ve soğuk olan bu cisim aynı zamanda gökyüzünde belirgin biçimde ilerliyor. Yıldızlararası mesafelerde bu kadar büyük bir özdevinim (fiziksel ≈ {muPhys}″/yıl) ancak Güneş’e çok yakın bir cisimde görülür. Teğetsel hızın 100 km/s’yi aşmadığı varsayılırsa uzaklığı en fazla ≈ {pc} pc (≈ {ly} ışık yılı) olmalıdır.', 'A nearby cold brown dwarf. This red, cold object is also moving noticeably across the sky. Such a large proper motion over interstellar distances (physical ≈ {muPhys}″/yr) is only seen in an object very close to the Sun. Assuming a tangential velocity no larger than 100 km/s, its distance can be at most ≈ {pc} pc (≈ {ly} light-years).', 'Una enana marrón fría cercana. Este objeto rojo y frío también se mueve de forma notable por el cielo. Un movimiento propio tan grande a distancias interestelares (físico ≈ {muPhys}″/año) solo se ve en un objeto muy cercano al Sol. Suponiendo una velocidad tangencial no superior a 100 km/s, su distancia sería como máximo ≈ {pc} pc (≈ {ly} años luz).', 'Ein naher, kalter Brauner Zwerg. Dieses rote, kalte Objekt bewegt sich zudem deutlich über den Himmel. Eine so große Eigenbewegung auf interstellaren Distanzen (physikalisch ≈ {muPhys}″/Jahr) sieht man nur bei einem Objekt in unmittelbarer Sonnennähe. Bei einer Tangentialgeschwindigkeit von höchstens 100 km/s liegt die Entfernung bei höchstens ≈ {pc} pc (≈ {ly} Lichtjahre).', '近くにある低温の褐色矮星。赤くて冷たいこの天体は、空の上でもはっきり動いています。恒星間の距離でこれほど大きな固有運動（物理値 ≈ {muPhys}″/年）が見られるのは、太陽にとても近い天体だけです。接線速度が100 km/sを超えないと仮定すると、距離は最大でも ≈ {pc} pc（≈ {ly} 光年）です。'],
  'why.move.cold': ['Çok soğuk bir cisim. Çok kızıl ve kendi ısısıyla 4–5 µm’de parlayan bu kaynağın kayması, ya Güneş Sistemi’nin dış bölgesindeki bir cisim (Gezegen X benzeri ya da Kuiper kuşağı adayı) ya da çok yakındaki bir Y cücesi olabileceğini gösterir. İkisini ayırmak için paralaks (Dünya’nın yörüngesinden doğan yıllık yalpalama) ve daha uzun bir gözlem yayı gerekir.', 'A very cold body. This very red source, glowing from its own heat at 4–5 µm, shifts in a way that suggests either an outer Solar System object (Planet X-like or a Kuiper Belt candidate) or a very nearby Y dwarf. Telling the two apart needs parallax (the yearly wobble caused by Earth’s orbit) and a longer observing arc.', 'Un cuerpo muy frío. Esta fuente muy roja, que brilla por su propio calor a 4–5 µm, se desplaza de un modo que sugiere un objeto del Sistema Solar exterior (similar a un Planeta X o candidato del cinturón de Kuiper) o bien una enana Y muy cercana. Distinguirlos requiere paralaje (la oscilación anual causada por la órbita terrestre) y un arco de observación más largo.', 'Ein sehr kalter Körper. Diese sehr rote Quelle, die durch Eigenwärme bei 4–5 µm leuchtet, verschiebt sich so, dass entweder ein Objekt im äußeren Sonnensystem (Planet-X-ähnlich oder Kuipergürtel-Kandidat) oder ein sehr naher Y-Zwerg in Frage kommt. Zur Unterscheidung braucht man Parallaxe (die jährliche Schwankung durch die Erdbahn) und einen längeren Beobachtungsbogen.', '非常に低温の天体。4〜5 µmで自らの熱で光る非常に赤いこの天体の移動は、太陽系外縁の天体（惑星X型またはカイパーベルト候補）か、非常に近いY型矮星のどちらかを示唆します。両者を区別するには、年周視差（地球の公転による年ごとの揺れ）と、より長い観測期間が必要です。'],
  'why.move.star': ['Yakın bir yıldızın özdevinimi. Yıldızlar Galaksi’de farklı hızlarla yol alır; Güneş’e yakın olanlar yıllar içinde gökyüzünde fark edilir biçimde kayar. Fiziksel özdevinim ≈ {muPhys}″/yıl; teğetsel hız 100 km/s’yi aşmıyorsa uzaklık en fazla ≈ {pc} pc (≈ {ly} ışık yılı).', 'Proper motion of a nearby star. Stars travel through the Galaxy at different speeds, and those close to the Sun drift visibly across the sky over the years. Physical proper motion ≈ {muPhys}″/yr; if the tangential velocity does not exceed 100 km/s, the distance is at most ≈ {pc} pc (≈ {ly} light-years).', 'Movimiento propio de una estrella cercana. Las estrellas recorren la Galaxia a distintas velocidades y las próximas al Sol se desplazan de forma visible por el cielo con los años. Movimiento propio físico ≈ {muPhys}″/año; si la velocidad tangencial no supera los 100 km/s, la distancia es como máximo ≈ {pc} pc (≈ {ly} años luz).', 'Eigenbewegung eines nahen Sterns. Sterne durchlaufen die Galaxis mit unterschiedlichen Geschwindigkeiten, und sonnennahe wandern im Lauf der Jahre sichtbar über den Himmel. Physikalische Eigenbewegung ≈ {muPhys}″/Jahr; bleibt die Tangentialgeschwindigkeit unter 100 km/s, beträgt die Entfernung höchstens ≈ {pc} pc (≈ {ly} Lichtjahre).', '近くの恒星の固有運動。恒星は銀河の中をそれぞれ違う速さで進み、太陽に近いものは数年のうちに空の上で目に見えて動きます。物理的な固有運動 ≈ {muPhys}″/年。接線速度が100 km/s以下なら、距離は最大でも ≈ {pc} pc（≈ {ly} 光年）です。'],

  'why.spec.comet': ['Kuyruklu yıldız etkinliği. Güneş’e yaklaşan çekirdekte buz süblimleşir (doğrudan buharlaşır) ve çevresinde gaz-toz kütlesi, yani koma oluşur. Su buzu 3.0 µm’de, CO₂ ise 4.26 µm’de belirgin iz bırakır; bu bantlardaki parlaklık değişimi, komanın büyüdüğünü ya da küçüldüğünü gösterir.', 'Comet activity. As the nucleus nears the Sun its ice sublimates (turns directly to gas) and a cloud of gas and dust, the coma, forms around it. Water ice leaves a clear mark at 3.0 µm and CO₂ at 4.26 µm; the brightness change in those bands shows the coma growing or shrinking.', 'Actividad cometaria. Al acercarse al Sol, el hielo del núcleo se sublima (pasa directamente a gas) y se forma a su alrededor una nube de gas y polvo, la coma. El hielo de agua deja una huella clara a 3,0 µm y el CO₂ a 4,26 µm; el cambio de brillo en esas bandas muestra que la coma crece o disminuye.', 'Kometenaktivität. Nähert sich der Kern der Sonne, sublimiert sein Eis (geht direkt in Gas über), und um ihn bildet sich eine Gas-Staub-Wolke, die Koma. Wassereis hinterlässt bei 3,0 µm und CO₂ bei 4,26 µm eine deutliche Spur; die Helligkeitsänderung in diesen Bändern zeigt, dass die Koma wächst oder schrumpft.', '彗星の活動。核が太陽に近づくと氷が昇華（固体から直接気体に）し、そのまわりにガスと塵の雲、つまりコマができます。水氷は3.0 µm、CO₂は4.26 µmにはっきりした痕跡を残し、これらの波長での明るさの変化はコマが大きくなった、または小さくなったことを示します。'],
  'why.spec.icy': ['Buzlu yüzey değişimi. H₂O (3.0 µm) ve CO₂ (4.26 µm) buzları ısınıp süblimleşmiş ya da dönen cisim yüzeyinin farklı bir yanını göstermiş olabilir. Bu; bir kuyruklu yıldız ya da Kuiper kuşağı cisminin ilk uyanma belirtisi olabilir.', 'A change in the icy surface. H₂O (3.0 µm) and CO₂ (4.26 µm) ices may have warmed and sublimated, or the rotating body may be showing a different side of its surface. It could be the first sign of waking up in a comet or a Kuiper Belt object.', 'Un cambio en la superficie helada. Los hielos de H₂O (3,0 µm) y CO₂ (4,26 µm) pueden haberse calentado y sublimado, o el cuerpo, al rotar, puede mostrar otra cara de su superficie. Podría ser la primera señal de actividad de un cometa o de un objeto del cinturón de Kuiper.', 'Eine Änderung der eisigen Oberfläche. Die Eise H₂O (3,0 µm) und CO₂ (4,26 µm) könnten sich erwärmt und sublimiert haben, oder der rotierende Körper zeigt eine andere Seite seiner Oberfläche. Es könnte das erste Anzeichen von Aktivität bei einem Kometen oder Kuipergürtel-Objekt sein.', '氷の表面の変化。H₂O（3.0 µm）やCO₂（4.26 µm）の氷が温まって昇華したか、自転する天体が表面の別の側を見せているのかもしれません。彗星やカイパーベルト天体の活動開始の最初の兆候かもしれません。'],
  'why.spec.asteroid': ['Asteroit parlaklığı değişimi. Düzensiz şekilli ve dönen bir asteroit farklı yüzünü gösterdikçe, ayrıca Güneş–Dünya–cisim geometrisi (faz açısı, uzaklık) değiştikçe hem yansıttığı güneş ışığı hem de kendi ısı salımı (4 µm ötesinde termal ışıma) değişir.', 'Asteroid brightness change. As an irregular, rotating asteroid shows a different face, and as the Sun–Earth–object geometry (phase angle, distance) changes, both the sunlight it reflects and its own heat emission (thermal glow beyond 4 µm) change.', 'Cambio de brillo de un asteroide. A medida que un asteroide irregular y en rotación muestra otra cara, y cambia la geometría Sol–Tierra–objeto (ángulo de fase, distancia), varían tanto la luz solar que refleja como su propia emisión de calor (brillo térmico más allá de 4 µm).', 'Helligkeitsänderung eines Asteroiden. Zeigt ein unregelmäßig geformter, rotierender Asteroid eine andere Seite und ändert sich die Geometrie Sonne–Erde–Objekt (Phasenwinkel, Entfernung), ändern sich sowohl das reflektierte Sonnenlicht als auch seine eigene Wärmeabstrahlung (thermisches Leuchten jenseits von 4 µm).', '小惑星の明るさの変化。不規則な形で自転する小惑星が別の面を見せ、太陽・地球・天体の幾何（位相角や距離）が変わると、反射する太陽光と自らの熱放射（4 µmより長い波長の熱的な光）の両方が変化します。'],
  'why.spec.bd': ['Kahverengi cüce atmosferi. Bulutlar ve metan (CH₄) soğurması (yaklaşık 1.6 ve 3.3 µm) hava olayları gibi zamanla değişir; dönen cüce lekeli bir atmosfere sahipse parlaklığı dalga boyuna bağlı olarak oynar.', 'Brown-dwarf atmosphere. Clouds and methane (CH₄) absorption (near 1.6 and 3.3 µm) change over time like weather; if the rotating dwarf has a patchy atmosphere, its brightness varies with wavelength.', 'Atmósfera de enana marrón. Las nubes y la absorción del metano (CH₄) (cerca de 1,6 y 3,3 µm) cambian con el tiempo como el clima; si la enana en rotación tiene una atmósfera con manchas, su brillo varía según la longitud de onda.', 'Atmosphäre eines Braunen Zwergs. Wolken und die Methanabsorption (CH₄) (bei etwa 1,6 und 3,3 µm) verändern sich wie das Wetter; hat der rotierende Zwerg eine fleckige Atmosphäre, schwankt seine Helligkeit je nach Wellenlänge.', '褐色矮星の大気。雲とメタン（CH₄）の吸収（約1.6 µmと3.3 µm付近）は天気のように時間とともに変わります。自転する矮星の大気にむらがあれば、波長によって明るさが変動します。'],
  'why.spec.sn': ['Süpernova / geçici patlama adayı. Kaynak en az ≈ 6 kat parlamış ya da sönmüş (veya birdenbire ortaya çıkmış) ve rengi sıcak (mavi). Bu, bir yıldızın patlamasının (ör. Ia tipi süpernova) ya da benzeri şiddetli bir geçici olayın tipik izidir.', 'Supernova / transient-explosion candidate. The source brightened or faded by at least ≈ 6× (or suddenly appeared) and its colour is hot (blue). This is the typical signature of an exploding star (e.g. a Type Ia supernova) or a similar violent transient.', 'Candidata a supernova / evento explosivo transitorio. La fuente aumentó o disminuyó su brillo al menos ≈ 6× (o apareció de repente) y su color es caliente (azul). Es la firma típica de una estrella que explota (p. ej., una supernova de tipo Ia) o de un evento transitorio violento similar.', 'Supernova-/Transienten-Kandidat. Die Quelle wurde mindestens ≈ 6× heller oder schwächer (oder tauchte plötzlich auf) und ihre Farbe ist heiß (blau). Das ist die typische Signatur eines explodierenden Sterns (z. B. einer Typ-Ia-Supernova) oder eines ähnlich heftigen Transienten.', '超新星／突発爆発天体の候補。天体が少なくとも約6倍明るくなった・暗くなった（または突然現れた）うえ、色が高温（青）です。爆発する星（例: Ia型超新星）や同様の激しい突発現象に典型的な特徴です。'],
  'why.spec.var': ['Değişen yıldız. Mira gibi evrimleşmiş devler aylar süren periyotlarla şişip büzülür; genç yıldız nesneleri (YSO) ise çevrelerindeki toz diskinden düzensiz biçimde madde çeker. İkisi de kızılötesi parlaklığı kayda değer ölçüde değiştirir.', 'A variable star. Evolved giants such as Mira swell and shrink over periods of months, while young stellar objects (YSOs) pull in material unevenly from the dusty disk around them. Both change their infrared brightness significantly.', 'Una estrella variable. Gigantes evolucionadas como Mira se hinchan y se contraen con periodos de meses, mientras que los objetos estelares jóvenes (YSO) acretan material de forma irregular desde el disco de polvo que los rodea. Ambos cambian mucho su brillo infrarrojo.', 'Ein veränderlicher Stern. Entwickelte Riesen wie Mira blähen sich mit Perioden von Monaten auf und ziehen sich zusammen, während junge stellare Objekte (YSOs) unregelmäßig Material aus der sie umgebenden Staubscheibe aufnehmen. Beide verändern ihre Infrarothelligkeit deutlich.', '変光星。ミラのような進化した巨星は数か月の周期で膨張と収縮を繰り返し、若い星状天体（YSO）は周囲の塵の円盤から不規則に物質を取り込みます。どちらも赤外線の明るさが大きく変化します。'],
  'why.spec.generic': ['Nedeni net değil. Parlaklık ölçülebilir biçimde değişti ancak renk ve spektrum tek bir açıklamayı öne çıkarmıyor. Daha fazla gözlem tarihi ya da daha derin bir spektrum gerekir.', 'The reason is unclear. The brightness changed measurably, but neither the colour nor the spectrum favours a single explanation. More observation dates or a deeper spectrum are needed.', 'La causa no está clara. El brillo cambió de forma medible, pero ni el color ni el espectro favorecen una única explicación. Hacen falta más fechas de observación o un espectro más profundo.', 'Die Ursache ist unklar. Die Helligkeit hat sich messbar verändert, aber weder Farbe noch Spektrum sprechen für eine einzelne Erklärung. Es braucht mehr Beobachtungsdaten oder ein tieferes Spektrum.', '原因は不明です。明るさは測定できる量だけ変化しましたが、色もスペクトルも1つの説明に絞れません。観測日をさらに増やすか、より深いスペクトルが必要です。'],

  // ───────── Katalog ⓘ ipuçları ─────────
  'tip.catalog.search': ['Arama kutusu; isimde, türde, sektörde, notlarınızda, otomatik nedende ve koordinatlarda anında arar. Birden çok sözcük yazarsanız hepsi birlikte aranır. Derece cinsinden “RA Dec” (ör. 83.82 -5.39) yazarsanız o noktanın yakınındaki cisimler de listelenir.', 'The search box looks instantly through names, types, sectors, your notes, the automatic reason and coordinates. If you type several words, all of them must match. Type “RA Dec” in degrees (e.g. 83.82 -5.39) to also list objects near that point.', 'El cuadro de búsqueda busca al instante en nombres, tipos, sectores, sus notas, la causa automática y las coordenadas. Si escribe varias palabras, deben coincidir todas. Escriba «RA Dec» en grados (p. ej., 83.82 -5.39) para listar también los objetos cercanos a ese punto.', 'Das Suchfeld durchsucht sofort Namen, Typen, Sektoren, Ihre Notizen, die automatische Ursache und Koordinaten. Bei mehreren Wörtern müssen alle passen. Geben Sie „RA Dec“ in Grad ein (z. B. 83.82 -5.39), um auch Objekte in der Nähe dieses Punkts aufzulisten.', '検索ボックスは、名前・種類・セクター・あなたのメモ・自動の原因・座標を瞬時に検索します。複数の語を入力すると、すべてに一致するものが対象です。度単位で「RA Dec」（例 83.82 -5.39）を入力すると、その点の近くの天体も表示されます。'],
  'tip.catalog.cats': ['Kayıtları türüne göre süzer. “Yeni Keşiflerim” sizin kaydettiklerinizi, “Bilinen Katalog Cisimleri” ise önceden kayıtlı cisimleri gösterir. Sayılar her kategorideki kayıt adedidir.', 'Filters the entries by type. “My New Discoveries” shows what you saved, and “Known Catalog Objects” shows the pre-registered objects. The numbers are how many entries each category holds.', 'Filtra los registros por tipo. «Mis nuevos descubrimientos» muestra lo que usted guardó y «Objetos conocidos del catálogo» los objetos ya registrados. Los números indican cuántos registros tiene cada categoría.', 'Filtert die Einträge nach Typ. „Meine neuen Entdeckungen“ zeigt, was Sie gespeichert haben, „Bekannte Katalogobjekte“ die vorab erfassten Objekte. Die Zahlen geben an, wie viele Einträge jede Kategorie enthält.', '種類で記録を絞り込みます。「私の新発見」はあなたが保存したもの、「既知のカタログ天体」は登録済みの天体です。数字は各カテゴリの件数です。'],
  'tip.catalog.export': ['Süzülmüş listeyi dosyaya indirir: JSON (programlar için), CSV (Excel/tablo için) ya da VOTable (astronomi yazılımları için). Dosyada koordinat, zaman damgası, değişim nedeni ve notlarınız bulunur.', 'Downloads the filtered list as a file: JSON (for programs), CSV (for Excel/spreadsheets) or VOTable (for astronomy software). The file contains coordinates, timestamp, reason for the change and your notes.', 'Descarga la lista filtrada como archivo: JSON (para programas), CSV (para Excel/hojas de cálculo) o VOTable (para software de astronomía). El archivo incluye coordenadas, marca de tiempo, causa del cambio y sus notas.', 'Lädt die gefilterte Liste als Datei herunter: JSON (für Programme), CSV (für Excel/Tabellen) oder VOTable (für Astronomie-Software). Die Datei enthält Koordinaten, Zeitstempel, Ursache der Änderung und Ihre Notizen.', '絞り込んだ一覧をファイルとしてダウンロードします。JSON（プログラム用）、CSV（Excel／表計算用）、VOTable（天文ソフト用）から選べます。座標・タイムスタンプ・変化の原因・メモが含まれます。'],
  'tip.catalog.status': ['Kayıtlarınız yalnızca bu tarayıcıda (localStorage) saklanır; sunucuya gönderilmez. Tarayıcı verilerini silerseniz kayıtlar da silinir, bu yüzden önemli listeleri dışa aktarın.', 'Your entries are stored only in this browser (localStorage); nothing is sent to a server. If you clear browser data the entries are lost too, so export important lists.', 'Sus registros se guardan solo en este navegador (localStorage); no se envía nada a ningún servidor. Si borra los datos del navegador, también se pierden los registros, así que exporte las listas importantes.', 'Ihre Einträge werden nur in diesem Browser (localStorage) gespeichert; nichts wird an einen Server gesendet. Löschen Sie die Browserdaten, gehen auch die Einträge verloren — exportieren Sie wichtige Listen deshalb.', '記録はこのブラウザ（localStorage）にのみ保存され、サーバーには送信されません。ブラウザのデータを消去すると記録も消えるので、大切な一覧は書き出しておいてください。'],
  'tip.catalog.show': ['Haritaya geçer, sektörü ve iki tarihi ayarlar, görüntüyü bu cisme yakınlaştırır ve seçili hâle getirir; böylece sağ panelde tüm ayrıntılı analizi görürsünüz.', 'Switches to the map, sets the sector and the two dates, zooms in on this object and selects it, so the right panel shows the full detailed analysis.', 'Cambia al mapa, ajusta el sector y las dos fechas, acerca la vista a este objeto y lo selecciona, de modo que el panel derecho muestra todo el análisis detallado.', 'Wechselt zur Karte, stellt Sektor und beide Daten ein, zoomt auf dieses Objekt und wählt es aus, sodass das rechte Panel die gesamte Detailanalyse zeigt.', '地図に切り替え、セクターと2つの日付を設定して、この天体にズームして選択します。右のパネルに詳しい解析がすべて表示されます。'],
  'tip.catalog.change': ['Seçili iki tarih arasında cismin konumunun ve parlaklığının nasıl değiştiğini, ayrıca nedenini sade dille anlatır. Metin ölçümlerden otomatik üretilir.', 'Explains in plain language how the object’s position and brightness changed between the two selected dates, and why. The text is generated automatically from the measurements.', 'Explica en lenguaje sencillo cómo cambiaron la posición y el brillo del objeto entre las dos fechas elegidas, y por qué. El texto se genera automáticamente a partir de las mediciones.', 'Erklärt in einfacher Sprache, wie sich Position und Helligkeit des Objekts zwischen den beiden gewählten Daten verändert haben und warum. Der Text wird automatisch aus den Messungen erzeugt.', '選んだ2つの日付の間に、天体の位置と明るさがどう変わったか、その理由をやさしい言葉で説明します。文章は測定値から自動で作られます。'],
  'tip.catalog.live': ['Cismin koordinatını gerçek astronomi veri tabanlarında sorgular: SIMBAD (yıldızlar, galaksiler) ve SkyBoT (asteroit/kuyruklu yıldızlar). Eşleşme yoksa “Yeni Keşif Adayı” görürsünüz. İnternet yoksa doğrulama beklemede kalır.', 'Looks up the object’s coordinates in real astronomy databases: SIMBAD (stars, galaxies) and SkyBoT (asteroids/comets). If nothing matches you see “New Discovery Candidate”. Without an internet connection the check stays pending.', 'Consulta las coordenadas del objeto en bases de datos astronómicas reales: SIMBAD (estrellas, galaxias) y SkyBoT (asteroides/cometas). Si no hay coincidencia verá «Candidato a nuevo descubrimiento». Sin conexión a internet la comprobación queda pendiente.', 'Fragt die Koordinaten des Objekts in echten astronomischen Datenbanken ab: SIMBAD (Sterne, Galaxien) und SkyBoT (Asteroiden/Kometen). Gibt es keinen Treffer, sehen Sie „Neuer Entdeckungskandidat“. Ohne Internet bleibt die Prüfung ausstehend.', '天体の座標を実際の天文データベース、SIMBAD（恒星・銀河）とSkyBoT（小惑星・彗星）で照会します。一致がなければ「新発見の候補」と表示されます。インターネットに接続できないと、確認は保留のままです。'],
  'tip.notes': ['Bu cisim hakkında kendi gözlemlerinizi yazın. Her not zaman damgasıyla saklanır, aramada bulunur ve dışa aktarılan dosyaya eklenir.', 'Write your own observations about this object. Each note is stored with a timestamp, is found by the search and is added to the exported file.', 'Escriba sus propias observaciones sobre este objeto. Cada nota se guarda con marca de tiempo, aparece en la búsqueda y se añade al archivo exportado.', 'Schreiben Sie eigene Beobachtungen zu diesem Objekt. Jede Notiz wird mit Zeitstempel gespeichert, ist über die Suche auffindbar und wird in die exportierte Datei aufgenommen.', 'この天体について自分の観察を書き込みます。各メモはタイムスタンプ付きで保存され、検索でも見つかり、書き出すファイルにも含まれます。'],

  // ───────── Hakkında penceresi ─────────
  'about.title': ['NYXE Hakkında', 'About NYXE', 'Acerca de NYXE', 'Über NYXE', 'NYXEについて'],
  'about.p1': ['Bu araç, NASA’nın SPHEREx görevinin (102 renkli, 0.75–5.0 µm kızılötesi tüm gökyüzü taraması) verilerine benzeyen bir gökyüzü sunar. “Simülasyon” kaynağında gökyüzü SENTETİKTİR ve gizli keşif hedefleri içerir; “Gerçek veri” kaynağında cisimler SIMBAD ve SkyBoT’tan gelen gerçek kayıtlardır, ancak 102 bantlı görüntü ve spektrumlar bir MODELdir. İkisi de gerçek SPHEREx ölçümü değildir (ölçüm için “Gerçek SPHEREx Verisi” sekmesine bakın); amaç, zaman alanı astronomisini ve vatandaş bilimi yöntemlerini öğretmektir.', 'This tool presents a sky that resembles the data of NASA’s SPHEREx mission (a 102-colour, 0.75–5.0 µm infrared all-sky survey). With the “Simulation” source the sky is SYNTHETIC and holds hidden discovery targets; with the “Real data” source the objects are real records from SIMBAD and SkyBoT, but the 102-band image and spectra are a MODEL. Neither is a real SPHEREx measurement (for that, see the “Real SPHEREx Data” tab); the goal is to teach time-domain astronomy and citizen-science methods.', 'Esta herramienta presenta un cielo parecido a los datos de la misión SPHEREx de la NASA (un sondeo infrarrojo de todo el cielo en 102 colores, 0,75–5,0 µm). Con la fuente «Simulación» el cielo es SINTÉTICO y contiene objetivos ocultos por descubrir; con la fuente «Datos reales» los objetos son registros reales de SIMBAD y SkyBoT, pero la imagen y los espectros de 102 bandas son un MODELO. Ninguno es una medición real de SPHEREx (para eso, vea la pestaña «Datos reales de SPHEREx»); el objetivo es enseñar astronomía del dominio temporal y métodos de ciencia ciudadana.', 'Dieses Werkzeug zeigt einen Himmel, der den Daten der NASA-Mission SPHEREx ähnelt (eine Infrarot-Himmelsdurchmusterung in 102 Farben, 0,75–5,0 µm). Mit der Quelle „Simulation“ ist der Himmel SYNTHETISCH und enthält versteckte Entdeckungsziele; mit der Quelle „Echtdaten“ sind die Objekte echte Einträge aus SIMBAD und SkyBoT, doch Bild und 102-Band-Spektren sind ein MODELL. Beides ist keine echte SPHEREx-Messung (dafür siehe den Tab „Echte SPHEREx-Daten“); Ziel ist es, Zeitbereichsastronomie und Bürgerwissenschaft zu vermitteln.', 'このツールは、NASAのSPHEREx計画（102色、0.75〜5.0 µmの赤外線全天サーベイ）のデータに似た空を提供します。「シミュレーション」では空は「合成」で、隠れた発見ターゲットを含みます。「実データ」では天体はSIMBADとSkyBoTの実在のレコードですが、102バンドの画像とスペクトルはモデルです。どちらも実際のSPHEREx測定ではありません（測定は「SPHEREx実データ」タブを参照）。目的は、時間領域天文学と市民科学の方法を学ぶことです。'],
  'about.p2': ['Nasıl kullanılır: soldan iki tarih seçin, “Değişimleri Otomatik Tara”ya basın, listeden ya da haritadan bir cisme tıklayın ve sağ panelde ne olduğunu ve neden değiştiğini okuyun. İlginç bulduklarınızı Katalog sekmesine kaydedip not ekleyebilirsiniz.', 'How to use it: pick two dates on the left, press “Scan for Changes”, click an object in the list or on the map, and read on the right what it is and why it changed. Save the interesting ones to the Catalog tab and add notes.', 'Cómo usarla: elija dos fechas a la izquierda, pulse «Buscar cambios automáticamente», haga clic en un objeto de la lista o del mapa y lea a la derecha qué es y por qué cambió. Guarde los más interesantes en la pestaña Catálogo y añada notas.', 'So geht’s: Wählen Sie links zwei Daten, drücken Sie „Änderungen automatisch suchen“, klicken Sie ein Objekt in der Liste oder auf der Karte an und lesen Sie rechts, was es ist und warum es sich verändert hat. Interessante Funde speichern Sie im Reiter Katalog und ergänzen Notizen.', '使い方: 左で2つの日付を選び、「変化を自動スキャン」を押し、一覧または地図の天体をクリックして、右のパネルでそれが何か、なぜ変化したのかを読みます。気になるものはカタログのタブに保存してメモを追加できます。'],
  'about.p3': ['Simülasyonda hareketler öğretici amaçla büyütülmüştür (ayarlardaki “hareket çarpanı”); gerçek veride çarpan ×1’dir ve 1,5 yıllık kayma çoğu yıldız için çok küçüktür. Panel, ölçülen değeri çarpana bölerek fiziksel tahmini de gösterir.', 'In the simulation, motions are exaggerated for teaching (the “motion gain” in the settings); with real data the factor is ×1 and the shift over 1.5 years is tiny for most stars. The panel also shows the physical estimate obtained by dividing the measured value by the gain.', 'En la simulación los movimientos están exagerados con fines didácticos (el «factor de movimiento» en los ajustes); con datos reales el factor es ×1 y el desplazamiento en 1,5 años es minúsculo para la mayoría de las estrellas. El panel muestra además la estimación física obtenida al dividir el valor medido entre el factor.', 'In der Simulation sind die Bewegungen zu Lehrzwecken übertrieben (der „Bewegungsfaktor“ in den Einstellungen); bei Echtdaten ist der Faktor ×1, und die Verschiebung in 1,5 Jahren ist für die meisten Sterne winzig. Das Panel zeigt zusätzlich die physikalische Schätzung, die sich ergibt, wenn man den Messwert durch den Faktor teilt.', 'シミュレーションでは動きが教育目的で誇張されます（設定の「動きの倍率」）。実データでは倍率は×1で、1.5年間の移動はほとんどの恒星でごくわずかです。パネルには、測定値を倍率で割った物理的な推定値も表示されます。'],
  'about.p4': ['Katalog sorguları (SIMBAD, SkyBoT) isteğe bağlıdır ve internet bağlantısı gerektirir; bağlantı yoksa uygulama çalışmaya devam eder ve doğrulama beklemede kalır. Kayıtlarınız yalnızca bu tarayıcıda saklanır.', 'Catalog queries (SIMBAD, SkyBoT) are optional and need an internet connection; without one the app keeps working and the check stays pending. Your entries are stored only in this browser.', 'Las consultas a catálogos (SIMBAD, SkyBoT) son opcionales y requieren conexión a internet; sin ella la aplicación sigue funcionando y la comprobación queda pendiente. Sus registros se guardan solo en este navegador.', 'Katalogabfragen (SIMBAD, SkyBoT) sind optional und benötigen eine Internetverbindung; ohne sie läuft die App weiter und die Prüfung bleibt ausstehend. Ihre Einträge werden nur in diesem Browser gespeichert.', 'カタログ照会（SIMBAD、SkyBoT）は任意で、インターネット接続が必要です。接続がなくてもアプリは動作し、確認は保留のままになります。記録はこのブラウザにのみ保存されます。'],
  'about.p5': ['Eğitim modunu açarsanız bir keşfi kaydettiğinizde cismin gerçekte ne olduğu da gösterilir. Gerçek bir keşif iddiası için sonuçlar mutlaka profesyonel kataloglarla ve gözlemevleriyle doğrulanmalıdır.', 'If you turn on training mode, saving a discovery also reveals what the object really was. For any real discovery claim, results must always be verified against professional catalogs and observatories.', 'Si activa el modo de entrenamiento, al guardar un descubrimiento también se muestra lo que era realmente el objeto. Para cualquier afirmación de descubrimiento real, los resultados deben verificarse siempre con catálogos profesionales y observatorios.', 'Wenn Sie den Trainingsmodus einschalten, wird beim Speichern einer Entdeckung auch gezeigt, was das Objekt wirklich war. Für jede echte Entdeckungsbehauptung müssen die Ergebnisse stets mit professionellen Katalogen und Sternwarten überprüft werden.', 'トレーニングモードをオンにすると、発見を保存したときに天体の本当の正体も表示されます。実際の発見を主張する場合は、必ずプロのカタログや観測所で結果を確認してください。'],
  // ───────── Alt bilgi · telif ─────────
  'footer.credit': ['Hazırlayan: Elif Turut · © {year} Elif Turut · Tüm hakları saklıdır.', 'Made by Elif Turut · © {year} Elif Turut · All rights reserved.', 'Creado por Elif Turut · © {year} Elif Turut · Todos los derechos reservados.', 'Erstellt von Elif Turut · © {year} Elif Turut · Alle Rechte vorbehalten.', '制作: Elif Turut ・ © {year} Elif Turut ・ 無断転載を禁じます。'],

  // ───────── Gerçek SPHEREx verisi · sekme, rozetler, hedef, getirme ─────────
  'tab.real': ['Gerçek SPHEREx Verisi', 'Real SPHEREx Data', 'Datos reales de SPHEREx', 'Echte SPHEREx-Daten', 'SPHEREx実データ'],
  'tab.realShort': ['Gerçek Veri', 'Real data', 'Datos reales', 'Echtdaten', '実データ'],
  'tab.mapShort': ['Harita', 'Map', 'Mapa', 'Karte', 'マップ'],
  'badge.real': ['GERÇEK VERİ · IRSA', 'REAL DATA · IRSA', 'DATOS REALES · IRSA', 'ECHTE DATEN · IRSA', '実データ · IRSA'],
  'real.badge': ['Gerçek SPHEREx Seviye-2', 'Real SPHEREx Level-2', 'SPHEREx nivel 2 real', 'Echte SPHEREx-Stufe 2', '実SPHEREx レベル2'],
  'about.real': [
    '“Gerçek SPHEREx Verisi” sekmesi, NASA/IPAC IRSA arşivinden canlı indirilen GERÇEK SPHEREx Seviye-2 görüntülerini kullanır: konum, parlaklık (µJy) ve dalga boyu doğrudan FITS dosyalarından okunur. “Keşif Haritası” sekmesi varsayılan olarak GERÇEK katalog verisiyle çalışır: konumlar ve özdevinimler (SIMBAD) ile Güneş Sistemi cisimlerinin efemerisi (SkyBoT) gerçektir; 102 bantlı görüntü ve spektrumlar ise katalog parlaklığından hesaplanan bir MODELdir. İsterseniz kaynak rozetinden eğitim amaçlı SENTETİK simülasyona geçebilirsiniz. Canlı veri için tarayıcınızın IRSA ve CDS’e erişebilmesi gerekir; erişemezse uygulama bunu açıkça söyler ve simülasyona ya da kendi FITS dosyanıza geçer.',
    'The “Real SPHEREx Data” tab uses REAL SPHEREx Level-2 images downloaded live from the NASA/IPAC IRSA archive: position, brightness (µJy) and wavelength are read straight from the FITS files. The “Sky Explorer” tab works with REAL catalogue data by default: positions and proper motions (SIMBAD) and Solar System ephemerides (SkyBoT) are real, while the 102-band image and spectra are a MODEL computed from catalogue brightness. If you like, switch to the SYNTHETIC training simulation from the source badge. Live data needs your browser to reach IRSA and CDS; if it cannot, the app says so plainly and falls back to the simulation or to your own FITS file.',
    'La pestaña «Datos reales de SPHEREx» usa imágenes REALES de nivel 2 de SPHEREx descargadas en directo del archivo NASA/IPAC IRSA: posición, brillo (µJy) y longitud de onda se leen directamente de los archivos FITS. La pestaña «Mapa de exploración» funciona por defecto con datos REALES de catálogo: las posiciones y los movimientos propios (SIMBAD) y las efemérides del Sistema Solar (SkyBoT) son reales, mientras que la imagen y los espectros de 102 bandas son un MODELO calculado a partir del brillo del catálogo. Si lo desea, cambie a la simulación SINTÉTICA de entrenamiento desde la insignia de fuente. Los datos en directo requieren que su navegador llegue a IRSA y CDS; si no puede, la aplicación lo indica y pasa a la simulación o a su propio archivo FITS.',
    'Der Tab „Echte SPHEREx-Daten“ nutzt ECHTE SPHEREx-Level-2-Bilder, die live aus dem NASA/IPAC-IRSA-Archiv geladen werden: Position, Helligkeit (µJy) und Wellenlänge werden direkt aus den FITS-Dateien gelesen. Der Tab „Entdeckerkarte“ arbeitet standardmäßig mit ECHTEN Katalogdaten: Positionen und Eigenbewegungen (SIMBAD) sowie Sonnensystem-Ephemeriden (SkyBoT) sind echt, Bild und 102-Band-Spektren sind dagegen ein aus der Katalog-Helligkeit berechnetes MODELL. Wenn Sie möchten, wechseln Sie über das Quellen-Abzeichen zur SYNTHETISCHEN Trainingssimulation. Für Live-Daten muss Ihr Browser IRSA und CDS erreichen; falls nicht, sagt die App das deutlich und wechselt zur Simulation oder zu Ihrer eigenen FITS-Datei.',
    '「SPHEREx実データ」タブは、NASA/IPAC IRSAアーカイブからライブで取得した実際のSPHERExレベル2画像を使います。位置・明るさ（µJy）・波長はFITSファイルから直接読み取ります。「探索マップ」タブは既定で実際のカタログデータを使います。位置と固有運動（SIMBAD）および太陽系天体の暦（SkyBoT）は実際の値で、102バンドの画像とスペクトルはカタログの明るさから計算したモデルです。必要に応じて、ソースバッジから学習用の合成シミュレーションに切り替えられます。ライブデータにはブラウザからIRSAとCDSに接続できる必要があり、できない場合はその旨を表示し、シミュレーションまたはご自身のFITSファイルに切り替えます。',
  ],

  'real.target.title': ['Hedefi seç', 'Choose a target', 'Elija un objetivo', 'Ziel wählen', 'ターゲットを選ぶ'],
  'real.target.apply': ['Bu koordinatı kullan', 'Use these coordinates', 'Usar estas coordenadas', 'Diese Koordinaten verwenden', 'この座標を使う'],
  'real.target.hint': [
    'Hazır bir hedef seçin, adla arayın ya da koordinat girin. Özdevinim (mas/yıl), hedefin yıllar içindeki yerini önceden hesaplamak içindir.',
    'Pick a preset, search by name or type coordinates. Proper motion (mas/yr) lets the app predict where the target is at each observation date.',
    'Elija un objetivo predefinido, busque por nombre o escriba coordenadas. El movimiento propio (mas/año) permite predecir dónde está el objetivo en cada fecha.',
    'Wählen Sie ein Ziel, suchen Sie nach Namen oder geben Sie Koordinaten ein. Die Eigenbewegung (mas/Jahr) erlaubt, die Position zu jedem Beobachtungsdatum vorherzusagen.',
    'プリセットを選ぶか、名前で検索、または座標を入力します。固有運動（mas/年）は観測日ごとの位置を予測するために使います。',
  ],
  'real.target.manualToggle': ['Adla ara / koordinat gir', 'Search by name / enter coordinates', 'Buscar por nombre / escribir coordenadas', 'Nach Namen suchen / Koordinaten eingeben', '名前で検索／座標を入力'],
  'real.target.manual': ['Elle girilen hedef', 'Manual target', 'Objetivo manual', 'Manuelles Ziel', '手入力のターゲット'],
  'real.target.bad': ['Koordinat ya da özdevinim değeri anlaşılamadı.', 'Could not read the coordinates or proper motion.', 'No se pudieron leer las coordenadas o el movimiento propio.', 'Koordinaten oder Eigenbewegung konnten nicht gelesen werden.', '座標または固有運動を読み取れませんでした。'],
  'real.target.resolved': ['“{name}” bulundu · özdevinim {pm}″/yıl (SIMBAD).', '“{name}” found · proper motion {pm}″/yr (SIMBAD).', '«{name}» encontrado · movimiento propio {pm}″/año (SIMBAD).', '„{name}“ gefunden · Eigenbewegung {pm}″/Jahr (SIMBAD).', '「{name}」が見つかりました · 固有運動 {pm}″/年（SIMBAD）。'],
  'real.target.resolvedNoPm': [
    '“{name}” bulundu; SIMBAD’a ulaşılamadığı için özdevinim 0 varsayıldı.',
    '“{name}” found; SIMBAD was unreachable, so proper motion is assumed to be 0.',
    '«{name}» encontrado; SIMBAD no respondió, así que se asume movimiento propio 0.',
    '„{name}“ gefunden; SIMBAD war nicht erreichbar, daher wird die Eigenbewegung als 0 angenommen.',
    '「{name}」が見つかりました。SIMBADに接続できなかったため固有運動は0と仮定します。',
  ],
  'real.fetch.title': ['Gerçek veriyi getir', 'Fetch real data', 'Obtener datos reales', 'Echtdaten abrufen', '実データを取得'],
  'real.fetch.btn': ['IRSA’dan Gerçek SPHEREx Verisini Getir', 'Fetch Real SPHEREx Data from IRSA', 'Obtener datos reales de SPHEREx desde IRSA', 'Echte SPHEREx-Daten von IRSA abrufen', 'IRSAからSPHEREx実データを取得'],
  'real.fetch.busy': ['Getiriliyor…', 'Fetching…', 'Obteniendo…', 'Wird abgerufen…', '取得中…'],
  'real.fetch.cancel': ['İptal', 'Cancel', 'Cancelar', 'Abbrechen', 'キャンセル'],
  'real.fetch.querying': ['IRSA arşivi sorgulanıyor…', 'Querying the IRSA archive…', 'Consultando el archivo IRSA…', 'IRSA-Archiv wird abgefragt…', 'IRSAアーカイブを検索中…'],
  'real.fetch.downloading': ['Kesitler iniyor: {done}/{total} · {mb} MB', 'Downloading cutouts: {done}/{total} · {mb} MB', 'Descargando recortes: {done}/{total} · {mb} MB', 'Ausschnitte werden geladen: {done}/{total} · {mb} MB', 'カットアウトを取得中: {done}/{total} · {mb} MB'],
  'real.fetch.plan': [
    'Arşivde bu noktayı kapsayan {total} pozlama var; zamana yayılmış {planned} tanesi indirildi ({size}′ kesit).',
    'The archive has {total} exposures covering this point; {planned} spread over time were downloaded ({size}′ cutouts).',
    'El archivo tiene {total} exposiciones que cubren este punto; se descargaron {planned} repartidas en el tiempo (recortes de {size}′).',
    'Das Archiv enthält {total} Belichtungen dieses Punktes; {planned} zeitlich verteilte wurden geladen ({size}′-Ausschnitte).',
    'この位置を含む露出がアーカイブに{total}件あり、時間的に分散した{planned}件を取得しました（{size}′のカットアウト）。',
  ],
  'real.fetch.fails': ['{n} kesit indirilemedi. İlk neden: {why}', '{n} cutout(s) could not be downloaded. First reason: {why}', 'No se pudieron descargar {n} recorte(s). Primera causa: {why}', '{n} Ausschnitt(e) konnten nicht geladen werden. Erste Ursache: {why}', '{n}件のカットアウトを取得できませんでした。最初の原因: {why}'],
  'real.net.ok': ['IRSA’ya ulaşılıyor', 'IRSA reachable', 'IRSA accesible', 'IRSA erreichbar', 'IRSAに接続可能'],
  'real.net.fail': ['IRSA’ya ulaşılamıyor', 'IRSA unreachable', 'IRSA inaccesible', 'IRSA nicht erreichbar', 'IRSAに接続できません'],
  'real.net.warn': ['IRSA hata döndürdü', 'IRSA returned an error', 'IRSA devolvió un error', 'IRSA meldete einen Fehler', 'IRSAがエラーを返しました'],
  'real.net.checking': ['Bağlantı sınanıyor…', 'Testing connection…', 'Probando la conexión…', 'Verbindung wird getestet…', '接続を確認中…'],
  'real.net.unknown': ['Bağlantı sınanmadı', 'Not tested yet', 'Aún sin probar', 'Noch nicht getestet', '未確認'],
  'real.net.retest': ['Yeniden sına', 'Test again', 'Probar de nuevo', 'Erneut testen', '再確認'],
  'real.file.btn': ['FITS dosyası yükle', 'Load FITS file(s)', 'Cargar archivo(s) FITS', 'FITS-Datei(en) laden', 'FITSファイルを読み込む'],
  'real.file.center': ['FITS merkezi', 'FITS centre', 'Centro del FITS', 'FITS-Mitte', 'FITSの中心'],
  'real.file.useCenter': [
    'Yüklenen dosyalar hedefi kapsamıyor → dosyanın merkezini hedef yap',
    'The loaded files do not cover the target → use the file centre as target',
    'Los archivos cargados no cubren el objetivo → usar el centro del archivo',
    'Die geladenen Dateien decken das Ziel nicht ab → Dateimitte als Ziel verwenden',
    '読み込んだファイルはターゲットを含みません → ファイルの中心をターゲットにする',
  ],
  'real.set.title': ['Gelişmiş ayarlar', 'Advanced settings', 'Ajustes avanzados', 'Erweiterte Einstellungen', '詳細設定'],
  'real.set.perDet': ['Dedektör başına pozlama', 'Exposures per detector', 'Exposiciones por detector', 'Belichtungen pro Detektor', '検出器あたりの露出数'],
  'real.set.size': ['Kesit boyutu', 'Cutout size', 'Tamaño del recorte', 'Ausschnittgröße', 'カットアウトのサイズ'],
  'real.set.rAp': ['Fotometri açıklığı', 'Photometry aperture', 'Apertura fotométrica', 'Photometrie-Apertur', '測光アパーチャ'],
  'real.set.stretch': ['Parlaklık / kontrast', 'Brightness / contrast', 'Brillo / contraste', 'Helligkeit / Kontrast', '明るさ／コントラスト'],
  'real.set.thr': ['Fark eşiği', 'Difference threshold', 'Umbral de diferencia', 'Differenzschwelle', '差分のしきい値'],
  'real.set.mask': ['Kötü piksel bayraklarını uygula', 'Apply bad-pixel flags', 'Aplicar indicadores de píxeles malos', 'Fehlerhafte-Pixel-Flags anwenden', '不良ピクセルフラグを適用'],
  'real.set.base': ['IRSA adresi', 'IRSA address', 'Dirección de IRSA', 'IRSA-Adresse', 'IRSAのアドレス'],
  'real.set.reset': ['Sıfırla', 'Reset', 'Restablecer', 'Zurücksetzen', 'リセット'],
  'real.pair.title': ['Karşılaştırılacak iki pozlama', 'Two exposures to compare', 'Dos exposiciones a comparar', 'Zwei Belichtungen vergleichen', '比較する2つの露出'],
  'real.pair.auto': ['Otomatik çift seç (aynı dedektör, benzer λ)', 'Auto-pick a pair (same detector, similar λ)', 'Elegir par automático (mismo detector, λ similar)', 'Paar automatisch wählen (gleicher Detektor, ähnliche λ)', 'ペアを自動選択（同じ検出器・近い波長）'],
  'real.pair.none': [
    'Aynı dedektörde, benzer dalga boyunda ve farklı tarihte iki pozlama yok. Özdevinim ölçümü yine de çalışır; fark görüntüsü yalnızca yaklaşık olur.',
    'There are no two exposures on the same detector, at a similar wavelength and on different dates. The proper-motion fit still works; the difference image is only approximate.',
    'No hay dos exposiciones del mismo detector, con λ similar y en fechas distintas. El ajuste del movimiento propio funciona igualmente; la imagen de diferencia es solo aproximada.',
    'Es gibt keine zwei Belichtungen desselben Detektors mit ähnlicher Wellenlänge an verschiedenen Tagen. Der Eigenbewegungs-Fit funktioniert trotzdem; das Differenzbild ist nur näherungsweise.',
    '同じ検出器・近い波長・異なる日付の露出ペアがありません。固有運動の測定は可能ですが、差分画像は近似になります。',
  ],

  // ───────── Orta panel ─────────
  'real.mode.single.n': ['Tek pozlama', 'Single exposure', 'Exposición única', 'Einzelbelichtung', '単一露出'],
  'real.mode.single.s': ['gerçek görüntü', 'real image', 'imagen real', 'echtes Bild', '実画像'],
  'real.mode.blink.n': ['Blink', 'Blink', 'Parpadeo', 'Blinken', 'ブリンク'],
  'real.mode.blink.s': ['A ↔ B yanıp söner', 'flip A ↔ B', 'alterna A ↔ B', 'A ↔ B wechseln', 'A↔Bを切替'],
  'real.mode.diff.n': ['Fark', 'Difference', 'Diferencia', 'Differenz', '差分'],
  'real.mode.diff.s': ['|B − A| kalıntısı', '|B − A| residual', 'residuo |B − A|', '|B − A|-Residuum', '|B − A| 残差'],
  'real.mode.rgb.n': ['Renk', 'Colour', 'Color', 'Farbe', 'カラー'],
  'real.mode.rgb.s': ['λ → R/G/B', 'λ → R/G/B', 'λ → R/G/B', 'λ → R/G/B', 'λ → R/G/B'],
  'real.canvas.aria': ['Gerçek SPHEREx görüntüsü', 'Real SPHEREx image', 'Imagen real de SPHEREx', 'Echtes SPHEREx-Bild', 'SPHEREx実画像'],
  'real.empty.title': ['Henüz gerçek veri yok', 'No real data yet', 'Aún no hay datos reales', 'Noch keine Echtdaten', 'まだ実データがありません'],
  'real.empty.body': [
    'Kontroller panelinden bir hedef seçip “IRSA’dan Gerçek SPHEREx Verisini Getir”e basın. Hedefin çevresi gerçek SPHEREx pozlamalarından kesilir; görüntü, parlaklık ve spektrum buradan ölçülür.',
    'Pick a target in the Controls panel and press “Fetch Real SPHEREx Data from IRSA”. Cutouts around the target are taken from real SPHEREx exposures; the image, brightness and spectrum are measured from them.',
    'Elija un objetivo en el panel de controles y pulse «Obtener datos reales de SPHEREx desde IRSA». Se recortan zonas alrededor del objetivo de exposiciones reales de SPHEREx; de ellas se miden la imagen, el brillo y el espectro.',
    'Wählen Sie in der Steuerung ein Ziel und drücken Sie „Echte SPHEREx-Daten von IRSA abrufen“. Ausschnitte um das Ziel stammen aus echten SPHEREx-Belichtungen; Bild, Helligkeit und Spektrum werden daraus gemessen.',
    'コントロールパネルでターゲットを選び、「IRSAからSPHEREx実データを取得」を押してください。ターゲット周辺が実際のSPHEREx露出から切り出され、画像・明るさ・スペクトルがそこから測定されます。',
  ],
  'real.rgb.need': ['Renk için en az 3 pozlama gerekir.', 'Colour needs at least 3 exposures.', 'El color requiere al menos 3 exposiciones.', 'Für Farbe sind mindestens 3 Belichtungen nötig.', 'カラーには3つ以上の露出が必要です。'],
  'real.diff.need': ['Fark için iki farklı pozlama (A ≠ B) seçin.', 'Choose two different exposures (A ≠ B) for the difference.', 'Elija dos exposiciones distintas (A ≠ B) para la diferencia.', 'Wählen Sie für die Differenz zwei verschiedene Belichtungen (A ≠ B).', '差分には異なる2つの露出（A ≠ B）を選んでください。'],
  'real.warn.lam': [
    'Seçilen iki pozlama farklı dedektör/dalga boyunda ({a} ve {b} µm). Yıldızların rengi farklı olduğundan fark görüntüsü yalnızca yaklaşık bir ipucudur.',
    'The two chosen exposures are on different detectors/wavelengths ({a} and {b} µm). Because stars differ in colour, the difference image is only an approximate hint.',
    'Las dos exposiciones elegidas son de distinto detector/longitud de onda ({a} y {b} µm). Como las estrellas difieren en color, la imagen de diferencia es solo una pista aproximada.',
    'Die beiden gewählten Belichtungen liegen auf verschiedenen Detektoren/Wellenlängen ({a} und {b} µm). Da Sterne unterschiedliche Farben haben, ist das Differenzbild nur ein ungefährer Hinweis.',
    '選んだ2つの露出は検出器／波長が異なります（{a} µm と {b} µm）。星の色が違うため、差分画像はおおよその目安にすぎません。',
  ],
  'real.chip.exps': ['{n} pozlama', '{n} exposures', '{n} exposiciones', '{n} Belichtungen', '露出{n}件'],
  'real.chip.file': ['Yerel dosya', 'Local file', 'Archivo local', 'Lokale Datei', 'ローカルファイル'],
  'real.strip.title': ['Pozlamalar (zaman sırasıyla)', 'Exposures (in time order)', 'Exposiciones (en orden temporal)', 'Belichtungen (zeitlich geordnet)', '露出（時間順）'],
  'real.strip.none': ['Henüz pozlama yok.', 'No exposures yet.', 'Aún no hay exposiciones.', 'Noch keine Belichtungen.', 'まだ露出がありません。'],

  // ───────── Sağ panel ─────────
  'real.right.title': ['Analiz burada görünecek', 'The analysis will appear here', 'El análisis aparecerá aquí', 'Die Analyse erscheint hier', 'ここに解析結果が表示されます'],
  'real.right.body': [
    'Gerçek veriyi getirdiğinizde burada şunlar açıklanır: hedef hareket ediyor mu, parlaklığı değişti mi, spektrumu neye benziyor — hepsi gerçek ölçümlerle.',
    'Once real data is loaded you will see here whether the target moves, whether its brightness changed and what its spectrum looks like — all from real measurements.',
    'Cuando se carguen los datos reales verá aquí si el objetivo se mueve, si cambió su brillo y cómo es su espectro, todo con mediciones reales.',
    'Sobald Echtdaten geladen sind, sehen Sie hier, ob sich das Ziel bewegt, ob sich seine Helligkeit änderte und wie sein Spektrum aussieht – alles aus echten Messungen.',
    '実データを取得すると、ターゲットが動いているか、明るさが変わったか、スペクトルがどうなっているかが、実測値でここに説明されます。',
  ],
  'real.result.title': ['Sonuç', 'Result', 'Resultado', 'Ergebnis', '結果'],
  'real.verdict.pm-confirmed': ['Özdevinim gerçek veride doğrulandı', 'Proper motion confirmed in real data', 'Movimiento propio confirmado en datos reales', 'Eigenbewegung in Echtdaten bestätigt', '実データで固有運動を確認'],
  'real.verdict.pm-differs': ['Hareket ölçüldü ama katalogdan farklı', 'Motion measured but differs from the catalogue', 'Movimiento medido pero distinto del catálogo', 'Bewegung gemessen, weicht aber vom Katalog ab', '動きを測定、ただしカタログと異なる'],
  'real.verdict.moving-unexpected': ['Katalogda olmayan anlamlı hareket!', 'Significant motion not in the catalogue!', '¡Movimiento significativo ausente del catálogo!', 'Deutliche Bewegung, die nicht im Katalog steht!', 'カタログにない有意な動き！'],
  'real.verdict.static': ['Konum sabit', 'Position is stable', 'Posición estable', 'Position stabil', '位置は安定'],
  'real.verdict.single': ['Tek tespit — hareket ölçülemez', 'Single detection — motion cannot be measured', 'Una sola detección: no se puede medir el movimiento', 'Einzelne Detektion – Bewegung nicht messbar', '検出が1回のみ — 動きは測定不可'],
  'real.verdict.insufficient': ['Yeterli tespit yok', 'Not enough detections', 'Detecciones insuficientes', 'Nicht genug Detektionen', '検出数が不足'],
  'real.count': [
    '{exp} pozlama · {det} tespit · {mask} maskeli · {out} hedef dışı',
    '{exp} exposures · {det} detections · {mask} masked · {out} off-target',
    '{exp} exposiciones · {det} detecciones · {mask} enmascaradas · {out} fuera del objetivo',
    '{exp} Belichtungen · {det} Detektionen · {mask} maskiert · {out} ohne Ziel',
    '露出{exp}件 · 検出{det}件 · マスク{mask}件 · 対象外{out}件',
  ],
  'real.st.mu': ['Ölçülen özdevinim', 'Measured proper motion', 'Movimiento propio medido', 'Gemessene Eigenbewegung', '測定した固有運動'],
  'real.st.cat': ['Katalog özdevinimi', 'Catalogue proper motion', 'Movimiento propio del catálogo', 'Katalog-Eigenbewegung', 'カタログの固有運動'],
  'real.st.diff': ['fark {s}σ', 'difference {s}σ', 'diferencia {s}σ', 'Abweichung {s}σ', '差 {s}σ'],
  'real.st.lamRange': ['Kapsanan dalga boyu', 'Wavelength coverage', 'Cobertura en longitud de onda', 'Wellenlängenabdeckung', 'カバーする波長'],
  'real.st.counts': ['{m} pozlamanın {n}’inde tespit', 'detected in {n} of {m} exposures', 'detectado en {n} de {m} exposiciones', 'in {n} von {m} Belichtungen erkannt', '{m}件中{n}件で検出'],
  'real.st.T': ['Renk sıcaklığı', 'Colour temperature', 'Temperatura de color', 'Farbtemperatur', '色温度'],
  'real.st.Tsub': ['{n} noktaya Planck uyumu', 'Planck fit to {n} points', 'ajuste de Planck a {n} puntos', 'Planck-Fit an {n} Punkte', '{n}点へのプランク近似'],
  'real.st.needMore': ['daha fazla tespit gerek', 'needs more detections', 'se necesitan más detecciones', 'mehr Detektionen nötig', '検出数が不足'],
  'real.st.base': ['Tarih tabanı', 'Time baseline', 'Base temporal', 'Zeitbasis', '観測期間'],
  'real.st.snr': ['Ortanca SNR', 'Median SNR', 'SNR mediana', 'Median-SNR', 'SNR中央値'],
  'real.st.snrSub': ['{r} piksel açıklık', '{r} px aperture', 'apertura de {r} px', '{r}-px-Apertur', '開口 {r} px'],
  'real.st.detected': ['tespit', 'detected', 'detectado', 'erkannt', '検出'],
  'real.st.marginal': ['sınırda', 'marginal', 'dudoso', 'grenzwertig', '境界'],
  'real.st.faint': ['sönük/yok', 'faint/none', 'débil/ninguno', 'schwach/keine', '暗い／なし'],
  'real.st.masked': ['maskeli', 'masked', 'enmascarado', 'maskiert', 'マスク'],
  'real.st.outside': ['alan dışı', 'off-image', 'fuera de imagen', 'außerhalb', '画像外'],
  'real.st.nophot': ['ölçülemedi', 'no photometry', 'sin fotometría', 'keine Photometrie', '測光不可'],
  'real.sed.title': ['Gerçek kızılötesi parmak izi (SED)', 'Real infrared fingerprint (SED)', 'Huella infrarroja real (SED)', 'Echter Infrarot-Fingerabdruck (SED)', '実際の赤外線フィンガープリント（SED）'],
  'real.sed.empty': ['Spektrum için tespit gerek', 'Detections are needed for a spectrum', 'Se necesitan detecciones para el espectro', 'Für ein Spektrum sind Detektionen nötig', 'スペクトルには検出が必要です'],
  'real.sed.planck': ['Planck uyumu ≈ {T} K', 'Planck fit ≈ {T} K', 'ajuste de Planck ≈ {T} K', 'Planck-Fit ≈ {T} K', 'プランク近似 ≈ {T} K'],
  'real.track.title': ['Gökyüzündeki yol (gerçek konumlar)', 'Path on the sky (real positions)', 'Trayectoria en el cielo (posiciones reales)', 'Bahn am Himmel (echte Positionen)', '空での軌跡（実測位置）'],
  'real.track.legend': [
    'Beyaz çizgi: ölçülen uyum · turuncu kesikli: katalog özdevinimi · renk: zaman (mavi eski → kırmızı yeni).',
    'White line: measured fit · dashed orange: catalogue proper motion · colour: time (blue old → red new).',
    'Línea blanca: ajuste medido · naranja discontinua: movimiento propio del catálogo · color: tiempo (azul antiguo → rojo reciente).',
    'Weiße Linie: gemessener Fit · orange gestrichelt: Katalog-Eigenbewegung · Farbe: Zeit (blau alt → rot neu).',
    '白線: 測定したフィット · 橙の破線: カタログの固有運動 · 色: 時間（青＝古い → 赤＝新しい）。',
  ],
  'real.table.title': ['Pozlama tablosu', 'Exposure table', 'Tabla de exposiciones', 'Belichtungstabelle', '露出テーブル'],
  'real.tb.date': ['Tarih (UTC)', 'Date (UTC)', 'Fecha (UTC)', 'Datum (UTC)', '日付（UTC）'],
  'real.tb.det': ['Ded.', 'Det.', 'Det.', 'Det.', '検出器'],
  'real.tb.status': ['Durum', 'Status', 'Estado', 'Status', '状態'],
  'real.cand.title': ['Fark görüntüsündeki adaylar', 'Candidates in the difference image', 'Candidatos en la imagen de diferencia', 'Kandidaten im Differenzbild', '差分画像の候補'],
  'real.cand.none': ['Eşiğin üstünde belirgin kalıntı yok.', 'No clear residual above the threshold.', 'Ningún residuo claro sobre el umbral.', 'Kein deutliches Residuum über der Schwelle.', 'しきい値を超える明確な残差はありません。'],
  'real.cand.note': [
    'Bunlar yalnızca en güçlü kalıntı tepelerdir; farklı dalga boyundaki iki görüntüde yıldız rengi farkı da sahte kalıntı üretir. Tıklayın, sonra SIMBAD/SkyBoT ile doğrulayın.',
    'These are only the strongest residual peaks; stellar colour differences between two wavelengths also create false residuals. Click one, then verify with SIMBAD/SkyBoT.',
    'Son solo los picos residuales más fuertes; las diferencias de color estelar entre dos longitudes de onda también crean falsos residuos. Pulse uno y verifique con SIMBAD/SkyBoT.',
    'Dies sind nur die stärksten Residuen; Farbunterschiede der Sterne zwischen zwei Wellenlängen erzeugen ebenfalls falsche Residuen. Anklicken und mit SIMBAD/SkyBoT prüfen.',
    '最も強い残差のピークにすぎません。波長の異なる2枚では星の色の違いも偽の残差を作ります。クリックしてSIMBAD/SkyBoTで確認してください。',
  ],
  'real.probe.title': ['Seçilen nokta', 'Selected point', 'Punto seleccionado', 'Gewählter Punkt', '選択した点'],
  'real.probe.measure': ['Bu noktayı hedef yap ve ölç', 'Make this point the target and measure', 'Usar este punto como objetivo y medir', 'Diesen Punkt als Ziel messen', 'この点をターゲットにして測定'],
  'real.probe.name': ['Seçilen nokta {ra}°, {dec}°', 'Picked point {ra}°, {dec}°', 'Punto elegido {ra}°, {dec}°', 'Gewählter Punkt {ra}°, {dec}°', '選択点 {ra}°, {dec}°'],
  'real.save.done': ['{id} olarak kaydedildi', 'Saved as {id}', 'Guardado como {id}', 'Gespeichert als {id}', '{id} として保存しました'],
  'real.save.open': ['Katalogda aç', 'Open in the catalogue', 'Abrir en el catálogo', 'Im Katalog öffnen', 'カタログで開く'],
  'real.credit.lead': [
    'Veri: SPHEREx görevi (NASA/JPL-Caltech), NASA/IPAC IRSA aracılığıyla. Yayınlarda şu kabul metnini kullanın:',
    'Data: the SPHEREx mission (NASA/JPL-Caltech) via NASA/IPAC IRSA. In publications please use this acknowledgement:',
    'Datos: la misión SPHEREx (NASA/JPL-Caltech) a través de NASA/IPAC IRSA. En publicaciones use este agradecimiento:',
    'Daten: die SPHEREx-Mission (NASA/JPL-Caltech) über NASA/IPAC IRSA. In Veröffentlichungen bitte diese Danksagung verwenden:',
    'データ: SPHEREx ミッション（NASA/JPL-Caltech）、NASA/IPAC IRSA経由。論文等では次の謝辞を使用してください:',
  ],
  'real.credit.note': [
    'Fotometri yaklaşıktır: açıklık düzeltmesi ve zodyak ışığı modeli uygulanmaz (arka plan yerel halkadan alınır). Çok parlak yıldızlar dedektörde doyabilir; bu durumda ölçüm “maskeli” çıkabilir, daha sönük bir hedef deneyin. Bilimsel kullanım için IRSA’nın resmi ürünleriyle doğrulayın.',
    'Photometry is approximate: no aperture correction or zodiacal model is applied (background comes from a local annulus). Very bright stars can saturate the detector, in which case the measurement may come out “masked”; try a fainter target. Verify against official IRSA products for scientific use.',
    'La fotometría es aproximada: no se aplica corrección de apertura ni modelo zodiacal (el fondo sale de un anillo local). Las estrellas muy brillantes pueden saturar el detector y la medición puede salir «enmascarada»; pruebe un objetivo más débil. Verifique con los productos oficiales de IRSA para uso científico.',
    'Die Photometrie ist näherungsweise: keine Aperturkorrektur und kein Zodiakallichtmodell (Hintergrund aus lokalem Ring). Sehr helle Sterne können den Detektor sättigen; dann kann die Messung „maskiert“ ausfallen – versuchen Sie ein lichtschwächeres Ziel. Für wissenschaftliche Nutzung mit offiziellen IRSA-Produkten prüfen.',
    '測光は概算です。開口補正や黄道光モデルは適用せず、背景は局所リングから求めています。非常に明るい星は検出器が飽和し、測定が「マスク」になることがあります。その場合はより暗いターゲットをお試しください。科学利用にはIRSAの公式プロダクトで検証してください。',
  ],

  // ───────── Katalog ─────────
  'real.type': ['SPHEREx gerçek ölçüm', 'Real SPHEREx measurement', 'Medición real de SPHEREx', 'Echte SPHEREx-Messung', 'SPHEREx実測'],
  'real.cat.title': ['Gerçek SPHEREx ölçümü', 'Real SPHEREx measurement', 'Medición real de SPHEREx', 'Echte SPHEREx-Messung', 'SPHEREx実測'],
  'real.cat.meta': ['{name} · {n} pozlama, {d} tespit', '{name} · {n} exposures, {d} detections', '{name} · {n} exposiciones, {d} detecciones', '{name} · {n} Belichtungen, {d} Detektionen', '{name} · 露出{n}件、検出{d}件'],
  'real.cat.open': ['Gerçek Veri sekmesinde aç', 'Open in the Real Data tab', 'Abrir en la pestaña de datos reales', 'Im Tab Echtdaten öffnen', '実データタブで開く'],
  'ctab.real': ['Gerçek veri', 'Real data', 'Datos reales', 'Echtdaten', '実データ'],
  'sec.real.short': ['Gerçek', 'Real', 'Real', 'Echt', '実'],
  'sec.real.title': ['Gerçek SPHEREx verisi', 'Real SPHEREx data', 'Datos reales de SPHEREx', 'Echte SPHEREx-Daten', 'SPHEREx実データ'],
  'sec.real.sub': ['NASA/IPAC IRSA', 'NASA/IPAC IRSA', 'NASA/IPAC IRSA', 'NASA/IPAC IRSA', 'NASA/IPAC IRSA'],

  // ───────── Gerçek veri · hata iletileri ─────────
  'real.err.title': ['Gerçek veri alınamadı', 'Real data could not be loaded', 'No se pudieron cargar los datos reales', 'Echtdaten konnten nicht geladen werden', '実データを読み込めませんでした'],
  'real.err.fix': [
    'Ne yapabilirsiniz: ① “Gelişmiş ayarlar”daki IRSA adresine kendi CORS vekil sunucunuzu yazın, ② dosyayı IRSA sitesinden indirip “FITS dosyası yükle” ile açın, ③ eğitim amaçlı “Keşif Haritası” sekmesini kullanın. Dosyayı file:// ile açtıysanız bir yerel sunucudan (ör. npm run dev) açmayı deneyin.',
    'What you can do: ① put your own CORS proxy into the IRSA address under “Advanced settings”, ② download the file from the IRSA site and open it with “Load FITS file(s)”, ③ use the synthetic “Discovery Map” tab for practice. If you opened this page as file://, try serving it from a local server (e.g. npm run dev).',
    'Qué puede hacer: ① escriba su propio proxy CORS en la dirección de IRSA de «Ajustes avanzados», ② descargue el archivo del sitio de IRSA y ábralo con «Cargar archivo(s) FITS», ③ use la pestaña sintética «Mapa de descubrimiento» para practicar. Si abrió la página como file://, pruebe servirla desde un servidor local (p. ej. npm run dev).',
    'Was Sie tun können: ① eigenen CORS-Proxy unter „Erweiterte Einstellungen“ als IRSA-Adresse eintragen, ② die Datei von der IRSA-Seite laden und mit „FITS-Datei(en) laden“ öffnen, ③ den synthetischen Tab „Entdeckungskarte“ zum Üben nutzen. Wurde die Seite als file:// geöffnet, versuchen Sie einen lokalen Server (z. B. npm run dev).',
    '対処法: ① 「詳細設定」のIRSAアドレスに自分のCORSプロキシを指定する、② IRSAのサイトからファイルを保存して「FITSファイルを読み込む」で開く、③ 練習用の合成「探索マップ」タブを使う。ページをfile://で開いている場合は、ローカルサーバー（例: npm run dev）から開いてみてください。',
  ],
  'real.err.explorer': [
    'IRSA SPHEREx Data Explorer’ı aç (kesitleri oradan indirip buraya yükleyin)',
    'Open IRSA’s SPHEREx Data Explorer (download cutouts there, then load them here)',
    'Abrir el SPHEREx Data Explorer de IRSA (descargue allí los recortes y cárguelos aquí)',
    'IRSA-SPHEREx-Data-Explorer öffnen (Ausschnitte dort laden, hier einlesen)',
    'IRSAのSPHEREx Data Explorerを開く（カットアウトをそこで保存し、ここで読み込む）',
  ],
  'real.err.NETWORK': [
    'IRSA’ya bağlanılamadı. Tarayıcı isteği engellemiş olabilir (CORS izni yok, çevrimdışı, güvenlik duvarı ya da eklenti). Ayrıntı: {detail}',
    'Could not connect to IRSA. The browser may have blocked the request (no CORS permission, offline, firewall or an extension). Detail: {detail}',
    'No se pudo conectar con IRSA. El navegador pudo bloquear la solicitud (sin permiso CORS, sin conexión, cortafuegos o una extensión). Detalle: {detail}',
    'Verbindung zu IRSA fehlgeschlagen. Der Browser hat die Anfrage möglicherweise blockiert (keine CORS-Erlaubnis, offline, Firewall oder Erweiterung). Detail: {detail}',
    'IRSAに接続できませんでした。ブラウザが要求をブロックした可能性があります（CORS未許可、オフライン、ファイアウォール、拡張機能など）。詳細: {detail}',
  ],
  'real.err.HTTP': [
    'IRSA şu hata koduyla yanıt verdi: HTTP {status}. {detail}',
    'IRSA answered with an error: HTTP {status}. {detail}',
    'IRSA respondió con un error: HTTP {status}. {detail}',
    'IRSA antwortete mit einem Fehler: HTTP {status}. {detail}',
    'IRSAがエラーを返しました: HTTP {status}。{detail}',
  ],
  'real.err.TIMEOUT': [
    'IRSA zamanında yanıt vermedi. Ağ yavaş ya da arşiv meşgul olabilir; birkaç dakika sonra yeniden deneyin.',
    'IRSA did not answer in time. The network may be slow or the archive busy; try again in a few minutes.',
    'IRSA no respondió a tiempo. La red puede ser lenta o el archivo estar ocupado; inténtelo de nuevo en unos minutos.',
    'IRSA antwortete nicht rechtzeitig. Das Netz ist vielleicht langsam oder das Archiv ausgelastet; versuchen Sie es in einigen Minuten erneut.',
    'IRSAが時間内に応答しませんでした。ネットワークが遅いかアーカイブが混雑している可能性があります。数分後にもう一度お試しください。',
  ],
  'real.err.TAP_ERROR': [
    'IRSA arşiv sorgusunu reddetti: {detail}',
    'The IRSA archive rejected the query: {detail}',
    'El archivo IRSA rechazó la consulta: {detail}',
    'Das IRSA-Archiv hat die Abfrage abgelehnt: {detail}',
    'IRSAアーカイブが検索を拒否しました: {detail}',
  ],
  'real.err.NO_DATA': [
    'Arşivde bu koordinatı kapsayan SPHEREx pozlaması bulunamadı. Hedef henüz taranmamış olabilir; başka bir hedef ya da koordinat deneyin.',
    'The archive has no SPHEREx exposure covering these coordinates. The target may not have been surveyed yet; try another target or position.',
    'El archivo no tiene ninguna exposición de SPHEREx que cubra estas coordenadas. Puede que el objetivo aún no se haya observado; pruebe otro objetivo o posición.',
    'Das Archiv enthält keine SPHEREx-Belichtung, die diese Koordinaten abdeckt. Das Ziel wurde vielleicht noch nicht beobachtet; versuchen Sie ein anderes Ziel oder eine andere Position.',
    'これらの座標を含むSPHEREx露出がアーカイブにありません。まだ観測されていない可能性があります。別のターゲットや位置をお試しください。',
  ],
  'real.err.OUTSIDE': [
    'Hedef, indirilmek istenen görüntünün dışında kaldı (kesit alınamadı). Başka bir pozlama seçin ya da yeniden getirin.',
    'The target lies outside the requested image (no cutout could be made). Choose another exposure or fetch again.',
    'El objetivo queda fuera de la imagen solicitada (no se pudo hacer el recorte). Elija otra exposición o vuelva a obtener los datos.',
    'Das Ziel liegt außerhalb des angeforderten Bildes (kein Ausschnitt möglich). Wählen Sie eine andere Belichtung oder rufen Sie erneut ab.',
    'ターゲットが要求した画像の外にあります（カットアウトを作れません）。別の露出を選ぶか、もう一度取得してください。',
  ],
  'real.err.FITS_BAD': [
    'Dosya geçerli bir FITS değil ya da okunamadı. {detail}',
    'The file is not valid FITS or could not be read. {detail}',
    'El archivo no es un FITS válido o no se pudo leer. {detail}',
    'Die Datei ist kein gültiges FITS oder konnte nicht gelesen werden. {detail}',
    'ファイルは有効なFITSではないか、読み取れませんでした。{detail}',
  ],
  'real.err.FITS_TRUNC': [
    'FITS dosyası yarım inmiş ya da kesilmiş görünüyor. Dosyayı yeniden indirin.',
    'The FITS file looks incomplete or truncated. Download it again.',
    'El archivo FITS parece incompleto o truncado. Descárguelo de nuevo.',
    'Die FITS-Datei wirkt unvollständig oder abgeschnitten. Laden Sie sie erneut herunter.',
    'FITSファイルが不完全または途中で切れているようです。もう一度ダウンロードしてください。',
  ],
  'real.err.FITS_NOIMAGE': [
    'FITS dosyasında görüntü katmanı bulunamadı. SPHEREx Seviye-2 “spx” görüntü dosyası (ya da kesiti) gerekir.',
    'No image layer was found in the FITS file. A SPHEREx Level-2 “spx” image file (or cutout) is required.',
    'No se encontró ninguna capa de imagen en el FITS. Se necesita un archivo de imagen «spx» de nivel 2 de SPHEREx (o un recorte).',
    'Im FITS wurde keine Bildebene gefunden. Erforderlich ist eine SPHEREx-Level-2-„spx“-Bilddatei (oder ein Ausschnitt).',
    'FITSに画像レイヤーが見つかりません。SPHEREx レベル2の「spx」画像ファイル（またはカットアウト）が必要です。',
  ],
  'real.err.FITS_COMPRESSED': [
    'Bu FITS döşemeli sıkıştırma (fpack) kullanıyor; tarayıcıda desteklenmiyor. IRSA kesitini sıkıştırmasız (varsayılan) indirin.',
    'This FITS uses tiled compression (fpack), which is not supported in the browser. Get the IRSA cutout uncompressed (the default).',
    'Este FITS usa compresión por teselas (fpack), no admitida en el navegador. Obtenga el recorte de IRSA sin comprimir (lo predeterminado).',
    'Dieses FITS nutzt Kachel-Kompression (fpack), die im Browser nicht unterstützt wird. Laden Sie den IRSA-Ausschnitt unkomprimiert (Standard).',
    'このFITSはタイル圧縮（fpack）を使っており、ブラウザでは扱えません。IRSAのカットアウトを非圧縮（既定）で取得してください。',
  ],
  'real.err.FITS_TIME': [
    'Dosyada gözlem zamanı (MJD) yok; hareket ölçümü için tarih gerekli.',
    'The file has no observation time (MJD); a date is needed to measure motion.',
    'El archivo no tiene hora de observación (MJD); se necesita la fecha para medir el movimiento.',
    'Die Datei enthält keine Beobachtungszeit (MJD); für die Bewegungsmessung ist ein Datum nötig.',
    'ファイルに観測時刻（MJD）がありません。動きの測定には日付が必要です。',
  ],
  'real.err.WCS_MISSING': [
    'Konum (WCS) bilgisi eksik; görüntü gökyüzüne bağlanamıyor. {detail}',
    'Position (WCS) information is missing, so the image cannot be tied to the sky. {detail}',
    'Falta la información de posición (WCS); la imagen no se puede ligar al cielo. {detail}',
    'Positionsinformation (WCS) fehlt; das Bild lässt sich nicht dem Himmel zuordnen. {detail}',
    '位置情報（WCS）が不足しており、画像を空の座標に結び付けられません。{detail}',
  ],
  'real.err.WCS_PROJ': [
    'Desteklenmeyen harita izdüşümü. Yalnızca TAN (SIP’li ya da SIP’siz) desteklenir. {detail}',
    'Unsupported map projection. Only TAN (with or without SIP) is supported. {detail}',
    'Proyección de mapa no admitida. Solo se admite TAN (con o sin SIP). {detail}',
    'Nicht unterstützte Kartenprojektion. Nur TAN (mit oder ohne SIP) wird unterstützt. {detail}',
    '未対応の投影法です。TAN（SIPの有無を問わず）のみ対応しています。{detail}',
  ],
  'real.err.WCS_BAD': [
    'Konum (WCS) dönüşümü bozuk (matris tekil).',
    'The position (WCS) transform is broken (singular matrix).',
    'La transformación de posición (WCS) está dañada (matriz singular).',
    'Die Positionstransformation (WCS) ist defekt (singuläre Matrix).',
    '位置（WCS）変換が壊れています（特異行列）。',
  ],
  'real.err.GZIP_UNSUPPORTED': [
    'Bu tarayıcı gzip açmayı desteklemiyor. Güncel bir Chrome, Edge, Firefox ya da Safari kullanın.',
    'This browser cannot decompress gzip. Use a current Chrome, Edge, Firefox or Safari.',
    'Este navegador no puede descomprimir gzip. Use una versión actual de Chrome, Edge, Firefox o Safari.',
    'Dieser Browser kann gzip nicht entpacken. Verwenden Sie ein aktuelles Chrome, Edge, Firefox oder Safari.',
    'このブラウザはgzipを展開できません。最新のChrome、Edge、Firefox、Safariをお使いください。',
  ],
  'real.err.WAVE_BAD': [
    'Dalga boyu tablosu (WCS-WAVE) çözülemedi; dalga boyu bilinmeden spektrum çıkarılamaz.',
    'The wavelength table (WCS-WAVE) could not be decoded; without wavelengths no spectrum can be built.',
    'No se pudo decodificar la tabla de longitudes de onda (WCS-WAVE); sin ella no se puede construir el espectro.',
    'Die Wellenlängentabelle (WCS-WAVE) konnte nicht gelesen werden; ohne Wellenlängen lässt sich kein Spektrum bilden.',
    '波長テーブル（WCS-WAVE）を解読できません。波長がないとスペクトルを作れません。',
  ],
  'real.err.GENERIC': [
    'Beklenmeyen bir sorun oluştu. {detail}',
    'An unexpected problem occurred. {detail}',
    'Ocurrió un problema inesperado. {detail}',
    'Es ist ein unerwartetes Problem aufgetreten. {detail}',
    '予期しない問題が発生しました。{detail}',
  ],

  // ───────── Gerçek veri · "Nedeni" açıklamaları ─────────
  'real.why.head.pm': [
    'Hedefin konumu zamanla kayıyor: {mu}″/yıl, yön PA {pa}° ({sig}σ · {n} tespit · {days} gün).',
    'The target’s position drifts over time: {mu}″/yr toward PA {pa}° ({sig}σ · {n} detections · {days} days).',
    'La posición del objetivo se desplaza con el tiempo: {mu}″/año hacia PA {pa}° ({sig}σ · {n} detecciones · {days} días).',
    'Die Position des Ziels wandert mit der Zeit: {mu}″/Jahr Richtung PA {pa}° ({sig}σ · {n} Detektionen · {days} Tage).',
    'ターゲットの位置は時間とともにずれています: {mu}″/年、PA {pa}°方向（{sig}σ · 検出{n}件 · {days}日）。',
  ],
  'real.why.cat': [
    'Katalog özdevinimi {catMu}″/yıl ile uyumlu (fark {dsig}σ).',
    'Consistent with the catalogue proper motion of {catMu}″/yr (difference {dsig}σ).',
    'Coherente con el movimiento propio del catálogo, {catMu}″/año (diferencia {dsig}σ).',
    'Passt zur Katalog-Eigenbewegung von {catMu}″/Jahr (Abweichung {dsig}σ).',
    'カタログの固有運動 {catMu}″/年と一致しています（差 {dsig}σ）。',
  ],
  'real.why.pm': [
    'Bu, yıldızın gerçek özdevinimi: yakındaki bir yıldız Güneş’e göre gökyüzünde yavaşça kayar. Ölçüm doğrudan gerçek SPHEREx görüntülerindeki konumlardan çıkarıldı.',
    'This is the star’s real proper motion: a nearby star slowly drifts across the sky relative to the Sun. The value was measured directly from positions in real SPHEREx images.',
    'Es el movimiento propio real de la estrella: una estrella cercana se desplaza lentamente por el cielo respecto al Sol. El valor se midió directamente de posiciones en imágenes reales de SPHEREx.',
    'Das ist die echte Eigenbewegung des Sterns: Ein naher Stern wandert relativ zur Sonne langsam über den Himmel. Der Wert wurde direkt aus Positionen in echten SPHEREx-Bildern gemessen.',
    'これは恒星の実際の固有運動です。近くの星は太陽に対してゆっくり空を移動します。値は実際のSPHEREx画像上の位置から直接測定しました。',
  ],
  'real.why.head.pmdiff': [
    'Hareket ölçüldü ({mu}″/yıl) ama katalogdaki {catMu}″/yıl değerinden {dsig}σ farklı.',
    'Motion was measured ({mu}″/yr) but differs from the catalogue value of {catMu}″/yr by {dsig}σ.',
    'Se midió movimiento ({mu}″/año) pero difiere {dsig}σ del valor del catálogo, {catMu}″/año.',
    'Bewegung gemessen ({mu}″/Jahr), weicht aber um {dsig}σ vom Katalogwert {catMu}″/Jahr ab.',
    '動きを測定しました（{mu}″/年）が、カタログ値 {catMu}″/年と {dsig}σ 異なります。',
  ],
  'real.why.pmdiff': [
    'Olası nedenler: görünmeyen bir eş (çift sistem) hareketi, katalog özdevinim hatası ya da astrometri sistematiği (SPHEREx pikseli ≈ 6″). Daha çok pozlama ve farklı dedektörlerle yeniden ölçün.',
    'Possible causes: motion of an unseen companion (binary), an error in the catalogue proper motion, or an astrometric systematic (SPHEREx pixel ≈ 6″). Re-measure with more exposures and other detectors.',
    'Causas posibles: movimiento de un compañero invisible (sistema binario), un error en el movimiento propio del catálogo o una sistemática astrométrica (píxel de SPHEREx ≈ 6″). Vuelva a medir con más exposiciones y otros detectores.',
    'Mögliche Ursachen: Bewegung eines unsichtbaren Begleiters (Doppelstern), ein Fehler in der Katalog-Eigenbewegung oder eine astrometrische Systematik (SPHEREx-Pixel ≈ 6″). Mit mehr Belichtungen und anderen Detektoren erneut messen.',
    '考えられる原因: 見えない伴星（連星）の運動、カタログ固有運動の誤差、アストロメトリの系統誤差（SPHERExの1ピクセル≈6″）。露出を増やし、別の検出器でもう一度測定してください。',
  ],
  'real.why.unexpected': [
    'Bu hedef için katalog hareketi verilmedi (ya da 0), ama konum anlamlı biçimde kayıyor. Gerçek bir yüksek özdevinimli cisim, bir Güneş Sistemi cismi ya da astrometri sistematiği olabilir; SIMBAD/SkyBoT ile doğrulayın.',
    'No catalogue motion was given for this target (or it is 0), yet the position drifts significantly. It could be a genuine high-proper-motion object, a Solar System body or an astrometric systematic; verify with SIMBAD/SkyBoT.',
    'No se dio movimiento de catálogo para este objetivo (o es 0), pero la posición se desplaza de forma significativa. Podría ser un objeto real de alto movimiento propio, un cuerpo del Sistema Solar o una sistemática astrométrica; verifique con SIMBAD/SkyBoT.',
    'Für dieses Ziel wurde keine Katalogbewegung angegeben (oder sie ist 0), dennoch wandert die Position deutlich. Es könnte ein echtes Objekt mit hoher Eigenbewegung, ein Körper des Sonnensystems oder eine astrometrische Systematik sein; mit SIMBAD/SkyBoT prüfen.',
    'このターゲットにはカタログの動きが与えられていない（または0）のに、位置が有意にずれています。実際の高固有運動天体、太陽系天体、アストロメトリの系統誤差などが考えられます。SIMBAD/SkyBoTで確認してください。',
  ],
  'real.why.head.static': [
    '{n} tespitte konum sabit: ölçülen kayma {mu}″/yıl ({sig}σ).',
    'The position is stable over {n} detections: measured drift {mu}″/yr ({sig}σ).',
    'La posición es estable en {n} detecciones: deriva medida {mu}″/año ({sig}σ).',
    'Die Position ist über {n} Detektionen stabil: gemessene Drift {mu}″/Jahr ({sig}σ).',
    '{n}回の検出で位置は安定: 測定したずれは {mu}″/年（{sig}σ）。',
  ],
  'real.why.static': [
    'Hedef, ölçüm duyarlılığımız içinde hareketsiz; uzak bir yıldız ya da galaksiyle uyumlu. “Hareket yok” demek değildir: SPHEREx pikseli ≈ 6″ olduğundan çok küçük kaymalar görünmez.',
    'The target is stationary within our measurement precision, consistent with a distant star or galaxy. That does not prove zero motion: with SPHEREx pixels of ≈ 6″, very small drifts stay invisible.',
    'El objetivo está inmóvil dentro de nuestra precisión, coherente con una estrella o galaxia lejana. No prueba movimiento nulo: con píxeles de SPHEREx de ≈ 6″, las derivas muy pequeñas pasan desapercibidas.',
    'Das Ziel ist im Rahmen unserer Messgenauigkeit ortsfest, passend zu einem fernen Stern oder einer Galaxie. Das beweist keine Null-Bewegung: Bei SPHEREx-Pixeln von ≈ 6″ bleiben sehr kleine Verschiebungen unsichtbar.',
    'ターゲットは測定精度の範囲で静止しており、遠方の恒星や銀河と矛盾しません。動きがゼロという証明ではなく、SPHERExのピクセルは≈6″なので非常に小さなずれは見えません。',
  ],
  'real.why.head.insufficient': [
    'Yalnızca {n} tespit var; hareket için en az 3 tespit gerekir.',
    'Only {n} detection(s); at least 3 are needed to measure motion.',
    'Solo hay {n} detección(es); se necesitan al menos 3 para medir el movimiento.',
    'Nur {n} Detektion(en); für die Bewegungsmessung sind mindestens 3 nötig.',
    '検出は{n}件のみです。動きの測定には3件以上必要です。',
  ],
  'real.why.insufficient': [
    'Daha çok pozlama indirin (Gelişmiş ayarlar → Dedektör başına pozlama), kesiti büyütün ya da hedefin SPHEREx tarafından sık gözlendiği bir konumda olduğundan emin olun.',
    'Download more exposures (Advanced settings → Exposures per detector), enlarge the cutout, or make sure the target sits where SPHEREx observes often.',
    'Descargue más exposiciones (Ajustes avanzados → Exposiciones por detector), amplíe el recorte o compruebe que el objetivo esté donde SPHEREx observa con frecuencia.',
    'Laden Sie mehr Belichtungen (Erweiterte Einstellungen → Belichtungen pro Detektor), vergrößern Sie den Ausschnitt oder prüfen Sie, ob das Ziel dort liegt, wo SPHEREx oft beobachtet.',
    '露出を増やす（詳細設定→検出器あたりの露出数）、カットアウトを広げる、またはターゲットがSPHERExの頻繁に観測する領域にあるか確認してください。',
  ],
  'real.why.head.var': [
    'Parlaklık değişti: {lamA} → {lamB} µm, {days} gün arayla akı oranı {ratio} ({pct}%, {sig}σ).',
    'Brightness changed: {lamA} → {lamB} µm, flux ratio {ratio} over {days} days ({pct}%, {sig}σ).',
    'El brillo cambió: {lamA} → {lamB} µm, razón de flujo {ratio} en {days} días ({pct}%, {sig}σ).',
    'Helligkeit geändert: {lamA} → {lamB} µm, Flussverhältnis {ratio} über {days} Tage ({pct}%, {sig}σ).',
    '明るさが変化: {lamA} → {lamB} µm、{days}日間でフラックス比 {ratio}（{pct}%、{sig}σ）。',
  ],
  'real.why.var': [
    'Aynı hedefin iki farklı tarihteki ölçülen akısı birbirinden ayrışıyor. Değişen yıldız, parlama ya da farklı dedektörlerin renk farkı olabilir; aynı dalga boyunda karşılaştırmak daha güvenilirdir.',
    'The measured flux of the same target differs between two dates. This may be a variable star, a flare, or a colour difference between detectors; comparing at the same wavelength is more reliable.',
    'El flujo medido del mismo objetivo difiere entre dos fechas. Puede ser una estrella variable, una llamarada o una diferencia de color entre detectores; comparar a la misma longitud de onda es más fiable.',
    'Der gemessene Fluss desselben Ziels unterscheidet sich zwischen zwei Daten. Möglich sind ein Veränderlicher, ein Flare oder Farbunterschiede zwischen Detektoren; ein Vergleich bei gleicher Wellenlänge ist verlässlicher.',
    '同じターゲットのフラックスが2つの日付で異なります。変光星、フレア、検出器間の色の違いなどが考えられます。同じ波長で比べるほうが確実です。',
  ],
  'real.why.head.sed': [
    'Renk sıcaklığı ≈ {T} K ({n} noktaya Planck uyumu).',
    'Colour temperature ≈ {T} K (Planck fit to {n} points).',
    'Temperatura de color ≈ {T} K (ajuste de Planck a {n} puntos).',
    'Farbtemperatur ≈ {T} K (Planck-Fit an {n} Punkte).',
    '色温度 ≈ {T} K（{n}点へのプランク近似）。',
  ],
  'real.why.sed.cool': [
    'Çok soğuk bir spektrum (< 1600 K): geç tip kahverengi cüce gibi, ışığını kızılötesinde saçan bir cisim. Metan/su emilimleri bu sınıfta beklenir. Birkaç noktalık uyum yalnızca kabadır.',
    'A very cool spectrum (< 1600 K): an object radiating in the infrared like a late-type brown dwarf. Methane/water absorption is expected in this class. A fit to a few points is only rough.',
    'Un espectro muy frío (< 1600 K): un objeto que irradia en el infrarrojo como una enana marrón tardía. En esta clase se espera absorción de metano/agua. Un ajuste con pocos puntos es solo aproximado.',
    'Ein sehr kühles Spektrum (< 1600 K): ein Objekt, das wie ein später Brauner Zwerg im Infraroten strahlt. In dieser Klasse sind Methan-/Wasserabsorptionen zu erwarten. Ein Fit an wenige Punkte ist nur grob.',
    '非常に低温のスペクトル（< 1600 K）。晩期型褐色矮星のように赤外線で輝く天体です。この種類ではメタン／水の吸収が期待されます。数点へのフィットはあくまで大まかです。',
  ],
  'real.why.sed.mid': [
    'Soğuk bir spektrum (1600–2900 K): geç M cücesi ya da L tipi kahverengi cüce ile uyumlu. Renk sıcaklığı gerçek etkin sıcaklıktan sapabilir.',
    'A cool spectrum (1600–2900 K): consistent with a late-M dwarf or an L-type brown dwarf. The colour temperature can differ from the true effective temperature.',
    'Un espectro frío (1600–2900 K): coherente con una enana M tardía o una enana marrón de tipo L. La temperatura de color puede diferir de la temperatura efectiva real.',
    'Ein kühles Spektrum (1600–2900 K): passt zu einem späten M-Zwerg oder einem Braunen Zwerg vom Typ L. Die Farbtemperatur kann von der wahren Effektivtemperatur abweichen.',
    '低温のスペクトル（1600〜2900 K）。晩期M型矮星やL型褐色矮星と矛盾しません。色温度は実際の有効温度とずれることがあります。',
  ],
  'real.why.sed.warm': [
    'Ilık bir spektrum (2900–4700 K): K/M tipi serin bir yıldızla uyumlu. Yakın kızılötesinde Rayleigh–Jeans kuyruğu baskındır.',
    'A warm spectrum (2900–4700 K): consistent with a cool K/M-type star. The Rayleigh–Jeans tail dominates in the near infrared.',
    'Un espectro templado (2900–4700 K): coherente con una estrella fría de tipo K/M. En el infrarrojo cercano domina la cola de Rayleigh–Jeans.',
    'Ein warmes Spektrum (2900–4700 K): passt zu einem kühlen Stern vom Typ K/M. Im nahen Infrarot dominiert der Rayleigh-Jeans-Ausläufer.',
    'やや温かいスペクトル（2900〜4700 K）。K/M型の低温星と矛盾しません。近赤外ではレイリー・ジーンズ側の裾が支配的です。',
  ],
  'real.why.sed.hot': [
    'Sıcak bir spektrum (> 4700 K): Güneş benzeri ya da daha sıcak bir yıldızla uyumlu; SPHEREx bandında akı dalga boyuyla hızla düşer.',
    'A hot spectrum (> 4700 K): consistent with a Sun-like or hotter star; in the SPHEREx band the flux falls steeply with wavelength.',
    'Un espectro caliente (> 4700 K): coherente con una estrella parecida al Sol o más caliente; en la banda de SPHEREx el flujo cae rápidamente con la longitud de onda.',
    'Ein heißes Spektrum (> 4700 K): passt zu einem sonnenähnlichen oder heißeren Stern; im SPHEREx-Band fällt der Fluss mit der Wellenlänge steil ab.',
    '高温のスペクトル（> 4700 K）。太陽に似た、あるいはより高温の恒星と矛盾しません。SPHERExの波長帯ではフラックスが波長とともに急に下がります。',
  ],

  // ───────── Gerçek veri · ⓘ ipuçları ─────────
  'tip.tab.real': [
    'NASA/IPAC IRSA arşivinden indirilen GERÇEK SPHEREx Seviye-2 görüntüleri: hedefin konumu, parlaklığı ve kızılötesi spektrumu doğrudan bu görüntülerden ölçülür. Çevrimdışıysanız FITS dosyası da yükleyebilirsiniz.',
    'REAL SPHEREx Level-2 images downloaded from the NASA/IPAC IRSA archive: the target’s position, brightness and infrared spectrum are measured straight from them. If you are offline you can load a FITS file instead.',
    'Imágenes REALES de nivel 2 de SPHEREx descargadas del archivo NASA/IPAC IRSA: la posición, el brillo y el espectro infrarrojo del objetivo se miden directamente de ellas. Si está sin conexión, puede cargar un archivo FITS.',
    'ECHTE SPHEREx-Level-2-Bilder aus dem NASA/IPAC-IRSA-Archiv: Position, Helligkeit und Infrarotspektrum des Ziels werden direkt daraus gemessen. Sind Sie offline, können Sie stattdessen eine FITS-Datei laden.',
    'NASA/IPAC IRSAアーカイブから取得した実際のSPHERExレベル2画像。ターゲットの位置・明るさ・赤外線スペクトルをその画像から直接測定します。オフラインの場合はFITSファイルを読み込めます。',
  ],
  'tip.real.target': [
    'Hangi cismin çevresine bakılacağını seçin. Özdevinim (mas/yıl) verirseniz uygulama, hedefin her gözlem tarihinde nerede olması gerektiğini hesaplar ve ölçümle karşılaştırır.',
    'Choose which object to look at. If you give a proper motion (mas/yr), the app computes where the target should be on each observation date and compares it with the measurement.',
    'Elija qué objeto mirar. Si da un movimiento propio (mas/año), la aplicación calcula dónde debería estar el objetivo en cada fecha de observación y lo compara con la medición.',
    'Wählen Sie, welches Objekt betrachtet wird. Geben Sie eine Eigenbewegung (mas/Jahr) an, berechnet die App, wo das Ziel zu jedem Beobachtungsdatum sein sollte, und vergleicht es mit der Messung.',
    'どの天体の周辺を見るかを選びます。固有運動（mas/年）を与えると、観測日ごとにターゲットがあるべき位置を計算し、測定値と比較します。',
  ],
  'tip.real.fetch': [
    'IRSA’nın SPHEREx tablosunu sorgular, hedefi kapsayan pozlamaları bulur ve her biri için yalnızca hedef çevresinin küçük bir FITS kesitini indirir (tüm görüntü değil). İndirme sırasında iptal edebilirsiniz.',
    'Queries IRSA’s SPHEREx table, finds the exposures covering the target and downloads only a small FITS cutout around the target for each one (not the whole image). You can cancel while downloading.',
    'Consulta la tabla de SPHEREx de IRSA, encuentra las exposiciones que cubren el objetivo y descarga solo un pequeño recorte FITS alrededor de él para cada una (no la imagen entera). Puede cancelar durante la descarga.',
    'Fragt die SPHEREx-Tabelle von IRSA ab, findet die Belichtungen, die das Ziel abdecken, und lädt für jede nur einen kleinen FITS-Ausschnitt um das Ziel (nicht das ganze Bild). Während des Ladens können Sie abbrechen.',
    'IRSAのSPHERExテーブルを検索し、ターゲットを含む露出を見つけ、それぞれターゲット周辺の小さなFITSカットアウトだけを取得します（全体画像ではありません）。取得中はキャンセルできます。',
  ],
  'tip.real.file': [
    'IRSA sitesinden indirdiğiniz SPHEREx Seviye-2 FITS dosyasını (.fits ya da .fits.gz) buraya yükleyin; dosya tarayıcınızdan çıkmaz, çevrimdışı da çalışır. Birden çok dosya seçebilirsiniz.',
    'Load a SPHEREx Level-2 FITS file (.fits or .fits.gz) you downloaded from IRSA; it never leaves your browser and works offline. You can select several files.',
    'Cargue un archivo FITS de nivel 2 de SPHEREx (.fits o .fits.gz) descargado de IRSA; no sale de su navegador y funciona sin conexión. Puede seleccionar varios archivos.',
    'Laden Sie eine von IRSA heruntergeladene SPHEREx-Level-2-FITS-Datei (.fits oder .fits.gz); sie verlässt Ihren Browser nie und funktioniert offline. Mehrere Dateien sind möglich.',
    'IRSAからダウンロードしたSPHERExレベル2のFITSファイル（.fitsまたは.fits.gz）を読み込みます。ファイルはブラウザの外へ出ず、オフラインでも動作します。複数選択も可能です。',
  ],
  'tip.real.settings': [
    'Ölçüm ve indirme ayarları. Varsayılanlar çoğu hedef için uygundur; yalnızca sonuçları incelemek ya da kendi IRSA vekil adresinizi girmek istiyorsanız açın.',
    'Measurement and download settings. The defaults suit most targets; open them only to tune the results or to enter your own IRSA proxy address.',
    'Ajustes de medición y descarga. Los valores predeterminados sirven para la mayoría de los objetivos; ábralos solo para afinar los resultados o para escribir su propia dirección proxy de IRSA.',
    'Mess- und Download-Einstellungen. Die Standardwerte passen für die meisten Ziele; öffnen Sie sie nur, um Ergebnisse zu verfeinern oder eine eigene IRSA-Proxy-Adresse einzutragen.',
    '測定とダウンロードの設定です。既定値でほとんどのターゲットに対応できます。結果を調整したい場合や、独自のIRSAプロキシのアドレスを入れたい場合にだけ開いてください。',
  ],
  'tip.real.perDet': [
    'SPHEREx’in 6 dedektörü vardır (her biri farklı dalga boyu bandı). Her dedektörden en fazla bu kadar pozlama, zamana yayılmış biçimde indirilir. Çok pozlama = daha iyi hareket ölçümü ama daha çok veri.',
    'SPHEREx has 6 detectors (each covering a different wavelength band). At most this many exposures per detector are downloaded, spread over time. More exposures = better motion measurement but more data.',
    'SPHEREx tiene 6 detectores (cada uno cubre una banda de longitud de onda distinta). Se descargan como máximo tantas exposiciones por detector, repartidas en el tiempo. Más exposiciones = mejor medida del movimiento, pero más datos.',
    'SPHEREx hat 6 Detektoren (jeder deckt ein anderes Wellenlängenband ab). Pro Detektor werden höchstens so viele Belichtungen geladen, zeitlich verteilt. Mehr Belichtungen = bessere Bewegungsmessung, aber mehr Daten.',
    'SPHERExには6つの検出器があり、それぞれ異なる波長帯をカバーします。検出器ごとにこの数までの露出を、時間的に分散して取得します。多いほど動きの測定は良くなりますがデータ量も増えます。',
  ],
  'tip.real.size': [
    'Her pozlamadan kesilecek karenin kenarı (yay dakikası). Büyük kesit daha çok komşu yıldız ve arka plan verir ama daha çok indirir (varsayılan 6′).',
    'Side of the square cut from each exposure (arcminutes). A larger cutout gives more neighbouring stars and background but downloads more (default 6′).',
    'Lado del cuadrado recortado de cada exposición (minutos de arco). Un recorte mayor da más estrellas vecinas y fondo, pero descarga más (por defecto 6′).',
    'Seitenlänge des aus jeder Belichtung geschnittenen Quadrats (Bogenminuten). Ein größerer Ausschnitt liefert mehr Nachbarsterne und Hintergrund, lädt aber mehr (Standard 6′).',
    '各露出から切り出す正方形の一辺（分角）。大きいほど周囲の星や背景が増えますがダウンロード量も増えます（既定 6′）。',
  ],
  'tip.real.rAp': [
    'Fotometri açıklığının yarıçapı (SPHEREx pikseli, ≈ 6″). Küçük açıklık gürültüyü azaltır ama yıldızın ışığının bir kısmını dışarıda bırakır; bu uygulamada açıklık düzeltmesi yapılmaz.',
    'Radius of the photometric aperture (SPHEREx pixels, ≈ 6″). A small aperture lowers noise but leaves out some of the star’s light; no aperture correction is applied in this app.',
    'Radio de la apertura fotométrica (píxeles de SPHEREx, ≈ 6″). Una apertura pequeña reduce el ruido pero deja fuera parte de la luz de la estrella; esta aplicación no aplica corrección de apertura.',
    'Radius der photometrischen Apertur (SPHEREx-Pixel, ≈ 6″). Eine kleine Apertur senkt das Rauschen, lässt aber einen Teil des Sternlichts außen vor; in dieser App wird keine Aperturkorrektur angewendet.',
    '測光アパーチャの半径（SPHERExのピクセル、≈6″）。小さいとノイズは減りますが星の光の一部を取りこぼします。このアプリでは開口補正は行いません。',
  ],
  'tip.real.mask': [
    'SPHEREx her piksel için bir bayrak (FLAGS) katmanı verir: kozmik ışın, ölü/sıcak/soğuk piksel, doygunluk (OVERFLOW) gibi. Açıkken bu pikseller ölçüme katılmaz; kapatırsanız ham değerler kullanılır. Çok parlak yıldızlar doyabilir: çekirdekleri maskelenir ve ölçüm “maskeli” çıkabilir.',
    'SPHEREx supplies a flag layer (FLAGS) for every pixel: cosmic rays, dead/hot/cold pixels, saturation (OVERFLOW) and so on. When on, flagged pixels are left out of the measurement; when off, raw values are used. Very bright stars can saturate: their cores get masked and the measurement may come out “masked”.',
    'SPHEREx aporta una capa de indicadores (FLAGS) para cada píxel: rayos cósmicos, píxeles muertos/calientes/fríos, saturación (OVERFLOW), etc. Activado, los píxeles marcados quedan fuera de la medición; desactivado, se usan los valores en bruto. Las estrellas muy brillantes pueden saturarse: su núcleo se enmascara y la medición puede salir «enmascarada».',
    'SPHEREx liefert für jedes Pixel eine Flag-Ebene (FLAGS): kosmische Strahlen, tote/heiße/kalte Pixel, Sättigung (OVERFLOW) usw. Eingeschaltet bleiben markierte Pixel außerhalb der Messung; ausgeschaltet werden Rohwerte verwendet. Sehr helle Sterne können sättigen: ihr Kern wird maskiert und die Messung kann „maskiert“ ausfallen.',
    'SPHERExは各ピクセルにフラグ層（FLAGS）を付けています（宇宙線、デッド／ホット／コールドピクセル、飽和（OVERFLOW）など）。オンにするとフラグの立ったピクセルを測定から除外し、オフにすると生の値を使います。非常に明るい星は飽和することがあり、その場合は中心部がマスクされて測定が「マスク」になることがあります。',
  ],
  'tip.real.base': [
    'IRSA’ya erişimin temel adresi. Tarayıcınız doğrudan erişemiyorsa (CORS) kendi vekil sunucunuzun adresini buraya yazabilirsiniz; boş bırakırsanız resmi adres kullanılır.',
    'The base address used to reach IRSA. If your browser cannot reach it directly (CORS) you can enter the address of your own proxy here; leave it as is to use the official address.',
    'La dirección base para llegar a IRSA. Si su navegador no puede acceder directamente (CORS), puede escribir aquí la dirección de su propio proxy; déjela tal cual para usar la oficial.',
    'Die Basisadresse für den Zugriff auf IRSA. Erreicht Ihr Browser sie nicht direkt (CORS), tragen Sie hier die Adresse Ihres eigenen Proxys ein; unverändert gilt die offizielle Adresse.',
    'IRSAに接続するための基本アドレスです。ブラウザから直接接続できない場合（CORS）は、ここに自分のプロキシのアドレスを入力できます。そのままなら公式のアドレスを使います。',
  ],
  'tip.real.pair': [
    'Fark ve yanıp sönme görünümlerinde karşılaştırılacak iki pozlama (A: eski, B: yeni). En güvenilir karşılaştırma aynı dedektörde, benzer dalga boyunda, farklı tarihlerde alınan çifttir.',
    'The two exposures compared in the difference and blink views (A: older, B: newer). The most reliable comparison is a pair taken on the same detector, at a similar wavelength, on different dates.',
    'Las dos exposiciones que se comparan en las vistas de diferencia y parpadeo (A: antigua, B: reciente). La comparación más fiable es un par tomado con el mismo detector, a longitud de onda similar y en fechas distintas.',
    'Die zwei Belichtungen, die in Differenz- und Blinkansicht verglichen werden (A: älter, B: neuer). Am verlässlichsten ist ein Paar vom selben Detektor, bei ähnlicher Wellenlänge und an verschiedenen Tagen.',
    '差分とブリンク表示で比較する2つの露出（A: 古い、B: 新しい）。同じ検出器・近い波長・異なる日付のペアが最も信頼できます。',
  ],
  'tip.real.mode.single': [
    'Seçili tek pozlamanın gerçek görüntüsü. Hedefin konumu işaretlidir; görüntüye tıklayarak başka bir noktayı inceleyebilirsiniz.',
    'The real image of the selected exposure. The target position is marked; click the image to inspect another point.',
    'La imagen real de la exposición seleccionada. La posición del objetivo está marcada; pulse la imagen para inspeccionar otro punto.',
    'Das echte Bild der gewählten Belichtung. Die Zielposition ist markiert; durch Klicken ins Bild können Sie einen anderen Punkt untersuchen.',
    '選択した露出の実画像です。ターゲットの位置が示されています。画像をクリックすると別の地点を調べられます。',
  ],
  'tip.real.mode.blink': [
    'A ve B pozlamasını aynı karede dönüşümlü gösterir. Sabit yıldızlar yerinde durur; hareket eden ya da parlaklığı değişen cisim “zıplar” ya da yanıp söner.',
    'Alternates exposure A and B in the same frame. Fixed stars stay put; a moving or varying object “jumps” or flickers.',
    'Alterna las exposiciones A y B en el mismo cuadro. Las estrellas fijas se quedan en su sitio; un objeto que se mueve o varía «salta» o parpadea.',
    'Zeigt Belichtung A und B abwechselnd im selben Bild. Feste Sterne bleiben stehen; ein bewegtes oder veränderliches Objekt „springt“ oder flackert.',
    'AとBの露出を同じ枠で交互に表示します。固定された星は動かず、動く天体や明るさの変わる天体は「跳ねる」か点滅します。',
  ],
  'tip.real.mode.diff': [
    '|B − A| farkını gösterir. Aynı kalan her şey söner; konumu ya da parlaklığı değişen cisimler parlak kalıntı bırakır. Farklı dalga boylarında yıldız rengi farkı da sahte kalıntı verir.',
    'Shows |B − A|. Everything unchanged fades away; objects whose position or brightness changed leave bright residuals. At different wavelengths, stellar colour differences also leave false residuals.',
    'Muestra |B − A|. Todo lo que no cambia se desvanece; los objetos cuya posición o brillo cambió dejan residuos brillantes. A distintas longitudes de onda, las diferencias de color estelar también dejan falsos residuos.',
    'Zeigt |B − A|. Alles Unveränderte verschwindet; Objekte mit geänderter Position oder Helligkeit hinterlassen helle Residuen. Bei verschiedenen Wellenlängen erzeugen Sternfarbunterschiede auch falsche Residuen.',
    '|B − A|を表示します。変化のないものは消え、位置や明るさが変わった天体は明るい残差を残します。波長が異なると星の色の違いによる偽の残差も出ます。',
  ],
  'tip.real.mode.rgb': [
    'Üç pozlamanın dalga boylarını R/G/B’ye eşleyen sahte renkli görüntü: kısa λ mavi, uzun λ kırmızı. Soğuk cisimler kırmızıya, sıcak yıldızlar maviye yatar.',
    'A false-colour image mapping the wavelengths of three exposures to R/G/B: short λ blue, long λ red. Cool objects look red, hot stars look blue.',
    'Una imagen en falso color que asigna las longitudes de onda de tres exposiciones a R/G/B: λ corta azul, λ larga roja. Los objetos fríos se ven rojos y las estrellas calientes azules.',
    'Ein Falschfarbenbild, das die Wellenlängen dreier Belichtungen auf R/G/B abbildet: kurze λ blau, lange λ rot. Kühle Objekte wirken rot, heiße Sterne blau.',
    '3つの露出の波長をR/G/Bに割り当てた疑似カラー画像です。短波長が青、長波長が赤。低温の天体は赤く、高温の星は青く見えます。',
  ],
  'tip.real.aladin': [
    'Aynı bölgeyi Aladin Lite’ta (CDS) açar; SPHEREx’in yayımlanmış tüm-gökyüzü renkli haritasıyla kendi kesitinizi karşılaştırabilirsiniz. Yeni sekmede, internet gerekir.',
    'Opens the same region in Aladin Lite (CDS) so you can compare your cutout with SPHEREx’s published all-sky colour map. Opens in a new tab and needs internet.',
    'Abre la misma región en Aladin Lite (CDS) para comparar su recorte con el mapa de color de todo el cielo publicado por SPHEREx. Se abre en una pestaña nueva y requiere internet.',
    'Öffnet dieselbe Region in Aladin Lite (CDS), damit Sie Ihren Ausschnitt mit der veröffentlichten SPHEREx-Ganzhimmels-Farbkarte vergleichen können. Öffnet in einem neuen Tab; Internet nötig.',
    '同じ領域をAladin Lite（CDS）で開き、公開されているSPHERExの全天カラーマップと切り出し画像を比較できます。新しいタブで開き、インターネットが必要です。',
  ],
  'tip.real.strip': [
    'İndirilen pozlamalar, tarih sırasıyla. Renk dedektörü gösterir. Birine tıklayarak onu A (sol tık) ya da B (Shift+tık) olarak seçebilirsiniz.',
    'The downloaded exposures in date order. Colour shows the detector. Click one to choose it as A (click) or B (Shift+click).',
    'Las exposiciones descargadas en orden de fecha. El color indica el detector. Pulse una para elegirla como A (clic) o B (Mayús+clic).',
    'Die geladenen Belichtungen in Datumsreihenfolge. Die Farbe zeigt den Detektor. Anklicken wählt sie als A (Klick) oder B (Umschalt+Klick).',
    'ダウンロードした露出を日付順に並べたものです。色は検出器を表します。クリックでA、Shift+クリックでBに選べます。',
  ],
  'tip.real.result': [
    'Tüm pozlamalardaki ölçümlerden çıkan özet karar: hedef hareket ediyor mu, katalogla uyumlu mu? Karar, istatistiksel anlamlılığa (σ) ve en az 3 tespit koşuluna dayanır.',
    'The summary verdict from measurements across all exposures: does the target move, and does that match the catalogue? It rests on statistical significance (σ) and requires at least 3 detections.',
    'El veredicto resumido de las mediciones en todas las exposiciones: ¿se mueve el objetivo y coincide con el catálogo? Se basa en la significancia estadística (σ) y exige al menos 3 detecciones.',
    'Das zusammenfassende Urteil aus den Messungen aller Belichtungen: Bewegt sich das Ziel, und passt das zum Katalog? Es beruht auf statistischer Signifikanz (σ) und verlangt mindestens 3 Detektionen.',
    'すべての露出での測定から導いた総合判定です。ターゲットは動いているか、カタログと一致するか。統計的有意性（σ）と3件以上の検出が条件です。',
  ],
  'tip.real.st.mu': [
    'Gökyüzünde ölçülen yıllık kayma (yay saniyesi/yıl) ve yönü (PA: kuzeyden doğuya doğru derece). Konumlara doğru çizgi uydurularak bulunur; ± hata ve σ anlamlılığı gösterilir.',
    'The yearly drift measured on the sky (arcseconds/year) and its direction (PA: degrees from north through east). It comes from a straight-line fit to the positions; the ± error and the σ significance are shown.',
    'La deriva anual medida en el cielo (segundos de arco/año) y su dirección (PA: grados desde el norte hacia el este). Sale de ajustar una recta a las posiciones; se muestran el error ± y la significancia σ.',
    'Die am Himmel gemessene jährliche Verschiebung (Bogensekunden/Jahr) und ihre Richtung (PA: Grad von Nord über Ost). Sie ergibt sich aus einem Geradenfit an die Positionen; ± Fehler und σ-Signifikanz werden angezeigt.',
    '空で測定した年間のずれ（秒角/年）とその方向（PA: 北から東回りの角度）です。位置への直線フィットで求め、±誤差とσの有意性を表示します。',
  ],
  'tip.real.st.cat': [
    'Kataloğun (SIMBAD/Gaia) bildirdiği özdevinim. Ölçtüğünüz değerle yan yana durur; aradaki fark kaç σ ise küçük olması uyum demektir.',
    'The proper motion reported by the catalogue (SIMBAD/Gaia). It sits beside your measured value; a small difference in σ means agreement.',
    'El movimiento propio que indica el catálogo (SIMBAD/Gaia). Aparece junto al valor medido; una diferencia pequeña en σ significa concordancia.',
    'Die vom Katalog (SIMBAD/Gaia) angegebene Eigenbewegung. Sie steht neben Ihrem Messwert; eine kleine Abweichung in σ bedeutet Übereinstimmung.',
    'カタログ（SIMBAD/Gaia）が示す固有運動です。測定値と並べて表示され、σでの差が小さいほど一致していることを意味します。',
  ],
  'tip.real.st.T': [
    'Ölçülen akıların dalga boyuna göre dağılımına (SED) en iyi uyan kara cisim sıcaklığı. Yakın kızılötesinde birkaç noktadan çıkan kabaca bir ipucudur; toz, buz ve soğurma bandları sonucu kaydırabilir.',
    'The blackbody temperature that best fits how the measured flux varies with wavelength (SED). It is a rough hint from a few near-infrared points; dust, ices and absorption bands can shift it.',
    'La temperatura de cuerpo negro que mejor ajusta cómo varía el flujo medido con la longitud de onda (SED). Es una pista aproximada a partir de pocos puntos del infrarrojo cercano; el polvo, los hielos y las bandas de absorción pueden desplazarla.',
    'Die Schwarzkörpertemperatur, die am besten zum Verlauf des gemessenen Flusses mit der Wellenlänge (SED) passt. Ein grober Hinweis aus wenigen Nahinfrarot-Punkten; Staub, Eise und Absorptionsbanden können sie verschieben.',
    '測定したフラックスの波長依存性（SED）に最もよく合う黒体温度です。近赤外の数点から得る大まかな目安で、ダスト、氷、吸収帯によってずれることがあります。',
  ],
  'tip.real.sed': [
    'Gerçek ölçümlerden kızılötesi parmak izi: her nokta bir pozlamada ölçülen akı (µJy) ve dalga boyu (µm); renk dedektörü gösterir, çubuklar belirsizliktir. Kesikli çizgi Planck uyumudur.',
    'The infrared fingerprint from real measurements: each point is the flux (µJy) and wavelength (µm) measured in one exposure; colour shows the detector, bars are uncertainties. The dashed line is the Planck fit.',
    'La huella infrarroja a partir de mediciones reales: cada punto es el flujo (µJy) y la longitud de onda (µm) medidos en una exposición; el color indica el detector y las barras son incertidumbres. La línea discontinua es el ajuste de Planck.',
    'Der Infrarot-Fingerabdruck aus echten Messungen: Jeder Punkt ist Fluss (µJy) und Wellenlänge (µm) einer Belichtung; die Farbe zeigt den Detektor, Balken sind Unsicherheiten. Die gestrichelte Linie ist der Planck-Fit.',
    '実測から得た赤外線フィンガープリントです。各点は1回の露出で測ったフラックス（µJy）と波長（µm）、色は検出器、バーは不確かさ、破線はプランク近似を表します。',
  ],
  'tip.real.track': [
    'Hedefin ölçülen konumları (gökyüzü kaymaları, yay saniyesi). Noktalar zamanla renklenir; beyaz çizgi ölçülen uyum, turuncu kesikli çizgi katalog özdevinimidir. İkisi üst üste biniyorsa ölçüm katalogla uyumludur.',
    'The measured positions of the target (sky offsets in arcseconds). Points are coloured by time; the white line is the measured fit and the dashed orange line the catalogue proper motion. If they overlap, the measurement agrees with the catalogue.',
    'Las posiciones medidas del objetivo (desplazamientos en el cielo, segundos de arco). Los puntos se colorean según el tiempo; la línea blanca es el ajuste medido y la naranja discontinua el movimiento propio del catálogo. Si se superponen, la medición concuerda con el catálogo.',
    'Die gemessenen Positionen des Ziels (Verschiebungen am Himmel in Bogensekunden). Die Punkte sind nach Zeit gefärbt; die weiße Linie ist der gemessene Fit, die orange gestrichelte die Katalog-Eigenbewegung. Liegen sie übereinander, stimmt die Messung mit dem Katalog überein.',
    'ターゲットの測定位置（空でのずれ、秒角）です。点は時間で色分けされ、白線は測定したフィット、橙の破線はカタログの固有運動です。重なっていれば測定はカタログと一致しています。',
  ],
  'tip.real.table': [
    'Her pozlamanın tarihi, dedektörü, dalga boyu, ölçülen akı ve durumu (tespit, sınırda, maskeli, alan dışı…). Tabloyu açıp tek tek satırlara bakarak neyin neden elendiğini görebilirsiniz.',
    'Date, detector, wavelength, measured flux and status of each exposure (detected, marginal, masked, off-image…). Open the table to see row by row what was dropped and why.',
    'Fecha, detector, longitud de onda, flujo medido y estado de cada exposición (detectado, dudoso, enmascarado, fuera de imagen…). Abra la tabla para ver fila por fila qué se descartó y por qué.',
    'Datum, Detektor, Wellenlänge, gemessener Fluss und Status jeder Belichtung (erkannt, grenzwertig, maskiert, außerhalb…). Öffnen Sie die Tabelle, um Zeile für Zeile zu sehen, was verworfen wurde und warum.',
    '各露出の日付、検出器、波長、測定フラックス、状態（検出、境界、マスク、画像外など）です。表を開くと、何がなぜ除外されたかを1行ずつ確認できます。',
  ],
  'tip.real.cand': [
    'Fark görüntüsündeki en güçlü kalıntı tepeleri: hareket eden ya da parlaklığı değişen aday cisimler. Birine tıklayın, konumunu ölçün ve SIMBAD/SkyBoT ile doğrulayın. Sahte kalıntılar olabilir.',
    'The strongest residual peaks in the difference image: candidate moving or varying objects. Click one, measure its position and verify it with SIMBAD/SkyBoT. False residuals are possible.',
    'Los picos residuales más fuertes de la imagen de diferencia: candidatos a objetos que se mueven o varían. Pulse uno, mida su posición y verifíquelo con SIMBAD/SkyBoT. Pueden existir falsos residuos.',
    'Die stärksten Residuenspitzen im Differenzbild: Kandidaten für bewegte oder veränderliche Objekte. Anklicken, Position messen und mit SIMBAD/SkyBoT prüfen. Falsche Residuen sind möglich.',
    '差分画像で最も強い残差のピークで、動く／明るさの変わる天体の候補です。クリックして位置を測定し、SIMBAD/SkyBoTで確認してください。偽の残差の可能性もあります。',
  ],
  'tip.real.probe': [
    'Görüntüde tıkladığınız noktanın gökyüzü koordinatı. Buradan o noktayı yeni hedef yapıp ölçebilir, SIMBAD/SkyBoT’ta bilinen bir cisim olup olmadığına bakabilirsiniz.',
    'The sky coordinate of the point you clicked in the image. From here you can make that point the new target and measure it, or check SIMBAD/SkyBoT to see whether it is a known object.',
    'La coordenada celeste del punto que pulsó en la imagen. Desde aquí puede convertir ese punto en el nuevo objetivo y medirlo, o consultar SIMBAD/SkyBoT para ver si es un objeto conocido.',
    'Die Himmelskoordinate des im Bild angeklickten Punkts. Von hier aus können Sie ihn zum neuen Ziel machen und messen oder in SIMBAD/SkyBoT prüfen, ob er ein bekanntes Objekt ist.',
    '画像でクリックした点の天球座標です。ここからその点を新しいターゲットにして測定したり、SIMBAD/SkyBoTで既知の天体かどうかを確認したりできます。',
  ],
  'tip.real.save': [
    'Bu ölçümü zaman damgası, tüm pozlamaların özeti ve notlarınızla Katalog sekmesine kaydeder. Kayıt tarayıcınızda saklanır ve JSON/CSV/VOTable olarak dışa aktarılabilir; dışa aktarmada SPHEREx kabul metni de bulunur.',
    'Saves this measurement to the Catalogue tab with a timestamp, a summary of all exposures and your notes. It is stored in your browser and can be exported as JSON/CSV/VOTable; the export includes the SPHEREx acknowledgement.',
    'Guarda esta medición en la pestaña Catálogo con marca de tiempo, un resumen de todas las exposiciones y sus notas. Se almacena en su navegador y puede exportarse como JSON/CSV/VOTable; la exportación incluye el agradecimiento de SPHEREx.',
    'Speichert diese Messung im Tab Katalog mit Zeitstempel, einer Zusammenfassung aller Belichtungen und Ihren Notizen. Sie liegt in Ihrem Browser und lässt sich als JSON/CSV/VOTable exportieren; der Export enthält die SPHEREx-Danksagung.',
    'この測定を、タイムスタンプ、全露出の要約、メモとともにカタログタブへ保存します。ブラウザ内に保管され、JSON/CSV/VOTableで書き出せます。書き出しにはSPHERExの謝辞も含まれます。',
  ],
  'tip.real.cat': [
    'Bu kayıt gerçek SPHEREx Seviye-2 verisinden yapılmış bir ölçümdür (sentetik değil). Konumlar, akılar ve dalga boyları IRSA’dan indirilen görüntülerden gelir.',
    'This entry is a measurement made from real SPHEREx Level-2 data (not synthetic). The positions, fluxes and wavelengths come from images downloaded from IRSA.',
    'Este registro es una medición hecha con datos reales de nivel 2 de SPHEREx (no sintéticos). Las posiciones, los flujos y las longitudes de onda provienen de imágenes descargadas de IRSA.',
    'Dieser Eintrag ist eine Messung aus echten SPHEREx-Level-2-Daten (nicht synthetisch). Positionen, Flüsse und Wellenlängen stammen aus von IRSA geladenen Bildern.',
    'この項目は、実際のSPHERExレベル2データから行った測定です（合成ではありません）。位置・フラックス・波長はIRSAから取得した画像に基づきます。',
  ],
  'tip.real.cat.open': [
    'Bu kaydın hedefini “Gerçek Veri” sekmesinde açar ve konumu oraya taşır; veriyi yeniden getirerek ölçümü tazeleyebilirsiniz.',
    'Opens this entry’s target in the “Real Data” tab and moves the position there; you can fetch the data again to refresh the measurement.',
    'Abre el objetivo de este registro en la pestaña «Datos reales» y traslada allí la posición; puede obtener los datos de nuevo para actualizar la medición.',
    'Öffnet das Ziel dieses Eintrags im Tab „Echtdaten“ und übernimmt die Position; Sie können die Daten erneut abrufen, um die Messung zu aktualisieren.',
    'この項目のターゲットを「実データ」タブで開き、位置を移します。データを再取得して測定を更新できます。',
  ],
  // ───────── Canlı gökyüzü katmanı: üst çubuk · veri kaynağı rozeti · galeri · yerel dosyalar ─────────
  'top.upload': ['Gerçek IRSA FITS / Görüntü Yükle', 'Upload real IRSA FITS / image', 'Cargar FITS / imagen real de IRSA', 'Echte IRSA-FITS / Bilder hochladen', '実際のIRSA FITS／画像を読み込む'],
  'top.upload.s': ['FITS yükle', 'Upload FITS', 'Cargar FITS', 'FITS laden', 'FITS読込'],
  'tip.top.upload': [
    'FITS (.fits, .fits.gz) veya PNG/JPG dosyası yükleyin; ilk dosya Epoch 1, ikincisi Epoch 2 olur (ya da dosyaları pencereye sürükleyip bırakın). Dosyalar tamamen tarayıcınızda okunur (ArrayBuffer/DataView) — internet gerekmez. Görüntü Zscale + asinh germe ile çizilir; iki epoch’u Tek / Blink / Fark modlarında karşılaştırabilirsiniz.',
    'Upload a FITS (.fits, .fits.gz) or PNG/JPG file; the first file becomes Epoch 1 and the second Epoch 2 (or drag and drop files onto the window). Files are read entirely in your browser (ArrayBuffer/DataView) — no internet needed. The image is drawn with a Zscale + asinh stretch, and you can compare the two epochs in Single / Blink / Difference modes.',
    'Cargue un archivo FITS (.fits, .fits.gz) o PNG/JPG; el primero será la Época 1 y el segundo la Época 2 (o arrastre y suelte los archivos en la ventana). Los archivos se leen por completo en su navegador (ArrayBuffer/DataView), sin necesidad de internet. La imagen se dibuja con estiramiento Zscale + asinh y puede comparar las dos épocas en los modos Simple / Blink / Diferencia.',
    'Laden Sie eine FITS-Datei (.fits, .fits.gz) oder PNG/JPG hoch; die erste Datei wird Epoche 1, die zweite Epoche 2 (oder ziehen Sie die Dateien per Drag & Drop ins Fenster). Die Dateien werden vollständig im Browser gelesen (ArrayBuffer/DataView) – kein Internet nötig. Das Bild wird mit Zscale + asinh-Stretch gezeichnet; die beiden Epochen lassen sich im Einzel-, Blink- und Differenzmodus vergleichen.',
    'FITS（.fits、.fits.gz）またはPNG/JPGファイルを読み込みます。1つ目がエポック1、2つ目がエポック2になります（ウィンドウへのドラッグ＆ドロップも可）。ファイルはブラウザ内だけで読み込まれ（ArrayBuffer/DataView）、インターネットは不要です。画像はZscale＋asinhストレッチで描画され、2つのエポックを単一／ブリンク／差分モードで比較できます。',
  ],
  'drop.title': ['Dosyayı bırakın', 'Drop the file', 'Suelte el archivo', 'Datei hier ablegen', 'ファイルをドロップ'],
  'drop.sub': ['FITS · PNG · JPG → Epoch 1 / Epoch 2', 'FITS · PNG · JPG → Epoch 1 / Epoch 2', 'FITS · PNG · JPG → Época 1 / Época 2', 'FITS · PNG · JPG → Epoche 1 / Epoche 2', 'FITS · PNG · JPG → エポック1／エポック2'],
  'upload.ok': ['{n} dosya yüklendi: {names}', '{n} file(s) loaded: {names}', '{n} archivo(s) cargado(s): {names}', '{n} Datei(en) geladen: {names}', '{n}個のファイルを読み込みました: {names}'],
  'upload.more': ['En fazla iki dosya (Epoch 1 ve Epoch 2) kullanılır; fazlası yok sayıldı.', 'At most two files (Epoch 1 and Epoch 2) are used; extra files were ignored.', 'Se usan como máximo dos archivos (Época 1 y Época 2); el resto se ignoró.', 'Es werden höchstens zwei Dateien (Epoche 1 und 2) verwendet; weitere wurden ignoriert.', '使用されるのは最大2ファイル（エポック1・2）で、それ以外は無視されました。'],
  'sky.err.FORMAT': ['Desteklenmeyen dosya türü. FITS (.fits/.fits.gz), PNG veya JPG yükleyin.', 'Unsupported file type. Please upload FITS (.fits/.fits.gz), PNG or JPG.', 'Tipo de archivo no admitido. Cargue FITS (.fits/.fits.gz), PNG o JPG.', 'Nicht unterstützter Dateityp. Bitte FITS (.fits/.fits.gz), PNG oder JPG hochladen.', '対応していないファイル形式です。FITS（.fits/.fits.gz）、PNG、JPGを読み込んでください。'],
  'sky.err.EMPTY': ['Dosya boş ya da okunamadı.', 'The file is empty or could not be read.', 'El archivo está vacío o no se pudo leer.', 'Die Datei ist leer oder konnte nicht gelesen werden.', 'ファイルが空、または読み取れませんでした。'],
  'sky.err.IMG': ['Görüntü çözülemedi (bozuk olabilir).', 'The image could not be decoded (it may be corrupt).', 'No se pudo decodificar la imagen (puede estar dañada).', 'Das Bild konnte nicht dekodiert werden (möglicherweise beschädigt).', '画像をデコードできませんでした（破損している可能性があります）。'],
  'sky.err.GENERIC': ['Dosya okunamadı: {detail}', 'Could not read the file: {detail}', 'No se pudo leer el archivo: {detail}', 'Datei konnte nicht gelesen werden: {detail}', 'ファイルを読み込めませんでした: {detail}'],

  /* ---- veri kaynağı rozeti + menü + geri düşüş şeridi ---- */
  'src.live': ['CANLI IRSA / CDS VERİSİ AKTİF', 'LIVE IRSA / CDS DATA ACTIVE', 'DATOS EN VIVO IRSA / CDS ACTIVOS', 'LIVE-DATEN IRSA / CDS AKTIV', 'IRSA／CDS ライブデータ有効'],
  'src.live.s': ['CANLI VERİ', 'LIVE DATA', 'EN VIVO', 'LIVE-DATEN', 'ライブ'],
  'src.local': ['YEREL FITS DOSYASI AKTİF', 'LOCAL FITS FILE ACTIVE', 'ARCHIVO FITS LOCAL ACTIVO', 'LOKALE FITS-DATEI AKTIV', 'ローカルFITSファイル有効'],
  'src.local.s': ['YEREL DOSYA', 'LOCAL FILE', 'ARCHIVO LOCAL', 'LOKALE DATEI', 'ローカル'],
  'src.sim': ['SPHEREx SİMÜLASYON MOTORU AKTİF', 'SPHEREx SIMULATION ENGINE ACTIVE', 'MOTOR DE SIMULACIÓN SPHEREx ACTIVO', 'SPHEREx-SIMULATIONSMOTOR AKTIV', 'SPHEREx シミュレーションエンジン有効'],
  'src.sim.s': ['SİMÜLASYON', 'SIMULATION', 'SIMULACIÓN', 'SIMULATION', 'シミュレーション'],
  'src.probing': ['CDS / IRSA BAĞLANTISI DENENİYOR…', 'TRYING CDS / IRSA CONNECTION…', 'PROBANDO CONEXIÓN CDS / IRSA…', 'CDS-/IRSA-VERBINDUNG WIRD GETESTET…', 'CDS／IRSA接続を確認中…'],
  'src.probing.s': ['BAĞLANIYOR…', 'CONNECTING…', 'CONECTANDO…', 'VERBINDE…', '接続中…'],
  'src.menu.title': ['Veri kaynağı', 'Data source', 'Fuente de datos', 'Datenquelle', 'データソース'],
  'tip.src.badge': [
    'Şu an hangi verinin gösterildiğini söyler: canlı (internetten CDS/IRSA), yerel (yüklediğiniz dosyalar), simülasyon (uygulamanın kendi sentetik motoru). Tıklayarak tek dokunuşla geçiş yapabilirsiniz. Canlı bağlantı kurulamazsa uygulama kendiliğinden simülasyona geçer; hata ekranı ya da boş siyah alan göstermez.',
    'Shows which data is on screen right now: live (CDS/IRSA over the internet), local (files you uploaded), simulation (the app’s own synthetic engine). Click to switch with one tap. If a live connection cannot be made, the app falls back to the simulation by itself — no error screen or blank black area.',
    'Indica qué datos se muestran ahora: en vivo (CDS/IRSA por internet), local (archivos que cargó), simulación (el motor sintético de la app). Haga clic para cambiar con un toque. Si no se logra la conexión en vivo, la app pasa sola a la simulación, sin pantalla de error ni zona negra vacía.',
    'Zeigt, welche Daten gerade zu sehen sind: live (CDS/IRSA über das Internet), lokal (von Ihnen hochgeladene Dateien), Simulation (die synthetische Engine der App). Ein Klick wechselt die Quelle. Lässt sich keine Live-Verbindung aufbauen, wechselt die App selbstständig in die Simulation – ohne Fehlerbildschirm oder leere schwarze Fläche.',
    '現在表示中のデータを示します。ライブ（インターネット経由のCDS/IRSA）、ローカル（読み込んだファイル）、シミュレーション（アプリ内蔵の合成エンジン）。クリックで切り替えられます。ライブ接続できない場合は自動的にシミュレーションへ切り替わり、エラー画面や真っ黒な空白は表示されません。',
  ],
  'src.opt.live.t': ['Canlı veri (CDS · SIMBAD · IRSA)', 'Live data (CDS · SIMBAD · IRSA)', 'Datos en vivo (CDS · SIMBAD · IRSA)', 'Live-Daten (CDS · SIMBAD · IRSA)', 'ライブデータ（CDS・SIMBAD・IRSA）'],
  'src.opt.live.d': ['Gerçek 2MASS / AllWISE kızılötesi gökyüzü fotoğrafları ve SIMBAD katalog verisi internetten çekilir.', 'Real 2MASS / AllWISE infrared sky photos and SIMBAD catalogue data are fetched over the internet.', 'Se descargan fotos infrarrojas reales de 2MASS / AllWISE y datos del catálogo SIMBAD.', 'Echte 2MASS-/AllWISE-Infrarotaufnahmen und SIMBAD-Katalogdaten werden aus dem Internet geladen.', '実際の2MASS／AllWISE赤外線画像とSIMBADカタログデータをインターネットから取得します。'],
  'src.opt.local.t': ['Yerel dosya (FITS / PNG / JPG)', 'Local file (FITS / PNG / JPG)', 'Archivo local (FITS / PNG / JPG)', 'Lokale Datei (FITS / PNG / JPG)', 'ローカルファイル（FITS／PNG／JPG）'],
  'src.opt.local.d': ['Kendi dosyalarınızı Epoch 1 ve Epoch 2 olarak yükleyip karşılaştırın; internet gerekmez.', 'Upload your own files as Epoch 1 and Epoch 2 and compare them; no internet needed.', 'Cargue sus archivos como Época 1 y Época 2 y compárelos; no requiere internet.', 'Laden Sie eigene Dateien als Epoche 1 und 2 hoch und vergleichen Sie sie; kein Internet nötig.', '自分のファイルをエポック1・2として読み込み比較します。インターネットは不要です。'],
  'src.opt.sim.t': ['SPHEREx simülasyon motoru', 'SPHEREx simulation engine', 'Motor de simulación SPHEREx', 'SPHEREx-Simulationsmotor', 'SPHEREx シミュレーションエンジン'],
  'src.opt.sim.d': ['Çevrimdışı ya da korumalı ortamda da anında çalışan, gerçekçi sentetik 102 bantlı gökyüzü (eğitim amaçlı).', 'A realistic synthetic 102-band sky that works instantly, even offline or in a sandbox (for education).', 'Un cielo sintético realista de 102 bandas que funciona al instante, incluso sin conexión o en un entorno restringido (educativo).', 'Ein realistischer synthetischer Himmel mit 102 Bändern, der sofort läuft – auch offline oder in einer Sandbox (zu Lehrzwecken).', 'オフラインやサンドボックスでもすぐ動く、リアルな102バンドの合成空（教育目的）。'],
  'src.st.probing': ['bağlantı deneniyor…', 'testing connection…', 'probando conexión…', 'Verbindung wird getestet…', '接続を確認中…'],
  'src.st.ok': ['bağlı', 'connected', 'conectado', 'verbunden', '接続済み'],
  'src.st.failed': ['son deneme başarısız', 'last attempt failed', 'el último intento falló', 'letzter Versuch fehlgeschlagen', '前回の試行は失敗'],
  'src.st.files': ['{n} dosya yüklü', '{n} file(s) loaded', '{n} archivo(s) cargado(s)', '{n} Datei(en) geladen', '{n}個のファイルを読み込み済み'],
  'src.st.nofiles': ['henüz dosya yok — seçince dosya penceresi açılır', 'no files yet — choosing it opens the file dialog', 'aún no hay archivos: al elegirlo se abre el selector', 'noch keine Dateien – die Auswahl öffnet den Dateidialog', 'ファイル未読込 — 選ぶとファイル選択が開きます'],
  'src.st.ready': ['her zaman hazır', 'always ready', 'siempre disponible', 'immer bereit', '常に利用可能'],
  'src.fb.title': ['Canlı veri alınamadı — simülasyon motoruna geçildi', 'Live data unavailable — switched to the simulation engine', 'Datos en vivo no disponibles: se pasó al motor de simulación', 'Live-Daten nicht erreichbar – zur Simulation gewechselt', 'ライブデータを取得できません — シミュレーションに切り替えました'],
  'src.fb.titleLocal': ['Canlı veri alınamadı — yerel dosyalarınız gösteriliyor', 'Live data unavailable — showing your local files', 'Datos en vivo no disponibles: se muestran sus archivos locales', 'Live-Daten nicht erreichbar – Ihre lokalen Dateien werden angezeigt', 'ライブデータを取得できません — ローカルファイルを表示しています'],
  'src.fb.body': [
    'Neden: {reason}. Uygulama çalışmaya devam ediyor; internet açıldığında “Yeniden dene” ile gerçek veriye dönebilir ya da kendi FITS/PNG/JPG dosyanızı yükleyebilirsiniz.',
    'Reason: {reason}. The app keeps working; once the connection is available you can return to real data with “Try again”, or upload your own FITS/PNG/JPG file.',
    'Motivo: {reason}. La app sigue funcionando; cuando haya conexión puede volver a los datos reales con “Reintentar” o cargar su propio archivo FITS/PNG/JPG.',
    'Grund: {reason}. Die App läuft weiter; sobald eine Verbindung besteht, kommen Sie mit „Erneut versuchen“ zu den echten Daten zurück – oder laden Sie eine eigene FITS/PNG/JPG-Datei hoch.',
    '理由: {reason}。アプリはそのまま動作します。接続が回復したら「再試行」で実データに戻れます。自分のFITS/PNG/JPGファイルを読み込むこともできます。',
  ],
  'src.fb.back': ['Bağlantı geri geldi.', 'The connection is back.', 'La conexión ha vuelto.', 'Die Verbindung ist wieder da.', '接続が回復しました。'],
  'src.retry': ['Yeniden dene', 'Try again', 'Reintentar', 'Erneut versuchen', '再試行'],
  'src.reason.offline': ['tarayıcı çevrimdışı', 'the browser is offline', 'el navegador está sin conexión', 'der Browser ist offline', 'ブラウザがオフラインです'],
  'src.reason.timeout': ['sunucudan yanıt gelmedi (zaman aşımı)', 'no response from the server (timeout)', 'el servidor no respondió (tiempo agotado)', 'keine Antwort vom Server (Zeitüberschreitung)', 'サーバーからの応答がありません（タイムアウト）'],
  'src.reason.blocked': ['ağ, CORS veya güvenlik duvarı engeli', 'blocked by the network, CORS or a firewall', 'bloqueado por la red, CORS o un cortafuegos', 'durch Netzwerk, CORS oder Firewall blockiert', 'ネットワーク、CORS、またはファイアウォールによりブロックされました'],

  /* ---- Gerçek Veri sekmesi: iki panel ---- */
  'badge.sky': ['GERÇEK GÖKYÜZÜ · CDS', 'REAL SKY · CDS', 'CIELO REAL · CDS', 'ECHTER HIMMEL · CDS', '実際の空 · CDS'],
  'pane.sky': ['Gökyüzü fotoğrafı · CDS + SIMBAD', 'Sky photo · CDS + SIMBAD', 'Foto del cielo · CDS + SIMBAD', 'Himmelsfoto · CDS + SIMBAD', '空の写真 · CDS + SIMBAD'],
  'pane.irsa': ['SPHEREx pikselleri · IRSA', 'SPHEREx pixels · IRSA', 'Píxeles SPHEREx · IRSA', 'SPHEREx-Pixel · IRSA', 'SPHERExピクセル · IRSA'],
  'tip.pane.sky': [
    'Aynı gökyüzü bölgesinin gerçek 2MASS (≈1999) ve AllWISE (≈2010) kızılötesi fotoğrafları (CDS hips2fits üzerinden) ve SIMBAD’deki gerçek cisimler. Bu fotoğraflar SPHEREx görüntüsü değildir; zamanla hareket eden yıldızların nasıl yer değiştirdiğini görmek için referans olarak kullanılır.',
    'Real 2MASS (≈1999) and AllWISE (≈2010) infrared photos of the same patch of sky (via CDS hips2fits) plus the real objects from SIMBAD. These photos are not SPHEREx images; they serve as a reference to see how moving stars shift over time.',
    'Fotos infrarrojas reales de 2MASS (≈1999) y AllWISE (≈2010) de la misma región del cielo (vía CDS hips2fits) y los objetos reales de SIMBAD. Estas fotos no son imágenes de SPHEREx; sirven de referencia para ver cómo se desplazan las estrellas en movimiento con el tiempo.',
    'Echte 2MASS-(≈1999) und AllWISE-Infrarotfotos (≈2010) desselben Himmelsausschnitts (über CDS hips2fits) plus die echten Objekte aus SIMBAD. Diese Fotos sind keine SPHEREx-Bilder, sondern dienen als Referenz, um zu sehen, wie sich bewegte Sterne im Lauf der Zeit verschieben.',
    '同じ空の領域の実際の2MASS（約1999年）とAllWISE（約2010年）の赤外線写真（CDS hips2fits経由）と、SIMBADの実在天体です。これらはSPHERExの画像ではなく、移動する星が時間とともにどうずれるかを見るための参考画像です。',
  ],
  'tip.pane.irsa': [
    'NASA/IPAC IRSA arşivinden gerçek SPHEREx Seviye-2 piksellerini indirir ve ölçer (FITS, WCS, fotometri, özdevinim, SED). Tarayıcı IRSA’ya doğrudan erişemezse (CORS) burada yerel FITS yükleyebilir ya da gökyüzü fotoğrafı paneline dönebilirsiniz.',
    'Downloads and measures real SPHEREx Level-2 pixels from the NASA/IPAC IRSA archive (FITS, WCS, photometry, proper motion, SED). If the browser cannot reach IRSA directly (CORS), you can upload a local FITS here or go back to the sky-photo pane.',
    'Descarga y mide píxeles reales de SPHEREx de nivel 2 del archivo NASA/IPAC IRSA (FITS, WCS, fotometría, movimiento propio, SED). Si el navegador no puede llegar a IRSA (CORS), puede cargar aquí un FITS local o volver al panel de la foto del cielo.',
    'Lädt echte SPHEREx-Level-2-Pixel aus dem NASA/IPAC-IRSA-Archiv herunter und vermisst sie (FITS, WCS, Photometrie, Eigenbewegung, SED). Erreicht der Browser IRSA nicht direkt (CORS), können Sie hier eine lokale FITS-Datei laden oder zum Himmelsfoto-Panel zurückkehren.',
    'NASA/IPAC IRSAアーカイブから実際のSPHEREx レベル2ピクセルをダウンロードして測定します（FITS、WCS、測光、固有運動、SED）。ブラウザがIRSAに直接アクセスできない場合（CORS）は、ここでローカルFITSを読み込むか、空の写真パネルに戻ってください。',
  ],

  /* ---- Gökyüzü paneli: galeri · arama ---- */
  'sky.gallery.title': ['Keşif Galerisi', 'Discovery Gallery', 'Galería de descubrimiento', 'Entdeckergalerie', '探索ギャラリー'],
  'sky.cat.pm': ['Yüksek özdevinimli yıldızlar', 'High-proper-motion stars', 'Estrellas de alto movimiento propio', 'Sterne mit hoher Eigenbewegung', '高固有運動星'],
  'sky.cat.bd': ['Kahverengi cüceler ve soğuk cisimler', 'Brown dwarfs and cold objects', 'Enanas marrones y objetos fríos', 'Braune Zwerge und kalte Objekte', '褐色矮星と低温天体'],
  'sky.cat.neb': ['Yıldız oluşum bölgeleri ve nebulalar', 'Star-forming regions and nebulae', 'Regiones de formación estelar y nebulosas', 'Sternentstehungsgebiete und Nebel', '星形成領域と星雲'],
  'sky.cat.gal': ['Gökadalar', 'Galaxies', 'Galaxias', 'Galaxien', '銀河'],
  'sky.cat.exo': ['Ötegezegen konakçı yıldızlar', 'Exoplanet host stars', 'Estrellas con exoplanetas', 'Exoplaneten-Wirtssterne', '系外惑星をもつ恒星'],
  'tip.sky.gallery': [
    'Beş kategoriden birini seçin, sonra bir hedefe tıklayın: o bölgenin gerçek 2MASS/AllWISE fotoğrafı ve SIMBAD cisimleri yüklenir. Küçük resimler de aynı CDS servisinden gelir (çevrimdışıyken emoji görünür). Yüksek özdevinimli yıldızlarda yıl kaydırıcısı, yıldızların gökyüzünde nasıl kaydığını gösterir.',
    'Pick one of the five categories, then click a target: the real 2MASS/AllWISE photo and the SIMBAD objects for that region are loaded. The thumbnails come from the same CDS service (an emoji is shown while offline). For high-proper-motion stars the year slider shows how they drift across the sky.',
    'Elija una de las cinco categorías y haga clic en un objetivo: se cargan la foto real de 2MASS/AllWISE y los objetos SIMBAD de esa región. Las miniaturas vienen del mismo servicio CDS (sin conexión se muestra un emoji). En las estrellas de alto movimiento propio, el control del año muestra cómo se desplazan por el cielo.',
    'Wählen Sie eine der fünf Kategorien und klicken Sie ein Ziel an: Das echte 2MASS-/AllWISE-Foto und die SIMBAD-Objekte der Region werden geladen. Die Vorschaubilder stammen vom selben CDS-Dienst (offline erscheint ein Emoji). Bei Sternen mit hoher Eigenbewegung zeigt der Jahresregler, wie sie über den Himmel wandern.',
    '5つのカテゴリから1つ選び、ターゲットをクリックすると、その領域の実際の2MASS/AllWISE写真とSIMBAD天体が読み込まれます。サムネイルも同じCDSサービスから取得されます（オフライン時は絵文字）。高固有運動星では、年スライダーで星が空を移動する様子を確認できます。',
  ],
  'sky.search.title': ['Gökyüzü cismi ara', 'Find a sky object', 'Buscar un objeto del cielo', 'Himmelsobjekt suchen', '天体を検索'],
  'sky.search.ph': ['örn. M13, Vega, NGC 7000', 'e.g. M13, Vega, NGC 7000', 'p. ej. M13, Vega, NGC 7000', 'z. B. M13, Wega, NGC 7000', '例: M13、ベガ、NGC 7000'],
  'tip.sky.search': [
    'Adı CDS Sesame (SIMBAD/NED/VizieR) ile koordinata çevirir ve o bölgenin fotoğrafını açar. İnternet gerektirir.',
    'Resolves the name to coordinates with CDS Sesame (SIMBAD/NED/VizieR) and opens the photo of that region. Requires internet.',
    'Convierte el nombre en coordenadas con CDS Sesame (SIMBAD/NED/VizieR) y abre la foto de esa región. Requiere internet.',
    'Löst den Namen über CDS Sesame (SIMBAD/NED/VizieR) in Koordinaten auf und öffnet das Foto dieser Region. Benötigt Internet.',
    'CDS Sesame（SIMBAD/NED/VizieR）で名前を座標に変換し、その領域の写真を開きます。インターネットが必要です。',
  ],
  'sky.adv.title': ['Gelişmiş (koordinat · görüş alanı)', 'Advanced (coordinates · field of view)', 'Avanzado (coordenadas · campo de visión)', 'Erweitert (Koordinaten · Gesichtsfeld)', '詳細（座標・視野）'],
  'tip.sky.adv': [
    'Koordinatı elle girin (RA/Dec, derece ya da saat-derece-dakika biçimi) ve görüş alanını seçin (0,05°–0,6°). Görüş alanı, kadrajın en büyük kenarının açısıdır.',
    'Enter coordinates by hand (RA/Dec, in degrees or sexagesimal) and choose the field of view (0.05°–0.6°). The field of view is the angle of the largest side of the frame.',
    'Introduzca las coordenadas a mano (AR/Dec, en grados o sexagesimal) y elija el campo de visión (0,05°–0,6°). El campo de visión es el ángulo del lado mayor del encuadre.',
    'Geben Sie die Koordinaten von Hand ein (RA/Dec, in Grad oder sexagesimal) und wählen Sie das Gesichtsfeld (0,05°–0,6°). Das Gesichtsfeld ist der Winkel der längsten Bildkante.',
    '座標（RA/Dec、度または60進法）を手入力し、視野（0.05°～0.6°）を選びます。視野はフレームの最も長い辺の角度です。',
  ],
  'sky.fovlabel': ['Görüş alanı', 'Field of view', 'Campo de visión', 'Gesichtsfeld', '視野'],
  'sky.coords.apply': ['Bu koordinata git', 'Go to these coordinates', 'Ir a estas coordenadas', 'Zu diesen Koordinaten', 'この座標へ移動'],

  /* ---- Gökyüzü paneli: tuval · denetimler ---- */
  'sky.canvas.aria': ['Gerçek kızılötesi gökyüzü görüntüsü ve SIMBAD işaretleri', 'Real infrared sky image with SIMBAD markers', 'Imagen infrarroja real del cielo con marcadores SIMBAD', 'Echtes Infrarot-Himmelsbild mit SIMBAD-Markierungen', '実際の赤外線の空の画像とSIMBADマーカー'],
  'sky.canvas.loading': ['Gerçek gökyüzü fotoğrafı yükleniyor…', 'Loading the real sky photo…', 'Cargando la foto real del cielo…', 'Echtes Himmelsfoto wird geladen…', '実際の空の写真を読み込み中…'],
  'sky.canvas.failTitle': ['Gökyüzü fotoğrafı şu an alınamadı', 'The sky photo could not be fetched right now', 'No se pudo obtener la foto del cielo ahora', 'Das Himmelsfoto konnte gerade nicht geladen werden', '今は空の写真を取得できません'],
  'sky.canvas.simTitle': ['Canlı veri kapalı', 'Live data is off', 'Los datos en vivo están desactivados', 'Live-Daten sind aus', 'ライブデータはオフです'],
  'sky.canvas.simBody': [
    'Şu an SPHEREx simülasyon motoru etkin. Gerçek gökyüzü fotoğrafını görmek için canlı veriyi deneyin ya da kendi FITS/PNG/JPG dosyanızı yükleyin.',
    'The SPHEREx simulation engine is active right now. To see the real sky photo, try live data or upload your own FITS/PNG/JPG file.',
    'El motor de simulación SPHEREx está activo ahora. Para ver la foto real del cielo, pruebe los datos en vivo o cargue su propio archivo FITS/PNG/JPG.',
    'Aktuell ist der SPHEREx-Simulationsmotor aktiv. Für das echte Himmelsfoto versuchen Sie die Live-Daten oder laden Sie eine eigene FITS/PNG/JPG-Datei hoch.',
    '現在はSPHERExシミュレーションエンジンが有効です。実際の空の写真を見るには、ライブデータを試すか、自分のFITS/PNG/JPGファイルを読み込んでください。',
  ],
  'sky.btn.retry': ['Canlı veriyi dene', 'Try live data', 'Probar datos en vivo', 'Live-Daten versuchen', 'ライブデータを試す'],
  'sky.btn.upload': ['Dosya yükle', 'Upload a file', 'Cargar un archivo', 'Datei hochladen', 'ファイルを読み込む'],
  'sky.btn.sim': ['Simülasyonu aç', 'Open the simulation', 'Abrir la simulación', 'Simulation öffnen', 'シミュレーションを開く'],
  'sky.refonly': ['Referans fotoğraf · SPHEREx değil', 'Reference photo · not SPHEREx', 'Foto de referencia · no es SPHEREx', 'Referenzfoto · kein SPHEREx', '参考写真 · SPHERExではありません'],
  'sky.refonly.tip': [
    '2MASS (≈1999) ve AllWISE (≈2010) NASA/IPAC kızılötesi taramalarıdır; SPHEREx’ten önceki, gerçek ama farklı gözlemlerdir.',
    '2MASS (≈1999) and AllWISE (≈2010) are NASA/IPAC infrared surveys: real observations, but earlier than and different from SPHEREx.',
    '2MASS (≈1999) y AllWISE (≈2010) son rastreos infrarrojos de NASA/IPAC: observaciones reales, pero anteriores y distintas de SPHEREx.',
    '2MASS (≈1999) und AllWISE (≈2010) sind Infrarot-Durchmusterungen von NASA/IPAC: echte Beobachtungen, aber früher und anders als SPHEREx.',
    '2MASS（約1999年）とAllWISE（約2010年）はNASA/IPACの赤外線サーベイで、実際の観測ですがSPHERExより前の別のデータです。',
  ],
  'sky.band.title': ['SPHEREx bandı (102 bant)', 'SPHEREx band (102 bands)', 'Banda SPHEREx (102 bandas)', 'SPHEREx-Band (102 Bänder)', 'SPHERExバンド（102バンド）'],
  'sky.band.val': ['λ = {lam} µm · bant {n}/102', 'λ = {lam} µm · band {n}/102', 'λ = {lam} µm · banda {n}/102', 'λ = {lam} µm · Band {n}/102', 'λ = {lam} µm · バンド {n}/102'],
  'sky.blend': ['2MASS %{a} ↔ AllWISE %{b}', '2MASS {a}% ↔ AllWISE {b}%', '2MASS {a} % ↔ AllWISE {b} %', '2MASS {a} % ↔ AllWISE {b} %', '2MASS {a}% ↔ AllWISE {b}%'],
  'tip.sky.band': [
    'SPHEREx’in 102 renkli bandından birini seçer. Kısa kızılötesinde (≈0,75–2,4 µm) 2MASS, uzun kızılötesinde (≈3,2–5 µm) AllWISE fotoğrafı gösterilir; ikisinin arasında yumuşak geçiş yapılır. Kaydırıcıyı oynattıkça gerçek fotoğraf tuvalde yeniden harmanlanır.',
    'Picks one of SPHEREx’s 102 colour bands. In the short infrared (≈0.75–2.4 µm) the 2MASS photo is shown, in the long infrared (≈3.2–5 µm) the AllWISE photo, with a smooth blend in between. The real photo is re-composited on the canvas as you move the slider.',
    'Elige una de las 102 bandas de color de SPHEREx. En el infrarrojo corto (≈0,75–2,4 µm) se muestra la foto de 2MASS y en el largo (≈3,2–5 µm) la de AllWISE, con una mezcla suave entre ambas. La foto real se recompone en el lienzo al mover el control.',
    'Wählt eines der 102 Farbbänder von SPHEREx. Im kurzen Infrarot (≈0,75–2,4 µm) erscheint das 2MASS-Foto, im langen (≈3,2–5 µm) das AllWISE-Foto, dazwischen weich überblendet. Beim Bewegen des Reglers wird das echte Foto auf der Leinwand neu zusammengesetzt.',
    'SPHERExの102色バンドの1つを選びます。短波長赤外（約0.75～2.4 µm）では2MASS、長波長赤外（約3.2～5 µm）ではAllWISEの写真が表示され、中間では滑らかにブレンドされます。スライダーを動かすと実際の写真がキャンバス上で再合成されます。',
  ],
  'sky.band.note': [
    'Kaydırıcı, SPHEREx’in 102 bandından seçtiğiniz dalga boyuna göre 2MASS (kısa NIR) ile AllWISE (uzun NIR/MIR) fotoğraflarını harmanlar. Bunlar SPHEREx görüntüsü değil, aynı bölgenin gerçek kızılötesi referans fotoğraflarıdır.',
    'The slider blends the 2MASS (short NIR) and AllWISE (long NIR/MIR) photos according to the wavelength you pick from SPHEREx’s 102 bands. They are not SPHEREx images but real infrared reference photos of the same region.',
    'El control mezcla las fotos de 2MASS (NIR corto) y AllWISE (NIR/MIR largo) según la longitud de onda elegida entre las 102 bandas de SPHEREx. No son imágenes de SPHEREx, sino fotos infrarrojas reales de referencia de la misma región.',
    'Der Regler überblendet das 2MASS-Foto (kurzes NIR) und das AllWISE-Foto (langes NIR/MIR) je nach gewählter Wellenlänge aus den 102 SPHEREx-Bändern. Es sind keine SPHEREx-Bilder, sondern echte Infrarot-Referenzfotos derselben Region.',
    'スライダーは、SPHERExの102バンドから選んだ波長に応じて2MASS（短波長NIR）とAllWISE（長波長NIR/MIR）の写真をブレンドします。SPHERExの画像ではなく、同じ領域の実際の赤外線参考写真です。',
  ],
  'sky.year.title': ['Gözlem dönemi (yıl)', 'Observation epoch (year)', 'Época de observación (año)', 'Beobachtungsepoche (Jahr)', '観測時期（年）'],
  'tip.sky.year': [
    'İşaretlerin hangi yıldaki konumunu göstereceğini seçer. SIMBAD’deki özdevinim (pmra/pmdec) ile her cismin konumu o yıla taşınır; ▶ ile 1995–2035 arasını zaman atlamalı oynatabilirsiniz. Kesikli çizgi 1999→2030 yolunu, noktalar 2MASS (1999), AllWISE (2010) ve SPHEREx (2026) dönemlerini gösterir.',
    'Chooses the year for which the markers are shown. Each object is moved to that year using its SIMBAD proper motion (pmra/pmdec); ▶ plays 1995–2035 as a time-lapse. The dashed line is the 1999→2030 path, the dots mark the 2MASS (1999), AllWISE (2010) and SPHEREx (2026) epochs.',
    'Elige el año para el que se muestran los marcadores. Cada objeto se desplaza a ese año con su movimiento propio de SIMBAD (pmra/pmdec); ▶ reproduce 1995–2035 como un timelapse. La línea discontinua es la trayectoria 1999→2030 y los puntos marcan las épocas 2MASS (1999), AllWISE (2010) y SPHEREx (2026).',
    'Wählt das Jahr, für das die Markierungen gezeigt werden. Jedes Objekt wird mit seiner SIMBAD-Eigenbewegung (pmra/pmdec) in dieses Jahr verschoben; ▶ spielt 1995–2035 als Zeitraffer ab. Die gestrichelte Linie ist der Weg 1999→2030, die Punkte markieren die Epochen 2MASS (1999), AllWISE (2010) und SPHEREx (2026).',
    'マーカーを表示する年を選びます。各天体はSIMBADの固有運動（pmra/pmdec）でその年の位置に移動します。▶で1995～2035年をタイムラプス再生できます。破線は1999→2030年の経路、点は2MASS（1999）、AllWISE（2010）、SPHEREx（2026）の時期を示します。',
  ],
  'sky.tog.photo': ['Gerçek NASA/IRSA Kızılötesi Görüntüsü', 'Real NASA/IRSA infrared image', 'Imagen infrarroja real NASA/IRSA', 'Echtes NASA/IRSA-Infrarotbild', '実際のNASA/IRSA赤外線画像'],
  'sky.tog.objs': ['SIMBAD cisimleri', 'SIMBAD objects', 'Objetos SIMBAD', 'SIMBAD-Objekte', 'SIMBAD天体'],
  'sky.tog.trails': ['Hareket izleri', 'Motion trails', 'Trayectorias', 'Bewegungsspuren', '移動の軌跡'],
  'sky.tog.labels': ['Etiketler', 'Labels', 'Etiquetas', 'Beschriftungen', 'ラベル'],
  'tip.sky.toggles': [
    'Fotoğrafı, SIMBAD işaretlerini, hareket izlerini ve isim etiketlerini ayrı ayrı açıp kapatın. Fotoğraf kapalıyken yalnızca katalog işaretleri koyu zeminde kalır. “Gerçek NASA/IRSA kızılötesi görüntüsü” 2MASS ve AllWISE’tır: ikisi de NASA/IPAC (IRSA arşivli) taramalarıdır ve CDS üzerinden alınır.',
    'Switch the photo, SIMBAD markers, motion trails and name labels on and off separately. With the photo off, only the catalogue markers remain on a dark background. The “real NASA/IRSA infrared image” is 2MASS and AllWISE: both are NASA/IPAC surveys (archived at IRSA) and are fetched through CDS.',
    'Active o desactive por separado la foto, los marcadores SIMBAD, las trayectorias y las etiquetas. Con la foto desactivada solo quedan los marcadores del catálogo sobre fondo oscuro. La “imagen infrarroja real NASA/IRSA” es 2MASS y AllWISE: ambos son rastreos de NASA/IPAC (archivados en IRSA) y se obtienen a través de CDS.',
    'Foto, SIMBAD-Markierungen, Bewegungsspuren und Namensbeschriftungen lassen sich einzeln ein- und ausschalten. Ohne Foto bleiben nur die Katalogmarkierungen auf dunklem Grund. Das „echte NASA/IRSA-Infrarotbild“ ist 2MASS und AllWISE: beides NASA/IPAC-Durchmusterungen (im IRSA archiviert), abgerufen über CDS.',
    '写真、SIMBADマーカー、移動の軌跡、名前ラベルを個別にオン／オフできます。写真をオフにすると暗い背景にカタログのマーカーだけが残ります。「実際のNASA/IRSA赤外線画像」は2MASSとAllWISEで、どちらもNASA/IPACのサーベイ（IRSAに保管）で、CDS経由で取得します。',
  ],
  'tip.sky.aladin': [
    'Aynı alanı Aladin Lite’ta (CDS) etkileşimli olarak açar.',
    'Opens the same field interactively in Aladin Lite (CDS).',
    'Abre el mismo campo de forma interactiva en Aladin Lite (CDS).',
    'Öffnet dasselbe Feld interaktiv in Aladin Lite (CDS).',
    '同じ領域をAladin Lite（CDS）でインタラクティブに開きます。',
  ],

  /* ---- Gökyüzü paneli: sağ sütun ---- */
  'sky.src.title': ['Veri durumu', 'Data status', 'Estado de los datos', 'Datenstatus', 'データの状態'],
  'tip.sky.src': [
    'Her kaynağın bu hedef için alınıp alınmadığını gösterir. “Yalnızca görüntüleme”, sunucunun tarayıcıya CORS izni vermediği anlamına gelir: fotoğraf görünür ama pikselleri okunamaz (uygulama yine de çalışır).',
    'Shows whether each source was received for this target. “View only” means the server did not grant the browser CORS permission: the photo is visible but its pixels cannot be read (the app still works).',
    'Muestra si se recibió cada fuente para este objetivo. “Solo visualización” significa que el servidor no concedió permiso CORS al navegador: la foto se ve, pero sus píxeles no pueden leerse (la app funciona igualmente).',
    'Zeigt, ob jede Quelle für dieses Ziel empfangen wurde. „Nur Anzeige“ bedeutet, dass der Server dem Browser keine CORS-Freigabe erteilt hat: Das Foto ist sichtbar, seine Pixel lassen sich aber nicht lesen (die App funktioniert trotzdem).',
    'この対象について各ソースを取得できたかを示します。「表示のみ」はサーバーがブラウザにCORS許可を与えていないことを意味し、写真は見えますがピクセルは読み取れません（アプリは動作します）。',
  ],
  'sky.st.idle': ['—', '—', '—', '—', '—'],
  'sky.st.loading': ['yükleniyor…', 'loading…', 'cargando…', 'wird geladen…', '読み込み中…'],
  'sky.st.ok': ['alındı', 'received', 'recibido', 'empfangen', '取得済み'],
  'sky.st.fail': ['alınamadı', 'not received', 'no recibido', 'nicht empfangen', '取得できず'],
  'sky.st.viewOnly': ['yalnızca görüntüleme (CORS izni yok)', 'view only (no CORS permission)', 'solo visualización (sin permiso CORS)', 'nur Anzeige (keine CORS-Freigabe)', '表示のみ（CORS許可なし）'],
  'sky.sel.title': ['Seçili cisim', 'Selected object', 'Objeto seleccionado', 'Ausgewähltes Objekt', '選択した天体'],
  'tip.sky.sel': [
    'Tuvalde bir işarete (ya da listeden bir satıra) tıklayın. Konum, seçili yıla taşınmış SIMBAD konumudur. “SPHEREx pikselleriyle ölç”, bu cismi IRSA panelinde gerçek SPHEREx verisiyle ölçmeye gönderir.',
    'Click a marker on the canvas (or a row in the list). The position is the SIMBAD position moved to the selected year. “Measure with SPHEREx pixels” sends this object to the IRSA pane to be measured with real SPHEREx data.',
    'Haga clic en un marcador del lienzo (o en una fila de la lista). La posición es la de SIMBAD desplazada al año elegido. “Medir con píxeles SPHEREx” envía este objeto al panel de IRSA para medirlo con datos reales de SPHEREx.',
    'Klicken Sie eine Markierung im Bild (oder eine Zeile der Liste) an. Die Position ist die SIMBAD-Position, auf das gewählte Jahr verschoben. „Mit SPHEREx-Pixeln messen“ schickt das Objekt ins IRSA-Panel, um es mit echten SPHEREx-Daten zu messen.',
    'キャンバス上のマーカー（またはリストの行）をクリックします。位置は選択した年に移動したSIMBADの位置です。「SPHERExピクセルで測定」は、この天体をIRSAパネルに送り、実際のSPHERExデータで測定します。',
  ],
  'sky.sel.hint': ['Tuvaldeki bir işarete ya da listedeki bir cisme tıklayın.', 'Click a marker on the canvas or an object in the list.', 'Haga clic en un marcador del lienzo o en un objeto de la lista.', 'Klicken Sie auf eine Markierung im Bild oder ein Objekt in der Liste.', 'キャンバス上のマーカーまたはリストの天体をクリックしてください。'],
  'sky.sel.pos': ['Konum ({yr})', 'Position ({yr})', 'Posición ({yr})', 'Position ({yr})', '位置（{yr}）'],
  'sky.sel.mu': ['Özdevinim', 'Proper motion', 'Movimiento propio', 'Eigenbewegung', '固有運動'],
  'sky.sel.nopm': ['SIMBAD’de yok', 'not in SIMBAD', 'no figura en SIMBAD', 'nicht in SIMBAD', 'SIMBADになし'],
  'sky.sel.moved': ['1999→{yr} yer değişimi', 'Shift 1999→{yr}', 'Desplazamiento 1999→{yr}', 'Verschiebung 1999→{yr}', '1999→{yr}の移動量'],
  'sky.sel.dist': ['Uzaklık', 'Distance', 'Distancia', 'Entfernung', '距離'],
  'sky.sel.mag': ['Parlaklık', 'Magnitude', 'Magnitud', 'Helligkeit', '等級'],
  'sky.sel.simbad': ['SIMBAD’de aç', 'Open in SIMBAD', 'Abrir en SIMBAD', 'In SIMBAD öffnen', 'SIMBADで開く'],
  'sky.sel.measure': ['SPHEREx pikselleriyle ölç', 'Measure with SPHEREx pixels', 'Medir con píxeles SPHEREx', 'Mit SPHEREx-Pixeln messen', 'SPHERExピクセルで測定'],
  'sky.obj.title': ['SIMBAD cisimleri ({n})', 'SIMBAD objects ({n})', 'Objetos SIMBAD ({n})', 'SIMBAD-Objekte ({n})', 'SIMBAD天体（{n}）'],
  'tip.sky.objs': [
    'Kadrajın merkezine en yakın en fazla 25 SIMBAD cismi (ICRS). Turuncu halkalar ölçülebilir özdevinimi olan cisimlerdir. Satır üstüne gelince tuvalde vurgulanır.',
    'Up to 25 SIMBAD objects closest to the centre of the frame (ICRS). Orange rings are objects with measurable proper motion. Hovering a row highlights it on the canvas.',
    'Hasta 25 objetos SIMBAD más cercanos al centro del encuadre (ICRS). Los anillos naranjas son objetos con movimiento propio medible. Al pasar sobre una fila se resalta en el lienzo.',
    'Bis zu 25 SIMBAD-Objekte, die der Bildmitte am nächsten liegen (ICRS). Orange Ringe sind Objekte mit messbarer Eigenbewegung. Beim Überfahren einer Zeile wird sie im Bild hervorgehoben.',
    'フレーム中心に最も近いSIMBAD天体（最大25個、ICRS）。オレンジのリングは測定可能な固有運動をもつ天体です。行にカーソルを合わせるとキャンバス上で強調されます。',
  ],
  'sky.obj.loading': ['SIMBAD sorgulanıyor…', 'Querying SIMBAD…', 'Consultando SIMBAD…', 'SIMBAD wird abgefragt…', 'SIMBADに問い合わせ中…'],
  'sky.obj.fail': ['SIMBAD’e şu an ulaşılamadı; yalnızca fotoğraf gösteriliyor.', 'SIMBAD could not be reached right now; only the photo is shown.', 'No se pudo contactar con SIMBAD ahora; solo se muestra la foto.', 'SIMBAD ist gerade nicht erreichbar; es wird nur das Foto gezeigt.', '今はSIMBADに接続できません。写真のみ表示しています。'],
  'sky.obj.retry': ['Kataloğu yeniden dene', 'Retry the catalogue', 'Reintentar el catálogo', 'Katalog erneut versuchen', 'カタログを再試行'],
  'sky.obj.none': ['Bu kadrajda SIMBAD cismi bulunamadı.', 'No SIMBAD objects found in this field.', 'No se encontraron objetos SIMBAD en este campo.', 'In diesem Feld wurden keine SIMBAD-Objekte gefunden.', 'この視野にSIMBAD天体はありません。'],
  'sky.legend': [
    'Halka = seçili yıldaki konum · kesikli çizgi = 1999→2030 yolu · bir cisim seçince 2MASS/AllWISE/SPHEREx noktaları görünür.',
    'Ring = position in the selected year · dashed line = 1999→2030 path · select an object to see its 2MASS/AllWISE/SPHEREx points.',
    'Anillo = posición en el año elegido · línea discontinua = trayectoria 1999→2030 · al seleccionar un objeto se ven sus puntos 2MASS/AllWISE/SPHEREx.',
    'Ring = Position im gewählten Jahr · gestrichelte Linie = Weg 1999→2030 · bei Auswahl eines Objekts erscheinen seine Punkte 2MASS/AllWISE/SPHEREx.',
    'リング＝選択した年の位置・破線＝1999→2030年の経路・天体を選ぶと2MASS／AllWISE／SPHERExの点が表示されます。',
  ],
  'sky.ot.pm': ['Yüksek özdevinimli yıldız', 'High-proper-motion star', 'Estrella de alto movimiento propio', 'Stern mit hoher Eigenbewegung', '高固有運動星'],
  'sky.ot.bd': ['Kahverengi cüce', 'Brown dwarf', 'Enana marrón', 'Brauner Zwerg', '褐色矮星'],
  'sky.ot.gal': ['Gökada / aktif çekirdek', 'Galaxy / active nucleus', 'Galaxia / núcleo activo', 'Galaxie / aktiver Kern', '銀河／活動銀河核'],
  'sky.ot.neb': ['Nebula / yıldız kümesi / bulut', 'Nebula / cluster / cloud', 'Nebulosa / cúmulo / nube', 'Nebel / Haufen / Wolke', '星雲／星団／分子雲'],
  'sky.ot.pl': ['Gezegen', 'Planet', 'Planeta', 'Planet', '惑星'],
  'sky.ot.var': ['Değişen yıldız', 'Variable star', 'Estrella variable', 'Veränderlicher Stern', '変光星'],
  'sky.ot.star': ['Yıldız', 'Star', 'Estrella', 'Stern', '恒星'],
  'sky.credit.title': ['Veri kaynakları ve atıf', 'Data sources and acknowledgements', 'Fuentes de datos y agradecimientos', 'Datenquellen und Danksagung', 'データソースと謝辞'],

  /* ---- Yerel dosya modu ---- */
  'sky.local.title': ['Yerel dosyalar', 'Local files', 'Archivos locales', 'Lokale Dateien', 'ローカルファイル'],
  'tip.sky.local': [
    'Yüklediğiniz iki dosya Epoch 1 ve Epoch 2 olur. FITS’te WCS varsa iki görüntü gökyüzü koordinatlarıyla hizalanır ve (internet varsa) SIMBAD cisimleri işaretlenir. “Fark” modunda hareket eden ya da değişen kaynaklar iki renkte görünür.',
    'The two files you upload become Epoch 1 and Epoch 2. If the FITS has a WCS, the two images are aligned on the sky and (with internet) SIMBAD objects are marked. In “Difference” mode, moving or changing sources show up in two colours.',
    'Los dos archivos que cargue serán la Época 1 y la Época 2. Si el FITS tiene WCS, las dos imágenes se alinean en el cielo y (con internet) se marcan los objetos SIMBAD. En el modo “Diferencia”, las fuentes que se mueven o cambian aparecen en dos colores.',
    'Die beiden hochgeladenen Dateien werden Epoche 1 und Epoche 2. Hat die FITS-Datei ein WCS, werden die Bilder am Himmel ausgerichtet und (mit Internet) SIMBAD-Objekte markiert. Im Differenzmodus erscheinen bewegte oder veränderliche Quellen in zwei Farben.',
    '読み込んだ2つのファイルがエポック1とエポック2になります。FITSにWCSがあれば2枚は天球上で位置合わせされ、（インターネットがあれば）SIMBAD天体がマークされます。「差分」モードでは、動く・変化する天体が2色で表示されます。',
  ],
  'sky.slot.empty': ['boş', 'empty', 'vacío', 'leer', '空'],
  'sky.slot.load': ['Yükle', 'Load', 'Cargar', 'Laden', '読込'],
  'sky.slot.replace': ['Değiştir', 'Replace', 'Reemplazar', 'Ersetzen', '置換'],
  'sky.local.image': ['Görüntü', 'Image', 'Imagen', 'Bild', '画像'],
  'sky.local.ds': ['{f}× küçültüldü', 'downsampled {f}×', 'reducida {f}×', '{f}× verkleinert', '{f}倍に縮小'],
  'sky.local.date': ['gözlem yılı {yr}', 'observed {yr}', 'observado en {yr}', 'beobachtet {yr}', '観測年 {yr}'],
  'sky.local.nodate': ['tarih bilgisi yok', 'no date information', 'sin información de fecha', 'keine Datumsangabe', '日付情報なし'],
  'sky.local.nowcs': ['WCS yok', 'no WCS', 'sin WCS', 'kein WCS', 'WCSなし'],
  'sky.local.simbadFail': [
    'SIMBAD işaretleri alınamadı (internet yok ya da dosyada WCS yok); görüntü yine de gösteriliyor.',
    'SIMBAD markers are unavailable (no internet or no WCS in the file); the image is still shown.',
    'Los marcadores SIMBAD no están disponibles (sin internet o sin WCS en el archivo); la imagen se muestra igualmente.',
    'SIMBAD-Markierungen nicht verfügbar (kein Internet oder kein WCS in der Datei); das Bild wird dennoch angezeigt.',
    'SIMBADマーカーを取得できません（インターネットなし、またはWCSなし）。画像は表示されます。',
  ],
  'sky.local.emptyTitle': ['Henüz dosya yüklenmedi', 'No file loaded yet', 'Aún no se ha cargado ningún archivo', 'Noch keine Datei geladen', 'ファイルはまだ読み込まれていません'],
  'sky.local.emptyBody': [
    'Üst çubuktaki “Gerçek IRSA FITS / Görüntü Yükle” düğmesini kullanın ya da dosyayı pencereye sürükleyip bırakın. FITS, PNG ve JPG desteklenir; internet gerekmez.',
    'Use the “Upload real IRSA FITS / image” button in the top bar, or drag a file onto the window. FITS, PNG and JPG are supported; no internet needed.',
    'Use el botón “Cargar FITS / imagen real de IRSA” de la barra superior o arrastre un archivo a la ventana. Se admiten FITS, PNG y JPG; no requiere internet.',
    'Nutzen Sie die Schaltfläche „Echte IRSA-FITS / Bilder hochladen“ in der oberen Leiste oder ziehen Sie eine Datei ins Fenster. FITS, PNG und JPG werden unterstützt; kein Internet nötig.',
    '上部バーの「実際のIRSA FITS／画像を読み込む」ボタンを使うか、ファイルをウィンドウにドラッグしてください。FITS、PNG、JPGに対応し、インターネットは不要です。',
  ],
  'sky.lmode.title': ['Görünüm modu', 'View mode', 'Modo de vista', 'Ansichtsmodus', '表示モード'],
  'sky.lmode.single': ['Tek', 'Single', 'Simple', 'Einzeln', '単一'],
  'sky.lmode.blink': ['Blink', 'Blink', 'Blink', 'Blink', 'ブリンク'],
  'sky.lmode.diff': ['Fark', 'Difference', 'Diferencia', 'Differenz', '差分'],
  'tip.sky.lmode': [
    'Tek: seçtiğiniz epoch. Blink: iki epoch’u art arda gösterir; hareket eden kaynak “zıplar”. Fark: Epoch 2 − Epoch 1 (σ biriminde); kırmızı = Epoch 1’de parlak, camgöbeği = Epoch 2’de parlak. Blink ve Fark için iki dosya gerekir.',
    'Single: the epoch you choose. Blink: alternates the two epochs; a moving source “jumps”. Difference: Epoch 2 − Epoch 1 (in σ); red = brighter in Epoch 1, cyan = brighter in Epoch 2. Blink and Difference need two files.',
    'Simple: la época que elija. Blink: alterna las dos épocas; una fuente en movimiento “salta”. Diferencia: Época 2 − Época 1 (en σ); rojo = más brillante en la Época 1, cian = más brillante en la Época 2. Blink y Diferencia necesitan dos archivos.',
    'Einzeln: die gewählte Epoche. Blink: wechselt zwischen beiden Epochen; eine bewegte Quelle „springt“. Differenz: Epoche 2 − Epoche 1 (in σ); rot = in Epoche 1 heller, Cyan = in Epoche 2 heller. Blink und Differenz brauchen zwei Dateien.',
    '単一：選んだエポック。ブリンク：2つのエポックを交互に表示し、動く天体が「跳ねる」ように見えます。差分：エポック2−エポック1（σ単位）。赤＝エポック1で明るい、シアン＝エポック2で明るい。ブリンクと差分には2つのファイルが必要です。',
  ],
  'sky.stretch': ['Germe', 'Stretch', 'Estiramiento', 'Stretch', 'ストレッチ'],
  'tip.sky.stretch': [
    'Zscale + asinh (önerilen): sınırları gürültü düzeyine göre seçer, sönük yapıları öne çıkarır. Zscale doğrusal: aynı sınırlar, doğrusal eşleme. Min–Maks + asinh: tüm değer aralığı; çok parlak yıldızlar baskın olur.',
    'Zscale + asinh (recommended): picks the limits from the noise level and brings out faint structure. Zscale linear: same limits, linear mapping. Min–Max + asinh: the full value range; very bright stars dominate.',
    'Zscale + asinh (recomendado): elige los límites según el nivel de ruido y resalta las estructuras débiles. Zscale lineal: mismos límites, mapeo lineal. Mín–Máx + asinh: todo el rango de valores; dominan las estrellas muy brillantes.',
    'Zscale + asinh (empfohlen): wählt die Grenzen nach dem Rauschniveau und hebt schwache Strukturen hervor. Zscale linear: gleiche Grenzen, lineare Abbildung. Min–Max + asinh: der volle Wertebereich; sehr helle Sterne dominieren.',
    'Zscale＋asinh（推奨）：ノイズレベルから範囲を決め、暗い構造を引き出します。Zscale線形：同じ範囲で線形変換。最小–最大＋asinh：全値域を使うため、非常に明るい星が支配的になります。',
  ],
  'sky.stretch.zasinh': ['Zscale + asinh', 'Zscale + asinh', 'Zscale + asinh', 'Zscale + asinh', 'Zscale + asinh'],
  'sky.stretch.zlin': ['Zscale doğrusal', 'Zscale linear', 'Zscale lineal', 'Zscale linear', 'Zscale 線形'],
  'sky.stretch.mmasinh': ['Min–Maks + asinh', 'Min–Max + asinh', 'Mín–Máx + asinh', 'Min–Max + asinh', '最小–最大 + asinh'],
  'sky.palette': ['Palet', 'Palette', 'Paleta', 'Palette', 'パレット'],
  'sky.palette.gray': ['Gri', 'Gray', 'Gris', 'Grau', 'グレー'],
  'sky.palette.ir': ['Kızılötesi (sıcak)', 'Infrared (warm)', 'Infrarrojo (cálido)', 'Infrarot (warm)', '赤外線（暖色）'],
  'sky.align.same': ['Aynı piksel ızgarası', 'Same pixel grid', 'Misma cuadrícula de píxeles', 'Gleiches Pixelraster', '同じピクセルグリッド'],
  'sky.align.wcs': ['WCS ile gökyüzü koordinatlarına hizalandı', 'Aligned on the sky with WCS', 'Alineado en el cielo mediante WCS', 'Über WCS am Himmel ausgerichtet', 'WCSで天球座標に位置合わせ済み'],
  'sky.align.scaled': ['Yalnızca ölçeklendi (WCS yok; yaklaşık)', 'Only rescaled (no WCS; approximate)', 'Solo reescalado (sin WCS; aproximado)', 'Nur skaliert (kein WCS; ungefähr)', '拡縮のみ（WCSなし・近似）'],
  'sky.diff.note': [
    'Fark = Epoch 2 − Epoch 1 (medyan/MAD ile ölçeklenmiş σ). Kırmızı: Epoch 1’de parlak · camgöbeği: Epoch 2’de parlak.',
    'Difference = Epoch 2 − Epoch 1 (σ scaled by median/MAD). Red: brighter in Epoch 1 · cyan: brighter in Epoch 2.',
    'Diferencia = Época 2 − Época 1 (σ escalada con mediana/MAD). Rojo: más brillante en la Época 1 · cian: más brillante en la Época 2.',
    'Differenz = Epoche 2 − Epoche 1 (σ, mit Median/MAD skaliert). Rot: in Epoche 1 heller · Cyan: in Epoche 2 heller.',
    '差分＝エポック2−エポック1（中央値/MADでスケーリングしたσ）。赤：エポック1で明るい・シアン：エポック2で明るい。',
  ],
  'sky.diff.err': ['Fark görüntüsü hesaplanamadı: {detail}', 'The difference image could not be computed: {detail}', 'No se pudo calcular la imagen de diferencia: {detail}', 'Das Differenzbild konnte nicht berechnet werden: {detail}', '差分画像を計算できませんでした: {detail}'],
  // ───────── Keşif Haritası · GERÇEK veri kaynağı (SIMBAD · SkyBoT · 2MASS/AllWISE fotoğrafı) ─────────
  'rm.title': ['Haritanın verisi', 'Map data', 'Datos del mapa', 'Kartendaten', 'マップのデータ'],
  'tip.rm': [
    'Haritadaki gökyüzünün hangi veriden geldiğini seçer. “Gerçek veri”: karedeki yıldızlar ve galaksiler SIMBAD’den, asteroit ve kuyruklu yıldızlar SkyBoT’tan gelir; konumlar ve özdevinimler gerçektir. Ancak görüntü ve 102 bantlı spektrumlar katalog parlaklığından hesaplanan bir modeldir, SPHEREx ölçümü değildir. “Simülasyon”: gizli keşif hedefleri olan, eğitim amaçlı sentetik gökyüzü. İnternet yoksa uygulama kendiliğinden simülasyona geçer.',
    'Chooses where the sky on the map comes from. “Real data”: the stars and galaxies in the frame come from SIMBAD and the asteroids and comets from SkyBoT; positions and proper motions are real. The image and the 102-band spectra, however, are a model computed from catalogue brightness — not a SPHEREx measurement. “Simulation”: a synthetic training sky with hidden discovery targets. Without internet the app switches to the simulation by itself.',
    'Elige de dónde viene el cielo del mapa. «Datos reales»: las estrellas y galaxias del campo vienen de SIMBAD y los asteroides y cometas de SkyBoT; las posiciones y los movimientos propios son reales. Sin embargo, la imagen y los espectros de 102 bandas son un modelo calculado a partir del brillo del catálogo, no una medición de SPHEREx. «Simulación»: un cielo sintético de entrenamiento con objetivos ocultos por descubrir. Sin internet la app pasa sola a la simulación.',
    'Wählt, woher der Himmel auf der Karte stammt. „Echtdaten“: Die Sterne und Galaxien im Ausschnitt kommen aus SIMBAD, Asteroiden und Kometen aus SkyBoT; Positionen und Eigenbewegungen sind echt. Das Bild und die 102-Band-Spektren sind jedoch ein aus Katalog-Helligkeiten berechnetes Modell – keine SPHEREx-Messung. „Simulation“: ein synthetischer Trainingshimmel mit versteckten Entdeckungszielen. Ohne Internet wechselt die App selbstständig in die Simulation.',
    '地図の空をどのデータから作るかを選びます。「実データ」: 視野内の恒星・銀河はSIMBAD、小惑星・彗星はSkyBoTから取得し、位置と固有運動は実際の値です。ただし画像と102バンドのスペクトルはカタログの明るさから計算したモデルであり、SPHERExの測定値ではありません。「シミュレーション」: 隠れた発見ターゲットを含む学習用の合成の空です。インターネットがない場合は自動的にシミュレーションに切り替わります。',
  ],
  'rm.opt.real': ['Gerçek veri', 'Real data', 'Datos reales', 'Echtdaten', '実データ'],
  'rm.opt.sim': ['Simülasyon', 'Simulation', 'Simulación', 'Simulation', 'シミュレーション'],
  'rm.real.desc': [
    'Bu karedeki gerçek yıldız ve galaksiler (SIMBAD) ile gerçek asteroit ve kuyruklu yıldızlar (SkyBoT). Konumlar ve özdevinimler gerçektir.',
    'The real stars and galaxies in this frame (SIMBAD) plus real asteroids and comets (SkyBoT). Positions and proper motions are real.',
    'Las estrellas y galaxias reales de este campo (SIMBAD) y los asteroides y cometas reales (SkyBoT). Las posiciones y los movimientos propios son reales.',
    'Die echten Sterne und Galaxien dieses Ausschnitts (SIMBAD) sowie echte Asteroiden und Kometen (SkyBoT). Positionen und Eigenbewegungen sind echt.',
    'この視野の実在の恒星・銀河（SIMBAD）と実在の小惑星・彗星（SkyBoT）。位置と固有運動は実際の値です。',
  ],
  'rm.sim.desc': [
    'Eğitim amaçlı sentetik gökyüzü; keşfedilmeyi bekleyen gizli cisimler içerir.',
    'A synthetic training sky that contains hidden objects waiting to be discovered.',
    'Un cielo sintético de entrenamiento con objetos ocultos por descubrir.',
    'Ein synthetischer Trainingshimmel mit versteckten, noch zu entdeckenden Objekten.',
    '発見を待つ隠れた天体を含む、学習用の合成の空です。',
  ],
  'rm.loading': ['Gerçek gökyüzü kuruluyor…', 'Building the real sky…', 'Construyendo el cielo real…', 'Der echte Himmel wird aufgebaut…', '実際の空を構築中…'],
  'rm.loading.sub': [
    'SIMBAD’den bu karedeki gerçek cisimler, SkyBoT’tan dört tarihteki Güneş Sistemi cisimleri indiriliyor.',
    'Downloading the real objects in this frame from SIMBAD and the Solar System bodies at the four dates from SkyBoT.',
    'Descargando de SIMBAD los objetos reales de este campo y de SkyBoT los cuerpos del Sistema Solar en las cuatro fechas.',
    'Lade die echten Objekte dieses Ausschnitts von SIMBAD und die Sonnensystemkörper zu den vier Terminen von SkyBoT.',
    'この視野の実在の天体をSIMBADから、4つの日付の太陽系天体をSkyBoTから取得しています。',
  ],
  'rm.loading.parts': ['SIMBAD: {s} · SkyBoT: {k}/4', 'SIMBAD: {s} · SkyBoT: {k}/4', 'SIMBAD: {s} · SkyBoT: {k}/4', 'SIMBAD: {s} · SkyBoT: {k}/4', 'SIMBAD: {s} · SkyBoT: {k}/4'],
  'rm.skip': ['Simülasyonu kullan', 'Use the simulation', 'Usar la simulación', 'Simulation verwenden', 'シミュレーションを使う'],
  'rm.stat.simbad': ['SIMBAD: {n} gerçek cisim', 'SIMBAD: {n} real objects', 'SIMBAD: {n} objetos reales', 'SIMBAD: {n} echte Objekte', 'SIMBAD: 実在の天体 {n}個'],
  'rm.stat.trunc': ['(en parlak {n} cisim gösteriliyor)', '(showing the {n} brightest)', '(se muestran los {n} más brillantes)', '(die {n} hellsten werden gezeigt)', '（明るい順に{n}個を表示）'],
  'rm.stat.movers': ['Hareketli: {n} cisim', 'Moving: {n} objects', 'En movimiento: {n} objetos', 'Bewegt: {n} Objekte', '移動天体: {n}個'],
  'rm.stat.skybot.ok': ['SkyBoT: {n} Güneş Sistemi cismi', 'SkyBoT: {n} Solar System bodies', 'SkyBoT: {n} cuerpos del Sistema Solar', 'SkyBoT: {n} Sonnensystemkörper', 'SkyBoT: 太陽系天体 {n}個'],
  'rm.stat.skybot.none': ['SkyBoT: bu karede bilinen Güneş Sistemi cismi yok', 'SkyBoT: no known Solar System bodies in this frame', 'SkyBoT: no hay cuerpos conocidos del Sistema Solar en este campo', 'SkyBoT: keine bekannten Sonnensystemkörper in diesem Ausschnitt', 'SkyBoT: この視野に既知の太陽系天体はありません'],
  'rm.stat.skybot.fail': [
    'SkyBoT’a ulaşılamadı — yalnızca yıldız ve galaksi kataloğu gösteriliyor.',
    'SkyBoT could not be reached — only the star and galaxy catalogue is shown.',
    'No se pudo contactar con SkyBoT: solo se muestra el catálogo de estrellas y galaxias.',
    'SkyBoT war nicht erreichbar – es wird nur der Stern- und Galaxienkatalog gezeigt.',
    'SkyBoTに接続できませんでした。恒星と銀河のカタログのみ表示しています。',
  ],
  'rm.stat.skybot.part': ['SkyBoT yalnızca {a}/4 tarihte yanıt verdi.', 'SkyBoT answered for only {a} of 4 dates.', 'SkyBoT respondió solo en {a} de las 4 fechas.', 'SkyBoT antwortete nur für {a} von 4 Terminen.', 'SkyBoTは4つの日付のうち{a}つにしか応答しませんでした。'],
  'rm.model': [
    'Dürüst not: konum, özdevinim ve paralaks gerçektir; ancak 102 bantlı görüntü ve spektrumlar katalog parlaklığına ölçeklenmiş bir MODELdir, SPHEREx’in ölçtüğü değildir. Gerçek SPHEREx ölçümü için “Gerçek SPHEREx Verisi” sekmesini kullanın.',
    'Honest note: position, proper motion and parallax are real, but the 102-band image and spectra are a MODEL scaled to catalogue brightness — not what SPHEREx measured. For real SPHEREx measurements use the “Real SPHEREx Data” tab.',
    'Nota honesta: la posición, el movimiento propio y la paralaje son reales, pero la imagen y los espectros de 102 bandas son un MODELO escalado al brillo del catálogo, no lo que midió SPHEREx. Para mediciones reales de SPHEREx use la pestaña «Datos reales de SPHEREx».',
    'Ehrlicher Hinweis: Position, Eigenbewegung und Parallaxe sind echt, aber Bild und 102-Band-Spektren sind ein auf die Katalog-Helligkeit skaliertes MODELL – nicht das, was SPHEREx gemessen hat. Echte SPHEREx-Messungen finden Sie im Tab „Echte SPHEREx-Daten“.',
    '正直な注記: 位置・固有運動・年周視差は実際の値ですが、102バンドの画像とスペクトルはカタログの明るさに合わせたモデルであり、SPHERExが測定したものではありません。実際のSPHEREx測定は「SPHEREx実データ」タブをご利用ください。',
  ],
  'rm.model.short': [
    'Bu cismin görüntüsü ve spektrumu, katalog parlaklığından hesaplanan bir MODELdir; ölçülmüş SPHEREx verisi değildir. Konum ve hareket ise gerçektir.',
    'The image and spectrum of this object are a MODEL computed from its catalogue brightness — not measured SPHEREx data. Its position and motion are real.',
    'La imagen y el espectro de este objeto son un MODELO calculado a partir de su brillo en el catálogo, no datos medidos de SPHEREx. Su posición y movimiento sí son reales.',
    'Bild und Spektrum dieses Objekts sind ein aus seiner Katalog-Helligkeit berechnetes MODELL – keine gemessenen SPHEREx-Daten. Position und Bewegung sind dagegen echt.',
    'この天体の画像とスペクトルはカタログの明るさから計算したモデルで、SPHERExの測定データではありません。位置と動きは実際の値です。',
  ],
  'rm.noMove': [
    'Not: 1,5 yıllık sürede çoğu yıldızın gerçek kayması pikselin altında kalır. Hareketi görmek için aşağıdan özdevinimi büyük bir yıldız seçin.',
    'Note: over 1.5 years the real shift of most stars stays below one pixel. To see motion, pick a high-proper-motion star below.',
    'Nota: en 1,5 años el desplazamiento real de la mayoría de las estrellas queda por debajo de un píxel. Para ver movimiento, elija abajo una estrella de gran movimiento propio.',
    'Hinweis: In 1,5 Jahren bleibt die echte Verschiebung der meisten Sterne unter einem Pixel. Um Bewegung zu sehen, wählen Sie unten einen Stern mit hoher Eigenbewegung.',
    '注: 1.5年間では、ほとんどの恒星の実際の移動は1ピクセル未満です。動きを見るには、下から固有運動の大きい恒星を選んでください。',
  ],
  'rm.quick': ['Hızlı gerçek hedefler', 'Quick real targets', 'Objetivos reales rápidos', 'Schnelle echte Ziele', 'クイック実ターゲット'],
  'rm.quick.help': [
    'Özdevinimi büyük gerçek yıldızlar: haritayı bu yıldızın etrafına taşır; dört tarih arasındaki kayması gerçek veriyle görünür.',
    'Real stars with large proper motion: centres the map on the star so its real shift between the four dates becomes visible.',
    'Estrellas reales de gran movimiento propio: centra el mapa en la estrella para ver su desplazamiento real entre las cuatro fechas.',
    'Echte Sterne mit großer Eigenbewegung: zentriert die Karte auf den Stern, sodass seine echte Verschiebung zwischen den vier Terminen sichtbar wird.',
    '固有運動の大きい実在の恒星です。地図をその星の周りに移し、4つの日付の間の実際の移動を確認できます。',
  ],
  'rm.chip.real': ['Gerçek: {n} cisim · {m} hareketli', 'Real: {n} objects · {m} moving', 'Real: {n} objetos · {m} en movimiento', 'Echt: {n} Objekte · {m} bewegt', '実データ: {n}個 · 移動{m}個'],
  'rm.empty': [
    'Bu karede SIMBAD ve SkyBoT’tan {n} gerçek cisim var ({m} hareketli). Gerçek bir cisme tıklayın; hareketi görmek için soldaki “Hızlı gerçek hedefler”den birini seçin.',
    'This frame holds {n} real objects from SIMBAD and SkyBoT ({m} moving). Click a real object; to see motion pick one of the “Quick real targets” on the left.',
    'Este campo contiene {n} objetos reales de SIMBAD y SkyBoT ({m} en movimiento). Haga clic en un objeto real; para ver movimiento elija uno de los «Objetivos reales rápidos» de la izquierda.',
    'Dieser Ausschnitt enthält {n} echte Objekte aus SIMBAD und SkyBoT ({m} bewegt). Klicken Sie ein echtes Objekt an; für Bewegung wählen Sie links eines der „Schnellen echten Ziele“.',
    'この視野にはSIMBADとSkyBoTの実在の天体が{n}個あります（移動{m}個）。実在の天体をクリックしてください。動きを見るには、左の「クイック実ターゲット」から選びます。',
  ],
  'rm.sim.hint': [
    'Eğitim amaçlı sentetik gökyüzü. Gerçek katalog verisine geçmek için yukarıdan “Gerçek veri”yi seçin.',
    'A synthetic training sky. To switch to real catalogue data pick “Real data” above.',
    'Un cielo sintético de entrenamiento. Para pasar a datos reales de catálogo, elija «Datos reales» arriba.',
    'Ein synthetischer Trainingshimmel. Für echte Katalogdaten wählen Sie oben „Echtdaten“.',
    '学習用の合成の空です。実際のカタログデータに切り替えるには、上の「実データ」を選んでください。',
  ],
  'rm.gain.real': [
    'Gerçek veride hareket büyütülmez: çarpan ×1’dir, ölçülen hareket doğrudan gerçek değerdir.',
    'Real data is never exaggerated: the factor is ×1 and the measured motion is the real value.',
    'Los datos reales no se exageran: el factor es ×1 y el movimiento medido es el valor real.',
    'Echtdaten werden nicht verstärkt: Der Faktor ist ×1, die gemessene Bewegung ist der echte Wert.',
    '実データでは動きを誇張しません。倍率は×1で、測定された動きがそのまま実際の値です。',
  ],
  'rm.credit': [
    'Konum ve özdevinimler: SIMBAD (CDS) · Güneş Sistemi efemerisi: SkyBoT (IMCCE) · Fotoğraflar: 2MASS, AllWISE (CDS hips2fits).',
    'Positions and proper motions: SIMBAD (CDS) · Solar System ephemerides: SkyBoT (IMCCE) · Photos: 2MASS, AllWISE (CDS hips2fits).',
    'Posiciones y movimientos propios: SIMBAD (CDS) · Efemérides del Sistema Solar: SkyBoT (IMCCE) · Fotos: 2MASS, AllWISE (CDS hips2fits).',
    'Positionen und Eigenbewegungen: SIMBAD (CDS) · Sonnensystem-Ephemeriden: SkyBoT (IMCCE) · Fotos: 2MASS, AllWISE (CDS hips2fits).',
    '位置と固有運動: SIMBAD（CDS）・太陽系天体の暦: SkyBoT（IMCCE）・写真: 2MASS、AllWISE（CDS hips2fits）。',
  ],

  // ── Gerçek fotoğraf kipi ──
  'mode.photo.n': ['Gerçek Fotoğraf', 'Real Photo', 'Foto real', 'Echtes Foto', '実写真'],
  'mode.photo.s': ['2MASS ⇄ AllWISE', '2MASS ⇄ AllWISE', '2MASS ⇄ AllWISE', '2MASS ⇄ AllWISE', '2MASS ⇄ AllWISE'],
  'tip.mode.photo': [
    '2MASS (≈1999, 1,2–2,2 µm) ve AllWISE (≈2010, 3,4–22 µm) taramalarından GERÇEK gökyüzü fotoğrafını gösterir. Alttaki dalga boyu kaydırıcısı iki fotoğraf arasında geçiş yapar. Fotoğraf SPHEREx verisi değildir; üzerindeki işaretler seçili tarihteki katalog konumlarıdır.',
    'Shows the REAL sky photo from the 2MASS (≈1999, 1.2–2.2 µm) and AllWISE (≈2010, 3.4–22 µm) surveys. The wavelength slider below cross-fades between the two photos. The photo is not SPHEREx data; the marks on it are catalogue positions at the selected date.',
    'Muestra la foto REAL del cielo de los sondeos 2MASS (≈1999, 1,2–2,2 µm) y AllWISE (≈2010, 3,4–22 µm). El control de longitud de onda de abajo mezcla ambas fotos. La foto no son datos de SPHEREx; las marcas son posiciones del catálogo en la fecha elegida.',
    'Zeigt das ECHTE Himmelsfoto aus den Durchmusterungen 2MASS (≈1999, 1,2–2,2 µm) und AllWISE (≈2010, 3,4–22 µm). Der Wellenlängenregler unten blendet zwischen beiden Fotos über. Das Foto sind keine SPHEREx-Daten; die Markierungen sind Katalogpositionen zum gewählten Datum.',
    '2MASS（約1999年、1.2〜2.2 µm）とAllWISE（約2010年、3.4〜22 µm）サーベイの「実際の」空の写真を表示します。下の波長スライダーで2枚の写真が切り替わります。写真はSPHERExのデータではなく、上のマークは選択した日付のカタログ位置です。',
  ],
  'rm.photo.loading': ['Gerçek gökyüzü fotoğrafı indiriliyor…', 'Downloading the real sky photo…', 'Descargando la foto real del cielo…', 'Das echte Himmelsfoto wird geladen…', '実際の空の写真を取得中…'],
  'rm.photo.hud': ['Gerçek fotoğraf · {src}', 'Real photo · {src}', 'Foto real · {src}', 'Echtes Foto · {src}', '実写真 · {src}'],
  'rm.photo.cat': ['Katalog konumları: {e}', 'Catalogue positions: {e}', 'Posiciones del catálogo: {e}', 'Katalogpositionen: {e}', 'カタログ位置: {e}'],
  'rm.photo.note': [
    'Fotoğraflar 2MASS (≈1999) ve AllWISE (≈2010) taramalarındandır, SPHEREx değildir. Üzerindeki işaretler seçili tarihteki katalog konumlarıdır; özdevinimi büyük yıldızlar fotoğraftaki yerinden kaymış görünür.',
    'The photos come from the 2MASS (≈1999) and AllWISE (≈2010) surveys, not from SPHEREx. The marks are catalogue positions at the selected date, so high-proper-motion stars appear displaced from their place in the photo.',
    'Las fotos proceden de los sondeos 2MASS (≈1999) y AllWISE (≈2010), no de SPHEREx. Las marcas son posiciones del catálogo en la fecha elegida, así que las estrellas de gran movimiento propio aparecen desplazadas respecto a la foto.',
    'Die Fotos stammen aus den Durchmusterungen 2MASS (≈1999) und AllWISE (≈2010), nicht von SPHEREx. Die Markierungen sind Katalogpositionen zum gewählten Datum; Sterne mit hoher Eigenbewegung erscheinen daher gegenüber dem Foto verschoben.',
    '写真は2MASS（約1999年）とAllWISE（約2010年）のサーベイのもので、SPHERExではありません。マークは選択した日付のカタログ位置のため、固有運動の大きい恒星は写真上の位置からずれて見えます。',
  ],
  'rm.photo.fail': [
    'Gerçek fotoğraf alınamadı ({reason}) — katalog görünümüne dönüldü.',
    'The real photo could not be loaded ({reason}) — back to the catalogue view.',
    'No se pudo cargar la foto real ({reason}): se volvió a la vista de catálogo.',
    'Das echte Foto konnte nicht geladen werden ({reason}) – zurück zur Katalogansicht.',
    '実写真を取得できませんでした（{reason}）。カタログ表示に戻しました。',
  ],
  'rm.photo.cors': [
    'Tarayıcı bu fotoğrafın yalnızca gösterilmesine izin verdi; bu görünümde PNG kaydı çalışmayabilir.',
    'The browser allowed this photo to be displayed only; saving a PNG may not work in this view.',
    'El navegador permitió solo mostrar esta foto; guardar un PNG puede no funcionar en esta vista.',
    'Der Browser erlaubt nur die Anzeige dieses Fotos; das Speichern als PNG funktioniert in dieser Ansicht eventuell nicht.',
    'ブラウザはこの写真の表示のみ許可しました。この表示ではPNG保存が動作しない場合があります。',
  ],

  // ── Gerçek cisim kartı (seçim) ──
  'rm.card.title': ['Gerçek katalog kaydı', 'Real catalogue record', 'Registro real del catálogo', 'Echter Katalogeintrag', '実カタログのレコード'],
  'rm.f.otype': ['SIMBAD türü', 'SIMBAD type', 'Tipo SIMBAD', 'SIMBAD-Typ', 'SIMBAD分類'],
  'rm.f.sp': ['Tayf türü', 'Spectral type', 'Tipo espectral', 'Spektraltyp', 'スペクトル型'],
  'rm.f.mag': ['Parlaklık (katalog)', 'Brightness (catalogue)', 'Brillo (catálogo)', 'Helligkeit (Katalog)', '明るさ（カタログ）'],
  'rm.f.pm': ['Özdevinim', 'Proper motion', 'Movimiento propio', 'Eigenbewegung', '固有運動'],
  'rm.f.plx': ['Paralaks', 'Parallax', 'Paralaje', 'Parallaxe', '年周視差'],
  'rm.f.cls': ['Sınıf (SkyBoT)', 'Class (SkyBoT)', 'Clase (SkyBoT)', 'Klasse (SkyBoT)', '分類（SkyBoT）'],
  'rm.open.simbad': ['SIMBAD’de aç', 'Open in SIMBAD', 'Abrir en SIMBAD', 'In SIMBAD öffnen', 'SIMBADで開く'],
  'rm.open.mpc': ['MPC’de ara', 'Search at the MPC', 'Buscar en el MPC', 'Beim MPC suchen', 'MPCで検索'],

  // ── Tür adları (gerçek alan) ──
  'kind.rstar': ['Yıldız ({cls})', 'Star ({cls})', 'Estrella ({cls})', 'Stern ({cls})', '恒星（{cls}）'],
  'kind.rvar': ['Değişen yıldız', 'Variable star', 'Estrella variable', 'Veränderlicher Stern', '変光星'],
  'kind.rbd': ['Kahverengi cüce / çok soğuk cüce', 'Brown dwarf / very cool dwarf', 'Enana marrón / enana muy fría', 'Brauner Zwerg / sehr kühler Zwerg', '褐色矮星／超低温矮星'],
  'kind.rhpm': ['Yüksek özdevinimli yıldız', 'High-proper-motion star', 'Estrella de gran movimiento propio', 'Stern mit hoher Eigenbewegung', '固有運動の大きい恒星'],
  'kind.rast': ['Asteroit (SkyBoT)', 'Asteroid (SkyBoT)', 'Asteroide (SkyBoT)', 'Asteroid (SkyBoT)', '小惑星（SkyBoT）'],
  'kind.rcom': ['Kuyruklu yıldız (SkyBoT)', 'Comet (SkyBoT)', 'Cometa (SkyBoT)', 'Komet (SkyBoT)', '彗星（SkyBoT）'],
  'kind.rkbo': ['Centaur / uzak Güneş Sistemi cismi (SkyBoT)', 'Centaur / distant Solar System body (SkyBoT)', 'Centauro / cuerpo lejano del Sistema Solar (SkyBoT)', 'Zentaur / ferner Körper des Sonnensystems (SkyBoT)', 'ケンタウルス族／遠方の太陽系天体（SkyBoT）'],
  'kind.robj': ['Bulutsu, küme ya da diğer yayılı cisim', 'Nebula, cluster or other extended object', 'Nebulosa, cúmulo u otro objeto extendido', 'Nebel, Haufen oder anderes ausgedehntes Objekt', '星雲・星団などの広がった天体'],

  // ── Veri kaynağı rozeti · menü · geri düşüş (harita) ──
  'src.maplive': ['CANLI SIMBAD / SkyBoT VERİSİ AKTİF', 'LIVE SIMBAD / SkyBoT DATA ACTIVE', 'DATOS EN VIVO SIMBAD / SkyBoT ACTIVOS', 'LIVE-DATEN SIMBAD / SkyBoT AKTIV', 'SIMBAD／SkyBoT ライブデータ有効'],
  'src.maplive.s': ['CANLI KATALOG', 'LIVE CATALOGUE', 'CATÁLOGO EN VIVO', 'LIVE-KATALOG', 'ライブカタログ'],
  'src.mapprobing': ['SIMBAD / SkyBoT BAĞLANTISI DENENİYOR…', 'TRYING SIMBAD / SkyBoT CONNECTION…', 'PROBANDO CONEXIÓN SIMBAD / SkyBoT…', 'SIMBAD-/SkyBoT-VERBINDUNG WIRD GETESTET…', 'SIMBAD／SkyBoT接続を確認中…'],
  'src.mapprobing.s': ['BAĞLANIYOR…', 'CONNECTING…', 'CONECTANDO…', 'VERBINDE…', '接続中…'],
  'src.opt.maplive.t': ['Gerçek gökyüzü (SIMBAD · SkyBoT · 2MASS/AllWISE)', 'Real sky (SIMBAD · SkyBoT · 2MASS/AllWISE)', 'Cielo real (SIMBAD · SkyBoT · 2MASS/AllWISE)', 'Echter Himmel (SIMBAD · SkyBoT · 2MASS/AllWISE)', '実際の空（SIMBAD・SkyBoT・2MASS/AllWISE）'],
  'src.opt.maplive.d': [
    'Haritadaki kare için gerçek cisimler, özdevinimler ve Güneş Sistemi efemerisi internetten çekilir; “Gerçek Fotoğraf” kipi 2MASS/AllWISE görüntüsünü gösterir.',
    'Real objects, proper motions and Solar System ephemerides for the map frame are fetched over the internet; the “Real Photo” mode shows the 2MASS/AllWISE image.',
    'Los objetos reales, movimientos propios y efemérides del Sistema Solar del campo del mapa se descargan de internet; el modo «Foto real» muestra la imagen 2MASS/AllWISE.',
    'Echte Objekte, Eigenbewegungen und Sonnensystem-Ephemeriden für den Kartenausschnitt werden aus dem Internet geladen; der Modus „Echtes Foto“ zeigt das 2MASS-/AllWISE-Bild.',
    '地図の視野に対応する実在の天体・固有運動・太陽系天体の暦をインターネットから取得します。「実写真」モードでは2MASS／AllWISEの画像を表示します。',
  ],
  'rm.st.ok': ['{n} gerçek cisim yüklü', '{n} real objects loaded', '{n} objetos reales cargados', '{n} echte Objekte geladen', '実在の天体{n}個を読み込み済み'],
  'rm.fb.title': [
    'Gerçek harita verisi alınamadı — simülasyon motoruna geçildi',
    'Real map data unavailable — switched to the simulation engine',
    'Datos reales del mapa no disponibles: se pasó al motor de simulación',
    'Echte Kartendaten nicht erreichbar – zur Simulation gewechselt',
    '実データを取得できません — シミュレーションに切り替えました',
  ],
  'rm.fb.body': [
    'Neden: {reason}. Uygulama çalışmaya devam ediyor; bağlantı olduğunda “Yeniden dene” ile gerçek gökyüzüne dönebilirsiniz.',
    'Reason: {reason}. The app keeps working; once a connection is available you can return to the real sky with “Try again”.',
    'Motivo: {reason}. La app sigue funcionando; cuando haya conexión puede volver al cielo real con “Reintentar”.',
    'Grund: {reason}. Die App läuft weiter; sobald eine Verbindung besteht, kommen Sie mit „Erneut versuchen“ zum echten Himmel zurück.',
    '理由: {reason}。アプリはそのまま動作します。接続が回復したら「再試行」で実際の空に戻れます。',
  ],
  'src.reason.empty': ['bu karede katalogda cisim bulunamadı', 'the catalogue has no objects in this frame', 'el catálogo no tiene objetos en este campo', 'der Katalog enthält keine Objekte in diesem Ausschnitt', 'この視野にはカタログの天体がありません'],
  'src.reason.server': ['sunucu hata döndürdü', 'the server returned an error', 'el servidor devolvió un error', 'der Server meldete einen Fehler', 'サーバーがエラーを返しました'],
  'badge.mapreal': ['GERÇEK KATALOG VERİSİ', 'REAL CATALOGUE DATA', 'DATOS REALES DE CATÁLOGO', 'ECHTE KATALOGDATEN', '実カタログデータ'],
  'about.rights': [
    'Bu uygulamayı Elif Turut hazırladı. © {year} Elif Turut — Tüm hakları saklıdır.',
    'This application was created by Elif Turut. © {year} Elif Turut — All rights reserved.',
    'Esta aplicación fue creada por Elif Turut. © {year} Elif Turut — Todos los derechos reservados.',
    'Diese Anwendung wurde von Elif Turut erstellt. © {year} Elif Turut – Alle Rechte vorbehalten.',
    'このアプリケーションはElif Turutが制作しました。© {year} Elif Turut — 無断転載を禁じます。',
  ],
  // ───────── PROTOTİP DEMO rozeti ─────────
  'proto.badge': ['PROTOTİP DEMO', 'PROTOTYPE DEMO', 'PROTOTIPO DEMO', 'PROTOTYP-DEMO', 'プロトタイプ デモ'],
  'proto.title': ['Konsept kanıtı (Proof-of-Concept)', 'Proof-of-Concept prototype', 'Prototipo de prueba de concepto', 'Proof-of-Concept-Prototyp', '概念実証（PoC）プロトタイプ'],
  'tip.proto': [
    'Bu araç NASA Space Apps için geliştirilmiş bir konsept kanıtı (Proof-of-Concept) prototipidir. SIMBAD TAP (ADQL), IMCCE SkyBoT, CDS hips2fits (2MASS/AllWISE), NASA/IPAC IRSA (SPHEREx Seviye-2 kesitleri; erişilebildiğinde) ve yerel FITS/WCS okuyucu gerçek verilerle çalışır; Keşif Haritası’ndaki ve simülasyondaki 102 bantlı SPHEREx spektral küpleri ise fiziksel olarak gerçekçi (Planck + moleküler soğurma) sentetik/model katmanıdır, SPHEREx ölçümü değildir.',
    'This tool is a Proof-of-Concept prototype developed for NASA Space Apps. SIMBAD TAP (ADQL), IMCCE SkyBoT, CDS hips2fits (2MASS/AllWISE), NASA/IPAC IRSA (SPHEREx Level-2 cutouts, when reachable) and the local FITS/WCS reader work with real data; the 102-band SPHEREx spectral cubes of the Sky Explorer and of the simulation are a physically realistic (Planck + molecular absorption) synthetic/model layer, not SPHEREx measurements.',
    'Esta herramienta es un prototipo de prueba de concepto (Proof-of-Concept) desarrollado para NASA Space Apps. SIMBAD TAP (ADQL), IMCCE SkyBoT, CDS hips2fits (2MASS/AllWISE), NASA/IPAC IRSA (recortes de nivel 2 de SPHEREx, cuando es accesible) y el lector local FITS/WCS funcionan con datos reales; los cubos espectrales de 102 bandas tipo SPHEREx del Mapa de exploración y de la simulación son una capa sintética/de modelo físicamente realista (Planck + absorción molecular), no mediciones de SPHEREx.',
    'Dieses Werkzeug ist ein Proof-of-Concept-Prototyp, der für NASA Space Apps entwickelt wurde. SIMBAD TAP (ADQL), IMCCE SkyBoT, CDS hips2fits (2MASS/AllWISE), NASA/IPAC IRSA (SPHEREx-Level-2-Ausschnitte, sofern erreichbar) und der lokale FITS/WCS-Leser arbeiten mit echten Daten; die 102-Band-Spektralwürfel der Entdeckerkarte und der Simulation sind eine physikalisch realistische (Planck + molekulare Absorption) synthetische Modellschicht – keine SPHEREx-Messungen.',
    'このツールは NASA Space Apps のために開発された概念実証（Proof-of-Concept）プロトタイプです。SIMBAD TAP（ADQL）、IMCCE SkyBoT、CDS hips2fits（2MASS/AllWISE）、NASA/IPAC IRSA（SPHEREx レベル2カットアウト、接続可能な場合）、およびローカルの FITS/WCS リーダーは実際のデータで動作します。一方、探査マップとシミュレーションの102バンド SPHEREx 型スペクトルキューブは、物理的にもっともらしい（プランク＋分子吸収）合成／モデル層であり、SPHEREx の測定値ではありません。',
  ],

  // ───────── Python (astropy) betiği dışa aktarımı ─────────
  'py.btn': ['Python (astropy) Betiği İndir', 'Export Python (astropy) Script (.py)', 'Descargar script Python (astropy) (.py)', 'Python-(astropy)-Skript herunterladen (.py)', 'Python（astropy）スクリプトをダウンロード (.py)'],
  'py.btn.s': ['Python (.py)', 'Python (.py)', 'Python (.py)', 'Python (.py)', 'Python (.py)'],
  'py.pick': ['Önce bir kayıt seçin — betik seçili cisim için üretilir', 'Select a record first — the script is generated for the selected object', 'Seleccione primero un registro: el script se genera para el objeto seleccionado', 'Wählen Sie zuerst einen Eintrag – das Skript wird für das gewählte Objekt erzeugt', '先にレコードを選択してください。選択した天体のスクリプトを生成します'],
  'py.noData': ['Bu kayıt için gökyüzü verisi yok (ör. boş nokta); betik üretilemez', 'No sky data for this record (e.g. a blank point); no script can be generated', 'No hay datos del cielo para este registro (p. ej., un punto vacío); no se puede generar el script', 'Für diesen Eintrag liegen keine Himmelsdaten vor (z. B. ein leerer Punkt); es kann kein Skript erzeugt werden', 'このレコードには空のデータがありません（例：空白点）。スクリプトを生成できません'],
  'py.needMap': ['Bu kayıt gerçek haritada alındı ve o gökyüzü bu oturumda yüklü değil — önce “Haritada Göster & İncele” ile açın', 'This record comes from the real map and that sky is not loaded in this session — open it first with “Show on Map & Inspect”', 'Este registro viene del mapa real y ese cielo no está cargado en esta sesión: ábralo primero con «Mostrar en el mapa e inspeccionar»', 'Dieser Eintrag stammt von der echten Karte und dieser Himmel ist in dieser Sitzung nicht geladen – öffnen Sie ihn zuerst mit „Auf Karte zeigen & untersuchen“', 'このレコードは実データのマップ由来で、その空はこのセッションでは読み込まれていません。先に「地図で表示して調べる」で開いてください'],
  'py.done': ['Python betiği indirildi: {name}', 'Python script downloaded: {name}', 'Script de Python descargado: {name}', 'Python-Skript heruntergeladen: {name}', 'Pythonスクリプトをダウンロードしました：{name}'],
  'tip.py': [
    'Seçili cismin ölçülen RA/Dec konumunu, ölçülen özdevinimini (muRA, muDec), teşhis edilen sınıfını ve seçili tarihlerdeki 102 bantlı spektrumu (BAND_LAMBDA + akı dizileri) gömen, doğrudan çalıştırılabilir bir Python dosyası indirir. Betik astropy (SkyCoord, units), astroquery.simbad (katalog doğrulaması) ve matplotlib kullanır; spektrumu su buzu (3.0 µm), CO₂ (4.26 µm) ve CH₄ (1.6 ve 3.3 µm) şeritleriyle çizer. Veri kökeni (gerçek katalog / model spektrum / sentetik) dosyanın başında açıkça yazılır.',
    'Downloads a ready-to-run Python file that embeds the selected object’s measured RA/Dec, measured proper motion (muRA, muDec), diagnosed class and the 102-band spectrum (BAND_LAMBDA + flux arrays) for the chosen dates. The script uses astropy (SkyCoord, units), astroquery.simbad (catalogue check) and matplotlib, and plots the spectrum with the water-ice (3.0 µm), CO₂ (4.26 µm) and CH₄ (1.6 and 3.3 µm) bands. The data origin (real catalogue / model spectrum / synthetic) is stated at the top of the file.',
    'Descarga un archivo Python listo para ejecutar que incorpora el RA/Dec medido del objeto seleccionado, su movimiento propio medido (muRA, muDec), la clase diagnosticada y el espectro de 102 bandas (BAND_LAMBDA + arrays de flujo) de las fechas elegidas. El script usa astropy (SkyCoord, units), astroquery.simbad (verificación del catálogo) y matplotlib, y dibuja el espectro con las bandas de hielo de agua (3,0 µm), CO₂ (4,26 µm) y CH₄ (1,6 y 3,3 µm). El origen de los datos (catálogo real / espectro de modelo / sintético) se indica al principio del archivo.',
    'Lädt eine direkt ausführbare Python-Datei herunter, die RA/Dec, gemessene Eigenbewegung (muRA, muDec), diagnostizierte Klasse und das 102-Band-Spektrum (BAND_LAMBDA + Flussarrays) des gewählten Objekts für die gewählten Termine einbettet. Das Skript nutzt astropy (SkyCoord, units), astroquery.simbad (Katalogabgleich) und matplotlib und zeichnet das Spektrum mit den Banden von Wassereis (3,0 µm), CO₂ (4,26 µm) und CH₄ (1,6 und 3,3 µm). Die Datenherkunft (echter Katalog / Modellspektrum / synthetisch) steht am Anfang der Datei.',
    '選択した天体の測定済みRA/Dec、測定した固有運動（muRA, muDec）、診断クラス、選んだ日付の102バンドスペクトル（BAND_LAMBDA＋フラックス配列）を埋め込んだ、そのまま実行できるPythonファイルをダウンロードします。スクリプトは astropy（SkyCoord, units）、astroquery.simbad（カタログ照合）、matplotlib を使い、水氷（3.0 µm）、CO₂（4.26 µm）、CH₄（1.6・3.3 µm）の吸収帯付きでスペクトルを描画します。データの由来（実カタログ／モデルスペクトル／合成）はファイル冒頭に明記されます。',
  ],

  // ───────── IRSA erişilemezse: tek tıkla devam (CORS geri düşüşü) ─────────
  'real.fb.title': ['Kesintisiz devam etmenin iki yolu', 'Two ways to keep going without interruption', 'Dos formas de continuar sin interrupción', 'Zwei Wege, ohne Unterbrechung weiterzumachen', '中断せずに続ける2つの方法'],
  'real.fb.body': [
    'Tarayıcı IRSA TAP sunucusuna doğrudan erişemiyor (çoğunlukla CORS engeli). Aşağıdaki seçeneklerden biriyle tek tıkla devam edebilirsiniz.',
    'The browser cannot reach the IRSA TAP server directly (usually a CORS block). Either option below lets you continue with one click.',
    'El navegador no puede acceder directamente al servidor TAP de IRSA (normalmente un bloqueo CORS). Con cualquiera de las opciones siguientes puede continuar con un clic.',
    'Der Browser erreicht den IRSA-TAP-Server nicht direkt (meist eine CORS-Sperre). Mit einer der folgenden Optionen machen Sie mit einem Klick weiter.',
    'ブラウザがIRSA TAPサーバーに直接接続できません（多くはCORSによるブロック）。下のどちらかを1クリックで選んで続けられます。',
  ],
  'real.fb.sky': ['CDS + SIMBAD Canlı Gökyüzü Fotoğrafı Paneline Geç', 'Switch to the CDS + SIMBAD Live Sky Photo Panel', 'Cambiar al panel de fotografía del cielo en vivo CDS + SIMBAD', 'Zum CDS + SIMBAD-Live-Himmelsfoto-Panel wechseln', 'CDS＋SIMBADライブ天空写真パネルへ切り替え'],
  'real.fb.demo': ['Örnek FITS Kesiti Simüle Et (Çevrimdışı Demo)', 'Simulate a Sample FITS Cutout (Offline Demo)', 'Simular un recorte FITS de ejemplo (demo sin conexión)', 'Beispiel-FITS-Ausschnitt simulieren (Offline-Demo)', 'サンプルFITSカットアウトをシミュレート（オフラインデモ）'],
  'tip.real.fb.demo': [
    'Çevrimdışı demo, seçili hedef için SPHEREx Seviye-2 biçiminde SENTETİK FITS kesitleri (IMAGE, FLAGS, VARIANCE, ZODI, WCS-WAVE; TAN-SIP WCS) tarayıcıda üretir ve gerçek analiz hattından (FITS ayrıştırma → açıklık fotometrisi → özdevinim ve SED uyumu) geçirir. Bu bir SİMÜLASYONDUR: gerçek SPHEREx verisi değildir ve katalogda gerçek ölçüm olarak kaydedilemez.',
    'The offline demo builds SYNTHETIC FITS cutouts in SPHEREx Level-2 layout (IMAGE, FLAGS, VARIANCE, ZODI, WCS-WAVE; TAN-SIP WCS) for the selected target in your browser and runs them through the real analysis pipeline (FITS parsing → aperture photometry → proper-motion and SED fit). It is a SIMULATION: it is not SPHEREx data and cannot be saved to the catalogue as a real measurement.',
    'La demo sin conexión genera en el navegador recortes FITS SINTÉTICOS con el formato de nivel 2 de SPHEREx (IMAGE, FLAGS, VARIANCE, ZODI, WCS-WAVE; WCS TAN-SIP) para el objetivo seleccionado y los pasa por la canalización de análisis real (lectura FITS → fotometría de apertura → ajuste de movimiento propio y SED). Es una SIMULACIÓN: no son datos de SPHEREx y no puede guardarse en el catálogo como medición real.',
    'Die Offline-Demo erzeugt im Browser SYNTHETISCHE FITS-Ausschnitte im SPHEREx-Level-2-Layout (IMAGE, FLAGS, VARIANCE, ZODI, WCS-WAVE; TAN-SIP-WCS) für das gewählte Ziel und schickt sie durch die echte Analysekette (FITS-Parsing → Aperturphotometrie → Eigenbewegungs- und SED-Fit). Es ist eine SIMULATION: keine SPHEREx-Daten, und sie kann nicht als echte Messung im Katalog gespeichert werden.',
    'オフラインデモは、選択したターゲットについて SPHEREx レベル2形式（IMAGE, FLAGS, VARIANCE, ZODI, WCS-WAVE；TAN-SIP WCS）の合成FITSカットアウトをブラウザ内で生成し、実際の解析パイプライン（FITS解析→開口測光→固有運動とSEDフィット）に通します。これはシミュレーションです。SPHEREx の実データではなく、実測値としてカタログに保存することはできません。',
  ],
  'real.demo.chip': ['SİMÜLE DEMO', 'SIMULATED DEMO', 'DEMO SIMULADA', 'SIMULIERTE DEMO', 'シミュレーション・デモ'],
  'real.demo.watermark': ['SİMÜLE DEMO · GERÇEK SPHEREx VERİSİ DEĞİL', 'SIMULATED DEMO · NOT REAL SPHEREx DATA', 'DEMO SIMULADA · NO SON DATOS REALES DE SPHEREx', 'SIMULIERTE DEMO · KEINE ECHTEN SPHEREx-DATEN', 'シミュレーション・デモ・SPHEREx実データではありません'],
  'real.demo.banner': [
    'Bu kesitler tarayıcıda SİMÜLE edildi (çevrimdışı demo). Gerçek SPHEREx verisi değildir; ölçümler yalnızca analiz hattının nasıl çalıştığını göstermek içindir.',
    'These cutouts were SIMULATED in your browser (offline demo). They are not real SPHEREx data; the measurements only demonstrate how the analysis pipeline works.',
    'Estos recortes se SIMULARON en el navegador (demo sin conexión). No son datos reales de SPHEREx; las mediciones solo muestran cómo funciona la canalización de análisis.',
    'Diese Ausschnitte wurden im Browser SIMULIERT (Offline-Demo). Es sind keine echten SPHEREx-Daten; die Messungen zeigen nur, wie die Analysekette arbeitet.',
    'これらのカットアウトはブラウザ内でシミュレートされました（オフラインデモ）。SPHEREx の実データではなく、測定値は解析パイプラインの動作を示すだけです。',
  ],
  'real.demo.nosave': [
    'Simüle demo sonuçları katalogda gerçek ölçüm olarak kaydedilemez. Gerçek veriyle (IRSA ya da kendi FITS dosyanız) çalışın.',
    'Simulated demo results cannot be saved to the catalogue as real measurements. Work with real data (IRSA or your own FITS files).',
    'Los resultados de la demo simulada no pueden guardarse en el catálogo como mediciones reales. Trabaje con datos reales (IRSA o sus propios archivos FITS).',
    'Simulierte Demo-Ergebnisse können nicht als echte Messungen im Katalog gespeichert werden. Arbeiten Sie mit echten Daten (IRSA oder eigenen FITS-Dateien).',
    'シミュレーションの結果は実測値としてカタログに保存できません。実データ（IRSAまたはご自身のFITSファイル）で作業してください。',
  ],
  'real.demo.building': ['Sentetik FITS kesitleri üretiliyor ve analiz hattından geçiriliyor…', 'Building synthetic FITS cutouts and running them through the analysis pipeline…', 'Generando recortes FITS sintéticos y pasándolos por la canalización de análisis…', 'Synthetische FITS-Ausschnitte werden erzeugt und durch die Analysekette geschickt …', '合成FITSカットアウトを生成し、解析パイプラインに通しています…'],
  'real.demo.verdict': ['Simüle veride ölçüm (gerçek veri değil)', 'Measurement on simulated data (not real data)', 'Medición sobre datos simulados (no son datos reales)', 'Messung an simulierten Daten (keine echten Daten)', 'シミュレーションデータでの測定（実データではありません）'],
  'real.demo.why': [
    'Bu bir SİMÜLASYON: kesitler, seçili hedefin katalog özdevinimi ve bir Planck spektrumu kullanılarak tarayıcıda üretildi; analiz hattı bu kaymayı yeniden buldu. Gerçek bir SPHEREx ölçümü değildir, yalnızca yöntemin nasıl çalıştığını gösterir.',
    'This is a SIMULATION: the cutouts were generated in your browser from the selected target’s catalogue proper motion and a Planck spectrum, and the analysis pipeline recovered that drift. It is not a real SPHEREx measurement; it only shows how the method works.',
    'Esto es una SIMULACIÓN: los recortes se generaron en el navegador a partir del movimiento propio de catálogo del objetivo y de un espectro de Planck, y la canalización de análisis recuperó esa deriva. No es una medición real de SPHEREx; solo muestra cómo funciona el método.',
    'Dies ist eine SIMULATION: Die Ausschnitte wurden im Browser aus der Katalog-Eigenbewegung des gewählten Ziels und einem Planck-Spektrum erzeugt, und die Analysekette hat diese Drift wiedergefunden. Es ist keine echte SPHEREx-Messung; sie zeigt nur, wie die Methode funktioniert.',
    'これはシミュレーションです。カットアウトは、選択したターゲットのカタログ固有運動とプランク・スペクトルからブラウザ内で生成され、解析パイプラインがそのずれを再び検出しました。SPHEREx の実測ではなく、手法の動作を示すだけです。',
  ],
  'real.demo.failed': ['Demo kesitleri üretilemedi: {msg}', 'The demo cutouts could not be built: {msg}', 'No se pudieron generar los recortes de la demo: {msg}', 'Die Demo-Ausschnitte konnten nicht erzeugt werden: {msg}', 'デモのカットアウトを生成できませんでした：{msg}'],

  /* ---- v3 editoryal arayüz ---- */
  'ed.show': ['Göster', 'Show', 'Mostrar', 'Einblenden', '表示'],
  'ed.hide': ['Gizle', 'Hide', 'Ocultar', 'Ausblenden', '隠す'],
  'ed.controls': ['Kontroller', 'Controls', 'Controles', 'Steuerung', 'コントロール'],
  'ed.analysis': ['Analiz', 'Analysis', 'Análisis', 'Analyse', '解析'],
  'ed.results': ['Sonuçlar', 'Results', 'Resultados', 'Ergebnisse', '結果'],
  'ed.source': ['Kaynak', 'Source', 'Fuente', 'Quelle', 'ソース'],
  'ed.home': ['Ana sayfa', 'Home', 'Inicio', 'Start', 'ホーム'],
  'nx.tagline': ['NASA Space Apps · vatandaş bilimi prototipi', 'NASA Space Apps · citizen-science prototype', 'NASA Space Apps · prototipo de ciencia ciudadana', 'NASA Space Apps · Citizen-Science-Prototyp', 'NASA Space Apps · 市民科学プロトタイプ'],
  'nx.disclaimer': ['Resmî bir NASA ürünü değildir; NASA ile bağlantılı veya NASA tarafından onaylı değildir.', 'Unofficial prototype — not affiliated with or endorsed by NASA.', 'Prototipo no oficial: no está afiliado ni respaldado por la NASA.', 'Inoffizieller Prototyp — weder mit der NASA verbunden noch von ihr unterstützt.', '非公式プロトタイプです。NASAとは無関係で、NASAによる承認も受けていません。'],
  'nx.h.real': ['Gerçek SPHEREx verisi — gökyüzü alanı ve IRSA pikselleri', 'Real SPHEREx data — sky field & IRSA pixels', 'Datos reales de SPHEREx: campo de cielo y píxeles IRSA', 'Echte SPHEREx-Daten — Himmelsfeld & IRSA-Pixel', 'SPHEREx実データ — 天空フィールドとIRSAピクセル'],
  'nx.h.map': ['Keşif haritası — gökyüzünde zamana bağlı değişimler', 'Discovery map — time-domain changes across the sky', 'Mapa de descubrimiento: cambios temporales en el cielo', 'Entdeckungskarte — zeitliche Veränderungen am Himmel', '発見マップ — 空の時間変化'],
  'nx.h.catalog': ['Gökyüzü kataloğu — kayıtlı keşifler ve zaman arşivi', 'Sky catalog — saved discoveries & time archive', 'Catálogo del cielo: descubrimientos guardados y archivo temporal', 'Himmelskatalog — gespeicherte Entdeckungen & Zeitarchiv', '天体カタログ — 保存した発見と時間アーカイブ'],
  'nx.data': ['Veri', 'Data', 'Datos', 'Daten', 'データ'],
  'nx.brandSub': ['SPHEREx zaman alanı konsolu', 'SPHEREx time-domain console', 'Consola de dominio temporal SPHEREx', 'SPHEREx-Zeitbereichskonsole', 'SPHEREx 時間領域コンソール'],
  'nx.menu': ['Menü', 'Menu', 'Menú', 'Menü', 'メニュー'],
  'nx.menu.open': ['Menüyü aç', 'Open menu', 'Abrir menú', 'Menü öffnen', 'メニューを開く'],
  'nx.menu.close': ['Menüyü kapat', 'Close menu', 'Cerrar menú', 'Menü schließen', 'メニューを閉じる'],
  'nx.menu.nav': ['Ana bölümler', 'Main sections', 'Secciones principales', 'Hauptbereiche', 'メインセクション'],
  'nx.lang': ['Dil', 'Language', 'Idioma', 'Sprache', '言語'],
  'ed.detail': ['Ayrıntı', 'Detail', 'Detalle', 'Detail', '詳細'],
  'ed.index': ['Dizin', 'Index', 'Índice', 'Verzeichnis', 'インデックス'],

  /* ---- v3.5: yakınlaştırma · genişlet ---- */
  'zp.group': ['Yakınlaştırma düğmeleri', 'Zoom controls', 'Controles de zoom', 'Zoom-Steuerung', 'ズーム操作'],
  'zp.hint': ['Tekerlek: yakınlaştır · sürükle: kaydır · çift tık: ×2 · iki parmak: sıkıştır', 'Wheel: zoom · drag: pan · double-click: ×2 · two fingers: pinch', 'Rueda: zoom · arrastrar: mover · doble clic: ×2 · dos dedos: pellizcar', 'Rad: zoomen · ziehen: verschieben · Doppelklick: ×2 · zwei Finger: spreizen', 'ホイール：拡大縮小 · ドラッグ：移動 · ダブルクリック：×2 · 2本指：ピンチ'],
  'zp.expand': ['Sahneyi genişlet (tam ekran)', 'Enlarge the stage (full screen)', 'Ampliar la escena (pantalla completa)', 'Bühne vergrößern (Vollbild)', 'ステージを拡大（全画面）'],
  'zp.collapse': ['Küçült (Esc)', 'Shrink back (Esc)', 'Reducir (Esc)', 'Verkleinern (Esc)', '元に戻す（Esc）'],

  /* ---- v3.5: yeni kipler (Video · Toplam) ---- */
  'real.mode.movie.n': ['Video', 'Video', 'Vídeo', 'Video', '動画'],
  'real.mode.movie.s': ['kareleri sırayla oynat', 'play the frames in order', 'reproducir los cuadros en orden', 'Bilder der Reihe nach abspielen', 'コマを順に再生'],
  'real.mode.sum.n': ['Toplam', 'Stack', 'Suma', 'Summe', '加算'],
  'real.mode.sum.s': ['ekle · coadd · S/N↑', 'add · coadd · S/N↑', 'sumar · coadd · S/N↑', 'addieren · Coadd · S/N↑', '加算・コアッド・S/N↑'],
  'tip.real.mode.movie': [
    'Seçtiğiniz alanın SPHEREx karelerini küçük bir video gibi sırayla oynatır. Sabit yıldızlar yerinde kalır; hareket eden bir cisim kareden kareye kayar. Hız, döngü, kare kaydırıcı ve ileri/geri adımlarla yavaşça inceleyebilirsiniz.',
    'Plays the SPHEREx frames of your chosen patch in order like a little video. Fixed stars stay put; a moving object slides from frame to frame. Use speed, loop, the scrubber and single-frame steps to inspect it slowly.',
    'Reproduce en orden los cuadros de SPHEREx de la zona elegida, como un pequeño vídeo. Las estrellas fijas permanecen quietas; un objeto en movimiento se desplaza de un cuadro a otro. Use la velocidad, el bucle, la barra y los pasos para examinarlo despacio.',
    'Spielt die SPHEREx-Bilder des gewählten Feldes der Reihe nach wie ein kleines Video ab. Feste Sterne bleiben stehen; ein bewegtes Objekt wandert von Bild zu Bild. Mit Tempo, Schleife, Schieberegler und Einzelschritten lässt es sich in Ruhe prüfen.',
    '選んだ領域のSPHERExフレームを小さな動画のように順に再生します。固定された星は動かず、動く天体はコマごとにずれていきます。速度・ループ・スライダー・コマ送りでじっくり確認できます。',
  ],
  'tip.real.mode.sum': [
    'Çerçeveleri toplayarak (ortalamasını alarak) gürültüyü ≈1/√N düşürür: soluk cisimler belirir. “A + B” iki çerçeveyi, “Tümü” hepsini, “Dedektör” tek bir dedektörün (D1–D6) çerçevelerini toplar; “Mozaik” altı dedektörün toplamını yan yana gösterir. Çıkarma için Fark kipini kullanın.',
    'Adding (averaging) frames lowers the noise by ≈1/√N so faint objects emerge. “A + B” stacks two frames, “All” stacks every frame, “Detector” stacks the frames of one detector (D1–D6); “Mosaic” shows the six per-detector stacks side by side. For subtraction use the Difference mode.',
    'Sumar (promediar) cuadros reduce el ruido ≈1/√N y hace aparecer objetos débiles. «A + B» apila dos cuadros, «Todos» apila todos, «Detector» apila los de un detector (D1–D6); «Mosaico» muestra los seis apilados por detector. Para restar use el modo Diferencia.',
    'Das Addieren (Mitteln) von Bildern senkt das Rauschen um ≈1/√N, schwache Objekte treten hervor. „A + B“ stapelt zwei Bilder, „Alle“ jedes Bild, „Detektor“ die Bilder eines Detektors (D1–D6); „Mosaik“ zeigt die sechs Detektor-Stapel nebeneinander. Zum Subtrahieren dient der Differenzmodus.',
    'フレームを加算（平均）するとノイズが約1/√Nに下がり、暗い天体が見えてきます。「A + B」は2枚、「すべて」は全フレーム、「検出器」は1つの検出器（D1〜D6）のフレームを重ねます。「モザイク」は6検出器の重ね合わせを並べて表示します。引き算は差分モードを使います。',
  ],
  'mv.play': ['Oynat', 'Play', 'Reproducir', 'Abspielen', '再生'],
  'mv.pause': ['Duraklat', 'Pause', 'Pausar', 'Pause', '一時停止'],
  'mv.prev': ['Önceki kare', 'Previous frame', 'Cuadro anterior', 'Vorheriges Bild', '前のコマ'],
  'mv.next': ['Sonraki kare', 'Next frame', 'Cuadro siguiente', 'Nächstes Bild', '次のコマ'],
  'mv.first': ['İlk kare', 'First frame', 'Primer cuadro', 'Erstes Bild', '最初のコマ'],
  'mv.last': ['Son kare', 'Last frame', 'Último cuadro', 'Letztes Bild', '最後のコマ'],
  'mv.speed': ['Hız', 'Speed', 'Velocidad', 'Tempo', '速度'],
  'mv.loop': ['Döngü', 'Loop', 'Bucle', 'Schleife', 'ループ'],
  'mv.frame': ['Kare {i} / {n}', 'Frame {i} / {n}', 'Cuadro {i} / {n}', 'Bild {i} / {n}', 'コマ {i} / {n}'],
  'mv.scrub': ['Kare kaydırıcı', 'Frame scrubber', 'Barra de cuadros', 'Bildregler', 'コマスライダー'],
  'mv.order': ['Sıra', 'Order', 'Orden', 'Reihenfolge', '順序'],
  'mv.order.time': ['zaman', 'time', 'tiempo', 'Zeit', '時間'],
  'mv.order.lam': ['dalga boyu', 'wavelength', 'longitud de onda', 'Wellenlänge', '波長'],
  'mv.det': ['Dedektör', 'Detector', 'Detector', 'Detektor', '検出器'],
  'mv.det.all': ['Hepsi', 'All', 'Todos', 'Alle', 'すべて'],
  'mv.note': ['Kareler farklı dalga boylarında olabilir; yalnızca tek dedektör seçmek parlaklık sıçramalarını azaltır.', 'Frames may be at different wavelengths; picking a single detector reduces brightness jumps.', 'Los cuadros pueden estar en distintas longitudes de onda; elegir un solo detector reduce los saltos de brillo.', 'Die Bilder können verschiedene Wellenlängen haben; die Wahl eines einzelnen Detektors verringert Helligkeitssprünge.', 'フレームは波長が異なる場合があります。検出器を1つに絞ると明るさの跳びが減ります。'],
  'sum.op': ['İşlem', 'Operation', 'Operación', 'Operation', '演算'],
  'sum.op.ab': ['A + B', 'A + B', 'A + B', 'A + B', 'A + B'],
  'sum.op.all': ['Tümü (Σ)', 'All (Σ)', 'Todos (Σ)', 'Alle (Σ)', 'すべて（Σ）'],
  'sum.op.det': ['Tek dedektör (Σ)', 'One detector (Σ)', 'Un detector (Σ)', 'Ein Detektor (Σ)', '1検出器（Σ）'],
  'sum.op.mosaic': ['Mozaik (D1–D6)', 'Mosaic (D1–D6)', 'Mosaico (D1–D6)', 'Mosaik (D1–D6)', 'モザイク（D1〜D6）'],
  'sum.info': ['{n} çerçeve toplandı · gürültü ≈ ×{g} daha düşük', '{n} frames stacked · noise ≈ ×{g} lower', '{n} cuadros apilados · ruido ≈ ×{g} menor', '{n} Bilder gestapelt · Rauschen ≈ ×{g} geringer', '{n}枚を加算 · ノイズ約 ×{g} 低減'],
  'sum.need': ['Toplamak için en az iki çerçeve gerekir.', 'At least two frames are needed to stack.', 'Se necesitan al menos dos cuadros para apilar.', 'Zum Stapeln werden mindestens zwei Bilder benötigt.', '加算には2枚以上のフレームが必要です。'],
  'sum.panel': ['{det} · n={n}', '{det} · n={n}', '{det} · n={n}', '{det} · n={n}', '{det} · n={n}'],

  /* ---- v3.5: FOV · bindirmeler · bayraklar · veri sürümü ---- */
  'real.fov.label': ['Görüş alanı (FOV)', 'Field of view (FOV)', 'Campo de visión (FOV)', 'Gesichtsfeld (FOV)', '視野（FOV）'],
  'real.fov.hint': ['Büyük görüş alanı hızlı hareket eden cisimleri izlemeyi sağlar; indirme uzar.', 'A larger field tracks faster-moving sources, at the cost of longer transfer.', 'Un campo mayor permite seguir fuentes más rápidas, con una descarga más larga.', 'Ein größeres Feld erlaubt, schnellere Quellen zu verfolgen; die Übertragung dauert länger.', '視野を広げると速く動く天体も追えますが、転送時間が長くなります。'],
  'ov.title': ['Bindirmeler', 'Overlays', 'Superposiciones', 'Überlagerungen', 'オーバーレイ'],
  'ov.gaia': ['Gaia DR3', 'Gaia DR3', 'Gaia DR3', 'Gaia DR3', 'Gaia DR3'],
  'ov.wise': ['AllWISE', 'AllWISE', 'AllWISE', 'AllWISE', 'AllWISE'],
  'ov.flags': ['Bayraklar', 'Flags', 'Indicadores', 'Flags', 'フラグ'],
  'ov.st.loading': ['yükleniyor…', 'loading…', 'cargando…', 'lädt…', '読み込み中…'],
  'ov.st.ok': ['{n} kaynak', '{n} sources', '{n} fuentes', '{n} Quellen', '{n}個'],
  'ov.st.fail': ['ulaşılamadı', 'unreachable', 'inaccesible', 'nicht erreichbar', '取得できません'],
  'ov.note': ['Gaia (2016.0) ve AllWISE (2010.6) konumları, özdevinimle pozlamanın dönemine taşınır. Kaynak: CDS VizieR.', 'Gaia (2016.0) and AllWISE (2010.6) positions are moved to the exposure epoch with their proper motions. Source: CDS VizieR.', 'Las posiciones de Gaia (2016.0) y AllWISE (2010.6) se trasladan a la época de la exposición con sus movimientos propios. Fuente: CDS VizieR.', 'Gaia- (2016.0) und AllWISE-Positionen (2010.6) werden mit ihrer Eigenbewegung auf die Belichtungsepoche verschoben. Quelle: CDS VizieR.', 'Gaia（2016.0）とAllWISE（2010.6）の位置は、固有運動で露出時刻に移動して表示します。出典：CDS VizieR。'],
  'ov.src': ['{name} · {id} · mag {mag}', '{name} · {id} · mag {mag}', '{name} · {id} · mag {mag}', '{name} · {id} · mag {mag}', '{name} · {id} · mag {mag}'],
  'flag.title': ['Bayraklar ve üstveri', 'Flags & metadata', 'Indicadores y metadatos', 'Flags und Metadaten', 'フラグとメタデータ'],
  'flag.exp': ['Pozlama #{n}', 'Exposure #{n}', 'Exposición #{n}', 'Belichtung #{n}', '露出 #{n}'],
  'flag.meta.id': ['Gözlem kimliği', 'Observation ID', 'ID de observación', 'Beobachtungs-ID', '観測ID'],
  'flag.meta.det': ['Dedektör', 'Detector', 'Detector', 'Detektor', '検出器'],
  'flag.meta.lam': ['Dalga boyu', 'Wavelength', 'Longitud de onda', 'Wellenlänge', '波長'],
  'flag.meta.time': ['Zaman (UTC)', 'Time (UTC)', 'Hora (UTC)', 'Zeit (UTC)', '時刻（UTC）'],
  'flag.meta.size': ['Kesit', 'Cutout', 'Recorte', 'Ausschnitt', 'カットアウト'],
  'flag.meta.scale': ['Piksel ölçeği', 'Pixel scale', 'Escala de píxel', 'Pixelskala', 'ピクセルスケール'],
  'flag.meta.zodi': ['Zodiyak ışığı', 'Zodiacal light', 'Luz zodiacal', 'Zodiakallicht', '黄道光'],
  'flag.sum': ['Bayraklı piksel: {a} / {t} (%{p}) · hedef açıklığında: {b} / {c}', 'Flagged pixels: {a} / {t} ({p}%) · in the target aperture: {b} / {c}', 'Píxeles marcados: {a} / {t} ({p} %) · en la apertura del objetivo: {b} / {c}', 'Markierte Pixel: {a} / {t} ({p} %) · in der Zielapertur: {b} / {c}', 'フラグ付き画素：{a} / {t}（{p}%）· 目標開口内：{b} / {c}'],
  'flag.none': ['Bu pozlamada bayraklı piksel yok (ya da FLAGS katmanı yok).', 'No flagged pixels in this exposure (or no FLAGS layer).', 'No hay píxeles marcados en esta exposición (o no hay capa FLAGS).', 'Keine markierten Pixel in dieser Belichtung (oder keine FLAGS-Ebene).', 'この露出にはフラグ付き画素がありません（またはFLAGS層がありません）。'],
  'flag.kind.bad': ['ölçümden çıkarılır', 'excluded from measurement', 'excluido de la medida', 'von der Messung ausgeschlossen', '測定から除外'],
  'flag.kind.contam': ['kirlenme olabilir', 'possible contamination', 'posible contaminación', 'mögliche Kontamination', '汚染の可能性'],
  'flag.kind.info': ['bilgi', 'informational', 'informativo', 'Information', '情報'],
  'flag.warn': ['Hedef açıklığında kirlenme bayrağı var: {names}. Ölçümü dikkatle yorumlayın.', 'Contamination flag(s) inside the target aperture: {names}. Interpret the measurement with care.', 'Hay indicadores de contaminación dentro de la apertura del objetivo: {names}. Interprete la medida con cuidado.', 'Kontaminations-Flags in der Zielapertur: {names}. Messung mit Vorsicht deuten.', '目標開口内に汚染フラグがあります：{names}。測定値は慎重に解釈してください。'],
  'flag.legend': ['Tuvaldeki renkler: kırmızı = ölçümden çıkarılan, sarı = kirlenme olabilir, mavi = bilgi.', 'Canvas colours: red = excluded, amber = possible contamination, blue = informational.', 'Colores del lienzo: rojo = excluido, ámbar = posible contaminación, azul = informativo.', 'Farben im Bild: rot = ausgeschlossen, bernstein = mögliche Kontamination, blau = Information.', 'キャンバスの色：赤＝除外、琥珀＝汚染の可能性、青＝情報。'],
  'rel.title': ['Veri sürümü', 'Data release', 'Versión de datos', 'Datenfreigabe', 'データリリース'],
  'rel.live': ['IRSA TAP — canlı sorgu', 'IRSA TAP — live query', 'IRSA TAP: consulta en vivo', 'IRSA TAP — Live-Abfrage', 'IRSA TAP — ライブ検索'],
  'rel.latest': ['Bu alandaki en yeni gözlem: {date} · arşivde {n} pozlama', 'Newest observation of this field: {date} · {n} exposures in the archive', 'Observación más reciente de este campo: {date} · {n} exposiciones en el archivo', 'Neueste Beobachtung dieses Feldes: {date} · {n} Belichtungen im Archiv', 'この領域の最新観測：{date} · アーカイブに{n}露出'],
  'rel.note': ['Yeni SPHEREx yayınları IRSA’dan otomatik gelir; uygulamayı yeniden derlemek gerekmez. Başka bir IRSA adresi için Ayarlar → IRSA adresi.', 'New SPHEREx releases arrive from IRSA automatically; no rebuild is needed. For another IRSA address use Settings → IRSA address.', 'Las nuevas versiones de SPHEREx llegan automáticamente desde IRSA; no hace falta recompilar. Para otra dirección de IRSA use Ajustes → Dirección de IRSA.', 'Neue SPHEREx-Daten kommen automatisch von IRSA; ein Neubau ist nicht nötig. Für eine andere IRSA-Adresse: Einstellungen → IRSA-Adresse.', '新しいSPHERExのデータはIRSAから自動で届き、再ビルドは不要です。別のIRSAアドレスは「設定 → IRSAアドレス」で指定します。'],
  'share.title': ['Bağlantı ve gömme', 'Link & embed', 'Enlace e incrustación', 'Link & Einbettung', 'リンクと埋め込み'],
  'share.hint': ['Adres ?ra=…&dec=…&fov=… ile açılır (derece; 17h57m48s da olur). Başka bir siteye gömmek için iframe kodunu kopyalayın.', 'The address opens with ?ra=…&dec=…&fov=… (degrees; 17h57m48s also works). Copy the iframe code to embed it in another site.', 'La dirección se abre con ?ra=…&dec=…&fov=… (grados; también vale 17h57m48s). Copie el código iframe para incrustarla en otro sitio.', 'Die Adresse öffnet sich mit ?ra=…&dec=…&fov=… (Grad; 17h57m48s geht auch). Den iframe-Code kopieren, um sie in eine andere Seite einzubetten.', 'アドレスは ?ra=…&dec=…&fov=… で開きます（度。17h57m48s も可）。他のサイトに埋め込むにはiframeコードをコピーしてください。'],
  'share.link': ['Bağlantıyı kopyala', 'Copy link', 'Copiar enlace', 'Link kopieren', 'リンクをコピー'],
  'share.embed': ['iframe kodunu kopyala', 'Copy iframe code', 'Copiar código iframe', 'iframe-Code kopieren', 'iframeコードをコピー'],
  'share.copied': ['Kopyalandı', 'Copied', 'Copiado', 'Kopiert', 'コピーしました'],
  'share.fail': ['Kopyalanamadı — metni seçip elle kopyalayın.', 'Could not copy — select the text and copy it by hand.', 'No se pudo copiar: seleccione el texto y cópielo a mano.', 'Kopieren fehlgeschlagen — Text markieren und von Hand kopieren.', 'コピーできませんでした。テキストを選択して手動でコピーしてください。'],
  'rspec.title': ['Seçili noktanın spektrumu', 'Spectrum of the selected point', 'Espectro del punto seleccionado', 'Spektrum des gewählten Punktes', '選択点のスペクトル'],
  'rspec.note': ['Tıkladığınız noktada tüm pozlamalardan açıklık fotometrisi — anında oluşturulan spektrum.', 'Aperture photometry at the clicked point across all exposures — a spectrum built on the fly.', 'Fotometría de apertura en el punto pulsado en todas las exposiciones: un espectro generado al instante.', 'Aperturphotometrie am angeklickten Punkt über alle Belichtungen — ein Spektrum, das sofort entsteht.', 'クリックした点での全露出の開口測光。その場で作られるスペクトルです。'],
  'real.group.ch': ['NASA Space Apps test hedefleri', 'NASA Space Apps test targets', 'Objetivos de prueba de NASA Space Apps', 'NASA-Space-Apps-Testziele', 'NASA Space Apps のテスト対象'],
  'real.group.more': ['Diğer yakın yıldızlar', 'More nearby stars', 'Más estrellas cercanas', 'Weitere nahe Sterne', 'その他の近傍星'],
  'sky.cat.ch': ['NASA Space Apps test hedefleri', 'NASA Space Apps test targets', 'Objetivos de prueba de NASA Space Apps', 'NASA-Space-Apps-Testziele', 'NASA Space Apps のテスト対象'],
  'tip.real.share': [
    'Geçerli alanı (RA, Dec, görüş alanı, kip) adres satırında paylaşılabilir bir bağlantıya çevirir. “iframe kodu” ile aracı kendi sitenize veya projenize gömebilirsiniz; açılışta veriyi kendiliğinden indirir.',
    'Turns the current field (RA, Dec, field of view, mode) into a shareable link. With the “iframe code” you can embed the tool in your own site or project; it fetches the data automatically on load.',
    'Convierte el campo actual (AR, Dec, campo de visión, modo) en un enlace compartible. Con el «código iframe» puede incrustar la herramienta en su sitio o proyecto; descarga los datos automáticamente al abrir.',
    'Macht aus dem aktuellen Feld (RA, Dec, Gesichtsfeld, Modus) einen teilbaren Link. Mit dem „iframe-Code“ lässt sich das Werkzeug in die eigene Seite oder das eigene Projekt einbetten; es lädt die Daten beim Öffnen automatisch.',
    '現在の領域（赤経・赤緯・視野・モード）を共有リンクにします。「iframeコード」で自分のサイトやプロジェクトに埋め込め、開いたときにデータを自動で取得します。',
  ],
  'tip.real.flags': [
    'SPHEREx her piksele bir bayrak (FLAGS) bitmaskesi ekler. Kırmızı: ölçümden çıkarılan pikseller (ölü/sıcak/soğuk, doygun…). Sarı: komşu kaynak, kalıcılık (persistence), uydu izi gibi kirlenme olasılığı. Mavi: bilgi. Tuvaldeki “Bayraklar” düğmesi bunları görüntünün üstüne boyar.',
    'SPHEREx attaches a FLAGS bit mask to every pixel. Red: pixels excluded from measurement (dead/hot/cold, saturated…). Amber: possible contamination such as a neighbouring source, persistence or a satellite trail. Blue: informational. The “Flags” button paints them over the image.',
    'SPHEREx añade a cada píxel una máscara de bits (FLAGS). Rojo: píxeles excluidos de la medida (muertos/calientes/fríos, saturados…). Ámbar: posible contaminación, como una fuente vecina, persistencia o una estela de satélite. Azul: informativo. El botón «Indicadores» los pinta sobre la imagen.',
    'SPHEREx hängt an jedes Pixel eine FLAGS-Bitmaske. Rot: von der Messung ausgeschlossene Pixel (tot/heiß/kalt, gesättigt …). Bernstein: mögliche Kontamination, etwa durch eine Nachbarquelle, Persistenz oder eine Satellitenspur. Blau: Information. Die Schaltfläche „Flags“ färbt sie über das Bild ein.',
    'SPHERExは各ピクセルにFLAGSビットマスクを付けます。赤：測定から除外されるピクセル（デッド／ホット／コールド、飽和など）。琥珀：隣接天体・残像・衛星の筋などによる汚染の可能性。青：情報。「フラグ」ボタンで画像の上に色付けします。',
  ],
  'tip.real.overlay': [
    'Başka teleskopların kataloglarını SPHEREx karesinin üstüne çizer: Gaia DR3 (daire, 2016.0 konumları) ve AllWISE (kare, 2010.6). Kaynaklar özdevinimle pozlamanın dönemine taşınır; kesik çizgi ±5 yıllık hareketi gösterir. Bir kaynağa tıklarsanız kimliği ve parlaklığı yan panelde görünür.',
    'Draws other telescopes’ catalogues over the SPHEREx frame: Gaia DR3 (circles, 2016.0 positions) and AllWISE (squares, 2010.6). Sources are moved to the exposure epoch with their proper motions; the dashed line shows ±5 years of motion. Click a source to see its ID and brightness in the side panel.',
    'Dibuja catálogos de otros telescopios sobre el cuadro de SPHEREx: Gaia DR3 (círculos, posiciones 2016.0) y AllWISE (cuadrados, 2010.6). Las fuentes se trasladan a la época de la exposición con su movimiento propio; la línea de trazos muestra ±5 años de movimiento. Pulse una fuente para ver su ID y brillo en el panel lateral.',
    'Zeichnet Kataloge anderer Teleskope über das SPHEREx-Bild: Gaia DR3 (Kreise, Positionen 2016.0) und AllWISE (Quadrate, 2010.6). Die Quellen werden mit ihrer Eigenbewegung auf die Belichtungsepoche verschoben; die gestrichelte Linie zeigt ±5 Jahre Bewegung. Ein Klick auf eine Quelle zeigt ID und Helligkeit im Seitenpanel.',
    '他の望遠鏡のカタログをSPHERExの画像に重ねます：Gaia DR3（円、2016.0の位置）とAllWISE（四角、2010.6）。天体は固有運動で露出時刻に移動して表示され、破線は±5年の動きを示します。天体をクリックするとIDと明るさが横のパネルに出ます。',
  ],
};

const TRANSLATIONS = (() => {
  const out = {};
  LANGS.forEach((L) => { out[L.code] = {}; });
  // T_ROWS sütun sırası sabittir (tr,en,es,de,ja); LANGS sırası yalnızca menü görünümünü belirler
  const COLS = ['tr', 'en', 'es', 'de', 'ja'];
  Object.keys(T_ROWS).forEach((key) => { COLS.forEach((code, i) => { out[code][key] = T_ROWS[key][i]; }); });
  return out;
})();

const ED_EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u2300-\u23FF\u2604\u26A0\u26A1\u2728\u2744\u2B50\uFE0F]\s?/gu;
function makeT(lang) {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.tr;
  const base = TRANSLATIONS.tr;
  return (key, params) => {
    let s = dict[key];
    if (s === undefined) s = base[key];
    if (s === undefined) return key;
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined && params[k] !== null ? String(params[k]) : m));
    return s.replace(ED_EMOJI_RE, '');                                // editoryal arayüz: renkli emoji yok (düz glif/metin)
  };
}
const localeOf = (lang) => (LANGS.find((l) => l.code === lang) || LANGS[0]).locale;
// "Ocak 2025" · "January 2025" · "enero de 2025" · "2025年1月"
function epochLabel(lang, e) {
  try {
    return new Intl.DateTimeFormat(localeOf(lang), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(EPOCHS[e].iso + 'T00:00:00Z'));
  } catch (x) { return EPOCHS[e].date; }
}
// Zaman damgası (tarih + saat) — arayüz diline göre
function fmtTs(lang, iso) {
  try {
    return new Intl.DateTimeFormat(localeOf(lang), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch (x) { return String(iso); }
}
const I18nCtx = createContext({ lang: 'tr', t: (k) => k });
const useI18n = () => useContext(I18nCtx);

/* =====================================================================
   BÖLÜM 10 — ARAYÜZ SABİTLERİ · GÖKYÜZÜ KAYIT DEFTERİ · KALICI VERİTABANI
   ===================================================================== */
const FONT_STACK = '"Poppins", "Helvetica Neue", Helvetica, Arial, ui-sans-serif, system-ui, "Segoe UI", Roboto, "Noto Sans", "Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", sans-serif';
const SERIF_STACK = '"Poppins", "Helvetica Neue", Helvetica, Arial, ui-sans-serif, system-ui, "Segoe UI", Roboto, "Noto Sans", "Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", sans-serif';   // NASA tarzı: serif yok, tek ailede kalın başlıklar
const MONO_STACK = '"JetBrains Mono", "IBM Plex Mono", "SF Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", "Noto Sans Mono CJK JP", monospace';
/* NYXE kimliği: ad + logo (şeffaf PNG, tek dosyaya gömülü) */
const NYXE_NAME = 'NYXE';
const NYXE_LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAYAAAAGACAMAAACTGUWNAAABIFBMVEUWJF1kla0oXWpXXp+mzu+hz/ROWGif0OWRns+OvOkjKTd0pdSOsdejyOr/AP8xYZd4k7d8pM7H8f6bqrxv2N8A/wCBncJ8r95/FX//AADMzP8/v79/AAB/uut//3+Cnb//f/8AAACQy/uY1P6l2v7///9/vv6UxPCq//+qqv+04/1///+OuuaNueSUw+1/v79/f/8A//+FqtOOvOiJs9x/f38AAP+NuON8pc2UwuxVqqrH6f1ylrmEq9WJtNxrirGNveqKs9p3mceVwuu/v/97pc13m8WOuOOqqqpzfrKHqNBVqv99p9CYyflZfKlQapGXw+tzlruKs9xYeZeFq9U2V3uq0/M3N29ne5qMs9dSV3trirKRuOWWxO4AADZnZ5Y/UzO0AAAAYHRSTlMGDQYKo+IGCw7hBQ+eZAEITl//EAUBXpwCAQUEAuACVAIA/v7+AQTQAwP+Ao5wsAQCATCtTwIBUiySA/4TTGwTzDMVcQQXKDEDChgDSQsNDFMqjQxqCdMFDBQIJhMvBAcF2qW1AABdg0lEQVR42u29B2PcOpIuSkmW84kzs7v3vnAfCKLZFDuQnbtPB3Ury5bknMf+///iFcAEgAAYFOxz5vTdvTtjyy0SBRSqvvrqKwv9/fmuH+vvJfjbABU/4fBvA3zPTxOh4G8D3MlOJ4o/9An68OtRWPGryOhvA1Rc/FlDucgNhNpP/0FI5S8kDT/82wAlP0G3Sf/P1stv0l8MCZrc2z2p7ILOXs6Z82oO/zZA4db3GvT//DJuvVrMT8W/g//aduwVqryMW5/fvGqfxAfhbwOYVp9t/eN2Z9dtn8t/20XzjoN7qFHnq3st1+6M2UFoBH8bQPUZsb3/bdBynb13L6gnCiX3f+Jip40Oa3w3gUOzOtjdszvtNf2v3eHfBpD9Pl39D+Opa+/t7Y7hP3u56/c5xti1mvUCGgJn65cDe8+x3XaP/ncv/NsAnOsBz/x4MHUxXeO2YvnhDxY2tp1x/m90K46kUCkEE3xo2Q7GYIOX1KT+3waIYhvq+HttFxYY/qe1YrmWHP6jE7r+HfSs7LdeHOcu61EXfk8Hvgds0Bm8psdi9LcBfFjtq3GHLgqsf6dHL9v8dvY/utQ8Y4VtdAfgvxb5cDWE7x647DeBqel10CX/2QaYwftvDlyHrglszSU4hlAJP/Tp+rvbpZeLoPOnX4L8jw89tNOyYxN0Btvw3cF/rgHo8q+ndrT8sP2PYaurfg4uALZk7Qoh6D9Qq6W8MODPem78Gx33YPWdTfAdDeDT5e+ky2+3kWZ9g+CI7Vl7gsrfm7PwxJ4o7TlqoA9THP1Wx7Gn4PWa5D/PADQu7KXLbzvuGhHNTvRQix0A9z4qf2mG6L3d11wZM7gJIpNC1AUmgMugMfrPMgANSE46drL5sdO50rqXU4iA2I/1S8egUeDUwUca2ChsoEl08dCrBUywQZW++09vAEB1Nq14+RP34+nv0360W1uVUIgGmu7p/0UXvZ86LO6NHuBgR3sA/3oGAO9z1s6W33bsscELe2gdm6ld0QBtx/2gdVoQIbXBAvFTQP43QPVQpj+fATwWi3Pr7x6bwnsPdZxokZ6rUgSDAZbYXugPFmTGg/QKooegM0HI/+sbYNRE8ym3/SG9PTMt7BAdJX7ieSU/TQ0AXqtp+ome62QPwhxh969uANhiY/6tKbxAoxKjJ7HrGWAKqM83048AwC0+i9tDfvCXNkADvZ5y3gfeeVrwyn58BYMB3lTan01qAEgdAuPP7HQEC9BD0PwLG0A69Cyy8Yg5nH+dXpQHlW5JZjlcAJ8S9LHD7weIh49rVRz+FAaAWvrYlte/GRYsYy/94X6VzTlCb2mCURQ5+WgjWACeb3CnifEdGgA8fcsRXhZPC9+1iwbJP8EuIlUOQC/6DY2in9vZFx8Kqm53yDyy7pBQJe01ltqSEtF8+g8mFRamGy5pmF98ambo0hWfy+nP7y4ete7O/R+7ufX3SfE/e5WF6lUyMS9CsPvFp2aGNrIFOpd3hkxYd7b+J3zwD5EQdlcl9lkXZccGu0O//H3D0ocyBoC1Fp6N/ab5XVnAuiv/M7DFDwaH8qzMRub8VoWScBO1sV3SAODYFli2QO+OcrK7McAhei6vPyxmA1U0AHY/lTwCJC4hlIyc/Mhcwv7o3c0ZsO7G/4yl9bch1PDL7WT+5i59CzSiEgLcp+VC1wYSErLYAs/+IgaA9cfy+ndKlkCSlUxWZV3KbjM0SQPdUhYbki1XPgPu5i5iIesu0M+1nTvg5yXR94boHMClNMISePfrpOo7LunKZ5A25CywIsO/gAHobnTkG2BQ1sF6WSKW5M4XhUnwA8j44p9fl03ehIQjOab3vdGf3gBDstrNrX+/dEAfJM4k/bdL9MB8BsgFK7VEJ+2ydPbcRG7OUbZuHxe6bQOQw6CTW397E5RPaR/L+dsS+SbfDKWugySoxJ3y6IXKCdXkAv9IBjhErT2cd0DdCjd4S16Wqal4CN/cqpc7d3O/CSzQu2102rrd3q5/ooGD5QXcrxLfyZcA883g2dV3yKmPjvrcz68roEfEn8sJMZRoznm4ZPhnMMAQZcd+SDY2lg82pMCzCj4MzXNfgGFnIz8H5BFKsh7bfOJWKZDs0iqy+HtovNzl8Vzywxtghj4s5iRDcuQLoCq9h1a28t/BSAyo2Q2SKCX0WWPZuMOfN6cajwL52xIyHV0DXlJhWC1uHqi2bjzp2jxaJPuumYYj/Gc98qtVkdc4/yVAYhifRTF/o9GIDsPZoCMcFrjsQ1IRscL5X9RLUpYZWj7duWmA4oYN8BCixhY6S8if5zZWHICKGT4Qs3JHIGY3jydv4x+a99oxxb3+AYDtPXTzD9xJ72F4EoBwuz+uAUZsC71NOnI91M9vXXsyelaVxNtTHAEWo0DDkduZTqcdl9E8c5lsMKoM2ioO2zLZ9YSs7N1JcSb4vQwAXOQ23XZNgVSeOwCVARYvS2zzxwDYtQ52VBaqAF5nr/BecQTso2CYco327PGNnoEbNEDAar7u0TA6ACP/9b7CAIMaqzLMB0LFn2o1fF0glFAHor/+OVixa/kGu+6tG6RcbSDkwekBaCreBaKXTzUCuWcqzyCFK/k/2gpqKBqglerLellYAZVmQCgI+eEMMENXQPnB7hMSxv5y65HCa7drMWAVSWrhZ1IrYmyq3F3mN0NySdOzKboxnNS6sfVfUcoVfwBaquCx3rLA7bdf0QLjehgCJN6q+6aX5I4RMrLXsW6KzG7d3Poztv0qPpzDcKV4D8etWeMIcsyFggtgWZtr/tE1HQGKzmKKhlg3hEtYN7T+EbcGzmZTWUjJIvPDujfMxwoWABppo3Ym2TIegWdRjdTpvL+ZpNi6mfs3qUAlz/m/yAfVeuFe7SrfqcRkNl7Jb+oXE7tKHwTZWBy8eaMoIMB960YsYN1I/HkVeeiMPNjNl4HZyqzqo1nAIZxiQ9jD/ZbrROpDdRyUXl6jcO7GFti+iZvYugn4cx7fkFmM4ytQOFaKJ9fKM8bF+QDGnYfXwvAJUp20rLKQ+ijKORr9AAYg/sOUOZJsk6yt5ZrgjNxUtOljbF5+CpN614MTVZcAsPJIcgkklbNyDIFbN0Aj66BIPVBDCYNyVxmqrZgI/TWOzgbQcHrw5Loh+pn6EsApIYZYyfUGKbL/3Q3AlQxxgQcCeBiF1y3xU8zfVpmAQnPTyfX7fQN0rLQt74OwXatx8zYMcIgWDlcAnGmrWJUJ/voeS9QDXSfMo5/sv3TaoEjWvLZPgBZ71/jwAsh47Zqxdd3l6O2m2wE4IKME1VUi+K0bqXCz6su6TSFotvL093em4/ObkoMjShQdp0oVIbe9sH18zWDUumYCwJVcslpjQ1FFrN7kZfi10dd8OV68eHHw4sVismJ/ekPaP1F3nwrdbiQWynARx/1yPWDuegZoWlzIljlEdSRn40VSK7v2Z+Q3mqJJbk4TtKFG/pyp4hKIWK7fzQBdMWLrodN4/TfqeH1wswVV4nvNLny84EYF+LroDVbjWCTXtxbF1s3vZIBnTEiPj3FIbIATtQH+fc0o9G4+6iyee78g69xk8dH6Ojx26zobUMB7gG9lhFPgc4L8P4EBPPRCbYCX8X0boi2h3cq9uoYGpnWdy0rwlRl7QEE0TsLUMgYIfa/BPt4NVf7IrFnlCz31CeAkA4nI43WuE91Z19goJ+LzvUpuo6aaR0JdkF98ufri5Xp6PSMQr0EkFfXaBlgmGF9TDFSxXR/krW+Akf9JzFcgyOxmWlUaF2S+hIfsCz6sB8uD6fRguehdMY9W329FWtRHJ+M2cFemy/H6igkXk4KT/UJtgJYyDIq8790bwJMrLrwsg7p+WCB3EjAB14MOldLDcYbVaZ/MkY6JW4zdgTAXVUOO8jUHsAq7c7BGBSJ9mijI5GPxuLYTsmqDMjm04TiOcUK0/UiNlZmQEyriN4HFooufJZpUZ5gJrFZuVRnRFRlMJb4W43K1V0YTaPIAruW1y+Mv0RHY8Ud3awBPfkqcUsEJemBXNgBbfhHgySiIFGL2h1VV6XaoGrIStbOnWwbQrqmEIhgalN0STu5+aN6pAYKwl4vSztMw+VhjAG20ACDnKhJwxWobuGNUUSzIOnCVq48jncSDK61OBdF5UPdhDOaeon/n/u6ShHdpgDztk0JxYXwHv9QYQIeG0tEYoCyPOWgzt2s7x+X3GKAza9fBChpj8mcOZRiqn4ZibZpS51yZiUkh0p0YwE+UDPnH244NMJP76rLPlvKdCcg47brT9vi4d3Fx8nLcbrl5qi2VVjwlZWuXB3LVhuHVLfgV64svF5PJC+BS99UdlL7u8bM3jLkp4uY6I3doAAV/jDfAsZ6t5qn2a+/pwUb8s/NxjmxemhHoo8vOnrz8bmsh/Ypfxr8px2E1dDxIbH+K33Co6toZ1wPlrHqIeb7kmz2erzWA5hYOH7IMqeHNAvjQPJiu82rp2pKSEnBxSDmOHpabOV6nv2I4DIJZl/2KoxIJPv81b1MDvMy/f80jYNUDbJeOnnISoM96wrImYZHB5KEXNRyJ7+l0tguvuoCtvyBv0JrQ3+DlJmpoFuy1qzPAVeqCeraK9929sxOwo2LRf4wNMEQftayFcyWhL1QnBiSZtsCD7wU1x4CcS7UIqsdaYWLMTLW4UhTk56KgKB0O7sgAp2jtKJGeQOug6hWxZz762rYl3KtbkH4JdABK0qpWqOxqu0H4POBEzd2a3Y0BmupnfJnugMc6GieuSs6FO3sieHQ46M3yPHYHRqJUG8+gaRAQM2EPJjqZSma3bIAQfVA+4/NkAxCk59H2Rl7V+2bVd/iyj3oqQ+I/xmLc9LgqGbir7wXJWm7UP0T1be7EAJ76GTNlmKaSFVSrSTjqjuZL/PANM30lgVf9wc4BIn7lDEe7eTRF4WvyzqwbI3Ar2JNKSJpUfcihJ+iNGpyQAFBRKlVllpCuFhAXf7tGtKgW89KqxV7FBSd0rDVAxvOuMoqWPwOgaDgMtQitsP+r9yL4X/XeM8PbNStQi3ts1SBDn6ufb38nLzesjBWe1UD2+wL9pasJDl7h69UJu7piKvscqWvCAlgU3r4BAAzXPOAmDvJ1Dyg3nlfpETtzOfnQOSncGTDxp7oCNPEvDQ/u3ifIDHYBgde7NQOERfUKOxtXQXQ1yRKBpC716BXWn7pcjY6C48FNUbLSI9UwtV9Jl0B4aydAB5cLNdO2wQD2FqmzNm1cEEqRUfZgQMLrXs/KBqhBV7ERRTLJjRqAoM+FmUoG95/m0Wrxtj6sQ5fq4xwwL4JAvTqidLwDOnJN++Yo9bBvdWiRu5UMDdrZ3OgJAG3fRcw79PVof/qII3NTaa0eUt7xKve3cOzOaxyyQ93GTu4uvwgtslOuNCxYbzS8MQMMg/P989iricS9R6ILHHULIN14M9UBDjmUQSkDwbHKa/VNbDRkiFzs1TCESkmkGqD103jH3oQBoADJUTK4WM/+b3Uc7OW0oiULHFePRan8WXrUf1FWEnEmExFWv2QW5u6/5HjnsoD/xoqzPUT7y1IhkVWuC8MZj1Q3EP5NYIemvnkUXhnbqrF7Xm5/qCsllIoW6F0UrsFXhvEG5t7XFInzRXlLvM8bgI9D7JVPbsYA/v9ysxRDoL3hgQg+jsNGPiRUW2Ajn4HChw1GR+kvyg9o49Pvo+LSJZHX/7O5AzaLgbpiAyJu8/BH6huhLIhbZY6AVUpGao8vZfF410EPK33QEG0K2nk71UckPEsPnwJ1yap0NTqhGvkqu7xhnoTxDiTPxIrPZIoV52SEvrl4UgILtErIgH5wd9MXHqH7rnDkhOOYTfz1jCEFe6UvfG1giH47Lx4Lk9z/Cug9w4vwIOwWbf/egv/lFwX+h2edeOHAEUn5fX4qI6+7v1cG97LKiUhxOBRf7gKL864GZwWrZ8ZUIHrYM/SAW5NHJ0W5K0k70hRAT4qB0yQ4LATU+frhg6L9L17BAvUbsnJ+Q7pPkt9No2JcYghEoQFGhGojpL2ABF0IyqhbcylbIUSegKc/A5n+HWXatMNGoeOO7x/FXIZs5mfx1BKAHOBSG6ZIX6ECQubVZqGgIIgffToS3n8HpYqFAy53uIYB2HXqfkoyvEAwAMU2hds2w8zl9gGlrsACHYbx/l2UkPNLI3CFAdgJwOVEucjjfZxc4/A727ho/e1Nkth50gFYCtWpjBwVkbfwovAIWIU3wNzlN5V4AuAEko14C6wSpTZtm4YkQTxLZ8/2iu6sWdIirTkBuFxdim35uGW2i35pOUX+x0mptyChyRPGAJgNxQkf7xMDhOgb/GTxabTKTOXlZlkT9EVY8BawdxzxD4KEIPKy0LNiOrGrkXjMwnJl2oHvtJSXMNYCRaKt/u/92ABwW/eKVYggZvaJbOakDi5Ak9h+mN4/IbscTorynSIDMCCeA28IOpMa1Eh89lOnRNJAqF2ssETnRYG6Rhf9hkvVaqIbzzlQGOBVZIBCPYQmzXkZWkFHS5cQxMwciQBIYboPyESix6UGYPOfirUzraJ4YZGrQYk57oA0BRpQ9iuJd7+ExlU0RvmM0hnw/tfmqNRMJSfPRU4EWgoLPkN/Hu3dbgNdTUsIcGUh18i7zyHeEMd9vJBG3LhZABbX544KtOWsUgMBX2QvJSEh8L4PkRAZZyFrkJ9Joc7JJgAFb8qAaIcxGoHz3Waz+DbErYLviKsuR0CWW5SRoQPYxB9y/pjbOieo0d3HSsAi+T2Fr2QVwNBHstxtLsPqhQ8kX7NKHrhZxgnFh6DJ3qSgkfUwknGgPNShYtgMVnsnRRs2dkFnsFVqe2QtkDOpQbsNGcQ4Nx5WmOhd7BGtUnUoLprKdQjCoJuGzNxpZDu2lNAedk/Yb8KuZazkxs+D3X8pfmo7Em58YYS6CWGlCtiY43IqjFlgHXpXrsh6ufAkf8wfv0as+VHQwmqVKT9iwQAyzDYhp2J0nN3Zo6bfL2cBu/Wc6XGap1TF0s5KNxPfD45ZsS8aKYHt3/p2qQ8XbzVF1hHcDA1ZEoDvk2nALKESbtUye6BergPVk3FzeuttSwl62ogxJK/LbTSWQxWmUYkBBgrZlbixwjEqgjykVzWOf1mZp+p89ULVzqMB0JDnaoiSVdkJALCI1DZAcunwl3Ce9EN7QwCA4LeHe5ScOx/Ny1qArQp2TNWyBqtaqdUvh1Fvl1Ge/TCJF3DJZ3I/JilwQ6wxUdadggHIxTyprzarNVtmomQnF3aH6JMtN6h+JPBBHJEcu9t+SqKZV5G8ZZfezLwjNBlbhD6ZWC9eCdRN3P8JFwu+k1OAoTVVmkX0co1iw3y3a4EPsow3QJx0OXwVPa/oRUP/MEKf+MpAaoFVv9JbG4ZoRm5As8nj+EZ/CZ+WC4u590rliT0esKYoYgP+Jj//k0+7kt1bkItZ5lKkAn5XkH7AIT5gRPJshhFVkSbJTWJ1qlnA0qmaML8KEKzaq5JLCBn0umjDSGC8/HO0UgVMj6N5QLxwH2xMyLfcW0mbPVbYdd/XvQMy8JFnnXq54dhMLPsB66YYp93RnMY+VMhb1XaeThCVHWttMxbbGploi2ye0/eV1h/cPEmlCVLdahDm7dE9FRAVB3+SnV1OOdJ4CZhPQAKxu1fmyWqsVZ9QNv7ZMrngaE/jLOHto3aVw08FUUfqsAyUcyn8pEFuV67+xB9W2gXUzSe4SCNF7KKWffC3M7StmJDmbqMRH0HiEkoeVgnoS5q7oCy1xMCyxyQasBMpvH9LfTV7hwp3sfrignrovul9WOfKvi4Aajvl199hbj75l9FSwlu54/es56OLdhT5DeYb2LopSmyOrK0yFUAhEZAQkcxvfGIALyzOW9ZljVk0epj+o9dTXGEHPlet8pBehX0DwOsP9zVwdFfhOPXLb7fepvPzuoimiPR9puuoaw3iz4lS25Un7DXSrhKnU/MEcNCHkHpqxDhobEB3B6uIH4EUgI137TXfbjcofwiwsuWQNceZUnuWOaoKsbMKASim25/7JW0mmjMdJ8JF8L8L9digM64YzcqnWKrUVzMAx7QRISVNH1WEqRGK2lKLv+61+669/McwEwTaaZVfBZUgamPU2jOTrgD+22uT3IkfhqWTEVBSaaN04H1I/vEUFIvaPYv1erOaGPrQKhaDCdFlRtQzlYisUkO+6XcEpunfSeICEQITASDd6Fl6y1+zDn7ac9opawIVhxqgcBcZSwbQJ7yfb4UdNf+/sqkIOJoV19pH5v9nGfGco057v5lrHud79J4hBWKDuQbeigbIMm08GDWMUhHp44P+QpM9fzhreFKnAr0gFmVNkO/Jht/76DgMChik5496MlZdFpSFJ+sfI+GIsadvdqOgbAYvdNLBOm66RTS9HqYqtWUsPznqEZxNfTc5qFGd0wOQpABebt447KByJsglvB4lyUuvcvE5l+4u3kj/rmlofZSWv5cTMyNe/CpDerTX+u0jku4JVztzXhjcplUiDYhVHgh3CZyYfCiLFkhXvVVnJC/CoW2JkGYxkLxU+epXebuDlImfu5lx2eX31E8dMOlGWH59+6c95y6tGc9Lcwb1DBAINNwxz/drmlhXYIJOm/EMG95QIz+/6JcphudBNyInBqs3RfO8Qm+7xAUMAMMxUvd1Dz22s3s0vzEWbhoazRvnjQHgLW0AgTblGbupGNrbb0+iHl/FSaAm6LWKMeGcLnZuiDl60MobIJQDo2J+kk2HP3i55R8FzUj3dbLsmB8XC5RsaFZ4dMMGkEprXjHxEHLS1iCOIOAojHKOaN62naIZnZsgMPcsr4uoT1RdreC3YJceWElTZQQbP7L+fNFyCzcLIPZNnf53XQOIg2BE0rdfcATSEgskML2vkc1Eh0RlWq/aruMUgEJeQePYfr153NnqOG4bkC5BTRfWPvq11vG45ZYp31DyIkEatKauAZpSt++cDEsIeylkIt1OezCJ/xknjUWlWrfHxuyYMj+emYXO7SdGLnRTp+SeZr0DJCx/EGcw6GhMp6Tgcsm7ODzaExsZ60ZBUsVNgJqA3rQqn9XGVhgfSfLZTFx44Bo2WAFjt4sOQEdsWE/9JAE3s9RuNIvu0Um09rg0eAVowzO9qCfUiLwbMIBtf+R7P8sG16IVWoMoPAp4gWEjQWRtotpSXHBtQtufqcaqC8uf6VJHk2l641altVcgV6cyb2GCduoZ4EBLeikKRU0Oqc3ShFRJBkKi9/pqgbnfiFbIjJLshmABu8vIDUaHkXqhxycqxdJS6LnHp26ilgDOehGqJmLPc7vRU7aNVjQCHASmY5jRWNGRnqS5Mvh4ek09N0wG0reqQdx/lOlHD+nO6pUIdjSmPOUBKnmWu7llxzLFeL0c2uEhw0mrcmY7gyvEk5i0NGWjGiSEOLumcodWtIKSstOjNYT/cNmuufo264/3DRvTzE40GGCELMk5S7WdRo1J71z4cbCVbUFwBfMOripyFqILd9cklff/6nS4W6+h5U8Qbnec2q+yELxkQ/Z6uG5BJl97lDg7YXPWr20BaoK2lanSN6mAt+rHHul9EOXN7BpYH4HOA7Uz08MNfj61nWu8h8gC6OZEbXHdkqTiAGP3LS/DNhzN3fpPTnOgFyh9uGFT49L0YC6D2QyNcJ7yGzHUOxvZ9v/avs7ys/1NxDIiLkB1Cw3wJFOwU4D0D4VM9Niu74ViVXova9d9Xk3slQqoYreiABONGZtZFFyJLKC6TIQODOJ9zDelbFKVg2YpA8w/56vy/DWwEQ5cmVorxlgXWTv2EqWSChfAasAVAlFaI84UncuN5aT7/0Eq8aSjyxieOCc74otzKJ28jFLyfI3j/HVsKbrIBwnvIMhLj2HoFTgUNtm4aMY1RYToRz2bAUNTQwqjPFBUegzJMGQqsH0vdJlYiI5cFcL6IPVgs5ZuykP8xAVIBJYYABeKQdZc+jT89WPxCYBLZMkp42DVCW6UtgAV7h+cv41+1dF6Qev08kvh/tfUAo08dIb3H6ORPlfHPB0t31RpK1mU8fpfdeQRBZCj9NuD9ce3DEB82xu0TB6Krv+ZsP4LxQkeZPPfXuXTdsUJ6LezgWA9NUB2KFK+9XmsPf4aN6akbuJoPJXSTdpZlShhkDx/89GlzsfQVmSsJ2op+DPYfd1MO6lfCx2mDh2xsZhn5yf6uc2BsdW/KzzOc9VKzLPhS/fyxFUrt/6XdjqRDYX391W32Fo6AxOt4j70oAIKHY6YhhBMP40h9l5bGEse0au1usg9nY+hY3MNLR2zfOU0U2+AZkmu4xFIb9MIK4TiRXeWPHFAi2G6eoLjrvj1HzWUdCHOg0LenmdsWHkdi73MTLpUS/RCZ+hMk0Qt0EdFhe+Q7ohJm0NBOT/ZzV+chgmItIlZa4B8FJcxLUIvu9/oeJnxigG1+clK5IEmm8b9HT4+Dogmj1lyPU59ZyNfw1Ye3trLVkMrUToWyqczpIwmAIXS8MwDVujjavOZyJVPjsuOoGRzi+kl3ig5FhXqhn6Q21rxiI2GZqwV8c+U79ZG/MGEc9UyD8FlB3YvV5/PX8LuHpc6k67Gu4BEweGIe0gVXcmgpTxCQ3oOjrPafAo750s9OgMEtGsF638LLddoOu4yTwfLTwfrGZozVUrRjIeZbS4gLOiRlGfpOz9296YFBmCCaC7fbaxFsybCiEcV7xAXiFkzekRCwIZ26DAZQlLyBMzoLB1DJpa/A47iigbT3Ij+iHJRGsMCsXInB6V+4t2/p6fLcWkwDcocYLAbDRA1/G+lYQeVaTV1Vwf8Q/Sk2ha2nxSoF0Jq+K0ll39zhYaNBk5vUgY4xprpZPSEvNSkdFmZYCmVgxXrH0i1P0xb+zn3P9OyRWkM/Z6IKIXMLbZUkkjcDxlqv1GzwpCvL45FE4Bnv0CFM0oGEubTDMdYOaBMRV6lBtDVO4by7umNTuOoIaIdU1C6cMLJP0V4H07cgKtimtmiUuMweJNczGZJueNrW+wBog5BH+VTMm7TF0hvfQFW76GLgimjKdneSVC1UGzB0cPpLA+Dj25U/Qg9FFQ13a3YkMNIoxjvzwu1ncILUZ/A7izooUhfmR78Dtbv0TkZCciUI+vIWbkrQKo9Nk3EViDj9vgJyfS719wIWQqVoIvZqEAP4XMEzCUFN5GOoe8yhK53hhyMdWijiKenrxXz7vH+L0UCRUEjO6D0vk97NGICRfy6erx3IKh506AZzutIb4CIeC40d5NgbhuJIxETtBE3dVF22bzdSWwAN8V2xMwKTAN82ZWYymCJtCZ9nB/1QGC9FLWYxuBMV5jeqhjyqGcGzw/T9qi3amer36FM9TjyCH0WSfeMLFfHfZwdgLiR3Jb0SCyZj4sFADWK2JyC8mL7CKWrPDqNBln3I7wByi6t9f34pQ4v4EdC1ULRfqpUnzwQsg9IXnU9SYRtKX0iIE07ii9zjzEl6HWoqHXS5LeZetV128UJt2lMUeDmDFQMk4R+0jbzvEXVxG5E0JD3kyU6zW+RcxSUN4slQMEGBzH/DYqLjYsHFO+6mlByDfzlHgO4eqvUqTV89WSyrB/8jNdFWmnugKhdE5vGFPONDOm5Zh5OhWAALSj9TavJhA51ZUMRgdLUo5jbgwcX3SRf+LA+6BQVkR2B1xeHM1jKBCxZcydfh/XJulDWEQ4oW+W59E7Hg6f9/RiFdt3+tL2YfBKIQQkGdwSVASe5bnmTO1r102ikJjbVxPgcKrkCQmYV+F2Hol0jWtBOb9Ge9hPs3P5/+q2B9E73L9dj2gHnFGotujxhfcTiG8Zs0F/CzfTICqF3UzG7U8O8AjN0pq3l8rff3rxqTTv7riv8vRPhvT2EhCwuZhCmmty873aWeqTh31FZzS3TZZWCMl5U9ZFcMb27tumuttlTcovruvv9Tqv1arlcRq9kl+RtOUIt9SyliIkiZpby0pIcVRf1nfL8N+mjJGe1wAZ+wJfyQpchy13pFuY0YxUVX/b9hpqYgGXFsDUj/EnSuzOS0IJwjTcq0zCQVeekErGlLOEBbM5flrHM1M19GP6IRA8JoWHiJWboN84DGZU72ILoRY95LCtOL+lLYvsLBybS6YrjTn1aUBm9hayjQtrclpCGpUQgLDKqnxXL4Fa3QWfN41nkE2TRsb/PxqRgR98XT3mJ0Y7UjzFtcDXCS3b0R1TaTLi3gzyIcgOv514JrQ3ZtSblNZZwB59zMI4wfeDMPBKjJiuCR3SZdKub6SMXz0aLlDvoR9+DFXC0jQa74qMhRA/DWeamvrZsfONvJ24KrqVIyuwtyanquAiNKq3+5UU5HqcWiFQPIxIWQQ/zkm3KEId9TEKJ6c7DcSMBbTDk46ZTtOnc/PLL7frN9/uaGVCWlogl1jup2MUtWCCTpIpwgy/cLhXGEqmQnq+xAfZemQzQSzZeVFqeQezEdRxS7eJbWP9xbvGc/KglhQEE3be5WCJq3IoF3A+Jq2uM2pRiQnhFHFOLEvuhyAAm8qUf00MTA5yif3NVKr+iiFbJz0DcEZ4wTEFkEVgqef5UsTeUvdCNP2ymg844DIkBkgx2op8HBvUwJzUAMQ1rSGuD0QnoZVUq4l26zs3fbWNRZYGI6opiGGTxQZBYeeAoTJlw4M1bIH2cEO3HBgjioMvYnQExvhNZwHFLUIzpHUAiFwS6C10tke0G1r8n7v/wUJpz39GcgCBXgR/nLLC+8Q2DocVlls61iHCfOAwFOcbh0NAf9mLPARPA/zpPDEcgVt3BcRjqwx1wEt/BpsHH9TnfL6Ub6UIC9EUlUQvpxeAoAeif0ktfdm78kd10OdqPIs2vZ1QXKNJBy+DhfIj/EzUA/ezmpaS5ey5CwbD9mf0ZtJ08eh1B8qPSqrIV1r+zkk5tE72R5HXtb1xobZmmGdMc86FkgWrqb1VaPIHGE+8N2NwMsE9eBZwjymHSIIGSGMDJd/J10daGQ/qoBf7NvgK+q19qfHPt1GYmjuBRAGkTbr9YxlnxVLpO2ljNunFbiqLIcEpCnoC9Gc9fZBgaR/okZP4qVz1soHuJAfZ+knYduN3em9VQAI3S6tSXNxq6g+4BK7ifHlckjz/LPB+Zr3BY+sbs6FFezQP5xT8dVD0E7I367fHk5eeXx+Ol2A2XxCcEvXyTGIDiZdwsxlM02O0hUUKLcAaQ5jnAz73YXWfbjJYbuALAr6eKO49JK7THxy/ZA+7XaJZk218SmRqu+nt5A/Btb5Z+UjNDLQ8Wm3xYgY6rJO/0VaCk8YH/DrGY9JwtdYh2fo1cN9XkdNwdrvWwC+HKAZKSgt3UAAcSZd66t8c3RwMPFJRO0sLZ6kwxgbvTnghNEuNqRsCM4CWrrcAY5larb0stOIK2rMVFoRtxMmeH4fZqXbBSYidJpSbW7CCN5iwIgllc0FukZII0MN6KCtYhom0mgtxpSN6++6OzEUrcX5zUAPc4A8A56e3+PhUCOMiEcIarEjnvhHdlq99teDP2gFFlbD6Ylmwbpsu/QbqY+XWvLYB9QnRtcW+04uWpW724zqtMguALztv7dnFvBrRlv2eLPwtFASSU0WnkcQDgG6jHbki6z87eu0VWRIBEOLmCHT4Vhv9w4Oztvha1nmC377n3RT5CCr47LvAKfFFWB/Q6qBEerzOCgRFb/0dOaiv+JY1oBXmNKoExaCllsBj3y+8aOEvUBEkNA+u9/iTTu5M/p2DxKKaViSeUoZ0D4egSOuBGst6FdWaAd8kbAcvovLOXD4v+RTs/pE6OZDoF1ZxtqpWamtFB0L5mpL/QPkaa5Y89Bqt2ZuwtvK9EQ70o+I5zablqq6p1xEx/N182YoXsCZu63PBHejX/eCJJR+SHANCfF0cE4t3uHt6714sBkmaUh8UGsKLNDas+eAc/Nc0pLhJy6ebK8IzyQDWKu4a1owv7ft1uqV+zNT5mTISieW2w3dIAngqMkrwBUkFcSthrlBrJHtWx0Xmv3eqwYqnt7u93Oq328+j28Lrmr4E7q62YBxCeP/2YT7xgSrhD67Uvorv4EC0zAzgfWcjzD7Qzpbmxe7+rgI4mr/wgV7GnPXsXRTstOp8bEFFpdfbpe0KdmL7mSXS3dUstFpQ918kh+Hd2v1k5bQ7ceVthInvQSL3H49XW/FN2oCSvryP+tXK8khD1lD0xMRfXufea7u/DLAqFDyVQB/T23aPXvrJrDKi6K+ESYHcA+J+HxW858rvZE75fPbyfPVR3WHqtHqT6+ceZh7RkMBp3toxTcFS+ctZopE6U+E24d4Ky/9SnoyrzBRWiri926PruvVvT+S28AaDvoQtG+cnZoxZaql9gKFm1Cy8Mh+9B6df0u41uWickzcOuN6y2UN24+MPX5S1Jfgb3t1CAan2gCSwcVf1HVFQ7r8ehYWKR+W7kcX6ij/uOM8BP0EnUYxah4HS35Bhz8LkTMqv+nmFYb4UglmO0YH7KhyWO3MDujrT+BKJi+HgE3c4HBM8LxtwI4VG03n/cm6NL3gD32PZn/9ne+H7Zb6sx/by0b27SZetKfthjsT7PWLHEEqs8T5Nrrm+e3sqDQl/yIwuV3FIwSY+t8t7vcAhgwffo/8Dn93ure3/E9hiUXVMqJrQm3m281Ihr+hCJmA1ad+fJZpYQlUlEYwq+rMbtKXDdqHi7fxungEFwpa8Mb872PV30e068+tQK7979Hq2/IgLVf748nd/Kppox6bNla9oer+dSikCvWvUJgMm4e66we5hUdUop7AwQupVDMH+JSvtUwBSSXf/HXvbhLLFqlt8m/sNbWX8P3W+7u9F5hP7jtYBQD/0jm08zhRPgrEWy2oqji0Evc2eOPPSdPxB9/r5n+Ky//yM20XrXcTJo255u+IeCu19nAFvo427yNXhMI/A9e41mt/DEVTzbqPnp3R/a5f/9XrVLldzKpdaGaJhu/qzm95yfw0ZW9lRhAAggHw1Ik58amLVRAzI6eEEVfAtGg97+J7wg69QAf0SfdP3/ePfkwXd+Pohhlo47XbwYLLk2dJCY4Zu++moDrJ4eZZkip9kAvegJLj1+pBgsIm0qr0uDVvrxaBg2HN3YQfGbEaX/pz9EA6QmcI5YH86hd5O/NH2d6H0KXh861h+N4/+87sglj2hpw8ErRR4wQvP/ympIgk7KmKkoeLRnqvc8GJoWX4VhKDpiqm77wDtM7tbzn36650jrn1jA+enFep60QzVOh9ddfE/15LAUhpiBnL3ZAvfRhOUinAqe2B+8+a/sv3B3wIqLRggnBjdGF0F6et5qFzNGBM97B9DG0On3+wBXLV/0ziOH5tXck2TWSPqGXq9f/HTvHWRhv8vLn1qAxqLv7v00+Bj3SwFcUDd2Dj22ZZ/0KALX34cPbdN4MdlEALvWBltZ3Q6SqDFHNMxg4Z3PRaJ9nPYooFVPVGQP+egdRnU8N76wBWC6p+hKKl760+5hfCXt9MYHsPSOEHv+obJA4ove3bu3TA9DE5CqimZglQAoBHRkDJoi0IP7xtchfJN3SvZ0NCxLpQG47mzA6ktAozM4F6tBX1k7ijpiTt7LXUn6QAeqUWn/FhyoKd32bFmjVEu5/rEFUmyC/efde9MX61UKnplaZXMiFpfwOrb6dSCwHHygh7PEMeKmoH9Ubl9LfQCm6QEYhIXLRrfXydRUuWOT0CaoUJcBnji95FcngykUexxuWXkLmA2Q/qRD29YOBuvXqRmKlo1JurNuc1Otlakvk8JDzRHO81OhtAbgqsPAKf65wHuTeDZV8USNzgsLlYnTN4MDtvSANcQNAHkD/FHGAOk/Z57w4MXxZYk8A9Zk7JZ6nUXx2wz5npc5+rmcAfgRep2i3xHjFaV4S5FcsWELjl6+aUWbfo+/SEwG+J03gKMwgM3+B0fHYbcz/XVlfpuzdsl+pUgqwy9K9bLOjIXqFrDUHig1wNR8BYBQ2qoCR4jKFcez9tSfFVy3sPuj5dIYQLTA778XnoBo+QGodjvTgxefN4YpcOhtu0K7GFCxrILqFUf5V3f7WDoJANV0MkWZL1VcKm+CMSrEa87XzAmxdSvrgxQGSKxHHVDrRe+oEERA44o6ukzwhphnMuPMm5Q7ASTu6S4WnoYnrt7fBon1OdLG0UMIPuPH/J/5yZKZQV5ZpQH29lQ/htkVfJKgzpAXnOqWC0Kkl516fMRZqROgbii3zHKbJhcU6vUqi1tIzKje8DRNv74eLQ6mu04+EDUcgOg/QxB60Nuk6XhBStasy/vGnTOTGxpyw+jfKnB3SwVnnJQZPgC3z7g2U336oTi9GHGn4Wz9Ik7FUvRfuf6sTgDZMIQ8W2+TXV8iDYOWmeO6zZJUPq8RFkZBGtkRS6PBYGczJIca93O/Vb+7mT50c1QuLTtN07I5l5VJFogtQ1Pgn9Lc67AQO8tu38F1ZOAH6iGINN4Y48oGOOXb4jW6tJSAX75bCat1N0lQBQltxvHw+/Of8mhEfAOk6AM5bAZhhRLW49Z1WuWpdqnaDfGU/9IG8PmmStAkVADQHiqzY0RlC1nogj60XwMeooQgyQApBvQTo+tUBX4akuin+KSl2jXoHASF/B9ogfF9ECXvgAA03AQu9YX0z3wPvW4Vp4pMmWbc+/zxwZcvXz5PXixBh4c/Dbi/qVE/PEQHMiKXVYadNaletm5klMFEHWu6HI+PP39ebX1+eTKIhrqVCSzkm+AUPXH5zuuSUZDUrgq8teZMYqoMiqIfiv0MjhWJ1oQJ2Cck1OOqJDxGitZWJJ0/3lXgRKBUcz4hzVJCd2swya/JRBKDVIuPADp0yJ2C0SHaEdQHy+YBcqsMpW8TcKkjKpdWMFY6bVcYv46Cv+ZsyKpJQx8KOpEX/5YO7NLothmhGuvdntICEX7x+0/A0K24/6P5BwyzjduBfKBaen4whE/gNaPHXhXaANsHlIMSXT6sNiV6NvV1apUYvUKFZbKPUacxng670dFWSTxoft1iOg/O7kk1CwCDeM8RotF0+Rkxbs/pVXNrDyPGLzSIRb0MPvBaR4qB2qw+UABTwJsfcESjKzmveF72BOQ001kH1SfactYrEAqMhWVNJSMUspGZ1pjOB3dwpQUD6Y041fr93YA/CvcO9v6I/mJ32wsr7n+qBzpBBgH1tEJ2VWgCaJaZwIi6Ia1NyT95XhYNBS8hz22IB8EUjtbF8nRYU2fBmo1POzYOrJWKtCs3IYduGDk32f/3oDEj4ibuTSuQ60FK0qEY7TxHIVRmC/DF99t2qZE5+eqIhodqlZ4AWEIuDYL7+2XrXqzsBCPU9mAOlI/KU0NxQo/2BHY0qLffi6GIk9JnCub+OnsuPLO6RUldrJlPizUklSulnofGGeDZKhvQdl4vve2hKg4lgIhl3nLctyWpiUmHButT+t9Cf8BPlOZPnRKV7tgqSeUO0JHzbrltxMdVjVmDOggYPwxqe640APm1m22Ndo1RtS0LRH8qhSB0jOZ559VZqf03DKA9gMLLB/QsiB0yC3QKyfnZPWoBIP6VikXD4cenU+hj61Z7ZjDB2bRG3pxedgRNFqoWpRla9hLcJ/R3qloZS2NNKuyoxUs0LOWAaIPMHm2Z9yOKZWaAB3R7UUCT9siUZKgPyXGv8vLHOEBl4BQOQOKAvNFC2SEDvYltbnhMRWkgmlQ1anF/AAjzyzmgJb0AppfRQzYzsRQml0Ki8nTPBQvsnvtlLBqikoCgogx+XLEOBcM7hllv2kLVI3aG3uxnO9Ezqdar0KivlZPaYrKRpKxPb9+UIw+YLdcn/DUrEU1Zl9Lhzf1mdZhiVYLvnGzPB6MeL3RqCb3o65FXXS03FlWp/TIlU+Chu7f3rpdemKAcnRlgN4UZoa41AA2JcYVYNFVDYJ+SbW7l4EhVEkx1qeaqPmEfPbE5tCIkZ2UrFBhEHMjoVtefRsZ7Dg/6wgyrTCuC7/0/hLYGoOn6s7JAN9DAxCiU9XkWQaqUjtApWUDmKUEhDNx2lWFoiK5sm4uhobe8lAUwPx7ZvMHC2ut/Chjcu4FYQfh5VynWwe5Ixy1xDw+9BvdDbzfngNrOd3hWsbEPtfRdTFOwES+5wMsxW5wO56kLKgbZj0IdoFUChoXtb9gto4DS1X2+53JWnS5LyBe780R0K1Du1sjVQCrY252aLRAknddn68VBq9/JZN6h17/fOnielNWajWCkb/Qvzsps2nj3LJujQVmfLaVcTdQ5vuR8OaGFOqcY+Wno6d3ZWn94eD7fThnep9UOw2z4dCnT0LqcYJMcd4J7eLXQ3kphJMIBY0WZ0IXIIBJYxYN4vKSnHSNUDA3bwsPRifMC1cQSxbCFEVZs4HTHxPhkHJ/AoHKBtnuDdrbB9oGf017HDO/ytwZIGcl6WaJm3E+yD4T/+quaBjSKVn+yjCVQsI7TGv2lGws5+WpJgoSXaagSHPHrz4QRgSLXVRsAOOnUCYkm1hAlYwV6NZIWqXhsxq28lApruGz3dswKL0qPmyuNGUT7ICjwNKk38LjFUQHYCOswxSlqTE+5ZWhX+FrNC6dlqYHw5MRjfRdr5R2AonYCWoIU6UpoIGkWxSo5PaS+fCMdGyZKptESYt2bg0omGKp0Qx2DbKWKTkOLedsDisHiqop3bIKSGjSi3PxNpOskVsBtSLiQkBL6UaVlrlZNjAlZOCd8HO8Zbt53SzGFJK/kVMTUbc/RNZQCIFlPaYtHZfod6V6CbVFx9TkbDN6ivChiqiewGWdrFPVxnMk79CHre8FuoEZD6XTYWCxUTGqjZp3XJ8/HBwcHLxYR94MoW0To8s/bbkk9Oftgg2q3XQZ00nIsXVwOPkA9tvnr8k9oqe9cY4Jhl73G/d7zAazReBHFUM2Z5DRZ9ZMOENeJd0caXnauVi7EM6zcGOh0zHrT8rNAMI266h4COmSghHg3N2u0c13JWVrsfqlDr4diS19+OHSDTUiQJfIseSRFPKu7oUoZu1T/Q5sjxnsMV6whUPGfWuAEjOeNDVBYBINHnt/MmIxIzbCpbec81a5RIxnmAVFot2CAA3Y3qLKMQqPG8pdPpI0TNFoFBrhJwWXaIfYBVRdZuYj3P6sMnOpGmGRjpntqX2fACtBmWu8lMehdH6I6mgyxLr1phEmEd09udEoJ6zKpFEMzjDCV7DvS3QFcdzbbl+XxfdgQVrtUqVQ1jIu6ocM6BpjiaJTe2HSP3ILeeAQAlIffgcifPQMQ5ELtGKusMwPYjhChdMPS2KxbqG5q01GGz+kHcmMpExrUsABTGaT/z6hgQYVEb3xIg82Ucv1h6aIfdwSltjsL6WaYwCF4Xa69ulmESUV5m9gcdz5OcwU6WvOg4plmW/t5TGm70BcjIPTTwVl1R+Qly7MsdQhojrDi1c4d/SA3ef4uxL1XedVhhYs194nhRAeZtql49BPL+aIJ48dFFmhVYasLVxa27+toFQBmtZUYgRO3rram0zb9UEB0v5pwPYN5Dot0FmgW2xaWBxLd0+JhnqkJoqUDsiTVn1CBgl5RnxhmGS+RUeghE/a4T/lxURvptGpRLbmy9MM8Q181I4aucad10Pv4SfrxM5ik2nHLW4HxEBSm97sei9jZC8sq51gclCq7oI20lpH89pnJEa+MEQbs/rmWdRbx45gJ6PCPy/IcuehpL20sa2GLVYRcYZstfpuSB1ON0/iTFsUm41a5TD7uMjFk8q8ZJJOb2EL0zDh+/m52XOmGaUN+/XxxjHKYsJkeQAMcE+9p5EVsa4dd+1eVEgKWChsGOodEIhmzGH4QAymgZBTmxph7iW9sl5ztCZ5TDgD+5Q/GzxeDg3arIw8OsIsGOud40WLLiLM/l+QuGgV9ek7rqpB25jNInR0C96RiLd3Fhk7Opkzytt3xFhNV9kOTSnEEuxwX0ZCzYNGT7kQ6G057qxtHmvODfFUH7t+Sl25ysmY1emjTLCVpuKSypc2wwhGIhIDfqKKRkbSZIm0HfXFLKljSbV0K1nJc2XMKYlf5j1S7sCSE8dw4IPRM2v9vcEExrhzrkmx8dBRFsuMKuEQXJp3QitZA9U9EgjGELL0yKvM8vgn/3/ygRHMSIGee9KsXhkWRxsNaqPAS0DXNNzJVJ/XeWBYJw4t90idMVnm6o+p20wQALSea5+yriLx87E0z18oq0TN4qA/FWTR2t6QH0HjymKJITPR0/T+lE6Kl+/eNuVmhVWH9GZa6Q+NZ7FIVmKAkV4gZ4CxfDxOGdCrn65R9KAjjCzEW91z0zZB+6PZxbhtbuY2DdeRGYUI0TTGNpSVqsFFVwd8e1Q+3Oy9pkzXPBhn5TQGITh72BTPAPBeG+k1O846x5hVxEgQ90HwMg4VIAYwz79tFbSlSL++MFot0JOmZyQBDmGOqG3fXFf3vpCD9WlWWyxvFeg1J5kxlIuETZTRPPAUCO6GhhqvK0bgErPUpryQgVphI0zAEIyzREUBnwo7EjdxWbs9kZLW+Q0YeJqZpsQzIx4Jd8bwOyA82o6A2pB5AnOAf7WT524YktfZVGjL06M/2cweAytwbhEFGUY11fjx4AZ/JcSzsqG2sAirF64KOALkkEXrbSiEBeVpL3gC6TGAtxFphc2cfF9DhGwjVAvlZ5RYzeaVXB+PBoH3wqgP0jrOU6/Dm5YhkiTudD9bMDXqw+cLGKE/aOM8q6JRkMI2FHetTceVQDMYnqo4Azk33sHLHeqA+Yp6U4xRAvBsdtDYazjzwK01dZZMrnscfUBqD4v3P8aZv9nnKm8vqYYe5DMxJ1TqlVaWNdrRBU5ilyMzNeDJdfXNYrwByORZDoSZSouC5WRWWuU0++3e+cMcMCumonnp1+c0KaiZDHbPioJMkk9HKeLFvt9wpz5CmBpDjiiwCwu5r8TlIIwIn1S2I7sGVPlgCI7fMl94DIcd7JgGb8Q/9TIq6JL1kvpxy7nii/13UHzJRvcgsmovWe7F483z8YnIeLQnRgHTzwfLgYLnoUcwyTo999LZj/5K9JxQlwVnJ9TA/2Xt0jLx0cNGxIbuNFO26+vvJ6IYcCZLyFbcpzlevLcVIkfy/E8VDm+a9oMg24jlaIEjZdznu0rT9EqmDfsLdiCmLdIYuXYGH26Btq/xMKMH7OhCfzkQSIQgMmmNnOpBWG70d8smF0r3MxPFE+R8e5ABfSzHwLH9wtkPhcD0syg3Ho7M8NMmIOTJ7r8P0FUKdDDsIjYXZk125e31xFgIN9tZiHka2XGwrhCgiOj8uQ9IItJnfS8PRx+7XmeDMLx/lvvwMjQobtfNohJS9+Wi/4ADkgl16g6hJxFQmYF2KnEXIe4B+hGDDo+xEmBUfis3v0fo7Yp25CXXZUqREOkjN11rgyGQBgfCjCCjloZlqAyja5I+lyRpFqXknzxa/1FaNacXydfGAIEJ+6QOfdEgkbS+ZlxjE9D4xOBo1y7d0UVZUIG4e7kXO9RYAcavhUBC2KIhV1Qbwc1Id+7xHHw2/FYoFyXGJB0CbafdhicWtgz7lgvYQpKX2xAqTFwdokB0chnxtsl2h2uteZmS9J6+FRMJDhgDEeSV26tyXXYWCRGyhQh8kircaSwZqjV4PSHlOMTmrWwS8sWB7KDzplb0nHms/YWsdcYRHuIBe4Upd1cPkWgrmb3oCD85LGIbqI8BjQjnZH4UHUhmgkWmnK5IHUqKHXsSHWVyeE4+T6kV0zErTxIBYRNvaF+mhnitOHk5CCGE6ImRRr6oxs7KQkqCL/SkSb359LAQnVGiHeS5vzFIGmPGifdQDnYkrUfwuosV8flQ6DXxaEOC3afOMg8VeNm3fekAeKoWUoa1tT+AlxheYiIQ0qq4/i6BmSczXc+4diz5gYXJeIfd0Hx5hu7puqOSDxJo3KdO/LWg/CJkdRHnn6d9Io9YdrUzyzwlv+zhXE+3sPed9F7kfPfoRlwgWpi2qldx/7GfA5p54PP+plzIRQWNfSGrV5AFL52/VV+rQ4AE5IIgzgJfeGbRSTfmOMGadRvj0Yd6P+cPh6JTCvSg5xPvbeW8Jr+zJ5VjMz0qg/K3q1FDOXTDrv0Ec0OAr0II0APS1RLdxWcmyQPRyPA4k2qaEC/rZX3HiyaJ2fQDL/TWrNzFYR1VE88OJZgvRquiJ+Hjs2+YBNw/quA41F0I/P008e9HvJtmlvrWPtZjcUB2wUGAQlVTM8hEPZnMD0KW/0X3+na1JNzuuGMboypx32BIcsQg7yps4cWJ5KfcuOrBfc28cVTMwfxU2v7r1uLnZvmN3OJBfMve+oyU+CKd4xv8YVncxWKjABwlMLmg0KbGd+DA0fJsdgAE6IjkZXtAd6WNe1SVQKPXpRL/Av0EiTOR63oYQoTRVSxQ9s3ZAXtKlnQpHTUMIEWh6/HJhDYdbPcCBoygKwWs3KzWVe3Zam8JZkZ6J+jRmI6m1I0HOse0oRqb46b1/IqM0kDTuEzlJ5w9AQI5sPdXMDC9nKxkdQXCQhxzrSH0NCKFOiLbS7edoCJS6OWJpwUU4OY1SKkLcP8nKEnifstKOXn+h6zYTZ7VnP4SdQR7GiG8kzG/2ZMv/+yn3Z/HjnfMHoOXk2Jm0yODCpDnXxAGltf4gHT64YA6SE8EJoOpWpjSW3hXOQJ1pWpqJlFmvzG/8JFBURigq2zwjdJb8A4gBKNuPgtCytN+QXKZ+GrtXkjiGl8H7j2UskaCPr4QrAH4bD4lRWCWX8e2DQO776OWPx/rOSb7vJtymAbPgRXSsKGHDZg0XOUKW2QDQuJgu3ICvQK3KRBRZF1SGbWObgcGsp46y1Ig0pjlyVJjNW++Ka5z4UQhM8p8PbzIDUMEdylLJQIhnctYC3esnSW0uOicTHbleElliHDx3k4ZCI/+tcjMKtZBG+vu1jYRW0QAyCF08Pb6XBm3iWyS3sJcmjbjf4gbsQjwqdH2wF8ySyZEyIFAaYPU521hMd58vTM24YSwxP3TCBHLjaaujoAnPuVBbwOE4vxDORJ0kXIKhoVBh+0P2RFwioGuj0p0ANM+KOB4/q1htgP8Wm0AScwN1Si2JAT/xfwnlmrPMCYnOMruClQYgFyIbBfOhkifmwIygKHWvU/HSnnIr83XYn9FW/Py9rKQVPFD745dZqJCCILijqzFYWnpI8uwcm1d/Bz8XnyXJObq0j04pSQKe2hOqfUsn8zS+yBTDKTyARgVde1AxyDwAt4vYHTpdKRVyH6rPtRD+JVgI3n+fDkXt0mdW3sLNvAEWOrjd0ioxHOeDbx0QhN2H0maIi8hd7gQYOXqh/0v2DTyBu5lN9bPtLbMkAd0foudeYrHW2NX0UKvAIoGJkPWwZ1cU5MPKGt+b/BPgfUv35JYeAI4DXYGSpT50cMDEdBN2z6k0lzt/bXwK1HU4feA7MXeRndJ4ifuZgKudUrj7ULMIQ1+VXgp9H8+Sywzi/DTI7SodAv/4DfRUoU5QzgCzUS+Z5+yl8Lulua8OqFqnLV7Dz6SRZIqj2lUOrqEcgJEy8F0Ulc1cXg8vQC+52H9h4Gp3VUdAAD64cC7jtgVKfiwfBiUGeHSmFSy0DE2IUW0pC4cJOtIYYCDfztj9RgO20ABdiL4ekNFsu2YwzJD/AvNYv8gAGg+kgfnSRGuteEDe3CH69ijtciQ/ywwkXQU3joIMB8BggDiEhESsm67GF23bjbwXnKg7QGj9zt8CQyXZCPMSymthbz0zKstt2w7ngbhCRB7hCMWEeq4IJzfijZMmRtlqNkJFVMiztRPA4jwk1Q2AhvdjaDEFpfgBY1LiZUm3A8UULsxdNGKFjvtJLv7o8gU4/Oi1Seiedk2677k/2GTyDCtTXx4zHTahaoIB9lNmxlAVP1EDjIRRnro2ziIDRC/PtVUGwog93gBXeeIkRU4uEhUu9T8TiokzXikkBX1EA+LByDMZ4MLmekCpEnB2QuV/93moGV+qvqKEuyiL30JVWy9ngBgLmoyCOgaIaBXcnaI/AfAteT7dLtwegWdolxKy8yE/vSxNG7sCQcC4leDxHuxyzjbjWGJ5mHhAem94vQAVG9A+E1SkOQNwz61KjLBrJQYYoW0Xa5nKxQZgr4Bdknwf0fRQUgP4Z7kaEYu8L/wj7Ql4JRab5/yl3hUToBTRGhGTAfgglLtU5lIM4qGnAmYZkBzTAOcgqWyvPzpLpvGc8VlK/g6IF2wS+vUM8K/gioKAnxLHm4UC8kpvQzrZVvTYw4A/RAalTsAIZYSvDIYRDUDrTV2TAdwtPg/eT7PQbo7+OtEEAGkosyXfGvt8OHyqIbGJURCLws3H1mgAWuBg4EqgegrxDlB3GMMhAFBCcw/nOtwz7Dy9hSUDYHdHf5sS9KDPGzROWgA9CHKlfCHE8RXY/kIsvoXoLRcOpzsHFJZcw+0drd/E2KBpmTvGP8ERyE6rphxAo6ChhvwBxM8F9NNroqCu2gDZKZa/1TFE1ASdTPkDsNJkD1CnsmHLhJxWglzdctqS2yZ8BM4hawp+hHBFQD3UfAAKDEBpWNwLNHV0DGAmbJPVI80NYbf2NXlAoDEAXCqhmt1nX2ppvAT1fsuu1mws9SZ3Aywc+0lqqlEugqOXV9Mw246e+JG2pY5jj1Hakt0Ld+obAIqHNLtvFrVx05bIpj7kV6tWuDt8VM8VzxiPnqiL3waFxBGac4wwP46Z82QEFrqkLmhIQPnZllmSXi4eEW7blAqjoumkHgO8IGVOmqn3VpEq1cJxtxN7d3VlOHZIZu8rDbaRgkMe58DpHO9Iz1qCPbRO6PUqi8DTYky+EkJjwzRcgth6X+pXmOfXrCEoP+HnyUlTVWWOs68+tlU0jyoGYFX19GFnmopYtMtmBR085uo1zQMwt8UCTYROqU+6sNr7Z47EKnLr068U06yxm1RLFRVrFVszJSDK/FtaC7nM9ut4r13Ue1JkgBlZO0uSXvofNLja/ZjA5FSQzN2WuvtPFNSunyGdlS4B7H4p0wMeG8BRkLkGoshTwGSypkCTmC7X75U9axLumV2LsxzcyyWudPPOh8PrGYCqc2ZFJqLrTmL4ZXh4VmHOvLQyXSGRSLl1qjDDXZWQKzxFv+Gow3ymaEXHAmjE95cqZSIbYvELUsiGXLfKv9cIoq124ZMWGmDof9xPCVG6Wzj+rQH6aDtlD8A3f6Rv0Tf+xnz7tVL6Y40jWClUCu6KLLsApk03QdTRH2lyPAF3zi52vuZgS8LEkCa7Hwtbr6wSskjLZXJePV17zP43RmUA+YxyFsA5miERylfnyaFT9iNQ/ZMiZeUoCnLyxfCYP9qqoKVAQvF2y5rgfPkEcKSIU9QfFMsQWiUUNOZPz8PkptSBm3Hk1ix5EcOReYbU9B9RCVTduc8kOBpmOVP2D5VRKxOGsh+Wn6ol1x4zA+TugOxyAaz6VQkhTqvM9JCXvybf5KsVELJhrUUyNjqmsDca8Ezu/+FEgZS/EU/n5jG0ERKZz5xD1I2k/palj0BAznWEiVkuCkpjuwA9792MAaBD9OVWYX/AJFYEa2poNgXDpQXMgS+r6vjAMH7j0qisTFhb5Qs5YhohPzKAOyekrDSaFAhk+0fOA/B+loqsXpYZrGKVeoSzozxNR7cpPHS/VaD5mw+OR0LxmD8gYSzPqpIVoBNQSJcYFOV4lpRURCl9C+TTz+yfyhU/h4uBjrbC8KYMwDO1dVrkxwnoFyCjmii2Fe3KorCCoKqjl8aBvKk10UpRdhkUeZaXM0s4VhA7e6UmI/T0tTyp/w8XMWdqG0AlRqXlMUEFeqOhvFLt2rnivQMxweDhg8DUmAvSWmMqoOV1h6qGc2w/yBmgmfAEKGF5p4RC9VUecV6gM4XefE5W5jYMgIiuUR5zMZcXi1ZLgxro8k9Umf4z4S6T+jmNTQlUa6kz3jCBlSDH8Hbsj4joecfut0LFdh9dKhDgbIOQfSwG1/5tG0BP0HW3sjY2qntFh5vxcxqp9NKVevaHJxwAicmq63LJbEBnfM2RfB+A4fbshwpBuTFHvyg4Aw2kGOpLs7uf+clf3AF4hm7bACF5ojkCYszNBrqdj6Ehu7Pv7oP695jJsikVQaVIR0YpDgtbM9nYOjb0kWPfehRCPs8ZYMgFyk5nx4QVAAa2UbxsRgD2hJ5twAlJcOsGYG1vmtt1IWgb5+MTjXBzboufiFnyaHZZAuimPfhtGhZ5KSfhzLYv8qFgOMy+zQFU43/r5YGUvQPc1CZRWcZp1ZiJZtXQljxzteKukguk44PpolOhfs8wZkQgXVPXrO2YKhwx1UMoKyh3VPokArzk0GnsqoSOiituWkrlw6yPjQgqAO6GkLswwDO01iJsj/1hnWnljlHthsm0lxX7AY16K77nqXTN57yssQgvYQxtA0ga00LozNvttu3oemBGaRHpWjdwPQMYxBcoe3NY+VZfFEk7GuWwVdJ7X9lAmhH68kgh7A0EGMGxOIy6wWY6BGQYzLrsQJy3dRJHmafp8viJ0641lLGOAYh/5OpBhoqDCXPgkVLxD3kVFDfABGM2Ba2LXi0VQW9usgOlblzxPzEf0ABO9/UpkMt7oLpStXUMIF3+MtlHGBJUvP65GSg9VSw38qtozjgOHRcwA9GLNwoDKCBubD/qt8aTycWDY5gh0zeJ+2H3X34ST51zf3rmkzszgEkBBverDCbMd8ipD0A0EaZCyR9Qirdg3fmvw/y3jYhCei9LGguGKGXlZOHyOq45l7eeAUjzg1Y5EbsTNue7DM7bVMR5PQ1CM/J0DaVKLhJEmGsqMbvR4HTl+TNy/XueFmg5GsjzegNJ6xogXwnKzZgjpeavtlXXuOG6cCuMwwbPjtSnyS8Z1moa6Ls88TD6vKmpVV7bAGbxStxZo8KaIZgor4eNjTyaLnrdwk6VOa1z9cb0kVtzvCfXWMVJXLRrjYO9lgHMEBmwmzbGQSQ0zfmkmA3imOtU8O69SofAXSst0NCLjtllZYRmafhW3Lt2GwYwSdhjRjDb0g2eZ2nO27GCwlII51KQjwbopZMC5YQf/aCQwu/Loiovzt8xVAea6DsYIKRPYHBDTgQLwGz1IORkX6PZIXO1hjwvtKFliqGtA7e8BYBENNQOg668/hna41H5CDZvZXmN/X8dA1CpfeOkXjaI5DzRJqEyfTESvRpMNSLmkzI5BLzu20GndEDU31Zog5+NFnWE5PpfT8OUd+RGZMbxtdb/OgaIhpUaJ+nRIgDkNxnmbp0v2to0By/LTakO6S7slTWBEqMMS2mv5U7TWXpAuwydgpz7+Hrrfy0D0ORo6RQPMqeztF9Np9NXVKNKn+dU4EqxGaDyoFhbr+WpyoYrjpkHigskW6fp9MUzdtNNrey7yd0ZIIVv6cDkMjQgOqWlSKUNMoBuhWfw4cXnyzIDN5WhbWNUKQ5izuYkW+yIYEqh7CDjQl6t0OhuDLDJWisaJWhAZf1rRTCF1dwG+yWOQD9/BEwqFsrH23MnvHASBcNgPl82q84D+tr98K5c0NVOeuAa6LJzAxZwOq9J5VICuwwGbhkx63x6bVXZONDwyY3snNFJxu5znl5wiNZPH6C7MsAQPfwvlFR/AJpd2vja+/8tCuo8ClwGq1bRVaCY9VZNUdoBPRje2Tdc2gPN0QsA1Hr6DzS8s0t4B/0XiOWF6eTwl/1rmQDD/Vvr6dMha06hoL5XYliR9hKhKoNcW+vqaeuSn88H0ygP9r/Ug0Otum+9bKH0aqMzsa9xE9BY2uj/aZUKPl6gvOPIIQXpisY6NYuHFRmWn//nI3Qs/gHEDvfKpTA3GIaeoVY/2wSgvfq6bTu1bADudWKIP4ddfuma3VCZmr01i+pjQdC9fCbA6C4DBbDIeR9ARzb3nHXddOA6YNz+PAscvXgGZI3tf2AY4jhjL3o+GRzA0IdF7zG97oiKv/nVbAHFbAJd13k2QxH+ut8+QvnqxkiQSwZUem9RGw6tbQCIQDq7XBoYNuuYACYKTJAWgD6ls9/GUzfOJNjAR2AeKQZtBOSx0QvhjoIjqoKDsMuyRaptDC17tFDsmQZxBzAcruM4b74DHE2PXofKzRNu6ivVoXUqdEoCrVO//enGY8XxVNOVGsGl8FJ+TWZoY2OzDyJliBZwVLYt6731KXlJUoDNDliI5KPvAEUEdJhAm18NOveaZqflBqbB8p/oJ72zl+vkvwr+Wfu+At0pEHbPj69Q1wTwgnRjmKUhkYVUk56hpMSIcuF3wYJ8UBdwaDqIhKEYaD11i1AahtJBLOE/I9rgcq2D2+jYMV9BeDNhs/lmsa56HBFwMkajsLi1gi7/qhW1oTUJ+j5gnA+T/VjtO5DmJT9et1wt6saI0q010u9+uv3nUxubqr05FqBPJuZLwC9lgJNSCSF9y9WBHQvCheg7GQAS/M/7eUlaNo0WTdr9fcbfx9yH3aSdeH51oP9a6LFxCgJ7n5QYxMvZbAeFRewg+Dy6XwJQY642KilRFk343eBoBkFRSfhzKZIZzaLz3hu0p52MRQc09eW4d8lWf2Yk5ReiC4rUyiML079YS1tbeQLy0hKK00nowOlYDar/Pz5B39EA8Bov2b2IOGAwuQ6SFZpfrV5OJserVUxe9xq++W6flEir83UWaPQzjXmVxg6rsYiimgRhaWEvmQqNO9tkiL6rASAlpoMKGRVQ0frlNQSCEGk2mn5YwJUrVWKwE3XksoXeXBhEtdaLJtKK1+6MbRzwPUlshhVX0Z0bAB6YNsc7uwevdQPZQ+Acw2dYwlmGdOxvPvKkV4ctd5y5r8koN1Ws/IhXdR4wUYX04fC0G53azZgmJpkcpn/d9b8BA7DpliD+7+wOjFSgcsbMj/2lcEzrxeL4+PkYpM/4oaByCfmZRtc0pyqvnzAJ6EpWYmmwTxpjnvXa3OozJ3i9+/emDMAY5tQCDiPE1d8TsP3P5Co/7b9bZT8yaXNj3/bvE93YD6VKaW4QKC5xtbNLbH4yAMq0OBP2mvH/TRqAzVp3WNmUNk43SG1gfyEBOpiRHGnvhDebeaxzgufTncjakr8Ycoc8fUdBkc44JiEA7stl+xVtMlRQpqEefyPrfzMGgG1zHi0dZpzEbo0ng6HJH2TiJ6t6e3xn3xDWJ9VjkUOWEBHDvHHpDlCrWqcsLio7uuc4cZutgvnXvl7+dcMGAC901oknUdntVY27oEGLu7L7obJAuTvxAUs9clMWTRM+YnmBrnFyO6/5khtoqujTO7yR9b8pA8CDP06nHdmtTRGOKEXw4HhXU5n3jFtXyqD8Ilk6TlVZL2aum7OuGs3OXetdE/vb2R1fhw56KwYA/U1uAkPcLeqVsgF1K4/zsT+tE6vD2gfxb5LrXCFMOMclpqNqJVe5plZTVyClwz1EP5oBaBKwxDzST3tTmkVdAkN6UM7GebYt1bQhOgGljRJeUM1hyD4fxaKkQn/Q6fDMB60tnc5RJQrZXRmAThht80wOm5WvGD16pLl39UxpaPbzR3pBvmi8DcidiHMYLk3zLVHh1JJMbsRQsqdtiM/Qj2gAem6f87JLTMjkKElqPH8YjmBNAW0nwcyLkaIjOk5TIcfQQXz5PRQzzmY4xqK0nCQXXTDiUY2FOu4wTa27euZiG5EA/aAGkImKFENg9Gj1T68GBx115cZxVxzINWyq+yvkKMh0ceZlSnM+ni/c+9pxwSBTMEI/rAHgvVYSlBMJ1fRftZ+fHF09Zo7CWp1MxgcAU2PHwcWilrD8vww+i/HODrWzXOUyttPLgtz3ZR+PuUHcCjnQNDA+vNkVu2EDAEFkW4Hlxzjao32XfmL/hPU6WFzTAxyE4ykUPhU3qAxwkh3txSlpQKnmwjrcTCENbQ53rq7ZDXD7BqA0vTbt3VEtL0e4MTK1Wtk2Cyg6DRrw8oeOF4J+CZHr1jNdAZ7ZA2FuzsCIXO6rGqja6Br0h7syAO0dq9TJqOzUG6W+eOViOoaNiKUXOjlExjcbBl0naSiVQoqR19poqqQYHJqXE/TjG4DWVDad+hagWzEDBFbUq8jFLLbXoR4ghLcj8t7ggcSB4nndNex6PhdO5Q+A05nfuPu5LQPQ096uwM/KpayzVDH2YzSHq6Gi9DwRzeIpRkpxsXuzoFG7xw8OX6i0Tm8w+7ptA1Cy7sKtZwHeWRxGwWBuDFEAzRU5eR64mB271PBihfamcEeQbfkA0Fnc/hD9eQxAN+mqlhvCuXGo2H0rMUXO0HPHOZCOhZplkkM5hR5r7sO1kTXlo4Rvy/3cpgHK9U0YWQl+hAhDuuVL7Iem68jqu4RsDEioGK+e5qBmvroZyuOdmfiIh/5sBqDstlWnauMMJ3BFvDnzYjkBodn8KTRsNctrmskmzB0AaXy8rFU/uY3o5/YNwHbNuFrjzIA76Ylof77sMj/O7cgzvYYXy6ufmZwVzIvIpj2CBgfGdplR9D++AWiZ8VvbLt+K1ePW30/8BJ1OqmjNk+BRg7iuI04zJb48fpCv1YRNi48eWPvCEP1ZDcA26vm03EwNCWbnZNpzcpDDXL/XfcMFYM/9QMgBXmE9G07I5lhNunu7K3TLBmDVxuNWMVuddSp5AnHQ0fMZZPzpk4kSJ97XMxnpp3l2mH3VhBsnB9R7P0B/bgNEYPIRrbkYaqxM4ImH2Wf8QhQQZrtKgXPOAQkghPdWDPKpePEwq6vOmQJNpH3Zu8Xg5w4NEJngAxWYUQvRQsmAaj43hcvjE+dTTIRNRmZ0TSKTDxvEEC05DqepFWYM9+hEEvSXMEBcUtkMaNeGI+hDUiWVg3Wu9/FCCAXpVKtnWkaSUUsRS7X4hhQtiRd/M7ke2EBJNLuLpbkbA9DN1YwbBvpuoq+x3+m3F5tYwE9cf7EgCGMP1WcAtuiHVoWBlc+kCwCD3GSDY1ssY+9Dud6Nu1mYuzJAIhUXBfJfLi6+XBwlje5+rv1nkIMiL/NcL9YMZU40pPs7Blc577eAVZdAaCr/jW4z9fpuBogbBrhXo6L2RMGQbivA+AEbUhKmeAE7NGOzeByAoMLE3GZXHJAO5FJ+/y+YW6TLT/w7W5E7NkDSMECGQ3VrA7RfzVXyNxATrpOJBDHha9Mu0O6jECcR55I6UoH3QmB00D8bs/wR/bUNYFQiG2vHQ0Bz3yeeq1+QXAB/WejGkUdOuZvsfACvb0l3f/vDXYSeP6ABwpD4XeoOTjr6ZWUxU6fV6nfcEjLPcv+KNInG6R9lSw2X03QPlv/bXS//D3YC3tIGoCL5EmwiVHA/uBQIPJCRHziSrnSQhf/ze3udxWN0w5yfP48BNqvt8zWkCfXrmIpxq4ciNv7KEflV6fGAPHiwe2+AlCog/xEGGJH502Ld/moKn6IEEXBluMwOU1FvLjw6ftVfc9OX/iNdEGnbN7b6NG04F9bfQ2+njgjxp65+9PDzrz2DasJ/hgFg7x33b8oEbIFPhfBnw816wZDmcgV28hBAB8//bq/+o1zCXdahh2/E/fSEGgpE9RlaF833kcqZw+F3fPEfJgqCSPxqaV/bBBDefBXSX4+qanJzDc5kiH/0fd/7BwpDPdoodj0TMP/Cw58Q/Rz1uQrL8d0H+n+iPGDERrDWNwGmSk6Cf2lwiTUsP1WbDNHfBjDrIH1ou7XiUQok3BdgNNjrR8nw5nj5hwj9bYBCE1yNXbuqDUDNb/lW8C+nPrLadtw+7tZqXv5PNECk1gezAarYgFU1r4RMlgaWUed3rL2Kuj/i8v+IBohB0fuDaTn5Rbr604kAJLAm8QHoebIeteUc/YC+/0c2AHx8Gknej4vIZmlhtzWw6JqHvKIbGnecPbr60ZhtD/2wH+tHfbBRVMCctFtupCesgEWh+W/J5IwzDTTGbZkfuM4e+0vlYO+/DYDKFvIjQGe+WLb6btZkxvT/+q32onef/nXzVMiltgZQpndfDXpfkW6Q2d8GKP8JEvH0t2cnvZeLxXg8WDzvfbyK40mvK/TTj+afF61Xy/VOLLX+o6/+n8AADKXwunmdRTalXoYRGk8+nzNYk4A44Aj9GT4W+pN8RiTwZ57X7XY9zw+IYXWbXZ+gP83HQn+pz4iEf7In/osZ4M/3+f8Be1PmdwVIJU4AAAAASUVORK5CYII=';
const NYXE_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAMAAADVRocKAAAAkFBMVEULGjmY1v6OyPcAAAAVJ0cuR2l2p9IjOFpGZouEuuc5VXlsmsUdMVJbhKyn4/5ijLNPc5lVe6Nok7t9s+I9XIKj2vsnPmCFs9l9sdye4v5AXoMQID+izu7J6fyBqs3J+P9AXH9ifpwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABGYoWpAAAAMHRSTlP///8A////////////////////////////////////////AAAAAAAAAAAAAAAAAAD1GJL9AAAICElEQVR42t1a13rbNhQGUGwQIMEheSVp3/8lewZIyRkiZVu9KL9EgwbOHv8BJf765RKfuH5D7Qup/5aH+Frqv/IQD6D/joN4APl3LMRj6F84iAfR3ziIR9FfOYiH0W8cxOPoM4f/hIEQD+Qg7qKv7+dwkIE2Dl7/dtuNzrgvZGDGbOBtyCs70MTV0RxjsE/eyoGElqdNH3z18rzP4gCDKqVpH1YXaFbFKdnrzzLQdmn0RSpxvTnpxqEEt8dgh/6TlL59TtK2Tzms1pNSuU8FspUyrZ8H+EyS+zKu97KUZ/1R4s4Ivyi5ObJTSqp+yFZe7mmllowrP3AZq2H7ZhYKG/iO13C510slnUjzB+SXFYyi4PVyxYDkg7++BUt6eL1bBx1AMAu747u70Q/xnc0dKBXQUvf6ul+CFkFuLujcO7rauc0xSnXCLvZOB0h1RrmaBqY/gzc2ZUwCsblSnHCNgRCW/i4GsMGSdOyDTmtXZWnOfZFLb7TWm+OJwXRPuHZs2YBv2z7T1HHyyjHgJrS/leouP8/bNnUVk4Zjtn/210GEMpAo9XAAGahrkwKjDnLzQgv6TohXZa9jSGGYgssmSHl3zEreiL6kVCx5Ga4oDO+MBcygm06vBo3GPh6L7Z/BacMhBayGEhMiio4uRCv5obnGYXVgleY6S6KfQYElWrSf7Y5EqNJAWFaHNSAzh6DIgx1FiuXPKvDfErCUEXZAkwhHYnUAQ4NNpdcjdKxBMhmFshlSZJ5JT74PLcdZ29EG4NQfyWHoKxpzuIfgp4ZJhrDYh1ufgf8j3aTkgySp+E2LkzySzyNWe8ofNXr07mlEFjJv/X4rrGgs7WKv2t+HcoQBmP3UEghKp7JDJ1ySVHG4SXApVEhe+xQUawgJqdWlO92KUomB7jgC4V8p0Mcq2RjdEFupkiPKUkhTjlWsF3k/hqgAw+YTCjk63cWMHobNlKkcsBAzT+jnPsICZI6hm6m47xQMBCSW1Rc1tOqmR4saEYOh51ICpJJlf5iiAL2gGdFO9XZjcLDEkANT1KfB5khJDMFiC7XFnJqJtPtOZSUOthrdHA1WnOJNBhGxD5cgqcIU0IHJiVMFG5G86YnWhUn4KLqeXDytjgbtzLPfyTJEUpWzizNJPkOBeBGWoYpVvC6ICDW0yMtK8hz65XaWSUKD3N1xd6rVFqgGInWUZ+ENE07oBAlRi601bUs948zbqWADF04dc7Ipc4P3E9yA3OhGJ94WreGNmKXK1X3ApXPL8qbin4IIoZv7JQ5Wv5llWMo/b/6n25cQwZ1J3+412qr8x1juf5Ty4/sfQ3AIT2636/TPbQow2T7ZfkVB2vg6nt/Kt29lOafszVr5Iy9bkeRuMdJq4t6SyHPPRbFBzDCel1KQQSlLSIN5ZaxXCi20KNYrBLPbxxO4JFLeKDuO0Km6DW31P759+/F9M4JOckqjDbTWcxHcwxavE2DPOdGWgShrP65S6TfQ4rxsX/vB8QpikbyHKqP35lQoppQ9MnUXnNjeRy/eio5W/zzUasgf2gYFS99k4SlXcGmrc113WW9AfbXodRyAVjMMPrLBWmqOIOFNBhnomjr2tMpUC1VGpWuzflfbaBt4WGgoFVJzzBBM8XbP8WWrVY7iSFmr5FXupLAGWVl4Hll754r+8g6qlpYasfDUqViT8YJ3smVoUybIBWPmbJlF5do9/jRQ/GbugMWIdxkQmc0e67Y6EvxVF0ubtJZqbbGDuj3cTjIQpEOkszL2FUcbcCGKGkKHhQFcRZrNlDSVxx17sOU3oCDcqJSlHHIUINGj9YDVqLYaDVMITwmAlnYxdkei9JJBIUAplat95sivmUMVuiIM6K3LQJt3JBDKPsv9KSE9x4aqCc2SG2YCVJ0knAVGJ4Sinih/AYNDT20DxUk+7eIWnEix7SO2hUE5TIhIBmzVtZw41yMGW+7AMbhMU2QhFJlBhgMAfjIoj5x6nOsUYxFN2rQIBE/kli4QEghDQGmclwcCJfvIzhMDi+htrqy6mMCvU+vnoMeUsIogz1IxeRDCo/PMPrKDjS9koiASHFRMimAzEKeJjTz4CtQMgUgTQqWpEwR/wqiOh8bxjgdko3nCQHhHkzwg9mC2IUj4fsXaIxZpiwc77viYjEHaYaxTWZ1RRpwoVU8sepK7kYuk5CTtfYO+ki8I1qkugS6J2QLHKZ9oKHSS9Hn1FKvdfXMyl6J46YwUQHi8RgWUT+rAKDbniTGpL4O467ILYkGUVL+E7djLhzZtdAQzuVrgeKVVFndeODcBrrUWW5Xdit7Mo49dp3DUCA7VvL/zVBiCfA7cZ7kRboe9emzDt8DTHhWChcSDaDJ3HknhqPQ3dEUgwYFzgh4mrWvnH9S38ENr2Tr7e03k0ZO6c62XeTgiTfYZSwFNmImPJC2jvl4N4u7Lq2EzqwNa2MPiMrcTlsTdD04c7TnI4sUHLgNpBaCEB2GcjoCDHZoGmfsXnHwWJdWHjjXBq+fSzguw5eoKDHrHQ76kSQtnGjwb68RHr6ENXwvEkc187G7WsTvgeBuLqp85vXb5rLgpx5LaHNqiNGN6d8qazx7va8KGEZGJ06au4yp44kW43n/++QH5+7zwwYJakbovcNajjT7wgOIIBw3AvB0cQV1yMCBfxfCXPCSiiQqsHywMcDDXe/3FT6HW82R9dWZ0mMHDH9T9D55lPv5x7+MfWD/+kfvjfzTw+J89PP6HG//BT08e/+OZR/z8518su0lLv77+BAAAAABJRU5ErkJggg==';

/* NYXE yazı işareti: logonun alev/bıçak uçlu üslubuna göre elle çizilmiş büyük harfler (değişken genişlikli fırça darbeleri → çokgen).
   Yazı tipi dosyası gerektirmez; her cihazda ve çevrimdışı aynı görünür. */
const NYXE_WM = { vb: '-7 -10 381 121', ratio: 3.1488, d: 'M5.5 106.1 L7.5 102.6 L9.3 99.0 L10.9 95.3 L12.3 91.5 L13.5 87.7 L14.6 83.8 L15.5 79.8 L16.3 75.9 L16.9 71.9 L17.3 67.9 L17.6 63.9 L17.8 59.8 L17.9 55.8 L17.9 51.8 L17.7 47.7 L17.5 43.7 L17.2 39.6 L16.8 35.5 L16.4 31.4 L15.9 27.3 L15.3 23.1 L14.7 18.9 L14.0 14.7 L13.3 10.3 L12.6 5.9 L11.9 1.4 L11.2 -3.2 L10.5 -7.9 L9.5 -8.1 L7.2 -3.8 L5.1 0.5 L3.3 4.8 L1.6 9.2 L0.1 13.6 L-1.1 18.0 L-2.2 22.4 L-3.1 26.7 L-3.8 31.1 L-4.4 35.4 L-4.8 39.7 L-5.0 43.9 L-5.1 48.1 L-5.1 52.2 L-5.0 56.3 L-4.7 60.3 L-4.4 64.3 L-3.9 68.2 L-3.3 72.1 L-2.7 75.9 L-2.0 79.7 L-1.2 83.4 L-0.3 87.2 L0.6 90.9 L1.5 94.6 L2.5 98.3 L3.5 102.1 L4.5 105.9Z M9.7 -7.6 L11.1 -4.2 L12.3 -0.6 L13.6 3.1 L14.9 7.1 L16.3 11.3 L17.9 15.8 L19.5 20.4 L21.3 25.2 L23.2 30.2 L25.3 35.3 L27.5 40.5 L29.8 45.8 L32.3 51.1 L34.9 56.4 L37.7 61.7 L40.6 66.9 L43.7 71.9 L46.9 76.9 L50.3 81.6 L53.8 86.1 L57.4 90.3 L61.3 94.1 L65.2 97.6 L69.3 100.6 L73.4 103.1 L77.6 104.9 L81.8 106.1 L85.8 106.4 L86.2 105.6 L84.3 102.4 L82.5 99.1 L80.9 95.6 L79.2 91.9 L77.5 87.9 L75.8 83.8 L73.9 79.4 L72.0 74.8 L69.9 70.0 L67.8 65.1 L65.5 60.1 L63.2 55.0 L60.7 49.8 L58.1 44.6 L55.4 39.4 L52.5 34.2 L49.6 29.2 L46.5 24.2 L43.3 19.4 L40.0 14.8 L36.6 10.5 L33.1 6.4 L29.4 2.7 L25.7 -0.6 L21.9 -3.5 L18.0 -5.8 L14.1 -7.5 L10.3 -8.4Z M86.5 106.1 L88.6 102.4 L90.4 98.5 L91.9 94.6 L93.2 90.5 L94.3 86.4 L95.2 82.3 L95.8 78.1 L96.2 73.9 L96.4 69.7 L96.5 65.5 L96.4 61.3 L96.2 57.1 L95.8 53.0 L95.3 48.9 L94.7 44.9 L93.9 40.8 L93.1 36.8 L92.2 32.9 L91.3 28.9 L90.3 24.9 L89.2 21.0 L88.2 17.0 L87.0 13.0 L85.9 9.0 L84.8 4.9 L83.6 0.7 L82.6 -3.5 L81.5 -7.9 L80.5 -8.1 L78.5 -3.9 L76.8 0.4 L75.4 4.7 L74.1 9.0 L73.1 13.4 L72.4 17.8 L71.8 22.3 L71.4 26.6 L71.2 31.0 L71.2 35.3 L71.3 39.6 L71.6 43.8 L72.0 48.0 L72.5 52.1 L73.1 56.1 L73.8 60.1 L74.6 64.0 L75.4 67.9 L76.3 71.7 L77.3 75.4 L78.3 79.2 L79.3 82.9 L80.4 86.6 L81.5 90.4 L82.5 94.1 L83.6 98.0 L84.6 101.9 L85.5 105.9Z M95.5 -7.8 L95.8 -4.0 L96.2 -0.3 L96.7 3.2 L97.5 6.7 L98.3 10.0 L99.3 13.2 L100.5 16.3 L101.7 19.2 L103.1 22.0 L104.5 24.8 L106.0 27.3 L107.6 29.8 L109.2 32.2 L110.8 34.5 L112.5 36.6 L114.1 38.7 L115.7 40.7 L117.4 42.7 L119.0 44.6 L120.6 46.4 L122.2 48.3 L123.8 50.1 L125.4 52.0 L127.0 53.9 L128.6 55.9 L130.2 57.9 L131.8 60.1 L133.5 62.4 L152.5 53.6 L151.3 50.1 L150.0 46.7 L148.5 43.5 L146.9 40.5 L145.2 37.7 L143.4 35.0 L141.5 32.5 L139.6 30.1 L137.6 27.9 L135.6 25.8 L133.6 23.8 L131.5 22.0 L129.5 20.2 L127.4 18.5 L125.4 16.9 L123.3 15.4 L121.2 13.8 L119.1 12.3 L117.0 10.7 L114.8 9.2 L112.7 7.5 L110.5 5.7 L108.2 3.9 L105.9 1.9 L103.6 -0.3 L101.3 -2.7 L98.9 -5.3 L96.5 -8.2Z M189.5 -8.2 L187.1 -5.3 L184.7 -2.7 L182.4 -0.3 L180.1 1.9 L177.8 3.9 L175.5 5.7 L173.3 7.5 L171.2 9.2 L169.0 10.7 L166.9 12.3 L164.8 13.8 L162.7 15.4 L160.6 16.9 L158.6 18.5 L156.5 20.2 L154.5 22.0 L152.4 23.8 L150.4 25.8 L148.4 27.9 L146.4 30.1 L144.5 32.5 L142.6 35.0 L140.8 37.7 L139.1 40.5 L137.5 43.5 L136.0 46.7 L134.7 50.1 L133.5 53.6 L152.5 62.4 L154.2 60.1 L155.8 57.9 L157.4 55.9 L159.0 53.9 L160.6 52.0 L162.2 50.1 L163.8 48.3 L165.4 46.4 L167.0 44.6 L168.6 42.7 L170.3 40.7 L171.9 38.7 L173.5 36.6 L175.2 34.5 L176.8 32.2 L178.4 29.8 L180.0 27.3 L181.5 24.8 L182.9 22.0 L184.3 19.2 L185.5 16.3 L186.7 13.2 L187.7 10.0 L188.5 6.7 L189.3 3.2 L189.8 -0.3 L190.2 -4.0 L190.5 -7.8Z M131.7 46.2 L131.8 48.6 L131.8 51.0 L131.8 53.3 L131.8 55.5 L131.7 57.7 L131.7 59.9 L131.7 62.0 L131.7 64.1 L131.7 66.3 L131.7 68.4 L131.7 70.6 L131.8 72.7 L131.9 74.9 L132.1 77.1 L132.3 79.4 L132.5 81.6 L132.9 83.9 L133.3 86.2 L133.8 88.5 L134.4 90.8 L135.1 93.1 L135.9 95.4 L136.8 97.7 L137.9 99.9 L139.1 102.1 L140.4 104.2 L141.9 106.2 L143.5 108.1 L144.5 107.9 L145.1 105.5 L145.8 103.3 L146.6 101.2 L147.4 99.1 L148.2 97.2 L149.0 95.2 L149.8 93.3 L150.6 91.4 L151.4 89.5 L152.2 87.6 L152.9 85.6 L153.6 83.6 L154.3 81.5 L154.9 79.4 L155.5 77.2 L156.0 74.9 L156.5 72.5 L156.9 70.1 L157.2 67.6 L157.4 65.0 L157.4 62.3 L157.4 59.6 L157.3 56.7 L157.0 53.9 L156.5 50.9 L155.9 47.9 L155.2 44.9 L154.3 41.8Z M197.7 -7.6 L200.3 -3.1 L202.7 1.5 L205.0 6.0 L207.1 10.6 L209.3 15.1 L211.4 19.7 L213.5 24.2 L215.6 28.8 L217.7 33.4 L220.0 38.0 L222.3 42.6 L224.7 47.3 L227.1 51.9 L229.8 56.5 L232.5 61.1 L235.4 65.7 L238.4 70.2 L241.6 74.6 L245.0 78.9 L248.6 83.1 L252.3 87.1 L256.3 90.9 L260.4 94.6 L264.7 98.0 L269.2 101.1 L273.9 103.9 L278.7 106.3 L283.7 108.4 L284.3 107.6 L281.7 103.1 L279.3 98.5 L277.0 94.0 L274.9 89.4 L272.7 84.9 L270.6 80.3 L268.5 75.8 L266.4 71.2 L264.3 66.6 L262.0 62.0 L259.7 57.4 L257.3 52.7 L254.9 48.1 L252.2 43.5 L249.5 38.9 L246.6 34.3 L243.6 29.8 L240.4 25.4 L237.0 21.1 L233.4 16.9 L229.7 12.9 L225.7 9.1 L221.6 5.4 L217.3 2.0 L212.8 -1.1 L208.1 -3.9 L203.3 -6.3 L198.3 -8.4Z M283.7 -8.4 L278.7 -6.3 L273.9 -3.9 L269.2 -1.1 L264.7 2.0 L260.4 5.4 L256.3 9.1 L252.3 12.9 L248.6 16.9 L245.0 21.1 L241.6 25.4 L238.4 29.8 L235.4 34.3 L232.5 38.9 L229.8 43.5 L227.1 48.1 L224.7 52.7 L222.3 57.4 L220.0 62.0 L217.7 66.6 L215.6 71.2 L213.5 75.8 L211.4 80.3 L209.3 84.9 L207.1 89.4 L205.0 94.0 L202.7 98.5 L200.3 103.1 L197.7 107.6 L198.3 108.4 L203.3 106.3 L208.1 103.9 L212.8 101.1 L217.3 98.0 L221.6 94.6 L225.7 90.9 L229.7 87.1 L233.4 83.1 L237.0 78.9 L240.4 74.6 L243.6 70.2 L246.6 65.7 L249.5 61.1 L252.2 56.5 L254.9 51.9 L257.3 47.3 L259.7 42.6 L262.0 38.0 L264.3 33.4 L266.4 28.8 L268.5 24.2 L270.6 19.7 L272.7 15.1 L274.9 10.6 L277.0 6.0 L279.3 1.5 L281.7 -3.1 L284.3 -7.6Z M308.5 -8.1 L306.6 -3.7 L305.0 0.7 L303.5 5.1 L302.3 9.5 L301.2 13.9 L300.3 18.3 L299.6 22.7 L299.0 27.0 L298.5 31.2 L298.2 35.4 L298.0 39.5 L298.0 43.6 L298.0 47.5 L298.0 51.4 L298.2 55.1 L298.4 58.8 L298.7 62.4 L299.0 65.9 L299.3 69.3 L299.7 72.6 L300.1 75.8 L300.4 78.9 L300.8 82.0 L301.2 85.1 L301.5 88.1 L301.8 91.1 L302.1 94.1 L302.3 97.2 L313.7 100.8 L315.7 97.6 L317.4 94.2 L318.8 90.8 L320.1 87.2 L321.1 83.6 L321.9 79.9 L322.4 76.1 L322.8 72.3 L323.0 68.5 L323.1 64.7 L323.0 60.9 L322.8 57.1 L322.4 53.2 L322.0 49.4 L321.4 45.5 L320.7 41.7 L320.0 37.8 L319.2 33.9 L318.3 30.0 L317.4 26.0 L316.4 22.0 L315.4 18.0 L314.4 13.9 L313.4 9.7 L312.4 5.5 L311.4 1.1 L310.4 -3.4 L309.5 -7.9Z M311.4 16.7 L313.2 16.0 L315.0 15.3 L316.9 14.7 L318.8 14.1 L320.7 13.6 L322.6 13.2 L324.6 12.7 L326.6 12.3 L328.7 11.9 L330.8 11.5 L332.9 11.1 L335.1 10.7 L337.3 10.2 L339.5 9.7 L341.8 9.1 L344.0 8.5 L346.3 7.8 L348.5 7.1 L350.8 6.2 L353.0 5.2 L355.2 4.1 L357.3 2.8 L359.3 1.4 L361.3 -0.1 L363.2 -1.7 L365.0 -3.6 L366.7 -5.5 L368.3 -7.6 L367.7 -8.4 L365.4 -7.2 L363.1 -6.3 L360.9 -5.5 L358.8 -4.9 L356.7 -4.4 L354.6 -4.0 L352.5 -3.8 L350.5 -3.5 L348.4 -3.4 L346.4 -3.3 L344.3 -3.3 L342.2 -3.2 L340.1 -3.2 L338.0 -3.2 L335.8 -3.2 L333.6 -3.2 L331.3 -3.1 L329.0 -3.0 L326.7 -2.8 L324.4 -2.6 L322.0 -2.3 L319.5 -1.9 L317.1 -1.4 L314.6 -0.7 L312.1 0.0 L309.6 0.9 L307.1 2.0 L304.6 3.3Z M304.6 58.1 L306.8 59.2 L309.1 60.0 L311.3 60.7 L313.6 61.1 L315.8 61.4 L317.9 61.4 L320.1 61.3 L322.1 61.1 L324.1 60.7 L326.1 60.2 L328.0 59.6 L329.8 59.0 L331.6 58.3 L333.3 57.5 L335.0 56.7 L336.6 55.9 L338.2 55.0 L339.7 54.1 L341.2 53.2 L342.7 52.4 L344.2 51.5 L345.6 50.7 L347.0 49.9 L348.4 49.1 L349.8 48.4 L351.2 47.7 L352.6 47.1 L354.0 46.5 L354.0 45.5 L352.4 45.3 L350.7 45.1 L349.1 45.1 L347.3 45.2 L345.6 45.3 L343.9 45.5 L342.1 45.7 L340.4 46.0 L338.7 46.4 L336.9 46.7 L335.2 47.0 L333.5 47.4 L331.9 47.7 L330.2 48.0 L328.6 48.3 L327.0 48.5 L325.5 48.6 L324.0 48.7 L322.6 48.8 L321.2 48.8 L319.9 48.7 L318.6 48.5 L317.4 48.3 L316.2 48.0 L315.0 47.6 L313.8 47.1 L312.6 46.6 L311.4 45.9Z M298.0 100.3 L300.8 101.9 L303.7 103.2 L306.7 104.5 L309.7 105.5 L312.7 106.4 L315.8 107.2 L318.9 107.7 L321.9 108.2 L325.0 108.4 L328.1 108.5 L331.1 108.4 L334.2 108.2 L337.2 107.7 L340.1 107.2 L343.0 106.5 L345.8 105.6 L348.6 104.5 L351.3 103.4 L353.9 102.0 L356.4 100.5 L358.8 98.9 L361.1 97.2 L363.3 95.3 L365.4 93.4 L367.3 91.3 L369.2 89.1 L370.8 86.7 L372.4 84.4 L371.6 83.6 L369.2 85.0 L366.8 86.2 L364.4 87.3 L362.0 88.4 L359.6 89.2 L357.2 90.0 L354.8 90.7 L352.4 91.4 L350.0 91.9 L347.7 92.3 L345.3 92.7 L342.9 93.0 L340.5 93.2 L338.1 93.3 L335.8 93.4 L333.4 93.4 L331.0 93.3 L328.6 93.2 L326.2 93.0 L323.8 92.7 L321.3 92.3 L318.9 91.9 L316.5 91.4 L314.0 90.8 L311.5 90.2 L309.0 89.4 L306.5 88.6 L304.0 87.7Z' };
function NyxeWord({ gid, height, className = '' }) {
  return (
    <svg className={`nx-wm ${className}`} viewBox={NYXE_WM.vb} width={Math.round(height * NYXE_WM.ratio)} height={height} aria-hidden="true" focusable="false">
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#D2E7FF" /><stop offset="1" stopColor="#8FBDF7" /></linearGradient></defs>
      <path fill={`url(#${gid})`} d={NYXE_WM.d} />
    </svg>
  );
}

// Görüntüleme modları (kimlik → kanvas bileşim işlevi)
const MODES = [
  { id: 'blink', emoji: '◐' },
  { id: 'rgb', emoji: '◍' },
  { id: 'diff', emoji: '◇' },
  { id: 'split', emoji: '◫' },
  { id: 'photo', emoji: '▣', realOnly: true },       // yalnız gerçek alanda: 2MASS ⇄ AllWISE gerçek gökyüzü fotoğrafı
];

// Hazır spektral keşif filtreleri
const PRESETS = [
  { id: 'bd', color: '#F0587A', tint: [1, 0.34, 0.42], band: nearestBand(4.5), marks: [nearestBand(1.6), nearestBand(4.5)], spec: { kind: 'bd' } },
  { id: 'ice', color: '#5B9DFF', tint: [0.35, 0.92, 1], band: nearestBand(3.0), marks: [nearestBand(2.5), nearestBand(3.0), nearestBand(3.6)], spec: { kind: 'ice' } },
  { id: 'therm', color: '#E3B567', tint: [1, 0.68, 0.3], band: nearestBand(4.8), marks: [nearestBand(4.8)], spec: { kind: 'band', b: nearestBand(4.8) } },
];

// Spektrum grafiğinde etiketlenen soğurma bölgeleri (su buzu, metan, CO₂, CO)
const REGIONS = [
  { id: 'ch4a', lo: 1.6, hi: 1.72, color: '#8DB9FF', label: 'abs.ch4', sym: 'CH₄', row: 0 },
  { id: 'h2o', lo: 2.8, hi: 3.22, color: '#5B9DFF', label: 'abs.h2o', sym: 'H₂O', row: 0 },
  { id: 'ch4b', lo: 3.22, hi: 3.5, color: '#8DB9FF', label: 'abs.ch4', sym: 'CH₄', row: 1 },
  { id: 'co2', lo: 4.2, hi: 4.33, color: '#8FE0B5', label: null, sym: 'CO₂', row: 0 },
  { id: 'co', lo: 4.6, hi: 4.75, color: '#F0587A', label: null, sym: 'CO', row: 1 },
];
const QUICK_LAMBDAS = [[1.25, 'J 1.25'], [1.6, 'H 1.6'], [3.0, 'H₂O 3.0'], [3.3, 'PAH 3.3'], [4.26, 'CO₂ 4.26'], [4.5, '4.5'], [4.8, '4.8']];

// Katalog kategorileri
const CAT_COLOR = { bd: '#F0587A', asteroid: '#E3B567', comet: '#5B9DFF', kbo: '#8DB9FF', variable: '#8FE0B5', star: '#8FA3C7', galaxy: '#7F93B8', other: '#9AA7BD' };
const CAT_EMOJI = { bd: '●', asteroid: '◆', comet: '✦', kbo: '◇', variable: '✺', star: '★', galaxy: '◌', other: '·' };
const SAVE_CATS = ['bd', 'asteroid', 'comet', 'kbo', 'variable', 'other'];
const CTABS = [
  { id: 'all', emoji: '' }, { id: 'mine', emoji: '' }, { id: 'known', emoji: '' },
  { id: 'bd', emoji: '' }, { id: 'sb', emoji: '' }, { id: 'px', emoji: '' }, { id: 'var', emoji: '' }, { id: 'real', emoji: '' },
];
function rowInTab(tab, row) {
  switch (tab) {
    case 'all': return true;
    case 'mine': return !!row.mine;
    case 'known': return !!row.known;
    case 'bd': return row.cat === 'bd';
    case 'sb': return row.cat === 'asteroid' || row.cat === 'comet';
    case 'px': return row.cat === 'kbo';
    case 'var': return row.cat === 'variable';
    case 'real': return !!(row.mine && row.mine.real);
    default: return true;
  }
}
const SECTOR_IDS = ['s1', 's2', 's3', 's4'];
const COPYRIGHT_YEAR = 2026;

const fmtN = (x, d = 2, suf = '') => (typeof x === 'number' && isFinite(x) ? x.toFixed(d) + suf : '—');
const fx = (v, d) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—');
const sgn = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) : '—');
const abOf = (f) => (f > 0 ? -2.5 * Math.log10(f / AB0_UJY) : NaN);
const yOf = (f, mode) => (mode === 'ab' ? -2.5 * Math.log10(Math.max(f, 1e-9) / AB0_UJY) : Math.log10(Math.max(f, 1e-3)));

// Tarih çifti çözümü: A her zaman eski, B yeni; "ilk kayıt ↔ şimdi" kipinde A = ilk kayıt dönemi, B = en son dönem
function resolveDates(eA, eB, firstVsNow, firstEpoch) {
  let a, b;
  if (firstVsNow) { b = 3; a = clamp(firstEpoch || 0, 0, 2); }
  else {
    a = Math.min(eA, eB); b = Math.max(eA, eB);
    if (a === b) { if (b < 3) b = a + 1; else a = b - 1; }
  }
  return { a, b };
}
const epochFull = (lang, t, e) => `${t('epoch.n', { n: e + 1 })} · ${epochLabel(lang, e)}`;

// Kullanıcıya gösterilen tür adları (cismin kendi türü / otomatik teşhis)
// Tür adı: simülasyon anakol sınıfı · gerçek alanda tayf türü / SIMBAD-SkyBoT türü
function kindText(t, kind, cls, real) {
  if (kind === 'star') return real ? t('kind.rstar', { cls: cls && cls !== '?' ? cls : '—' }) : t('kind.star', { cls });
  return t('kind.' + kind);
}
const kindLabel = (t, src) => kindText(t, src.kind, src.real ? src.sp || src.cls : src.cls, !!src.real);
const guessLabel = (t, key, Tc) => t('guess.' + key) + (key === 'star' && isFinite(Tc) ? ` (T ≈ ${Math.round(Tc / 50) * 50} K)` : '');
// Tarama sonucunda gizli gerçeğe bakmadan yalnızca ölçülen teşhisten kategori üretir
const GUESS_CAT = { bd: 'bd', kbo: 'kbo', comet: 'comet', asteroid: 'asteroid', variable: 'variable', other: 'other' };
const catOfItem = (it) => (it.known ? it.cat : GUESS_CAT[it.guessId] || 'other');

/* ---------------- Gökyüzü kayıt defteri: sektör başına bir kez üretilir (simülasyon) · bir kez indirilir (gerçek) ---------------- */
const SKY_REG = new Map();
const SKY_REG_MAX = 8;
// Taşma: önce özel koordinat simülasyonları, sonra ön tanımlı simülasyonlar (yeniden üretmesi ucuz), en son gerçek alanlar (ağdan gelir)
function regTrim(keep) {
  const rank = (k) => (k.indexOf('|real') >= 0 ? 2 : k.indexOf('s4') === 0 ? 0 : 1);
  while (SKY_REG.size > SKY_REG_MAX) {
    const keys = Array.from(SKY_REG.keys()).filter((k) => k !== keep).sort((a, b) => rank(a) - rank(b));
    if (!keys.length) break;
    SKY_REG.delete(keys[0]);
  }
}
function getSkyEntry(cfg) {
  let e = SKY_REG.get(cfg.key);
  if (!e) {
    e = { sky: generateSky(cfg), cache: makeCache() };
    SKY_REG.set(cfg.key, e);
    regTrim(cfg.key);
  }
  return e;
}
const hasSkyEntry = (cfg) => SKY_REG.has(cfg.key);
const realKeyOf = (cfg) => cfg.key + '|real';
const getRealEntry = (cfg) => SKY_REG.get(realKeyOf(cfg)) || null;
function putRealEntry(cfg, sky) {
  const e = { sky, cache: makeCache() };
  SKY_REG.set(realKeyOf(cfg), e);
  regTrim(realKeyOf(cfg));
  return e;
}
const _cfgMemo = new Map();
function cfgOf(sectorId, custom) {
  const k = sectorId === 's4' ? `s4:${custom.ra.toFixed(4)}:${custom.dec.toFixed(4)}` : sectorId;
  let c = _cfgMemo.get(k);
  if (!c) { c = sectorConfig(SECTORS.find((s) => s.id === sectorId), custom); _cfgMemo.set(k, c); }
  return c;
}

/* ---------------- Kalıcı veritabanı (localStorage) ---------------- */
const DB_KEY = 'spx_db_v2';
const LANG_KEY = 'spx_lang_v2';   // v2: varsayılan dil İngilizce (eski kayıtlı seçimler sıfırlanır)
const MAPSRC_KEY = 'spx_map_src';
const emptyDb = () => ({ entries: [], notes: {}, logs: [] });
function loadDb() {
  try {
    const s = localStorage.getItem(DB_KEY);
    if (!s) return emptyDb();
    const j = JSON.parse(s);
    return {
      entries: Array.isArray(j.entries) ? j.entries : [],
      notes: j.notes && typeof j.notes === 'object' && !Array.isArray(j.notes) ? j.notes : {},
      logs: Array.isArray(j.logs) ? j.logs : [],
    };
  } catch (e) { return emptyDb(); }
}
function persistDb(db) { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { /* depolama kapalı olabilir */ } }
// Varsayılan dil her zaman İngilizce; kullanıcı dili elle değiştirirse seçimi hatırlanır
function loadLang() {
  try { const l = localStorage.getItem(LANG_KEY); if (LANGS.some((x) => x.code === l)) return l; } catch (e) { /* yoksay */ }
  return 'en';
}
// Harita veri kaynağı: kullanıcı açıkça "simülasyon" seçtiyse sim, aksi halde gerçek (varsayılan)
function loadMapSrc() {
  try { return localStorage.getItem(MAPSRC_KEY) === 'sim' ? 'sim' : 'real'; } catch (e) { return 'real'; }
}
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* =====================================================================
   BÖLÜM 11 — "NEDEN DEĞİŞTİ?" METİNLERİ (yapısal ölçümden → seçili dilde açıklama)
   ===================================================================== */
function explainReason(t, r, L) {
  const items = [];
  if (!r) return { items, plain: '' };
  const range = { eA: L.eA, eB: L.eB };
  if (r.moved) {
    const ly = r.distMax !== null ? r.distMax * 3.2616 : null;
    items.push({
      kind: 'move', emoji: '◉',
      head: t('why.head.move', { ...range, d: fx(r.d, 1), mu: fx(r.mu, 1), pa: fx(r.pa, 0) }),
      measured: '',
      cause: t('why.move.' + r.moveKind, { muPhys: fx(r.muPhys, 2), pc: r.distMax !== null ? r.distMax.toFixed(0) : '—', ly: ly !== null ? ly.toFixed(0) : '—' }),
    });
  }
  if (r.specChanged) {
    const pct = r.ratio !== null ? (r.ratio - 1) * 100 : null;
    const head = r.appeared
      ? t('why.head.new', { ...range, sig: fx(r.sig, 0) })
      : t('why.head.flux', { ...range, ratio: fx(r.ratio, 2), pct: sgn(pct, 0), sig: fx(r.sig, 0) });
    const parts = r.cites.map((c) => {
      if (c.pct !== null) return t('why.cite.pct', { lam: c.lam.toFixed(2), pct: sgn(c.pct, 0), err: fx(c.pctErr, 0) });
      if (c.appeared) return t('why.cite.new', { lam: c.lam.toFixed(2) });
      return t('why.cite.sig', { lam: c.lam.toFixed(2), sig: sgn(c.sig, 0) });
    });
    items.push({
      kind: 'spec', emoji: r.specKind === 'sn' ? '✸' : r.specKind === 'comet' || r.specKind === 'icy' ? '❅' : '◐',
      head, measured: parts.length ? t('why.cite.lead', { list: parts.join(' · ') }) : '',
      cause: t('why.spec.' + r.specKind, { cls: '' }),
    });
  }
  if (!items.length) items.push({ kind: 'none', emoji: '○', head: t('why.head.stable', range), measured: '', cause: t('why.stable') });
  const plain = items.map((i) => `${i.head}${i.measured ? ' ' + i.measured : ''}\n${t('why.cause')} ${i.cause}`).join('\n');
  return { items, plain };
}

/* =====================================================================
   BÖLÜM 16 — KAYIT TASLAĞI · DEĞİŞİM ÖZETİ · CANLI KATALOG DURUMU
   ===================================================================== */
// Seçili cismin analizinden kalıcı katalog kaydı taslağı üretir (harita + katalog ortak kullanır)
function makeEntryDraft(o) {
  const { sky, cfg, custom, an, reason, effA, effB, gain, cat, userNote, history, knownRec } = o;
  const isObj = an.type === 'object';
  const A = isObj ? an.astro : null;
  const D = isObj ? an.diag : null;
  const pos = isObj ? (A.valid ? A.cenB : an.posB) : an.pos;
  const qpos = isObj && A.valid ? { x: (A.cenA.x + A.cenB.x) / 2, y: (A.cenA.y + A.cenB.y) / 2 } : pos;
  const qsky = sky.wcs.pixToSky(qpos.x, qpos.y);
  const src = isObj ? an.src : null;
  const objKey = src ? objKeyOf(sky, src) : `${sky.key}@${Math.round(pos.x)},${Math.round(pos.y)}`;
  const fv = history ? history.findIndex((h) => h.valid) : -1;
  return {
    objKey, srcId: src ? src.id : null, sectorId: cfg.id, sectorKey: sky.key,
    custom: cfg.id === 's4' ? { raStr: custom.raStr, decStr: custom.decStr, ra: custom.ra, dec: custom.dec } : null,
    ra: an.skyB.ra, dec: an.skyB.dec, x: pos.x, y: pos.y, cat, kind: src ? src.kind : null, srcCls: src ? src.cls || '' : '',
    guessId: D ? D.guess.id : 'other', guessKey: D ? D.guess.key : 'blank', Tc: D && isFinite(D.Tc) ? D.Tc : null,
    known: !!knownRec, knownId: knownRec ? knownRec.id : null,
    eA: effA, eB: effB, gain, firstEpoch: fv >= 0 ? fv : effA,
    reason: reason || null, userNote: userNote || '',
    hidden: src ? !!src.hidden : false, truth: src ? src.truth : null,
    fieldSrc: sky.real ? 'real' : 'sim', catId: src && src.real ? src.catId : null, otype: src && src.real ? src.otype || '' : '',
    qra: qsky.ra, qdec: qsky.dec, searchRadius: isObj && A.valid ? Math.max(6, A.dtheta / 2 + 5) : 6, epochIso: EPOCHS[effB].iso,
  };
}

// "5.2″ yer değiştirdi · parlaklık +45%"
function changeSummary(t, r) {
  const parts = [];
  if (r.moved) parts.push(t('scan.rowMove', { d: fx(r.d, 1) }));
  if (r.specChanged) parts.push(r.appeared ? t('scan.rowNew') : t('scan.rowFlux', { p: sgn((r.ratio - 1) * 100, 0) + '%' }));
  return parts.join(' · ');
}

const statusColor = (st) => (st === 'nomatch' ? '#F0587A' : st === 'match' ? '#8FE0B5' : st === 'offline' ? '#E3B567' : '#5B9DFF');
function netMessage(t, c) {
  if (!c || c.status === 'pending') return t('net.pending');
  if (c.status === 'nomatch') return t('net.nomatch');
  if (c.status === 'offline') return t('net.offline');
  if (c.simbad && c.simbad.length) return t('net.match', { n: c.simbad.length, id: c.simbad[0].id, sep: c.simbad[0].sep.toFixed(1), otype: c.simbad[0].otype || '?' });
  if (c.skybot && c.skybot.items && c.skybot.items.length) return t('net.matchSkybot', { name: c.skybot.items[0].name });
  return t('net.nomatch');
}
/* =====================================================================
   BÖLÜM 12 — EDİTORYAL KABUK
   Atmosfer · ambilight · yüzen çekmeceler · alt HUD · mikro başlıklar · ortak bileşenler
   Tasarım dili (v3.3): mauve-gri çerçeve içinde siyah yuvarlak cam kartlar · sol kenar menüsü · hap biçimli sekmeler/düğmeler · Poppins tipografi
   ===================================================================== */
const ED_FONTS_URL = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Poppins:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap';
const ED_TICK = 'linear-gradient(var(--acc),var(--acc))';

const ED_CSS = `
.ed{--bg:#030614;--card:#070c20;--card-bg:radial-gradient(120% 90% at 0% 0%,rgba(140,175,245,.13),transparent 58%),#070c20;--ink:#EEF3FD;--ink2:#C5D3EE;--mute:#93A6CC;--dim:#667BA3;--hair:rgba(255,255,255,.08);--hair2:rgba(255,255,255,.2);--acc:#A9C4F5;--acc2:#D4E2FB;--acc-glow:rgba(169,196,245,.38);--grad:linear-gradient(135deg,#8FB1EE 0%,#3A56A8 100%);--ok:#7FE3A8;--warn:#E8BE74;--bad:#F2688A;
--f-serif:${SERIF_STACK};--f-mono:${MONO_STACK};--f-sans:${FONT_STACK};--f-display:"Cormorant Garamond","Cormorant","Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Hiragino Mincho ProN","Yu Mincho",serif;
--sx-i:28px;--sx-w:236px;--sx-ml:calc(var(--sx-i) + var(--sx-w) + 16px);--sx-mr:var(--sx-i);--sx-mt:var(--sx-i);--sx-vb:calc(var(--sx-i) + 22px);
position:fixed;inset:0;overflow:hidden;color:var(--ink);font-family:var(--f-sans);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;color-scheme:dark;background:var(--bg)}
.ed *{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.18) transparent}
.ed ::selection{background:rgba(169,196,245,.38);color:#fff}
.ed button,.ed select,.ed input,.ed textarea{font-family:inherit}
.ed button:focus-visible,.ed a:focus-visible,.ed select:focus-visible,.ed summary:focus-visible,.ed [role="tab"]:focus-visible{outline:2px solid var(--acc);outline-offset:2px}

/* ---- Arka plan: siyah zemin üstünde mauve-gri çerçeve ("kabuk") ---- */
.ed-atmos{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;background:var(--bg)}
.ed-atmos::before{content:"";position:absolute;inset:calc(var(--sx-i) - 14px);border-radius:32px;border:1px solid rgba(169,196,245,.14);background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 0C12.8 8 16 11.2 24 12 16 12.8 12.8 16 12 24 11.2 16 8 12.8 0 12 8 11.2 11.2 8 12 0Z' fill='%23cfe0ff'/%3E%3C/svg%3E") 93% 8.5%/16px 16px no-repeat,url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 0C12.8 8 16 11.2 24 12 16 12.8 12.8 16 12 24 11.2 16 8 12.8 0 12 8 11.2 11.2 8 12 0Z' fill='%23cfe0ff'/%3E%3C/svg%3E") 61% 5.5%/11px 11px no-repeat,url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 0C12.8 8 16 11.2 24 12 16 12.8 12.8 16 12 24 11.2 16 8 12.8 0 12 8 11.2 11.2 8 12 0Z' fill='%23cfe0ff'/%3E%3C/svg%3E") 97% 94%/13px 13px no-repeat,url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 0C12.8 8 16 11.2 24 12 16 12.8 12.8 16 12 24 11.2 16 8 12.8 0 12 8 11.2 11.2 8 12 0Z' fill='%23cfe0ff'/%3E%3C/svg%3E") 33% 96.5%/10px 10px no-repeat,radial-gradient(circle at 76% 12%,rgba(220,232,255,.85) 0 1px,transparent 1.6px),radial-gradient(circle at 52% 7%,rgba(220,232,255,.6) 0 1px,transparent 1.6px),radial-gradient(circle at 88% 4%,rgba(220,232,255,.5) 0 1px,transparent 1.6px),radial-gradient(circle at 98% 38%,rgba(220,232,255,.5) 0 1px,transparent 1.6px),radial-gradient(circle at 44% 97%,rgba(220,232,255,.55) 0 1px,transparent 1.6px),radial-gradient(circle at 68% 96%,rgba(220,232,255,.4) 0 1px,transparent 1.6px),radial-gradient(circle at 108% -14%,transparent 0 calc(46vmin - 1px),rgba(169,196,245,.34) calc(46vmin - 1px) 46vmin,transparent calc(46vmin + 1px)),radial-gradient(circle at 108% -14%,transparent 0 calc(58vmin - 1px),rgba(169,196,245,.18) calc(58vmin - 1px) 58vmin,transparent calc(58vmin + 1px)),radial-gradient(75% 70% at 92% -8%,rgba(120,165,250,.32),transparent 60%),radial-gradient(60% 60% at -6% 108%,rgba(48,82,200,.34),transparent 62%),linear-gradient(145deg,#1a2b5e 0%,#101d47 46%,#0a1334 100%);box-shadow:0 50px 120px -40px #000,inset 0 1px 0 rgba(255,255,255,.1)}
.ed-glow{display:none}

/* ---- Tipografi yardımcıları ---- */
.ed-label{font:500 11.5px/1.3 var(--f-sans);letter-spacing:.01em;color:var(--mute)}
.ed-mono{font-family:var(--f-mono)}
.ed-serif{font-family:var(--f-sans);font-weight:600;font-style:normal;letter-spacing:0}
.ed-num{font-family:var(--f-sans);font-variant-numeric:lining-nums tabular-nums;font-weight:600}
.ed-i{display:inline-grid;place-items:center;flex:none;width:16px;height:16px;border:1px solid var(--hair2);border-radius:50%;color:var(--mute);font:600 10px/1 var(--f-sans);font-style:normal;cursor:help;padding:0;background:transparent;transition:color .15s,border-color .15s,background-color .15s}
.ed-i:hover,.ed-i:focus-visible{color:#fff;border-color:var(--acc);background:rgba(169,196,245,.2);outline:none}
.spx-tipbtn{display:inline-grid;flex:none;line-height:0;background:none;border:0;padding:0;cursor:help}

/* ---- Düğmeler: hap biçimli ---- */
.ed-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:.6em;border:1px solid var(--hair2);border-radius:999px;background:rgba(255,255,255,.03);color:#fff;padding:9px 18px;font:500 12.5px/1.2 var(--f-sans);letter-spacing:0;cursor:pointer;text-align:center;transition:background-color .2s,border-color .2s,box-shadow .25s}
.ed-btn:hover:not(:disabled){border-color:rgba(255,255,255,.42);background:rgba(255,255,255,.09)}
.ed-btn:disabled{opacity:.4;cursor:not-allowed}
.ed-btn.ed-go::after{content:"→";font-family:var(--f-sans);transition:transform .25s}
.ed-btn.ed-go:hover:not(:disabled)::after{transform:translateX(4px)}
.ed-btn.is-primary{border-color:transparent;background:var(--grad);box-shadow:0 12px 28px -16px rgba(169,196,245,.9)}
.ed-btn.is-primary:hover:not(:disabled){border-color:transparent;background:linear-gradient(135deg,#A3C1F6 0%,#4A68BD 100%)}
.ed-btn.is-warn{border-color:rgba(232,190,116,.6);color:var(--warn)}.ed-btn.is-warn:hover:not(:disabled){border-color:var(--warn);background:rgba(232,190,116,.12)}
.ed-btn.is-bad{border-color:rgba(242,104,138,.6);color:var(--bad)}.ed-btn.is-bad:hover:not(:disabled){border-color:var(--bad);background:rgba(242,104,138,.12)}
.ed-btn.is-ok{border-color:rgba(127,227,168,.55);color:var(--ok)}.ed-btn.is-ok:hover:not(:disabled){border-color:var(--ok);background:rgba(127,227,168,.1)}
.ed-btn.is-sm{padding:6px 14px;font-size:11.5px}
.ed-btn.is-block{display:flex;width:100%}
.ed-link{display:inline-flex;align-items:center;gap:.5em;background:none;border:0;padding:0;color:var(--ink2);font:500 12px/1.3 var(--f-sans);letter-spacing:0;cursor:pointer;text-decoration:underline;text-decoration-color:transparent;text-decoration-thickness:1.5px;text-underline-offset:4px;transition:color .15s,text-decoration-color .15s}
.ed-link:hover:not(:disabled),.ed-link[aria-pressed="true"],.ed-link[aria-selected="true"]{color:#fff;text-decoration-color:var(--acc)}
.ed-link:disabled{opacity:.4;cursor:not-allowed}
.ed-link.is-on{color:#fff}
.ed-txt{font-size:12.5px;line-height:1.6;color:var(--mute)}
a.ed-ext{color:var(--acc2);text-decoration:underline;text-underline-offset:3px}
a.ed-ext:hover{color:#fff}

/* ---- Hap biçimli sekmeler ---- */
.ed-seg{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.ed-segbtn{position:relative;display:inline-flex;align-items:center;gap:7px;white-space:nowrap;border:1px solid var(--hair2);border-radius:999px;background:rgba(4,8,22,.8);padding:8px 17px;color:var(--ink2);font:500 12.5px/1.2 var(--f-sans);letter-spacing:0;cursor:pointer;transition:color .15s,border-color .15s,background-color .15s,box-shadow .2s}
.ed-segbtn>i:first-child{display:none}
.ed-segbtn em.sx-cnt,.ed-segbtn>i:last-child:not(:first-child){font:500 10.5px/1 var(--f-mono);font-style:normal;opacity:.72}
.ed-segbtn:hover:not(:disabled){color:#fff;border-color:rgba(255,255,255,.42)}
.ed-segbtn[aria-selected="true"],.ed-segbtn[aria-pressed="true"]{color:#fff;border-color:transparent;background:var(--grad);box-shadow:0 10px 24px -14px rgba(169,196,245,.9)}
.ed-segbtn:disabled{opacity:.35;cursor:not-allowed}

/* ---- Form: yuvarlak köşeli alanlar ---- */
.ed select,.ed input:not([type]),.ed input[type="text"],.ed input[type="search"],.ed input[type="number"],.ed textarea{border:1px solid var(--hair2)!important;background:#0a1028!important;border-radius:12px!important;color:var(--ink);padding:8px 12px!important;font:400 12.5px/1.4 var(--f-sans);outline:none;transition:border-color .15s,box-shadow .15s}
.ed textarea{font-family:var(--f-sans);font-size:12.5px;line-height:1.6;padding:10px 12px!important}
.ed select{appearance:none;-webkit-appearance:none;cursor:pointer;border-radius:999px!important;padding:7px 28px 7px 14px!important;background-image:linear-gradient(45deg,transparent 50%,var(--ink2) 50%),linear-gradient(135deg,var(--ink2) 50%,transparent 50%)!important;background-position:calc(100% - 15px) 55%,calc(100% - 10px) 55%!important;background-size:5px 5px,5px 5px!important;background-repeat:no-repeat!important;text-overflow:ellipsis}
.ed select option{background:#0a1028;color:var(--ink)}
.ed select:disabled{opacity:.5}
.ed select:focus,.ed input:focus,.ed textarea:focus{border-color:var(--acc)!important;box-shadow:0 0 0 3px rgba(169,196,245,.22)}
.ed ::placeholder{color:var(--dim)}
.ed input[type="checkbox"]{appearance:none;-webkit-appearance:none;flex:none;width:16px;height:16px;border:1px solid var(--hair2)!important;border-radius:5px!important;background:transparent!important;cursor:pointer;position:relative;margin:0;padding:0!important;transition:border-color .15s}
.ed input[type="checkbox"]:hover{border-color:var(--acc)!important}
.ed input[type="checkbox"]:checked{border-color:var(--acc)!important}
.ed input[type="checkbox"]:checked::after{content:"";position:absolute;inset:3px;border-radius:2px;background:var(--acc)}
.spx-range{-webkit-appearance:none;appearance:none;width:100%;height:20px;background:transparent;outline:none;cursor:pointer;margin:0}
.spx-range::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:rgba(255,255,255,.2)}
.spx-range::-moz-range-track{height:4px;border-radius:2px;background:rgba(255,255,255,.2)}
.spx-range::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;margin-top:-6px;background:#E6EFFF;border:4px solid var(--acc);border-radius:50%;box-sizing:border-box;box-shadow:0 0 0 4px rgba(169,196,245,.2),0 0 14px rgba(169,196,245,.55)}
.spx-range::-moz-range-thumb{width:16px;height:16px;background:#E6EFFF;border:4px solid var(--acc);border-radius:50%;box-sizing:border-box;box-shadow:0 0 0 4px rgba(169,196,245,.2),0 0 14px rgba(169,196,245,.55)}
.spx-red::-webkit-slider-thumb{border-color:var(--bad)}.spx-red::-moz-range-thumb{border-color:var(--bad)}
.spx-ghost::-webkit-slider-runnable-track{background:transparent}.spx-ghost::-moz-range-track{background:transparent}
.spx-scroll{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.18) transparent}
.spx-scroll::-webkit-scrollbar{width:6px;height:6px}
.spx-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:3px}
.spx-scroll::-webkit-scrollbar-track{background:transparent}
.spx-clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
@keyframes spxPulse{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes spxGlow{0%,100%{box-shadow:0 0 0 1px rgba(242,104,138,.25),0 0 14px rgba(242,104,138,.08)}50%{box-shadow:0 0 0 1px rgba(242,104,138,.7),0 0 28px rgba(242,104,138,.25)}}
@keyframes spxPop{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes edSweep{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
.spx-pulse{animation:spxPulse 1.4s ease-in-out infinite}
.spx-alert{animation:spxGlow 2s ease-in-out infinite}
.spx-pop{animation:spxPop .18s ease-out}
.ed-dot{display:inline-block;width:8px;height:8px;flex:none;background:var(--mute);border-radius:50%}
.ed-dot.is-round{border-radius:50%}

/* ---- Sol kenar menüsü (geniş ekran) ---- */
.sx-side{position:absolute;left:var(--sx-i);top:var(--sx-i);bottom:var(--sx-i);width:var(--sx-w);z-index:41;display:flex;flex-direction:column;gap:4px;padding:20px 12px 14px;background:linear-gradient(180deg,#0a1028,#050919);border:1px solid var(--hair);border-radius:22px;overflow-y:auto;overflow-x:hidden;box-shadow:0 30px 60px -40px #000}
.ed-brand{display:flex;align-items:center;gap:13px;padding:2px 8px 12px;flex:none}
.nx-mark{flex:none;display:block;width:60px;height:auto;filter:drop-shadow(0 0 12px rgba(130,170,245,.45))}
.sx-word{display:flex;flex-direction:column;gap:5px;min-width:0}
.sx-word b{display:block;position:relative;line-height:0}
.nx-wm{display:block;width:auto;aspect-ratio:381 / 121;filter:drop-shadow(0 0 12px rgba(130,170,245,.42))}
.nx-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.sx-word small{font:400 10.5px/1.3 var(--f-sans);color:var(--mute)}
.ed-nav{display:flex;flex-direction:column;gap:6px;min-width:0}
.sx-navitem{display:flex;align-items:center;gap:4px}
.ed-tab{position:relative;flex:1;min-width:0;display:flex;align-items:center;gap:12px;text-align:left;padding:12px 14px;border:0;border-radius:15px;background:transparent;color:var(--ink2);font:500 13.5px/1.3 var(--f-sans);cursor:pointer;transition:background-color .2s,color .2s}
.ed-tab .sx-ico{flex:none;opacity:.9}
.ed-tab .sx-lbl{flex:1;min-width:0}
.ed-tab b{flex:none;font:600 10px/1 var(--f-sans);color:#0a1230;background:var(--acc);border-radius:999px;padding:3px 7px}
.ed-tab:hover{background:rgba(255,255,255,.06);color:#fff}
.ed-tab[aria-selected="true"]{color:#fff;background:linear-gradient(90deg,rgba(110,150,230,.66) 0%,rgba(58,86,168,.34) 55%,rgba(28,46,104,.06) 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.12)}
.sx-orn{display:flex;align-items:center;gap:10px;padding:0 10px 14px;color:var(--acc);font-size:10px;flex:none}
.sx-orn i{flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(169,196,245,.38))}
.sx-orn i:last-child{background:linear-gradient(90deg,rgba(169,196,245,.38),transparent)}
.sx-tools{margin-top:auto;display:flex;flex-direction:column;gap:2px;padding-top:12px;border-top:1px solid var(--hair);flex:none}
.sx-grp-t{font:500 11px/1 var(--f-sans);color:var(--dim);padding:2px 12px 8px}
.sx-rows{display:flex;flex-direction:column;gap:1px}
.sx-row{display:flex;align-items:center;gap:4px}
.ed-meta{flex:1;min-width:0;display:flex;align-items:center;gap:10px;padding:9px 12px;border:0;border-radius:12px;background:none;color:var(--ink2);font:500 12.5px/1.3 var(--f-sans);text-align:left;cursor:pointer;transition:background-color .2s,color .2s}
button.ed-meta:hover,label.ed-meta:hover{background:rgba(255,255,255,.06);color:#fff}
.ed-meta.is-static{cursor:default}
.ed-meta .sx-lbl{flex:1;min-width:0}
.sx-g{width:8px;text-align:center;color:var(--acc);font-size:14px;line-height:1}
.sx-caret{color:var(--dim);font-size:10px}
.ed-langs{flex:none;display:flex;flex-wrap:wrap;gap:4px;padding:10px 8px 4px}
.ed-langs span{display:none}
.ed-langs button{padding:5px 10px;border:1px solid var(--hair2);border-radius:999px;background:none;color:var(--ink2);font:500 11px/1 var(--f-sans);cursor:pointer;transition:color .15s,border-color .15s,background-color .15s}
.ed-langs button:hover{color:#fff;border-color:var(--acc)}
.ed-langs button[aria-pressed="true"]{color:#fff;border-color:transparent;background:var(--grad)}
.sx-status{display:flex;align-items:center;gap:8px;padding:8px 12px 0;font:500 10px/1 var(--f-mono);letter-spacing:.06em;color:var(--dim);white-space:nowrap}
.nx-menu-btn,.nx-scrim,.nx-sheet-head{display:none}
.sx-lbl.is-short{display:none}

/* ---- Sayfa başlığı ---- */
.ed-top{position:absolute;left:var(--sx-ml);right:var(--sx-mr);top:var(--sx-mt);z-index:40;padding:0 4px}
.sx-head-row{display:flex;align-items:center;justify-content:space-between;gap:8px 24px;min-height:64px;flex-wrap:wrap}
.sx-titles{min-width:0}
.sx-h1{margin:0;font:600 clamp(28px,2.6vw,40px)/1.05 var(--f-display);letter-spacing:.01em;color:#fff;text-shadow:0 0 26px rgba(130,170,245,.25)}
.sx-acc{font-style:italic;color:var(--acc2)}
:lang(ja) .sx-acc{font-style:normal}
.sx-sub{margin:3px 0 0;font:400 12.5px/1.4 var(--f-sans);color:var(--ink2)}
.nx-custom{margin:2px 0 8px;padding:12px 18px 14px;background:var(--card-bg);border:1px solid var(--hair);border-radius:18px}

/* ---- Duyuru şeridi ---- */
.ed-notes{position:absolute;left:calc(var(--sx-ml) + clamp(248px,17vw,300px) + 16px);right:calc(var(--sx-mr) + clamp(248px,17vw,300px) + 16px);top:calc(var(--sx-mt) + var(--ed-hdr,72px) + 14px);z-index:45;display:flex;flex-direction:column;gap:6px}
.ed-note{--nc:var(--acc);padding:11px 18px;background:rgba(8,13,34,.96);border:1px solid var(--hair2);border-radius:16px;box-shadow:inset 3px 0 0 var(--nc),0 14px 40px -14px #000}
.ed-note.is-warn{--nc:var(--warn)}.ed-note.is-ok{--nc:var(--ok)}

/* ---- Görünüm: sol panel | sahne + kontroller | sağ panel ---- */
.ed-view{position:absolute;left:var(--sx-ml);right:var(--sx-mr);top:calc(var(--sx-mt) + var(--ed-hdr,72px) + 4px);bottom:var(--sx-vb);z-index:5;display:none;grid-template-columns:auto minmax(0,1fr) auto;grid-template-rows:minmax(0,1fr)}
.ed-view[data-active="true"]{display:grid}
.ed-col-l{grid-column:1;margin-right:14px}.ed-col-r{grid-column:3;margin-left:14px}
.ed-center{grid-column:2;display:flex;flex-direction:column;gap:8px;min-width:0;min-height:0}
.ed-stage{position:relative;flex:1 1 0;min-height:0;border:1px solid var(--hair);border-radius:22px;background:#040818;overflow:hidden}
.ed-stage.is-plain{background:var(--card-bg);overflow:hidden}
.ed-frame{position:relative}
.ed-frame canvas{display:block;border-radius:14px;box-shadow:0 0 0 1px var(--hair),0 30px 80px -30px rgba(0,0,0,.9)}
.ed-veil{position:absolute;inset:0;z-index:6;display:grid;place-items:center;background:rgba(3,6,20,.8)}
.ed-spin{width:34px;height:34px;border-radius:50%;border:2px solid var(--hair2);border-top-color:var(--acc);animation:edSpin 1.1s linear infinite}
@keyframes edSpin{to{transform:rotate(360deg)}}
.ed-empty{max-width:420px;text-align:center}
.ed-empty h3{font:600 28px/1.15 var(--f-display);color:var(--ink);margin:10px 0 10px}
.nx-watermark{display:block;margin:0 auto 14px;width:86px;height:auto;opacity:.92;filter:drop-shadow(0 0 16px rgba(130,170,245,.4))}
.nx-about-brand{display:flex;align-items:center;gap:18px;padding:4px 2px 8px}
.nx-about-brand img{width:92px;height:auto;filter:drop-shadow(0 0 16px rgba(130,170,245,.45))}
.nx-about-brand b{display:block;position:relative;line-height:0}
.nx-about-brand span{display:block;margin-top:6px;font:400 12.5px/1.4 var(--f-sans);color:var(--mute)}

/* ---- Paneller: siyah yuvarlak kartlar ---- */
.ed-drawer{display:flex;flex-direction:column;min-height:0;width:clamp(248px,17vw,300px);background:var(--card-bg);border:1px solid var(--hair);border-radius:22px;overflow:hidden;box-shadow:0 30px 60px -40px #000}
.ed-drawer.is-wide{width:clamp(300px,23vw,380px)}
.ed-drawer[data-open="false"]{display:none}
.ed-dhead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 18px 11px;border-bottom:1px solid var(--hair);flex:none}
.ed-dhead .ed-label{font:600 13.5px/1.2 var(--f-sans);color:#fff}
.ed-dhead .ed-label b{color:var(--acc);font-weight:500;margin-right:8px}
.ed-dbody{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden}
.ed-dtab{position:absolute;z-index:29;top:52px;display:flex;align-items:center;gap:10px;background:#070c20;border:1px solid var(--hair2);border-radius:14px;padding:12px 7px;color:var(--ink2);font:500 11.5px/1 var(--f-sans);letter-spacing:.02em;writing-mode:vertical-rl;cursor:pointer;transition:color .15s,border-color .15s}
.ed-dtab:hover{color:#fff;border-color:var(--acc)}
.ed-dtab.is-l{left:0}.ed-dtab.is-r{right:0}
.ed-dtab.is-hidden{opacity:0;pointer-events:none;visibility:hidden}
.ed-dtab span:first-child{color:var(--acc)}

/* ---- Bölüm (Card) ---- */
.ed-sec{padding:16px 18px 18px;border-top:1px solid var(--hair)}
.ed-sec:first-child{border-top:0}
.ed-sec-h{display:flex;align-items:baseline;gap:10px;margin-bottom:12px}
.ed-sec-n{font:400 13px/1 var(--f-sans);color:var(--acc);width:14px;text-align:center;flex:none}
.ed-sec-t{flex:1;min-width:0;margin:0;font:600 13.5px/1.3 var(--f-sans);color:#fff;letter-spacing:0}
.ed-sec-h .spx-tipbtn,.ed-sec-h .ed-i{align-self:center}
.ed-disc-btn{display:flex;flex:1;min-width:0;align-items:baseline;gap:10px;background:none;border:0;padding:0;text-align:left;cursor:pointer;color:var(--ink)}
.ed-disc-btn:hover .ed-sec-t{color:var(--acc2)}
.ed-pm{font:400 14px/1 var(--f-mono);color:var(--mute)}
.ed-stat{min-width:0;padding:9px 0 10px;border-top:1px solid var(--hair)}
.ed-stat-v{font:600 20px/1.15 var(--f-sans);font-variant-numeric:lining-nums tabular-nums;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ed-stat-s{margin-top:4px;font:400 10.5px/1.4 var(--f-mono);color:var(--dim);letter-spacing:.02em}
.ed-chip{display:inline-flex;max-width:100%;align-items:center;gap:7px;font:500 11px/1.3 var(--f-sans);letter-spacing:0;color:var(--ink2)}
.ed-chip i{display:inline-block;width:7px;height:7px;border-radius:50%;flex:none}
:where(.ed-row){width:100%;padding:11px 8px}
.ed-row{text-align:left;background:none;border:0;border-bottom:1px solid var(--hair);border-radius:12px;color:var(--ink);cursor:pointer;transition:background-color .2s,border-color .2s;position:relative}
.ed-row:hover{background:rgba(255,255,255,.05)}
.ed-row[aria-pressed="true"],.ed-row.is-on{background:linear-gradient(90deg,rgba(110,150,230,.42),rgba(58,86,168,.1));border-bottom-color:transparent}
.ed-note-box{border-left:2px solid var(--hair2);padding:2px 0 2px 12px;font-size:11.5px;line-height:1.6;color:var(--mute)}
.ed-note-box.is-warn{border-left-color:var(--warn);color:#e3c796}.ed-note-box.is-bad{border-left-color:var(--bad);color:#f4b6c4}.ed-note-box.is-ok{border-left-color:var(--ok);color:#a5d9bc}
.ed-reason{border-left:2px solid var(--hair2);padding:2px 0 4px 14px}
.ed-bar{height:4px;border-radius:2px;background:rgba(255,255,255,.14);position:relative;overflow:hidden}.ed-bar>i{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:linear-gradient(90deg,#8FB1EE,#D4E2FB);transition:width .3s}

/* ---- Başlık satırı · kontrol blokları ---- */
.ed-capwrap{flex:none}
.ed-cap{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;padding:2px 6px 2px;min-height:24px}
.ed-cap-name{font:600 14px/1.2 var(--f-sans);color:#fff}
.ed-cap-co{font-size:11px;color:var(--ink2)}
.ed-cap-r{margin-left:auto;display:inline-flex;align-items:center;gap:8px}
.ed-ctl{flex:1 1 100%;min-width:0;display:flex;flex-direction:column;gap:4px}
.ed-ctl-h{display:flex;align-items:center;justify-content:space-between;gap:12px;font:500 12.5px/1.25 var(--f-sans);color:var(--ink2)}
.ed-ctl-h b{font:500 11.5px/1.2 var(--f-mono);color:#fff;letter-spacing:.02em}
.ed-ctl-f{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 12px}
.ed-cb{background:none;border:1px solid var(--hair2);border-radius:999px;padding:4px 11px;font:500 10.5px/1.2 var(--f-mono);letter-spacing:.02em;color:var(--ink2);cursor:pointer;transition:color .15s,border-color .15s,background-color .15s}
.ed-cb:hover{color:#fff;border-color:var(--acc)}
.ed-cb[aria-pressed="true"]{color:#fff;border-color:transparent;background:var(--grad)}
.ed-play{flex:none;display:inline-grid;place-items:center;width:30px;height:30px;border:0;border-radius:50%;background:var(--grad);color:#fff;font-size:10px;cursor:pointer;transition:filter .15s}
.ed-play:hover{filter:brightness(1.15)}
.ed-ico{display:inline-grid;place-items:center;width:38px;height:34px;border:1px solid var(--hair);border-radius:12px;background:none;color:var(--ic,#E8BE74);font-size:15px;cursor:pointer;transition:border-color .15s,background-color .15s}
.ed-ico:hover{border-color:var(--hair2)}
.ed-ico[aria-selected="true"]{border-color:var(--ic,#E8BE74);background:color-mix(in srgb,var(--ic,#E8BE74) 14%,transparent)}

/* ---- Tuval altı kontroller (HUD kartı) ---- */
.ed-hud{flex:none;display:flex;flex-direction:column;max-height:46vh;overflow-y:auto;overflow-x:hidden;padding:2px 18px;background:var(--card-bg);border:1px solid var(--hair);border-radius:20px}
.ed-hud-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 26px;padding:10px 0;border-top:1px solid var(--hair)}
.ed-hud-row:first-child{border-top:0}
.ed-cell{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;min-width:0;padding:0}
.ed-cell.is-grow{flex:1 1 240px}
.ed-cell-l{flex:none;white-space:nowrap;font:500 11px/1.2 var(--f-sans);letter-spacing:.01em;color:var(--mute)}
.ed-lam{font:600 28px/1 var(--f-sans);font-variant-numeric:lining-nums tabular-nums;color:#fff}
.ed-lam small{font:500 10.5px var(--f-mono);letter-spacing:.08em;color:var(--mute);margin-left:5px}
.ed-hud select{padding-top:5px!important;padding-bottom:5px!important;font-size:11.5px!important}
.ed-pill{display:inline-flex;align-items:center;gap:7px;background:none;border:1px solid color-mix(in srgb,var(--pc,#A9C4F5) 55%,transparent);border-radius:999px;padding:6px 14px;color:var(--ink2);font:500 11.5px/1.1 var(--f-sans);cursor:pointer;transition:background-color .15s,color .15s,border-color .15s}
.ed-pill:hover{color:#fff;border-color:var(--pc,#A9C4F5)}
.ed-pill[aria-pressed="true"]{color:#fff;background:color-mix(in srgb,var(--pc,#A9C4F5) 20%,transparent);border-color:var(--pc,#A9C4F5)}
.ed-pill[aria-pressed="false"]{opacity:.62}
.ed-foot{position:absolute;left:var(--sx-ml);right:var(--sx-mr);bottom:calc(var(--sx-i) - 8px);height:22px;z-index:36;display:flex;align-items:center;justify-content:space-between;gap:12px;font:400 11px/1 var(--f-sans);color:rgba(255,255,255,.62)}
.ed-foot span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.ed-foot span:first-child{flex:none;overflow:visible;max-width:60%}
.nx-disc{color:rgba(255,255,255,.75)}

/* ---- Tooltip ---- */
.ed-tip{position:fixed;z-index:1000;padding:13px 15px;background:#0a1028;border:1px solid var(--hair2);border-radius:16px;box-shadow:0 24px 60px -20px #000;color:var(--ink2);font:400 12.5px/1.6 var(--f-sans);text-transform:none;letter-spacing:normal;overflow-y:auto}
.ed-tip-t{font:600 11.5px/1.3 var(--f-sans);letter-spacing:0;color:var(--acc2);margin-bottom:6px}

/* ---- Modal · menü ---- */
.ed-modal{position:fixed;inset:0;z-index:900;display:grid;place-items:center;background:rgba(3,6,20,.78);backdrop-filter:blur(6px);padding:14px}
.ed-modal-p{display:flex;flex-direction:column;width:100%;max-width:660px;max-height:88vh;overflow:hidden;background:#0a1028;border:1px solid var(--hair2);border-radius:26px;box-shadow:0 40px 120px -30px #000}
.ed-menu{position:fixed;z-index:960;max-height:80vh;overflow-y:auto;background:#0a1028;border:1px solid var(--hair2);border-radius:20px;box-shadow:0 30px 80px -26px #000}
.ed-menu-i{display:flex;width:100%;align-items:flex-start;gap:12px;text-align:left;background:none;border:0;border-bottom:1px solid var(--hair);padding:13px 18px;cursor:pointer;color:var(--ink);transition:background-color .2s}
.ed-menu-i:last-child{border-bottom:0}
.ed-menu-i:hover{background:rgba(255,255,255,.06)}
.ed-menu-i[aria-checked="true"]{background:linear-gradient(90deg,rgba(110,150,230,.3),transparent 85%)}
.ed-drop{position:fixed;inset:0;z-index:950;pointer-events:none;display:grid;place-items:center;background:rgba(3,6,20,.88)}
.ed-drop>div{border:2px dashed var(--acc);border-radius:28px;padding:42px 56px;text-align:center}

/* ---- Katalog ---- */
.ed-page{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;padding:22px 40px 36px 24px;scroll-behavior:smooth}
.ed-searchbar{display:flex;align-items:center;gap:10px;padding:4px 16px;border:1px solid var(--hair2);border-radius:999px;background:#080e24;transition:border-color .15s,box-shadow .15s}
.ed-searchbar:focus-within{border-color:var(--acc);box-shadow:0 0 0 3px rgba(169,196,245,.2)}
.ed input.ed-search{font:400 14px/1.3 var(--f-sans)!important;padding:9px 4px!important;border:0!important;background:transparent!important;border-radius:0!important;box-shadow:none!important}
.ed-cat-row{display:grid;grid-template-columns:34px minmax(0,1.1fr) minmax(0,1.4fr) minmax(0,.9fr) 24px;align-items:baseline;gap:6px 18px;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--hair);border-radius:14px;padding:14px 8px;color:var(--ink);cursor:pointer;position:relative;transition:background-color .2s}
.ed-cat-row:hover{background:rgba(255,255,255,.05)}
.ed-cat-row[aria-pressed="true"]{background:linear-gradient(90deg,rgba(110,150,230,.42),rgba(58,86,168,.08));border-bottom-color:transparent}
.ed-cat-row .ed-arrow{color:var(--dim);transition:transform .25s,color .25s;justify-self:end}
.ed-cat-row:hover .ed-arrow{color:var(--acc);transform:translateX(4px)}

/* ---- Duyarlı ---- */
@media (max-width:1599px){.ed-cell-l.is-long{display:none}}
@media (max-height:820px) and (min-width:1280px){.ed{--sx-i:20px}.sx-head-row{min-height:54px}.ed-brand{padding-bottom:6px}.nx-mark{width:44px}.sx-word .nx-wm{height:26px!important}.sx-orn{padding-bottom:8px}.ed-tab{padding:10px 12px}.ed-meta{padding:7px 12px}.sx-sub{display:none}}
@media (max-width:1279px){
.ed{--sx-i:0px;--sx-ml:18px;--sx-mr:18px;--sx-mt:var(--sx-side-h,64px);--sx-vb:44px}
.ed-atmos::before{inset:0;border-radius:0;border:0}
.sx-side{left:0;right:0;top:0;bottom:auto;width:auto;z-index:80;flex-direction:row;flex-wrap:nowrap;align-items:center;gap:10px 14px;padding:8px 16px;padding-top:calc(8px + env(safe-area-inset-top,0px));border-radius:0;border-width:0 0 1px;overflow:visible;background:linear-gradient(180deg,#0a1028,#070c20)}
.ed-brand{padding:0;gap:10px;flex:none}.nx-mark{width:40px}.sx-word .nx-wm{height:22px!important}.sx-word small{display:none}.sx-orn{display:none}
.ed-nav{flex-direction:row;flex:1 1 auto;justify-content:center;gap:4px;min-width:0;overflow:visible}
.sx-navitem{flex:none}
.sx-navitem .ed-i{display:none}
.ed-tab{flex:none;padding:9px 15px;white-space:nowrap}
.nx-menu-btn{display:inline-flex;position:relative;z-index:6;order:9;align-items:center;gap:9px;flex:none;min-height:42px;margin-left:auto;padding:0 15px 0 13px;border:1px solid var(--hair2);border-radius:999px;background:rgba(255,255,255,.05);color:#fff;font:500 12.5px/1 var(--f-sans);cursor:pointer;transition:background-color .2s,border-color .2s}
.nx-menu-btn:hover,.nx-menu-btn[aria-expanded="true"]{background:rgba(169,196,245,.16);border-color:var(--acc)}
.nx-burger{position:relative;display:block;width:16px;height:12px;flex:none}
.nx-burger i{position:absolute;left:0;right:0;height:1.7px;border-radius:2px;background:currentColor;transition:transform .2s,opacity .2s,top .2s}
.nx-burger i:nth-child(1){top:0}.nx-burger i:nth-child(2){top:5.2px}.nx-burger i:nth-child(3){top:10.4px}
.nx-menu-btn[aria-expanded="true"] .nx-burger i:nth-child(1){top:5.2px;transform:rotate(45deg)}
.nx-menu-btn[aria-expanded="true"] .nx-burger i:nth-child(2){opacity:0}
.nx-menu-btn[aria-expanded="true"] .nx-burger i:nth-child(3){top:5.2px;transform:rotate(-45deg)}
.nx-menu-dot{display:block;width:7px;height:7px;border-radius:50%;flex:none}
.nx-scrim{display:block;position:fixed;inset:0;z-index:4;background:rgba(2,4,14,.58);animation:nxFade .18s ease-out}
.sx-tools{display:none;position:absolute;top:calc(100% + 8px);right:16px;left:auto;bottom:auto;z-index:5;width:min(380px,calc(100vw - 32px));margin:0;flex:none;flex-direction:column;align-items:stretch;gap:2px;padding:8px 10px 14px;border:1px solid var(--hair2);border-radius:22px;background:#0a1028;box-shadow:0 34px 80px -24px #000;max-height:calc(100vh - 92px);overflow-y:auto;overflow-x:hidden}
.sx-tools[data-open="true"]{display:flex;animation:nxDrop .18s ease-out}
.nx-sheet-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 4px 8px 12px;font:600 15px/1 var(--f-sans);color:#fff;flex:none}
.nx-x{display:grid;place-items:center;width:36px;height:36px;border:1px solid var(--hair2);border-radius:50%;background:rgba(255,255,255,.04);color:var(--ink2);font-size:13px;cursor:pointer}
.nx-x:hover{color:#fff;border-color:var(--acc)}
.sx-grp-t{display:block;padding:6px 12px 8px}
.sx-rows{flex-direction:column;align-items:stretch;flex:none}
.sx-row{flex:none}
.ed-meta{padding:12px 14px;min-height:46px;white-space:normal}
.ed-langs{order:0;flex-wrap:wrap;gap:6px;padding:14px 8px 6px}
.ed-langs button{padding:9px 15px;font-size:12.5px}
.sx-status{order:9;padding:12px 12px 0}
.ed-foot{left:18px;right:18px;bottom:10px}
}
@keyframes nxDrop{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
@keyframes nxSheet{from{opacity:.4;transform:translateY(40px)}to{opacity:1;transform:none}}
@keyframes nxFade{from{opacity:0}to{opacity:1}}
@media (max-width:1100px){
.ed{overflow-y:auto!important;overflow-x:hidden!important;display:flex;flex-direction:column}
.sx-side{position:sticky;top:0;order:-5;flex:none}
.sx-lbl.is-long{display:none}.sx-lbl.is-short{display:inline}
.ed-top{position:relative;left:auto;right:auto;top:auto;order:-4;padding:6px 16px 0;flex:none}
.ed-seg{flex-wrap:nowrap;overflow-x:auto;width:100%;scrollbar-width:none;white-space:nowrap;padding-bottom:6px}
.ed-seg::-webkit-scrollbar{display:none}
.ed-seg>*{flex:none}
.ed-view{position:relative;left:auto;right:auto;top:auto;bottom:auto;padding:8px 14px 8px;grid-template-columns:minmax(0,1fr);grid-template-rows:none;gap:12px}
.ed-view[data-active="true"]{display:flex;flex-direction:column}
.ed-col-l{order:2;margin:0}.ed-col-r{order:3;margin:0}.ed-center{order:1}
.ed-stage{flex:none;height:min(calc(100vw - 30px),76vh)}
.ed-stage.is-plain{height:74vh}
.ed-drawer,.ed-drawer.is-wide{width:auto}
.ed-drawer[data-open="false"]{display:flex}.ed-drawer[data-open="false"] .ed-dbody{display:none}
.ed-dbody{overflow:visible}
.ed-dtab{display:none}
.ed-hud{max-height:none;overflow:visible}
.ed-foot{position:relative;left:auto;right:auto;bottom:auto;order:9;height:auto;padding:10px 18px 16px;flex-wrap:wrap;gap:6px 12px}
.ed-foot span{white-space:normal}
.ed-notes{left:auto;right:auto;top:auto;position:relative;order:-3;margin:10px 16px 0}
.ed-page{padding:18px 16px 28px 14px}
}
@media (max-width:760px){.ed-cell.is-grow{flex-basis:100%}.ed-hud select{max-width:44vw}.ed-cat-row{grid-template-columns:26px minmax(0,1fr) 18px}.ed-cat-row .ed-c3,.ed-cat-row .ed-c4{grid-column:2/3}.ed-lam{font-size:24px}.sx-h1{font-size:28px}.sx-head-row{min-height:0;padding:8px 0 4px}.ed-hud{padding:2px 14px}}
@media (min-width:761px) and (max-width:900px){.nx-menu-lbl{display:none}.nx-menu-btn{padding:0 13px}.ed-tab{padding:9px 11px;gap:8px}.sx-word .nx-wm{height:20px!important}.ed-brand{gap:8px}.sx-side{gap:8px}}
@media (max-width:760px){
.sx-side{padding:6px 14px;padding-top:calc(6px + env(safe-area-inset-top,0px))}
.nx-mark{width:38px}.sx-word .nx-wm{height:21px!important}
.ed-nav{position:fixed;left:0;right:0;bottom:0;top:auto;z-index:3;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;flex:none;justify-content:stretch;padding:6px 10px calc(8px + env(safe-area-inset-bottom,0px));background:linear-gradient(180deg,rgba(10,16,40,.98),#050919);border-top:1px solid var(--hair2);box-shadow:0 -18px 40px -24px #000}
.sx-navitem{display:block;min-width:0}
.ed-tab{position:relative;width:100%;flex-direction:column;justify-content:center;align-items:center;gap:4px;min-height:54px;padding:8px 4px 7px;border-radius:16px;font-size:11px;line-height:1.1;text-align:center;white-space:nowrap}
.ed-tab .sx-ico{width:22px;height:22px;opacity:.85}
.ed-tab .sx-lbl{flex:none;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.ed-tab[aria-selected="true"]{background:linear-gradient(180deg,rgba(110,150,230,.36),rgba(58,86,168,.12));box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}
.ed-tab[aria-selected="true"] .sx-ico{opacity:1}
.ed-tab b{position:absolute;top:3px;left:calc(50% + 8px);padding:2px 6px}
.sx-tools{position:fixed;top:auto;left:0;right:0;bottom:0;width:auto;max-height:min(86vh,700px);border-radius:26px 26px 0 0;border-width:1px 0 0;padding:8px 14px calc(18px + env(safe-area-inset-bottom,0px))}
.sx-tools[data-open="true"]{animation:nxSheet .24s ease-out}
.sx-tools::before{content:"";display:block;flex:none;width:40px;height:4px;margin:0 auto 6px;border-radius:2px;background:var(--hair2)}
.ed-langs{flex-wrap:nowrap;justify-content:space-between;gap:6px;padding:14px 4px 6px}
.ed-langs button{flex:1;min-height:44px;padding:0;font-size:13px}
.ed-foot{padding-bottom:calc(86px + env(safe-area-inset-bottom,0px))}
.ed-notes{margin:8px 14px 0}
.ed-seg[data-testid="real-panes"]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;overflow:visible;white-space:normal;padding-bottom:2px}
.ed-seg[data-testid="real-panes"]>span{min-width:0;display:block}
.ed-seg[data-testid="real-panes"] .ed-segbtn{width:100%;justify-content:center;white-space:normal;text-align:center;line-height:1.25;padding:10px 12px;min-height:46px}
.ed-seg[data-testid="real-panes"] .ed-i{display:none}
}
@supports (height:100dvh){@media (max-width:760px){.sx-tools{max-height:min(86dvh,700px)}}@media (min-width:761px) and (max-width:1279px){.sx-tools{max-height:calc(100dvh - 92px)}}}
/* ---- v3.6: dokunmatik cihazlar (telefon/tablet): büyük hedefler, iOS yakınlaştırmasını önleyen yazı boyu ---- */
@media (pointer:coarse){
.ed .ed-segbtn{min-height:42px}
.ed .ed-btn{min-height:44px}.ed .ed-btn.is-sm{min-height:42px}
.ed .ed-meta{min-height:48px}
.ed .ed-langs button{min-height:42px;padding:9px 15px;font-size:13px}
.ed .zp-btn{width:40px;height:40px;font-size:18px}
.ed .ed-i{position:relative}.ed .ed-i::after{content:"";position:absolute;inset:-10px}
.ed select,.ed input:not([type="range"]):not([type="checkbox"]),.ed textarea{font-size:16px!important;min-height:42px}
.ed .ed-hud select{font-size:16px!important;padding-top:8px!important;padding-bottom:8px!important}
.ed input[type="checkbox"]{width:22px;height:22px}
.spx-range{height:32px}
.spx-range::-webkit-slider-thumb{width:26px;height:26px;margin-top:-11px}
.spx-range::-moz-range-thumb{width:26px;height:26px}
.ed-dhead{min-height:52px}
.ed-cat-row{padding:16px 8px}
}
/* ---- v3.5: yakınlaştırma düğmeleri · genişletilmiş sahne · gömme kipi ---- */
.zp-ctl{position:absolute;right:10px;top:50%;transform:translateY(-50%);z-index:4;display:flex;flex-direction:column;align-items:center;gap:6px;padding:6px;border:1px solid var(--hair2);border-radius:16px;background:rgba(5,9,26,.74);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.zp-btn{width:30px;height:30px;border-radius:10px;border:1px solid var(--hair);background:rgba(255,255,255,.05);color:var(--ink);font:500 16px/1 var(--f-sans);cursor:pointer;display:grid;place-items:center;padding:0;transition:background .2s,border-color .2s,color .2s}
.zp-btn:hover:not(:disabled){background:rgba(169,196,245,.18);border-color:var(--acc);color:#fff}
.zp-btn:disabled{opacity:.35;cursor:default}
.zp-lvl{font:500 10px/1 var(--f-mono);color:var(--mute);letter-spacing:.04em;padding:1px 0}
.ed-view[data-active="true"][data-expanded="true"]{position:fixed!important;left:0!important;right:0!important;top:0!important;bottom:0!important;z-index:400;display:flex!important;flex-direction:column;padding:12px!important;gap:0!important;background:var(--bg)}
.ed-view[data-expanded="true"]>.ed-drawer,.ed-view[data-expanded="true"]>.ed-dtab{display:none!important}
.ed-view[data-expanded="true"] .ed-center{flex:1 1 0;min-height:0;order:0;gap:8px}
.ed-view[data-expanded="true"] .ed-stage{flex:1 1 0!important;height:auto!important;min-height:0}
.ed-view[data-expanded="true"] .ed-hud{max-height:34vh;overflow-y:auto}
.ed[data-embed="1"] .sx-side,.ed[data-embed="1"] .ed-top,.ed[data-embed="1"] .ed-foot,.ed[data-embed="1"] .ed-notes{display:none!important}
.ed[data-embed="1"]{--sx-ml:10px;--sx-mr:10px;--sx-mt:10px;--sx-vb:10px;--ed-hdr:0px!important}
.ed[data-embed="1"] .ed-atmos::before{display:none}
.ed[data-embed="1"] .ed-view{top:var(--sx-mt)!important}
.nx-embed-link{position:fixed;left:14px;top:12px;z-index:60;display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border:1px solid var(--hair2);border-radius:999px;background:rgba(5,9,26,.78);color:var(--acc2);font:500 11px/1 var(--f-sans);text-decoration:none;backdrop-filter:blur(8px)}
.nx-embed-link:hover{border-color:var(--acc);color:#fff}
.nx-embed-link img{width:14px;height:14px;object-fit:contain}
.ed-seg-compact .ed-segbtn{padding:7px 13px;font-size:12px}
.ed-mv{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;min-width:0}
.ed-mv .zp-btn{width:30px;height:30px;font-size:13px}
.ed-mv input[type=range]{min-width:120px}
.ed-mv-n{font:500 11px/1 var(--f-mono);color:var(--ink2);min-width:84px;text-align:right;white-space:nowrap}
.ed-flagrow{display:grid;grid-template-columns:10px minmax(0,1fr) auto auto;gap:4px 10px;align-items:center;font:400 11px/1.3 var(--f-mono);color:var(--ink2);padding:3px 0;border-bottom:1px solid var(--hair)}
.ed-flagrow i{width:8px;height:8px;border-radius:50%;display:block}
.ed-flagrow b{font-weight:500;color:var(--ink)}
.ed-flagrow span.is-n{text-align:right;color:var(--mute)}
.ed-metarow{display:flex;justify-content:space-between;gap:12px;font:400 11px/1.4 var(--f-mono);padding:3px 0;border-bottom:1px solid var(--hair);color:var(--ink2)}
.ed-metarow span:first-child{color:var(--dim)}
.ed-share{width:100%;font:400 10.5px/1.35 var(--f-mono);color:var(--ink2);background:rgba(255,255,255,.04);border:1px solid var(--hair);border-radius:10px;padding:8px 10px;resize:none}
@media (prefers-reduced-motion:reduce){.ed *,.ed *::before,.ed *::after{animation:none!important;transition:none!important}}
`;

/* ---------------------------------------------------------------------
   Küçük yardımcılar
   --------------------------------------------------------------------- */
const edPad = (n, w = 2) => String(n).padStart(w, '0');
function idxOf(icon) {
  if (icon && icon.props && icon.props.children !== undefined) {
    const c = icon.props.children;
    if (typeof c === 'number' || (typeof c === 'string' && /^\d{1,2}$/.test(c))) return edPad(c);
  }
  return null;
}
const ED_GLYPHS = ['✦', '✧', '✦', '✧', '✦', '✧'];
const ED_WIDE = () => (typeof window === 'undefined' ? true : window.innerWidth >= 1100);

/** Gövdeye yazı tiplerini (yalnızca çevrimiçiyken) ekler; yoksa sistem serif/mono yığınına düşer. */
function useEdFonts() {
  useEffect(() => {
    try {
      if (document.getElementById('ed-fonts')) return;
      const l = document.createElement('link');
      l.id = 'ed-fonts'; l.rel = 'stylesheet'; l.href = ED_FONTS_URL;
      document.head.appendChild(l);
    } catch (e) { /* yoksay */ }
  }, []);
}

function Atmosphere() {
  return (
    <div className="ed-atmos" aria-hidden="true" data-testid="atmosphere">
      <i className="ed-glow ed-glow-a" />
    </div>
  );
}

/** Çekmece açık/kapalı durumu: geniş ekranda sol açık, dar ekranda ikisi de kapalı */
function useDrawers(leftDef = true, rightDef = false) {
  const [lo, setLo] = useState(() => leftDef && ED_WIDE());
  const [ro, setRo] = useState(() => rightDef && (typeof window === 'undefined' || window.innerWidth >= 1440));
  return { lo, ro, setLo, setRo, toggleL: () => setLo((v) => !v), toggleR: () => setRo((v) => !v) };
}

function Drawer({ side, open, onToggle, label, index, testId, tabId, wide, children }) {
  const { t } = useI18n();
  const sd = side === 'l' ? 'l' : 'r';
  return (
    <>
      <button type="button" className={`ed-dtab is-${sd} ${open ? 'is-hidden' : ''}`} onClick={onToggle} aria-expanded={open} aria-label={`${t('ed.show')} — ${label}`} data-testid={tabId}>
        <span>{index}</span><span>{label}</span><span aria-hidden>{sd === 'l' ? '→' : '←'}</span>
      </button>
      <aside className={`ed-drawer ed-col-${sd} ${wide ? 'is-wide' : ''}`} data-open={open ? 'true' : 'false'} aria-hidden={!open} data-testid={testId}>
        <header className="ed-dhead">
          <span className="ed-label"><b>{index}</b>{label}</span>
          <button type="button" className="ed-link" onClick={onToggle} data-testid={tabId ? tabId + '-hide' : undefined} aria-label={`${open ? t('ed.hide') : t('ed.show')} — ${label}`}>{open ? t('ed.hide') : t('ed.show')} <span aria-hidden>{open ? '—' : '+'}</span></button>
        </header>
        <div className="ed-dbody spx-scroll">{children}</div>
      </aside>
    </>
  );
}

function HudRow({ children, className = '' }) { return <div className={`ed-hud-row ${className}`}>{children}</div>; }
function HudCell({ label, long, grow, children, className = '', testId }) {
  return (
    <div className={`ed-cell ${grow ? 'is-grow' : ''} ${className}`} data-testid={testId}>
      {label ? <span className={`ed-cell-l ${long ? 'is-long' : ''}`}>{label}</span> : null}
      {children}
    </div>
  );
}

/** Görünüm: [sol panel] | sahne + tuval altı kontroller (HUD) | [sağ panel]. Dar ekranda alt alta dizilir. */
// "Sahneyi genişlet" durumu ViewFrame'de tutulur; düğme tuvaldeki yakınlaştırma kümesinde (ZoomButtons) görünür
const ExpandCtx = createContext(null);
function ViewFrame({ active, testId, cap, stage, left, right, hud, plain, expandable }) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);
  useEffect(() => { if (!active) setFull(false); }, [active]);
  const ex = useMemo(() => (expandable ? { testId: testId || 'view', full, toggle: () => setFull((f) => !f) } : null), [expandable, testId, full]);
  return (
    <ExpandCtx.Provider value={ex}>
      <div className="ed-view" data-active={active ? 'true' : 'false'} data-expanded={full ? 'true' : 'false'} data-testid={testId}>
        {left}
        <div className="ed-center">
          {cap ? <div className="ed-capwrap">{cap}</div> : null}
          <div className={`ed-stage ${plain ? 'is-plain' : ''}`}>{stage}</div>
          <div className="ed-hud" data-testid={testId ? testId + '-hud' : undefined}>{hud}</div>
        </div>
        {right}
      </div>
    </ExpandCtx.Provider>
  );
}

/** Geometrik göstergeli segment grubu (rol: tablist | group) */
function Seg({ items, value, onChange, role = 'tablist', label, testPrefix, indexed = true }) {
  const isTab = role === 'tablist';
  return (
    <div className="ed-seg" role={role} aria-label={label}>
      {items.map((it, i) => {
        const on = value === it.id;
        const p = isTab ? { role: 'tab', 'aria-selected': on } : { 'aria-pressed': on };
        return (
          <button key={it.id} type="button" className="ed-segbtn" data-testid={testPrefix ? `${testPrefix}${it.id}` : undefined} title={it.title} disabled={it.disabled} onClick={() => onChange(it.id)} {...p}>
            {indexed ? <i>{edPad(i + 1)}</i> : null}{it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------
   Ortak bileşenler (ⓘ ipucu · bölüm · açılır bölüm · kaydırıcı · değer · künye · dil menüsü · pencere)
   --------------------------------------------------------------------- */
// ⓘ: fareyle üzerine gelince, odaklanınca veya tıklayınca açılan, ekran dışına taşmayan açıklama balonu
function InfoTip({ id, text, title }) {
  const { t } = useI18n();
  const [hov, setHov] = useState(false);
  const [pin, setPin] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const pop = useRef(null);
  const open = hov || pin;
  const body = text || t(id);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(330, vw - 16);
    const left = clamp(r.left + r.width / 2 - w / 2, 8, vw - w - 8);
    const below = vh - r.bottom;
    const above = r.top;
    if (below >= 200 || below >= above) setPos({ left, w, top: r.bottom + 8, maxH: Math.max(90, vh - r.bottom - 16) });
    else setPos({ left, w, bottom: vh - r.top + 8, maxH: Math.max(90, r.top - 16) });
  }, [open, body]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => { setPin(false); setHov(false); };
    const onDown = (e) => {
      if (btn.current && btn.current.contains(e.target)) return;
      if (pop.current && pop.current.contains(e.target)) return;
      close();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <>
      <button type="button" ref={btn} className="spx-tipbtn" data-spx-tip={id || 'text'} aria-label={`${t('common.moreInfo')}${title ? ' — ' + title : ''}`} aria-expanded={open}
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} onFocus={() => setHov(true)} onBlur={() => setHov(false)}
        onClick={(e) => { e.stopPropagation(); setPin((p) => !p); }}>
        <span className="ed-i" aria-hidden="true">i</span>
      </button>
      {open && pos && createPortal(
        <div ref={pop} role="tooltip" className="ed-tip spx-pop spx-scroll"
          style={{ left: pos.left, width: pos.w, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH, pointerEvents: pin ? 'auto' : 'none' }}>
          {title ? <div className="ed-tip-t">{title}</div> : null}
          {body}
        </div>, document.body)}
    </>
  );
}

function Card({ title, tip, icon, right, children, className = '', bodyClass = '' }) {
  const n = idxOf(icon);
  return (
    <section className={`ed-sec ${className}`}>
      {title && (
        <header className="ed-sec-h">
          {n ? <span className="ed-sec-n" aria-hidden title={n}>{ED_GLYPHS[(parseInt(n, 10) - 1) % ED_GLYPHS.length]}</span> : null}
          <h3 className="ed-sec-t" title={typeof title === 'string' ? title : undefined}>{title}</h3>
          {tip ? <InfoTip id={tip} title={typeof title === 'string' ? title : undefined} /> : null}
          {right}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

// Açılır/kapanır bölüm (ayarlar, teknik veriler). Başlık satırı bir düğme + ayrı ⓘ içerir.
function Disclosure({ title, tip, open, onToggle, children, testId }) {
  return (
    <section className="ed-sec">
      <div className="ed-sec-h" style={{ marginBottom: open ? 14 : 0 }}>
        <button type="button" onClick={onToggle} aria-expanded={open} data-testid={testId} className="ed-disc-btn">
          <span className="ed-sec-t">{title}</span><span className="ed-pm" aria-hidden="true">{open ? '−' : '+'}</span>
        </button>
        {tip ? <InfoTip id={tip} title={title} /> : null}
      </div>
      {open && <div>{children}</div>}
    </section>
  );
}

function Slide({ label, tip, value, min, max, step, onChange, fmt, red }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="ed-label flex min-w-0 items-center gap-1.5">{label}{tip ? <InfoTip id={tip} title={label} /> : null}</span>
        <span className="ed-mono text-[11px] text-[#EEF3FD]">{fmt ? fmt(value) : value}</span>
      </div>
      <input type="range" className={`spx-range ${red ? 'spx-red' : ''}`} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function Stat({ label, tip, value, sub, color }) {
  return (
    <div className="ed-stat">
      <div className="ed-label flex items-start justify-between gap-1"><span className="min-w-0">{label}</span>{tip ? <InfoTip id={tip} title={label} /> : null}</div>
      <div className="ed-stat-v mt-1.5" style={color ? { color } : undefined}>{value}</div>
      {sub ? <div className="ed-stat-s">{sub}</div> : null}
    </div>
  );
}

// Künye: yuvarlak rozet yok; renkli küçük kare + ince büyük harfli metin
function Chip({ children, color = '#A9C4F5', className = '', title }) {
  return (
    <span title={title} className={`ed-chip ${className}`}><i style={{ background: color, boxShadow: `0 0 8px ${color}88` }} /><span className="min-w-0 truncate">{children}</span></span>
  );
}

function LangMenu({ lang, setLang }) {
  const { t } = useI18n();
  return (
    <div className="ed-langs" role="group" aria-label={t('lang.label')} data-testid="lang-switch">
      {LANGS.map((L, i) => (
        <React.Fragment key={L.code}>
          {i > 0 ? <span aria-hidden>/</span> : null}
          <button type="button" data-lang={L.code} aria-pressed={lang === L.code} title={L.name} onClick={() => setLang(L.code)}>{L.short}</button>
        </React.Fragment>
      ))}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="ed-modal" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label={title}>
      <div className="ed-modal-p">
        <div className="flex items-baseline justify-between gap-4 border-b border-white/10 px-6 py-4">
          <div className="ed-serif text-[24px] italic leading-tight text-[#EEF3FD]">{title}</div>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="ed-link">{t('common.close')} <span aria-hidden>✕</span></button>
        </div>
        <div className="spx-scroll overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// Canlı katalog (SIMBAD + SkyBoT) durumu: kayıtlı keşif için ince çizgili durum bloğu
function CatalogStatus({ app, entry, compact }) {
  const { t } = app;
  const cat = entry.catalog || { status: 'pending' };
  const col = statusColor(cat.status);
  return (
    <div className={`border-l pl-3 text-[11.5px] leading-snug ${cat.status === 'nomatch' ? 'spx-alert' : ''}`} style={{ color: col, borderColor: col + '99' }} data-testid="catalog-status" data-status={cat.status}>
      <div className={`flex items-start gap-1.5 font-medium ${cat.status === 'pending' ? 'spx-pulse' : ''}`}>
        <span aria-hidden className="mt-[3px] inline-block h-[6px] w-[6px] shrink-0" style={{ background: col, boxShadow: `0 0 8px ${col}` }} />
        <span>{netMessage(t, cat)}</span>
      </div>
      {!compact && cat.simbad && cat.simbad.slice(0, 4).map((m, i) => (
        <div key={i} className="ed-mono mt-1 text-[10.5px] text-[#C5D3EE]">· {m.id} · {m.otype || '?'} · {m.sep.toFixed(1)}″{m.sp ? ` · ${m.sp}` : ''}</div>
      ))}
      {!compact && cat.skybot && cat.skybot.items && cat.skybot.items.slice(0, 3).map((m, i) => (
        <div key={`sb${i}`} className="ed-mono mt-1 text-[10.5px] text-[#C5D3EE]">· SkyBoT: {m.name}{m.cls ? ` · ${m.cls}` : ''}</div>
      ))}
      {!compact && cat.skybot && cat.skybot.status === 'unavailable' && <div className="mt-1 text-[10.5px] text-[#93A6CC]">{t('net.skybotDown')}</div>}
      {cat.status !== 'pending' && (
        <button type="button" onClick={() => app.recheckEntry(entry.uid)} className="ed-link mt-2">{t('net.recheck')}</button>
      )}
    </div>
  );
}
/* =====================================================================
   BÖLÜM 13 — KANVAS ÜZERİ ÇİZİM (graticule · HUD · seçim · tarama/katalog işaretleri)
   Koordinatlar CSS pikselidir (kanvas iç çözünürlüğü = CSS boyutu × devicePixelRatio).
   ===================================================================== */
function txt(ctx, s, x, y, color, align) {
  ctx.textAlign = align || 'left';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(4,6,12,0.88)'; ctx.strokeText(s, x, y);
  ctx.fillStyle = color; ctx.fillText(s, x, y);
}

function drawOverlay(ctx, o) {
  const { view, sky, size, t, lang } = o;
  const S = size / W;
  const k = S * view.z;
  const sx = (x) => (x - view.sx) * k;
  const sy = (y) => (y - view.sy) * k;
  const Wc = size, Hc = size;
  const fs = size < 420 ? 10 : size < 640 ? 11 : 12;
  ctx.save();
  ctx.font = `${fs}px ${MONO_STACK}`;
  ctx.lineJoin = 'round';

  // --- RA / Dec işaretleri (alt kenar: RA · sağ kenar: Dec) ---
  ctx.strokeStyle = 'rgba(170,196,236,0.6)'; ctx.lineWidth = 1;
  [0.1, 0.3, 0.5, 0.7, 0.9].forEach((f) => {
    const px = f * Wc;
    const s = sky.wcs.pixToSky(view.sx + px / k, view.sy + Hc / k);
    ctx.beginPath(); ctx.moveTo(px, Hc - 14); ctx.lineTo(px, Hc); ctx.stroke();
    txt(ctx, fmtRAshort(s.ra), px, Hc - 18, 'rgba(190,212,245,0.85)', 'center');
  });
  [0.2, 0.35, 0.5, 0.65, 0.8].forEach((f) => {
    const py = f * Hc;
    const s = sky.wcs.pixToSky(view.sx + Wc / k, view.sy + py / k);
    ctx.beginPath(); ctx.moveTo(Wc - 14, py); ctx.lineTo(Wc, py); ctx.stroke();
    txt(ctx, fmtDecshort(s.dec), Wc - 18, py + 4, 'rgba(190,212,245,0.85)', 'right');
  });

  // --- Ölçek çubuğu ---
  const opts = [5, 10, 20, 30, 60, 120, 300, 600];
  const maxBar = Math.min(150, size * 0.28);
  let arc = opts[0];
  for (let i = 0; i < opts.length; i++) if ((opts[i] / PLATE) * k <= maxBar) arc = opts[i];
  const barPx = (arc / PLATE) * k;
  ctx.strokeStyle = '#DCE6F5'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(12, Hc - 40); ctx.lineTo(12 + barPx, Hc - 40); ctx.moveTo(12, Hc - 45); ctx.lineTo(12, Hc - 35); ctx.moveTo(12 + barPx, Hc - 45); ctx.lineTo(12 + barPx, Hc - 35); ctx.stroke();
  txt(ctx, arc >= 60 ? `${arc / 60}′` : `${arc}″`, 12 + barPx / 2, Hc - 49, '#DCE6F5', 'center');

  // --- Pusula (Kuzey yukarı · Doğu solda) ---
  const cx0 = Wc - 46, cy0 = Hc - 66;
  ctx.strokeStyle = '#5B9DFF'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx0, cy0); ctx.lineTo(cx0, cy0 - 20); ctx.moveTo(cx0, cy0); ctx.lineTo(cx0 - 20, cy0); ctx.stroke();
  txt(ctx, t('compass.n'), cx0, cy0 - 24, '#5B9DFF', 'center');
  txt(ctx, t('compass.e'), cx0 - 28, cy0 + 4, '#5B9DFF', 'center');

  // --- HUD (sol üst) ---
  const lam = BAND_LAMBDA[o.band];
  const lines = [{ s: t('mode.' + o.mode + '.n'), c: '#5B9DFF' }];
  if (o.mode === 'photo') {
    lines.push({ s: t('rm.photo.hud', { src: (o.photoInfo && o.photoInfo.label) || '' }), c: '#DCE6F5' });
    lines.push({ s: t('rm.photo.cat', { e: epochLabel(lang, o.effB) }), c: '#8FE0B5' });
  } else if (o.mode === 'blink') {
    const e = o.blinkPhase === 0 ? o.effA : o.effB;
    lines.push({ s: `E${e + 1} · ${epochLabel(lang, e)}`, c: '#DCE6F5' });
  } else lines.push({ s: t('hud.dates', { a: epochLabel(lang, o.effA), b: epochLabel(lang, o.effB) }), c: '#DCE6F5' });
  lines.push(o.presetDef ? { s: t('hud.filter', { name: t('filter.' + o.presetDef.id + '.n') }), c: o.presetDef.color } : { s: `λ = ${lam.toFixed(3)} µm · B${o.band + 1}/102`, c: '#E3B567' });
  let bw = 0;
  lines.forEach((l) => { bw = Math.max(bw, ctx.measureText(l.s).width); });
  const lh = fs + 4;
  ctx.fillStyle = 'rgba(6,8,14,0.66)'; ctx.fillRect(8, 8, bw + 16, lines.length * lh + 8);
  ctx.strokeStyle = 'rgba(0,240,255,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(8.5, 8.5, bw + 16, lines.length * lh + 8);
  lines.forEach((l, i) => txt(ctx, l.s, 16, 8 + lh + i * lh - 1, l.c, 'left'));

  if (o.mode === 'blink') {
    const col = o.blinkPhase === 0 ? '#F0587A' : '#5B9DFF';
    const lab = `E${(o.blinkPhase === 0 ? o.effA : o.effB) + 1}`;
    ctx.fillStyle = 'rgba(6,8,14,0.7)'; ctx.fillRect(Wc - 62, 8, 54, 28);
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.strokeRect(Wc - 61.5, 8.5, 53, 27);
    ctx.font = `bold 17px ${MONO_STACK}`;
    txt(ctx, lab, Wc - 35, 29, col, 'center');
    ctx.font = `${fs}px ${MONO_STACK}`;
  }

  // --- Perde çizgisi ---
  if (o.mode === 'split') {
    const x = sx(o.curtain * W);
    if (x > -20 && x < Wc + 20) {
      ctx.strokeStyle = '#5B9DFF'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, Hc); ctx.stroke();
      ctx.fillStyle = '#06080E'; ctx.beginPath(); ctx.arc(x, Hc / 2, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      txt(ctx, '◀ ▶', x, Hc / 2 + 4, '#5B9DFF', 'center');
      txt(ctx, `A · E${o.effA + 1}`, Math.max(40, x - 10), 66, '#F0587A', 'right');
      txt(ctx, `B · E${o.effB + 1}`, Math.min(Wc - 40, x + 10), 66, '#5B9DFF', 'left');
    }
  }

  // --- Katalogdaki bilinen cisimler (isteğe bağlı) ---
  (o.knownMarks || []).forEach((m) => {
    const X = sx(m.x), Y = sy(m.y);
    if (X < -10 || X > Wc + 10 || Y < -10 || Y > Hc + 10) return;
    ctx.strokeStyle = 'rgba(124,255,178,0.75)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(X, Y - 7); ctx.lineTo(X + 7, Y); ctx.lineTo(X, Y + 7); ctx.lineTo(X - 7, Y); ctx.closePath(); ctx.stroke();
  });

  // --- Kayıtlı keşifler (kullanıcı) ---
  (o.entryMarks || []).forEach((m) => {
    const X = sx(m.x), Y = sy(m.y);
    if (X < -20 || X > Wc + 20 || Y < -20 || Y > Hc + 20) return;
    ctx.strokeStyle = m.color; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.strokeRect(X - 11, Y - 11, 22, 22); ctx.setLineDash([]);
    txt(ctx, m.label, X + 15, Y + 24, m.color, 'left');
  });

  // --- Otomatik tarama bulguları (numaralı halkalar) ---
  (o.scanMarks || []).forEach((m) => {
    const X = sx(m.x), Y = sy(m.y);
    const col = m.isNew ? '#F0587A' : '#8FE0B5';
    if (m.moved) {
      ctx.strokeStyle = col; ctx.globalAlpha = 0.7; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(sx(m.xA), sy(m.yA)); ctx.lineTo(X, Y); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(sx(m.xA), sy(m.yA), 3, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (X < -20 || X > Wc + 20 || Y < -20 || Y > Hc + 20) return;
    ctx.strokeStyle = col; ctx.lineWidth = m.sel ? 3 : 1.8;
    ctx.beginPath(); ctx.arc(X, Y, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(6,8,14,0.75)'; ctx.beginPath(); ctx.arc(X + 14, Y - 14, 8, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1; ctx.stroke();
    ctx.font = `bold ${fs - 1}px ${MONO_STACK}`;
    ctx.textAlign = 'center'; ctx.fillStyle = col; ctx.fillText(String(m.n), X + 14, Y - 14 + (fs - 1) * 0.36);
    ctx.font = `${fs}px ${MONO_STACK}`;
  });

  // --- Seçim işaretleyicisi ---
  const sd = o.selData;
  if (sd) {
    const ret = (p, color, lab) => {
      const X = sx(p.x), Y = sy(p.y);
      ctx.strokeStyle = color; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(X, Y, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(X - 24, Y); ctx.lineTo(X - 18, Y); ctx.moveTo(X + 18, Y); ctx.lineTo(X + 24, Y);
      ctx.moveTo(X, Y - 24); ctx.lineTo(X, Y - 18); ctx.moveTo(X, Y + 18); ctx.lineTo(X, Y + 24);
      ctx.stroke();
      if (lab) txt(ctx, lab, X + 18, Y - 16, color, 'left');
    };
    if (sd.type === 'object') {
      const moved = Math.hypot(sd.posB.x - sd.posA.x, sd.posB.y - sd.posA.y) * k > 6;
      if (moved) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(sx(sd.posA.x), sy(sd.posA.y)); ctx.lineTo(sx(sd.posB.x), sy(sd.posB.y)); ctx.stroke(); ctx.setLineDash([]);
        ret(sd.posA, '#F0587A', 'A'); ret(sd.posB, '#5B9DFF', 'B');
      } else ret(sd.posB, '#FFFFFF', '');
    } else ret(sd.pos, '#FFFFFF', '');
  }
  ctx.restore();
}

/* =====================================================================
   BÖLÜM 14 — "KIZILÖTESİ PARMAK İZİ": 102 bantlı SVG spektrum grafiği
   (su buzu · metan · CO₂ · CO soğurma bölgeleri etiketli)
   ===================================================================== */
const SpectrumChart = memo(function SpectrumChart({ series, yMode, bandSel, marks, onPick }) {
  const { t } = useI18n();
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);
  const VW = 430, VH = 300, pl = 44, pr = 10, pt = 46, pb = 34;
  const pw = VW - pl - pr, ph = VH - pt - pb;
  const xmin = 0.7, xmax = 5.05;
  const X = (lam) => pl + ((lam - xmin) / (xmax - xmin)) * pw;

  const geo = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    const ser = series.map((s) => {
      const pts = [];
      for (let b = 0; b < N_BANDS; b++) {
        const f = s.flux[b], e = s.err[b];
        const det = f > 3 * e;
        const y = yOf(det ? f : 3 * e, yMode);
        lo = Math.min(lo, y); hi = Math.max(hi, y);
        pts.push({ b, det, y, f, e });
      }
      return { name: s.name, color: s.color, pts };
    });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.08 + 0.15;
    return { ser, lo: lo - pad, hi: hi + pad };
  }, [series, yMode]);
  const { ser, lo, hi } = geo;
  const Y = (y) => (yMode === 'ab' ? pt + ((y - lo) / (hi - lo)) * ph : pt + ((hi - y) / (hi - lo)) * ph);
  const Yc = (y) => clamp(Y(y), pt, pt + ph);

  const ticks = [];
  if (yMode === 'ab') {
    const step = hi - lo > 10 ? 2 : 1;
    for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) ticks.push({ y: m, label: String(m) });
  } else {
    const mults = hi - lo > 2.5 ? [1] : hi - lo > 1.2 ? [1, 3] : [1, 2, 3, 5];
    for (let k = Math.floor(lo) - 1; k <= Math.ceil(hi); k++) {
      mults.forEach((mm) => {
        const yy = k + Math.log10(mm);
        if (yy < lo || yy > hi) return;
        const v = mm * Math.pow(10, k);
        ticks.push({ y: yy, label: v >= 1 ? String(Math.round(v)) : v.toFixed(Math.max(0, -k)) });
      });
    }
  }

  const onMove = (ev) => {
    const r = svgRef.current.getBoundingClientRect();
    const x = ((ev.clientX - r.left) * VW) / r.width;
    const lam = xmin + ((x - pl) / pw) * (xmax - xmin);
    if (lam < 0.74 || lam > 5.01) { setHover(null); return; }
    setHover(nearestBand(lam));
  };
  const showB = hover !== null ? hover : bandSel !== null ? bandSel : nearestBand(1.25);

  return (
    <div>
      <svg ref={svgRef} viewBox={`0 0 ${VW} ${VH}`} className="h-auto w-full cursor-crosshair select-none" onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={() => { if (hover !== null) onPick(hover); }}
        role="img" aria-label={t('spec.title')} data-testid="spectrum-svg">
        <rect x="0" y="0" width={VW} height={VH} rx="8" fill="#070B16" />
        {ticks.map((tk, i) => (
          <g key={`t${i}`}>
            <line x1={pl} x2={pl + pw} y1={Y(tk.y)} y2={Y(tk.y)} stroke="#16213a" strokeWidth="1" />
            <text x={pl - 6} y={Y(tk.y) + 3} textAnchor="end" fontSize="10.5" fill="#7F93B8" fontFamily={MONO_STACK}>{tk.label}</text>
          </g>
        ))}
        {[1, 2, 3, 4, 5].map((l) => (
          <g key={`x${l}`}>
            <line x1={X(l)} x2={X(l)} y1={pt} y2={pt + ph} stroke="#121b33" strokeWidth="1" />
            <text x={X(l)} y={pt + ph + 13} textAnchor="middle" fontSize="10.5" fill="#7F93B8" fontFamily={MONO_STACK}>{l} µm</text>
          </g>
        ))}
        {SEG_EDGES.slice(1, 6).map((l, i) => (<line key={`s${i}`} x1={X(l)} x2={X(l)} y1={pt + ph} y2={pt + ph + 4} stroke="#3a4a72" strokeWidth="1" />))}
        {/* soğurma bölgeleri: su buzu · metan · CO₂ · CO */}
        {REGIONS.map((r) => (
          <g key={r.id} data-region={r.id}>
            <rect x={X(r.lo)} y={pt} width={X(r.hi) - X(r.lo)} height={ph} fill={r.color} opacity="0.13" />
            <line x1={X(r.lo)} x2={X(r.lo)} y1={pt - 4 - r.row * 12} y2={pt + ph} stroke={r.color} strokeWidth="0.8" strokeDasharray="2 3" opacity="0.7" />
            <line x1={X(r.hi)} x2={X(r.hi)} y1={pt - 4 - r.row * 12} y2={pt + ph} stroke={r.color} strokeWidth="0.8" strokeDasharray="2 3" opacity="0.7" />
            <text x={(X(r.lo) + X(r.hi)) / 2} y={pt - 7 - r.row * 12} textAnchor={r.hi > 4.5 ? 'end' : 'middle'} dx={r.hi > 4.5 ? 8 : 0} fontSize="10" fill={r.color} fontFamily={FONT_STACK} fontWeight="600">{r.label ? t(r.label) + ' ' : ''}{r.sym}</text>
          </g>
        ))}
        {(marks || []).map((b, i) => (<rect key={`m${i}`} x={X(BAND_LAMBDA[b]) - 3} y={pt} width="6" height={ph} fill="#5B9DFF" opacity="0.14" />))}
        {bandSel !== null && (
          <g>
            <line x1={X(BAND_LAMBDA[bandSel])} x2={X(BAND_LAMBDA[bandSel])} y1={pt} y2={pt + ph} stroke="#F0587A" strokeWidth="1.5" opacity="0.9" />
            <text x={X(BAND_LAMBDA[bandSel])} y={pt + ph - 4} fontSize="10" fill="#F0587A" fontFamily={MONO_STACK} textAnchor={BAND_LAMBDA[bandSel] > 4.3 ? 'end' : 'start'} dx={BAND_LAMBDA[bandSel] > 4.3 ? -3 : 3}>B{bandSel + 1}</text>
          </g>
        )}
        {hover !== null && (<line x1={X(BAND_LAMBDA[hover])} x2={X(BAND_LAMBDA[hover])} y1={pt} y2={pt + ph} stroke="#DCE6F5" strokeWidth="1" opacity="0.5" />)}
        {ser.map((s, si) => (
          <g key={`ser${si}`}>
            <path d={'M' + s.pts.map((p) => `${X(BAND_LAMBDA[p.b]).toFixed(1)} ${Yc(p.y).toFixed(1)}`).join('L')} fill="none" stroke={s.color} strokeWidth="1.2" opacity="0.7" />
            {s.pts.map((p) => {
              const x = X(BAND_LAMBDA[p.b]);
              if (!p.det) return (<path key={p.b} d={`M${x - 2.4} ${Yc(p.y) - 3}L${x + 2.4} ${Yc(p.y) - 3}L${x} ${Yc(p.y) + 1.5}Z`} fill="none" stroke={s.color} strokeWidth="0.8" opacity="0.85" />);
              const ya = yMode === 'ab' ? yOf(p.f + p.e, 'ab') : yOf(p.f + p.e, 'flux');
              const yb = yMode === 'ab' ? yOf(Math.max(p.f - p.e, 1e-9), 'ab') : yOf(Math.max(p.f - p.e, 1e-3), 'flux');
              return (
                <g key={p.b}>
                  <line x1={x} x2={x} y1={Yc(ya)} y2={Yc(yb)} stroke={s.color} strokeWidth="0.8" opacity="0.45" />
                  <circle cx={x} cy={Yc(p.y)} r="1.9" fill={s.color} />
                </g>
              );
            })}
          </g>
        ))}
        <text x="10" y={pt + ph / 2} fontSize="10.5" fill="#9FB2D6" fontFamily={MONO_STACK} transform={`rotate(-90 10 ${pt + ph / 2})`} textAnchor="middle">{yMode === 'ab' ? t('chart.ab') : 'F_ν (µJy)'}</text>
        <text x={pl + pw} y={VH - 4} fontSize="10" fill="#9FB2D6" fontFamily={FONT_STACK} textAnchor="end">{t('chart.limit')}</text>
      </svg>
      <div className="mt-1 min-h-[38px] font-mono text-[11px] leading-snug text-[#9895AA]">
        <div>B{showB + 1} · λ = {BAND_LAMBDA[showB].toFixed(3)} µm · R≈{BAND_R[showB].toFixed(0)}</div>
        <div className="flex flex-wrap gap-x-3">
          {series.map((s) => (
            <span key={s.name}><span style={{ color: s.color }}>●</span> {s.name}: {s.flux[showB].toFixed(s.flux[showB] < 10 ? 3 : 1)} ± {s.err[showB].toFixed(2)} µJy · AB {fmtN(abOf(s.flux[showB]), 2)}</span>
          ))}
        </div>
      </div>
    </div>
  );
});


/* =====================================================================
   v3.5 — ORTAK YAKINLAŞTIRMA / KAYDIRMA  (Gökyüzü · IRSA tuvalleri; Keşif Haritası kendi görünümünü kullanır)
   view = { z, cx, cy }: z ≥ 1 yakınlaştırma; (cx, cy) ekranın ortasındaki görüntü noktası (görüntünün [0,1] kesri)
   Fare tekeri (imleç sabit kalır) · sürükle · iki parmakla sıkıştır · çift tık ×2 · +/−/0 tuşları
   ===================================================================== */
const ZP_MAX = 24;
const ZP_HOME = { z: 1, cx: 0.5, cy: 0.5 };
const zpNorm = (v, max = ZP_MAX) => {
  const z = clamp(v.z, 1, max);
  const h = 0.5 / z;
  return { z, cx: clamp(v.cx, h, 1 - h), cy: clamp(v.cy, h, 1 - h) };
};
const zpToImg = (v, u, w) => ({ x: (u - 0.5) / v.z + v.cx, y: (w - 0.5) / v.z + v.cy });       // ekran kesri → görüntü kesri
const zpToScr = (v, x, y) => ({ u: (x - v.cx) * v.z + 0.5, w: (y - v.cy) * v.z + 0.5 });       // görüntü kesri → ekran kesri

// Tekerlek/izdüşüm kaydırması orantılı: bir tekerlek adımı (≈100) ≈ ×1.22, hassas dokunmatik kaydırma çok daha küçük adımlar
function wheelFactor(ev) {
  const d = clamp(-(ev.deltaY || 0) * (ev.deltaMode === 1 ? 16 : 1), -300, 300);
  return Math.exp(d * 0.002);
}
// Dokunmatik: yakınlaşmamışken tek parmakla dikey kaydırma sayfaya aittir (kaydırma tuzağı olmaz); yakınlaşınca tuval sürüklemeyi alır
const zpTouch = (z) => (z > 1.001 ? 'none' : 'pan-y');
// Çift dokunuş (dokunmatikte dblclick güvenilmez) — aynı konuma 320 ms içinde ikinci dokunuş
function makeDoubleTap(cb) {
  let last = null;
  const f = (ev) => {
    if (ev.pointerType !== 'touch') return false;
    const now = ev.timeStamp || Date.now();
    if (last && now - last.t < 320 && Math.hypot(ev.clientX - last.x, ev.clientY - last.y) < 32) { last = null; f.at = now; cb(ev); return true; }
    last = { t: now, x: ev.clientX, y: ev.clientY };
    return false;
  };
  f.at = -1e9;
  return f;
}
function useZoomPan(canvasRef, { enabled = true, max = ZP_MAX } = {}) {
  const [view, setViewS] = useState(ZP_HOME);
  const vr = useRef(ZP_HOME);
  const moved = useRef(false);
  const setView = useCallback((v) => { const n = zpNorm(v, max); vr.current = n; setViewS(n); }, [max]);
  const zoomAt = useCallback((f, u = 0.5, w = 0.5) => {
    const v = vr.current;
    const nz = clamp(v.z * f, 1, max);
    if (nz === v.z) return;
    const p = zpToImg(v, u, w);
    setView({ z: nz, cx: p.x - (u - 0.5) / nz, cy: p.y - (w - 0.5) / nz });
  }, [max, setView]);
  const reset = useCallback(() => setView(ZP_HOME), [setView]);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !enabled) return undefined;
    const pts = new Map();
    let drag = null; let pinch = null;
    const rect = () => el.getBoundingClientRect();
    const onWheel = (ev) => { ev.preventDefault(); const r = rect(); zoomAt(wheelFactor(ev), (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height); };
    const onDown = (ev) => {
      if (ev.pointerType === 'mouse' && ev.button > 0) return;
      try { el.setPointerCapture(ev.pointerId); } catch (e) { /* yoksay */ }
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pts.size === 1) { drag = { x: ev.clientX, y: ev.clientY, v: vr.current, moved: false }; moved.current = false; }
      else if (pts.size === 2) {
        const [a, b] = Array.from(pts.values()); const r = rect();
        pinch = { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), v: vr.current, u: ((a.x + b.x) / 2 - r.left) / r.width, w: ((a.y + b.y) / 2 - r.top) / r.height };
        drag = null; moved.current = true;
      }
    };
    const onMove = (ev) => {
      if (!pts.has(ev.pointerId)) return;
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const r = rect();
      if (pinch && pts.size >= 2) {
        const [a, b] = Array.from(pts.values());
        const nz = clamp(pinch.v.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), 1, max);
        const u = ((a.x + b.x) / 2 - r.left) / r.width; const w = ((a.y + b.y) / 2 - r.top) / r.height;
        const p0 = zpToImg(pinch.v, pinch.u, pinch.w);
        setView({ z: nz, cx: p0.x - (u - 0.5) / nz, cy: p0.y - (w - 0.5) / nz });
        return;
      }
      if (drag) {
        const dx = ev.clientX - drag.x; const dy = ev.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; moved.current = true; }
        if (drag.moved && drag.v.z > 1) setView({ z: drag.v.z, cx: drag.v.cx - dx / (r.width * drag.v.z), cy: drag.v.cy - dy / (r.height * drag.v.z) });
      }
    };
    const onUp = (ev) => {
      const wasMoved = drag ? drag.moved : true;
      pts.delete(ev.pointerId);
      if (!wasMoved && pts.size === 0 && ev.type === 'pointerup') dtap(ev);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) drag = null;
      else if (pts.size === 1 && !drag) { const [a] = Array.from(pts.values()); drag = { x: a.x, y: a.y, v: vr.current, moved: true }; }
    };
    const onDbl = (ev) => { if ((ev.timeStamp || 0) - dtap.at < 600) return; const r = rect(); if (vr.current.z >= max * 0.99) reset(); else zoomAt(2, (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height); };
    const dtap = makeDoubleTap((ev) => { const r = rect(); if (vr.current.z >= max * 0.99) reset(); else zoomAt(2, (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height); });
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('dblclick', onDbl);
    return () => {
      el.removeEventListener('wheel', onWheel); el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp); el.removeEventListener('dblclick', onDbl);
    };
  }, [canvasRef, enabled, max, zoomAt, reset, setView]);
  return { view, viewRef: vr, setView, zoomAt, reset, moved };
}

// Tuvalin üstünde yüzen + / − / sığdır düğmeleri ve yakınlaştırma düzeyi
function ZoomButtons({ prefix, z, max = ZP_MAX, onIn, onOut, onReset }) {
  const { t } = useI18n();
  const ex = useContext(ExpandCtx);
  const B = (id, label, glyph, fn, off) => (<button key={id} type="button" className="zp-btn" data-testid={`${prefix}-zoom-${id}`} aria-label={label} title={label} disabled={off} onClick={fn}>{glyph}</button>);
  return (
    <div className="zp-ctl" data-testid={`${prefix}-zoom`} role="group" aria-label={t('zp.group')}>
      {B('in', t('ctl.zoomIn'), '+', onIn, z >= max - 0.01)}
      <span className="zp-lvl" data-testid={`${prefix}-zoom-level`} title={t('zp.hint')}>×{z < 10 ? z.toFixed(1) : Math.round(z)}</span>
      {B('out', t('ctl.zoomOut'), '−', onOut, z <= 1.001)}
      {B('reset', t('ctl.reset'), '⊡', onReset, z <= 1.001)}
      {ex && (
        <button type="button" className="zp-btn zp-expand" data-testid={`${ex.testId}-expand`} aria-pressed={ex.full} onClick={ex.toggle}
          aria-label={ex.full ? t('zp.collapse') : t('zp.expand')} title={ex.full ? t('zp.collapse') : t('zp.expand')}>{ex.full ? '⤡' : '⤢'}</button>
      )}
    </div>
  );
}
function ZoomCtl({ prefix, zp }) {
  return <ZoomButtons prefix={prefix} z={zp.view.z} onIn={() => zp.zoomAt(1.5)} onOut={() => zp.zoomAt(1 / 1.5)} onReset={zp.reset} />;
}
/* =====================================================================
   BÖLÜM 20 — GERÇEK SPHEREx VERİSİ: ortak yardımcılar · grafikler · "Nedeni:" açıklamaları
   ===================================================================== */
const DET_COLORS = { D1: '#8FE0B5', D2: '#5B9DFF', D3: '#4D8BFF', D4: '#8DB9FF', D5: '#E3B567', D6: '#F0587A' };
const detColor = (d) => DET_COLORS[d] || '#9AA7BD';
const REAL_MODES = [{ id: 'movie', emoji: '▶' }, { id: 'single', emoji: '▣' }, { id: 'blink', emoji: '◐' }, { id: 'diff', emoji: '◇' }, { id: 'sum', emoji: 'Σ' }, { id: 'rgb', emoji: '◍' }];
const rnd = (v, d) => (typeof v === 'number' && isFinite(v) ? Number(v.toFixed(d)) : null);
const slugOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'target';
const dayOf = (iso) => String(iso || '').slice(0, 10);
const fmtMu = (v) => (typeof v === 'number' && isFinite(v) ? (v >= 1 ? v.toFixed(2) : v.toFixed(3)) : '—');
const expLam = (e) => (e && e.wave ? e.wave((e.w + 1) / 2, (e.h + 1) / 2).lam : NaN);
// Dalga boyuna göre ışık rengi (kısa: mavi-beyaz → uzun: kırmızı)
function lamTint(lam) {
  if (!isFinite(lam)) return [1, 1, 1];
  const u = clamp((lam - 0.75) / 4.25, 0, 1);
  return [0.55 + 0.45 * Math.min(1, u * 2.2), 0.82 - 0.38 * u + 0.18 * Math.min(1, u * 2), 1 - 0.65 * u];
}

// Yapısal sonuç → kalıcı kayıt gövdesi (yalnız sayılar; metinler görüntülenirken seçili dile çevrilir)
function buildRealPayload(o) {
  const { target, diag, meas, opts, base, source } = o;
  const mo = diag.motion;
  const tp = diag.topPair;
  return {
    version: 1, release: 'SPHEREx Level-2 · NASA/IPAC IRSA', source, fetchedAt: new Date().toISOString(), base,
    target: { name: target.name, ra: target.ra, dec: target.dec, pmra: target.pmra || 0, pmdec: target.pmdec || 0, epoch: target.epoch || 2000 },
    opts: { rAp: opts.rAp, useMask: opts.useMask },
    nExp: diag.nExp, nDet: diag.nDet, nMasked: diag.nMasked, nOutside: diag.nOutside, nFaint: diag.nFaint, lamMin: rnd(diag.lamMin, 3), lamMax: rnd(diag.lamMax, 3),
    meas: meas.map((m) => ({ did: m.did || '', det: m.det, mjd: rnd(m.mjd, 5), iso: m.iso, status: m.status, lam: rnd(m.lam, 4), bw: rnd(m.bw, 4), flux: rnd(m.flux, 3), err: rnd(m.err, 3), snr: rnd(m.snr, 1), ra: rnd(m.ra, 7), dec: rnd(m.dec, 7), off: rnd(m.offArcsec, 2) })),
    motion: mo.valid
      ? { valid: true, n: mo.n, baselineDays: rnd(mo.baselineDays, 1), mua: rnd(mo.mua, 4), mud: rnd(mo.mud, 4), mu: rnd(mo.mu, 4), pa: rnd(mo.pa, 1), sigMu: rnd(mo.sigMu, 4), sigma: rnd(mo.sigma, 1), chi2red: rnd(mo.chi2red, 2), cat: mo.cat ? { mu: rnd(mo.cat.mu, 4) } : null, dSigma: rnd(mo.dSigma, 1) }
      : { valid: false, n: mo.n || 0 },
    sed: diag.sed ? { T: diag.sed.T, chi2red: rnd(diag.sed.chi2red, 2), n: diag.sed.n } : null,
    verdict: diag.verdict, varFlag: !!diag.varFlag,
    topPair: tp ? { ratio: rnd(tp.ratio, 3), sig: rnd(tp.sig, 1), lamA: rnd(tp.a.lam, 3), lamB: rnd(tp.b.lam, 3), dDays: rnd(tp.dDays, 0), det: tp.a.det } : null,
  };
}

// Kataloğa kaydedilecek kayıt taslağı (makeEntryDraft ile aynı alanlar + real gövdesi)
function makeRealDraft(o) {
  const { target, diag, meas, opts, base, source, cat, userNote } = o;
  const payload = buildRealPayload({ target, diag, meas, opts, base, source });
  const det = meas.filter((m) => m.status === 'detected');
  const last = det.length ? det[det.length - 1] : meas[meas.length - 1];
  const pos = propagate(target, last ? last.year : 2026);
  return {
    objKey: `real:${slugOf(target.name)}`, srcId: null, sectorId: 'real', sectorKey: 'real', custom: null,
    ra: pos.ra, dec: pos.dec, x: 0, y: 0, cat, kind: null, srcCls: '',
    guessId: 'other', guessKey: 'blank', Tc: diag.sed ? diag.sed.T : null,
    known: false, knownId: null, eA: 0, eB: 1, gain: 0, firstEpoch: 0, reason: null, userNote: userNote || '',
    hidden: false, truth: null, qra: pos.ra, qdec: pos.dec, searchRadius: 8, epochIso: last ? dayOf(last.iso) : dayOf(new Date().toISOString()),
    name: target.name, real: payload,
  };
}

// Yapısal gerçek-veri sonucundan okunabilir "ne oldu / Nedeni:" maddeleri (explainReason ile aynı biçim)
function realExplain(t, rp) {
  const items = [];
  if (!rp) return { items, plain: '' };
  const mo = rp.motion || { valid: false, n: 0 };
  if (rp.verdict === 'pm-confirmed') {
    items.push({ kind: 'move', emoji: '✓', head: t('real.why.head.pm', { mu: fmtMu(mo.mu), pa: fx(mo.pa, 0), sig: fx(mo.sigma, 0), n: mo.n, days: fx(mo.baselineDays, 0) }),
      measured: t('real.why.cat', { catMu: fmtMu(mo.cat && mo.cat.mu), dsig: fx(mo.dSigma, 1) }), cause: t('real.why.pm') });
  } else if (rp.verdict === 'pm-differs') {
    items.push({ kind: 'move', emoji: '◆', head: t('real.why.head.pmdiff', { mu: fmtMu(mo.mu), catMu: fmtMu(mo.cat && mo.cat.mu), dsig: fx(mo.dSigma, 1) }),
      measured: t('real.why.head.pm', { mu: fmtMu(mo.mu), pa: fx(mo.pa, 0), sig: fx(mo.sigma, 0), n: mo.n, days: fx(mo.baselineDays, 0) }), cause: t('real.why.pmdiff') });
  } else if (rp.verdict === 'moving-unexpected') {
    items.push({ kind: 'move', emoji: '◉', head: t('real.why.head.pm', { mu: fmtMu(mo.mu), pa: fx(mo.pa, 0), sig: fx(mo.sigma, 0), n: mo.n, days: fx(mo.baselineDays, 0) }),
      measured: '', cause: t('real.why.unexpected') });
  } else if (rp.verdict === 'static') {
    items.push({ kind: 'none', emoji: '○', head: t('real.why.head.static', { n: mo.n, mu: fmtMu(mo.mu), sig: fx(mo.sigma, 1) }), measured: '', cause: t('real.why.static') });
  } else {
    items.push({ kind: 'none', emoji: '◌', head: t('real.why.head.insufficient', { n: rp.nDet }), measured: '', cause: t('real.why.insufficient') });
  }
  if (rp.varFlag && rp.topPair) {
    const p = rp.topPair;
    items.push({ kind: 'spec', emoji: '◐', head: t('real.why.head.var', { lamA: fx(p.lamA, 2), lamB: fx(p.lamB, 2), days: fx(p.dDays, 0), ratio: fx(p.ratio, 2), pct: sgn((p.ratio - 1) * 100, 0), sig: fx(p.sig, 0) }), measured: '', cause: t('real.why.var') });
  }
  if (rp.sed) {
    const T = rp.sed.T;
    const key = T < 1600 ? 'cool' : T < 2900 ? 'mid' : T < 4700 ? 'warm' : 'hot';
    items.push({ kind: 'spec', emoji: '❅', head: t('real.why.head.sed', { T: Math.round(T / 50) * 50, n: rp.sed.n }), measured: '', cause: t('real.why.sed.' + key) });
  }
  if (rp.source === 'demo') items.forEach((i) => { if (i.kind !== 'spec') i.cause = t('real.demo.why'); });   // simülasyon: "gerçek görüntülerden ölçüldü" iddiası taşınmaz
  const plain = items.map((i) => `${i.head}${i.measured ? ' ' + i.measured : ''}\n${t('why.cause')} ${i.cause}`).join('\n');
  return { items, plain };
}

/* ---------------- Gerçek SED grafiği (F_ν, µJy) ---------------- */
const RealSedChart = memo(function RealSedChart({ pts, fit, testId = 'real-sed' }) {
  const { t } = useI18n();
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);
  const VW = 430, VH = 270, pl = 46, pr = 10, pt = 12, pb = 34;
  const pw = VW - pl - pr, ph = VH - pt - pb;
  const xmin = 0.7, xmax = 5.05;
  const X = (l) => pl + ((l - xmin) / (xmax - xmin)) * pw;
  const good = useMemo(() => pts.filter((p) => (p.status === 'detected' || p.status === 'marginal') && p.flux > 0 && isFinite(p.lam)), [pts]);
  const geo = useMemo(() => {
    const ys = [];
    good.forEach((p) => { ys.push(Math.max(p.flux - p.err, p.flux * 0.35)); ys.push(p.flux + p.err); });
    let lo = ys.length ? Math.log10(Math.min(...ys)) : 0;
    let hi = ys.length ? Math.log10(Math.max(...ys)) : 1;
    const pad = Math.max(0.12, (hi - lo) * 0.12);
    lo -= pad; hi += pad;
    return { lo, hi };
  }, [good]);
  const { lo, hi } = geo;
  const Y = (f) => pt + ((hi - Math.log10(Math.max(f, 1e-6))) / (hi - lo)) * ph;
  const ticks = [];
  const mults = hi - lo > 2.5 ? [1] : hi - lo > 1.2 ? [1, 3] : [1, 2, 5];
  for (let k = Math.floor(lo) - 1; k <= Math.ceil(hi); k++) {
    mults.forEach((mm) => {
      const v = mm * Math.pow(10, k);
      const yy = Math.log10(v);
      if (yy < lo || yy > hi) return;
      ticks.push({ y: Y(v), label: v >= 1000 ? `${(v / 1000).toString()}k` : v >= 1 ? String(Math.round(v)) : v.toFixed(Math.max(0, -k)) });
    });
  }
  let curve = '';
  if (fit && fit.T && fit.A) {
    let pen = false;
    for (let l = 0.75; l <= 5.0001; l += 0.05) {
      const f = fit.A * nu(l, fit.T);
      const y = Y(f);
      if (!(f > 0) || y < pt - 2 || y > pt + ph + 2) { pen = false; continue; }
      curve += `${pen ? 'L' : 'M'}${X(l).toFixed(1)} ${y.toFixed(1)}`;
      pen = true;
    }
  }
  const dets = Array.from(new Set(good.map((p) => p.det))).sort();
  const onMove = (ev) => {
    if (!svgRef.current || !good.length) return;
    const r = svgRef.current.getBoundingClientRect();
    const mx = ((ev.clientX - r.left) * VW) / r.width;
    let bi = -1;
    let bd = 16;
    good.forEach((p, i) => { const d = Math.abs(X(p.lam) - mx); if (d < bd) { bd = d; bi = i; } });
    setHover(bi >= 0 ? bi : null);
  };
  const hp = hover !== null ? good[hover] : null;
  return (
    <div>
      <svg ref={svgRef} viewBox={`0 0 ${VW} ${VH}`} className="h-auto w-full select-none" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={t('real.sed.title')} data-testid={testId}>
        <rect x="0" y="0" width={VW} height={VH} rx="8" fill="#070B16" />
        {ticks.map((tk, i) => (
          <g key={`t${i}`}>
            <line x1={pl} x2={pl + pw} y1={tk.y} y2={tk.y} stroke="#16213a" strokeWidth="1" />
            <text x={pl - 6} y={tk.y + 3} textAnchor="end" fontSize="10.5" fill="#7F93B8" fontFamily={MONO_STACK}>{tk.label}</text>
          </g>
        ))}
        {[1, 2, 3, 4, 5].map((l) => (
          <g key={`x${l}`}>
            <line x1={X(l)} x2={X(l)} y1={pt} y2={pt + ph} stroke="#121b33" strokeWidth="1" />
            <text x={X(l)} y={pt + ph + 13} textAnchor="middle" fontSize="10.5" fill="#7F93B8" fontFamily={MONO_STACK}>{l} µm</text>
          </g>
        ))}
        {SEG_EDGES.slice(1, 6).map((l, i) => (<line key={`s${i}`} x1={X(l)} x2={X(l)} y1={pt + ph} y2={pt + ph + 4} stroke="#3a4a72" strokeWidth="1" />))}
        {REGIONS.map((r) => (<rect key={r.id} x={X(r.lo)} y={pt} width={X(r.hi) - X(r.lo)} height={ph} fill={r.color} opacity="0.1" />))}
        {curve ? <path d={curve} fill="none" stroke="#E3B567" strokeWidth="1.4" strokeDasharray="4 3" opacity="0.9" data-testid="real-sed-fit" /> : null}
        {good.map((p, i) => {
          const x = X(p.lam);
          const col = detColor(p.det);
          const ya = Y(p.flux + p.err);
          const yb = Y(Math.max(p.flux - p.err, p.flux * 0.35));
          return (
            <g key={i} data-testid="real-sed-pt">
              <line x1={x} x2={x} y1={ya} y2={yb} stroke={col} strokeWidth="1.1" opacity="0.7" />
              <circle cx={x} cy={Y(p.flux)} r={hover === i ? 4.4 : 3.2} fill={p.status === 'marginal' ? 'none' : col} stroke={col} strokeWidth="1.3" />
            </g>
          );
        })}
        <text x="10" y={pt + ph / 2} fontSize="10.5" fill="#9FB2D6" fontFamily={MONO_STACK} transform={`rotate(-90 10 ${pt + ph / 2})`} textAnchor="middle">F_ν (µJy)</text>
        {!good.length && <text x={VW / 2} y={VH / 2} textAnchor="middle" fontSize="12" fill="#6F82A8" fontFamily={FONT_STACK}>{t('real.sed.empty')}</text>}
      </svg>
      <div className="mt-1 min-h-[36px] font-mono text-[11px] leading-snug text-[#9895AA]">
        {hp ? (<div>{hp.det} · λ = {hp.lam.toFixed(3)} µm · {fx(hp.flux, hp.flux < 10 ? 2 : 1)} ± {fx(hp.err, 2)} µJy · AB {fmtN(abOf(hp.flux), 2)} · {dayOf(hp.iso)}</div>)
          : <div className="flex flex-wrap gap-x-3">{dets.map((d) => (<span key={d}><span style={{ color: detColor(d) }}>●</span> {d}</span>))}{fit ? <span><span className="text-[#E3B567]">┄</span> {t('real.sed.planck', { T: Math.round(fit.T / 50) * 50 })}</span> : null}</div>}
      </div>
    </div>
  );
});

/* ---------------- Konum izi: doğu/kuzey ofsetleri + doğrusal uyum ---------------- */
const RealTrackChart = memo(function RealTrackChart({ motion }) {
  const { t } = useI18n();
  const VW = 300, VH = 270, pad = 34;
  const tr = motion && motion.valid ? motion.track : null;
  if (!tr || !tr.length) return null;
  const tmin = Math.min(...tr.map((p) => p.t));
  const tmax = Math.max(...tr.map((p) => p.t));
  const line = (get) => [tmin, tmax].map((tt) => get(tt));
  const fx0 = (tt) => motion.fitA.icpt + motion.fitA.slope * (tt - motion.tMean);
  const fy0 = (tt) => motion.fitD.icpt + motion.fitD.slope * (tt - motion.tMean);
  const catLine = motion.cat ? [tmin, tmax].map((tt) => ({ dx: fx0(motion.tMean) + motion.cat.mua * (tt - motion.tMean), dy: fy0(motion.tMean) + motion.cat.mud * (tt - motion.tMean) })) : null;
  const all = tr.map((p) => ({ dx: p.dx, dy: p.dy })).concat(line(fx0).map((x, i) => ({ dx: x, dy: line(fy0)[i] })));
  if (catLine) catLine.forEach((c) => all.push(c));
  const cx = (Math.min(...all.map((p) => p.dx)) + Math.max(...all.map((p) => p.dx))) / 2;
  const cy = (Math.min(...all.map((p) => p.dy)) + Math.max(...all.map((p) => p.dy))) / 2;
  const half = Math.max(1.5, ...all.map((p) => Math.max(Math.abs(p.dx - cx), Math.abs(p.dy - cy)))) * 1.25 + Math.max(...tr.map((p) => p.s));
  const S = (VW - 2 * pad) / (2 * half);
  const PX = (dx) => VW / 2 - (dx - cx) * S;                      // doğu solda
  const PY = (dy) => VH / 2 - 8 - (dy - cy) * S;                  // kuzey yukarıda
  const col = (tt) => { const u = tmax > tmin ? (tt - tmin) / (tmax - tmin) : 0; return `rgb(${Math.round(0 + 255 * u)},${Math.round(240 - 189 * u)},${Math.round(255 - 153 * u)})`; };
  const step = half > 40 ? 20 : half > 15 ? 10 : half > 6 ? 5 : half > 2.5 ? 2 : 1;
  const barPx = step * S;
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="h-auto w-full select-none" role="img" aria-label={t('real.track.title')} data-testid="real-track">
      <rect x="0" y="0" width={VW} height={VH} rx="8" fill="#070B16" />
      <line x1={PX(cx)} x2={PX(cx)} y1="10" y2={VH - 30} stroke="#121b33" strokeWidth="1" />
      <line x1="10" x2={VW - 10} y1={PY(cy)} y2={PY(cy)} stroke="#121b33" strokeWidth="1" />
      {catLine && <line x1={PX(catLine[0].dx)} y1={PY(catLine[0].dy)} x2={PX(catLine[1].dx)} y2={PY(catLine[1].dy)} stroke="#E3B567" strokeWidth="2" strokeDasharray="5 4" opacity="0.9" data-testid="real-track-cat" />}
      <line x1={PX(fx0(tmin))} y1={PY(fy0(tmin))} x2={PX(fx0(tmax))} y2={PY(fy0(tmax))} stroke="#DCE6F5" strokeWidth="1.2" opacity="0.7" />
      {tr.map((p, i) => (
        <g key={i} data-testid="real-track-pt">
          <circle cx={PX(p.dx)} cy={PY(p.dy)} r={Math.max(2, p.s * S)} fill="none" stroke={col(p.t)} strokeWidth="0.8" opacity="0.5" />
          <circle cx={PX(p.dx)} cy={PY(p.dy)} r="3.2" fill={col(p.t)} />
        </g>
      ))}
      <g transform={`translate(${VW - 12 - barPx}, ${VH - 34})`}>
        <line x1="0" x2={barPx} y1="0" y2="0" stroke="#9FB2D6" strokeWidth="1.5" />
        <text x={barPx / 2} y="-4" textAnchor="middle" fontSize="10" fill="#9FB2D6" fontFamily={MONO_STACK}>{step}″</text>
      </g>
      <g transform="translate(14,16)" fontFamily={MONO_STACK} fontSize="10" fill="#9FB2D6">
        <text x="0" y="0">N↑  E←</text>
      </g>
      <rect x="14" y={VH - 20} width="90" height="5" rx="2.5" fill="url(#rtg)" />
      <defs><linearGradient id="rtg" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#5B9DFF" /><stop offset="1" stopColor="#F0587A" /></linearGradient></defs>
      <text x="14" y={VH - 24} fontSize="9.5" fill="#7F93B8" fontFamily={MONO_STACK}>{tmin.toFixed(2)}</text>
      <text x="104" y={VH - 24} fontSize="9.5" fill="#7F93B8" fontFamily={MONO_STACK} textAnchor="end">{tmax.toFixed(2)}</text>
    </svg>
  );
});

/* ---------------- Pozlama tablosu ---------------- */
function RealTable({ meas, onPick, sel }) {
  const { t } = useI18n();
  const colr = { detected: '#8FE0B5', marginal: '#E3B567', faint: '#6F82A8', masked: '#F0587A', outside: '#6F82A8', nophot: '#6F82A8' };
  return (
    <div className="spx-scroll max-h-[260px] overflow-auto rounded-none border border-white/10" data-testid="real-table">
      <table className="w-full min-w-[420px] border-collapse text-left font-mono text-[10.5px] text-[#EEF3FD]">
        <thead className="sticky top-0  text-[#93A6CC]"><tr>
          <th className="px-1.5 py-1">#</th><th className="px-1.5 py-1">{t('real.tb.date')}</th><th className="px-1.5 py-1">{t('real.tb.det')}</th><th className="px-1.5 py-1">λ µm</th><th className="px-1.5 py-1">F µJy</th><th className="px-1.5 py-1">SNR</th><th className="px-1.5 py-1">{t('real.tb.status')}</th>
        </tr></thead>
        <tbody>
          {meas.map((m, i) => (
            <tr key={i} data-testid="real-tr" onClick={onPick ? () => onPick(i) : undefined} className={`${onPick ? 'cursor-pointer ' : ''} ${sel === i ? '' : ''} border-t border-white/10`}>
              <td className="px-1.5 py-1 text-[#667BA3]">{i + 1}</td>
              <td className="px-1.5 py-1">{dayOf(m.iso)}</td>
              <td className="px-1.5 py-1" style={{ color: detColor(m.det) }}>{m.det}</td>
              <td className="px-1.5 py-1">{typeof m.lam === 'number' && isFinite(m.lam) ? m.lam.toFixed(3) : '—'}</td>
              <td className="px-1.5 py-1">{typeof m.flux === 'number' && isFinite(m.flux) ? `${m.flux.toFixed(m.flux < 10 ? 2 : 1)}±${typeof m.err === 'number' ? m.err.toFixed(m.err < 10 ? 2 : 1) : '—'}` : '—'}</td>
              <td className="px-1.5 py-1">{typeof m.snr === 'number' && isFinite(m.snr) ? m.snr.toFixed(0) : '—'}</td>
              <td className="px-1.5 py-1" style={{ color: colr[m.status] || '#DCE6F5' }}>{t('real.st.' + m.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Kabul metni · veri kredisi ---------------- */
function RealCredit({ compact }) {
  const { t } = useI18n();
  return (
    <div className="space-y-1.5 text-[10.5px] leading-snug text-[#667BA3]" data-testid="real-credit">
      <p>{t('real.credit.lead')} <i>“{SPHEREX_ACK}”</i></p>
      <p>{t('real.credit.note')}</p>
      {!compact && (
        <p className="flex flex-wrap gap-x-3 gap-y-0.5">
          <a className="inline-flex items-center gap-1 text-[color:var(--acc)] hover:underline" href="https://doi.org/10.26131/IRSA652" target="_blank" rel="noreferrer">DOI 10.26131/IRSA652 (QR2)<span aria-hidden>↗</span></a>
          <a className="inline-flex items-center gap-1 text-[color:var(--acc)] hover:underline" href="https://doi.org/10.26131/IRSA662" target="_blank" rel="noreferrer">DOI 10.26131/IRSA662 (QR3)<span aria-hidden>↗</span></a>
          <a className="inline-flex items-center gap-1 text-[color:var(--acc)] hover:underline" href="https://irsa.ipac.caltech.edu/Missions/spherex.html" target="_blank" rel="noreferrer">NASA/IPAC IRSA · SPHEREx<span aria-hidden>↗</span></a>
        </p>
      )}
    </div>
  );
}

/* ---------------- Katalog ayrıntısı: kayıtlı gerçek SPHEREx ölçümü ---------------- */
function RealEntryDetail({ app, entry }) {
  const { t, lang } = app;
  const rp = entry.real;
  const ex = useMemo(() => realExplain(t, rp), [t, rp]);
  const [open, setOpen] = useState(false);
  const mo = rp.motion || {};
  const fit = rp.sed ? { T: rp.sed.T, A: (() => {                           // kayıtlı noktalardan ölçek yeniden hesapla
    const g = rp.meas.filter((m) => m.status === 'detected' && m.flux > 0 && m.err > 0 && isFinite(m.lam));
    let num = 0; let den = 0;
    g.forEach((m) => { const mm = nu(m.lam, rp.sed.T); const w = 1 / (m.err * m.err); num += w * mm * m.flux; den += w * mm * mm; });
    return den > 0 ? num / den : 0;
  })() } : null;
  const aladin = `https://aladin.cds.unistra.fr/AladinLite/?target=${encodeURIComponent(entry.ra.toFixed(5) + ' ' + (entry.dec >= 0 ? '+' : '') + entry.dec.toFixed(5))}&fov=0.2&survey=${encodeURIComponent('CDS/P/SPHEREx/QR2/color')}`;
  return (
    <>
      <Card title={t('real.cat.title')} tip="tip.real.cat" icon={<span>1</span>}>
        <div className="ed-mono mb-3 text-[10.5px] text-[#93A6CC]" data-testid="real-entry-meta">
          {t('real.cat.meta', { name: rp.target.name, n: rp.nExp, d: rp.nDet })} · {fmtTs(lang, rp.fetchedAt)}
        </div>
        <div className="space-y-3" data-testid="detail-reasons">
          {ex.items.map((it, i) => (
            <div key={i} className="ed-reason">
              <div className="text-[13px] leading-snug text-[#F5F8FF]"><span aria-hidden style={{ color: 'var(--acc)' }}>{it.emoji}</span> {it.head}</div>
              {it.measured ? <div className="ed-mono mt-1 text-[10.5px] leading-snug text-[#9895AA]">{it.measured}</div> : null}
              <div className="mt-1.5 text-[12px] leading-relaxed text-[#C9C6D6]"><b className="font-medium text-[#E3B567]">{t('why.cause')}</b> {it.cause}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-5">
          <Stat label={t('real.st.mu')} value={mo.valid ? `${fmtMu(mo.mu)}″/yr` : '—'} sub={mo.valid ? `PA ${fx(mo.pa, 0)}° · ${fx(mo.sigma, 0)}σ` : ''} color="#A9C4F5" />
          <Stat label={t('real.st.cat')} value={mo.cat ? `${fmtMu(mo.cat.mu)}″/yr` : '—'} sub={mo.valid && mo.cat ? `Δ ${fx(mo.dSigma, 1)}σ` : ''} color="#E3B567" />
          <Stat label={t('real.st.lamRange')} value={isFinite(rp.lamMin) && rp.lamMin ? `${fx(rp.lamMin, 2)}–${fx(rp.lamMax, 2)} µm` : '—'} sub={t('real.st.counts', { n: rp.nDet, m: rp.nExp })} />
          <Stat label={t('real.st.T')} value={rp.sed ? `${Math.round(rp.sed.T / 50) * 50} K` : '—'} sub={rp.sed ? t('real.st.Tsub', { n: rp.sed.n }) : ''} color="#F0587A" />
        </div>
      </Card>
      <Card title={t('real.sed.title')} tip="tip.real.sed" icon={<span>2</span>}>
        <RealSedChart pts={rp.meas} fit={fit} testId="real-entry-sed" />
      </Card>
      <Disclosure title={t('real.table.title')} tip="tip.real.table" open={open} onToggle={() => setOpen((o) => !o)} testId="real-entry-table-toggle">
        <RealTable meas={rp.meas} />
      </Disclosure>
      <section className="ed-sec">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" data-testid="open-in-real" onClick={() => app.requestReal({ ...rp.target, source: 'catalog' })} className="ed-btn ed-go is-primary flex-1">{t('real.cat.open')}</button>
          <InfoTip id="tip.real.cat.open" title={t('real.cat.open')} />
          <a href={aladin} target="_blank" rel="noreferrer" className="ed-link" style={{ color: 'var(--acc)' }}>Aladin ↗</a>
        </div>
      </section>
      <RealCredit compact />
    </>
  );
}

/* =====================================================================
   BÖLÜM 21 — GERÇEK SPHEREx VERİSİ SEKME GÖRÜNÜMÜ  (IRSA'dan canlı · FITS yükleme · analiz)
   ===================================================================== */
const DEFAULT_REAL_OPTS = { perDet: 2, sizeArcmin: 6, rAp: 2.5, useMask: true, stretch: 1.3, thr: 3 };
const IRSA_EXPLORER = 'https://irsa.ipac.caltech.edu/applications/spherex';
const MV_FPS = [1, 2, 4, 8, 12];                     // video oynatma hızları (kare/sn)
const SUM_OPS = ['ab', 'all', 'det', 'mosaic'];
const DET_LAM_HINT = { D1: 0.9, D2: 1.35, D3: 2.0, D4: 3.1, D5: 4.1, D6: 4.7 };   // SPHEREx dedektör bantlarının yaklaşık merkezleri [µm]
const REAL_FOV_MAX = 30;                             // arcmin (PDF: kullanıcı görüş alanını seçebilsin)
// URL (?ra=&dec=) bir hazır hedefin yakınındaysa onun özdevinimini kullan (hızlı cisimler kesitin içinde kalsın)
function targetFromUrl(u) {
  if (!u || !u.target) return null;
  const hit = REAL_TARGETS.find((p) => angSepArcsec(p.ra, p.dec, u.target.ra, u.target.dec) < 120);
  if (hit) return { ...hit, source: 'url' };
  return { id: 'url', name: u.name || `${fmtRA(u.target.ra, 1)} ${fmtDec(u.target.dec, 0)}`, ra: u.target.ra, dec: u.target.dec, pmra: 0, pmdec: 0, epoch: 2000, source: 'url' };
}
const ERR_KEYS = ['NETWORK', 'HTTP', 'TIMEOUT', 'TAP_ERROR', 'NO_DATA', 'FITS_BAD', 'FITS_TRUNC', 'FITS_NOIMAGE', 'FITS_COMPRESSED', 'FITS_TIME', 'WCS_MISSING', 'WCS_PROJ', 'WCS_BAD', 'GZIP_UNSUPPORTED', 'WAVE_BAD', 'OUTSIDE'];
function toErr(e) {
  if (e && e.name === 'RealError') {
    const body = e.extra && e.extra.body ? String(e.extra.body) : '';
    if (e.code === 'HTTP' && e.extra && e.extra.status === 500 && /outside|out of|not in/i.test(body)) return { code: 'OUTSIDE', status: 500, detail: body.slice(0, 160) };
    return { code: e.code, status: e.extra && e.extra.status, detail: (body || e.message || '').slice(0, 220) };
  }
  return { code: 'NETWORK', detail: String((e && e.message) || e).slice(0, 220) };
}
const sortExps = (arr) => arr.slice().sort((a, b) => a.mjd - b.mjd);
const RLabel = ({ children }) => (<span className="ed-label mb-1 block">{children}</span>);

function RealView({ app, active }) {
  const { t } = app;
  const urlInit = app.urlInit;
  const [target, setTarget] = useState(() => targetFromUrl(urlInit) || ({ ...REAL_TARGETS[0], source: 'preset' }));
  const [nameQ, setNameQ] = useState('');
  const [raStr, setRaStr] = useState(() => fmtRA(target.ra, 2));
  const [decStr, setDecStr] = useState(() => fmtDec(target.dec, 1));
  const [pmaStr, setPmaStr] = useState(() => String(target.pmra || 0));
  const [pmdStr, setPmdStr] = useState(() => String(target.pmdec || 0));
  const [msg, setMsg] = useState(null);
  const [opts, setOpts] = useState(() => (urlInit && urlInit.fov ? { ...DEFAULT_REAL_OPTS, sizeArcmin: clamp(Math.round(urlInit.fov * 60), 3, REAL_FOV_MAX) } : DEFAULT_REAL_OPTS));
  const [baseStr, setBaseStr] = useState(irsaBase);
  const [setOpen, setSetOpen] = useState(false);
  const [tblOpen, setTblOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [phase, setPhase] = useState('idle');
  const [prog, setProg] = useState({ done: 0, total: 0, mb: 0 });
  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState(null);
  const [fails, setFails] = useState([]);
  const [exps, setExps] = useState([]);
  const [net, setNet] = useState({ s: 'unknown' });
  const [mode, setMode] = useState(() => (urlInit && urlInit.mode) || 'movie');
  const [fi, setFi] = useState(0);                         // video: kare sırası
  const [mplay, setMplay] = useState(false);
  const [fpsI, setFpsI] = useState(1);
  const [mloop, setMloop] = useState(true);
  const [mdet, setMdet] = useState('all');
  const [mord, setMord] = useState('time');
  const [sop, setSop] = useState('all');                  // toplama: ab · all · det · mosaic
  const [sdet, setSdet] = useState('');
  const [ovl, setOvl] = useState({ gaia: false, wise: false, flags: false });
  const [ovd, setOvd] = useState({ gaia: { st: 'idle', list: [], key: '' }, wise: { st: 'idle', list: [], key: '' } });
  const [copied, setCopied] = useState('');
  const [ia, setIa] = useState(0);
  const [ib, setIb] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [phaseB, setPhaseB] = useState(false);
  const [probe, setProbe] = useState(null);
  const [probeNet, setProbeNet] = useState(null);
  const [saveCat, setSaveCat] = useState('star');
  const [noteText, setNoteText] = useState('');
  const [savedUid, setSavedUid] = useState(null);
  const [size, setSize] = useState(0);
  const [source, setSource] = useState('irsa');
  const dr = useDrawers(true, true);
  const abortRef = useRef(null);
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const offRef = useRef(null);
  const flOffRef = useRef(null);
  const modeRef = useRef('movie');
  const movLenRef = useRef(0);
  const autoRef = useRef(false);
  const shareRef = useRef(null);
  const zp = useZoomPan(canvasRef, { enabled: true });
  const pingedRef = useRef(false);
  const fileRef = useRef(null);
  const demoTimerRef = useRef(null);
  const errBoxRef = useRef(null);

  /* ---------------- Türetilmiş veriler ---------------- */
  const meas = useMemo(() => exps.map((e) => measureTarget(e, target, { rAp: opts.rAp, useMask: opts.useMask })), [exps, target, opts.rAp, opts.useMask]);
  const diag = useMemo(() => (exps.length ? diagnoseReal(meas, target) : null), [exps.length, meas, target]); // eslint-disable-line react-hooks/exhaustive-deps
  const grid = useMemo(() => {
    if (!exps.length) return null;
    const yr = exps.reduce((s, e) => s + e.epochYear, 0) / exps.length;
    const c = propagate(target, yr);
    const gs = Math.min(...exps.map((e) => e.scale)) / 2;
    const ext = Math.min(...exps.map((e) => Math.min(e.w, e.h) * e.scale)) * 0.96;
    return makeGrid(c.ra, c.dec, clamp(Math.round(ext / gs), 48, 170), gs);
  }, [exps, target]);
  const frames = useMemo(() => (grid ? exps.map((e) => { const f = resampleToGrid(e, grid, opts.useMask); return { f, st: robustStats(f) }; }) : []), [exps, grid, opts.useMask]);
  const lams = useMemo(() => exps.map(expLam), [exps]);
  const payload = useMemo(() => (diag ? buildRealPayload({ target, diag, meas, opts, base: irsaBase(), source }) : null), [diag, target, meas, opts, source]);
  const explain = useMemo(() => realExplain(t, payload), [t, payload]);
  const cands = useMemo(() => {
    if (mode !== 'diff' || !grid || !frames[ia] || !frames[ib] || ia === ib) return null;
    return diffCandidates(frames[ia].f, frames[ib].f, frames[ia].st, frames[ib].st, grid, 6);
  }, [mode, grid, frames, ia, ib]);
  const savedEntry = savedUid ? app.db.entries.find((e) => e.uid === savedUid) || null : null;
  const nearPair = useMemo(() => {           // aynı dedektör + yakın λ + en uzun tarih tabanı
    let best = null;
    for (let i = 0; i < exps.length; i++) for (let j = i + 1; j < exps.length; j++) {
      if (exps[i].det !== exps[j].det || !isFinite(lams[i]) || !isFinite(lams[j])) continue;
      const dl = Math.abs(lams[i] - lams[j]) / lams[i];
      if (dl > 0.03) continue;
      const dt = exps[j].mjd - exps[i].mjd;
      if (!best || dt > best.dt) best = { i, j, dt };
    }
    return best;
  }, [exps, lams]);

  /* ---------------- Ölçüler · kanvas boyutu ---------------- */
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const measure = () => setSize(Math.max(0, Math.floor(Math.min(el.clientWidth, el.clientHeight))));
    measure();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(el); }
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [active]);

  /* ---------------- Bağlantı sınaması (görünür olunca bir kez) ---------------- */
  const ping = useCallback(async () => {
    setNet({ s: 'checking' });
    try { await irsaPing(irsaBase()); setNet({ s: 'ok' }); }
    catch (e) { const er = toErr(e); setNet({ s: er.code === 'NETWORK' || er.code === 'TIMEOUT' ? 'fail' : 'warn', er }); }
  }, []);
  useEffect(() => { if (active && !pingedRef.current) { pingedRef.current = true; ping(); } }, [active, ping]);

  /* ---------------- Hedef seçme ---------------- */
  const applyTarget = (tg) => {
    if (demoTimerRef.current) { clearTimeout(demoTimerRef.current); demoTimerRef.current = null; }
    setTarget({ ...tg });
    setRaStr(fmtRA(tg.ra, 2)); setDecStr(fmtDec(tg.dec, 1)); setPmaStr(String(tg.pmra || 0)); setPmdStr(String(tg.pmdec || 0));
    setExps([]); setPhase('idle'); setErr(null); setFails([]); setPlan(null); setSavedUid(null); setProbe(null); setProbeNet(null);
  };
  /* ---------------- Katalogdan gelen "Gerçek Veride Aç" isteği ---------------- */
  const focusRef = useRef(null);
  useEffect(() => {
    const f = app.realFocus;
    if (!f || focusRef.current === f.nonce) return;
    focusRef.current = f.nonce;
    const tg = f.target;
    setNameQ(tg.name || ''); setMsg(null);
    if (Math.abs(tg.ra - target.ra) < 1e-6 && Math.abs(tg.dec - target.dec) < 1e-6 && tg.name === target.name) return;
    applyTarget({ ...tg });
  }, [app.realFocus]); // eslint-disable-line react-hooks/exhaustive-deps
  const applyManual = () => {
    const ra = parseAngle(raStr, 'ra'); const dec = parseAngle(decStr, 'dec');
    const pa = Number(String(pmaStr).replace(',', '.')); const pd = Number(String(pmdStr).replace(',', '.'));
    if (!isFinite(ra) || !isFinite(dec) || dec < -89.5 || dec > 89.5 || !isFinite(pa) || !isFinite(pd)) { setMsg({ k: 'real.target.bad' }); return; }
    setMsg(null);
    applyTarget({ id: 'manual', name: nameQ.trim() || t('real.target.manual'), ra: wrap360(ra), dec, pmra: pa, pmdec: pd, epoch: 2000, source: 'manual' });
  };
  const resolveTarget = async () => {
    const q = nameQ.trim();
    if (!q) return;
    setMsg({ k: 'custom.resolving' });
    try {
      const r = await resolveName(q);
      let pa = 0; let pd = 0; let sid = q; let note = '';
      try {
        const hits = await querySimbad(r.ra, r.dec, 8);
        if (hits.length) { pa = Number(hits[0].pmra) || 0; pd = Number(hits[0].pmdec) || 0; sid = hits[0].id || q; }
      } catch (e) { note = 'nopm'; }
      applyTarget({ id: 'resolved', name: sid, ra: r.ra, dec: r.dec, pmra: pa, pmdec: pd, epoch: 2000, source: 'simbad' });
      setMsg({ k: note ? 'real.target.resolvedNoPm' : 'real.target.resolved', p: { name: sid, pm: fmtMu(Math.hypot(pa, pd) / 1000) } });
    } catch (e) { setMsg({ k: 'custom.failed', p: { msg: e.message } }); }
  };

  /* ---------------- IRSA'dan indirme ---------------- */
  const cancel = () => { if (abortRef.current) abortRef.current.abort(); };
  const runFetch = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    if (demoTimerRef.current) { clearTimeout(demoTimerRef.current); demoTimerRef.current = null; }
    const ctl = new AbortController();
    abortRef.current = ctl;
    const base = irsaBase();
    setSource('irsa'); setPhase('query'); setErr(null); setFails([]); setPlan(null); setExps([]); setSavedUid(null); setProbe(null); setProbeNet(null);
    setProg({ done: 0, total: 0, mb: 0 });
    let rows;
    try {
      const tc = propagate(target, 2026.0);
      const tab = await irsaTap(base, exposureQuery(tc.ra, tc.dec), { signal: ctl.signal });
      rows = normalizeExposureRows(tab);
      setNet({ s: 'ok' });
    } catch (e) {
      if (ctl.signal.aborted) { setPhase('idle'); return; }
      const er = toErr(e);
      setErr(er); setPhase('error'); setNet({ s: er.code === 'NETWORK' || er.code === 'TIMEOUT' ? 'fail' : 'warn', er });
      return;
    }
    if (!rows.length) { setErr({ code: 'NO_DATA' }); setPhase('error'); return; }
    const picked = pickExposures(rows, opts.perDet, 24);
    const yrs = picked.map((r) => mjdToYear(r.mjd));
    const meanYr = yrs.reduce((a, b) => a + b, 0) / yrs.length;
    const span = Math.max(...yrs) - Math.min(...yrs);
    const muDeg = Math.hypot(target.pmra || 0, target.pmdec || 0) / 3.6e6;
    const sizeDeg = Math.max(opts.sizeArcmin / 60, 2.5 * muDeg * span + 0.04);
    const c = propagate(target, meanYr);
    setPlan({ total: rows.length, planned: picked.length, sizeArcmin: sizeDeg * 60, latestMjd: Math.max(...rows.map((r) => r.mjd)) });
    setPhase('download'); setProg({ done: 0, total: picked.length, mb: 0 });
    const got = []; const failed = []; const part = {}; let doneBytes = 0; let next = 0; let done = 0;
    const worker = async () => {
      while (next < picked.length && !ctl.signal.aborted) {
        const row = picked[next++];
        try {
          const e = await fetchExposure(base, row, c.ra, c.dec, sizeDeg, { signal: ctl.signal, onProgress: (g) => { part[row.uri] = g; setProg((p) => ({ ...p, mb: (doneBytes + Object.values(part).reduce((a, b) => a + b, 0)) / 1048576 })); } });
          got.push(e); setExps(sortExps(got));
        } catch (er) {
          if (ctl.signal.aborted) return;
          failed.push({ ...toErr(er), did: row.did }); setFails(failed.slice());
        }
        doneBytes += part[row.uri] || 0; delete part[row.uri];
        done += 1; setProg((p) => ({ ...p, done }));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (ctl.signal.aborted) { setPhase(got.length ? 'done' : 'idle'); return; }
    if (!got.length) { setErr(failed.length ? failed[0] : { code: 'NO_DATA' }); setPhase('error'); return; }
    setPhase('done');
  }, [target, opts.perDet, opts.sizeArcmin]);

  /* ---------------- Yerel FITS dosyası yükleme (CORS/çevrimdışı için yedek yol) ---------------- */
  const onFiles = async (list) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    if (abortRef.current) abortRef.current.abort();
    if (demoTimerRef.current) { clearTimeout(demoTimerRef.current); demoTimerRef.current = null; }
    setSource('file'); setPhase('download'); setErr(null); setFails([]); setPlan(null); setExps([]); setSavedUid(null); setProbe(null); setProbeNet(null);
    setProg({ done: 0, total: files.length, mb: 0 });
    const got = []; const failed = [];
    for (let i = 0; i < files.length; i++) {
      try { got.push(await exposureFromFile(await files[i].arrayBuffer(), files[i].name)); setExps(sortExps(got)); }
      catch (e) { failed.push({ ...toErr(e), did: files[i].name }); setFails(failed.slice()); }
      setProg((p) => ({ ...p, done: i + 1 }));
    }
    if (!got.length) { setErr(failed.length ? failed[0] : { code: 'FITS_BAD' }); setPhase('error'); return; }
    setPhase('done');
  };

  // Hata kutusu (ve içindeki hızlı aksiyonlar) sol panelde görünür alana kaydırılır
  useEffect(() => { if (err && errBoxRef.current && errBoxRef.current.scrollIntoView) { try { errBoxRef.current.scrollIntoView({ block: 'nearest' }); } catch (e) { /* yoksay */ } } }, [err]);

  /* ---------------- Çevrimdışı demo: seçili hedef için SENTETİK SPHEREx-biçimli kesitler (gerçek veri DEĞİL) ---------------- */
  const runDemo = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
    setSource('demo'); setPhase('build'); setErr(null); setFails([]); setPlan(null); setExps([]); setSavedUid(null); setProbe(null); setProbeNet(null);
    setProg({ done: 0, total: 0, mb: 0 });
    demoTimerRef.current = setTimeout(() => {      // spinner'ın boyanması için bir kare bekle
      demoTimerRef.current = null;
      try {
        const list = makeDemoExposures(target);
        setExps(sortExps(list)); setPhase('done');
      } catch (e) {
        setErr({ code: 'DEMO', detail: t('real.demo.failed', { msg: String((e && e.message) || e).slice(0, 160) }) }); setPhase('error');
      }
    }, 40);
  }, [target, t]);
  useEffect(() => () => { if (demoTimerRef.current) clearTimeout(demoTimerRef.current); }, []);

  /* ---------------- Yüklenince varsayılan A/B çifti ---------------- */
  useEffect(() => {
    if (!exps.length) { setIa(0); setIb(0); return; }
    if (nearPair) { setIa(nearPair.i); setIb(nearPair.j); }
    else { setIa(0); setIb(Math.min(1, exps.length - 1)); }
  }, [exps.length, nearPair && nearPair.i, nearPair && nearPair.j]); // eslint-disable-line react-hooks/exhaustive-deps
  const iaC = Math.min(ia, Math.max(0, exps.length - 1));
  const ibC = Math.min(ib, Math.max(0, exps.length - 1));

  /* ---------------- v3.5: video kareleri · toplama (coadd) · bayraklar · bindirmeler ---------------- */
  const detList = useMemo(() => Array.from(new Set(exps.map((e) => e.det))).sort(), [exps]);
  const sdetC = detList.indexOf(sdet) >= 0 ? sdet : detList[0] || '';
  const movieIdx = useMemo(() => {
    let idx = exps.map((e, i) => i).filter((i) => mdet === 'all' || exps[i].det === mdet);
    if (mord === 'lam') idx = idx.slice().sort((a, b) => (isFinite(lams[a]) ? lams[a] : 99) - (isFinite(lams[b]) ? lams[b] : 99));
    return idx;
  }, [exps, mdet, mord, lams]);
  const fiC = Math.min(fi, Math.max(0, movieIdx.length - 1));
  const sumIdx = useMemo(() => {
    if (!exps.length) return [];
    if (sop === 'ab') return iaC === ibC ? [iaC] : [iaC, ibC];
    if (sop === 'det') return exps.map((e, i) => i).filter((i) => exps[i].det === sdetC);
    return exps.map((e, i) => i);
  }, [exps, sop, iaC, ibC, sdetC]);
  const stack = useMemo(() => (mode === 'sum' && sop !== 'mosaic' && frames.length && sumIdx.length ? stackFrames(frames, sumIdx) : null), [mode, sop, frames, sumIdx]);
  const mosaic = useMemo(() => {
    if (!(mode === 'sum' && sop === 'mosaic' && frames.length)) return null;
    return detList.map((d) => { const idx = exps.map((e, i) => i).filter((i) => exps[i].det === d); return { det: d, ...stackFrames(frames, idx) }; });
  }, [mode, sop, frames, detList, exps]);
  modeRef.current = mode; movLenRef.current = movieIdx.length;
  const shownIdx = mode === 'movie' ? (movieIdx[fiC] !== undefined ? movieIdx[fiC] : 0) : mode === 'blink' ? (phaseB ? ibC : iaC) : iaC;
  const flagIdx = shownIdx;
  const flagGrid = useMemo(() => (ovl.flags && grid && exps[flagIdx] ? resampleFlags(exps[flagIdx], grid) : null), [ovl.flags, grid, exps, flagIdx]);
  const flagSum = useMemo(() => (exps[flagIdx] ? flagSummary(exps[flagIdx], target, opts.rAp) : null), [exps, flagIdx, target, opts.rAp]);
  const probeMeas = useMemo(() => (probe && exps.length ? exps.map((e) => measureTarget(e, { ra: probe.ra, dec: probe.dec, pmra: 0, pmdec: 0, epoch: e.epochYear }, { rAp: opts.rAp, useMask: opts.useMask })) : null), [probe, exps, opts.rAp, opts.useMask]);
  const archive = useMemo(() => (plan && plan.latestMjd ? { date: dayOf(mjdToIso(plan.latestMjd)), n: plan.total } : null), [plan]);
  const shareParams = { ra: target.ra, dec: target.dec, fov: opts.sizeArcmin / 60, name: target.name, pane: 'irsa', mode };
  const shareUrl = buildShareUrl({ ...shareParams, auto: true });
  const embedCode = embedSnippet(buildShareUrl({ ...shareParams, embed: true, auto: true }));
  const copyText = async (txt, key) => {
    try { await navigator.clipboard.writeText(txt); setCopied(key); }
    catch (e) {
      try { if (shareRef.current) { shareRef.current.value = txt; shareRef.current.select(); document.execCommand('copy'); setCopied(key); } else setCopied('fail'); }
      catch (e2) { setCopied('fail'); }
    }
    setTimeout(() => setCopied(''), 2200);
  };

  /* ---------------- Blink zamanlayıcısı · klavye ---------------- */
  useEffect(() => {
    if (!(playing && mode === 'blink')) return undefined;
    const id = setInterval(() => setPhaseB((p) => !p), 700);
    return () => clearInterval(id);
  }, [playing, mode]);
  // Video: kareleri sırayla oynat (hız seçilebilir; döngü kapalıysa son karede durur)
  useEffect(() => {
    if (!(mplay && mode === 'movie' && movieIdx.length > 1)) return undefined;
    const len = movieIdx.length;
    const id = setInterval(() => setFi((v) => (v + 1 >= len ? (mloop ? 0 : len - 1) : v + 1)), 1000 / MV_FPS[fpsI]);
    return () => clearInterval(id);
  }, [mplay, mode, movieIdx.length, fpsI, mloop]);
  useEffect(() => { if (mplay && !mloop && movieIdx.length && fiC >= movieIdx.length - 1) setMplay(false); }, [mplay, mloop, fiC, movieIdx.length]);
  // Yeni kareler yüklenince video başa sarar ve (hareket azaltma istenmediyse) kendiliğinden oynar
  const loadedKey = phase === 'done' ? exps.length : 0;
  useEffect(() => {
    setFi(0);
    let reduce = false;
    try { reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* yoksay */ }
    setMplay(loadedKey > 1 && !reduce);
  }, [loadedKey]);
  // URL ile açılışta (?auto=1) indirmeyi kendiliğinden başlat
  useEffect(() => {
    if (!active || autoRef.current || !urlInit || !urlInit.auto || !urlInit.target) return;
    autoRef.current = true;
    runFetch();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  // Adres çubuğunu geçerli alanla eşitle (paylaşılabilir bağlantı)
  useEffect(() => {
    if (!active) return;
    app.syncUrl({ ra: target.ra, dec: target.dec, fov: opts.sizeArcmin / 60, name: target.name, pane: 'irsa', mode });
  }, [active, target, opts.sizeArcmin, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
      const i = ['1', '2', '3', '4', '5', '6'].indexOf(e.key);
      if (i >= 0) { setMode(REAL_MODES[i].id); return; }
      if (e.key === '+' || e.key === '=') { zp.zoomAt(1.5); return; }
      if (e.key === '-' || e.key === '\u2212') { zp.zoomAt(1 / 1.5); return; }
      if (e.key === '0') { zp.reset(); return; }
      const mv = modeRef.current === 'movie';
      if (e.key === ' ') { e.preventDefault(); if (mv) setMplay((p) => !p); else { setMode('blink'); setPlaying((p) => !p); } }
      else if (e.key === 'ArrowRight') { if (mv) { setMplay(false); setFi((v) => Math.min(movLenRef.current - 1, v + 1)); } else setIa((v) => Math.min(exps.length - 1, v + 1)); }
      else if (e.key === 'ArrowLeft') { if (mv) { setMplay(false); setFi((v) => Math.max(0, v - 1)); } else setIa((v) => Math.max(0, v - 1)); }
      else if (e.key === 'f' || e.key === 'F') setPhaseB((p) => !p);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, exps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- Kanvas çizimi ---------------- */
  const rgbIdx = useMemo(() => {
    const idx = exps.map((e, i) => i).filter((i) => isFinite(lams[i])).sort((a, b) => lams[a] - lams[b]);
    return idx.length >= 3 ? [idx[idx.length - 1], idx[Math.floor(idx.length / 2)], idx[0]] : null;
  }, [exps, lams]);
  // Bayrak bindirmesi için RGBA katmanı (kırmızı = ölçümden çıkarılan · sarı = kirlenme · mavi = bilgi)
  const flagImg = useMemo(() => {
    if (!flagGrid) return null;
    const d = new Uint8ClampedArray(flagGrid.length * 4);
    const rgb = { bad: [240, 88, 122, 150], contam: [227, 181, 103, 140], info: [141, 185, 255, 80] };
    for (let q = 0; q < flagGrid.length; q++) {
      const v = flagGrid[q];
      if (!v) continue;
      let kind = '';
      for (let f = 0; f < SPHEREX_FLAGS.length; f++) {
        const fl = SPHEREX_FLAGS[f];
        if (!flagHas(v, fl.bit)) continue;
        if (fl.kind === 'bad') { kind = 'bad'; break; }
        if (fl.kind === 'contam') kind = 'contam'; else if (!kind) kind = 'info';
      }
      if (kind) { const c = rgb[kind]; d[q * 4] = c[0]; d[q * 4 + 1] = c[1]; d[q * 4 + 2] = c[2]; d[q * 4 + 3] = c[3]; }
    }
    return d;
  }, [flagGrid]);

  /* ---------------- Gaia DR3 / AllWISE bindirmesi (CDS VizieR · en iyi çaba) ---------------- */
  const ovCenter = useMemo(() => (grid ? { ra: grid.ra0, dec: grid.dec0, r: ((grid.n * grid.scale) / 3600) * 0.72 } : null), [grid]);
  const ovReq = useRef({});
  const ovHitRef = useRef([]);
  useEffect(() => {
    if (!ovCenter) return;
    ['gaia', 'wise'].forEach((k) => {
      if (!ovl[k]) return;
      const key = `${ovCenter.ra.toFixed(4)}|${ovCenter.dec.toFixed(4)}|${ovCenter.r.toFixed(3)}`;
      if (ovReq.current[k] === key && ovd[k].st !== 'fail') return;
      ovReq.current[k] = key;
      setOvd((o) => ({ ...o, [k]: { st: 'loading', list: [], key } }));
      vizierCone(k, ovCenter.ra, ovCenter.dec, ovCenter.r).then(
        (list) => { if (ovReq.current[k] === key) setOvd((o) => ({ ...o, [k]: { st: 'ok', list, key } })); },
        () => { if (ovReq.current[k] === key) setOvd((o) => ({ ...o, [k]: { st: 'fail', list: [], key } })); },
      );
    });
  }, [ovl.gaia, ovl.wise, ovCenter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !size) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    if (cv.width !== px || cv.height !== px) { cv.width = px; cv.height = px; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#04060C'; ctx.fillRect(0, 0, size, size);
    ovHitRef.current = [];
    if (!grid || !frames.length || !frames[iaC]) return;
    const n = grid.n;
    const zv = zp.view; const Z = zv.z;
    const scr = (x, y) => ({ x: (x - zv.cx * size) * Z + size / 2, y: (y - zv.cy * size) * Z + size / 2 });
    const off = offRef.current || (offRef.current = document.createElement('canvas'));
    if (off.width !== n || off.height !== n) { off.width = n; off.height = n; }
    const octx = off.getContext('2d');
    const id = octx.createImageData(n, n);
    const A = frames[iaC]; const B = frames[ibC];
    let label = '';
    let msgTxt = '';
    let tiles = null;
    if (mode === 'rgb') {
      if (rgbIdx) {
        const [r, g, b] = rgbIdx.map((i) => frames[i]);
        composeRealRGB(id.data, r.f, g.f, b.f, r.st, g.st, b.st, opts.stretch);
        label = `R ${lams[rgbIdx[0]].toFixed(2)} · G ${lams[rgbIdx[1]].toFixed(2)} · B ${lams[rgbIdx[2]].toFixed(2)} µm`;
      } else { composeReal(id.data, A.f, A.st, opts.stretch, lamTint(lams[iaC])); msgTxt = t('real.rgb.need'); }
    } else if (mode === 'diff') {
      if (iaC !== ibC) {
        composeRealDiff(id.data, A.f, B.f, A.st, B.st, opts.thr, opts.stretch);
        label = `Δ = #${ibC + 1} − #${iaC + 1}`;
      } else { composeReal(id.data, A.f, A.st, opts.stretch, lamTint(lams[iaC])); msgTxt = t('real.diff.need'); }
    } else if (mode === 'sum') {
      if (mosaic) { tiles = mosaic; label = 'Σ · D1–D6'; }
      else if (stack && sumIdx.length >= 2) {
        composeReal(id.data, stack.f, stack.st, opts.stretch, [0.92, 0.97, 1]);
        label = `Σ ${stack.n} · ${sop === 'det' ? sdetC : sop === 'ab' ? 'A + B' : t('sum.op.all')}`;
      } else { composeReal(id.data, A.f, A.st, opts.stretch, lamTint(lams[iaC])); msgTxt = t('sum.need'); }
    } else {
      const F = frames[shownIdx] || A;
      composeReal(id.data, F.f, F.st, opts.stretch, lamTint(lams[shownIdx]));
      const e = exps[shownIdx];
      label = `#${shownIdx + 1}${mode === 'blink' ? (phaseB ? ' (B)' : ' (A)') : ''}${mode === 'movie' ? ` · ${fiC + 1}/${movieIdx.length}` : ''} · ${e.det} · ${isFinite(lams[shownIdx]) ? lams[shownIdx].toFixed(3) + ' µm' : '—'} · ${dayOf(e.iso)}`;
    }
    const k = size / n;
    if (tiles) {
      const cols = 3; const rows = Math.max(1, Math.ceil(tiles.length / cols)); const side = size / cols; const y0 = (size - rows * side) / 2;
      const tc = document.createElement('canvas'); tc.width = n; tc.height = n;
      const tctx = tc.getContext('2d');
      ctx.imageSmoothingEnabled = Z < 3;
      tiles.forEach((tl, q) => {
        const tid = tctx.createImageData(n, n);
        composeReal(tid.data, tl.f, tl.st, opts.stretch, lamTint(DET_LAM_HINT[tl.det] || 1.6));
        tctx.putImageData(tid, 0, 0);
        const a = scr((q % cols) * side, y0 + Math.floor(q / cols) * side); const b = scr((q % cols) * side + side, y0 + Math.floor(q / cols) * side + side);
        ctx.drawImage(tc, a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.font = `11px ${MONO_STACK}`;
        txt(ctx, t('sum.panel', { det: tl.det, n: tl.n }), a.x + 6, a.y + 14, detColor(tl.det), 'left');
      });
    } else {
      octx.putImageData(id, 0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = Z < 3; ctx.imageSmoothingQuality = 'high';
      ctx.translate(size / 2, size / 2); ctx.scale(Z, Z); ctx.translate(-zv.cx * size, -zv.cy * size);
      ctx.drawImage(off, 0, 0, size, size);
      if (flagImg) {
        const fo = flOffRef.current || (flOffRef.current = document.createElement('canvas'));
        fo.width = n; fo.height = n;
        fo.getContext('2d').putImageData(new ImageData(flagImg, n, n), 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(fo, 0, 0, size, size);
      }
      ctx.restore();
    }
    const gp = (ra, dec) => { const p = grid.skyToPix(ra, dec); return scr((p.x + 0.5) * k, (p.y + 0.5) * k); };
    const ring = (p, r, col, dash) => { ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 1.5; if (dash) ctx.setLineDash(dash); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); };
    const mark = (i, col, dash) => {
      const e = exps[i]; if (!e) return;
      const pr = propagate(target, e.epochYear);
      ring(gp(pr.ra, pr.dec), 11, col, dash);
      const m = meas[i];
      if (m && m.ok && m.centroidOk && m.status !== 'faint') { const p = gp(m.ra, m.dec); ring(p, 4, '#FFFFFF'); }
    };
    if (!tiles) {
      if (mode === 'blink') mark(shownIdx, phaseB ? '#5B9DFF' : '#F0587A', [4, 3]);
      else if (mode === 'diff') { mark(iaC, '#F0587A', [4, 3]); mark(ibC, '#5B9DFF', [4, 3]); }
      else if (mode === 'single' || mode === 'movie') mark(shownIdx, '#8FE0B5', [4, 3]);
      // Gaia / AllWISE: kaynaklar pozlamanın dönemine özdevinimle taşınır
      const yrOv = mode === 'sum' || mode === 'rgb' ? exps.reduce((a, e) => a + e.epochYear, 0) / exps.length : exps[shownIdx].epochYear;
      ['gaia', 'wise'].forEach((key) => {
        if (!ovl[key]) return;
        const col = OVERLAY_SURVEYS[key].color;
        ovd[key].list.forEach((sr) => {
          const at = (yy) => { const pe = propagate({ ra: sr.ra, dec: sr.dec, pmra: sr.pmra, pmdec: sr.pmdec, epoch: sr.epoch }, yy); return gp(pe.ra, pe.dec); };
          const p = at(yrOv);
          if (p.x < -12 || p.y < -12 || p.x > size + 12 || p.y > size + 12) return;
          const r = isFinite(sr.mag) ? clamp(7.5 - (sr.mag - 12) * 0.45, 2.5, 8) : 3.5;
          ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col + '22'; ctx.lineWidth = 1.3;
          if (key === 'wise') { ctx.strokeRect(p.x - r, p.y - r, 2 * r, 2 * r); ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r); } else { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
          if (sr.hasPm) {
            const a = at(yrOv - 5); const b = at(yrOv + 5);
            if (Math.hypot(b.x - a.x, b.y - a.y) > 3) { ctx.setLineDash([3, 2]); ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
          }
          ctx.restore();
          const pe0 = propagate({ ra: sr.ra, dec: sr.dec, pmra: sr.pmra, pmdec: sr.pmdec, epoch: sr.epoch }, yrOv);
          ovHitRef.current.push({ x: p.x, y: p.y, key, id: sr.id, mag: sr.mag, ra: pe0.ra, dec: pe0.dec });
        });
      });
      if (mode === 'diff' && cands) cands.cands.forEach((c, i) => { const p = gp(c.ra, c.dec); ring(p, 15, '#E3B567'); txt(ctx, String(i + 1), p.x + 13, p.y - 11, '#E3B567', 'left'); });
      if (probe) { const p = gp(probe.ra, probe.dec); ctx.save(); ctx.strokeStyle = '#8DB9FF'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p.x - 14, p.y); ctx.lineTo(p.x - 5, p.y); ctx.moveTo(p.x + 5, p.y); ctx.lineTo(p.x + 14, p.y); ctx.moveTo(p.x, p.y - 14); ctx.lineTo(p.x, p.y - 5); ctx.moveTo(p.x, p.y + 5); ctx.lineTo(p.x, p.y + 14); ctx.stroke(); ctx.restore(); }
    }
    ctx.font = `11px ${MONO_STACK}`;
    txt(ctx, label, 8, 16, '#DCE6F5', 'left');
    if (msgTxt) txt(ctx, msgTxt, 8, 32, '#E3B567', 'left');
    if (source === 'demo') {                          // simülasyon filigranı: veri gerçek değildir
      const wm = t('real.demo.watermark');
      ctx.save(); ctx.translate(size / 2, size / 2); ctx.rotate(-Math.PI / 11); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let fs = 15; ctx.font = `bold ${fs}px ${MONO_STACK}`;
      while (fs > 8 && ctx.measureText(wm).width > size * 0.8) { fs -= 1; ctx.font = `bold ${fs}px ${MONO_STACK}`; }
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(4,6,12,0.75)'; ctx.strokeText(wm, 0, 0);
      ctx.fillStyle = 'rgba(255,51,102,0.78)'; ctx.fillText(wm, 0, 0);
      ctx.restore();
    }
    // yön oku (kuzey yukarı, doğu solda) ve yakınlaştırmaya uyan ölçek çubuğu
    ctx.save(); ctx.strokeStyle = '#9FB2D6'; ctx.fillStyle = '#9FB2D6'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(26, size - 14); ctx.lineTo(26, size - 46); ctx.moveTo(26, size - 14); ctx.lineTo(58, size - 14); ctx.stroke();
    ctx.restore();
    txt(ctx, 'N', 22, size - 50, '#9FB2D6', 'right'); txt(ctx, 'E', 62, size - 10, '#9FB2D6', 'left');
    let arc = 5;
    [5, 10, 30, 60, 120, 300, 600, 1200].forEach((c) => { if ((c / grid.scale) * k * Z <= size * 0.26) arc = c; });
    const bar = (arc / grid.scale) * k * Z;
    ctx.save(); ctx.strokeStyle = '#DCE6F5'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(size - 12 - bar, size - 16); ctx.lineTo(size - 12, size - 16); ctx.stroke(); ctx.restore();
    txt(ctx, arc >= 60 ? `${arc / 60}′` : `${arc}″`, size - 12 - bar / 2, size - 22, '#DCE6F5', 'center');
  }, [size, grid, frames, mode, iaC, ibC, phaseB, opts.stretch, opts.thr, probe, cands, meas, exps, lams, rgbIdx, shownIdx, target, t, source, zp.view, stack, mosaic, sumIdx, sop, sdetC, fiC, movieIdx.length, flagImg, ovl, ovd]);

  const onCanvasClick = (ev) => {
    if (!grid || !canvasRef.current || zp.moved.current) return;
    if (mode === 'sum' && sop === 'mosaic') return;
    const r = canvasRef.current.getBoundingClientRect();
    const u = (ev.clientX - r.left) / r.width; const w = (ev.clientY - r.top) / r.height;
    let hit = null; let bd = 9;
    ovHitRef.current.forEach((h) => { const d = Math.hypot(h.x - u * size, h.y - w * size); if (d < bd) { bd = d; hit = h; } });
    const im = zpToImg(zp.view, u, w);
    const s = hit ? { ra: hit.ra, dec: hit.dec } : grid.pixToSky(im.x * grid.n - 0.5, im.y * grid.n - 0.5);
    setProbe({ ra: s.ra, dec: s.dec, src: hit ? { key: hit.key, id: hit.id, mag: hit.mag } : null }); setProbeNet(null);
  };

  const checkProbe = async () => {
    if (!probe) return;
    setProbeNet({ status: 'pending' });
    const e = exps[shownIdx];
    try { setProbeNet(await queryCatalogs(probe.ra, probe.dec, 8, e ? dayOf(e.iso) : '2026-01-01')); }
    catch (x) { setProbeNet({ status: 'offline', simbad: [], skybot: { status: 'unavailable', items: [] } }); }
  };
  const probeToTarget = () => {
    if (!probe) return;
    const e = exps[shownIdx];
    const tg = { id: 'probe', name: t('real.probe.name', { ra: probe.ra.toFixed(4), dec: probe.dec.toFixed(4) }), ra: probe.ra, dec: probe.dec, pmra: 0, pmdec: 0, epoch: e ? e.epochYear : 2026, source: 'probe' };
    setTarget(tg); setRaStr(fmtRA(tg.ra, 2)); setDecStr(fmtDec(tg.dec, 1)); setPmaStr('0'); setPmdStr('0'); setSavedUid(null); setProbe(null); setProbeNet(null);
  };
  const fileCenterToTarget = () => {
    const e = exps[0];
    if (!e) return;
    const c = e.wcs.pixToSky((e.w + 1) / 2, (e.h + 1) / 2);
    const tg = { id: 'filecenter', name: t('real.file.center'), ra: c.ra, dec: c.dec, pmra: 0, pmdec: 0, epoch: e.epochYear, source: 'file' };
    setTarget(tg); setRaStr(fmtRA(tg.ra, 2)); setDecStr(fmtDec(tg.dec, 1)); setPmaStr('0'); setPmdStr('0');
  };
  const saveReal = () => {
    if (!diag || source === 'demo') return;           // simülasyon asla gerçek ölçüm olarak kaydedilmez
    const saved = app.saveEntry(makeRealDraft({ target, diag, meas, opts, base: irsaBase(), source, cat: saveCat, userNote: noteText.trim() }));
    setSavedUid(saved.uid); setNoteText('');
  };
  const applyBase = (v) => { setBaseStr(v); setIrsaBase(v); };

  /* ---------------- Ortak görünüm parçaları ---------------- */
  const busy = phase === 'query' || phase === 'download' || phase === 'build';
  const busyText = phase === 'query' ? t('real.fetch.querying') : phase === 'build' ? t('real.demo.building') : t('real.fetch.downloading', { done: prog.done, total: prog.total, mb: prog.mb.toFixed(1) });
  const netFail = err && (err.code === 'NETWORK' || err.code === 'TIMEOUT');
  const fbActions = (pfx, withBody) => (
    <div className="space-y-2 border-t border-[#E3B567]/25 pt-3" data-testid={`${pfx}-fb`}>
      <div className="ed-label" style={{ color: '#EEF3FD' }}>{t('real.fb.title')}</div>
      {withBody && <div className="text-[11px] leading-snug text-[#EEF3FD]/80">{t('real.fb.body')}</div>}
      <button type="button" data-testid={`${pfx}-fb-sky`} onClick={() => app.setRealPane('sky')} className="ed-btn is-ok is-block ed-go">{t('real.fb.sky')}</button>
      <div className="flex items-center gap-2">
        <button type="button" data-testid={`${pfx}-fb-demo`} disabled={busy} onClick={runDemo} className="ed-btn is-warn is-block flex-1">{t('real.fb.demo')}</button>
        <InfoTip id="tip.real.fb.demo" title={t('real.fb.demo')} />
      </div>
    </div>
  );
  const netCol = net.s === 'ok' ? '#8FE0B5' : net.s === 'fail' ? '#E3B567' : net.s === 'warn' ? '#E3B567' : '#5B9DFF';
  const expLabel = (i) => `#${i + 1} · ${dayOf(exps[i].iso)} · ${exps[i].det} · ${isFinite(lams[i]) ? lams[i].toFixed(2) + ' µm' : '—'}`;
  const verdictCol = !diag ? '#9AA7BD' : diag.verdict === 'moving-unexpected' ? '#F0587A' : diag.verdict === 'pm-confirmed' ? '#8FE0B5' : diag.verdict === 'pm-differs' ? '#E3B567' : diag.verdict === 'static' ? '#8FE0B5' : '#9FB2D6';
  const dLamWarn = mode !== 'single' && exps.length > 1 && isFinite(lams[iaC]) && isFinite(lams[ibC]) && (exps[iaC].det !== exps[ibC].det || Math.abs(lams[iaC] - lams[ibC]) / lams[iaC] > 0.03);
  const mo = diag ? diag.motion : null;
  const medSnr = diag && diag.nDet ? median(meas.filter((m) => m.status === 'detected').map((m) => m.snr)) : NaN;
  const errKey = err ? (ERR_KEYS.indexOf(err.code) >= 0 ? err.code : 'GENERIC') : '';
  const aladin = `https://aladin.cds.unistra.fr/AladinLite/?target=${encodeURIComponent(target.ra.toFixed(5) + ' ' + (target.dec >= 0 ? '+' : '') + target.dec.toFixed(5))}&fov=0.2&survey=${encodeURIComponent('CDS/P/SPHEREx/QR2/color')}`;

  /* ================= SOL ÇEKMECE ================= */
  const leftBody = (
    <div data-testid="real-left">
      <Card title={t('real.target.title')} tip="tip.real.target" icon={<span>1</span>}>
        <div data-testid="real-presets">
          {REAL_TARGETS.map((p, pi) => (
            <React.Fragment key={p.id}>
            {(pi === 0 || (p.ch ? false : REAL_TARGETS[pi - 1].ch)) && (<div className="ed-label mb-1 mt-3 first:mt-0" style={{ color: 'var(--acc)' }} data-testid={p.ch ? 'real-group-ch' : 'real-group-more'}>{p.ch ? t('real.group.ch') : t('real.group.more')}</div>)}
            <button key={p.id} type="button" title={p.note} data-testid={`real-preset-${p.id}`} aria-pressed={target.id === p.id} onClick={() => { applyTarget({ ...p, source: 'preset' }); setNameQ(p.name); setMsg(null); }} className="ed-row">
              <span className="block truncate text-[13px]" style={{ color: target.id === p.id ? '#fff' : '#EEF3FD' }}>{p.name}</span>
              <span className="ed-mono block truncate text-[9.5px] text-[#667BA3]" title={p.note}>{p.note.split(' · ').slice(0, 2).join(' · ')}</span>
            </button>
            </React.Fragment>
          ))}
        </div>
        <div className="ed-note-box ed-mono mt-4 text-[11px] leading-relaxed text-[#EEF3FD]" data-testid="real-target-summary">
          <div className="truncate text-[color:var(--acc)]">{target.name}</div>
          <div>{fmtRA(target.ra, 2)} {fmtDec(target.dec, 1)} <span className="text-[#667BA3]">J{target.epoch || 2000}</span></div>
          <div className="text-[#9895AA]">μ = {fmtMu(Math.hypot(target.pmra || 0, target.pmdec || 0) / 1000)}″/yr</div>
        </div>
        <button type="button" data-testid="real-manual-toggle" aria-expanded={manualOpen} onClick={() => setManualOpen((o) => !o)} className="ed-link mt-4">
          <span aria-hidden>{manualOpen ? '−' : '+'}</span>{t('real.target.manualToggle')}
        </button>
        <div className={manualOpen ? 'block' : 'hidden'} data-testid="real-manual">
          <div className="mt-3 flex items-end gap-3">
            <label className="ed-label min-w-0 flex-1"><RLabel>{t('custom.name')}</RLabel>
              <input data-testid="real-name" value={nameQ} onChange={(e) => setNameQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') resolveTarget(); }} placeholder={t('custom.namePh')} className="block w-full" />
            </label>
            <button type="button" data-testid="real-resolve" onClick={resolveTarget} aria-label={t('custom.name')} className="ed-btn is-sm"><span aria-hidden>⌕</span></button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <label className="ed-label"><RLabel>{t('custom.ra')}</RLabel><input data-testid="real-ra" value={raStr} onChange={(e) => setRaStr(e.target.value)} className="block w-full" /></label>
            <label className="ed-label"><RLabel>{t('custom.dec')}</RLabel><input data-testid="real-dec" value={decStr} onChange={(e) => setDecStr(e.target.value)} className="block w-full" /></label>
            <label className="ed-label"><RLabel>μα* (mas/yr)</RLabel><input data-testid="real-pmra" value={pmaStr} onChange={(e) => setPmaStr(e.target.value)} className="block w-full" /></label>
            <label className="ed-label"><RLabel>μδ (mas/yr)</RLabel><input data-testid="real-pmdec" value={pmdStr} onChange={(e) => setPmdStr(e.target.value)} className="block w-full" /></label>
          </div>
          <button type="button" data-testid="real-apply" onClick={applyManual} className="ed-btn is-sm is-block mt-4">{t('real.target.apply')}</button>
        </div>
        <div className={msg || manualOpen ? 'mt-3 min-h-[16px] text-[11px] leading-snug text-[#93A6CC]' : 'hidden'} data-testid="real-msg">{msg ? t(msg.k, msg.p) : t('real.target.hint')}</div>
      </Card>

      <Card title={t('real.fetch.title')} tip="tip.real.fetch" icon={<span>2</span>}>
        <label className="ed-label mb-3 block" data-testid="real-fov-wrap"><span className="mb-1 block">{t('real.fov.label')}</span>
          <select data-testid="real-fov" value={String(opts.sizeArcmin)} onChange={(e) => setOpts((o) => ({ ...o, sizeArcmin: Number(e.target.value) }))} className="block w-full">
            {Array.from(new Set([3, 6, 10, 15, 20, 30, opts.sizeArcmin])).sort((a, b) => a - b).map((v) => (<option key={v} value={String(v)}>{`${v}′ (${(v / 60).toFixed(3)}°)`}</option>))}
          </select>
          <span className="mt-1 block text-[10.5px] normal-case leading-snug tracking-normal text-[#667BA3]">{t('real.fov.hint')}</span>
        </label>
        <button type="button" data-testid="real-fetch" disabled={busy} onClick={runFetch} className="ed-btn ed-go is-primary is-block">
          {busy ? t('real.fetch.busy') : t('real.fetch.btn')}
        </button>
        {busy && (
          <div className="mt-3 space-y-2" data-testid="real-progress">
            <div className="ed-bar"><i style={{ width: `${phase === 'query' ? 8 : phase === 'build' ? 60 : prog.total ? Math.round((prog.done / prog.total) * 100) : 0}%` }} /></div>
            <div className="flex items-center justify-between gap-3 text-[11px] text-[#93A6CC]">
              <span className="spx-pulse">{busyText}</span>
              {phase !== 'build' && <button type="button" data-testid="real-cancel" onClick={cancel} className="ed-link">✕ {t('real.fetch.cancel')}</button>}
            </div>
          </div>
        )}
        <div className="mt-3 text-[10.5px] leading-snug text-[#667BA3]" data-testid="real-release">
          <span className="ed-label" style={{ color: 'var(--acc)' }}>{t('rel.title')}</span> · {t('rel.live')}
          {archive && <div className="ed-mono mt-1 text-[#93A6CC]" data-testid="real-release-latest">{t('rel.latest', { date: archive.date, n: archive.n })}</div>}
          <div className="mt-1">{t('rel.note')}</div>
        </div>
        {plan && !busy && <div className="ed-mono mt-3 text-[10.5px] text-[#93A6CC]" data-testid="real-plan">{t('real.fetch.plan', { total: plan.total, planned: plan.planned, size: plan.sizeArcmin.toFixed(1) })}</div>}
        {fails.length > 0 && !err && <div className="ed-note-box is-warn mt-3 text-[11px]" data-testid="real-fails">{t('real.fetch.fails', { n: fails.length, why: t('real.err.' + (ERR_KEYS.indexOf(fails[0].code) >= 0 ? fails[0].code : 'GENERIC'), { detail: fails[0].detail || '', status: fails[0].status || '' }) })}</div>}
        {err && (
          <div ref={errBoxRef} className="ed-note-box is-warn mt-3 space-y-2 text-[11.5px] leading-snug" data-testid="real-error" data-code={err.code}>
            <div className="ed-label" style={{ color: '#E3B567' }}>◆ {t('real.err.title')}</div>
            <div>{t('real.err.' + errKey, { detail: err.detail || '', status: err.status || '' })}</div>
            {netFail && fbActions('real-err', false)}
            {netFail && <div className="text-[#EEF3FD]/80">{t('real.err.fix')}</div>}
            {netFail && <a href={IRSA_EXPLORER} target="_blank" rel="noopener noreferrer" data-testid="real-explorer" className="ed-link" style={{ color: 'var(--acc)' }}>{t('real.err.explorer')} ↗</a>}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5" data-testid="real-net" data-state={net.s}>
          <Chip color={netCol}>{net.s === 'ok' ? t('real.net.ok') : net.s === 'fail' ? t('real.net.fail') : net.s === 'warn' ? t('real.net.warn') : net.s === 'checking' ? t('real.net.checking') : t('real.net.unknown')}</Chip>
          <button type="button" data-testid="real-ping" onClick={ping} className="ed-link">{t('real.net.retest')}</button>
        </div>
        {net.s === 'fail' && !err && !exps.length && !busy && (
          <div className="ed-note-box is-warn mt-3 text-[11.5px] leading-snug" data-testid="real-net-box">{fbActions('real-net', true)}</div>
        )}
        <div className="mt-4 flex items-center gap-2">
          <button type="button" data-testid="real-upload" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()} className="ed-btn is-sm flex-1"><span aria-hidden>↑</span>{t('real.file.btn')}</button>
          <input ref={fileRef} data-testid="real-file" type="file" multiple accept=".fits,.fit,.fz,.gz,.fits.gz,application/fits" className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
          <InfoTip id="tip.real.file" title={t('real.file.btn')} />
        </div>
      </Card>

      <Card title={t('ov.title')} tip="tip.real.overlay" icon={<span>3</span>}>
        <div className="flex flex-wrap items-center gap-2" data-testid="real-overlays">
          {['gaia', 'wise'].map((k) => {
            const st = ovd[k];
            const stTxt = !ovl[k] ? '' : st.st === 'loading' ? t('ov.st.loading') : st.st === 'ok' ? t('ov.st.ok', { n: st.list.length }) : st.st === 'fail' ? t('ov.st.fail') : '';
            return (
              <button key={k} type="button" data-testid={`real-ov-${k}`} aria-pressed={ovl[k]} data-state={ovl[k] ? st.st : 'off'} onClick={() => setOvl((o) => ({ ...o, [k]: !o[k] }))} className="ed-pill" style={{ '--pc': OVERLAY_SURVEYS[k].color }}>
                <span aria-hidden>{ovl[k] ? '✓' : '○'}</span>{t('ov.' + k)}{stTxt ? <span className="ed-mono ml-1.5 text-[10px] opacity-80" data-testid={`real-ov-${k}-st`}>{stTxt}</span> : null}
              </button>
            );
          })}
          <button type="button" data-testid="real-ov-flags" aria-pressed={ovl.flags} onClick={() => setOvl((o) => ({ ...o, flags: !o.flags }))} className="ed-pill" style={{ '--pc': '#F0587A' }}><span aria-hidden>{ovl.flags ? '✓' : '○'}</span>{t('ov.flags')}</button>
        </div>
        <div className="mt-3 text-[10.5px] leading-snug text-[#667BA3]">{t('ov.note')}</div>
      </Card>

      <Card title={t('share.title')} tip="tip.real.share" icon={<span>4</span>}>
        <textarea ref={shareRef} readOnly rows={3} className="ed-share" data-testid="real-share-link" value={shareUrl} onFocus={(e) => e.target.select()} aria-label={t('share.link')} />
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" data-testid="real-share-copy" onClick={() => copyText(shareUrl, 'link')} className="ed-btn is-sm">{copied === 'link' ? '✓ ' + t('share.copied') : t('share.link')}</button>
          <button type="button" data-testid="real-share-embed" onClick={() => copyText(embedCode, 'embed')} className="ed-btn is-sm">{copied === 'embed' ? '✓ ' + t('share.copied') : t('share.embed')}</button>
        </div>
        {copied === 'fail' && <div className="mt-2 text-[11px] text-[#E3B567]" data-testid="real-share-fail">{t('share.fail')}</div>}
        <div className="mt-3 text-[10.5px] leading-snug text-[#667BA3]">{t('share.hint')}</div>
      </Card>

      <Disclosure title={t('real.set.title')} tip="tip.real.settings" open={setOpen} onToggle={() => setSetOpen((o) => !o)} testId="real-settings-toggle">
        <div className="space-y-4" data-testid="real-settings">
          <Slide label={t('real.set.perDet')} tip="tip.real.perDet" value={opts.perDet} min={1} max={4} step={1} onChange={(v) => setOpts((o) => ({ ...o, perDet: v }))} fmt={(v) => `${v} × 6`} />
          <Slide label={t('real.set.size')} tip="tip.real.size" value={opts.sizeArcmin} min={3} max={REAL_FOV_MAX} step={1} onChange={(v) => setOpts((o) => ({ ...o, sizeArcmin: v }))} fmt={(v) => `${v}′`} />
          <Slide label={t('real.set.rAp')} tip="tip.real.rAp" value={opts.rAp} min={1.5} max={4.5} step={0.1} onChange={(v) => setOpts((o) => ({ ...o, rAp: v }))} fmt={(v) => `${v.toFixed(1)} px`} />
          <Slide label={t('real.set.stretch')} value={opts.stretch} min={0.6} max={2.6} step={0.1} onChange={(v) => setOpts((o) => ({ ...o, stretch: v }))} fmt={(v) => v.toFixed(1)} />
          <Slide label={t('real.set.thr')} value={opts.thr} min={1.5} max={8} step={0.5} onChange={(v) => setOpts((o) => ({ ...o, thr: v }))} fmt={(v) => `${v.toFixed(1)}σ`} />
          <label className="flex cursor-pointer items-center gap-2.5 text-[11.5px] text-[#C5D3EE]">
            <input type="checkbox" data-testid="real-mask" checked={opts.useMask} onChange={(e) => setOpts((o) => ({ ...o, useMask: e.target.checked }))} />{t('real.set.mask')}<InfoTip id="tip.real.mask" title={t('real.set.mask')} />
          </label>
          <label className="ed-label block"><span className="mb-1 flex items-center gap-1.5">{t('real.set.base')}<InfoTip id="tip.real.base" title={t('real.set.base')} /></span>
            <div className="flex items-end gap-3">
              <input data-testid="real-base" value={baseStr} onChange={(e) => applyBase(e.target.value)} className="block w-full" spellCheck={false} />
              <button type="button" onClick={() => applyBase(IRSA_DEFAULT)} className="ed-link shrink-0">{t('real.set.reset')}</button>
            </div>
          </label>
        </div>
      </Disclosure>
    </div>
  );

  /* ================= SAHNE ================= */
  const capNode = (
    <div data-testid="real-center">
      <div className="ed-cap">
        <span className="ed-cap-name">{target.name}</span>
        <span className="ed-mono ed-cap-co">{fmtRA(target.ra, 1)} {fmtDec(target.dec, 0)}</span>
        {source === 'demo' && exps.length > 0 ? <Chip color="#F0587A" title={t('real.demo.banner')}>{t('real.demo.chip')}</Chip> : <Chip color="#8FE0B5">{t('real.badge')}</Chip>}
        {exps.length > 0 && <Chip color="#A9C4F5" title={t('real.chip.exps', { n: exps.length })}>{t('real.chip.exps', { n: exps.length })}</Chip>}
        {source === 'file' && exps.length > 0 && <Chip color="#D4E2FB">{t('real.chip.file')}</Chip>}
        <span className="ed-cap-r"><a href={aladin} target="_blank" rel="noreferrer" data-testid="real-aladin" className="ed-link" style={{ color: 'var(--acc)' }}>Aladin · HiPS ↗</a><InfoTip id="tip.real.aladin" title="Aladin" /></span>
      </div>
      {source === 'demo' && exps.length > 0 && (
        <div className="ed-note-box is-bad mb-2 text-[11px] leading-snug" role="note" data-testid="real-demo-banner">◆ {t('real.demo.banner')}</div>
      )}
      {dLamWarn && <div className="ed-note-box is-warn mb-2 text-[11px] leading-snug" data-testid="real-lam-warn">◆ {t('real.warn.lam', { a: lams[iaC].toFixed(2), b: lams[ibC].toFixed(2) })}</div>}
    </div>
  );
  const stageNode = (
    <div className="absolute inset-0" data-testid="real-stage">
      <div ref={boxRef} className="absolute inset-0 grid place-items-center" data-testid="real-canvas-box">
        <div className="ed-frame" style={{ width: size, height: size }}>
          <canvas ref={canvasRef} data-testid="real-canvas" style={{ width: size, height: size, touchAction: zpTouch(zp.view.z) }} onClick={onCanvasClick} className="block cursor-crosshair" aria-label={t('real.canvas.aria')} title={exps.length ? t('zp.hint') : undefined} />
          {exps.length > 0 && <ZoomCtl prefix="real" zp={zp} />}
          {!exps.length && (
            <div className="absolute inset-0 grid place-items-center overflow-y-auto p-6 text-center" data-testid="real-empty">
              {err && phase === 'error' ? (
                <div className="ed-empty" data-testid="real-empty-error">
                  <div className="ed-label" style={{ color: '#E3B567' }}>◆ NO SIGNAL</div>
                  <h3 style={{ fontSize: 22 }}>{t('real.err.title')}</h3>
                  <p className="text-[12px] leading-relaxed text-[#EBCF9F]">{t('real.err.' + errKey, { detail: err.detail || '', status: err.status || '' })}</p>
                  {netFail && <p className="mt-2 text-[11.5px] leading-relaxed text-[#93A6CC]">{t('real.err.fix')}</p>}
                  {netFail && <a href={IRSA_EXPLORER} target="_blank" rel="noopener noreferrer" data-testid="real-explorer-center" className="ed-link mt-2" style={{ color: 'var(--acc)' }}>{t('real.err.explorer')} ↗</a>}
                  <div className="mt-5 flex flex-wrap justify-center gap-3">
                    <button type="button" data-testid="real-empty-upload" onClick={() => fileRef.current && fileRef.current.click()} className="ed-btn is-sm">{t('real.file.btn')}</button>
                    {netFail && <button type="button" data-testid="real-empty-demo" disabled={busy} onClick={runDemo} className="ed-btn is-sm is-warn">{t('real.fb.demo')}</button>}
                    <button type="button" data-testid="real-empty-sky" onClick={() => app.setRealPane('sky')} className="ed-btn is-sm is-ok">{t('pane.sky')}</button>
                    <button type="button" data-testid="real-empty-map" onClick={() => app.setView('map')} className="ed-btn ed-go is-sm">{t('tab.map')}</button>
                  </div>
                </div>
              ) : (
                <div className="ed-empty">
                  <img className="nx-watermark" src={NYXE_LOGO} alt="" width="86" height="86" />
                  <div className="ed-label" style={{ color: 'var(--acc)' }}>◌ 00</div>
                  <h3>{t('real.empty.title')}</h3>
                  <p className="text-[12px] leading-relaxed text-[#93A6CC]">{t('real.empty.body')}</p>
                  <button type="button" data-testid="real-empty-fetch" disabled={busy} onClick={runFetch} className="ed-btn ed-go is-sm is-primary mt-4">{t('real.fetch.btn')}</button>
                </div>
              )}
            </div>
          )}
          {busy && (
            <div className="ed-veil">
              <div className="text-center"><div className="ed-spin mx-auto mb-4" /><div className="ed-label spx-pulse" style={{ color: 'var(--acc)' }}>{busyText}</div></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  /* ================= SAĞ ÇEKMECE ================= */
  const rightBody = (
    <div data-testid="real-right">
      {!diag && (
        <section className="ed-sec" data-testid="real-right-empty">
          <div className="ed-label" style={{ color: 'var(--acc)' }}>⌖ 00</div>
          <div className="ed-serif mt-3 text-[26px] italic leading-[1.1] text-[#EEF3FD]">{t('real.right.title')}</div>
          <p className="mt-3 text-[12px] leading-relaxed text-[#93A6CC]">{t('real.right.body')}</p>
        </section>
      )}
      {diag && (
        <>
          <section className={`ed-sec ${diag.verdict === 'moving-unexpected' ? 'spx-alert' : ''}`} style={{ borderLeft: `2px solid ${verdictCol}` }} data-testid="real-result" data-verdict={diag.verdict}>
            <div className="flex items-start gap-3">
              <span className="mt-1 text-[22px] leading-none" style={{ color: verdictCol }} aria-hidden>{diag.verdict === 'pm-confirmed' ? '✓' : diag.verdict === 'pm-differs' ? '◆' : diag.verdict === 'moving-unexpected' ? '✦' : '●'}</span>
              <div className="min-w-0 flex-1">
                <div className="ed-serif text-[22px] leading-[1.15] text-[#F5F8FF]" data-testid="real-verdict">{source === 'demo' ? t('real.demo.verdict') : t('real.verdict.' + diag.verdict)}</div>
                <div className="ed-mono mt-1 text-[10.5px] text-[#9895AA]">{t('real.count', { exp: diag.nExp, det: diag.nDet, mask: diag.nMasked, out: diag.nOutside })}</div>
              </div>
              <InfoTip id="tip.real.result" title={t('real.result.title')} />
            </div>
            <div className="mt-4 space-y-3" data-testid="real-reasons">
              {explain.items.map((it, i) => (
                <div key={i} className="ed-reason">
                  <div className="text-[13px] leading-snug text-[#F5F8FF]"><span aria-hidden style={{ color: 'var(--acc)' }}>{it.emoji}</span> {it.head}</div>
                  {it.measured ? <div className="ed-mono mt-1 text-[10.5px] leading-snug text-[#9895AA]">{it.measured}</div> : null}
                  <div className="mt-1.5 text-[12px] leading-relaxed text-[#C9C6D6]"><b className="font-medium text-[#E3B567]">{t('why.cause')}</b> {it.cause}</div>
                </div>
              ))}
            </div>
            {diag.nOutside === diag.nExp && source === 'file' && (
              <button type="button" data-testid="real-use-center" onClick={fileCenterToTarget} className="ed-btn is-sm is-warn is-block mt-4">{t('real.file.useCenter')}</button>
            )}
          </section>

          <section className="ed-sec">
            <div className="grid grid-cols-2 gap-x-5" data-testid="real-stats">
              <Stat label={t('real.st.mu')} tip="tip.real.st.mu" value={mo.valid ? `${fmtMu(mo.mu)}″/yr` : '—'} sub={mo.valid ? `PA ${fx(mo.pa, 0)}° · ±${fmtMu(mo.sigMu)} · ${fx(mo.sigma, 0)}σ` : t('real.st.needMore')} color="#A9C4F5" />
              <Stat label={t('real.st.cat')} tip="tip.real.st.cat" value={mo.cat ? `${fmtMu(mo.cat.mu)}″/yr` : target.pmra || target.pmdec ? `${fmtMu(Math.hypot(target.pmra, target.pmdec) / 1000)}″/yr` : '0″/yr'} sub={mo.valid && mo.cat ? t('real.st.diff', { s: fx(mo.dSigma, 1) }) : ''} color="#E3B567" />
              <Stat label={t('real.st.lamRange')} value={isFinite(diag.lamMin) ? `${fx(diag.lamMin, 2)}–${fx(diag.lamMax, 2)} µm` : '—'} sub={t('real.st.counts', { n: diag.nDet, m: diag.nExp })} />
              <Stat label={t('real.st.T')} tip="tip.real.st.T" value={diag.sed ? `${Math.round(diag.sed.T / 50) * 50} K` : '—'} sub={diag.sed ? t('real.st.Tsub', { n: diag.sed.n }) : t('real.st.needMore')} color="#F0587A" />
              <Stat label={t('real.st.base')} value={mo.valid ? `${fx(mo.baselineDays, 0)} d` : '—'} sub={mo.valid ? `χ²ᵣ ${fx(mo.chi2red, 2)}` : ''} />
              <Stat label={t('real.st.snr')} value={isFinite(medSnr) ? fx(medSnr, 0) : '—'} sub={t('real.st.snrSub', { r: opts.rAp.toFixed(1) })} />
            </div>
          </section>

          <Card title={t('real.sed.title')} tip="tip.real.sed" icon={<span>3</span>}>
            <RealSedChart pts={meas} fit={diag.sed ? { T: diag.sed.T, A: diag.sed.A } : null} />
          </Card>

          {mo.valid && (
            <Card title={t('real.track.title')} tip="tip.real.track" icon={<span>4</span>}>
              <RealTrackChart motion={mo} />
              <div className="mt-2 text-[10.5px] text-[#667BA3]">{t('real.track.legend')}</div>
            </Card>
          )}

          {exps[flagIdx] && (() => {
            const e = exps[flagIdx];
            const fs = flagSum;
            const rows = fs ? SPHEREX_FLAGS.map((f, q) => ({ f, a: fs.all[q], b: fs.ap[q] })).filter((r) => r.a > 0) : [];
            const warn = fs ? SPHEREX_FLAGS.filter((f, q) => f.kind !== 'info' && fs.ap[q] > 0 && f.kind === 'contam').map((f) => f.name) : [];
            const badAp = fs ? SPHEREX_FLAGS.filter((f, q) => f.kind === 'bad' && fs.ap[q] > 0).map((f) => f.name) : [];
            return (
              <Card title={t('flag.title')} tip="tip.real.flags" icon={<span>5</span>}>
                <div data-testid="real-flags">
                  <div className="ed-label mb-2" style={{ color: 'var(--acc)' }}>{t('flag.exp', { n: flagIdx + 1 })}</div>
                  {[
                    [t('flag.meta.id'), shortName(e.did || e.name || e.id || '—', 30)],
                    [t('flag.meta.det'), e.det],
                    [t('flag.meta.lam'), isFinite(lams[flagIdx]) ? `${lams[flagIdx].toFixed(3)} µm` : '—'],
                    [t('flag.meta.time'), String(e.iso || '').replace('T', ' ').slice(0, 19)],
                    [t('flag.meta.size'), `${e.w}×${e.h} px`],
                    [t('flag.meta.scale'), `${(e.scale || 0).toFixed(2)}″/px`],
                    [t('flag.meta.zodi'), isFinite(e.zodiMean) ? `${e.zodiMean.toFixed(2)} MJy/sr` : '—'],
                  ].map(([a, b]) => (<div key={a} className="ed-metarow"><span>{a}</span><span className="truncate" title={String(b)}>{b}</span></div>))}
                  <div className="mt-3 text-[11px] leading-snug text-[#93A6CC]" data-testid="real-flags-sum">
                    {fs ? t('flag.sum', { a: fs.anyAll, t: fs.total, p: ((100 * fs.anyAll) / Math.max(1, fs.total)).toFixed(1), b: fs.anyAp, c: fs.nAp }) : t('flag.none')}
                  </div>
                  {rows.length ? (
                    <div className="mt-2" data-testid="real-flags-list">
                      {rows.map(({ f, a, b }) => (
                        <div key={f.name} className="ed-flagrow" title={`${f.d} — ${t('flag.kind.' + f.kind)}`}>
                          <i style={{ background: FLAG_KIND_COLOR[f.kind] }} />
                          <b>{f.name}</b>
                          <span className="is-n">{a}</span>
                          <span className="is-n" style={b ? { color: FLAG_KIND_COLOR[f.kind] } : undefined}>{b ? `◎ ${b}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {warn.length > 0 && <div className="ed-note-box is-warn mt-3 text-[11px] leading-snug" data-testid="real-flags-warn">◆ {t('flag.warn', { names: warn.join(', ') })}</div>}
                  {badAp.length > 0 && !warn.length && <div className="ed-note-box is-warn mt-3 text-[11px] leading-snug">◆ {t('flag.warn', { names: badAp.join(', ') })}</div>}
                  <div className="mt-3 text-[10.5px] leading-snug text-[#667BA3]">{t('flag.legend')}</div>
                </div>
              </Card>
            );
          })()}

          <Disclosure title={t('real.table.title')} tip="tip.real.table" open={tblOpen} onToggle={() => setTblOpen((o) => !o)} testId="real-table-toggle">
            <RealTable meas={meas} sel={iaC} onPick={(i) => setIa(i)} />
          </Disclosure>

          {mode === 'diff' && (
            <Card title={t('real.cand.title')} tip="tip.real.cand" icon={<span>5</span>}>
              {cands && cands.cands.length ? (
                <ul data-testid="real-cands">
                  {cands.cands.map((c, i) => (
                    <li key={i}><button type="button" data-testid="real-cand" onClick={() => { setProbe({ ra: c.ra, dec: c.dec }); setProbeNet(null); }} className="ed-row ed-mono flex items-center gap-3 text-[11px] text-[#EEF3FD]">
                      <span className="text-[10px] text-[#E3B567]">{edPad(i + 1)}</span>{fmtRA(c.ra, 1)} {fmtDec(c.dec)}<span className="ml-auto text-[#E3B567]">{c.sigma.toFixed(0)}σ {c.sign > 0 ? '+' : '−'}</span></button></li>
                  ))}
                </ul>
              ) : <div className="text-[11.5px] text-[#667BA3]">{iaC === ibC ? t('real.diff.need') : t('real.cand.none')}</div>}
              <div className="mt-2 text-[10.5px] text-[#667BA3]">{t('real.cand.note')}</div>
            </Card>
          )}

          {probe && (
            <Card title={t('real.probe.title')} tip="tip.real.probe" icon={<span>6</span>}>
              <div className="ed-mono text-[11.5px] text-[#EEF3FD]" data-testid="real-probe">{fmtRA(probe.ra, 1)} {fmtDec(probe.dec)}<span className="block text-[10.5px] text-[#667BA3]">{probe.ra.toFixed(5)}° {probe.dec.toFixed(5)}°</span>
                {probe.src && <span className="block text-[10.5px]" style={{ color: OVERLAY_SURVEYS[probe.src.key].color }} data-testid="real-probe-src">{t('ov.src', { name: OVERLAY_SURVEYS[probe.src.key].name, id: probe.src.id || '—', mag: isFinite(probe.src.mag) ? probe.src.mag.toFixed(2) : '—' })}</span>}
              </div>
              {probeMeas && (
                <div className="mt-3" data-testid="real-probe-spec">
                  <div className="ed-label mb-1" style={{ color: 'var(--acc)' }}>{t('rspec.title')}</div>
                  <RealSedChart pts={probeMeas} fit={null} testId="real-probe-sed" />
                  <div className="mt-1 text-[10.5px] leading-snug text-[#667BA3]">{t('rspec.note')}</div>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" data-testid="real-probe-target" onClick={probeToTarget} className="ed-btn is-sm is-primary">{t('real.probe.measure')}</button>
                <button type="button" data-testid="real-probe-check" onClick={checkProbe} className="ed-btn is-sm">{t('live.check')}</button>
              </div>
              {probeNet && (
                <div className="mt-3 border-l pl-3 text-[11.5px] leading-snug" style={{ color: statusColor(probeNet.status), borderColor: statusColor(probeNet.status) + '99' }} data-testid="real-probe-net" data-status={probeNet.status}>
                  {netMessage(t, probeNet)}
                  {probeNet.simbad && probeNet.simbad.slice(0, 3).map((m, i) => (<div key={i} className="ed-mono mt-1 text-[10.5px] text-[#EEF3FD]/80">· {m.id} · {m.otype || '?'} · {m.sep.toFixed(1)}″</div>))}
                </div>
              )}
            </Card>
          )}

          <Card title={t('save.title')} tip="tip.real.save" icon={<span>7</span>}>
            {source === 'demo' ? (
              <div className="ed-note-box is-bad text-[11.5px] leading-snug" data-testid="real-nosave">{t('real.demo.nosave')}</div>
            ) : savedEntry ? (
              <div className="space-y-3" data-testid="real-saved">
                <div className="ed-note-box is-ok text-[12px] text-[#8FE0B5]">● {t('real.save.done', { id: savedEntry.id })}</div>
                <CatalogStatus app={app} entry={savedEntry} />
                <button type="button" data-testid="real-open-catalog" onClick={() => app.openInCatalog(savedEntry.objKey)} className="ed-btn ed-go is-block is-sm">{t('real.save.open')}</button>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="ed-label block"><RLabel>{t('save.cat')}</RLabel>
                  <select data-testid="real-save-cat" value={saveCat} onChange={(e) => setSaveCat(e.target.value)} className="block w-full">{['star'].concat(SAVE_CATS).map((c) => (<option key={c} value={c}>{CAT_EMOJI[c]} {t('cat.' + c)}</option>))}</select></label>
                <textarea data-testid="real-save-note" rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={t('notes.ph')} className="spx-scroll block w-full resize-y" />
                <button type="button" data-testid="real-save-btn" onClick={saveReal} className="ed-btn ed-go is-primary is-block">{t('save.btn')}</button>
              </div>
            )}
          </Card>
        </>
      )}
      <section className="ed-sec"><RealCredit /></section>
    </div>
  );

  /* ================= ALT HUD ================= */
  const hudNode = (
    <>
      <HudRow>
        <HudCell label={t('modes.title')} long grow>
          <div className="ed-seg-compact flex flex-wrap items-center gap-x-2 gap-y-2" role="tablist" aria-label={t('modes.title')}>
            {REAL_MODES.map((m, i) => (
              <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} data-testid={`real-mode-${m.id}`} onClick={() => setMode(m.id)} title={`${t('real.mode.' + m.id + '.s')} · ${i + 1}`} className="ed-segbtn">
                <i>{i + 1}</i>{t('real.mode.' + m.id + '.n')}
              </button>
            ))}
            <InfoTip id={'tip.real.mode.' + mode} title={t('real.mode.' + mode + '.n')} />
          </div>
        </HudCell>
        {mode === 'blink' && exps.length > 1 && (
          <HudCell>
            <button type="button" data-testid="real-play" onClick={() => setPlaying((p) => !p)} className="ed-link"><span aria-hidden>{playing ? '❙❙' : '▶'}</span>{playing ? t('ctl.pause') : t('ctl.play')}</button>
          </HudCell>
        )}
      </HudRow>
      {mode === 'movie' && exps.length > 1 && (
        <>
          <HudRow>
            <HudCell grow testId="real-movie">
              <div className="ed-mv w-full">
                <button type="button" className="zp-btn" data-testid="real-movie-first" aria-label={t('mv.first')} title={t('mv.first')} onClick={() => { setMplay(false); setFi(0); }}>⏮</button>
                <button type="button" className="zp-btn" data-testid="real-movie-prev" aria-label={t('mv.prev')} title={t('mv.prev')} onClick={() => { setMplay(false); setFi((v) => Math.max(0, v - 1)); }}>◀</button>
                <button type="button" className="zp-btn" data-testid="real-movie-play" aria-pressed={mplay} aria-label={mplay ? t('mv.pause') : t('mv.play')} title={mplay ? t('mv.pause') : t('mv.play')} onClick={() => { if (!mplay && fiC >= movieIdx.length - 1) setFi(0); setMplay((p) => !p); }}>{mplay ? '❙❙' : '▶'}</button>
                <button type="button" className="zp-btn" data-testid="real-movie-next" aria-label={t('mv.next')} title={t('mv.next')} onClick={() => { setMplay(false); setFi((v) => Math.min(movieIdx.length - 1, v + 1)); }}>▶︎|</button>
                <button type="button" className="zp-btn" data-testid="real-movie-last" aria-label={t('mv.last')} title={t('mv.last')} onClick={() => { setMplay(false); setFi(movieIdx.length - 1); }}>⏭</button>
                <input type="range" className="spx-range min-w-[90px] flex-1" data-testid="real-movie-scrub" min={0} max={Math.max(0, movieIdx.length - 1)} step={1} value={fiC} onChange={(e) => { setMplay(false); setFi(Number(e.target.value)); }} aria-label={t('mv.scrub')} />
                <span className="ed-mv-n" data-testid="real-movie-frame">{t('mv.frame', { i: fiC + 1, n: movieIdx.length })}</span>
              </div>
            </HudCell>
          </HudRow>
          <HudRow>
            <HudCell grow>
              <label className="ed-label flex items-center gap-2">{t('mv.speed')}
                <select data-testid="real-movie-speed" value={fpsI} onChange={(e) => setFpsI(Number(e.target.value))}>{MV_FPS.map((f, i) => (<option key={f} value={i}>{f} fps</option>))}</select></label>
              <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-[#C5D3EE]"><input type="checkbox" data-testid="real-movie-loop" checked={mloop} onChange={(e) => setMloop(e.target.checked)} />{t('mv.loop')}</label>
              <label className="ed-label flex items-center gap-2">{t('mv.det')}
                <select data-testid="real-movie-det" value={mdet} onChange={(e) => { setMdet(e.target.value); setFi(0); }}><option value="all">{t('mv.det.all')}</option>{detList.map((d) => (<option key={d} value={d}>{d}</option>))}</select></label>
              <label className="ed-label flex items-center gap-2">{t('mv.order')}
                <select data-testid="real-movie-order" value={mord} onChange={(e) => { setMord(e.target.value); setFi(0); }}><option value="time">{t('mv.order.time')}</option><option value="lam">{t('mv.order.lam')}</option></select></label>
              <InfoTip id="mv.note" title={t('real.mode.movie.n')} />
            </HudCell>
          </HudRow>
        </>
      )}
      {mode === 'sum' && exps.length > 0 && (
        <HudRow>
          <HudCell label={t('sum.op')} long grow testId="real-sum">
            <div className="flex flex-wrap items-center gap-x-4" role="group" aria-label={t('sum.op')}>
              {SUM_OPS.map((o) => (
                <button key={o} type="button" className="ed-segbtn" data-testid={`real-sum-${o}`} aria-pressed={sop === o} onClick={() => setSop(o)}>{t('sum.op.' + o)}</button>
              ))}
              {sop === 'det' && (
                <select data-testid="real-sum-detsel" aria-label={t('mv.det')} value={sdetC} onChange={(e) => setSdet(e.target.value)}>{detList.map((d) => (<option key={d} value={d}>{d}</option>))}</select>
              )}
            </div>
            <div className="mt-1 w-full text-[10.5px] leading-snug text-[#93A6CC]" data-testid="real-sum-info">
              {sop === 'mosaic' ? t('sum.op.mosaic') : sumIdx.length >= 2 ? t('sum.info', { n: sumIdx.length, g: Math.sqrt(sumIdx.length).toFixed(1) }) : t('sum.need')}
            </div>
          </HudCell>
        </HudRow>
      )}
      {exps.length > 1 && (mode === 'single' || mode === 'blink' || mode === 'diff' || (mode === 'sum' && sop === 'ab')) && (
        <HudRow>
          <HudCell label={t('real.pair.title')} long grow>
            <i className="ed-dot" style={{ background: '#F0587A' }} title={t('dates.d1')} />
            <select data-testid="real-sel-a" aria-label={t('dates.d1')} value={iaC} onChange={(e) => setIa(Number(e.target.value))} className="min-w-0 max-w-[300px] flex-1">{exps.map((e, i) => (<option key={i} value={i}>{expLabel(i)}</option>))}</select>
            <span className="text-[#667BA3]" aria-hidden>→</span>
            <i className="ed-dot" style={{ background: '#5B9DFF' }} title={t('dates.d2')} />
            <select data-testid="real-sel-b" aria-label={t('dates.d2')} value={ibC} onChange={(e) => setIb(Number(e.target.value))} className="min-w-0 max-w-[300px] flex-1">{exps.map((e, i) => (<option key={i} value={i}>{expLabel(i)}</option>))}</select>
            <InfoTip id="tip.real.pair" title={t('real.pair.title')} />
            <button type="button" data-testid="real-auto-pair" disabled={!nearPair} onClick={() => { if (nearPair) { setIa(nearPair.i); setIb(nearPair.j); } }} className="ed-btn is-sm is-bad">{t('real.pair.auto')}</button>
            {!nearPair && <span className="text-[10.5px] text-[#E3B567]">{t('real.pair.none')}</span>}
          </HudCell>
        </HudRow>
      )}
      <HudRow>
        <HudCell label={<span className="inline-flex items-center gap-1.5">{t('real.strip.title')}<InfoTip id="tip.real.strip" title={t('real.strip.title')} /></span>} long grow>
          {exps.length ? (
            <div className="spx-scroll flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1" data-testid="real-strip">
              {exps.map((e, i) => (
                <button key={i} type="button" data-testid="real-chip" onClick={(ev) => (ev.shiftKey ? setIb(i) : setIa(i))} title={expLabel(i)}
                  className="ed-mono shrink-0 border-l pl-2.5 pr-3 text-left text-[10px] leading-tight transition hover:text-white"
                  style={{ borderColor: i === iaC ? '#F0587A' : i === ibC && mode !== 'single' ? '#5B9DFF' : 'rgba(255,255,255,.12)', color: i === iaC ? '#F0587A' : i === ibC && mode !== 'single' ? '#5B9DFF' : '#9895AA' }}>
                  <span style={{ color: detColor(e.det) }}>● {e.det}</span> {isFinite(lams[i]) ? lams[i].toFixed(2) : '—'}µm<br />{dayOf(e.iso)}
                </button>
              ))}
            </div>
          ) : <div className="text-[11.5px] text-[#667BA3]">{t('real.strip.none')}</div>}
        </HudCell>
      </HudRow>
    </>
  );

  return (
    <ViewFrame active={active} testId="view-real" cap={capNode} stage={stageNode} expandable
      left={<Drawer side="l" open={dr.lo} onToggle={dr.toggleL} label={t('ed.controls')} index="01" testId="left-panel" tabId="drawer-l">{leftBody}</Drawer>}
      right={<Drawer side="r" open={dr.ro} onToggle={dr.toggleR} label={t('ed.analysis')} index="02" testId="right-panel" tabId="drawer-r">{rightBody}</Drawer>}
      hud={hudNode}
      />
  );
}

/* =====================================================================
   BÖLÜM 20b — GERÇEK GÖKYÜZÜ PANELİ  (CDS 2MASS/AllWISE fotoğrafı · SIMBAD · yerel FITS/PNG/JPG)
   + RealHub: "Gerçek Veri" sekmesinin iki paneli (Gökyüzü fotoğrafı ⇄ SPHEREx pikselleri)
   ===================================================================== */
const OBJ_EMOJI = { pm: '◈', bd: '●', gal: '◎', neb: '◌', pl: '◍', var: '✺', star: '★' };
const SKY_EPOCH_MARKS = [[1999.0, '2MASS'], [2010.4, 'AllWISE'], [SPHEREX_YEAR, 'SPHEREx']];
const SKY_OBJ_LABELS = 6;
const skyReason = (e) => (e && e.code === 'TIMEOUT' ? 'timeout' : 'blocked');
const shortName = (s, n = 24) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
// ?ra=&dec=&fov= → galeri hedefi (yakınsa özdevinimiyle) ya da serbest koordinat
function skyTargetFromUrl(u) {
  if (!u || !u.target) return null;
  for (let i = 0; i < SKY_GALLERY.length; i++) {
    const it = SKY_GALLERY[i].items.find((x) => angSepArcsec(x.ra, x.dec, u.target.ra, u.target.dec) < 120);
    if (it) return { ...it, fov: u.fov || it.fov };
  }
  return { id: 'url', name: u.name || `${fmtRA(u.target.ra, 1)} ${fmtDec(u.target.dec, 0)}`, ra: u.target.ra, dec: u.target.dec, pmra: 0, pmdec: 0, epoch: 2000, fov: u.fov || 0.15 };
}

// Kare/ölçek çubuğu için yay uzunluğu seçimi
function niceArc(maxArcsec) {
  const opts = [5, 10, 30, 60, 120, 300, 600, 1200, 3600];
  let best = opts[0];
  for (const o of opts) if (o <= maxArcsec) best = o;
  return best;
}
const arcLabel = (a) => (a >= 60 ? `${a / 60}′` : `${a}″`);

function haloText(ctx, txt, x, y) {
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(2,4,10,.85)'; ctx.strokeText(txt, x, y);
  ctx.fillText(txt, x, y);
}
// İşaretleri çizer. items: [{ob, x, y, trail?, ticks?, rank}] (aygıt pikseli)
function drawSkyItems(ctx, items, W, H, o) {
  const { dpr, sel, hov, trails, labels, hits } = o;
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${10.5 * dpr}px ${FONT_STACK}`;
  items.forEach((it) => {
    const { ob } = it;
    const cat = otypeCat(ob.otype);
    const col = SKY_CAT_COLOR[cat];
    const pm = !!it.trail && Math.hypot(it.trail[2] - it.trail[0], it.trail[3] - it.trail[1]) > 4 * dpr;
    const isSel = sel === ob.id;
    const isHov = hov === ob.id;
    if (trails && it.trail && pm) {
      ctx.save();
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.strokeStyle = isSel || isHov ? 'rgba(255,200,110,.95)' : 'rgba(255,180,84,.45)';
      ctx.lineWidth = (isSel ? 1.8 : 1.2) * dpr;
      ctx.beginPath(); ctx.moveTo(it.trail[0], it.trail[1]); ctx.lineTo(it.trail[2], it.trail[3]); ctx.stroke();
      ctx.restore();
      if ((isSel || isHov) && it.ticks) {
        ctx.font = `600 ${9.5 * dpr}px ${FONT_STACK}`;
        it.ticks.forEach((tk) => {
          ctx.fillStyle = '#FFD9A0'; ctx.beginPath(); ctx.arc(tk.x, tk.y, 2.6 * dpr, 0, 6.2832); ctx.fill();
          ctx.fillStyle = '#FFD9A0'; haloText(ctx, `${tk.label} ${Math.round(tk.yr)}`, tk.x + 5 * dpr, tk.y + 9 * dpr);
        });
        ctx.font = `600 ${10.5 * dpr}px ${FONT_STACK}`;
      }
    }
    const inside = it.x >= -4 && it.y >= -4 && it.x <= W + 4 && it.y <= H + 4;
    if (!inside) return;
    const r = (pm ? 8 : 5.5) * dpr + (isSel ? 3 * dpr : 0);
    ctx.lineWidth = (isSel ? 2.4 : isHov ? 2.1 : 1.5) * dpr;
    ctx.strokeStyle = col; ctx.fillStyle = col + '22';
    ctx.beginPath(); ctx.arc(it.x, it.y, r, 0, 6.2832); ctx.fill(); ctx.stroke();
    if (isSel) {
      ctx.beginPath(); ctx.moveTo(it.x - r - 6 * dpr, it.y); ctx.lineTo(it.x - r + 1 * dpr, it.y); ctx.moveTo(it.x + r - 1 * dpr, it.y); ctx.lineTo(it.x + r + 6 * dpr, it.y);
      ctx.moveTo(it.x, it.y - r - 6 * dpr); ctx.lineTo(it.x, it.y - r + 1 * dpr); ctx.moveTo(it.x, it.y + r - 1 * dpr); ctx.lineTo(it.x, it.y + r + 6 * dpr); ctx.stroke();
    }
    if (hits) hits.push({ id: ob.id, x: it.x / dpr, y: it.y / dpr, r: r / dpr + 4 });
    const showLabel = isSel || isHov || (labels && (it.rank < SKY_OBJ_LABELS || objMu(ob) > 500));
    if (showLabel) {
      ctx.fillStyle = isSel || isHov ? '#FFFFFF' : '#DCE6F5';
      const lx = Math.min(it.x + r + 4 * dpr, W - 6 * dpr - ctx.measureText(shortName(ob.id)).width);
      haloText(ctx, shortName(ob.id), Math.max(4 * dpr, lx), clamp(it.y - r - 2 * dpr, 8 * dpr, H - 8 * dpr));
    }
  });
}
function drawScaleBar(ctx, W, H, dpr, arcsecPerPx) {
  const maxArc = W * arcsecPerPx * 0.22;
  const a = niceArc(maxArc);
  const len = a / arcsecPerPx;
  const x = 12 * dpr; const y = H - 14 * dpr;
  ctx.strokeStyle = '#DCE6F5'; ctx.lineWidth = 2 * dpr;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.moveTo(x, y - 4 * dpr); ctx.lineTo(x, y + 4 * dpr); ctx.moveTo(x + len, y - 4 * dpr); ctx.lineTo(x + len, y + 4 * dpr); ctx.stroke();
  ctx.fillStyle = '#DCE6F5'; ctx.font = `600 ${10.5 * dpr}px ${FONT_STACK}`; ctx.textBaseline = 'bottom';
  haloText(ctx, arcLabel(a), x + len / 2 - 8 * dpr, y - 6 * dpr);
}

function drawLiveScene(ctx, W, H, st) {
  const { dpr, photos, tog, fov, center, list, yr, lam, sel, hov, hits, loadingText } = st;
  // HiPS görüntüsü kare; geniş tuvalde "cover": kare, tuvali tam kaplayacak şekilde ortalanır (fazla kısım kırpılır).
  const S = Math.max(W, H);
  const ox = (W - S) / 2;
  const oy = (H - S) / 2;
  const zv = st.zv || ZP_HOME; const Z = zv.z;                          // ortak yakınlaştırma görünümü
  const mp = (x, y) => ({ x: (x - zv.cx * W) * Z + W / 2, y: (y - zv.cy * H) * Z + H / 2 });
  let drew = false;
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(Z, Z); ctx.translate(-zv.cx * W, -zv.cy * H);
  if (tog.photo && photos.status === 'ok') {
    const a = photos.nir; const b = photos.mir;
    const wgt = a && b ? skyBlend(lam) : b ? 1 : 0;
    ctx.imageSmoothingEnabled = true;
    if (a && wgt < 1) { ctx.globalAlpha = 1; ctx.drawImage(a.img, ox, oy, S, S); drew = true; }
    if (b && wgt > 0) { ctx.globalAlpha = wgt; ctx.drawImage(b.img, ox, oy, S, S); drew = true; }
    ctx.globalAlpha = 1;
  }
  if (!drew) {
    ctx.save(); ctx.translate(ox, oy); skyPlaceholder(ctx, S, center.ra); ctx.restore();
  }
  ctx.restore();
  if (!drew) {
    if (loadingText) {
      ctx.fillStyle = '#6F82A8'; ctx.font = `600 ${12 * dpr}px ${FONT_STACK}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(loadingText, W / 2, H / 2); ctx.textAlign = 'left';
    }
  }
  if (tog.objs && list.length) {
    const items = list.map((ob, rank) => {
      const at = (y) => { const p = objAt(ob, y); const q = skyToHips(p.ra, p.dec, center, fov, S); return mp(q.x + ox, q.y + oy); };
      const q = at(yr);
      const it = { ob, x: q.x, y: q.y, rank };
      if (hasPm(ob)) {
        const a = at(1999); const b = at(2030);
        it.trail = [a.x, a.y, b.x, b.y];
        it.ticks = SKY_EPOCH_MARKS.map(([y, label]) => { const qq = at(y); return { x: qq.x, y: qq.y, yr: y, label }; });
      }
      return it;
    });
    drawSkyItems(ctx, items, W, H, { dpr, sel, hov, trails: tog.trails, labels: tog.labels, hits });
  }
  drawScaleBar(ctx, W, H, dpr, (fov * 3600) / S / Z);
  ctx.fillStyle = '#FFFFFF'; ctx.font = `700 ${15 * dpr}px ${MONO_STACK}`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  haloText(ctx, yr.toFixed(1), W - 10 * dpr, H - 8 * dpr); ctx.textAlign = 'left';
}

function drawLocalScene(ctx, W, H, st) {
  const { dpr, off, fr, list, tog, sel, hov, hits, yrFrame } = st;
  const zv = st.zv || ZP_HOME; const Z = zv.z;
  const mp = (x, y) => ({ x: (x - zv.cx * W) * Z + W / 2, y: (y - zv.cy * H) * Z + H / 2 });
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(Z, Z); ctx.translate(-zv.cx * W, -zv.cy * H);
  if (off) { ctx.imageSmoothingEnabled = W * Z < off.width; ctx.drawImage(off, 0, 0, W, H); } else skyPlaceholder(ctx, W, 1);
  ctx.restore();
  if (fr && fr.wcs && tog.objs && list.length) {
    const sx = W / fr.w; const sy = H / fr.h;
    const items = list.map((ob, rank) => {
      const at = (y) => { const p = objAt(ob, y); const d = frameSkyToData(fr, p.ra, p.dec); const c = dataToCanvas(fr, d.i, d.j); return mp(c.x * sx, c.y * sy); };
      const q = at(yrFrame);
      const it = { ob, x: q.x, y: q.y, rank };
      if (hasPm(ob)) {
        const a = at(1999); const b = at(2030);
        it.trail = [a.x, a.y, b.x, b.y];
        it.ticks = SKY_EPOCH_MARKS.map(([y, label]) => { const c = at(y); return { x: c.x, y: c.y, yr: y, label }; });
      }
      return it;
    });
    drawSkyItems(ctx, items, W, H, { dpr, sel, hov, trails: tog.trails, labels: tog.labels, hits });
    const c0 = frameSky(fr, 0, 0); const c1 = frameSky(fr, fr.w - 1, 0);
    if (c0 && c1) drawScaleBar(ctx, W, H, dpr, angSepArcsec(c0.ra, c0.dec, c1.ra, c1.dec) / W / Z);
  }
}

/* ---------------- Atıf metinleri (resmî, değiştirilmemiş) ---------------- */
const CREDIT_2MASS = 'This publication makes use of data products from the Two Micron All Sky Survey, which is a joint project of the University of Massachusetts and the Infrared Processing and Analysis Center/California Institute of Technology, funded by the National Aeronautics and Space Administration and the National Science Foundation.';
const CREDIT_WISE = 'This publication makes use of data products from the Wide-field Infrared Survey Explorer, which is a joint project of the University of California, Los Angeles, and the Jet Propulsion Laboratory/California Institute of Technology, funded by the National Aeronautics and Space Administration.';
const CREDIT_SIMBAD = 'This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France.';
const CREDIT_HIPS = 'Sky images: hips2fits, a service provided by CDS (Strasbourg).';
function SkyCredit() {
  const { t } = useI18n();
  return (
    <div className="space-y-1.5 rounded-none border border-white/10  p-2.5 text-[10.5px] leading-snug text-[#93A6CC]" data-testid="sky-credit">
      <div className="font-medium text-[#C5D3EE]">{t('sky.credit.title')}</div>
      {[CREDIT_2MASS, CREDIT_WISE, CREDIT_SIMBAD, CREDIT_HIPS].map((s) => (<p key={s} lang="en">{s}</p>))}
    </div>
  );
}

/* =====================================================================
   SkyView
   ===================================================================== */
function SkyView({ app, active }) {
  const { t } = app;
  const mode = app.dataMode;
  const skyReport = app.skyReport;
  const lf = app.localFrames;
  const urlInit = app.urlInit;
  const [target, setTarget] = useState(() => skyTargetFromUrl(urlInit) || SKY_DEFAULT_TARGET);
  const [fov, setFov] = useState(() => (skyTargetFromUrl(urlInit) || SKY_DEFAULT_TARGET).fov || 0.15);
  const [catId, setCatId] = useState('ch');
  const [band, setBand] = useState(() => nearestBand(1.6));
  const [yr, setYr] = useState(SPHEREX_YEAR);
  const [tog, setTog] = useState({ photo: true, objs: true, trails: true, labels: true });
  const [photos, setPhotos] = useState({ status: 'idle', nir: null, mir: null });
  const [objs, setObjs] = useState({ status: 'idle', list: [] });
  const [lobjs, setLobjs] = useState({ status: 'idle', list: [] });
  const [catNonce, setCatNonce] = useState(0);
  const [sel, setSel] = useState(null);
  const [hov, setHov] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [nameQ, setNameQ] = useState('');
  const [msg, setMsg] = useState(null);
  const [advOpen, setAdvOpen] = useState(false);
  const [raStr, setRaStr] = useState('');
  const [decStr, setDecStr] = useState('');
  const [lmode, setLmode] = useState('single');
  const [lslot, setLslot] = useState('e1');
  const [phaseB, setPhaseB] = useState(false);
  const [lplay, setLplay] = useState(false);
  const [palette, setPalette] = useState('gray');
  const [stretch, setStretch] = useState('zasinh');
  const [box, setBox] = useState({ w: 0, h: 0 });
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const hitRef = useRef([]);
  const dr = useDrawers(true, true);
  const zp = useZoomPan(canvasRef, { enabled: true });

  const lam = BAND_LAMBDA[band];
  const wgt = skyBlend(lam);
  const center = useMemo(() => skyViewCenter(target), [target]);
  const cat = SKY_GALLERY.find((g) => g.id === catId) || SKY_GALLERY[0];

  /* ---------------- Canlı fotoğraf + SIMBAD (yalnızca canlı modda) ---------------- */
  useEffect(() => {
    if (mode !== 'live') return undefined;
    let alive = true;
    const c = skyViewCenter(target);
    setSel(null);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setPhotos({ status: 'fail', nir: null, mir: null, reason: 'offline' });
      setObjs({ status: 'fail', list: [] });
      skyReport(false, 'offline');
      return undefined;
    }
    setPhotos({ status: 'loading', nir: null, mir: null });
    setObjs({ status: 'loading', list: [] });
    let nok = 0; let nfail = 0;
    ['nir', 'mir'].forEach((key) => {
      withDeadline(loadSkyPhoto(key, c.ra, c.dec, fov, SKY_PX, { timeoutMs: 9000 }), 12000).then((r) => {
        if (!alive) return;
        nok++;
        setPhotos((p) => ({ ...p, [key]: r, status: 'ok' }));
        if (nok === 1) skyReport(true);
      }, (e) => {
        if (!alive) return;
        nfail++;
        setPhotos((p) => ({ ...p, [key]: null, [key + 'Err']: skyReason(e) }));
        if (nfail === 2 && nok === 0) {
          setPhotos({ status: 'fail', nir: null, mir: null, reason: skyReason(e) });
          skyReport(false, skyReason(e));
        }
      });
    });
    const rDeg = Math.max(0.08, fov * 0.6);
    simbadCone(c.ra, c.dec, rDeg).then((list) => {
      if (!alive) return;
      setObjs({ status: 'ok', list });
      simbadMags(c.ra, c.dec, rDeg).then((m) => { if (alive) setObjs((o) => ({ ...o, list: mergeMags(o.list.map((x) => ({ ...x })), m) })); }, () => { /* parlaklık isteğe bağlı */ });
    }, (e) => { if (alive) setObjs({ status: 'fail', list: [], reason: skyReason(e) }); });
    return () => { alive = false; };
  }, [target, fov, mode, app.liveNonce, catNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- Yerel çerçeveler: SIMBAD (WCS varsa, en iyi çaba) ---------------- */
  const baseFr = lf.e1 || lf.e2 || null;
  const lcenter = useMemo(() => (baseFr ? frameCenterSky(baseFr) : null), [baseFr]);
  useEffect(() => {
    if (mode !== 'local' || !lcenter) { setLobjs({ status: 'idle', list: [] }); return undefined; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setLobjs({ status: 'fail', list: [], reason: 'offline' }); return undefined; }
    let alive = true;
    setLobjs({ status: 'loading', list: [] });
    simbadCone(lcenter.ra, lcenter.dec, lcenter.radiusDeg).then((list) => { if (alive) setLobjs({ status: 'ok', list }); }, (e) => { if (alive) setLobjs({ status: 'fail', list: [], reason: skyReason(e) }); });
    return () => { alive = false; };
  }, [mode, lcenter, catNonce]);

  const curObjs = mode === 'local' ? lobjs : objs;
  const list = curObjs.list;
  const selObj = sel ? list.find((o) => o.id === sel) || null : null;

  /* ---------------- Yerel görünüm türetmeleri ---------------- */
  const canDiff = !!(lf.e1 && lf.e2);
  const eff = canDiff ? lmode : 'single';
  const slotShown = eff === 'blink' ? (phaseB ? 'e2' : 'e1') : (lf[lslot] ? lslot : (lf.e1 ? 'e1' : 'e2'));
  const diffRes = useMemo(() => {
    if (mode !== 'local' || eff !== 'diff' || !canDiff) return null;
    try {
      const a = downsampleFrame(lf.e1, 1024);
      const b = downsampleFrame(lf.e2, 1024);
      const df = diffFrames(a, b);
      return { a, df, rgba: diffToRgba(df) };
    } catch (e) { return { err: e }; }
  }, [mode, eff, canDiff, lf.e1, lf.e2]);
  const shownFr = mode === 'local' ? (eff === 'diff' && diffRes && diffRes.a ? diffRes.a : lf[slotShown] || null) : null;
  const geom = useMemo(() => {
    if (!box.w || !box.h) return { w: 0, h: 0 };
    if (mode !== 'local' || !shownFr) return { w: box.w, h: box.h };
    const s = Math.min(box.w / shownFr.w, box.h / shownFr.h);
    return { w: Math.max(1, Math.round(shownFr.w * s)), h: Math.max(1, Math.round(shownFr.h * s)) };
  }, [box, mode, shownFr]);

  /* ---------------- Ölçüler ---------------- */
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const measure = () => { const w = Math.max(0, Math.floor(el.clientWidth)); const h = Math.max(0, Math.floor(el.clientHeight)); setBox((b) => (b.w === w && b.h === h ? b : { w, h })); };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(el); }
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [active]);

  /* ---------------- Zaman çizelgesi oynatma · blink ---------------- */
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => setYr((y) => (y + 0.25 > SKY_YEAR_MAX ? SKY_YEAR_MIN : y + 0.25)), 70);
    return () => clearInterval(id);
  }, [playing]);
  useEffect(() => {
    if (!(lplay && eff === 'blink')) return undefined;
    const id = setInterval(() => setPhaseB((p) => !p), 700);
    return () => clearInterval(id);
  }, [lplay, eff]);

  /* ---------------- Çizim ---------------- */
  const yrFrame = (mode === 'local' && ((lf[slotShown] && lf[slotShown].yr) || (lf.e1 && lf.e1.yr) || (lf.e2 && lf.e2.yr))) || SPHEREX_YEAR;
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !geom.w || !active) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(geom.w * dpr);
    const H = Math.round(geom.h * dpr);
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
    const hits = [];
    try {
      if (mode === 'local' && shownFr) {
        let off;
        if (eff === 'diff' && diffRes && diffRes.rgba) {
          if (!diffRes.off) { diffRes.off = document.createElement('canvas'); diffRes.off.width = diffRes.df.w; diffRes.off.height = diffRes.df.h; diffRes.off.getContext('2d').putImageData(new ImageData(diffRes.rgba, diffRes.df.w, diffRes.df.h), 0, 0); }
          off = diffRes.off;
        } else {
          const key = `off|${palette}|${stretch}`;
          if (!shownFr.cache[key]) {
            const c2 = document.createElement('canvas'); c2.width = shownFr.w; c2.height = shownFr.h;
            c2.getContext('2d').putImageData(new ImageData(frameToRgba(shownFr, { palette, stretch, enhance: palette !== 'gray' || stretch !== 'zasinh' }), shownFr.w, shownFr.h), 0, 0);
            shownFr.cache[key] = c2;
          }
          off = shownFr.cache[key];
        }
        drawLocalScene(ctx, W, H, { dpr, off, fr: shownFr, list, tog, sel, hov, hits, yrFrame, zv: zp.view });
      } else {
        drawLiveScene(ctx, W, H, {
          dpr, photos, tog, fov, center, list: mode === 'live' ? list : [], yr, lam, sel, hov, hits, zv: zp.view,
          loadingText: mode === 'live' ? (photos.status === 'loading' || photos.status === 'idle' ? t('sky.canvas.loading') : '') : '',
        });
      }
    } catch (e) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      skyPlaceholder(ctx, W, 3);
    }
    hitRef.current = hits;
  }, [geom, active, mode, photos, tog, fov, center, list, yr, lam, sel, hov, eff, shownFr, diffRes, palette, stretch, yrFrame, lf, t, zp.view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Adres çubuğu: geçerli hedef/görüş alanı paylaşılabilir bağlantı olarak eşitlenir
  useEffect(() => {
    if (!active) return;
    app.syncUrl({ ra: target.ra, dec: target.dec, fov, name: target.name, pane: 'sky' });
  }, [active, target, fov]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') zp.zoomAt(1.5);
      else if (e.key === '-' || e.key === '\u2212') zp.zoomAt(1 / 1.5);
      else if (e.key === '0') zp.reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- Etkileşim ---------------- */
  const pick = (e) => {
    const cv = canvasRef.current;
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best = null; let bd = 1e9;
    hitRef.current.forEach((h) => { const d = Math.hypot(h.x - x, h.y - y); if (d <= Math.max(14, h.r) && d < bd) { bd = d; best = h; } });
    return best;
  };
  const pickTarget = (tg) => {
    setTarget({ ...tg }); setFov(tg.fov || 0.15); setSel(null); setMsg(null); setNameQ('');
    if (mode !== 'live') app.switchMode('live');
  };
  const resolve = async () => {
    const q = nameQ.trim();
    if (!q) return;
    setMsg({ k: 'custom.resolving' });
    try {
      const r = await resolveName(q);
      pickTarget({ id: 'custom', name: q, ra: r.ra, dec: r.dec, pmra: 0, pmdec: 0, epoch: 2000, fov });
      setNameQ(q);
      setMsg({ k: 'custom.resolved', p: { name: q, ra: fmtRA(r.ra), dec: fmtDec(r.dec) } });
    } catch (e) { setMsg({ k: 'custom.failed', p: { msg: e.message } }); }
  };
  const applyCoords = () => {
    const ra = parseAngle(raStr, 'ra'); const dec = parseAngle(decStr, 'dec');
    if (!isFinite(ra) || !isFinite(dec) || dec < -89.5 || dec > 89.5) { setMsg({ k: 'custom.bad' }); return; }
    pickTarget({ id: 'manual', name: `${fmtRA(wrap360(ra), 1)} ${fmtDec(dec, 0)}`, ra: wrap360(ra), dec, pmra: 0, pmdec: 0, epoch: 2000, fov });
  };

  const aladin = `https://aladin.cds.unistra.fr/AladinLite/?target=${encodeURIComponent(center.ra.toFixed(5) + ' ' + (center.dec >= 0 ? '+' : '') + center.dec.toFixed(5))}&fov=${fov}&survey=${encodeURIComponent('CDS/P/2MASS/color')}`;
  const stCol = (s) => (s === 'ok' ? '#8FE0B5' : s === 'loading' ? '#5B9DFF' : s === 'fail' ? '#E3B567' : '#6F82A8');
  const photoSt = (key) => (photos.status === 'idle' ? 'idle' : photos[key] ? 'ok' : photos[key + 'Err'] || photos.status === 'fail' ? 'fail' : 'loading');
  const pcol = (c) => SKY_CAT_COLOR[c];

  /* =====================================================================
     RENDER — sahne (fotoğraf tuvali) · yüzen çekmeceler · tek alt HUD
     ===================================================================== */
  const live = mode === 'live';
  const local = mode === 'local';
  const sim = mode === 'sim';
  const failed = live && photos.status === 'fail';
  const catStatus = curObjs.status;
  const gGlyph = (g) => (g && g.emoji) || '◇';
  const tgBtn = (on, label, id, onClick, col) => (
    <button type="button" data-testid={id} aria-pressed={on} onClick={onClick} className="ed-pill" style={{ '--pc': col || '#5B9DFF' }}>
      <span aria-hidden>{on ? '✓' : '○'}</span>{label}
    </button>
  );

  /* ---------------- Sol çekmece: hedef galerisi + arama ---------------- */
  const leftBody = (
    <div data-testid="sky-left">
      <Card title={t('sky.gallery.title')} tip="tip.sky.gallery" icon={<span>1</span>}>
        <div className="flex flex-wrap gap-2" role="tablist" data-testid="sky-cats">
          {SKY_GALLERY.map((g, gi) => (
            <button key={g.id} type="button" role="tab" aria-selected={g.id === catId} data-testid={`sky-cat-${g.id}`} title={t('sky.cat.' + g.id)} aria-label={t('sky.cat.' + g.id)} onClick={() => setCatId(g.id)} className="ed-ico" style={{ '--ic': ['#E3B567', '#F0587A', '#8FD3E6', '#5B9DFF', '#8FE0B5'][gi % 5] }}>
              <span aria-hidden>{gGlyph(g)}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 text-[11.5px] font-medium leading-tight text-[#EEF3FD]" data-testid="sky-cat-title">{t('sky.cat.' + cat.id)}</div>
        <ul className="mt-2" data-testid="sky-gallery">
          {cat.items.map((it, i) => {
            const on = target.id === it.id;
            return (
              <li key={it.id}>
                <button type="button" data-testid={`sky-tg-${it.id}`} aria-pressed={on} onClick={() => pickTarget(it)} title={it.name} className="ed-row flex items-center justify-between gap-3 !py-[9px] text-[12.5px]">
                  <span className="min-w-0 truncate" style={{ color: on ? '#fff' : '#C9C6D6' }}>{it.name}</span>
                  <span className="ed-mono shrink-0 text-[9.5px] tracking-wider text-[#667BA3]" style={on ? { color: 'var(--acc)' } : undefined}>{on ? `[${edPad(i + 1)}/${edPad(cat.items.length)}]` : '|'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title={t('sky.search.title')} tip="tip.sky.search" icon={<span>2</span>}>
        <div className="flex items-end gap-3">
          <input data-testid="sky-name" value={nameQ} onChange={(e) => setNameQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') resolve(); }} placeholder={t('sky.search.ph')} className="min-w-0 flex-1" spellCheck={false} />
          <button type="button" data-testid="sky-resolve" onClick={resolve} aria-label={t('sky.search.title')} className="ed-btn is-sm">→</button>
        </div>
        <div className="mt-2 min-h-[16px] text-[11px] leading-snug text-[#93A6CC]" data-testid="sky-msg">{msg ? t(msg.k, msg.p) : ''}</div>
      </Card>

      <Disclosure title={t('sky.adv.title')} tip="tip.sky.adv" open={advOpen} onToggle={() => setAdvOpen((o) => !o)} testId="sky-adv-toggle">
        <div className="space-y-4" data-testid="sky-adv">
          <label className="ed-label block"><span className="mb-1 block">{t('sky.fovlabel')}</span>
            <select data-testid="sky-fov" value={fov} onChange={(e) => setFov(Number(e.target.value))} className="block w-full">
              {Array.from(new Set([...SKY_FOVS, fov])).sort((a, b) => a - b).map((f) => (<option key={f} value={f}>{`${f}° (${(f * 60).toFixed(f < 0.1 ? 1 : 0)}′)`}</option>))}
            </select></label>
          <div className="grid grid-cols-2 gap-4">
            <label className="ed-label block"><span className="mb-1 block">{t('custom.ra')}</span><input data-testid="sky-ra" value={raStr} onChange={(e) => setRaStr(e.target.value)} className="block w-full" placeholder="17h57m48.5s" spellCheck={false} /></label>
            <label className="ed-label block"><span className="mb-1 block">{t('custom.dec')}</span><input data-testid="sky-dec" value={decStr} onChange={(e) => setDecStr(e.target.value)} className="block w-full" placeholder="+04° 41′ 36″" spellCheck={false} /></label>
          </div>
          <button type="button" data-testid="sky-apply" onClick={applyCoords} className="ed-btn ed-go is-block is-sm">{t('sky.coords.apply')}</button>
        </div>
      </Disclosure>
    </div>
  );

  /* ---------------- Sağ çekmece: durum · yerel dosyalar · cisim kartı · liste ---------------- */
  const rightBody = (
    <div data-testid="sky-right">
      {live && (
        <Card title={t('sky.src.title')} tip="tip.sky.src" icon={<span>1</span>}>
          <ul className="space-y-2 text-[11.5px]" data-testid="sky-status">
            {['nir', 'mir'].map((k) => {
              const s = photoSt(k); const ph = photos[k];
              return (
                <li key={k} className="flex items-start justify-between gap-3 border-b border-white/[0.07] pb-2" data-testid={`sky-status-${k}`} data-state={s}>
                  <span className="min-w-0 text-[#C5D3EE]"><b className="font-medium text-[#EEF3FD]">{SKY_SURVEYS[k].name}</b> <span className="ed-mono text-[10px] text-[#667BA3]">{SKY_SURVEYS[k].lam} · ≈{Math.round(SKY_SURVEYS[k].yr)}</span></span>
                  <span className="ed-label shrink-0 text-right" style={{ color: stCol(s) }}><i className="ed-dot mr-1.5 inline-block" style={{ background: stCol(s) }} />{t('sky.st.' + s)}{ph && !ph.cors ? <span className="block text-[9px] text-[#E3B567]">{t('sky.st.viewOnly')}</span> : null}</span>
                </li>
              );
            })}
            <li className="flex items-start justify-between gap-3" data-testid="sky-status-cat" data-state={catStatus}>
              <span className="min-w-0 text-[#C5D3EE]"><b className="font-medium text-[#EEF3FD]">SIMBAD</b> <span className="ed-mono text-[10px] text-[#667BA3]">TAP · ICRS</span></span>
              <span className="ed-label shrink-0 text-right" style={{ color: stCol(catStatus === 'ok' ? 'ok' : catStatus === 'loading' ? 'loading' : catStatus === 'fail' ? 'fail' : 'idle') }}><i className="ed-dot mr-1.5 inline-block" style={{ background: stCol(catStatus === 'ok' ? 'ok' : catStatus === 'loading' ? 'loading' : catStatus === 'fail' ? 'fail' : 'idle') }} />{t('sky.st.' + (catStatus === 'ok' ? 'ok' : catStatus === 'loading' ? 'loading' : catStatus === 'fail' ? 'fail' : 'idle'))}</span>
            </li>
          </ul>
          <p className="ed-note-box is-warn mt-3 text-[10.5px]">{t('sky.band.note')}</p>
        </Card>
      )}

      {local && (
        <Card title={t('sky.local.title')} tip="tip.sky.local" icon={<span>1</span>} right={<button type="button" data-testid="sky-local-add" onClick={() => app.openUpload()} className="ed-link">+ {t('sky.btn.upload')}</button>}>
          <ul className="space-y-4" data-testid="sky-local">
            {['e1', 'e2'].map((s, i) => {
              const fr = lf[s];
              return (
                <li key={s} className="border-l border-white/15 pl-3" data-testid={`sky-slot-${s}`} data-filled={fr ? '1' : '0'}>
                  <div className="flex items-center justify-between gap-2 text-[11.5px]">
                    <span className="ed-label flex items-center gap-2" style={{ color: i === 0 ? '#F0587A' : '#5B9DFF' }}><i className="ed-dot" style={{ background: i === 0 ? '#F0587A' : '#5B9DFF' }} />{t('epoch.n', { n: i + 1 })}</span>
                    <span className="flex items-center gap-3">
                      <button type="button" data-testid={`sky-slot-up-${s}`} onClick={() => app.openUpload(s)} className="ed-link">{fr ? t('sky.slot.replace') : t('sky.slot.load')}</button>
                      {fr && <button type="button" data-testid={`sky-slot-clear-${s}`} onClick={() => app.clearFrame(s)} aria-label={t('common.clear')} className="ed-link">✕</button>}
                    </span>
                  </div>
                  {fr ? (
                    <div className="mt-2 space-y-0.5 text-[10.5px] leading-snug text-[#93A6CC]">
                      <div className="ed-mono truncate text-[#EEF3FD]" title={fr.name}>{fr.name}</div>
                      <div>{fr.kind === 'fits' ? 'FITS' : t('sky.local.image')} · {fr.origW}×{fr.origH}{fr.ds > 1 ? ' · ' + t('sky.local.ds', { f: fr.ds }) : ''}{fr.meta.bunit ? ' · ' + fr.meta.bunit : ''}</div>
                      <div>{fr.yr ? t('sky.local.date', { yr: fr.yr.toFixed(2) }) : t('sky.local.nodate')} · {fr.wcs ? 'WCS ●' : t('sky.local.nowcs')}</div>
                    </div>
                  ) : (<div className="mt-2 text-[10.5px] text-[#667BA3]">{t('sky.slot.empty')}</div>)}
                </li>
              );
            })}
          </ul>
          {lobjs.status === 'fail' && <p className="mt-3 text-[10.5px] text-[#EBCF9F]" data-testid="sky-local-simbad-note">{t('sky.local.simbadFail')}</p>}
        </Card>
      )}

      <Card title={t('sky.sel.title')} tip="tip.sky.sel" icon={<span>2</span>}>
        {selObj ? (() => {
          const p = objAt(selObj, local ? yrFrame : yr);
          const p99 = objAt(selObj, 1999);
          const moved = angSepArcsec(p99.ra, p99.dec, p.ra, p.dec);
          const c = otypeCat(selObj.otype);
          const mu = objMu(selObj);
          return (
            <div className="space-y-3 text-[11.5px]" data-testid="sky-sel">
              <div className="flex items-start gap-3"><span aria-hidden className="mt-1 text-[18px] leading-none" style={{ color: pcol(c) }}>{OBJ_EMOJI[c]}</span>
                <div className="min-w-0"><div className="ed-serif break-words text-[22px] leading-tight text-[#F5F8FF]" data-testid="sky-sel-name">{selObj.id}</div>
                  <div className="ed-label mt-1" style={{ color: pcol(c) }}>{t('sky.ot.' + c)} · <span className="ed-mono">{selObj.otype || '—'}</span>{selObj.sp ? ` · ${selObj.sp}` : ''}</div></div></div>
              <dl className="ed-mono grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[11px]">
                <dt className="text-[#667BA3]">{t('sky.sel.pos', { yr: (local ? yrFrame : yr).toFixed(1) })}</dt><dd className="text-[#EEF3FD]">{fmtRA(p.ra, 1)} {fmtDec(p.dec, 0)}</dd>
                <dt className="text-[#667BA3]">{t('sky.sel.mu')}</dt><dd className="text-[#EEF3FD]" data-testid="sky-sel-mu">{hasPm(selObj) ? `${fmtMu(mu / 1000)}″/${t('common.yr')}` : t('sky.sel.nopm')}</dd>
                {hasPm(selObj) && (<><dt className="text-[#667BA3]">μα* · μδ</dt><dd className="text-[#EEF3FD]">{selObj.pmra.toFixed(1)} · {selObj.pmdec.toFixed(1)} mas/{t('common.yr')}</dd>
                  <dt className="text-[#667BA3]">{t('sky.sel.moved', { yr: (local ? yrFrame : yr).toFixed(0) })}</dt><dd className="text-[#E3B567]">{moved.toFixed(1)}″</dd></>)}
                {selObj.plx > 0 && (<><dt className="text-[#667BA3]">{t('sky.sel.dist')}</dt><dd className="text-[#EEF3FD]">{(1000 / selObj.plx).toFixed(2)} pc ({(3261.56 / selObj.plx).toFixed(1)} ly)</dd></>)}
                {(selObj.V !== null || selObj.J !== null) && (<><dt className="text-[#667BA3]">{t('sky.sel.mag')}</dt><dd className="text-[#EEF3FD]">{selObj.V !== null ? `V ${selObj.V.toFixed(2)}` : ''}{selObj.V !== null && selObj.J !== null ? ' · ' : ''}{selObj.J !== null ? `J ${selObj.J.toFixed(2)}` : ''}</dd></>)}
              </dl>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
                <a href={simbadUrl(selObj.id)} target="_blank" rel="noreferrer" data-testid="sky-simbad-link" className="ed-link" style={{ color: 'var(--acc)' }}>{t('sky.sel.simbad')} ↗</a>
                <button type="button" data-testid="sky-measure" onClick={() => app.requestReal({ id: 'sky', name: selObj.id, ra: selObj.ra, dec: selObj.dec, pmra: selObj.pmra || 0, pmdec: selObj.pmdec || 0, epoch: 2000 })} className="ed-btn ed-go is-sm is-ok">{t('sky.sel.measure')}</button>
              </div>
            </div>
          );
        })() : (<p className="text-[11.5px] leading-relaxed text-[#93A6CC]" data-testid="sky-sel-empty">{t('sky.sel.hint')}</p>)}
      </Card>

      <Card title={t('sky.obj.title', { n: list.length })} tip="tip.sky.objs" icon={<span>3</span>}>
        {catStatus === 'loading' && <div className="ed-label spx-pulse" style={{ color: 'var(--acc)' }} data-testid="sky-obj-loading">{t('sky.obj.loading')}</div>}
        {catStatus === 'fail' && (
          <div className="space-y-2 text-[11.5px] text-[#EBCF9F]" data-testid="sky-obj-fail">
            <p>{t('sky.obj.fail')}</p>
            <button type="button" data-testid="sky-cat-retry" onClick={() => setCatNonce((n) => n + 1)} className="ed-btn is-sm is-warn">{t('sky.obj.retry')}</button>
          </div>
        )}
        {catStatus === 'ok' && !list.length && <p className="text-[11.5px] text-[#93A6CC]" data-testid="sky-obj-none">{t('sky.obj.none')}</p>}
        {list.length > 0 && (
          <ul className="spx-scroll max-h-[280px] overflow-y-auto" data-testid="sky-objlist">
            {list.map((o) => {
              const c = otypeCat(o.otype);
              return (
                <li key={o.id}>
                  <button type="button" data-testid="sky-obj" data-id={o.id} aria-pressed={o.id === sel} onClick={() => setSel(o.id === sel ? null : o.id)} onMouseEnter={() => setHov(o.id)} onMouseLeave={() => setHov(null)} className="ed-row flex items-center gap-2.5 !py-2 text-[11px]">
                    <span aria-hidden style={{ color: pcol(c) }}>{OBJ_EMOJI[c]}</span>
                    <span className="min-w-0 flex-1 truncate text-[#EEF3FD]">{o.id}</span>
                    <span className="ed-mono shrink-0 text-[10px]" style={{ color: hasPm(o) ? '#E3B567' : '#6F82A8' }}>{hasPm(o) ? `${fmtMu(objMu(o) / 1000)}″/${t('common.yr')}` : o.otype || '—'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {live && catStatus === 'ok' && <p className="mt-3 text-[10.5px] leading-snug text-[#667BA3]">{t('sky.legend')}</p>}
      </Card>

      <section className="ed-sec"><SkyCredit /></section>
    </div>
  );

  /* ---------------- Başlık satırı (tuvalin üstünde) + geniş tuval ---------------- */
  const capNode = (
    <div className="ed-cap" data-testid="sky-cap">
      <span className="ed-cap-name" data-testid="sky-target-name">{local ? (shownFr ? shownFr.name : t('sky.local.title')) : target.name}</span>
      {!local && <span className="ed-mono ed-cap-co">{fmtRA(target.ra, 1)} {fmtDec(target.dec, 0)}</span>}
      {live && <Chip color="#E3B567" title={t('sky.refonly.tip')}>{t('sky.refonly')}</Chip>}
      {local && <Chip color="#D4E2FB">{t('src.local.s')}</Chip>}
      {local && eff === 'blink' && (
        <button type="button" data-testid="sky-lplay" onClick={() => setLplay((p) => !p)} className="ed-link"><span aria-hidden>{lplay ? '❙❙' : '▶'}</span>{lplay ? t('ctl.pause') : t('ctl.play')}</button>
      )}
      {live && (<span className="ed-cap-r"><a href={aladin} target="_blank" rel="noreferrer" data-testid="sky-aladin" className="ed-link" style={{ color: 'var(--acc)' }}>Aladin · HiPS ↗</a><InfoTip id="tip.sky.aladin" title="Aladin" /></span>)}
    </div>
  );
  const stageNode = (
    <div ref={boxRef} className="absolute inset-0 grid place-items-center" data-testid="sky-canvas-box">
      <div className={`relative ${local ? 'ed-frame' : ''}`} style={{ width: geom.w, height: geom.h }} data-testid="sky-center">
        <canvas ref={canvasRef} data-testid="skyv-canvas" data-mode={mode} style={{ width: geom.w, height: geom.h, touchAction: zpTouch(zp.view.z) }} aria-label={t('sky.canvas.aria')}
          onPointerMove={(e) => { const h = pick(e); setHov(h ? h.id : null); }} onPointerLeave={() => setHov(null)}
          onClick={(e) => { if (zp.moved.current) return; const h = pick(e); setSel(h ? h.id : null); }} className="block cursor-crosshair" title={t('zp.hint')} />
          {!sim && geom.w > 0 && <ZoomCtl prefix="sky" zp={zp} />}
          {sim && (
            <div className="ed-veil overflow-y-auto p-4 text-center" data-testid="sky-overlay-msg" data-state="sim">
              <div className="ed-empty">
                <div className="ed-label" style={{ color: 'var(--acc2)' }}>◇ OFFLINE</div>
                <h3>{t('sky.canvas.simTitle')}</h3>
                <p className="text-[12px] leading-relaxed text-[#93A6CC]">{t('sky.canvas.simBody')}</p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <button type="button" data-testid="sky-retry" onClick={() => app.switchMode('live')} className="ed-btn is-sm is-ok">{t('sky.btn.retry')}</button>
                  <button type="button" data-testid="sky-upload" onClick={() => app.openUpload()} className="ed-btn is-sm">{t('sky.btn.upload')}</button>
                  <button type="button" data-testid="sky-open-sim" onClick={() => app.setView('map')} className="ed-btn ed-go is-sm">{t('sky.btn.sim')}</button>
                </div>
              </div>
            </div>
          )}
          {failed && (
            <div className="ed-veil overflow-y-auto p-4 text-center" data-testid="sky-overlay-msg" data-state="fail">
              <div className="ed-empty">
                <div className="ed-label" style={{ color: '#E3B567' }}>◆ NO SIGNAL</div>
                <h3 style={{ fontSize: 22 }}>{t('sky.canvas.failTitle')}</h3>
                <p className="text-[11.5px] leading-relaxed text-[#C5D3EE]">{t('src.reason.' + (photos.reason || 'blocked'))}</p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <button type="button" data-testid="sky-retry" onClick={() => app.switchMode('live')} className="ed-btn is-sm is-ok">{t('sky.btn.retry')}</button>
                  <button type="button" data-testid="sky-open-sim" onClick={() => app.switchMode('sim')} className="ed-btn ed-go is-sm">{t('sky.btn.sim')}</button>
                </div>
              </div>
            </div>
          )}
          {local && !shownFr && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center" data-testid="sky-overlay-msg" data-state="empty">
              <div className="ed-empty">
                <div className="ed-label" style={{ color: 'var(--acc2)' }}>↑ FITS / PNG / JPG</div>
                <h3>{t('sky.local.emptyTitle')}</h3>
                <p className="text-[12px] leading-relaxed text-[#93A6CC]">{t('sky.local.emptyBody')}</p>
                <button type="button" data-testid="sky-upload" onClick={() => app.openUpload()} className="ed-btn ed-go is-primary mt-5">{t('sky.btn.upload')}</button>
              </div>
            </div>
          )}
          {local && eff === 'diff' && diffRes && diffRes.err && (
            <div className="ed-note is-warn absolute inset-x-2 top-2 text-[11px] text-[#EBCF9F]" data-testid="sky-diff-err">{t('sky.diff.err', { detail: String((diffRes.err && diffRes.err.message) || diffRes.err).slice(0, 120) })}</div>
          )}
      </div>
    </div>
  );

  /* ---------------- Alt HUD ---------------- */
  const hudNode = (
    <>
      {live && (
        <>
          <HudRow>
            <div className="ed-ctl">
              <div className="ed-ctl-h">
                <span className="inline-flex items-center gap-2">{t('sky.band.title')}<InfoTip id="tip.sky.band" title={t('sky.band.title')} /></span>
                <b data-testid="sky-lam">{t('sky.band.val', { lam: lam.toFixed(2), n: band + 1 })}</b>
              </div>
              <input type="range" className="spx-range spx-red" data-testid="sky-band" min={0} max={N_BANDS - 1} step={1} value={band} onChange={(e) => setBand(Number(e.target.value))} aria-label={t('sky.band.title')} />
              <div className="ed-ctl-f">
                <div className="flex flex-wrap items-center gap-1.5">
                  {QUICK_LAMBDAS.map(([l, lab]) => (
                    <button key={l} type="button" aria-pressed={band === nearestBand(l)} onClick={() => setBand(nearestBand(l))} className="ed-cb">{lab}</button>
                  ))}
                </div>
                <span className="ed-mono text-[10px] text-[#667BA3]" data-testid="sky-blend">{t('sky.blend', { a: Math.round((1 - wgt) * 100), b: Math.round(wgt * 100) })}</span>
              </div>
            </div>
          </HudRow>
          <HudRow>
            <div className="ed-ctl">
              <div className="ed-ctl-h">
                <span className="inline-flex items-center gap-2">{t('sky.year.title')}<InfoTip id="tip.sky.year" title={t('sky.year.title')} /></span>
                <b data-testid="sky-year-val">{yr.toFixed(1)}</b>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" data-testid="sky-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? t('ctl.pause') : t('ctl.play')} className="ed-play">{playing ? '❙❙' : '▶'}</button>
                <input type="range" className="spx-range min-w-0 flex-1" data-testid="sky-year" min={SKY_YEAR_MIN} max={SKY_YEAR_MAX} step={0.1} value={yr} onChange={(e) => setYr(Number(e.target.value))} aria-label={t('sky.year.title')} />
              </div>
              <div className="ed-ctl-f">
                <div className="flex flex-wrap items-center gap-1.5">
                  {SKY_EPOCH_MARKS.map(([y, lab]) => (
                    <button key={lab} type="button" data-testid={`sky-yr-${lab.toLowerCase()}`} onClick={() => { setPlaying(false); setYr(y); }} className="ed-cb">{lab} {Math.round(y)}</button>
                  ))}
                </div>
              </div>
            </div>
          </HudRow>
        </>
      )}
      {local && (
        <HudRow>
          <HudCell label={t('sky.lmode.title')} long testId="sky-lcontrols">
            <div className="flex flex-wrap items-center gap-x-4">
              {['single', 'blink', 'diff'].map((m, i) => (
                <button key={m} type="button" className="ed-segbtn" data-testid={`sky-lmode-${m}`} aria-pressed={eff === m} disabled={m !== 'single' && !canDiff} onClick={() => { setLmode(m); if (m !== 'blink') setLplay(false); }}><i>{i + 1}</i>{t('sky.lmode.' + m)}</button>
              ))}
              <InfoTip id="tip.sky.lmode" title={t('sky.lmode.title')} />
              {eff === 'single' && lf.e1 && lf.e2 && ['e1', 'e2'].map((s, i) => (
                <button key={s} type="button" data-testid={`sky-show-${s}`} aria-pressed={slotShown === s} onClick={() => setLslot(s)} className="ed-link">{t('epoch.n', { n: i + 1 })}</button>
              ))}
            </div>
          </HudCell>
          <HudCell grow>
            <label className="ed-label flex items-center gap-2">{t('sky.stretch')}<InfoTip id="tip.sky.stretch" title={t('sky.stretch')} />
              <select data-testid="sky-stretch" value={stretch} onChange={(e) => setStretch(e.target.value)} disabled={eff === 'diff'}>
                {['zasinh', 'zlin', 'mmasinh'].map((s) => (<option key={s} value={s}>{t('sky.stretch.' + s)}</option>))}
              </select></label>
            <label className="ed-label flex items-center gap-2">{t('sky.palette')}
              <select data-testid="sky-palette" value={palette} onChange={(e) => setPalette(e.target.value)} disabled={eff === 'diff'}>
                {['gray', 'ir'].map((s) => (<option key={s} value={s}>{t('sky.palette.' + s)}</option>))}
              </select></label>
            {eff === 'diff' && diffRes && diffRes.df && (
              <div className="min-w-0 text-[10.5px] leading-snug text-[#93A6CC]" data-testid="sky-lalign" data-mode={diffRes.df.mode}>
                <span className="text-[#C5D3EE]">{t('sky.align.' + diffRes.df.mode)}</span> — {t('sky.diff.note')}
              </div>
            )}
          </HudCell>
        </HudRow>
      )}
      <HudRow>
        <HudCell grow>
          <div className="flex flex-wrap items-center gap-2" data-testid="sky-toggles">
            {live && tgBtn(tog.photo, t('sky.tog.photo'), 'sky-tog-photo', () => setTog((s) => ({ ...s, photo: !s.photo })), '#8FE0B5')}
            {tgBtn(tog.objs, t('sky.tog.objs'), 'sky-tog-objs', () => setTog((s) => ({ ...s, objs: !s.objs })), '#5B9DFF')}
            {tgBtn(tog.trails, t('sky.tog.trails'), 'sky-tog-trails', () => setTog((s) => ({ ...s, trails: !s.trails })), '#E3B567')}
            {tgBtn(tog.labels, t('sky.tog.labels'), 'sky-tog-labels', () => setTog((s) => ({ ...s, labels: !s.labels })), '#B7C6E3')}
            <InfoTip id="tip.sky.toggles" title={t('sky.tog.objs')} />
          </div>
        </HudCell>
        <HudCell>
          <span className="ed-mono text-[10px] text-[#667BA3]">{local ? (shownFr ? `${shownFr.w}×${shownFr.h} px` : '—') : `FOV ${fov}° | ${(fov * 60).toFixed(fov < 0.1 ? 1 : 0)}′`}</span>
        </HudCell>
      </HudRow>
    </>
  );

  return (
    <ViewFrame active={active} testId="view-sky" cap={capNode} stage={stageNode} expandable
      left={<Drawer side="l" open={dr.lo} onToggle={dr.toggleL} label={t('ed.controls')} index="01" testId="left-panel" tabId="drawer-l">{leftBody}</Drawer>}
      right={<Drawer side="r" open={dr.ro} onToggle={dr.toggleR} label={t('ed.analysis')} index="02" testId="right-panel" tabId="drawer-r">{rightBody}</Drawer>}
      hud={hudNode}
      />
  );
}

/* =====================================================================
   RealHub — "Gerçek Veri" sekmesi: Gökyüzü fotoğrafı (CDS/SIMBAD) ⇄ SPHEREx pikselleri (IRSA)
   ===================================================================== */
function RealHub({ app, active }) {
  const { realPane } = app;
  return (
    <div style={{ display: active ? 'block' : 'none' }} data-testid="view-realhub">
      <SkyView app={app} active={active && realPane === 'sky'} />
      <RealView app={app} active={active && realPane === 'irsa'} />
    </div>
  );
}
/* =====================================================================
   BÖLÜM 15 — KEŞİF HARİTASI  (kenardan kenara tuval · sol/sağ cam çekmeceler · tek alt HUD)
   ===================================================================== */
const MAP_ZMAX = 16;                                                   // en büyük yakınlaştırma (v3.5: 12 → 16)
const MAP_FOV = (W * PLATE) / 3600;                          // haritanın görüş alanı [derece] = 0.3° → hips2fits ile piksel piksel aynı ölçek
const RM_QUICK = ['barnard', 'kapteyn', 'cyg61', 'lh16'];     // özdevinimi büyük gerçek yıldızlar (galeriden)
const FIELD_CACHE = new Map();                               // indirilmiş gerçek alan verileri (sektör anahtarı → alan)
// Hata → kullanıcıya gösterilen sakin neden (src.reason.*)
function mapReason(e) {
  if (e && e.code === 'OFFLINE') return 'offline';
  if (e && (e.code === 'TIMEOUT' || e.name === 'AbortError')) return 'timeout';
  if (e && e.code === 'EMPTY') return 'empty';
  if (e && (e.code === 'HTTP' || e.code === 'JSON')) return 'server';
  return 'blocked';
}
const quickTargets = () => RM_QUICK.map((id) => { for (let i = 0; i < SKY_GALLERY.length; i++) { const it = SKY_GALLERY[i].items.find((x) => x.id === id); if (it) return it; } return null; }).filter(Boolean);
const mpcUrl = (catId) => `https://minorplanetcenter.net/db_search/show_object?object_id=${encodeURIComponent(String(catId).split(' ')[0] || catId)}`;

function MapView({ app, active }) {
  const { t, lang, db } = app;
  const [skyEntry, setSkyEntry] = useState(null);
  const [building, setBuilding] = useState(true);
  const [started, setStarted] = useState(false);                   // harita sekmesi en az bir kez açıldı mı (gerçek veri ancak o zaman indirilir)
  const [load, setLoad] = useState({ phase: 'idle', simbad: null, skybot: 0 });
  const [photo, setPhoto] = useState({ status: 'idle', key: '', nir: null, mir: null });
  const [notice, setNotice] = useState(null);
  const [mode, setMode] = useState('blink');
  const [band, setBand] = useState(nearestBand(1.25));
  const [preset, setPreset] = useState(null);
  const [blinkAuto, setBlinkAuto] = useState(true);
  const [blinkHz, setBlinkHz] = useState(2);
  const [blinkPhase, setBlinkPhase] = useState(0);
  const [curtain, setCurtain] = useState(0.5);
  const [stretchK, setStretchK] = useState(1);
  const [thr, setThr] = useState(2.5);
  const [view, setView] = useState({ z: 1, sx: 0, sy: 0 });
  const [selection, setSelection] = useState(null);
  const [yMode, setYMode] = useState('flux');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [showKnown, setShowKnown] = useState(false);
  const [scan, setScan] = useState(null);
  const [size, setSize] = useState(0);
  const [saveCat, setSaveCat] = useState('other');
  const [noteText, setNoteText] = useState('');
  const [noteDirty, setNoteDirty] = useState(false);
  const [savedUid, setSavedUid] = useState(null);
  const [pyMsg, setPyMsg] = useState(null);
  const dr = useDrawers(true, true);

  const canvasRef = useRef(null);
  const boxRef = useRef(null);
  const centerRef = useRef(null);
  // Dar ekranlarda (tek sütun) seçim yapılınca haritayı görünür alana getir
  const revealMap = () => { /* editoryal düzende tuval her zaman görünür; kaydırma gerekmez */ };
  const offRef = useRef(null);
  const taintRef = useRef(false);
  const viewRef = useRef(view);
  const sizeRef = useRef(0);
  const zoomRef = useRef(() => {});
  const dragRef = useRef(null);
  const cursorRef = useRef(null);
  const scanRun = useRef(0);
  viewRef.current = view;
  sizeRef.current = size;

  const { cfg } = app;
  const sky = skyEntry ? skyEntry.sky : null;
  const cache = skyEntry ? skyEntry.cache : null;
  const isReal = !!(sky && sky.real);                          // gösterilen gökyüzü gerçek katalogdan mı?
  const realOn = app.mapSrc === 'real';
  const gain = gainOf(sky, app.gain);                          // gerçek alanda hareket büyütülmez
  const photoRef = useRef(photo);
  photoRef.current = photo;
  const availModes = useMemo(() => MODES.filter((m) => !m.realOnly || realOn), [realOn]);
  const availRef = useRef(availModes);
  availRef.current = availModes;
  useEffect(() => { if (active) setStarted(true); }, [active]);
  useEffect(() => { if (selection) dr.setRo(true); }, [selection]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode === 'photo' && !realOn) setMode('blink'); }, [mode, realOn]);
  const presetDef = preset ? PRESETS.find((p) => p.id === preset) : null;
  const specView = presetDef ? presetDef.spec : { kind: 'band', b: band };
  const lam = BAND_LAMBDA[band];

  /* ---- Gökyüzü: simülasyon (sektör başına bir kez üretilir) ya da GERÇEK alan (SIMBAD + SkyBoT, bir kez indirilir) ---- */
  useEffect(() => {
    let cancelled = false;
    const reset = () => { setSelection(null); setView({ z: 1, sx: 0, sy: 0 }); setScan(null); setSavedUid(null); scanRun.current += 1; setNotice(null); };
    if (!realOn) {
      setLoad({ phase: 'idle', simbad: null, skybot: 0 });
      if (hasSkyEntry(cfg)) { setSkyEntry(getSkyEntry(cfg)); reset(); setBuilding(false); return undefined; }
      setBuilding(true);
      const tm = setTimeout(() => {
        const e = getSkyEntry(cfg);
        if (cancelled) return;
        setSkyEntry(e); reset(); setBuilding(false);
      }, 40);
      return () => { cancelled = true; clearTimeout(tm); };
    }
    const cached = getRealEntry(cfg);
    if (cached) {
      setSkyEntry(cached); reset(); setBuilding(false); setLoad({ phase: 'ok', simbad: cached.sky.real.rows, skybot: 4 });
      app.mapReport({ phase: 'ok', n: cached.sky.real.shown });
      return undefined;
    }
    if (!started) return undefined;                              // sekme açılana kadar ağa dokunma
    setSkyEntry(null); reset(); setBuilding(true);
    setLoad({ phase: 'loading', simbad: null, skybot: 0 });
    app.mapReport({ phase: 'loading' });
    let nSb = 0;
    const onPart = (what, st, n) => {
      if (cancelled) return;
      if (what === 'simbad') setLoad((l) => ({ ...l, simbad: st === 'ok' ? n : 'fail' }));
      else { nSb += 1; setLoad((l) => ({ ...l, skybot: nSb })); }
    };
    const rk = realKeyOf(cfg);
    const fieldP = FIELD_CACHE.has(rk) ? Promise.resolve(FIELD_CACHE.get(rk)) : fetchRealField(cfg, { onPart }).then((f) => { FIELD_CACHE.set(rk, f); if (FIELD_CACHE.size > 8) FIELD_CACHE.delete(FIELD_CACHE.keys().next().value); return f; });
    fieldP.then((field) => new Promise((res) => { setTimeout(() => res(field), 20); })).then((field) => {
      if (cancelled) return;
      const sk = buildRealSky(cfg, field);
      if (!sk.sources.length) throw new SkyError('EMPTY', 'boş alan');
      const e = putRealEntry(cfg, sk);
      setSkyEntry(e); setBuilding(false); setLoad({ phase: 'ok', simbad: sk.real.rows, skybot: 4 });
      app.mapReport({ phase: 'ok', n: sk.real.shown });
    }).catch((err) => {
      if (cancelled) return;
      setBuilding(false); setLoad({ phase: 'failed', simbad: null, skybot: 0 });
      app.mapReport({ phase: 'failed', reason: mapReason(err) });
    });
    return () => { cancelled = true; };
  }, [cfg, realOn, app.mapNonce, started]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Gerçek fotoğraf kipi: 2MASS ⇄ AllWISE (hips2fits, 0.3° · 720 px = 1.5″/px = haritanın ölçeği) ---- */
  useEffect(() => {
    if (!isReal || mode !== 'photo') return undefined;
    const cur0 = photoRef.current;
    if (cur0.key === sky.key && cur0.status === 'ok') return undefined;
    let alive = true;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setPhoto({ status: 'fail', key: sky.key, nir: null, mir: null, reason: 'offline' }); return undefined; }
    setPhoto({ status: 'loading', key: sky.key, nir: null, mir: null });
    let ok = 0; let bad = 0;
    ['nir', 'mir'].forEach((k) => {
      withDeadline(loadSkyPhoto(k, sky.cfg.ra, sky.cfg.dec, MAP_FOV, W, { timeoutMs: 9000 }), 12000).then((r) => {
        if (!alive) return;
        ok += 1;
        setPhoto((p) => (p.key === sky.key ? { ...p, [k]: r, status: 'ok' } : p));
      }, (e) => {
        if (!alive) return;
        bad += 1;
        if (bad === 2 && ok === 0) setPhoto({ status: 'fail', key: sky.key, nir: null, mir: null, reason: skyReason(e) });
      });
    });
    return () => { alive = false; };
  }, [mode, sky]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (mode === 'photo' && photo.status === 'fail') {
      setMode('blink'); setNotice({ reason: photo.reason || 'blocked' }); setPhoto({ status: 'idle', key: '', nir: null, mir: null });
    }
  }, [mode, photo]);

  /* ---- Kanvas boyutu (kutuya sığan en büyük kare) ---- */
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth, h = el.clientHeight;
      setSize(Math.max(0, Math.floor(Math.min(w, h))));
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(el); }
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  /* ---- Blink zamanlayıcısı (1–10 Hz) ---- */
  useEffect(() => {
    if (!active || mode !== 'blink' || !blinkAuto) return undefined;
    const id = setInterval(() => setBlinkPhase((p) => 1 - p), 1000 / blinkHz);
    return () => clearInterval(id);
  }, [active, mode, blinkAuto, blinkHz]);

  /* ---- Klavye kısayolları ---- */
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (ev) => {
      const tag = (ev.target && ev.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key >= '1' && ev.key <= '5' && availRef.current[Number(ev.key) - 1]) setMode(availRef.current[Number(ev.key) - 1].id);
      else if (ev.key === ' ' && tag !== 'BUTTON') { ev.preventDefault(); setBlinkAuto((v) => !v); }
      else if (ev.key === 'f' || ev.key === 'F') setBlinkPhase((p) => 1 - p);
      else if (ev.key === '+' || ev.key === '=') zoomRef.current(1.5);
      else if (ev.key === '-' || ev.key === '\u2212') zoomRef.current(1 / 1.5);
      else if (ev.key === '0') setView({ z: 1, sx: 0, sy: 0 });
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); setBand((b) => clamp(b - (ev.shiftKey ? 5 : 1), 0, N_BANDS - 1)); setPreset(null); }
      else if (ev.key === 'ArrowRight') { ev.preventDefault(); setBand((b) => clamp(b + (ev.shiftKey ? 5 : 1), 0, N_BANDS - 1)); setPreset(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  /* ---- Fare tekeri ile imleç merkezli yakınlaştırma ---- */
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    const onWheel = (ev) => {
      ev.preventDefault();
      const v = viewRef.current;
      const S = sizeRef.current / W;
      if (!S) return;
      const rect = c.getBoundingClientRect();
      const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
      const ix = v.sx + px / (S * v.z), iy = v.sy + py / (S * v.z);
      const nz = clamp(v.z * wheelFactor(ev), 1, MAP_ZMAX);
      setView({ z: nz, sx: clamp(ix - px / (S * nz), 0, W - W / nz), sy: clamp(iy - py / (S * nz), 0, H - H / nz) });
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, []);

  /* ---- Seçili kaynak · tarih çifti · geçmiş ---- */
  const knownCat = sky ? knownCatalog(sky) : null;
  const selSrc = sky && selection && selection.type === 'object' ? sky.byId.get(selection.id) || null : null;
  const selKey = selSrc ? objKeyOf(sky, selSrc) : null;
  const entryForSel = selKey ? db.entries.find((e) => e.objKey === selKey) || null : null;
  const knownRec = selKey && knownCat ? knownCat.byObj.get(selKey) || null : null;
  const history = useMemo(() => (selSrc ? epochHistory(sky, selSrc, gain) : null), [sky, selSrc, gain]);
  const firstEpoch = entryForSel ? entryForSel.firstEpoch : knownRec ? 0 : history ? Math.max(0, history.findIndex((h) => h.valid)) : 0;
  const { a: effA, b: effB } = resolveDates(app.eA, app.eB, app.firstVsNow, firstEpoch);
  const scanDates = resolveDates(app.eA, app.eB, app.firstVsNow, 0);

  const selData = useMemo(() => {
    if (!sky || !selection) return null;
    if (selection.type === 'blank') return analyzeBlank(sky, selection.x, selection.y);
    const src = sky.byId.get(selection.id);
    return src ? analyzeObject(sky, src, effA, effB, gain) : null;
  }, [sky, selection, effA, effB, gain]);
  const cur = selData && selData.type === 'object' ? selData : null;
  const A = cur ? cur.astro : null;
  const D = cur ? cur.diag : null;
  const reason = useMemo(() => (cur ? reasonOf(cur, effA, effB, gain) : null), [cur, effA, effB, gain]);
  const L = useMemo(() => ({ eA: epochLabel(lang, effA), eB: epochLabel(lang, effB) }), [lang, effA, effB]);
  const explain = useMemo(() => explainReason(t, reason, L), [t, reason, L]);
  const displayCat = cur ? (knownRec ? knownRec.cat : GUESS_CAT[D.guess.id] || 'other') : 'other';
  const catCol = CAT_COLOR[displayCat] || '#9AA7BD';

  // Kaydetme formunu seçime / dile göre hazırla
  const autoText = explain.plain;
  useEffect(() => {
    setSaveCat(cur ? (SAVE_CATS.indexOf(entryForSel ? entryForSel.cat : displayCat) >= 0 ? (entryForSel ? entryForSel.cat : displayCat) : 'other') : 'other');
    setNoteDirty(false); setSavedUid(null);
  }, [selection]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!noteDirty) setNoteText(cur ? autoText : ''); }, [autoText, noteDirty, selection]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartSeries = useMemo(() => {
    if (!selData) return [];
    if (selData.type === 'blank') return [{ name: t('spec.bg'), color: '#6F82A8', flux: selData.spB.flux, err: selData.spB.err }];
    const arr = [];
    if (effA !== effB) arr.push({ name: `E${effA + 1}`, color: '#F0587A', flux: selData.spA.flux, err: selData.spA.err });
    arr.push({ name: `E${effB + 1}`, color: '#5B9DFF', flux: selData.spB.flux, err: selData.spB.err });
    return arr;
  }, [selData, effA, effB, t]);

  /* ---- Tarama sonuçları (geçerlilik: sektör + tarih çifti + çarpan aynı kalmalı) ---- */
  const scanValid = !!(scan && scan.status === 'done' && sky && scan.skyKey === sky.key && scan.eA === scanDates.a && scan.eB === scanDates.b && scan.gain === gain);
  const scanStale = !!(scan && scan.status === 'done' && !scanValid);
  const runScan = async () => {
    if (!sky || (scan && scan.status === 'running')) return;
    const id = ++scanRun.current;
    const eA0 = scanDates.a, eB0 = scanDates.b, g0 = gain, key = sky.key;
    setScan({ status: 'running', progress: 0, items: [], skyKey: key, eA: eA0, eB: eB0, gain: g0 });
    const items = await scanSkyChunked(sky, eA0, eB0, g0, (p) => { if (scanRun.current === id) setScan((s) => (s && s.status === 'running' ? { ...s, progress: p } : s)); });
    if (scanRun.current !== id) return;
    const ts = new Date().toISOString();
    setScan({ status: 'done', progress: 1, items, ts, skyKey: key, eA: eA0, eB: eB0, gain: g0 });
    app.addLog({ ts, sectorId: cfg.id, sectorKey: key, eA: eA0, eB: eB0, n: items.length, k: items.filter((q) => !q.known).length });
  };

  /* ---- Katalog işaretleri ---- */
  const entryMarks = useMemo(() => {
    if (!sky) return [];
    return db.entries.filter((e) => e.sectorKey === sky.key).map((e) => {
      const src = srcOfEntry(sky, e);
      const p = src ? posAt(src, effB, gain) : sky.wcs.skyToPix(e.ra, e.dec);
      return { x: p.x, y: p.y, color: CAT_COLOR[e.cat] || '#9AA7BD', label: e.id.replace('USR-', '') };
    });
  }, [sky, db.entries, effB, gain]);
  const knownMarks = useMemo(() => {
    if (!sky || !(showKnown || mode === 'photo')) return [];
    let list = knownCat.list;
    if (sky.real && list.length > 300) {                           // yoğun gerçek alanda: en parlak 300 + tüm hareketliler
      const movers = list.filter((k) => sky.byId.get(k.srcId).mover);
      const bright = list.filter((k) => !sky.byId.get(k.srcId).mover).sort((a, b) => a.ab - b.ab).slice(0, 300);
      list = movers.concat(bright);
    }
    return list.map((k) => { const s = sky.byId.get(k.srcId); return posAt(s, effB, gain); });
  }, [sky, showKnown, mode, knownCat, effB, gain]);
  const scanMarks = useMemo(() => {
    if (!scanValid) return [];
    return scan.items.map((it) => ({ x: it.x, y: it.y, xA: it.xA, yA: it.yA, n: it.n, isNew: !it.known, moved: it.reason.moved, sel: !!(selSrc && selSrc.id === it.srcId) }));
  }, [scanValid, scan, selSrc]);

  // Fotoğraf kipinde: dalga boyuna göre 2MASS ⇄ AllWISE karışımı
  const photoMix = photo.nir && photo.mir ? skyBlend(lam) : photo.mir ? 1 : 0;
  const photoInfo = useMemo(() => ({ label: photoMix <= 0.01 ? SKY_SURVEYS.nir.name : photoMix >= 0.99 ? SKY_SURVEYS.mir.name : `${SKY_SURVEYS.nir.name} ${Math.round((1 - photoMix) * 100)}% + ${SKY_SURVEYS.mir.name} ${Math.round(photoMix * 100)}%` }), [photoMix]);

  /* ---- ANA ÇİZİM: ImageData → ofscreen → görünüm (zoom/pan) → bindirme ---- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    if (mode !== 'photo' && taintRef.current) { taintRef.current = false; offRef.current = null; canvas.width = 0; }     // CORS'suz fotoğraf tuvali "kirletir": fotoğraf kipinden çıkınca temiz tuval
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    if (canvas.width !== px || canvas.height !== px) { canvas.width = px; canvas.height = px; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#06080E'; ctx.fillRect(0, 0, size, size);
    if (!sky) return;
    if (!offRef.current) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const cx = c.getContext('2d');
      offRef.current = { c, cx, id: cx.createImageData(W, H) };
    }
    const off = offRef.current;
    const tint = presetDef ? presetDef.tint : [0.9, 0.96, 1.0];
    const data = off.id.data;
    const photoOk = mode === 'photo' && photo.key === sky.key && photo.status === 'ok' && (photo.nir || photo.mir);
    if (mode === 'photo') {
      off.cx.globalAlpha = 1; off.cx.fillStyle = '#04060C'; off.cx.fillRect(0, 0, W, H);
      if (photoOk) {
        if ((photo.nir && !photo.nir.cors) || (photo.mir && !photo.mir.cors)) taintRef.current = true;
        const wgt = photo.nir && photo.mir ? skyBlend(lam) : photo.mir ? 1 : 0;
        off.cx.imageSmoothingEnabled = true;
        if (photo.nir && wgt < 1) off.cx.drawImage(photo.nir.img, 0, 0, W, H);
        if (photo.mir && wgt > 0) { off.cx.globalAlpha = wgt; off.cx.drawImage(photo.mir.img, 0, 0, W, H); off.cx.globalAlpha = 1; }
      }
    } else if (mode === 'blink') {
      const v = getView(sky, cache, blinkPhase === 0 ? effA : effB, specView, gain);
      composeSingle(data, v.img, v.sigma, stretchK, tint);
    } else {
      const v1 = getView(sky, cache, effA, specView, gain);
      const v2 = getView(sky, cache, effB, specView, gain);
      if (mode === 'rgb') composeRGB(data, v1.img, v2.img, v1.sigma, stretchK);
      else if (mode === 'diff') composeDiff(data, v1.img, v2.img, v1.sigma, thr, stretchK);
      else composeCurtain(data, v1.img, v2.img, v1.sigma, stretchK, tint, curtain * W);
    }
    if (mode !== 'photo') off.cx.putImageData(off.id, 0, 0);
    const kd = (size / W) * view.z * dpr;
    ctx.imageSmoothingEnabled = kd < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off.c, view.sx, view.sy, W / view.z, H / view.z, 0, 0, size, size);
    drawOverlay(ctx, { sky, view, size, t, lang, mode, effA, effB, band, presetDef, blinkPhase, curtain, selData, entryMarks, knownMarks, scanMarks, photoInfo });
  }, [sky, cache, size, mode, effA, effB, band, preset, blinkPhase, curtain, stretchK, thr, gain, view, selData, entryMarks, knownMarks, scanMarks, t, lang, photo, photoInfo, lam]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Etkileşim ---- */
  const evtToImg = (ev) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const S = sizeRef.current / W;
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const v = viewRef.current;
    return { px, py, x: v.sx + px / (S * v.z), y: v.sy + py / (S * v.z) };
  };
  const selectAt = (p) => {
    const s = pickSource(sky, p.x, p.y, effA, effB, gain, 11 / viewRef.current.z);
    setSelection(s ? { type: 'object', id: s.id } : { type: 'blank', x: p.x, y: p.y });
  };
  const ptsRef = useRef(new Map());
  const pinchRef = useRef(null);
  const dblRef = useRef(null);
  const dtapRef = useRef(null);
  if (!dtapRef.current) dtapRef.current = makeDoubleTap((e) => { if (dblRef.current) dblRef.current(e, true); });
  const onPointerDown = (ev) => {
    if (!sky) return;
    try { canvasRef.current.setPointerCapture(ev.pointerId); } catch (e) { /* yoksay */ }
    ptsRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (ptsRef.current.size === 2) {                                  // iki parmak: sıkıştırarak yakınlaştır
      const [a, b] = Array.from(ptsRef.current.values());
      const rect = canvasRef.current.getBoundingClientRect();
      const v = viewRef.current;
      pinchRef.current = { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), z: v.z, sx: v.sx, sy: v.sy, px: (a.x + b.x) / 2 - rect.left, py: (a.y + b.y) / 2 - rect.top };
      dragRef.current = null;
      return;
    }
    const p = evtToImg(ev);
    const v = viewRef.current;
    const kind = mode === 'split' && Math.abs(p.x - curtain * W) < 14 / v.z ? 'curtain' : 'pan';
    dragRef.current = { kind, startX: ev.clientX, startY: ev.clientY, moved: false, sx: v.sx, sy: v.sy };
  };
  const onPointerMove = (ev) => {
    if (!sky) return;
    if (ptsRef.current.has(ev.pointerId)) ptsRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const pc = pinchRef.current;
    if (pc && ptsRef.current.size >= 2) {
      const [a, b] = Array.from(ptsRef.current.values());
      const rect = canvasRef.current.getBoundingClientRect();
      const S = sizeRef.current / W;
      const nz = clamp(pc.z * (Math.hypot(a.x - b.x, a.y - b.y) / pc.d), 1, MAP_ZMAX);
      const ix = pc.sx + pc.px / (S * pc.z), iy = pc.sy + pc.py / (S * pc.z);
      const px = (a.x + b.x) / 2 - rect.left, py = (a.y + b.y) / 2 - rect.top;
      setView({ z: nz, sx: clamp(ix - px / (S * nz), 0, W - W / nz), sy: clamp(iy - py / (S * nz), 0, H - H / nz) });
      return;
    }
    const p = evtToImg(ev);
    if (cursorRef.current) {
      const s = sky.wcs.pixToSky(p.x, p.y);
      cursorRef.current.textContent = `RA ${fmtRA(s.ra)}  Dec ${fmtDec(s.dec)}`;
    }
    const d = dragRef.current;
    if (!d) return;
    const dxs = ev.clientX - d.startX, dys = ev.clientY - d.startY;
    if (!d.moved && Math.hypot(dxs, dys) > 4) d.moved = true;
    if (d.kind === 'curtain') setCurtain(clamp(p.x / W, 0.02, 0.98));
    else if (d.moved && viewRef.current.z > 1) {
      const z = viewRef.current.z;
      const k = 1 / ((sizeRef.current / W) * z);
      setView({ z, sx: clamp(d.sx - dxs * k, 0, W - W / z), sy: clamp(d.sy - dys * k, 0, H - H / z) });
    }
  };
  const onPointerUp = (ev) => {
    ptsRef.current.delete(ev.pointerId);
    if (ptsRef.current.size < 2) pinchRef.current = null;
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !sky) return;
    if (d.kind === 'pan' && !d.moved) { if (dtapRef.current(ev)) return; selectAt(evtToImg(ev)); }
    if (d.kind === 'curtain' && !d.moved) setCurtain(clamp(evtToImg(ev).x / W, 0.02, 0.98));
  };
  const zoomBy = (f) => {
    const v = viewRef.current;
    const nz = clamp(v.z * f, 1, MAP_ZMAX);
    const ix = v.sx + W / v.z / 2, iy = v.sy + H / v.z / 2;
    setView({ z: nz, sx: clamp(ix - W / nz / 2, 0, W - W / nz), sy: clamp(iy - H / nz / 2, 0, H - H / nz) });
  };
  zoomRef.current = zoomBy;
  const onDblClick = (ev, fromTap) => {                                // çift tık / çift dokunuş: nokta üzerine ×2 (en yakındaysa sıfırla)
    const c = canvasRef.current;
    if (!c || !sky) return;
    if (!fromTap && (ev.timeStamp || 0) - dtapRef.current.at < 600) return;
    const rect = c.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const v = viewRef.current;
    const S = sizeRef.current / W;
    const nz = v.z >= MAP_ZMAX * 0.99 ? 1 : clamp(v.z * 2, 1, MAP_ZMAX);
    const ix = v.sx + px / (S * v.z), iy = v.sy + py / (S * v.z);
    setView({ z: nz, sx: clamp(ix - px / (S * nz), 0, W - W / nz), sy: clamp(iy - py / (S * nz), 0, H - H / nz) });
  };
  dblRef.current = onDblClick;
  const zoomTo = (x, y, z) => setView({ z, sx: clamp(x - W / z / 2, 0, W - W / z), sy: clamp(y - H / z / 2, 0, H - H / z) });
  const savePNG = () => {
    const c = canvasRef.current;
    if (!c) return;
    try {
      c.toBlob((b) => {
      if (!b) return;
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url; a.download = `nyxe_${cfg.id}_${mode}_E${effA + 1}-E${effB + 1}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      });
    } catch (e) { /* tarayıcı güvenliği (CORS'suz fotoğraf) PNG kaydını engelleyebilir */ }
  };

  /* ---- Katalogdan "Haritada Göster & İncele" isteği ---- */
  useEffect(() => {
    const f = app.focus;
    if (!f || !sky || !active || f.skyKey !== sky.key) return;
    const src = srcOfEntry(sky, f);
    app.clearFocus();
    if (src) {
      setSelection({ type: 'object', id: src.id });
      const pa = posAt(src, effA, gain), pb = posAt(src, effB, gain);
      zoomTo((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, 4);
    } else if (f.pixel) {
      setSelection({ type: 'blank', x: f.pixel.x, y: f.pixel.y });
      zoomTo(f.pixel.x, f.pixel.y, 4);
    }
    setTimeout(revealMap, 60);
  }, [app.focus, sky, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusSrcId = (id) => {
    const src = sky.byId.get(id);
    if (!src) return;
    setSelection({ type: 'object', id });
    const pa = posAt(src, scanDates.a, gain), pb = posAt(src, scanDates.b, gain);
    zoomTo((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, 4);
    revealMap();
  };

  /* ---- Kontroller ---- */
  const pickBand = (b) => { setBand(clamp(b, 0, N_BANDS - 1)); setPreset(null); };
  const togglePreset = (p) => { if (preset === p.id) { setPreset(null); return; } setPreset(p.id); setBand(p.band); };

  /* ---- Kataloğa kaydet ---- */
  const exportPython = () => {
    if (!cur) return;
    const label = isReal ? cur.src.catId : knownRec ? knownRec.id : `Candidate #${cur.src.id}`;
    const d = pyDataFromAnalysis({ an: cur, eA: effA, eB: effB, gain, label, consoleId: entryForSel ? entryForSel.id : knownRec ? knownRec.id : label, knownId: knownRec ? knownRec.id : '', savedId: entryForSel ? entryForSel.id : '' });
    const name = downloadPython(d);
    setPyMsg(t('py.done', { name }));
  };
  useEffect(() => { if (!pyMsg) return undefined; const id = setTimeout(() => setPyMsg(null), 6000); return () => clearTimeout(id); }, [pyMsg]);
  useEffect(() => { setPyMsg(null); }, [selection]);
  const saveSelection = () => {
    if (!selData || !sky) return;
    const isObj = selData.type === 'object';
    const auto = autoText.trim();
    let userNote = noteText.trim();
    if (isObj && userNote === auto) userNote = '';
    else if (isObj && auto && userNote.indexOf(auto) === 0) userNote = userNote.slice(auto.length).trim();
    const draft = makeEntryDraft({ sky, cfg, custom: app.custom, an: selData, reason, effA, effB, gain, cat: saveCat, userNote, history, knownRec });
    if (entryForSel) draft.firstEpoch = entryForSel.firstEpoch;
    const saved = app.saveEntry(draft);
    setSavedUid(saved.uid);
    setNoteDirty(false);
  };
  const savedEntry = savedUid ? db.entries.find((e) => e.uid === savedUid) || null : null;

  /* ---- Türetilmiş görüntü değerleri ---- */
  const dtYr = EPOCHS[effB].t - EPOCHS[effA].t;
  const posSky = selData ? selData.skyB : null;
  const nTargets = sky && !isReal ? undiscoveredTargets(sky).length : 0;
  const foundN = sky && !isReal ? db.entries.filter((e) => e.sectorKey === sky.key && e.hidden && e.cat === e.truth && !e.known).length : 0;
  const dateOpts = EPOCHS.map((e) => ({ v: e.id, label: epochFull(lang, t, e.id) }));

  /* =====================================================================
     RENDER — sahne (kenardan kenara tuval) · yüzen cam çekmeceler · tek ince alt HUD
     ===================================================================== */
  const spectralBg = 'linear-gradient(90deg,#3b0a12 0%,#8a1c2b 18%,#ff3366 42%,#ff8a5c 66%,#ffd9a8 100%)';
  const catGlyph = (c) => CAT_EMOJI[c] || '◆';

  const leftBody = (
    <>
      {/* 01 · Alan (sektör) */}
      <Card title={t('sector.label')} tip="tip.sector" icon={<span>1</span>}>
        <div className="flex flex-wrap gap-x-5 gap-y-1" role="group" aria-label={t('sector.label')}>
          {SECTORS.map((sc, i) => (
            <button key={sc.id} type="button" className="ed-segbtn" data-testid={`sector-${sc.id}`} aria-pressed={app.sectorId === sc.id} title={t('sec.' + sc.id + '.sub')} onClick={() => app.setSectorId(sc.id)}>
              <i>{edPad(i + 1)}</i>{t('sec.' + sc.id + '.short')}
            </button>
          ))}
        </div>
        <div className="mt-3 text-[11.5px] leading-snug text-[#93A6CC]" data-testid="sector-info">
          <div className="ed-serif text-[17px] italic leading-tight text-[#EEF3FD]">{t('sec.' + cfg.id + '.title')}</div>
          <div className="mt-1">{t('sec.' + cfg.id + '.sub')}</div>
          <div className="ed-mono mt-1 text-[10.5px] text-[#667BA3]">{fmtRA(cfg.ra, 0)} | {fmtDec(cfg.dec)}</div>
        </div>
      </Card>

      {/* 02 · Haritanın verisi: gerçek (SIMBAD · SkyBoT) ⇄ simülasyon */}
      <Card title={t('rm.title')} tip="tip.rm" icon={<span>2</span>}>
        <div data-testid="map-src-card" data-src={app.mapSrc}>
          <div className="flex gap-x-6" role="group" aria-label={t('rm.title')}>
            {[['real', 'rm.opt.real'], ['sim', 'rm.opt.sim']].map(([id, k], i) => (
              <button key={id} type="button" className="ed-segbtn" data-testid={`map-src-${id}`} aria-pressed={app.mapSrc === id} onClick={() => app.chooseMapSrc(id)}><i>{edPad(i + 1)}</i>{t(k)}</button>
            ))}
          </div>
          {realOn ? (
            <div className="mt-3 space-y-2.5 text-[11.5px] leading-snug text-[#93A6CC]">
              <p>{t('rm.real.desc')}</p>
              {isReal && (
                <div className="ed-note-box ed-mono space-y-0.5 text-[10.5px]" data-testid="rm-stats">
                  <div>{t('rm.stat.simbad', { n: sky.real.shown - sky.real.ast })}{sky.real.truncated ? ' ' + t('rm.stat.trunc', { n: RS_TOP }) : ''}</div>
                  <div>{t('rm.stat.movers', { n: sky.real.movers })}</div>
                  <div className={sky.real.skybotOk ? '' : 'text-[#E3B567]'}>
                    {!sky.real.skybotOk ? t('rm.stat.skybot.fail') : sky.real.ast === 0 ? t('rm.stat.skybot.none') : t('rm.stat.skybot.ok', { n: sky.real.ast })}
                    {sky.real.skybotOk && sky.real.skybot.some((q) => q.status !== 'ok') ? ' ' + t('rm.stat.skybot.part', { a: sky.real.skybot.filter((q) => q.status === 'ok').length }) : ''}
                  </div>
                </div>
              )}
              <p className="ed-note-box is-warn text-[10.5px]" data-testid="rm-model-note">{t('rm.model')}</p>
              <div>
                <div className="ed-label mb-2">{t('rm.quick')}</div>
                <div className="flex flex-wrap gap-2">
                  {quickTargets().map((tg) => (
                    <button key={tg.id} type="button" data-testid={`rm-quick-${tg.id}`} onClick={() => app.goCustom(tg)} className="ed-btn is-sm">{tg.name} · {(Math.hypot(tg.pmra, tg.pmdec) / 1000).toFixed(1)}″/{t('common.yr')}</button>
                  ))}
                </div>
                <p className="mt-2 text-[10.5px] text-[#667BA3]">{t('rm.quick.help')}</p>
                {isReal && sky.real.movers < 3 && <p className="mt-1 text-[10.5px] text-[#9895AA]" data-testid="rm-nomove">{t('rm.noMove')}</p>}
              </div>
              <p className="text-[10px] text-[#4B4A5B]">{t('rm.credit')}</p>
            </div>
          ) : (
            <div className="mt-3 space-y-1 text-[11.5px] leading-snug text-[#93A6CC]" data-testid="rm-sim-hint"><p>{t('rm.sim.desc')}</p><p>{t('rm.sim.hint')}</p></div>
          )}
        </div>
      </Card>

      {/* 03 · Otomatik tarama */}
      <Card title={t('scan.title')} tip="tip.scan" icon={<span>3</span>}>
        <button type="button" data-testid="scan-btn" disabled={!sky || building || (scan && scan.status === 'running')} onClick={runScan} className="ed-btn ed-go is-bad is-block">
          {scan && scan.status === 'running' ? t('scan.running', { p: Math.round(scan.progress * 100) }) : t('scan.btn')}
        </button>
        {scan && scan.status === 'running' && (<div className="ed-bar mt-3"><i style={{ width: `${Math.round(scan.progress * 100)}%` }} /></div>)}
        {scanStale && <div className="ed-note-box is-warn mt-3" data-testid="scan-stale">{t('scan.stale')}</div>}
        {scanValid && (
          <div className="mt-4" data-testid="scan-results">
            <div className="ed-serif text-[16px] italic text-[#EEF3FD]">{scan.items.length ? t('scan.found', { n: scan.items.length, k: scan.items.filter((q) => !q.known).length }) : t('scan.none')}</div>
            <div className="ed-mono mt-0.5 text-[10px] text-[#667BA3]">{t('scan.at', { ts: fmtTs(lang, scan.ts) })}</div>
            <ul className="spx-scroll mt-2 max-h-[250px] overflow-y-auto">
              {scan.items.map((it) => {
                const r = it.reason;
                const cat = catOfItem(it);
                const sel = selSrc && selSrc.id === it.srcId;
                return (
                  <li key={it.srcId}>
                    <button type="button" data-testid="scan-item" aria-pressed={!!sel} onClick={() => focusSrcId(it.srcId)} className="ed-row">
                      <div className="flex items-start gap-3">
                        <span className="ed-mono mt-[3px] w-5 shrink-0 text-[10px]" style={{ color: it.known ? '#8FE0B5' : '#F0587A' }}>{edPad(it.n)}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] leading-snug text-[#EEF3FD]"><span aria-hidden style={{ color: CAT_COLOR[cat] }}>{catGlyph(cat)}</span> {guessLabel(t, it.guessKey)}</div>
                          <div className="mt-0.5 text-[10.5px] text-[#93A6CC]">{changeSummary(t, r)}</div>
                          <div className="mt-1.5">{it.known ? <Chip color="#8FE0B5">{t('scan.inCatalog')} · {it.knownId}</Chip> : <Chip color="#F0587A">{t('scan.new')}</Chip>}</div>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {!scan && <p className="mt-3 text-[11px] leading-snug text-[#667BA3]">{t('scan.hint')}</p>}
      </Card>

      {/* 04 · Hazır filtreler */}
      <Card title={t('filters.title')} tip="tip.filters" icon={<span>4</span>}>
        <div>
          {PRESETS.map((p) => {
            const on = preset === p.id;
            return (
              <div key={p.id} className="relative">
                <button type="button" data-testid={`preset-${p.id}`} aria-pressed={on} onClick={() => togglePreset(p)} className="ed-row pr-9" style={on ? { boxShadow: `inset 2px 0 0 ${p.color}` } : undefined}>
                  <div className="flex items-start gap-3">
                    <i className="ed-dot mt-[5px] shrink-0" style={{ background: p.color }} aria-hidden />
                    <div className="min-w-0">
                      <div className="text-[12.5px] leading-snug text-[#EEF3FD]">{t('filter.' + p.id + '.n')}</div>
                      <div className="text-[10.5px] text-[#667BA3]">{t('filter.' + p.id + '.s')}</div>
                    </div>
                  </div>
                  {on && <div className="mt-2 pl-[26px] text-[11px] leading-snug text-[#93A6CC]">{t('filter.' + p.id + '.help')}</div>}
                </button>
                <span className="absolute right-1 top-3"><InfoTip id={'tip.filter.' + p.id} title={t('filter.' + p.id + '.n')} /></span>
              </div>
            );
          })}
          {preset && <button type="button" onClick={() => setPreset(null)} className="ed-link mt-3">{t('filters.off')}</button>}
        </div>
      </Card>

      {/* Görüntü ayarları — varsayılan kapalı */}
      <Disclosure title={t('settings.title')} tip="tip.settings" open={settingsOpen} onToggle={() => setSettingsOpen((o) => !o)} testId="settings-toggle">
        <div className="space-y-4">
          <Slide label={t('settings.blinkHz')} value={blinkHz} min={1} max={10} step={0.5} onChange={setBlinkHz} fmt={(v) => `${v.toFixed(1)} Hz`} />
          <Slide label={t('settings.bright')} value={stretchK} min={0.5} max={3} step={0.05} onChange={setStretchK} fmt={(v) => `×${v.toFixed(2)}`} />
          <Slide label={t('settings.thr')} value={thr} min={0} max={6} step={0.1} onChange={setThr} fmt={(v) => `${v.toFixed(1)} σ`} />
          {isReal ? (
            <p className="ed-note-box is-ok text-[10.5px]" data-testid="gain-real-note">{t('rm.gain.real')}</p>
          ) : (
            <>
              <Slide red label={t('settings.gain')} tip="tip.gain" value={gain} min={1} max={GAIN_MAX} step={1} onChange={app.setGain} fmt={(v) => `×${v}`} />
              <p className="text-[10.5px] leading-snug text-[#667BA3]">{t('settings.gainHelp')}</p>
            </>
          )}
          <label className="flex cursor-pointer items-center gap-2.5 text-[12px] text-[#C5D3EE]"><input type="checkbox" checked={showKnown} onChange={(e) => setShowKnown(e.target.checked)} />{t('settings.markers')}</label>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            {[['SIMBAD', 'https://simbad.cds.unistra.fr/simbad/'], ['Aladin', 'https://aladin.cds.unistra.fr/AladinLite/'], ['NASA IRSA · SPHEREx', 'https://irsa.ipac.caltech.edu/Missions/spherex.html'], ['MPC MPChecker', 'https://minorplanetcenter.net/cgi-bin/checkmp.cgi'], ['Backyard Worlds', 'https://www.zooniverse.org/projects/marckuchner/backyard-worlds-planet-9']].map(([n, u]) => (
              <a key={n} href={u} target="_blank" rel="noreferrer" className="ed-link" style={{ color: 'var(--acc)' }}>{n} ↗</a>
            ))}
          </div>
          <div className="text-[10.5px] leading-snug text-[#667BA3]">{t('settings.keys')}</div>
        </div>
      </Disclosure>
    </>
  );

  const rightBody = (
    <>
      {!selData && (
        <section className="ed-sec" data-testid="empty-state">
          <div className="ed-label" style={{ color: 'var(--acc)' }}>⌖ 00</div>
          <div className="ed-serif mt-3 text-[26px] italic leading-[1.1] text-[#EEF3FD]">{t('empty.title')}</div>
          <p className="mt-3 text-[12px] leading-relaxed text-[#93A6CC]">{t('empty.body')}</p>
          <ol className="mt-4 space-y-2.5 text-[12px] text-[#C5D3EE]">
            {['empty.s1', 'empty.s2', 'empty.s3'].map((k, i) => (
              <li key={k} className="flex gap-3 border-t border-white/10 pt-2.5"><span className="ed-sec-n mt-[2px]">{edPad(i + 1)}</span><span>{t(k)}</span></li>
            ))}
          </ol>
          {sky && !isReal && <p className="mt-4 text-[11.5px] text-[#F0587A]">{t('sky.targets', { n: nTargets })}</p>}
          {isReal && <p className="mt-4 text-[11.5px] leading-snug text-[#8FE0B5]" data-testid="rm-empty">{t('rm.empty', { n: sky.real.shown, m: sky.real.movers })}</p>}
        </section>
      )}

      {selData && (
        <div className="flex items-start justify-between gap-3 px-[18px] pb-3 pt-4">
          <div className="min-w-0">
            <div className="ed-mono truncate text-[12px] text-[#EEF3FD]">RA <span className="text-[color:var(--acc)]">{fmtRA(posSky.ra)}</span> | Dec <span className="text-[color:var(--acc)]">{fmtDec(posSky.dec)}</span></div>
            <div className="ed-mono mt-1 truncate text-[10px] text-[#667BA3]">{selData.type === 'object' ? `#${selData.src.id} · ` : ''}x {(selData.type === 'object' ? selData.posB : selData.pos).x.toFixed(1)}, y {(selData.type === 'object' ? selData.posB : selData.pos).y.toFixed(1)} · J2000</div>
          </div>
          <button type="button" onClick={() => setSelection(null)} className="ed-link shrink-0" aria-label={t('common.close')}>✕</button>
        </div>
      )}

      {/* 01 · Akıllı cisim teşhisi & değişim nedeni */}
      {cur && (
        <section className="ed-sec" style={{ boxShadow: `inset 2px 0 0 ${catCol}` }} data-testid="diag-card">
          <header className="ed-sec-h">
            <span className="ed-sec-n">01</span><h3 className="ed-sec-t">{t('diag.title')}</h3><InfoTip id="tip.diag" title={t('diag.title')} />
          </header>
          <div className="flex items-start gap-3">
            <span className="mt-1 text-[22px] leading-none" style={{ color: catCol }} aria-hidden>{catGlyph(displayCat)}</span>
            <div className="min-w-0">
              <div className="ed-serif text-[24px] leading-[1.1] text-[#F5F8FF]" data-testid="diag-name">{knownRec ? kindLabel(t, cur.src) : guessLabel(t, D.guess.key, D.Tc)}</div>
              <div className="mt-1 text-[11px] leading-snug text-[#93A6CC]">{t('diag.auto')}: {guessLabel(t, D.guess.key, D.Tc)}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            {knownRec ? <Chip color="#8FE0B5">{t('diag.known', { id: knownRec.id })}</Chip> : <Chip color="#F0587A">{t('diag.new')}</Chip>}
            {entryForSel && <Chip color="#A9C4F5">{entryForSel.id}</Chip>}
            {app.training && !isReal && <Chip color="#8FE0B5">{t('diag.truth')}: {kindLabel(t, cur.src)}</Chip>}
          </div>
          <div className="ed-mono mt-4 text-[11px] text-[#EEF3FD]">{L.eA} → {L.eB} <span className="text-[#93A6CC]">| Δt {dtYr.toFixed(2)} {t('common.yr')}</span></div>
          <div className="mt-2 space-y-3" data-testid="reason-list">
            {explain.items.map((it, i) => (
              <div key={i} className="ed-reason">
                <div className="text-[13px] leading-snug text-[#F5F8FF]"><span aria-hidden style={{ color: 'var(--acc)' }}>{it.emoji}</span> {it.head}</div>
                {it.measured ? <div className="ed-mono mt-1 text-[10.5px] leading-snug text-[#9895AA]">{it.measured}</div> : null}
                <div className="mt-1.5 text-[12px] leading-relaxed text-[#C9C6D6]"><b className="font-medium text-[#E3B567]">{t('why.cause')}</b> {it.cause}</div>
              </div>
            ))}
          </div>
          {!A.valid && <div className="ed-note-box is-warn mt-3">{effA === effB ? t('m.astro.same') : t('m.astro.invalid')}</div>}

          {/* Zaman çizelgesi */}
          <div className="mt-5 border-t border-white/10 pt-3">
            <div className="ed-label mb-3 flex items-center gap-2">{t('tl.title')}<InfoTip id="tip.timeline" title={t('tl.title')} /></div>
            <ol className="space-y-2.5" data-testid="timeline">
              {history && history.map((h) => {
                const isFirst = history.findIndex((q) => q.valid) === h.e && h.valid;
                return (
                  <li key={h.e} className="flex gap-3">
                    <span className="mt-[5px] h-[7px] w-[7px] shrink-0 rotate-45" style={{ background: h.valid ? catCol : '#3a3850', boxShadow: h.valid ? `0 0 8px ${catCol}` : 'none' }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-[11.5px] text-[#EEF3FD]">
                        <span>{epochLabel(lang, h.e)}</span>
                        {h.e === effA && <span className="ed-mono text-[10px] text-[#F0587A]">[A]</span>}
                        {h.e === effB && <span className="ed-mono text-[10px] text-[#5B9DFF]">[B]</span>}
                        {isFirst && <span className="text-[10.5px] text-[#E3B567]">★ {t('tl.first')}</span>}
                        <span className="ed-mono ml-auto text-[10.5px] text-[#9895AA]">{h.valid ? `AB ${h.ab.toFixed(2)}` : ''}</span>
                      </div>
                      <div className="ed-mono text-[10px] leading-snug text-[#757287]">{h.valid ? `${fmtRA(h.ra, 1)} ${fmtDec(h.dec)}${h.off !== null && h.off > 0.05 ? ` · +${h.off.toFixed(1)}″` : ''}` : t('tl.none')}</div>
                    </div>
                  </li>
                );
              })}
              {entryForSel && (
                <li className="flex gap-3"><span className="mt-[5px] h-[7px] w-[7px] shrink-0 rotate-45 bg-[#5B9DFF]" /><div className="text-[11.5px] text-[#EEF3FD]">{t('tl.saved', { ts: fmtTs(lang, entryForSel.ts) })}</div></li>
              )}
            </ol>
          </div>
        </section>
      )}

      {cur && isReal && (() => {
        const rs = cur.src;
        const sso = rs.kind === 'rast' || rs.kind === 'rcom' || rs.kind === 'rkbo';
        const mags = ['V', 'J', 'K'].filter((b) => rs.mags && rs.mags[b] !== null && rs.mags[b] !== undefined).map((b) => `${b} ${rs.mags[b].toFixed(2)}`).join(' · ');
        const rows = sso
          ? [['rm.f.cls', rs.cls || rs.otype || '—'], ['rm.f.mag', mags || '—']]
          : [['rm.f.otype', rs.otype || '—'], ['rm.f.sp', rs.sp || '—'], ['rm.f.mag', mags || '—'], ['rm.f.pm', rs.mu > 0 ? `${rs.mu.toFixed(1)} mas/${t('common.yr')}` : '—'], ['rm.f.plx', rs.plxMas > 0 ? `${rs.plxMas.toFixed(2)} mas` : '—']];
        return (
          <section className="ed-sec" style={{ boxShadow: 'inset 2px 0 0 #8FE0B5' }} data-testid="real-card">
            <header className="ed-sec-h"><span className="ed-sec-n">02</span><h3 className="ed-sec-t">{t('rm.card.title')}</h3></header>
            <div className="ed-mono break-words text-[12.5px] text-[#8FE0B5]" data-testid="real-card-id">{rs.catId}</div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11.5px]">
              {rows.map(([k, v]) => (<React.Fragment key={k}><dt className="text-[#757287]">{t(k)}</dt><dd className="ed-mono min-w-0 break-words text-[#EEF3FD]">{v}</dd></React.Fragment>))}
            </dl>
            <a href={sso ? mpcUrl(rs.catId) : simbadUrl(rs.catId)} target="_blank" rel="noreferrer" className="ed-link mt-3" style={{ color: 'var(--acc)' }} data-testid="real-card-link">{sso ? t('rm.open.mpc') : t('rm.open.simbad')} ↗</a>
            <p className="mt-3 text-[10.5px] leading-snug text-[#9895AA]">{t('rm.model.short')}</p>
          </section>
        );
      })()}

      {selData && selData.type === 'blank' && (
        <section className="ed-sec" data-testid="blank-card">
          <div className="ed-serif mb-2 text-[20px] italic text-[#EEF3FD]">{t('blank.title')}</div>
          <p className="text-[12px] leading-relaxed text-[#C5D3EE]">{t('blank.body')}</p>
        </section>
      )}

      {/* 03 · Kızılötesi parmak izi */}
      {selData && (
        <Card title={t('spec.title')} tip="tip.spectrum" icon={<span>3</span>}
          right={<div className="flex gap-3 ed-mono text-[10px]">
            {[['flux', 'F_ν'], ['ab', 'AB']].map(([id, n]) => (<button key={id} type="button" onClick={() => setYMode(id)} aria-pressed={yMode === id} className="ed-link">{n}</button>))}
          </div>}>
          <SpectrumChart series={chartSeries} yMode={yMode} bandSel={preset ? null : band} marks={presetDef ? presetDef.marks : []} onPick={pickBand} />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#93A6CC]" data-testid="spec-legend">
            <span><span style={{ color: '#5B9DFF' }}>■</span> {t('abs.h2o')} H₂O</span>
            <span><span style={{ color: '#8DB9FF' }}>■</span> {t('abs.ch4')} CH₄</span>
            <span><span style={{ color: '#8FE0B5' }}>■</span> CO₂</span>
            <span><span style={{ color: '#F0587A' }}>■</span> CO</span>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-[#667BA3]">{t('spec.hint')}</p>
        </Card>
      )}

      {/* 04 · Teknik veriler (kapalı) */}
      {cur && (
        <Disclosure title={t('tech.title')} tip="tip.tech" open={techOpen} onToggle={() => setTechOpen((o) => !o)} testId="tech-toggle">
          <div className="grid grid-cols-2 gap-x-5" data-testid="tech-grid">
            {A.valid ? (
              <>
                <Stat label={t('metric.dtheta')} tip="tip.metric.dtheta" value={`${A.dtheta.toFixed(2)}″`} sub={`± ${A.dthetaErr.toFixed(2)}″ · ${A.signif.toFixed(1)}σ`} color="#A9C4F5" />
                <Stat label={t('metric.mu')} tip="tip.metric.mu" value={`${A.mu.toFixed(2)} ″/${t('common.yr')}`} sub={`± ${A.muErr.toFixed(2)} · ≈ ${(A.mu / gain).toFixed(2)} (×${gain})`} color="#F0587A" />
                <Stat label={t('metric.pa')} tip="tip.metric.pa" value={`${A.pa.toFixed(1)}°`} sub={t('m.pa.sub', { ra: A.muRA.toFixed(1), dec: A.muDec.toFixed(1) })} />
              </>
            ) : (
              <div className="ed-note-box is-warn col-span-2 mb-2">{effA === effB ? t('m.astro.same') : t('m.astro.invalid')}</div>
            )}
            <Stat label={t('metric.color')} tip="tip.metric.color" value={fmtN(D.colorRatio.v, 2)} sub={D.colorRatio.v < 0.6 ? t('m.color.red') : D.colorRatio.v > 2 ? t('m.color.star') : t('m.color.mid')} />
            <Stat label={t('metric.thermal')} tip="tip.metric.thermal" value={fmtN(D.thermal, 2)} sub={D.thermal > 1.3 ? t('m.therm.rise') : t('m.therm.flat')} />
            <Stat label={t('metric.ice')} tip="tip.metric.ice" value={D.ice.ok ? `${(D.ice.depth * 100).toFixed(0)} %` : '—'} sub={D.ice.ok ? `± ${(D.ice.err * 100).toFixed(0)} %` : t('m.ice.na')} color={D.ice.ok && D.ice.depth > 0.3 ? '#5B9DFF' : undefined} />
            <Stat label={t('metric.co2')} tip="tip.metric.co2" value={D.co2.ok ? `${D.co2.x >= 0 ? '+' : ''}${(D.co2.x * 100).toFixed(0)} %` : '—'} sub={D.co2.ok ? (D.co2.x > 0.2 ? t('m.co2.emis') : D.co2.x < -0.2 ? t('m.co2.abs') : t('m.co2.none')) : t('m.na')} color={D.co2.ok && D.co2.x > 0.35 ? '#8FE0B5' : undefined} />
            <Stat label={t('metric.pah')} tip="tip.metric.pah" value={D.pah.ok ? `${D.pah.x >= 0 ? '+' : ''}${(D.pah.x * 100).toFixed(0)} %` : '—'} sub={t('m.pah.sub')} />
            <Stat label={t('metric.flux')} tip="tip.metric.flux" value={isFinite(D.varRatio) ? `×${D.varRatio.toFixed(2)}` : t('m.flux.new')} sub={`${D.varSig.toFixed(1)}σ`} color={D.varSig > 6 && (D.varRatio > 1.45 || D.varRatio < 0.69) ? '#F0587A' : undefined} />
            <Stat label={t('metric.tc')} tip="tip.metric.tc" value={isFinite(D.Tc) ? `${Math.round(D.Tc / 50) * 50} K` : '—'} sub={t('m.tc.sub')} />
          </div>
          <div className="ed-mono mt-2 text-[10px] leading-snug text-[#667BA3]">{A.valid ? `${t('m.band', { lam: BAND_LAMBDA[A.band].toFixed(2) })} | S/N ${Math.min(A.cenA.snr, A.cenB.snr).toFixed(0)}` : ''}</div>
        </Disclosure>
      )}

      {/* Python (astropy) betiği: seçili cismin ölçümlerini gömer */}
      {cur && (
        <section className="ed-sec" data-testid="py-card">
          <div className="flex items-center gap-2">
            <button type="button" data-testid="py-export" onClick={exportPython} className="ed-btn ed-go is-block">{t('py.btn')}</button>
            <InfoTip id="tip.py" title={t('py.btn')} />
          </div>
          {pyMsg && <div className="mt-2 text-[11px] text-[#8FE0B5]" data-testid="py-done" role="status">● {pyMsg}</div>}
        </section>
      )}

      {/* 05 · Kataloğa kaydet & not ekle */}
      {selData && (
        <Card title={t('save.title')} tip="tip.save" icon={<span>5</span>}>
          <div className="space-y-3">
            <label className="ed-label block">{t('save.cat')}
              <select data-testid="save-cat" value={saveCat} onChange={(e) => setSaveCat(e.target.value)} className="mt-1 block w-full">
                {SAVE_CATS.map((c) => (<option key={c} value={c}>{catGlyph(c)} {t('cat.' + c)}</option>))}
              </select>
            </label>
            <label className="ed-label block">{t('save.note')}
              <textarea data-testid="save-note" rows={cur ? 6 : 3} value={noteText} onChange={(e) => { setNoteText(e.target.value); setNoteDirty(true); }} placeholder={t('save.notePh')}
                className="spx-scroll mt-1 block w-full resize-y" />
            </label>
            {cur && noteDirty && <button type="button" onClick={() => setNoteDirty(false)} className="ed-link">{t('save.resetNote')}</button>}
            <button type="button" data-testid="save-btn" onClick={saveSelection} className="ed-btn ed-go is-primary is-block">{t('save.btn')}</button>
            {savedEntry && (
              <div className="ed-note-box is-ok" data-testid="saved-box">
                <div className="text-[12px] text-[#8FE0B5]">● {t('save.done', { id: savedEntry.id })}</div>
                <div className="ed-mono text-[10px] text-[#9895AA]">{t('save.at', { ts: fmtTs(lang, savedEntry.updatedTs || savedEntry.ts) })}</div>
                <div className="mt-2"><CatalogStatus app={app} entry={savedEntry} compact /></div>
                <button type="button" data-testid="open-in-catalog" onClick={() => app.openInCatalog(savedEntry.objKey)} className="ed-link mt-3" style={{ color: 'var(--acc)' }}>{t('save.openCatalog')} →</button>
              </div>
            )}
          </div>
        </Card>
      )}
    </>
  );

  /* ---- Sahne: tuval + (yalnız gerekince) bilgi katmanları ---- */
  const stageNode = (
    <div ref={centerRef} className="absolute inset-0" data-testid="center-panel">
      <div ref={boxRef} className="absolute grid place-items-center" style={{ inset: '16px 0' }} data-testid="canvas-box">
        <div className="ed-frame" style={{ width: size, height: size }}>
          <canvas ref={canvasRef} data-testid="sky-canvas" style={{ width: size, height: size, touchAction: zpTouch(view.z) }}
            className="block cursor-crosshair" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onDoubleClick={onDblClick} onPointerCancel={(ev) => { dragRef.current = null; ptsRef.current.delete(ev.pointerId); pinchRef.current = null; }}
            aria-label={t('sky.aria')} title={t('zp.hint')} />
          {sky && <ZoomButtons prefix="map" z={view.z} max={MAP_ZMAX} onIn={() => zoomBy(1.5)} onOut={() => zoomBy(1 / 1.5)} onReset={() => setView({ z: 1, sx: 0, sy: 0 })} />}
        </div>
        {building && (
          <div className="ed-veil" data-testid="map-building" data-real={realOn && load.phase === 'loading' ? '1' : '0'}>
            <div className="max-w-[380px] px-4 text-center">
              <div className="ed-spin mx-auto mb-4" />
              {realOn && load.phase === 'loading' ? (
                <>
                  <div className="ed-label spx-pulse" style={{ color: 'var(--acc)' }} data-testid="rm-loading">{t('rm.loading')}</div>
                  <div className="mt-2 text-[11.5px] leading-snug text-[#93A6CC]">{t('rm.loading.sub')}</div>
                  <div className="ed-mono mt-2 text-[11px] text-[#9895AA]" data-testid="rm-loading-parts">{t('rm.loading.parts', { s: load.simbad === null ? '…' : load.simbad === 'fail' ? '✗' : `✓ ${load.simbad}`, k: load.skybot })}</div>
                  <button type="button" data-testid="rm-skip" onClick={() => app.skipMap()} className="ed-btn ed-go is-sm mt-4">{t('rm.skip')}</button>
                </>
              ) : (
                <>
                  <div className="ed-label spx-pulse" style={{ color: 'var(--acc)' }}>{t('building')}</div>
                  <div className="mt-2 text-[11px] text-[#667BA3]">{t('building.sub')}</div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {notice && (
        <div className="ed-note is-warn" style={{ position: 'absolute', left: '50%', top: 8, transform: 'translateX(-50%)', zIndex: 8, width: 'min(560px,92%)' }} data-testid="map-notice">
          <div className="flex items-start gap-3 text-[11.5px] leading-snug text-[#EBCF9F]">
            <span className="min-w-0 flex-1">{t('rm.photo.fail', { reason: t('src.reason.' + notice.reason) })}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label={t('common.close')} className="ed-link">✕</button>
          </div>
        </div>
      )}
      {mode === 'photo' && photo.status === 'loading' && !building && (
        <div className="ed-label spx-pulse pointer-events-none absolute left-1/2 top-3 z-[8] -translate-x-1/2" style={{ color: 'var(--acc)' }} data-testid="photo-loading">◌ {t('rm.photo.loading')}</div>
      )}
      <span className="sr-only" data-testid="photo-status" data-status={photo.status} data-mix={photoMix.toFixed(2)} data-cors={photo.nir && photo.nir.cors === false ? '0' : '1'}>{mode === 'photo' ? photoInfo.label : ''}</span>
      {mode === 'photo' && (
        <p className="ed-txt absolute bottom-1 left-1/2 z-[8] max-w-[520px] -translate-x-1/2 text-center text-[10.5px]" data-testid="photo-note">{t('rm.photo.note')}{photo.nir && photo.nir.cors === false ? ' ' + t('rm.photo.cors') : ''}</p>
      )}
    </div>
  );

  /* ---- Alt HUD: dalga boyu · yıl dönemi · mod · imleç/yakınlaştırma ---- */
  const hudNode = (
    <>
      <HudRow>
        <div className="ed-ctl">
          <div className="ed-ctl-h">
            <span className="inline-flex items-center gap-2">{t('wave.title')}<InfoTip id="tip.wave" title={t('wave.title')} /></span>
            <b data-testid="lam-readout">λ = {lam.toFixed(3)} µm</b>
          </div>
          <div className="flex items-center gap-2">
          <button type="button" onClick={() => pickBand(band - 1)} className="ed-link" aria-label={t('wave.prev')}>‹</button>
            <div className="relative min-w-0 flex-1 pt-2">
              <div className="relative h-[2px] opacity-80" style={{ background: spectralBg }}>
                {[1, 2, 3, 4, 5].map((i) => (<div key={i} className="absolute top-[-3px] h-[8px] w-px bg-white/25" style={{ left: `${(i * 17 / 102) * 100}%` }} />))}
                {REGIONS.map((r) => (<div key={r.id} className="absolute top-[-5px] h-[5px] w-[2px]" style={{ left: `${(nearestBand((r.lo + r.hi) / 2) / 101) * 100}%`, background: r.color }} />))}
              </div>
              <input type="range" min={0} max={N_BANDS - 1} step={1} value={band} onChange={(e) => pickBand(Number(e.target.value))} className="spx-range spx-red spx-ghost relative" style={{ marginTop: -10 }} aria-label={t('wave.title')} data-testid="band-slider" />
              <div className="ed-mono relative h-3 text-[9px] text-[#667BA3]">
                {SEG_EDGES.map((e, i) => (<span key={i} className="absolute -translate-x-1/2" style={{ left: `${(i * 17 / 102) * 100}%` }}>{e}</span>))}
              </div>
            </div>
            <button type="button" onClick={() => pickBand(band + 1)} className="ed-link" aria-label={t('wave.next')}>›</button>
          </div>
          <div className="ed-ctl-f">
            <div className="flex flex-wrap items-center gap-1.5">
              {QUICK_LAMBDAS.map(([l, n]) => (<button key={n} type="button" aria-pressed={!preset && band === nearestBand(l)} onClick={() => pickBand(nearestBand(l))} className="ed-cb">{n}</button>))}
            </div>
            <div className="ed-mono text-[10px] leading-tight text-[#93A6CC]">{t('wave.band', { n: band + 1, r: BAND_R[band].toFixed(0) })}{preset ? <span className="block text-[#E3B567]">{t('wave.filterActive', { name: t('filter.' + preset + '.n') })}</span> : null}</div>
          </div>
        </div>
      </HudRow>

      <HudRow>
        <HudCell label={t('dates.title')} long testId="hud-dates">
          <i className="ed-dot" style={{ background: '#F0587A' }} title={t('dates.d1')} />
          <select data-testid="date-a" aria-label={t('dates.d1')} title={t('dates.d1')} disabled={app.firstVsNow} value={app.firstVsNow ? effA : app.eA} onChange={(e) => app.setDates(Number(e.target.value), app.eB)} className="max-w-[172px]">
            {dateOpts.map((o) => (<option key={o.v} value={o.v}>{o.label}</option>))}
          </select>
          <span className="text-[#667BA3]" aria-hidden>→</span>
          <i className="ed-dot" style={{ background: '#5B9DFF' }} title={t('dates.d2')} />
          <select data-testid="date-b" aria-label={t('dates.d2')} title={t('dates.d2')} disabled={app.firstVsNow} value={app.firstVsNow ? effB : app.eB} onChange={(e) => app.setDates(app.eA, Number(e.target.value))} className="max-w-[172px]">
            {dateOpts.map((o) => (<option key={o.v} value={o.v}>{o.label}</option>))}
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-[11px] leading-tight text-[#C5D3EE]">
            <input type="checkbox" data-testid="first-vs-now" checked={app.firstVsNow} onChange={(e) => app.setFirstVsNow(e.target.checked)} />
            <span>{t('dates.firstVsNow')}</span>
          </label>
          <InfoTip id="tip.compareFirst" title={t('dates.firstVsNow')} />
          <span className="ed-mono hidden text-[10px] text-[#757287] 2xl:inline">{epochLabel(lang, effA)} → {epochLabel(lang, effB)} | {t('dates.dt', { dt: dtYr.toFixed(2) })}</span>
        </HudCell>
        <HudCell label={t('modes.title')} long grow>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0" role="tablist" aria-label={t('modes.title')}>
            {availModes.map((m, i) => (
              <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} data-testid={`mode-${m.id}`} onClick={() => setMode(m.id)} title={`${t('mode.' + m.id + '.s')} · ${i + 1}`} className="ed-segbtn">
                <i>{i + 1}</i>{t('mode.' + m.id + '.n')}
              </button>
            ))}
            <InfoTip id={'tip.mode.' + mode} title={t('mode.' + mode + '.n')} />
          </div>
        </HudCell>
      </HudRow>

      <HudRow>
        <HudCell>
          <div ref={cursorRef} className="ed-mono text-[10.5px] text-[#93A6CC]">RA — | Dec —</div>
        </HudCell>
        <HudCell grow>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {isReal && <span data-testid="chip-real"><Chip color="#8FE0B5" title={t('rm.model')}>{t('rm.chip.real', { n: sky.real.shown, m: sky.real.movers })}</Chip></span>}
            {sky && !isReal && <Chip color="#D4E2FB">{t('sky.sources', { n: sky.sources.length })}</Chip>}
            {sky && !isReal && <Chip color="#F0587A" title={t('sky.targets', { n: nTargets })}>{t('sky.targetsShort', { n: nTargets })}</Chip>}
            {app.training && sky && !isReal && <Chip color="#8FE0B5">{t('sky.found', { a: foundN, b: nTargets })}</Chip>}
          </div>
        </HudCell>
        <HudCell>
          <div className="ed-mono text-[10px] text-[#667BA3]">{t('sky.zoom', { z: view.z.toFixed(1) })} | {t('sky.fov', { w: (W * PLATE / 60).toFixed(0), h: (H * PLATE / 60).toFixed(0), s: PLATE })}</div>
          <div className="flex items-center gap-3">
            {[['+', () => zoomBy(1.5), t('ctl.zoomIn')], ['−', () => zoomBy(1 / 1.5), t('ctl.zoomOut')], ['↺', () => setView({ z: 1, sx: 0, sy: 0 }), t('ctl.reset')], ['↓', savePNG, t('ctl.save')]].map(([ic, fn, lab]) => (
              <button key={lab} type="button" onClick={fn} aria-label={lab} title={lab} className="ed-link ed-mono" style={{ fontSize: 13 }}>{ic}</button>
            ))}
            {mode === 'blink' && (
              <button type="button" onClick={() => setBlinkAuto((v) => !v)} aria-label={blinkAuto ? t('ctl.pause') : t('ctl.play')} title={blinkAuto ? t('ctl.pause') : t('ctl.play')} className="ed-link ed-mono" style={{ fontSize: 12 }}>{blinkAuto ? '❙❙' : '▶'}</button>
            )}
          </div>
        </HudCell>
      </HudRow>
    </>
  );

  return (
    <ViewFrame active={active} testId="view-map" stage={stageNode} expandable
      left={<Drawer side="l" open={dr.lo} onToggle={dr.toggleL} label={t('ed.controls')} index="01" testId="left-panel" tabId="drawer-l">{leftBody}</Drawer>}
      right={<Drawer side="r" open={dr.ro} onToggle={dr.toggleR} label={t('ed.analysis')} index="02" testId="right-panel" tabId="drawer-r">{rightBody}</Drawer>}
      hud={hudNode}
      />
  );
}
/* =====================================================================
   BÖLÜM 17 — DIŞA AKTARIM  (JSON · CSV · VOTable 1.4) — katalog satırları, seçili dilde
   ===================================================================== */
const csvEsc = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const xmlEsc = (v) => String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fixN = (v, d) => (typeof v === 'number' && isFinite(v) ? Number(v.toFixed(d)) : '');

const EXPORT_COLS = ['id', 'record', 'category', 'type', 'sector', 'ra_deg', 'dec_deg', 'ra_hms', 'dec_dms', 'timestamp_utc', 'epoch_a', 'epoch_b',
 'dtheta_arcsec', 'mu_arcsec_per_yr', 'pa_deg', 'flux_ratio_b_over_a', 'change_reason', 'user_notes', 'catalog_status', 'catalog_note',
 'data_source', 'mu_catalog_arcsec_per_yr', 'n_detections', 'lambda_range_um', 'catalogue_id'];

// Satırın "kayıtlı" nedeni: kullanıcı kaydı > tarama bulgusu
function rowReason(row) {
  if (row.mine && row.mine.reason) return { r: row.mine.reason, eA: row.mine.eA, eB: row.mine.eB, ts: row.mine.ts };
  if (row.scan) return { r: row.scan.reason, eA: row.scan.reason.eA, eB: row.scan.reason.eB, ts: row.scan.scannedAt };
  return null;
}
function rowTypeLabel(t, row) {
  if (row.mine && row.mine.real) return t('real.type');
  if (row.kind) return kindText(t, row.kind, row.srcCls, !!(row.mine && row.mine.fieldSrc === 'real'));
  return t('cat.' + row.cat);
}
const REAL_SRC = 'SPHEREx L2 (NASA/IPAC IRSA)';
const FIELD_SRC = 'SIMBAD+SkyBoT catalogue (real positions/motions; model spectra)';
const AUTHOR = 'Elif Turut';
const RIGHTS = `© ${COPYRIGHT_YEAR} ${AUTHOR}. All rights reserved. / Tüm hakları saklıdır.`;
function exportRowOf(t, lang, row, db) {
  const real = row.mine && row.mine.real ? row.mine.real : null;
  const rr = real ? null : rowReason(row);
  const r = rr ? rr.r : null;
  const mo = real && real.motion && real.motion.valid ? real.motion : null;
  const dets = real ? real.meas.filter((m) => m.status === 'detected') : [];
  const rx = real ? realExplain(t, real) : null;
  const notes = (db.notes[row.key] || []).map((n) => `[${n.ts}] ${n.text}`).join(' | ');
  const cat = row.mine ? row.mine.catalog : null;
  return {
    id: row.id, record: row.mine ? 'user' : row.known ? 'catalog' : 'candidate', category: t('cat.' + row.cat), type: rowTypeLabel(t, row),
    sector: t('sec.' + row.sectorId + '.title'), ra_deg: fixN(row.ra, 6), dec_deg: fixN(row.dec, 6), ra_hms: fmtRA(row.ra, 1), dec_dms: fmtDec(row.dec, 0),
    timestamp_utc: rr ? rr.ts : row.mine ? row.mine.ts : '', epoch_a: rr ? EPOCHS[rr.eA].iso : dets.length ? dayOf(dets[0].iso) : '', epoch_b: rr ? EPOCHS[rr.eB].iso : dets.length ? dayOf(dets[dets.length - 1].iso) : '',
    dtheta_arcsec: r ? fixN(r.d, 2) : '', mu_arcsec_per_yr: r ? fixN(r.mu, 2) : mo ? fixN(mo.mu, 3) : '', pa_deg: r ? fixN(r.pa, 1) : mo ? fixN(mo.pa, 1) : '',
    flux_ratio_b_over_a: r ? fixN(r.ratio, 3) : real && real.topPair ? fixN(real.topPair.ratio, 3) : '',
    change_reason: r ? explainReason(t, r, { eA: epochLabel(lang, rr.eA), eB: epochLabel(lang, rr.eB) }).plain.replace(/\n/g, ' ') : rx ? rx.plain.replace(/\n/g, ' ') : '',
    user_notes: notes, catalog_status: cat ? cat.status : '', catalog_note: cat ? netMessage(t, cat) : '',
    data_source: real ? REAL_SRC : row.mine && row.mine.fieldSrc === 'real' ? FIELD_SRC : 'synthetic', mu_catalog_arcsec_per_yr: mo && mo.cat ? fixN(mo.cat.mu, 3) : '', n_detections: real ? real.nDet : '',
    lambda_range_um: real && real.lamMin ? `${real.lamMin}-${real.lamMax}` : '',
    catalogue_id: row.mine && row.mine.fieldSrc === 'real' && row.mine.catId ? row.mine.catId : '',
  };
}
function exportMeta(count, rows) {
  const nReal = (rows || []).filter((r) => r.data_source === REAL_SRC).length;
  const nField = (rows || []).filter((r) => r.data_source === FIELD_SRC).length;
  const nSyn = (rows || []).filter((r) => r.data_source === 'synthetic').length;
  const parts = [];
  if (nReal) parts.push(`${nReal} record(s) with data_source="${REAL_SRC}" are measurements on real SPHEREx Level-2 data`);
  if (nField) parts.push(`${nField} record(s) with data_source="${FIELD_SRC}" use real catalogue positions and proper motions (SIMBAD, SkyBoT) while their spectra are model values, not SPHEREx measurements`);
  if (nSyn) parts.push(`${nSyn} record(s) with data_source="synthetic" come from the procedural SPHEREx-like training sky`);
  return {
    tool: 'NYXE — SPHEREx Time-Domain & Citizen Science Console', author: AUTHOR, copyright: RIGHTS, format_version: '2.2', generated_at: new Date().toISOString(), rows: count,
    data_origin: parts.length > 1 ? `MIXED — ${parts.join('; ')}` : parts.length === 1 ? parts[0].replace(/^\d+ record\(s\) with /, 'All records with ') : 'No records',
    ...(nField ? { catalogue_credit: 'Positions and proper motions: SIMBAD (CDS, Strasbourg); Solar System ephemerides: SkyBoT (IMCCE, Paris Observatory); sky photos: 2MASS and AllWISE via CDS hips2fits.' } : {}),
    ...(nReal ? { acknowledgement: `${SPHEREX_ACK} Data distributed by NASA/IPAC Infrared Science Archive (IRSA); DOIs 10.26131/IRSA652 (QR2), 10.26131/IRSA662 (QR3). Analysis tool by Elif Turut.` } : {}),
    plate_scale_arcsec_per_px: PLATE, bands: N_BANDS, wavelength_range_um: [0.75, 5.0], epochs: EPOCHS.map((e) => ({ name: e.name, date: e.iso, t_decimal_year: e.t })),
    note: 'Motion amplitudes in the synthetic sky are exaggerated by a didactic gain (physical mu = mu / gain).',
  };
}
const exportJSON = (rows) => JSON.stringify({ meta: exportMeta(rows.length, rows), objects: rows }, null, 2);
function exportCSV(rows) {
  const lines = [EXPORT_COLS.join(',')];
  rows.forEach((r) => lines.push(EXPORT_COLS.map((k) => csvEsc(r[k])).join(',')));
  return '﻿' + lines.join('\n');
}
function exportVOTable(rows) {
  const meta = exportMeta(rows.length, rows);
  const fields = [
    ['id', 'char', '*', '', 'meta.id;meta.main'], ['record', 'char', '*', '', 'meta.code'], ['category', 'char', '*', '', 'src.class'], ['type', 'char', '*', '', 'src.class'],
    ['sector', 'char', '*', '', 'meta.id'], ['ra_deg', 'double', '', 'deg', 'pos.eq.ra;meta.main'], ['dec_deg', 'double', '', 'deg', 'pos.eq.dec;meta.main'],
    ['timestamp_utc', 'char', '*', '', 'time.epoch'], ['epoch_a', 'char', '*', '', 'time.epoch'], ['epoch_b', 'char', '*', '', 'time.epoch'],
    ['dtheta_arcsec', 'double', '', 'arcsec', 'pos.angDistance'], ['mu_arcsec_per_yr', 'double', '', 'arcsec/yr', 'pos.pm'], ['pa_deg', 'double', '', 'deg', 'pos.posAng'],
    ['flux_ratio_b_over_a', 'double', '', '', 'phot.flux.density;arith.ratio'], ['change_reason', 'char', '*', '', 'meta.note'], ['user_notes', 'char', '*', '', 'meta.note'], ['catalog_status', 'char', '*', '', 'meta.code'],
    ['data_source', 'char', '*', '', 'meta.ref'], ['mu_catalog_arcsec_per_yr', 'double', '', 'arcsec/yr', 'pos.pm'], ['n_detections', 'int', '', '', 'meta.number'], ['lambda_range_um', 'char', '*', 'um', 'em.wl'], ['catalogue_id', 'char', '*', '', 'meta.id'],
  ];
  let x = `<?xml version="1.0" encoding="UTF-8"?>\n<VOTABLE version="1.4" xmlns="http://www.ivoa.net/xml/VOTable/v1.3">\n<RESOURCE name="SPHEREx sky catalog and time archive">\n`;
  x += `<DESCRIPTION>${xmlEsc(meta.tool)} · ${xmlEsc(meta.data_origin)} · ${xmlEsc(meta.generated_at)}</DESCRIPTION>\n<INFO name="author" value="${xmlEsc(meta.author)}"/>\n<INFO name="copyright" value="${xmlEsc(meta.copyright)}"/>\n${meta.acknowledgement ? `<INFO name="acknowledgement" value="${xmlEsc(meta.acknowledgement)}"/>\n` : ''}${meta.catalogue_credit ? `<INFO name="catalogue_credit" value="${xmlEsc(meta.catalogue_credit)}"/>\n` : ''}<INFO name="data_origin" value="${xmlEsc(meta.data_origin)}"/>\n<COOSYS ID="J2000" system="ICRS" epoch="J2000"/>\n<TABLE name="objects">\n`;
  fields.forEach((f) => {
    const ref = f[0] === 'ra_deg' || f[0] === 'dec_deg' ? ' ref="J2000"' : '';
    x += `<FIELD name="${f[0]}" datatype="${f[1]}"${f[2] ? ` arraysize="${f[2]}"` : ''}${f[3] ? ` unit="${f[3]}"` : ''}${f[4] ? ` ucd="${f[4]}"` : ''}${ref}/>\n`;
  });
  x += '<DATA><TABLEDATA>\n';
  rows.forEach((r) => { x += '<TR>' + fields.map((f) => `<TD>${xmlEsc(r[f[0]])}</TD>`).join('') + '</TR>\n'; });
  x += '</TABLEDATA></DATA>\n</TABLE>\n</RESOURCE>\n</VOTABLE>\n';
  return x;
}
function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// "217.4 -62.7" gibi iki sayı → derece cinsinden RA/Dec yakınlık araması
function parseCoordQuery(q) {
  const m = q.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const ra = parseFloat(m[1]), dec = parseFloat(m[2]);
  if (ra < 0 || ra > 360 || dec < -90 || dec > 90) return null;
  return { ra, dec };
}
function angSepDeg(ra1, dec1, ra2, dec2) {
  const d2r = Math.PI / 180;
  const c = Math.sin(dec1 * d2r) * Math.sin(dec2 * d2r) + Math.cos(dec1 * d2r) * Math.cos(dec2 * d2r) * Math.cos((ra1 - ra2) * d2r);
  return Math.acos(clamp(c, -1, 1)) / d2r;
}

/* =====================================================================
   BÖLÜM 18 — GÖKYÜZÜ KATALOĞU & ZAMAN ARŞİVİ
   ===================================================================== */
function CatalogView({ app, active }) {
  const { t, lang, db, gain } = app;
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  const [secFilter, setSecFilter] = useState('all');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [ver, setVer] = useState(0);
  const [loadingSky, setLoadingSky] = useState(false);
  const [scanRes, setScanRes] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [live, setLive] = useState({});
  const [activated, setActivated] = useState(false);

  const sectorCfgs = useMemo(() => SECTOR_IDS.map((id) => cfgOf(id, app.custom)), [app.custom]);

  /* ---- Sektör gökyüzlerini (bilinen katalog için) arka planda, sırayla üret ---- */
  useEffect(() => { if (active) setActivated(true); }, [active]);
  useEffect(() => {
    if (!activated) return undefined;
    let cancelled = false;
    const todo = sectorCfgs.filter((c) => !hasSkyEntry(c));
    if (!todo.length) { setLoadingSky(false); return undefined; }
    setLoadingSky(true);
    let i = 0;
    const step = () => {
      if (cancelled) return;
      if (i >= todo.length) { setLoadingSky(false); setVer((v) => v + 1); return; }
      getSkyEntry(todo[i]); i += 1;
      setVer((v) => v + 1);
      setTimeout(step, 30);
    };
    const tm = setTimeout(step, 30);
    return () => { cancelled = true; clearTimeout(tm); };
  }, [activated, sectorCfgs]);

  /* ---- Tarih çifti ---- */
  const dates = resolveDates(app.eA, app.eB, app.firstVsNow, 0);
  const dateOpts = EPOCHS.map((e) => ({ v: e.id, label: epochFull(lang, t, e.id) }));
  const scanFresh = !!(scanRes && scanRes.status === 'done' && scanRes.eA === dates.a && scanRes.eB === dates.b && scanRes.gain === gain);
  const scanStale = !!(scanRes && scanRes.status === 'done' && !scanFresh);
  const scanLive = scanFresh ? scanRes : null;

  /* ---- Satırlar: bilinen katalog ∪ kayıtlı keşifler ∪ (taramadan) yeni adaylar ---- */
  const skyOf = useCallback((key) => {
    for (let i = 0; i < sectorCfgs.length; i++) if (sectorCfgs[i].key === key && hasSkyEntry(sectorCfgs[i])) return getSkyEntry(sectorCfgs[i]).sky;
    return SKY_REG.has(key) ? SKY_REG.get(key).sky : null;
  }, [sectorCfgs]);

  const rows = useMemo(() => {
    const map = new Map();
    sectorCfgs.forEach((cfg) => {
      if (!hasSkyEntry(cfg)) return;
      const sky = getSkyEntry(cfg).sky;
      knownCatalog(sky).list.forEach((k) => {
        map.set(k.objKey, { key: k.objKey, id: k.id, known: true, knownRec: k, mine: null, scan: null, cat: k.cat, kind: k.kind, srcCls: k.stype, sectorId: cfg.id, sectorKey: sky.key, ra: k.ra, dec: k.dec, srcId: k.srcId, firstEpoch: 0, ts: '' });
      });
    });
    db.entries.forEach((e) => {
      const row = map.get(e.objKey);
      if (row) { row.mine = e; row.cat = e.cat; row.firstEpoch = e.firstEpoch; row.ts = e.ts; }
      else map.set(e.objKey, { key: e.objKey, id: e.id, known: false, knownRec: null, mine: e, scan: null, cat: e.cat, kind: e.kind, srcCls: e.srcCls, sectorId: e.sectorId, sectorKey: e.sectorKey, ra: e.ra, dec: e.dec, srcId: e.srcId, firstEpoch: e.firstEpoch, ts: e.ts });
    });
    if (scanLive) {
      scanLive.items.forEach((it) => {
        const row = map.get(it.objKey);
        if (row) row.scan = it;
        else map.set(it.objKey, { key: it.objKey, id: `NEW-${it.sectorId.toUpperCase()}-${String(it.n).padStart(3, '0')}`, known: false, knownRec: null, mine: null, scan: it, cat: catOfItem(it), kind: null, srcCls: '', sectorId: it.sectorId, sectorKey: it.sectorKey, ra: it.ra, dec: it.dec, srcId: it.srcId, firstEpoch: 0, ts: '' });
      });
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      if (scanLive) { const an = a.scan ? a.scan.n : 1e9, bn = b.scan ? b.scan.n : 1e9; if (an !== bn) return an - bn; }
      if (!!a.mine !== !!b.mine) return a.mine ? -1 : 1;
      if (a.mine && b.mine) return a.mine.ts < b.mine.ts ? 1 : -1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return arr;
  }, [sectorCfgs, ver, db.entries, scanLive]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Anında arama (ad · koordinat · not) + kategori + sektör süzgeçleri ---- */
  const hayOf = (r) => {
    const rr = rowReason(r);
    const auto = rr ? explainReason(t, rr.r, { eA: epochLabel(lang, rr.eA), eB: epochLabel(lang, rr.eB) }).plain : (r.mine && r.mine.real ? realExplain(t, r.mine.real).plain + ' ' + r.mine.real.target.name : '');
    const notes = (db.notes[r.key] || []).map((n) => n.text).join(' ');
    return [r.id, r.knownRec ? r.knownRec.id : '', r.mine ? r.mine.id : '', rowTypeLabel(t, r), t('cat.' + r.cat), t('sec.' + r.sectorId + '.title'), t('sec.' + r.sectorId + '.short'),
      fmtRA(r.ra, 1), fmtDec(r.dec, 0), fmtRAshort(r.ra), fmtDecshort(r.dec), r.ra.toFixed(4), r.dec.toFixed(4), notes, auto,
      r.mine && r.mine.catId ? r.mine.catId : '', r.mine && r.mine.otype ? r.mine.otype : '', r.mine && r.mine.fieldSrc === 'real' ? 'simbad skybot' : ''].join(' ').toLowerCase();
  };
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const coordQ = parseCoordQuery(query);
  const passBase = (r, ignoreTab) => {
    if (!ignoreTab && !rowInTab(tab, r)) return false;
    if (secFilter !== 'all' && r.sectorId !== secFilter) return false;
    if (onlyChanged && !r.scan) return false;
    if (!tokens.length) return true;
    const hay = hayOf(r);
    if (tokens.every((tk) => hay.indexOf(tk) >= 0)) return true;
    return !!(coordQ && angSepDeg(coordQ.ra, coordQ.dec, r.ra, r.dec) < 0.05);
  };
  const filtered = rows.filter((r) => passBase(r, false));
  const tabCounts = {};
  CTABS.forEach((c) => { tabCounts[c.id] = rows.filter((r) => rowInTab(c.id, r) && passBase(r, true)).length; });

  const selRow = app.catSel ? rows.find((r) => r.key === app.catSel) || null : null;
  useEffect(() => { setNoteDraft(''); }, [app.catSel]);

  /* ---- Seçili satır: iki tarih arasındaki değişim analizi ---- */
  const selSky = selRow ? skyOf(selRow.sectorKey) : null;
  const selSrc = selRow && selSky && (selRow.srcId || (selRow.mine && selRow.mine.catId)) ? srcOfEntry(selSky, { srcId: selRow.srcId, catId: selRow.mine ? selRow.mine.catId : null }) : null;
  const selDates = selRow ? resolveDates(app.eA, app.eB, app.firstVsNow, selRow.firstEpoch) : { a: 0, b: 3 };
  const selGain = gainOf(selSky, gain);
  const selAn = useMemo(() => (selSky && selSrc ? analyzeObject(selSky, selSrc, selDates.a, selDates.b, selGain) : null), [selSky, selSrc, selDates.a, selDates.b, selGain]);
  const selReason = useMemo(() => (selAn ? reasonOf(selAn, selDates.a, selDates.b, selGain) : null), [selAn, selDates.a, selDates.b, selGain]);
  const selHist = useMemo(() => (selSky && selSrc ? epochHistory(selSky, selSrc, selGain) : null), [selSky, selSrc, selGain]);
  const selExplain = useMemo(() => explainReason(t, selReason, { eA: epochLabel(lang, selDates.a), eB: epochLabel(lang, selDates.b) }), [t, selReason, lang, selDates.a, selDates.b]);
  const storedExplain = useMemo(() => {
    const rr = selRow ? rowReason(selRow) : null;
    return rr ? { ...explainReason(t, rr.r, { eA: epochLabel(lang, rr.eA), eB: epochLabel(lang, rr.eB) }), rr } : null;
  }, [t, lang, selRow]);

  /* ---- Tarama (tüm cisimler) ---- */
  const runScan = async () => {
    if (scanRes && scanRes.status === 'running') return;
    const cfgs = secFilter === 'all' ? sectorCfgs : sectorCfgs.filter((c) => c.id === secFilter);
    const a = dates.a, b = dates.b, g = gain;
    setScanRes({ status: 'running', progress: 0 });
    await new Promise((res) => setTimeout(res, 20));
    const all = [];
    for (let i = 0; i < cfgs.length; i++) {
      const sky = getSkyEntry(cfgs[i]).sky;
      setVer((v) => v + 1);
      const items = await scanSkyChunked(sky, a, b, g, (p) => setScanRes((s) => (s && s.status === 'running' ? { ...s, progress: (i + p) / cfgs.length } : s)));
      items.forEach((it) => { it.sectorId = cfgs[i].id; it.sectorKey = sky.key; all.push(it); });
    }
    sortScan(all);
    const ts = new Date().toISOString();
    all.forEach((it) => { it.scannedAt = ts; });
    setScanRes({ status: 'done', progress: 1, items: all, ts, eA: a, eB: b, gain: g });
    setOnlyChanged(false);
    app.addLog({ ts, sectorId: secFilter, sectorKey: cfgs.map((c) => c.key).join(','), eA: a, eB: b, n: all.length, k: all.filter((q) => !q.known).length });
  };

  /* ---- Kaydet / not / canlı doğrulama ---- */
  const saveRowToArchive = (row, silent) => {
    const sky = skyOf(row.sectorKey);
    const src = sky ? srcOfEntry(sky, { srcId: row.srcId, catId: row.mine ? row.mine.catId : null }) : null;
    if (!sky || !src) return null;
    const dts = resolveDates(app.eA, app.eB, app.firstVsNow, row.firstEpoch);
    const g = gainOf(sky, gain);
    const an = analyzeObject(sky, src, dts.a, dts.b, g);
    const reason = reasonOf(an, dts.a, dts.b, g);
    const hist = epochHistory(sky, src, g);
    const cfg = sectorCfgs.find((c) => c.key === sky.key) || cfgOf(row.sectorId, app.custom);
    const cat = row.mine ? row.mine.cat : (SAVE_CATS.indexOf(row.cat) >= 0 ? row.cat : 'other');
    const draft = makeEntryDraft({ sky, cfg, custom: app.custom, an, reason, effA: dts.a, effB: dts.b, gain: g, cat, userNote: '', history: hist, knownRec: row.knownRec });
    if (row.mine) draft.firstEpoch = row.mine.firstEpoch;
    return app.saveEntry(draft, silent);
  };
  const saveAllCandidates = () => {
    rows.filter((r) => r.scan && !r.known && !r.mine).forEach((r) => saveRowToArchive(r, true));
  };
  const addNote = () => {
    const txt0 = noteDraft.trim();
    if (!selRow || !txt0) return;
    app.addNote(selRow.key, txt0);
    setNoteDraft('');
  };
  const liveCheck = async (row) => {
    setLive((s) => ({ ...s, [row.key]: { status: 'pending' } }));
    let res;
    try { res = await queryCatalogs(row.ra, row.dec, 8, EPOCHS[dates.b].iso); }
    catch (e) { res = { status: 'offline', simbad: [], skybot: { status: 'unavailable', items: [] } }; }
    setLive((s) => ({ ...s, [row.key]: res }));
  };
  const doExport = (fmt) => {
    if (!filtered.length) return;
    const data = filtered.map((r) => exportRowOf(t, lang, r, db));
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    if (fmt === 'json') downloadText(`nyxe_catalog_${stamp}.json`, exportJSON(data), 'application/json');
    else if (fmt === 'csv') downloadText(`nyxe_catalog_${stamp}.csv`, exportCSV(data), 'text/csv;charset=utf-8');
    else downloadText(`nyxe_catalog_${stamp}.vot`, exportVOTable(data), 'application/x-votable+xml');
  };
  // Python (astropy) betiği: seçili kayıt için (gökyüzü analizi ya da kayıtlı gerçek SPHEREx ölçümü)
  const [pyDone, setPyDone] = useState(null);
  useEffect(() => { if (!pyDone) return undefined; const id = setTimeout(() => setPyDone(null), 6000); return () => clearTimeout(id); }, [pyDone]);
  useEffect(() => { setPyDone(null); }, [app.catSel]);
  const canPy = !!(selRow && (selAn || (selRow.mine && selRow.mine.real)));
  const pyTitle = !selRow ? t('py.pick') : canPy ? t('py.btn') : t(/\|real$/.test(selRow.sectorKey || '') && !selSky ? 'py.needMap' : 'py.noData');
  const exportPy = () => {
    if (!selRow || !canPy) return;
    let d = null;
    if (selAn) {
      const label = selRow.mine && selRow.mine.catId ? selRow.mine.catId : selRow.knownRec ? selRow.knownRec.id : selRow.id;
      d = pyDataFromAnalysis({ an: selAn, eA: selDates.a, eB: selDates.b, gain: selGain, label, consoleId: selRow.id, knownId: selRow.knownRec ? selRow.knownRec.id : '', savedId: selRow.mine ? selRow.mine.id : '' });
    } else if (selRow.mine && selRow.mine.real) {
      d = pyDataFromRealPayload(selRow.mine.real, { label: selRow.mine.name || selRow.id, consoleId: selRow.id, ra: selRow.ra, dec: selRow.dec, savedId: selRow.mine.id });
    }
    if (d) setPyDone(downloadPython(d));
  };
  const showOnMap = (row) => {
    app.requestFocus({
      sectorId: row.sectorId, skyKey: row.sectorKey, srcId: row.srcId, catId: row.mine ? row.mine.catId : null,
      pixel: row.mine ? { x: row.mine.x, y: row.mine.y } : row.srcId ? null : { x: 360, y: 360 },
      custom: row.mine && row.mine.custom ? row.mine.custom : null,
    });
  };
  const verdict = (e) => {
    if (!e.hidden) return { ok: false, text: e.truth === null ? t('v.blank') : t('v.static', { label: e.kind ? kindText(t, e.kind, e.srcCls, e.fieldSrc === 'real') : '' }) };
    const lab = t('kind.' + e.kind);
    if (e.cat === e.truth) return { ok: true, text: t('v.ok', { label: lab }) };
    return { ok: false, text: t('v.wrongClass', { label: lab }) };
  };

  const nChanged = rows.filter((r) => r.scan).length;
  const nNewCand = rows.filter((r) => r.scan && !r.known && !r.mine).length;
  const dr = useDrawers(false, false);
  useEffect(() => { if (app.catSel) dr.setRo(true); }, [app.catSel]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- Sayfa: büyük başlık · arama · süzgeçler · hairline dizin ---------------- */
  const listPage = (
    <div className="ed-page spx-scroll" data-testid="cat-page">
      <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <div className="min-w-0">
          <div className="ed-label">{t('ed.index')}</div>
          <div className="ed-mono mt-2 flex items-center gap-2 text-[12px] text-[#9aa1b5]" data-testid="cat-count">
            <span className="ed-num text-[30px] font-bold leading-none text-[#EEF3FD]">{filtered.length}</span>
            <span>{t('catalog.count', { n: '', total: rows.length }).trim()}</span>
            <InfoTip id="tip.catalog.status" title={t('catalog.title')} />
          </div>
          <div className="ed-label mt-2" style={{ textTransform: 'none', letterSpacing: '.02em' }}>{t('catalog.stored')}</div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {[['json', 'JSON'], ['csv', 'CSV'], ['votable', 'VOTable']].map(([f, n]) => (
            <button key={f} type="button" data-testid={`export-${f}`} disabled={!filtered.length} onClick={() => doExport(f)} className="ed-link"><span aria-hidden>↓</span>{n}</button>
          ))}
          <button type="button" data-testid="export-python" disabled={!canPy} onClick={exportPy} title={pyTitle} className="ed-link" style={canPy ? { color: '#8DB9FF' } : undefined}><span aria-hidden>↓</span>{t('py.btn.s')}</button>
          <InfoTip id="tip.py" title={t('py.btn')} />
          <InfoTip id="tip.catalog.export" title={t('catalog.export')} />
        </div>
      </header>

      <div className="ed-searchbar mt-6">
        <span className="text-[16px] leading-none text-[#93A6CC]" aria-hidden>⌕</span>
        <input data-testid="cat-search" className="ed-search min-w-0 flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('catalog.searchPh')} aria-label={t('catalog.search')} />
        {query && <button type="button" onClick={() => setQuery('')} aria-label={t('common.clear')} className="ed-link">✕</button>}
        <InfoTip id="tip.catalog.search" title={t('catalog.search')} />
      </div>

      <div className="mt-5 flex items-start gap-3">
        <div className="ed-seg flex-1" role="tablist" aria-label={t('catalog.cats')} data-testid="cat-tabs">
          {CTABS.map((c, i) => (
            <button key={c.id} type="button" role="tab" aria-selected={tab === c.id} data-testid={`ctab-${c.id}`} onClick={() => setTab(c.id)} className="ed-segbtn">
              {t('ctab.' + c.id)}<em className="sx-cnt">{tabCounts[c.id]}</em>
            </button>
          ))}
        </div>
        <InfoTip id="tip.catalog.cats" title={t('catalog.cats')} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2" role="group" aria-label={t('sector.label')}>
        <span className="ed-label">{t('sector.label')}</span>
        {['all'].concat(SECTOR_IDS, ['real']).map((s) => (
          <button key={s} type="button" data-testid={`csec-${s}`} aria-pressed={secFilter === s} onClick={() => setSecFilter(s)} className="ed-segbtn">{s === 'all' ? t('catalog.allSectors') : t('sec.' + s + '.short')}</button>
        ))}
      </div>

      <ul className="mt-8 border-t border-white/15" data-testid="cat-list">
        {!filtered.length && !loadingSky && (
          <li className="py-16 text-center"><div className="ed-empty mx-auto"><div className="ed-label">◌ 00</div><h3>{rows.length ? t('catalog.noResults') : t('catalog.empty')}</h3></div></li>
        )}
        {filtered.map((r, i) => {
          const on = app.catSel === r.key;
          const col = CAT_COLOR[r.cat] || '#9AA7BD';
          const rr = r.scan ? r.scan.reason : null;
          return (
            <li key={r.key}>
              <button type="button" data-testid="cat-row" data-key={r.key} aria-pressed={on} onClick={() => app.setCatSel(r.key)} className="ed-cat-row">
                <span className="ed-mono text-[10px] text-[#667BA3]">{edPad(i + 1, 3)}</span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span aria-hidden style={{ color: col }}>{CAT_EMOJI[r.cat]}</span>
                    <span className="ed-mono text-[13px]" style={{ color: on ? '#fff' : 'var(--acc)' }}>{r.id}</span>
                  </span>
                  <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                    {r.known && <Chip color="#8FE0B5">{t('row.known')}</Chip>}
                    {r.mine && <Chip color="#E3B567">{t('row.mine')}</Chip>}
                    {r.scan && !r.known && !r.mine && <Chip color="#F0587A">{t('scan.new')}</Chip>}
                  </span>
                </span>
                <span className="ed-c3 min-w-0">
                  <span className="ed-serif block truncate text-[19px] leading-tight text-[#EEF3FD]">{rowTypeLabel(t, r)}</span>
                  <span className="ed-label mt-1 block">{t('sec.' + r.sectorId + '.short')}</span>
                  {rr && <span className="mt-1 block text-[11px] text-[#E3B567]">↔ {changeSummary(t, rr)}</span>}
                </span>
                <span className="ed-c4 ed-mono min-w-0 text-[10.5px] leading-relaxed text-[#93A6CC]">
                  <span className="block truncate">{fmtRA(r.ra, 1)}</span><span className="block truncate">{fmtDec(r.dec, 0)}</span>
                  {r.mine && <span className="block truncate text-[#667BA3]">{fmtTs(lang, r.mine.ts)}</span>}
                </span>
                <span className="ed-arrow" aria-hidden>→</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="ed-label mt-10 text-center" style={{ opacity: .6 }}>— END OF INDEX —</div>
    </div>
  );

  /* ---------------- Sağ çekmece: ayrıntı ---------------- */
  const live1 = selRow ? live[selRow.key] : null;
  const reasonBlock = (items) => items.map((it, i) => (
    <div key={i} className="ed-reason">
      <div className="text-[13px] leading-snug text-[#F5F8FF]"><span aria-hidden style={{ color: 'var(--acc)' }}>{it.emoji}</span> {it.head}</div>
      {it.measured ? <div className="ed-mono mt-1 text-[10.5px] leading-snug text-[#9895AA]">{it.measured}</div> : null}
      <div className="mt-1.5 text-[12px] leading-relaxed text-[#C9C6D6]"><b className="font-medium text-[#E3B567]">{t('why.cause')}</b> {it.cause}</div>
    </div>
  ));
  const detailBody = (
    <div>
      {!selRow && (
        <section className="ed-sec">
          <div className="ed-label" style={{ color: 'var(--acc)' }}>⌖ 00</div>
          <div className="ed-serif mt-3 text-[26px] italic leading-[1.1] text-[#EEF3FD]">{t('catalog.pick')}</div>
          <p className="mt-3 text-[12px] leading-relaxed text-[#93A6CC]">{t('catalog.pickBody')}</p>
          {db.logs.length > 0 && (
            <div className="mt-6 border-t border-white/10 pt-4">
              <div className="ed-label mb-3">{t('catalog.logs')}</div>
              <ul className="space-y-2 text-[11px] text-[#93A6CC]" data-testid="scan-logs">
                {db.logs.slice(0, 6).map((l) => (<li key={l.uid || l.ts} className="border-l border-white/15 pl-3">{fmtTs(lang, l.ts)} · {l.sectorId === 'all' ? t('catalog.allSectors') : l.sectorId.toUpperCase()} · {epochLabel(lang, l.eA)} → {epochLabel(lang, l.eB)} · {t('scan.found', { n: l.n, k: l.k })}</li>))}
              </ul>
            </div>
          )}
        </section>
      )}

      {selRow && (
        <>
          <section className="ed-sec" style={{ boxShadow: `inset 2px 0 0 ${CAT_COLOR[selRow.cat] || '#9AA7BD'}` }} data-testid="detail-head">
            <div className="flex items-start gap-3">
              <span className="mt-1 text-[22px] leading-none" style={{ color: CAT_COLOR[selRow.cat] || '#9AA7BD' }} aria-hidden>{CAT_EMOJI[selRow.cat]}</span>
              <div className="min-w-0 flex-1">
                <div className="ed-mono text-[12px] text-[color:var(--acc)]">{selRow.id}</div>
                <div className="ed-serif text-[26px] leading-[1.1] text-[#F5F8FF]">{rowTypeLabel(t, selRow)}</div>
                <div className="ed-label mt-2">{t('cat.' + selRow.cat)} · {t('sec.' + selRow.sectorId + '.title')}</div>
              </div>
              <button type="button" onClick={() => app.setCatSel(null)} className="ed-link" aria-label={t('common.close')}>✕</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
              {selRow.known && <Chip color="#8FE0B5">{t('row.known')} · {selRow.knownRec.id}</Chip>}
              {selRow.mine && <Chip color="#E3B567">{t('row.mine')} · {selRow.mine.id}</Chip>}
              {selRow.scan && !selRow.known && !selRow.mine && <Chip color="#F0587A">{t('scan.new')}</Chip>}
            </div>
            <div className="ed-mono mt-4 space-y-0.5 text-[11.5px] leading-relaxed text-[#EEF3FD]">
              <div>RA <span className="text-[color:var(--acc)]">{fmtRA(selRow.ra, 1)}</span> <span className="text-[#667BA3]">({selRow.ra.toFixed(5)}°)</span></div>
              <div>Dec <span className="text-[color:var(--acc)]">{fmtDec(selRow.dec, 0)}</span> <span className="text-[#667BA3]">({selRow.dec.toFixed(5)}°)</span></div>
            </div>
            {!(selRow.mine && selRow.mine.real) && (<div className="mt-4 flex items-center gap-2">
              <button type="button" data-testid="show-on-map" onClick={() => showOnMap(selRow)} className="ed-btn ed-go is-primary is-block">{t('catalog.show')}</button>
              <InfoTip id="tip.catalog.show" title={t('catalog.show')} />
            </div>)}
            <div className="mt-2 flex items-center gap-2">
              <button type="button" data-testid="py-export-cat" disabled={!canPy} onClick={exportPy} title={pyTitle} className="ed-btn is-block is-sm">{t('py.btn')}</button>
              <InfoTip id="tip.py" title={t('py.btn')} />
            </div>
            {pyDone && <div className="mt-2 text-[11px] text-[#8FE0B5]" data-testid="py-done-cat" role="status">● {t('py.done', { name: pyDone })}</div>}
          </section>

          {selRow.mine && selRow.mine.real && <RealEntryDetail app={app} entry={selRow.mine} />}

          {/* Değişim nedeni (seçili tarih çifti için canlı analiz; sektör gökyüzü yoksa kayıtlı nota düşer) */}
          {!(selRow.mine && selRow.mine.real) && (<Card title={t('catalog.changeTitle')} tip="tip.catalog.change" icon={<span>1</span>}>
            <div className="ed-mono mb-3 text-[11px] text-[#EEF3FD]">{epochLabel(lang, selDates.a)} → {epochLabel(lang, selDates.b)}
              <label className="ml-3 inline-flex cursor-pointer items-center gap-2 font-sans text-[11px] text-[#C5D3EE]"><input type="checkbox" checked={app.firstVsNow} onChange={(e) => app.setFirstVsNow(e.target.checked)} />{t('dates.firstVsNowShort')}</label>
            </div>
            {selReason ? (
              <div className="space-y-3" data-testid="detail-reasons">{reasonBlock(selExplain.items)}</div>
            ) : storedExplain ? (
              <div className="space-y-3" data-testid="detail-reasons">
                <div className="text-[11px] text-[#E3B567]">{t('catalog.snapshot', { ts: fmtTs(lang, storedExplain.rr.ts) })}</div>
                {reasonBlock(storedExplain.items)}
              </div>
            ) : <div className="text-[12px] text-[#667BA3]">{t('catalog.noAnalysis')}</div>}
            {selRow.scan && <div className="ed-mono mt-3 text-[10px] text-[#667BA3]">{t('scan.at', { ts: fmtTs(lang, selRow.scan.scannedAt || (scanLive && scanLive.ts)) })}</div>}
          </Card>)}

          {/* Zaman çizelgesi */}
          {selHist && (
            <Card title={t('tl.title')} tip="tip.timeline" icon={<span>2</span>}>
              <ol className="space-y-3" data-testid="detail-timeline">
                {selHist.map((h) => {
                  const firstIdx = selHist.findIndex((q) => q.valid);
                  return (
                    <li key={h.e} className="flex gap-3">
                      <span className="mt-[5px] h-[7px] w-[7px] shrink-0 rotate-45" style={{ background: h.valid ? (CAT_COLOR[selRow.cat] || '#5B9DFF') : '#3a3850' }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-[#EEF3FD]">
                          <span>{epochFull(lang, t, h.e)}</span>
                          {h.e === selDates.a && <span className="ed-mono text-[10px] text-[#F0587A]">[A]</span>}
                          {h.e === selDates.b && <span className="ed-mono text-[10px] text-[#5B9DFF]">[B]</span>}
                          {h.valid && h.e === firstIdx && <span className="text-[10.5px] text-[#E3B567]">★ {t('tl.first')}</span>}
                          <span className="ed-mono ml-auto text-[10.5px] text-[#9895AA]">{h.valid ? `AB ${h.ab.toFixed(2)}` : ''}</span>
                        </div>
                        <div className="ed-mono text-[10px] text-[#757287]">{h.valid ? `${fmtRA(h.ra, 1)} ${fmtDec(h.dec)}${h.off !== null && h.off > 0.05 ? ` · +${h.off.toFixed(1)}″` : ''}` : t('tl.none')}</div>
                      </div>
                    </li>
                  );
                })}
                {selRow.mine && (<li className="flex gap-3"><span className="mt-[5px] h-[7px] w-[7px] shrink-0 rotate-45 bg-[#E3B567]" /><div className="text-[12px] text-[#EEF3FD]">{t('tl.saved', { ts: fmtTs(lang, selRow.mine.ts) })}</div></li>)}
              </ol>
            </Card>
          )}

          {/* Kaydet (tarama adayı / bilinen cisim) */}
          {!selRow.mine && selSrc && (
            <section className="ed-sec"><button type="button" data-testid="detail-save" onClick={() => saveRowToArchive(selRow)} className="ed-btn ed-go is-primary is-block">{t('save.btn')}</button></section>
          )}

          {/* Notlar */}
          <Card title={t('notes.title')} tip="tip.notes" icon={<span>3</span>}>
            <ul className="space-y-3" data-testid="notes-list">
              {(db.notes[selRow.key] || []).map((n) => (
                <li key={n.uid} className="border-l border-white/15 pl-3">
                  <div className="ed-mono flex items-center justify-between gap-2 text-[10px] text-[#667BA3]"><span>{fmtTs(lang, n.ts)}</span>
                    <button type="button" onClick={() => app.deleteNote(selRow.key, n.uid)} aria-label={t('common.delete')} className="ed-link">✕</button></div>
                  <div className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-[#EEF3FD]">{n.text}</div>
                </li>
              ))}
              {!(db.notes[selRow.key] || []).length && <li className="text-[11.5px] text-[#667BA3]">{t('notes.none')}</li>}
            </ul>
            <textarea data-testid="note-input" rows={3} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder={t('notes.ph')} className="spx-scroll mt-3 block w-full resize-y" />
            <button type="button" data-testid="note-add" disabled={!noteDraft.trim()} onClick={addNote} className="ed-btn is-sm mt-3">+ {t('notes.add')}</button>
          </Card>

          {/* Canlı katalog doğrulaması */}
          <Card title={t('live.title')} tip="tip.catalog.live" icon={<span>4</span>}>
            {selRow.mine ? <CatalogStatus app={app} entry={selRow.mine} /> : (
              <div className="space-y-3">
                {live1 && live1.status !== undefined && <CatalogStatus app={app} entry={{ uid: selRow.key, catalog: live1 }} />}
                <button type="button" data-testid="live-check" onClick={() => liveCheck(selRow)} className="ed-btn ed-go is-sm">{t('live.check')}</button>
              </div>
            )}
          </Card>

          {selRow.mine && !selRow.mine.real && app.training && (() => { const v = verdict(selRow.mine); return (<section className="ed-sec"><div className={`ed-note-box ${v.ok ? 'is-ok' : 'is-warn'} text-[12px]`}>{v.ok ? '● ' : '◆ '}{v.text}</div></section>); })()}

          {selRow.mine && (
            <section className="ed-sec">
              <button type="button" data-testid="delete-entry" onClick={() => { if (window.confirm(t('catalog.confirmDelete', { id: selRow.mine.id }))) { app.deleteEntry(selRow.mine.uid); } }} className="ed-btn is-sm is-bad is-block">{t('catalog.delete')}</button>
            </section>
          )}
        </>
      )}
    </div>
  );

  /* ---------------- Alt HUD: tarih çifti + tarama ---------------- */
  const hudNode = (
    <>
      <HudRow>
        <HudCell label={t('dates.title')} long testId="cat-hud-dates">
          <i className="ed-dot" style={{ background: '#F0587A' }} title={t('dates.d1')} />
          <select data-testid="cat-date-a" aria-label={t('dates.d1')} disabled={app.firstVsNow} value={app.firstVsNow ? dates.a : app.eA} onChange={(e) => app.setDates(Number(e.target.value), app.eB)} className="max-w-[172px]">
            {dateOpts.map((o) => (<option key={o.v} value={o.v}>{o.label}</option>))}
          </select>
          <span className="text-[#667BA3]" aria-hidden>→</span>
          <i className="ed-dot" style={{ background: '#5B9DFF' }} title={t('dates.d2')} />
          <select data-testid="cat-date-b" aria-label={t('dates.d2')} disabled={app.firstVsNow} value={app.firstVsNow ? dates.b : app.eB} onChange={(e) => app.setDates(app.eA, Number(e.target.value))} className="max-w-[172px]">
            {dateOpts.map((o) => (<option key={o.v} value={o.v}>{o.label}</option>))}
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[#C5D3EE]">
            <input type="checkbox" data-testid="cat-first-vs-now" checked={app.firstVsNow} onChange={(e) => app.setFirstVsNow(e.target.checked)} />{t('dates.firstVsNowShort')}
          </label>
          <InfoTip id="tip.compareFirst" title={t('dates.firstVsNow')} />
        </HudCell>
        <HudCell grow>
          <button type="button" data-testid="cat-scan-btn" disabled={loadingSky || (scanRes && scanRes.status === 'running')} onClick={runScan} className="ed-btn ed-go is-bad">
            {scanRes && scanRes.status === 'running' ? t('scan.running', { p: Math.round(scanRes.progress * 100) }) : t('scan.btnLong')}
          </button>
          <InfoTip id="tip.scan" title={t('scan.btnLong')} />
          {scanLive && nChanged > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[#C5D3EE]"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />{t('catalog.onlyChanged')}</label>
          )}
          {scanLive && nNewCand > 0 && (
            <button type="button" data-testid="save-all" onClick={saveAllCandidates} className="ed-btn is-sm is-primary">{t('catalog.saveAll', { n: nNewCand })}</button>
          )}
        </HudCell>
      </HudRow>
      <HudRow>
        <HudCell grow>
          {scanRes && scanRes.status === 'running' && (<div className="ed-bar min-w-[160px] flex-1"><i style={{ width: `${Math.round(scanRes.progress * 100)}%` }} /></div>)}
          {scanLive && (
            <div className="text-[11.5px] text-[#C5D3EE]" data-testid="cat-scan-summary">
              <span className="text-[#EEF3FD]">{scanLive.items.length ? t('scan.found', { n: scanLive.items.length, k: scanLive.items.filter((q) => !q.known).length }) : t('scan.none')}</span>
              <span className="ed-mono text-[10px] text-[#667BA3]"> | {t('scan.at', { ts: fmtTs(lang, scanLive.ts) })}</span>
            </div>
          )}
          {scanStale && <div className="ed-note-box is-warn text-[11px] leading-snug" data-testid="cat-scan-stale">{t('scan.stale')}</div>}
          {loadingSky && <div className="ed-label spx-pulse" style={{ color: 'var(--acc)' }}>{t('catalog.loading')}</div>}
          {!scanRes && !loadingSky && <span className="ed-label">{t('scan.hint')}</span>}
        </HudCell>
      </HudRow>
    </>
  );

  return (
    <ViewFrame active={active} testId="view-catalog" plain stage={listPage}
      right={<Drawer side="r" wide open={dr.ro} onToggle={dr.toggleR} label={t('ed.detail')} index="01" testId="cat-detail" tabId="drawer-r">{detailBody}</Drawer>}
      hud={hudNode}
      />
  );
}
/* =====================================================================
   BÖLÜM 19 — ANA UYGULAMA  (üst çubuk · dil · kalıcı veritabanı · iki görünüm)
   ===================================================================== */
function uploadErrText(t, e) {
  if (e && ERR_KEYS.includes(e.code)) return t('real.err.' + e.code, { detail: e.message || '', status: '' });
  if (e && ['FORMAT', 'EMPTY', 'IMG'].includes(e.code)) return t('sky.err.' + e.code);
  return t('sky.err.GENERIC', { detail: String((e && e.message) || '').slice(0, 160) });
}
/** Kenar menüsü simgeleri (satır içi SVG; dış bağımlılık yok) */
function NavIcon({ id }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, className: 'sx-ico' };
  if (id === 'real') return (<svg {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" /><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3" /></svg>);
  if (id === 'map') return (<svg {...p}><path d="M3 6.5l6-2.3 6 2.3 6-2.3v13.3l-6 2.3-6-2.3-6 2.3z" /><path d="M9 4.2v13.3M15 6.5v13.3" /></svg>);
  return (<svg {...p}><rect x="3.5" y="4" width="17" height="4.6" rx="1.4" /><path d="M5 8.6V19a1.4 1.4 0 0 0 1.4 1.4h11.2A1.4 1.4 0 0 0 19 19V8.6" /><path d="M10 13h4" /></svg>);
}
/** "Başlık — alt başlık" / "Başlık: alt başlık" biçimindeki metni iki parçaya ayırır; başlığın son sözcüğü vurgulanır */
function splitTitle(str) {
  const m = String(str).match(/\s[—–-]\s|:\s/);
  const head = m ? str.slice(0, m.index) : str;
  const tail = m ? str.slice(m.index + m[0].length) : '';
  const sp = head.lastIndexOf(' ');
  return { lead: sp > 0 ? head.slice(0, sp + 1) : '', acc: sp > 0 ? head.slice(sp + 1) : head, tail };
}


export default function App() {
  // ?ra=&dec=&fov=… ile açılış (gömme / paylaşım bağlantısı) — yalnızca ilk yüklemede okunur
  const urlInit = useMemo(() => { try { return typeof window === 'undefined' ? null : parseUrlInit(window.location.search); } catch (e) { return null; } }, []);
  const [lang, setLangState] = useState(() => (urlInit && urlInit.lang) || loadLang());
  const t = useMemo(() => makeT(lang), [lang]);
  const i18n = useMemo(() => ({ lang, t }), [lang, t]);
  const [view, setView] = useState(() => (urlInit && (urlInit.view || (urlInit.target ? 'real' : null))) || 'real');
  const [realPane, setRealPane] = useState(() => (urlInit && (urlInit.pane || (urlInit.target ? 'irsa' : null))) || 'sky');
  const [mapSrc, setMapSrcState] = useState(loadMapSrc);              // Keşif Haritası kaynağı: 'real' (SIMBAD · SkyBoT) · 'sim' (sentetik)
  const [mapState, setMapState] = useState({ phase: 'idle' });         // idle → loading → ok | failed
  const [mapNonce, setMapNonce] = useState(0);
  const [dataMode, setDataMode] = useState('live');                 // 'live' (CDS/SIMBAD/IRSA) · 'local' (yüklenen dosyalar) · 'sim' (sentetik motor)
  const [liveState, setLiveState] = useState({ phase: 'probing' });  // probing → ok | failed
  const [liveNonce, setLiveNonce] = useState(0);
  const [localFrames, setLocalFrames] = useState({ e1: null, e2: null });
  const [note, setNote] = useState(null);                           // sakin bilgi şeridi (geri düşüş)
  const [uploadMsg, setUploadMsg] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [srcOpen, setSrcOpen] = useState(false);
  const [srcPos, setSrcPos] = useState(null);
  const [realFocus, setRealFocus] = useState(null);
  const [sectorId, setSectorId] = useState('s1');
  const [custom, setCustom] = useState(DEFAULT_CUSTOM);
  const [customRaStr, setCustomRaStr] = useState(DEFAULT_CUSTOM.raStr);
  const [customDecStr, setCustomDecStr] = useState(DEFAULT_CUSTOM.decStr);
  const [customMsg, setCustomMsg] = useState(null);
  const [nameQuery, setNameQuery] = useState('');
  const [eA, setEA] = useState(0);
  const [eB, setEB] = useState(1);
  const [firstVsNow, setFirstVsNow] = useState(false);
  const [gain, setGain] = useState(3);
  const [training, setTraining] = useState(false);
  const [db, setDb] = useState(loadDb);
  const [catSel, setCatSel] = useState(null);
  const [focus, setFocus] = useState(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);          // dar ekranda araç menüsü (açılır panel / alt sayfa)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const dbRef = useRef(db);
  const qRef = useRef({ busy: false, list: [] });
  const uploadRef = useRef(null);
  const slotRef = useRef(null);
  const framesRef = useRef(localFrames);
  const modeRef = useRef(dataMode);
  const mapSrcRef = useRef(mapSrc);
  const viewRef = useRef(view);
  const paneRef = useRef(realPane);
  const srcBtn = useRef(null);
  const srcPop = useRef(null);
  mapSrcRef.current = mapSrc;
  modeRef.current = dataMode; viewRef.current = view; paneRef.current = realPane;

  const setLang = useCallback((l) => { setLangState(l); try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* yoksay */ } }, []);
  useEffect(() => { try { document.documentElement.lang = lang; document.title = NYXE_NAME + ' · ' + t('app.subtitle'); let ic = document.querySelector('link[rel="icon"]'); if (!ic) { ic = document.createElement('link'); ic.rel = 'icon'; document.head.appendChild(ic); } ic.type = 'image/png'; ic.href = NYXE_ICON; } catch (e) { /* yoksay */ } }, [lang, t]);
  useEffect(() => { setCustomRaStr(custom.raStr); setCustomDecStr(custom.decStr); }, [custom]);

  const cfg = useMemo(() => cfgOf(sectorId, custom), [sectorId, custom]);

  /* ---- Veritabanı işlemleri (ref üzerinden eşzamanlı; her değişiklikte localStorage'a yazılır) ---- */
  const commit = useCallback((next) => { dbRef.current = next; setDb(next); persistDb(next); }, []);
  const patchEntry = useCallback((id, patch) => {
    const cur = dbRef.current;
    commit({ ...cur, entries: cur.entries.map((e) => (e.uid === id ? { ...e, ...patch } : e)) });
  }, [commit]);
  const runCatalogFor = useCallback(async (id) => {
    const e = dbRef.current.entries.find((x) => x.uid === id);
    if (!e) return;
    patchEntry(id, { catalog: { status: 'pending', simbad: [], skybot: { status: 'skipped', items: [] } } });
    let res;
    try { res = await queryCatalogs(e.qra, e.qdec, e.searchRadius, e.epochIso); }
    catch (err) { res = { status: 'offline', simbad: [], skybot: { status: 'unavailable', items: [] }, radius: e.searchRadius, queriedAt: new Date().toISOString() }; }
    patchEntry(id, { catalog: res });
  }, [patchEntry]);
  const pump = useCallback(async () => {
    const q = qRef.current;
    if (q.busy) return;
    q.busy = true;
    while (q.list.length) { const id = q.list.shift(); await runCatalogFor(id); }
    q.busy = false;
  }, [runCatalogFor]);
  const recheckEntry = useCallback((id) => { qRef.current.list.push(id); pump(); }, [pump]);

  const saveEntry = useCallback((p) => {
    const prev = dbRef.current;
    const ts = new Date().toISOString();
    const { userNote, ...fields } = p;
    const idx = prev.entries.findIndex((e) => e.objKey === fields.objKey);
    let saved, entries, isNew = false;
    if (idx >= 0) {
      const old = prev.entries[idx];
      saved = { ...old, ...fields, uid: old.uid, num: old.num, id: old.id, ts: old.ts, updatedTs: ts, firstEpoch: old.firstEpoch, catalog: old.catalog };
      entries = prev.entries.map((e, i) => (i === idx ? saved : e));
    } else {
      const num = prev.entries.reduce((m, e) => Math.max(m, e.num || 0), 0) + 1;
      saved = { ...fields, uid: uid(), num, id: fields.real ? `REAL-${String(num).padStart(3, '0')}` : `USR-${fields.sectorId.toUpperCase()}-${String(num).padStart(3, '0')}`, ts, catalog: { status: 'pending', simbad: [], skybot: { status: 'skipped', items: [] } } };
      entries = [saved, ...prev.entries];
      isNew = true;
    }
    const notes = userNote ? { ...prev.notes, [fields.objKey]: [...(prev.notes[fields.objKey] || []), { uid: uid(), ts, text: userNote }] } : prev.notes;
    commit({ ...prev, entries, notes });
    if (isNew) { qRef.current.list.push(saved.uid); pump(); }
    return saved;
  }, [commit, pump]);
  const deleteEntry = useCallback((id) => {
    const cur = dbRef.current;
    const e = cur.entries.find((x) => x.uid === id);
    if (!e) return;
    const notes = { ...cur.notes };
    if (!e.known) delete notes[e.objKey];
    commit({ ...cur, entries: cur.entries.filter((x) => x.uid !== id), notes });
  }, [commit]);
  const addNote = useCallback((objKey, text) => {
    const cur = dbRef.current;
    commit({ ...cur, notes: { ...cur.notes, [objKey]: [...(cur.notes[objKey] || []), { uid: uid(), ts: new Date().toISOString(), text }] } });
  }, [commit]);
  const deleteNote = useCallback((objKey, id) => {
    const cur = dbRef.current;
    commit({ ...cur, notes: { ...cur.notes, [objKey]: (cur.notes[objKey] || []).filter((n) => n.uid !== id) } });
  }, [commit]);
  const addLog = useCallback((l) => {
    const cur = dbRef.current;
    commit({ ...cur, logs: [{ uid: uid(), ...l }, ...cur.logs].slice(0, 30) });
  }, [commit]);

  /* ---- Tarihler · odak isteği · gezinme ---- */
  const setDates = useCallback((a, b) => {
    let na = a, nb = b;
    if (na === nb) { if (na !== eA) nb = (na + 1) % 4; else na = (nb + 3) % 4; }
    setEA(na); setEB(nb);
  }, [eA]);
  const requestFocus = useCallback((f) => {
    if (f.custom) setCustom((c) => (c.ra === f.custom.ra && c.dec === f.custom.dec ? c : f.custom));
    if (f.skyKey) setMapSrcState(/\|real$/.test(f.skyKey) ? 'real' : 'sim');          // kayıt hangi gökyüzünde yapıldıysa harita o kaynağa geçer
    setSectorId(f.sectorId);
    setView('map');
    setFocus({ nonce: Date.now(), ...f });
  }, []);
  const clearFocus = useCallback(() => setFocus(null), []);
  useEffect(() => { if (!focus) return undefined; const id = setTimeout(() => setFocus(null), 40000); return () => clearTimeout(id); }, [focus]);   // karşılanamayan odak isteği kalmasın
  const requestReal = useCallback((tg) => { setRealFocus({ nonce: Date.now(), target: tg }); setRealPane('irsa'); setView('real'); }, []);
  const openInCatalog = useCallback((objKey) => { setCatSel(objKey); setView('catalog'); }, []);

  /* ---- Veri kaynağı: canlı ⇄ yerel dosya ⇄ simülasyon (sıfır hata: erişilemezse sakin geri düşüş) ---- */
  const openUpload = useCallback((slot) => { slotRef.current = slot || null; if (uploadRef.current) uploadRef.current.click(); }, []);
  const skyReport = useCallback((ok, reason) => {
    if (ok) { setLiveState({ phase: 'ok' }); return; }
    setLiveState({ phase: 'failed', reason });
    if (modeRef.current !== 'live') return;
    const toLocal = !!(framesRef.current.e1 || framesRef.current.e2);
    setDataMode(toLocal ? 'local' : 'sim');
    setNote({ kind: 'fallback', reason: reason || 'blocked', to: toLocal ? 'local' : 'sim' });
    if (!toLocal && viewRef.current === 'real' && paneRef.current === 'sky') {
      // Fotoğraf sunucusu (hips2fits) yanıt vermese de SIMBAD / SkyBoT açık olabilir: tarayıcı gerçekten çevrimdışıysa simülasyon,
      // aksi hâlde harita gerçek veriyi dener (başarısız olursa kendi sakin geri düşüşünü yapar).
      if (reason === 'offline') setMapSrcState('sim');
      setView('map');
    }
  }, []);
  const switchMode = useCallback((m) => {
    setSrcOpen(false);
    if (m === 'live') { setNote(null); setLiveState({ phase: 'probing' }); setLiveNonce((n) => n + 1); setDataMode('live'); setRealPane('sky'); setView('real'); }
    else if (m === 'local') {
      if (framesRef.current.e1 || framesRef.current.e2) { setNote(null); setDataMode('local'); setRealPane('sky'); setView('real'); }
      else openUpload();
    } else { setDataMode('sim'); setMapSrcState('sim'); setView('map'); }
  }, [openUpload]);

  /* ---- Keşif Haritası kaynağı: gerçek (SIMBAD · SkyBoT) ⇄ simülasyon; hata olursa sakin geri düşüş ---- */
  const mapReport = useCallback((st) => {
    setMapState(st);
    if (st.phase === 'failed' && mapSrcRef.current === 'real') {
      setMapSrcState('sim');
      // Canlı gökyüzü zaten geri düşmüş ve şerit açıksa onun "Yeniden dene"si (canlı fotoğraf) korunur; yoksa harita notu gösterilir
      setNote((n) => (n && n.kind === 'fallback' && !n.scope ? n : { kind: 'fallback', scope: 'map', reason: st.reason || 'blocked', to: 'sim' }));
    }
  }, []);
  const chooseMapSrc = useCallback((m) => {
    setSrcOpen(false);
    try { localStorage.setItem(MAPSRC_KEY, m); } catch (e) { /* yoksay */ }
    if (m === 'real') { setNote(null); setMapState({ phase: 'loading' }); setMapNonce((n) => n + 1); setMapSrcState('real'); }
    else { setMapSrcState('sim'); setMapState({ phase: 'idle' }); }
    setView('map');
  }, []);
  const skipMap = useCallback(() => { setMapSrcState('sim'); setMapState({ phase: 'idle' }); }, []);     // yükleme sırasında "simülasyonu kullan" (tercih kaydedilmez)
  const retryMap = useCallback(() => { setNote(null); setMapState({ phase: 'loading' }); setMapNonce((n) => n + 1); setMapSrcState('real'); setView('map'); }, []);
  // Galeri hedefini haritada gerçek koordinatıyla aç (kadraj merkezi = SPHEREx döneminin ortası, hızlı yıldız karede kalsın)
  const goCustom = useCallback((tg) => {
    const c = propagate({ ra: tg.ra, dec: tg.dec, pmra: tg.pmra || 0, pmdec: tg.pmdec || 0, epoch: tg.epoch || 2000 }, 2025.75);
    const ra = wrap360(c.ra), dec = clamp(c.dec, -88, 88);
    setCustom({ raStr: ra.toFixed(5), decStr: dec.toFixed(5), ra, dec });
    setSectorId('s4'); setView('map');
  }, []);
  const ingestFiles = useCallback(async (fileList, slotHint) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const frames = []; const errs = [];
    for (const f of files.slice(0, 4)) {
      try { frames.push(await readLocalFrame(f)); } catch (e) { errs.push({ name: (f && f.name) || '?', code: e && e.code, message: e && e.message }); }
    }
    if (frames.length) {
      let next = { ...framesRef.current };
      if (frames.length >= 2) {
        const two = frames.slice(0, 2);
        if (two[0].yr && two[1].yr && two[0].yr > two[1].yr) two.reverse();
        next = { e1: two[0], e2: two[1] };
      } else {
        next[slotHint || (!next.e1 ? 'e1' : 'e2')] = frames[0];
      }
      framesRef.current = next;
      setLocalFrames(next);
      setNote(null); setDataMode('local'); setRealPane('sky'); setView('real');
    }
    setUploadMsg({ ok: frames.slice(0, 2).map((f) => f.name), errs, extra: frames.length > 2 || files.length > 2 });
  }, []);
  const clearFrame = useCallback((slot) => {
    const next = { ...framesRef.current, [slot]: null };
    framesRef.current = next;
    setLocalFrames(next);
    if (!next.e1 && !next.e2 && modeRef.current === 'local') {
      setLiveNonce((n) => n + 1);
      setDataMode('live'); setLiveState({ phase: 'probing' });
    }
  }, []);
  useEffect(() => { if (!uploadMsg || uploadMsg.errs.length) return undefined; const id = setTimeout(() => setUploadMsg(null), 9000); return () => clearTimeout(id); }, [uploadMsg]);

  /* ---- Sürükle-bırak · çevrimiçi/çevrimdışı olayları ---- */
  useEffect(() => {
    const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
    const over = (e) => { if (!hasFiles(e)) return; e.preventDefault(); setDragging(true); };
    const leave = (e) => { if (!e.relatedTarget) setDragging(false); };
    const drop = (e) => { if (!hasFiles(e)) return; e.preventDefault(); setDragging(false); ingestFiles(e.dataTransfer.files); };
    const offline = () => { setOnline(false); if (modeRef.current === 'live') skyReport(false, 'offline'); };
    const goOnline = () => { setOnline(true); setNote((n) => (n && n.kind === 'fallback' && n.reason === 'offline' ? { ...n, back: true } : n)); };
    window.addEventListener('dragenter', over); window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    window.addEventListener('offline', offline); window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('dragenter', over); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop);
      window.removeEventListener('offline', offline); window.removeEventListener('online', goOnline);
    };
  }, [ingestFiles, skyReport]);

  /* ---- Rozet menüsü konumu ---- */
  useLayoutEffect(() => {
    if (!srcOpen || !srcBtn.current) return;
    const r = srcBtn.current.getBoundingClientRect();
    const w = Math.min(350, window.innerWidth - 16);
    const mq = (q) => typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
    const side = mq('(min-width:1280px)');
    if (mq('(max-width:760px)')) setSrcPos({ left: 8, bottom: 8, w: window.innerWidth - 16 });
    else if (side) setSrcPos({ left: Math.min(r.right + 12, window.innerWidth - w - 8), bottom: Math.max(8, window.innerHeight - r.bottom - 6), w });
    else setSrcPos({ left: clamp(r.left, 8, window.innerWidth - w - 8), top: r.bottom + 6, w });
  }, [srcOpen, lang, view]);
  useEffect(() => {
    if (!srcOpen) return undefined;
    const close = () => setSrcOpen(false);
    const onDown = (e) => { if ((srcBtn.current && srcBtn.current.contains(e.target)) || (srcPop.current && srcPop.current.contains(e.target))) return; close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', onDown); document.addEventListener('keydown', onKey); window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', close); };
  }, [srcOpen]);

  /* ---- Dar ekran araç menüsü: sekme değişince, Esc ile, dışarı dokununca ve geniş ekrana geçince kapanır ---- */
  useEffect(() => { setMenuOpen(false); }, [view, realPane]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('[data-testid=src-menu]')) setMenuOpen(false); };   // Esc önce açık kaynak menüsünü kapatır
    const onSize = () => { if (window.innerWidth >= 1280) setMenuOpen(false); };
    document.addEventListener('keydown', onKey); window.addEventListener('resize', onSize);
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onSize); };
  }, [menuOpen]);

  /* ---- Özel koordinat ---- */
  const applyCustom = () => {
    const ra = parseAngle(customRaStr, 'ra'), dec = parseAngle(customDecStr, 'dec');
    if (!isFinite(ra) || !isFinite(dec) || dec < -89 || dec > 89) { setCustomMsg({ k: 'custom.bad' }); return; }
    setCustomMsg(null);
    setCustom({ raStr: customRaStr, decStr: customDecStr, ra: wrap360(ra), dec });
    setSectorId('s4');
  };
  const resolveObject = async () => {
    if (!nameQuery.trim()) return;
    setCustomMsg({ k: 'custom.resolving' });
    try {
      const r = await resolveName(nameQuery.trim());
      setCustomRaStr(r.ra.toFixed(5)); setCustomDecStr(r.dec.toFixed(5));
      setCustomMsg({ k: 'custom.resolved', p: { name: nameQuery.trim(), ra: fmtRA(r.ra), dec: fmtDec(r.dec) } });
    } catch (e) { setCustomMsg({ k: 'custom.failed', p: { msg: e.message } }); }
  };

  const embed = !!(urlInit && urlInit.embed);
  const syncUrl = useCallback((p) => {
    try { window.history.replaceState(null, '', buildShareUrl({ ...p, lang: urlInit && urlInit.lang ? lang : undefined, embed })); } catch (e) { /* file:// veya sandbox: sessizce atla */ }
  }, [lang, embed, urlInit]);
  const app = {
    urlInit, embed, syncUrl, t, lang, db, cfg, sectorId, setSectorId, gain, setGain, training, custom, eA, eB, setDates, firstVsNow, setFirstVsNow,
    saveEntry, deleteEntry, addNote, deleteNote, addLog, recheckEntry, focus, requestFocus, clearFocus,
    catSel, setCatSel, openInCatalog, realFocus, requestReal, setView,
    realPane, setRealPane, dataMode, liveState, liveNonce, localFrames, skyReport, switchMode, openUpload, clearFrame,
    mapSrc, mapState, mapNonce, mapReport, chooseMapSrc, skipMap, retryMap, goCustom,
  };
  const mapReal = view === 'map' && mapSrc === 'real';
  const badgeMode = view === 'map' ? (mapReal ? 'maplive' : 'sim') : dataMode;
  const badgeState = view === 'map' ? (mapReal ? (mapState.phase === 'ok' ? 'maplive' : 'mapprobing') : 'sim') : (badgeMode === 'live' && liveState.phase === 'probing' ? 'probing' : badgeMode);

  /* ---- Editoryal kabuk: yazı tipleri · üst çubuk yüksekliği (sahne bunun altından başlar) ---- */
  useEdFonts();
  const topRef = useRef(null);
  const sideRef = useRef(null);
  const [topH, setTopH] = useState(72);
  const [sideH, setSideH] = useState(110);
  useLayoutEffect(() => {
    const els = [[topRef.current, setTopH], [sideRef.current, setSideH]];
    const m = () => els.forEach(([el, set]) => { if (!el) return; const h = Math.ceil(el.getBoundingClientRect().height); if (h > 0) set(h); });
    m();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(m); els.forEach(([el]) => el && ro.observe(el)); }
    window.addEventListener('resize', m);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', m); };
  }, []);

  const noteOn = !!note && !(view === 'map' && !note.scope && mapReal && mapState.phase === 'ok');
  const statusTag = noteOn && note.kind === 'fallback' ? 'FALLBACK' : online ? 'ONLINE' : 'OFFLINE';
  const statusCol = statusTag === 'ONLINE' ? '#8FE0B5' : statusTag === 'FALLBACK' ? '#E3B567' : '#F0587A';
  const SRC_COL = { live: '#8FE0B5', maplive: '#8FE0B5', local: '#D4E2FB', sim: '#A9C4F5', probing: '#A9C4F5', mapprobing: '#A9C4F5' };
  const aboutReal = view === 'real' || mapReal;
  const aboutCol = aboutReal ? '#8FE0B5' : '#F0587A';
  const navItems = [
    ['real', 'tip.tab.real', 'tab.real', 'tab.realShort'],
    ['map', 'tip.tab.map', 'tab.map', 'tab.mapShort'],
    ['catalog', 'tip.tab.catalog', 'tab.catalog', 'tab.catalogShort'],
  ];

  return (
    <I18nCtx.Provider value={i18n}>
      <div lang={lang} className="ed" data-testid="app-root" data-embed={embed ? '1' : '0'} style={{ '--ed-hdr': `${topH}px`, '--sx-side-h': `${sideH}px` }}>
        <style>{ED_CSS}</style>
        <Atmosphere />
        {embed && (<a className="nx-embed-link" data-testid="embed-link" href={(() => { try { return window.location.href.replace(/([?&])embed=1&?/, '$1').replace(/[?&]$/, ''); } catch (e) { return '#'; } })()} target="_blank" rel="noreferrer"><img src={NYXE_ICON} alt="" /><NyxeWord gid="nxg-embed" height={11} /><span className="nx-sr">{NYXE_NAME}</span> ↗</a>)}

        <RealHub app={app} active={view === 'real'} />
        <MapView app={app} active={view === 'map'} />
        <CatalogView app={app} active={view === 'catalog'} />

        {/* ============ KENAR MENÜSÜ (geniş ekranda sol sütun · dar ekranda üst çubuk) ============ */}
        <aside className="sx-side" ref={sideRef} data-testid="sidebar" data-menu={menuOpen ? 'open' : 'closed'}>
          <div className="ed-brand" data-testid="brand">
            <img className="nx-mark" src={NYXE_LOGO} alt="" width="60" height="60" />
            <div className="sx-word"><b data-testid="app-name"><NyxeWord gid="nxg-side" height={34} /><span className="nx-sr">{NYXE_NAME}</span></b><small>{t('nx.brandSub')}</small></div>
          </div>
          <button type="button" className="nx-menu-btn" data-testid="menu-btn" aria-expanded={menuOpen} aria-controls="nx-tools" aria-label={menuOpen ? t('nx.menu.close') : t('nx.menu.open')} onClick={() => setMenuOpen((o) => !o)}>
            <span className="nx-burger" aria-hidden="true"><i /><i /><i /></span>
            <span className="nx-menu-lbl">{t('nx.menu')}</span>
            <i className={`nx-menu-dot ${statusTag === 'ONLINE' ? '' : 'spx-pulse'}`} aria-hidden="true" style={{ background: statusCol }} />
          </button>
          <div className="sx-orn" aria-hidden="true"><i /><span>✦</span><i /></div>

          <nav className="ed-nav" role="tablist" aria-label={t('nx.menu.nav')}>
            {navItems.map(([id, tipId, long, short]) => (
              <span key={id} className="sx-navitem">
                <button type="button" role="tab" aria-selected={view === id} data-testid={`tab-${id}`} onClick={() => setView(id)} className="ed-tab">
                  <NavIcon id={id} />
                  <span className="sx-lbl is-long">{t(long)}</span>
                  <span className="sx-lbl is-short" aria-hidden="true">{t(short)}</span>
                  {id === 'catalog' && db.entries.length > 0 && <b data-testid="catalog-count">{db.entries.length}</b>}
                </button>
                <InfoTip id={tipId} title={t(long)} />
              </span>
            ))}
          </nav>

          {menuOpen && <div className="nx-scrim" data-testid="menu-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
          <div className="sx-tools" id="nx-tools" data-testid="menu-panel" data-open={menuOpen ? 'true' : 'false'}>
            <div className="nx-sheet-head">
              <b>{t('nx.menu')}</b>
              <button type="button" className="nx-x" data-testid="menu-close" aria-label={t('nx.menu.close')} onClick={() => setMenuOpen(false)}>✕</button>
            </div>
            <div className="sx-grp-t">{t('nx.data')}</div>
            <div className="sx-rows">
              {view === 'map' && mapSrc !== 'real' && (
                <span className="sx-row">
                  <label className="ed-meta" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" data-testid="training" checked={training} onChange={(e) => setTraining(e.target.checked)} />{t('training')}
                  </label>
                  <InfoTip id="tip.training" title={t('training')} />
                </span>
              )}
              <span className="sx-row">
                <button type="button" data-testid="top-upload" onClick={() => { setMenuOpen(false); openUpload(); }} aria-label={t('top.upload')} title={t('top.upload')} className="ed-meta">
                  <span aria-hidden className="sx-g">↑</span><span className="sx-lbl">{t('top.upload')}</span>
                </button>
                <InfoTip id="tip.top.upload" title={t('top.upload')} />
              </span>
              <span className="sx-row">
                <button type="button" ref={srcBtn} data-testid="src-badge" data-state={badgeState} aria-haspopup="menu" aria-expanded={srcOpen} onClick={() => setSrcOpen((o) => !o)} title={t('src.menu.title')} className="ed-meta">
                  <i className={`ed-dot is-round ${badgeState === 'probing' || badgeState === 'mapprobing' ? 'spx-pulse' : ''}`} style={{ background: SRC_COL[badgeState] }} />
                  <span className="sx-lbl">{t('src.' + badgeState)}</span>
                  <span aria-hidden className="sx-caret">{srcOpen ? '▴' : '▾'}</span>
                </button>
                <InfoTip id="tip.src.badge" title={t('src.menu.title')} />
              </span>
              <span className="sx-row">
                <span role="note" data-testid="proto-badge" className="ed-meta is-static" style={{ color: '#EBC68C' }}>
                  <i aria-hidden className="ed-dot spx-pulse" style={{ background: '#E3B567' }} /><span className="sx-lbl">{t('proto.badge')}</span>
                </span>
                <InfoTip id="tip.proto" title={t('proto.title')} />
              </span>
              <span className="sx-row">
                <button type="button" onClick={() => { setMenuOpen(false); setAboutOpen(true); }} data-testid="about-btn" data-kind={view === 'real' ? 'real' : mapReal ? 'catalog' : 'synthetic'} title={t('about.title')} className="ed-meta" style={{ color: aboutCol }}>
                  <i aria-hidden className="ed-dot" style={{ background: aboutCol }} />
                  <span className="sx-lbl">{view === 'real' ? (realPane === 'sky' ? t('badge.sky') : t('badge.real')) : mapReal ? t('badge.mapreal') : t('badge.synthetic')}</span>
                </button>
              </span>
            </div>
            <LangMenu lang={lang} setLang={setLang} />
            <div className="sx-status" data-testid="status-tag">STATUS // {statusTag}<i className={`ed-dot is-round ${statusTag === 'ONLINE' ? '' : 'spx-pulse'}`} style={{ background: statusCol }} /></div>
          </div>
        </aside>

        {/* ============ SAYFA BAŞLIĞI + sekmeler ============ */}
        <header className="ed-top sx-head" ref={topRef} data-testid="topbar">
          <div className="sx-head-row">
            <div className="sx-titles">
              {(() => {
                const tt = splitTitle(t(view === 'real' ? 'nx.h.real' : view === 'map' ? 'nx.h.map' : 'nx.h.catalog'));
                return (
                  <>
                    <h1 className="sx-h1" data-testid="page-title">{tt.lead}<span className="sx-acc">{tt.acc}</span></h1>
                    {tt.tail ? <p className="sx-sub">{tt.tail}</p> : null}
                  </>
                );
              })()}
            </div>
            {view === 'real' && (
              <div className="ed-seg" role="tablist" aria-label="real panes" data-testid="real-panes">
                {['sky', 'irsa'].map((id) => (
                  <span key={id} className="inline-flex items-center gap-1.5">
                    <button type="button" role="tab" aria-selected={realPane === id} data-testid={`pane-${id}`} onClick={() => setRealPane(id)} className="ed-segbtn">
                      {t('pane.' + id)}
                    </button>
                    <InfoTip id={'tip.pane.' + id} title={t('pane.' + id)} />
                  </span>
                ))}
              </div>
            )}
          </div>

          {view === 'map' && sectorId === 's4' && (
            <div className="nx-custom" data-testid="custom-row">
              <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                <label className="ed-label">{t('custom.ra')}
                  <input value={customRaStr} onChange={(e) => setCustomRaStr(e.target.value)} className="mt-1 block w-40" placeholder="14h 29m 42.9s" data-testid="custom-ra" />
                </label>
                <label className="ed-label">{t('custom.dec')}
                  <input value={customDecStr} onChange={(e) => setCustomDecStr(e.target.value)} className="mt-1 block w-40" placeholder={'-62° 40\' 46"'} data-testid="custom-dec" />
                </label>
                <button type="button" onClick={applyCustom} data-testid="custom-apply" className="ed-btn is-sm is-primary">{t('custom.create')}</button>
                <div className="flex items-end gap-2">
                  <label className="ed-label">{t('custom.name')}
                    <input value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') resolveObject(); }} className="mt-1 block w-44" placeholder={t('custom.namePh')} />
                  </label>
                  <button type="button" onClick={resolveObject} className="ed-btn is-sm" aria-label={t('custom.name')}><span aria-hidden>⌕</span></button>
                </div>
                <InfoTip id="tip.custom" title={t('sec.s4.title')} />
                <div className="min-h-[16px] min-w-[200px] flex-1 ed-txt">{customMsg ? t(customMsg.k, customMsg.p) : t('custom.hint')}</div>
              </div>
            </div>
          )}
        </header>

        {/* ============ Duyuru şeritleri (üst çubuğun altında yüzer) ============ */}
        {(noteOn || uploadMsg) && (
          <div className="ed-notes">
            {noteOn && (
              <div className="ed-note" data-testid="src-banner" data-kind={note.kind} data-to={note.to}>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <div className="min-w-0 flex-1 basis-64 text-[12px] leading-snug">
                    <div className="ed-label mb-1" style={{ color: 'var(--acc)' }}>{note.to === 'local' ? '◍' : '◇'} {t(note.scope === 'map' ? 'rm.fb.title' : note.to === 'local' ? 'src.fb.titleLocal' : 'src.fb.title')}</div>
                    <div className="text-[#C5D3EE]">{t(note.scope === 'map' ? 'rm.fb.body' : 'src.fb.body', { reason: t('src.reason.' + note.reason) })}{note.back ? ' ' + t('src.fb.back') : ''}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" data-testid="src-retry" onClick={() => (note.scope === 'map' ? retryMap() : switchMode('live'))} className={`ed-btn is-sm is-ok ${note.back ? 'is-primary' : ''}`}>{t('src.retry')}</button>
                    <button type="button" data-testid="src-banner-upload" onClick={() => openUpload()} className="ed-btn is-sm">{t('sky.btn.upload')}</button>
                    <button type="button" data-testid="src-banner-close" onClick={() => setNote(null)} aria-label={t('common.close')} className="ed-link">✕</button>
                  </div>
                </div>
              </div>
            )}
            {uploadMsg && (
              <div className={`ed-note ${uploadMsg.errs.length ? 'is-warn' : 'is-ok'}`} data-testid="upload-msg" data-ok={uploadMsg.ok.length} data-err={uploadMsg.errs.length}>
                <div className="flex flex-wrap items-start gap-x-4 gap-y-1 text-[11.5px] leading-snug">
                  <div className="min-w-0 flex-1 basis-64 space-y-1">
                    {uploadMsg.ok.length > 0 && <div className="text-[#8FE0B5]">● {t('upload.ok', { n: uploadMsg.ok.length, names: uploadMsg.ok.join(' · ') })}</div>}
                    {uploadMsg.errs.map((e, i) => (<div key={i} className="break-words text-[#EBCF9F]" data-testid="upload-err">◆ {e.name}: {uploadErrText(t, e)}</div>))}
                    {uploadMsg.extra && <div className="text-[#93A6CC]">{t('upload.more')}</div>}
                  </div>
                  <button type="button" data-testid="upload-msg-close" onClick={() => setUploadMsg(null)} aria-label={t('common.close')} className="ed-link">✕</button>
                </div>
              </div>
            )}
          </div>
        )}

        <input ref={uploadRef} data-testid="upload-file" type="file" multiple accept=".fits,.fit,.fts,.fz,.gz,.png,.jpg,.jpeg,.webp,.gif,.bmp,image/*,application/fits" className="hidden"
          onChange={(e) => { const fl = Array.from(e.target.files || []); e.target.value = ''; ingestFiles(fl, slotRef.current); slotRef.current = null; }} />
        {dragging && (
          <div className="ed-drop" data-testid="drop-overlay">
            <div>
              <div className="ed-label" style={{ color: 'var(--acc)' }}>↓ DROP</div>
              <div className="ed-serif mt-3 text-[30px] font-bold leading-none text-[#EEF3FD]">{t('drop.title')}</div>
              <div className="ed-txt mt-3">{t('drop.sub')}</div>
            </div>
          </div>
        )}
        {srcOpen && srcPos && createPortal(
          <div ref={srcPop} role="menu" data-testid="src-menu" className="ed-menu spx-pop spx-scroll" style={{ left: srcPos.left, top: srcPos.top, bottom: srcPos.bottom, width: srcPos.w }}>
            <div className="ed-label border-b border-white/10 px-4 py-3">{t('src.menu.title')}</div>
            {(view === 'map' ? ['maplive', 'sim'] : ['live', 'local', 'sim']).map((m, i) => {
              const on = badgeMode === m;
              let st;
              if (m === 'maplive') st = mapState.phase === 'ok' ? t('rm.st.ok', { n: mapState.n || 0 }) : mapState.phase === 'failed' ? t('src.st.failed') : t('src.st.probing');
              else if (m === 'live') st = t('src.st.' + (liveState.phase === 'failed' ? 'failed' : liveState.phase === 'ok' ? 'ok' : 'probing'));
              else if (m === 'local') st = localFrames.e1 || localFrames.e2 ? t('src.st.files', { n: (localFrames.e1 ? 1 : 0) + (localFrames.e2 ? 1 : 0) }) : t('src.st.nofiles');
              else st = t('src.st.ready');
              const failed = m === 'maplive' ? mapState.phase === 'failed' : m === 'live' && liveState.phase === 'failed';
              const col = failed ? '#E3B567' : SRC_COL[m];
              return (
                <button key={m} type="button" role="menuitemradio" aria-checked={on} data-testid={`src-opt-${m}`} onClick={() => (view === 'map' ? chooseMapSrc(m === 'maplive' ? 'real' : 'sim') : switchMode(m))} className="ed-menu-i">
                  <span className="ed-label mt-[3px]" style={{ color: on ? 'var(--acc)' : undefined }}>{edPad(i + 1)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="ed-serif block text-[16px] font-bold leading-tight text-[#EEF3FD]">{t('src.opt.' + m + '.t')}</span>
                    <span className="mt-1 block text-[11.5px] leading-snug text-[#93A6CC]">{t('src.opt.' + m + '.d')}</span>
                    <span className="ed-label mt-2 flex items-center gap-2" style={{ color: col }}><i className="ed-dot is-round" style={{ background: col, width: 5, height: 5 }} />{st}</span>
                  </span>
                </button>
              );
            })}
          </div>, document.body)}

        <footer className="ed-foot" data-testid="footer">
          <span data-testid="footer-credit">{t('footer.credit', { year: COPYRIGHT_YEAR })}</span>
          <span className="nx-disc" data-testid="nasa-disclaimer">{t('nx.disclaimer')}<span className="hidden 2xl:inline"> · {t('nx.data')}: NASA/IPAC IRSA · CDS SIMBAD · IMCCE SkyBoT</span></span>
        </footer>

        {aboutOpen && (
          <Modal title={t('about.title')} onClose={() => setAboutOpen(false)}>
            <div className="space-y-4 text-[12.5px] leading-relaxed text-[#C5D3EE]">
              <div className="nx-about-brand" data-testid="about-brand">
                <img src={NYXE_LOGO} alt="" width="92" height="92" />
                <div><b><NyxeWord gid="nxg-about" height={42} /><span className="nx-sr">{NYXE_NAME}</span></b><span>{t('app.subtitle')}</span></div>
              </div>
              <p className="ed-note-box is-ok" data-testid="about-real">{t('about.real')}</p>
              {['about.p1', 'about.p2', 'about.p3', 'about.p4'].map((k) => (<p key={k}>{t(k)}</p>))}
              <p className="ed-note-box is-warn">{t('about.p5')}</p>
              <RealCredit />
              <p className="ed-note-box" data-testid="about-map-credit">{t('rm.credit')}</p>
              <p className="ed-label" style={{ color: '#EEF3FD' }} data-testid="about-rights">{t('about.rights', { year: COPYRIGHT_YEAR })}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {[['SIMBAD', 'https://simbad.cds.unistra.fr/simbad/'], ['NASA IRSA · SPHEREx', 'https://irsa.ipac.caltech.edu/Missions/spherex.html'], ['MPC MPChecker', 'https://minorplanetcenter.net/cgi-bin/checkmp.cgi'], ['Backyard Worlds', 'https://www.zooniverse.org/projects/marckuchner/backyard-worlds-planet-9']].map(([n, u]) => (
                  <a key={n} href={u} target="_blank" rel="noreferrer" className="ed-link" style={{ color: 'var(--acc)' }}>{n} ↗</a>
                ))}
              </div>
            </div>
          </Modal>
        )}
      </div>
    </I18nCtx.Provider>
  );
}
