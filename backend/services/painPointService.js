// backend/services/painPointService.js

/**
 * Simple local generator for persona insights.
 * Does NOT call Groq. You can enrich these templates over time.
 */

function lower(val) {
  return (val || '').toString().trim().toLowerCase();
}

function matchIndustry(industry, keyword) {
  return lower(industry).includes(keyword);
}

/**
 * Returns:
 * {
 *   pain_points: [{ title, description, relevance }, ...],
 *   outcomes: [{ title, description, relevance }, ...]
 * }
 */
async function generatePersonaInsights(industry, persona) {
  const ind = lower(industry);
  const p = lower(persona);

  // Basic “sector” guess for slightly different phrasing
  let sector = 'general';
  if (matchIndustry(ind, 'saas') || matchIndustry(ind, 'software')) sector = 'software';
  else if (matchIndustry(ind, 'health') || matchIndustry(ind, 'med')) sector = 'healthcare';
  else if (matchIndustry(ind, 'manufact')) sector = 'manufacturing';
  else if (matchIndustry(ind, 'finance') || matchIndustry(ind, 'fintech')) sector = 'finance';
  else if (matchIndustry(ind, 'retail') || matchIndustry(ind, 'e-commerce')) sector = 'retail';

  if (p.includes('cto')) {
    return buildCtoInsights(sector);
  }
  if (p.includes('marketing')) {
    return buildMarketingManagerInsights(sector);
  }
  if (p.includes('sales')) {
    return buildSalesDirectorInsights(sector);
  }

  // Default generic persona
  return buildGenericPersonaInsights(sector);
}

/* --------------------------- Persona Templates --------------------------- */

function buildCtoInsights(sector) {
  const sectorNote =
    sector === 'healthcare'
      ? ' while meeting strict security and compliance requirements'
      : sector === 'finance'
      ? ' while managing risk and regulatory requirements'
      : sector === 'manufacturing'
      ? ' while supporting legacy systems on the shop floor'
      : sector === 'retail'
      ? ' while handling seasonal demand spikes and omnichannel data'
      : '';

  return {
    pain_points: [
      {
        title: 'Fragmented Technology Stack',
        description:
          'Core systems are spread across multiple vendors and custom tools, creating data silos and fragile integrations. The team spends too much time firefighting integration issues instead of building new capabilities' +
          sectorNote +
          '.',
        relevance: 9,
      },
      {
        title: 'Difficulty Scaling Infrastructure',
        description:
          'Traffic and data volumes are growing faster than expected. Capacity planning is manual, and scaling decisions are often reactive, leading to performance incidents and unplanned downtime.',
        relevance: 9,
      },
      {
        title: 'Limited Visibility into System Health',
        description:
          'Monitoring and logging are inconsistent across services. The team lacks a single view of application health, making it hard to trace issues end‑to‑end and understand their business impact.',
        relevance: 8,
      },
      {
        title: 'Talent and Knowledge Bottlenecks',
        description:
          'Critical systems are understood by only a few senior engineers. Knowledge is tribal, making onboarding slow and raising operational risk if key people leave.',
        relevance: 7,
      },
    ],
    outcomes: [
      {
        title: 'Unified, Well‑Integrated Platform',
        description:
          'Critical systems share a consistent integration pattern with clear contracts and observability. Changes can be deployed safely without breaking upstream or downstream teams.',
        relevance: 9,
      },
      {
        title: 'Predictable, Elastic Infrastructure',
        description:
          'Capacity scales automatically with demand, with clear SLOs and cost guardrails. Engineering leaders have confidence in performance during peak periods and product launches.',
        relevance: 9,
      },
      {
        title: 'Single Pane of Glass for Observability',
        description:
          'Engineering and product teams share a unified view of system health, customer experience, and key business transactions, enabling faster troubleshooting and better prioritization.',
        relevance: 8,
      },
      {
        title: 'Resilient, Well‑Documented Architecture',
        description:
          'Critical services are documented, instrumented, and follow common standards so new engineers can contribute quickly and operational risk is reduced.',
        relevance: 8,
      },
    ],
  };
}

