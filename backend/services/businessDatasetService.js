// backend/services/businessDatasetService.js
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const DATASET_PATH = path.join(__dirname, '..', 'data', 'business_dataset.csv');

// In‑memory cache
let businesses = null;
let loadingPromise = null;

/**
 * Load the CSV dataset once and cache it in memory.
 */
function loadDataset() {
  if (businesses) {
    return Promise.resolve(businesses);
  }
  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(DATASET_PATH)
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', () => {
        businesses = rows;
        console.log(`✅ Loaded business dataset with ${rows.length} rows`);
        resolve(businesses);
      })
      .on('error', (err) => {
        console.error('❌ Failed to load dataset:', err.message);
        reject(err);
      });
  });

  return loadingPromise;
}

function clean(val) {
  return (val || '').toString().trim().toLowerCase();
}

/**
 * Simple heuristic scorer for ICP fit
 */
function scoreBusiness(row, icp) {
  let score = 0;
  const ind = clean(icp.industry);
  const loc = clean(icp.location);
  const rev = clean(icp.revenue);

  const sicName = clean(row['SIC NAME1']);
  const salesVolume = clean(row['SALES VOLUME']);
  const city = clean(row['MAILING CITY']);
  const state = clean(row['MAILING STATE']);
  const zip = clean(row['MAILING ZIP']);

  if (ind) {
    if (sicName.includes(ind)) score += 6;
    else {
      const words = ind.split(/\s+/);
      if (words.some((w) => sicName.includes(w))) score += 3;
    }
  }

  if (loc) {
    if (city && loc.includes(city)) score += 4;
    if (state && loc.includes(state)) score += 2;
    if (zip && loc.includes(zip)) score += 1;
  }

  if (rev && salesVolume) {
    if (salesVolume.includes('million') && rev.includes('m')) score += 2;
    if (salesVolume.includes('billion') && rev.includes('b')) score += 2;
  }

  if (!score) score = 1;
  return score;
}

/**
 * Get top `candidateCount` heuristic matches for an ICP
 */
async function getCandidateCompanies(icp, candidateCount = 200) {
  const data = await loadDataset();

  const scored = data.map((row, idx) => ({
    index: idx,
    row,
    score: scoreBusiness(row, icp),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, candidateCount);
}

// IMPORTANT: export as an object with this exact name
module.exports = {
  loadDataset,
  getCandidateCompanies,
  scoreBusiness,
};