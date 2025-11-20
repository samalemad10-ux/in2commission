import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { repId, repName, team, startDate, endDate } = await req.json();

    const hubspotToken = Deno.env.get('HUBSPOT_PRIVATE_TOKEN');
    if (!hubspotToken) {
      throw new Error('HubSpot token not configured');
    }

    // For SDR, fetch owner details from HubSpot to get email and name variations
    let ownerEmail = '';
    let ownerFullName = '';
    if (team === 'SDR') {
      const ownerResponse = await fetch(`https://api.hubapi.com/crm/v3/owners/${repId}`, {
        headers: {
          'Authorization': `Bearer ${hubspotToken}`,
        },
      });
      
      if (ownerResponse.ok) {
        const ownerData = await ownerResponse.json();
        ownerEmail = ownerData.email;
        ownerFullName = `${ownerData.firstName} ${ownerData.lastName}`;
        console.log(`Fetched SDR owner details: email=${ownerEmail}, fullName=${ownerFullName}`);
      }
    }

    // Normalize team name for comparison
    const teamLower = team.toLowerCase();
    const isAE = teamLower.includes('ae');
    const isSDR = teamLower.includes('sdr');
    const isMarketing = teamLower.includes('marketing');
    
    console.log(`Processing ${repName} - Team: ${team} (isAE: ${isAE}, isSDR: ${isSDR}, isMarketing: ${isMarketing})`);

    // Fetch deals from HubSpot - only date filters, we'll filter by owner after
    let dealFilters: any[] = [
      {
        propertyName: 'closedate',
        operator: 'GTE',
        value: new Date(startDate).getTime(),
      },
      {
        propertyName: 'closedate',
        operator: 'LTE',
        value: new Date(endDate).getTime(),
      },
    ];

    const dealsResponse = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hubspotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: dealFilters,
          },
        ],
        properties: ['amount', 'closedate', 'dealstage', 'hubspot_owner_id', 'deal_channel', 'payment_terms', 'sdr_owner'],
        limit: 100,
      }),
    });

    const dealsData = await dealsResponse.json();
    console.log(`Fetched ${dealsData.results?.length || 0} raw deals for ${repName} (${team})`);
    
    // Log deal details for debugging
    if (dealsData.results && dealsData.results.length > 0) {
      console.log('Sample deal properties:', JSON.stringify(dealsData.results[0].properties, null, 2));
    }
    
    // Step 1: Map and classify each deal with normalized assignedTo field
    let deals = dealsData.results?.map((d: any) => {
      const sdrOwner = d.properties.sdr_owner?.toString().trim().toLowerCase() || '';
      const dealChannel = d.properties.deal_channel?.toString().trim().toLowerCase() || '';
      const hubspotOwnerId = d.properties.hubspot_owner_id?.toString().trim().toLowerCase() || '';
      
      // Central classification logic
      let assignedTo = '';
      if (sdrOwner) {
        assignedTo = `sdr:${sdrOwner}`;
      } else if (dealChannel === 'inbound') {
        assignedTo = 'marketing';
      } else {
        assignedTo = `ae:${hubspotOwnerId}`;
      }
      
      return {
        amount: parseFloat(d.properties.amount) || 0,
        closedate: d.properties.closedate,
        dealstage: d.properties.dealstage,
        hubspot_owner_id: d.properties.hubspot_owner_id,
        sdr_owner: d.properties.sdr_owner,
        deal_channel: d.properties.deal_channel,
        payment_terms: d.properties.payment_terms,
        assignedTo, // New classification field
      };
    }) || [];
    
    console.log(`Initial deals fetched: ${deals.length}`);
    console.log('Sample assignedTo:', deals.slice(0, 5).map((d: any) => d.assignedTo));
    
    // Step 2: Filter deals deterministically using assignedTo field
    const normalizedRepId = repId?.toString().trim().toLowerCase() || '';
    const normalizedEmail = ownerEmail?.toString().trim().toLowerCase() || '';
    
    if (isAE) {
      console.log(`Filtering AE deals. Looking for assignedTo: ae:${normalizedRepId}`);
      deals = deals.filter((d: any) => d.assignedTo === `ae:${normalizedRepId}`);
      console.log(`After AE filter: ${deals.length} deals for ${repName}`);
    } else if (isSDR) {
      console.log(`Filtering SDR deals. Looking for assignedTo: sdr:${normalizedEmail}`);
      deals = deals.filter((d: any) => d.assignedTo === `sdr:${normalizedEmail}`);
      console.log(`After SDR filter: ${deals.length} deals for ${repName}`);
    } else if (isMarketing) {
      console.log(`Filtering Marketing deals. Looking for assignedTo: marketing`);
      deals = deals.filter((d: any) => d.assignedTo === 'marketing');
      console.log(`After Marketing filter: ${deals.length} deals for ${repName}`);
    }
    
    console.log(`Final: Team=${team}, RepID=${repId}, Deals=${deals.length}`);

    // Fetch meetings from HubSpot (only for SDR team)
    let meetings: any[] = [];
    if (isSDR) {
      const meetingsResponse = await fetch(
        `https://api.hubapi.com/crm/v3/objects/meetings/search`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hubspotToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: 'hubspot_owner_id',
                    operator: 'EQ',
                    value: repId,
                  },
                  {
                    propertyName: 'hs_meeting_start_time',
                    operator: 'GTE',
                    value: new Date(startDate).getTime(),
                  },
                  {
                    propertyName: 'hs_meeting_start_time',
                    operator: 'LTE',
                    value: new Date(endDate).getTime(),
                  },
                ],
              },
            ],
            properties: ['hs_meeting_start_time', 'hs_meeting_type', 'hs_meeting_outcome'],
            limit: 1000,
          }),
        }
      );

      const meetingsData = await meetingsResponse.json();
      console.log(`Fetched ${meetingsData.results?.length || 0} raw meetings for ${repName}`);
      
      // Filter for "sales discovery meeting" type with "completed" outcome
      meetings = meetingsData.results
        ?.filter((m: any) => {
          const meetingType = m.properties.hs_meeting_type?.toLowerCase() || '';
          const outcome = m.properties.hs_meeting_outcome?.toLowerCase() || '';
          const isMatch = meetingType.includes('sales discovery meeting') && outcome === 'completed';
          return isMatch;
        })
        .map((m: any) => ({
          timestamp: new Date(parseInt(m.properties.hs_meeting_start_time)).toISOString(),
        })) || [];
      
      console.log(`After filtering: ${meetings.length} qualifying meetings (sales discovery + completed)`);
    }

    // Fetch commission settings from Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/commission_settings?select=*&limit=1`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    });

    const settings = (await settingsResponse.json())[0];

    // Calculate commission using the engine logic
    const result = calculateCommission(repId, repName, team, deals, meetings, settings, startDate, endDate);

    // Log to database
    await fetch(`${supabaseUrl}/rest/v1/commission_run_logs`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        rep_id: repId,
        rep_name: repName,
        team,
        period_start: startDate,
        period_end: endDate,
        commission_json: result,
        success: true,
      }),
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error calculating commission:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function calculateCommission(
  repId: string,
  repName: string,
  team: string,
  deals: any[],
  meetings: any[],
  settings: any,
  startDate: string,
  endDate: string
) {
  let totalRevenue = 0;
  let dealCommission = 0;
  let meetingBonus = 0;
  let weeklyBreakdown: any[] = [];

  const closedWonDeals = deals.filter(d => 
    d.dealstage?.toLowerCase().includes('closed') && 
    d.dealstage?.toLowerCase().includes('won')
  );

  totalRevenue = closedWonDeals.reduce((sum, deal) => sum + deal.amount, 0);

  // Apply revenue multiplier based on team
  let adjustedRevenue = totalRevenue;
  if (team === 'AE' && settings.ae_revenue_multiplier_brackets) {
    const multiplierBracket = settings.ae_revenue_multiplier_brackets.find((b: any) =>
      totalRevenue >= b.min && (b.max === null || totalRevenue < b.max)
    );
    if (multiplierBracket) {
      adjustedRevenue = totalRevenue * multiplierBracket.multiplier;
    }
  } else if (team === 'SDR' && settings.sdr_revenue_multiplier_brackets) {
    const multiplierBracket = settings.sdr_revenue_multiplier_brackets.find((b: any) =>
      totalRevenue >= b.min && (b.max === null || totalRevenue < b.max)
    );
    if (multiplierBracket) {
      adjustedRevenue = totalRevenue * multiplierBracket.multiplier;
    }
  } else if (team === 'Marketing' && settings.marketing_revenue_multiplier_brackets) {
    const multiplierBracket = settings.marketing_revenue_multiplier_brackets.find((b: any) =>
      totalRevenue >= b.min && (b.max === null || totalRevenue < b.max)
    );
    if (multiplierBracket) {
      adjustedRevenue = totalRevenue * multiplierBracket.multiplier;
    }
  }

  const teamLower = team.toLowerCase();
  const isAE = teamLower.includes('ae');
  const isSDR = teamLower.includes('sdr');
  const isMarketing = teamLower.includes('marketing');

  if (isAE) {
    const bracket = settings.ae_brackets.find((b: any) => 
      adjustedRevenue >= b.min && (b.max === null || adjustedRevenue < b.max)
    );

    if (bracket) {
      dealCommission = adjustedRevenue * (bracket.percent / 100);
    }

    closedWonDeals.forEach(deal => {
      if (deal.payment_terms) {
        const bonus = settings.ae_payment_term_bonuses.find((b: any) => 
          b.term.toLowerCase() === deal.payment_terms?.toLowerCase()
        );
        if (bonus) {
          dealCommission += deal.amount * (bonus.bonus_percent / 100);
        }
      }
    });
  } else if (isSDR || (isMarketing && settings.marketing_same_as_sdr)) {
    const weeklyMeetings: Record<number, any[]> = {};
    meetings.forEach(meeting => {
      const date = new Date(meeting.timestamp);
      const weekNum = getISOWeek(date);
      if (!weeklyMeetings[weekNum]) weeklyMeetings[weekNum] = [];
      weeklyMeetings[weekNum].push(meeting);
    });

    Object.entries(weeklyMeetings).forEach(([week, weekMeetings]) => {
      const meetingCount = weekMeetings.length;
      const tier = settings.sdr_meeting_tiers.find((t: any) => 
        meetingCount >= t.min && (t.max === null || meetingCount < t.max)
      );
      if (tier) {
        meetingBonus += tier.bonus_amount;
        weeklyBreakdown.push({ week: parseInt(week), meetings: meetingCount, bonus: tier.bonus_amount });
      }
    });

    dealCommission = adjustedRevenue * (settings.sdr_closed_won_percent / 100);
  } else if (isMarketing && !settings.marketing_same_as_sdr) {
    const inboundDeals = closedWonDeals.filter(d => d.deal_channel?.toLowerCase() === 'inbound');
    const inboundRevenue = inboundDeals.reduce((sum, deal) => sum + deal.amount, 0);
    
    // Apply multiplier to inbound revenue
    let adjustedInboundRevenue = inboundRevenue;
    if (settings.marketing_revenue_multiplier_brackets) {
      const multiplierBracket = settings.marketing_revenue_multiplier_brackets.find((b: any) =>
        inboundRevenue >= b.min && (b.max === null || inboundRevenue < b.max)
      );
      if (multiplierBracket) {
        adjustedInboundRevenue = inboundRevenue * multiplierBracket.multiplier;
      }
    }
    
    dealCommission = adjustedInboundRevenue * (settings.marketing_inbound_percent / 100);
  }

  return {
    repId,
    repName,
    team,
    periodStart: startDate,
    periodEnd: endDate,
    totalRevenue,
    totalCommission: dealCommission + meetingBonus,
    dealCommission,
    meetingBonus,
    totalMeetings: meetings.length,
    weeklyBreakdown,
  };
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