function buildMarketingManagerInsights(sector) {
  const segmentNote =
    sector === 'saas' || sector === 'software'
      ? ' trial users, product engagement, and expansion opportunities'
      : sector === 'retail'
      ? ' high‑value shoppers and repeat purchase behavior'
      : sector === 'finance'
      ? ' key customer segments and risk‑adjusted profitability'
      : '';

  return {
    pain_points: [
      {
        title: 'Fragmented Customer View Across Channels',
        description:
          'Campaign, website, product, and CRM data live in separate tools. It is difficult to see the full buyer journey, so targeting and messaging remain generic and under‑performing' +
          segmentNote +
          '.',
        relevance: 9,
      },
      {
        title: 'Difficulty Proving Marketing ROI',
        description:
          'Attribution models are inconsistent, and revenue data is delayed or incomplete. Marketing leaders struggle to clearly connect spend to pipeline and closed‑won deals.',
        relevance: 9,
      },
      {
        title: 'Manual Campaign Operations',
        description:
          'Audience building, list management, and reporting involve exports, spreadsheets, and one‑off workflows, slowing down experimentation and time‑to‑market.',
        relevance: 8,
      },
    ],
    outcomes: [
      {
        title: 'Unified Revenue and Journey Analytics',
        description:
          'Marketing can see the full path from first touch to closed‑won in a single workspace, sliced by segment, persona, and campaign. This enables confident budget allocation and smarter messaging.',
        relevance: 9,
      },
      {
        title: 'Always‑On, Persona‑Based Campaigns',
        description:
          'Audiences are automatically refreshed based on behaviors and firmographics. Campaigns adapt in real time, personalizing content and offers to each segment.',
        relevance: 8,
      },
      {
        title: 'Operational Efficiency in the Marketing Team',
        description:
          'Routine list building, lead routing, and reporting are automated so the team can focus on strategy, testing, and collaboration with sales rather than manual data work.',
        relevance: 8,
      },
    ],
  };
}

function buildSalesDirectorInsights(sector) {
  const salesNote =
    sector === 'software' || sector === 'saas'
      ? ' complex, multi‑stakeholder SaaS deals'
      : sector === 'manufacturing'
      ? ' long‑cycle capital equipment and services deals'
      : sector === 'finance'
      ? ' multi‑product financial solutions and renewals'
      : '';

  return {
    pain_points: [
      {
        title: 'Inconsistent Pipeline Quality',
        description:
          'Sales leaders see large swings in pipeline quality and deal velocity. Reps are often working poorly qualified opportunities that do not fit the ICP, leading to low win rates' +
          salesNote +
          '.',
        relevance: 9,
      },
      {
        title: 'Limited Visibility into Deal Health',
        description:
          'Notes, emails, and stakeholder data are scattered across systems. It is difficult to quickly understand which deals are truly at risk and where executive support is needed.',
        relevance: 8,
      },
      {
        title: 'Onboarding New Reps Takes Too Long',
        description:
          'Playbooks, talk tracks, and objection handling are not consistently documented. New reps struggle to ramp quickly and repeat what top performers are doing.',
        relevance: 8,
      },
    ],
    outcomes: [
      {
        title: 'Consistent, ICP‑Aligned Pipeline',
        description:
          'Most opportunities entering the pipeline match a clear ICP definition. Reps spend more time with accounts that have the right profile and intent, improving conversion rates.',
        relevance: 9,
      },
      {
        title: 'Deal Rooms with Clear Stakeholder Maps',
        description:
          'Key contacts, engagement history, and risks are visible in one place so leaders can quickly understand which deals to support and how.',
        relevance: 8,
      },
      {
        title: 'Codified, Data‑Driven Sales Playbooks',
        description:
          'Winning behaviors and messaging are captured and shared so new reps can ramp faster and the team can run consistent plays across regions and segments.',
        relevance: 8,
      },
    ],
  };
}

function buildGenericPersonaInsights(sector) {
  return {
    pain_points: [
      {
        title: 'Disconnected Tools and Manual Reporting',
        description:
          'Teams rely on spreadsheets and exports from multiple systems to answer basic questions about performance. This slows decision‑making and hides systemic issues.',
        relevance: 9,
      },
      {
        title: 'Limited Insight into Customer Behavior',
        description:
          'Data about customers, orders, and revenue is spread across several tools, making it hard to see clear patterns and prioritize the right initiatives.',
        relevance: 8,
      },
    ],
    outcomes: [
      {
        title: 'Unified View of Operations and Customers',
        description:
          'Leaders can see up‑to‑date metrics about pipeline, revenue, and customer health in one place, segmented by ICP and persona.',
        relevance: 9,
      },
      {
        title: 'Reduced Manual Work and Faster Decisions',
        description:
          'Data collection, cleansing, and basic reporting are automated so teams can focus on strategy and execution rather than spreadsheets.',
        relevance: 8,
      },
    ],
  };
}

module.exports = { generatePersonaInsights };