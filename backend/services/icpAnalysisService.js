// backend/services/icpAnalysisService.js
const pool = require('../config/db');
const { getCandidateCompanies } = require('./businessDatasetService');
const { generatePersonaInsights } = require('./painPointService');

const DEFAULT_PERSONAS = ['CTO', 'Marketing Manager', 'Sales Director'];

/**
 * For a given ICP:
 * 1) Select top 100 relevant companies from dataset (heuristic).
 * 2) If this ICP has no AI-generated persona insights yet,
 *    call Groq ONCE per persona and save the results tied to icp_id.
 * Returns the 100 companies for the Leads UI.
 */
async function analyzeIcpWithDatasetAndGroq(icp) {
  const icpId = icp.id;

  // 1. Recommended companies (for Leads UI)
  const candidates = await getCandidateCompanies(icp, 300);
  const top = candidates.slice(0, 100);

  const selectedCompanies = top
    .map((c) => {
      const row = c.row;
      if (!row) return null;
      return {
        businessName: row['BUSINESS NAME'] || null,
        email: (row.EMAIL || '').toString().trim() || null,
        phone: (row['AREA CODE AND PHONE'] || '').toString().trim() || null,
        mailingAddress: row['MAILING ADDRESS'] || null,
        city: row['MAILING CITY'] || null,
        state: row['MAILING STATE'] || null,
        zip: row['MAILING ZIP'] || null,
        salesVolume: row['SALES VOLUME'] || null,
        employees: row['NUMBER OF EMPLOYEES'] || null,
        publicPrivate: row['PUBLIC PRIVATE COMPANY'] || null,
        locationType: row['LOCATION TYPE'] || null,
        sicName: row['SIC NAME1'] || null,
        sic: row['SIC'] || null,
        naics: row['NAICS'] || null,
        firstName: row['FIRSTNAME'] || null,
        lastName: row['LASTNAME'] || null,
        title: row['TITLE'] || null,
        web: row['WEB ADDRESS'] || null,
      };
    })
    .filter(Boolean);

  // 2. Persona insights (only if this ICP has none yet)
  await ensurePersonaInsightsForIcp(icp);

  return selectedCompanies;
}

async function ensurePersonaInsightsForIcp(icp) {
  const icpId = icp.id;
  const icpIndustry = icp.industry || 'General';

  const existing = await pool.query(
    'SELECT COUNT(*)::int AS count FROM persona_insights WHERE icp_id = $1 AND is_custom = false',
    [icpId]
  );
  const count = existing.rows[0]?.count || 0;
  if (count > 0) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const rowsToInsert = [];

    for (const persona of DEFAULT_PERSONAS) {
      const data = await generatePersonaInsights(icp, persona);
      const pains = data.pain_points || [];
      const outs = data.outcomes || [];

      pains.forEach((p) => {
        if (!p.title || !p.description) return;
        rowsToInsert.push({
          persona,
          type: 'pain_point',
          title: p.title,
          description: p.description,
          relevance: p.relevance || 8,
        });
      });

      outs.forEach((o) => {
        if (!o.title || !o.description) return;
        rowsToInsert.push({
          persona,
          type: 'outcome',
          title: o.title,
          description: o.description,
          relevance: o.relevance || 8,
        });
      });
    }

    if (rowsToInsert.length > 0) {
      const values = rowsToInsert.map((r) => [
        icpId,
        icpIndustry || 'General',
        r.persona,
        r.title,
        r.description,
        r.relevance,
        r.type,
        false, // is_custom
        'unassigned',
      ]);

      const placeholders = values
        .map(
          (_, i) =>
            `($${i * 9 + 1}, $${i * 9 + 2}, $${i * 9 + 3}, $${i * 9 + 4}, $${i * 9 + 5}, $${i * 9 + 6}, $${i * 9 + 7}, $${i * 9 + 8}, $${i * 9 + 9})`
        )
        .join(',');

      const query = `
        INSERT INTO persona_insights
        (icp_id, industry, persona, title, description, relevance_score, type, is_custom, status)
        VALUES ${placeholders};
      `;

      await client.query(query, values.flat());
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error saving persona insights for ICP:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { analyzeIcpWithDatasetAndGroq };