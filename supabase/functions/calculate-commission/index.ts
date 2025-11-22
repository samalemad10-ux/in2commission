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

    // Fetch all available deal properties to find the SDR field
    console.log('Fetching all HubSpot deal properties...');
    const propsResponse = await fetch('https://api.hubapi.com/crm/v3/properties/deals', {
      headers: {
        'Authorization': `Bearer ${hubspotToken}`,
      },
    });
    
    if (propsResponse.ok) {
      const propsData = await propsResponse.json();
      const allPropNames = propsData.results.map((p: any) => p.name);
      console.log('All available deal properties:', allPropNames.join(', '));
      
      // Find SDR-related properties
      const sdrProps = propsData.results.filter((p: any) => 
        p.name.toLowerCase().includes('sdr') || 
        p.label?.toLowerCase().includes('sdr')
      );
      console.log('SDR-related properties found:', JSON.stringify(sdrProps.map((p: any) => ({ name: p.name, label: p.label })), null, 2));
    }

    // For SDR, fetch owner details from HubSpot to get email and name variations
    let ownerEmail = '';
    let ownerFullName = '';
    const teamLowerCheck = team.toLowerCase();
    if (teamLowerCheck.includes('sdr')) {
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
        properties: [
          'amount',
          'closedate',
          'dealstage',
          'hubspot_owner_id',
          'channel',
          'deal_channel',
          'payment_terms',
          'sdr_owner',
          'sdr_sde',
        ],
        limit: 100,
      }),
    });

    const dealsData = await dealsResponse.json();
    console.log(`Fetched ${dealsData.results?.length || 0} raw deals for ${repName} (${team})`);
    
    // Log deal details for debugging
    if (dealsData.results && dealsData.results.length > 0) {
      console.log('Sample deal properties:', JSON.stringify(dealsData.results[0].properties, null, 2));
      console.log('Available deal property names:', Object.keys(dealsData.results[0].properties).join(', '));
      
      // Check if sdr_sde exists
      const hasSdrOwner = dealsData.results.some((d: any) => d.properties.sdr_sde);
      console.log(`Deals with sdr_sde field populated: ${hasSdrOwner ? 'YES' : 'NO'}`);
      
      // Log first 3 deals' sdr_sde values
      dealsData.results.slice(0, 3).forEach((d: any, i: number) => {
        console.log(`Deal ${i + 1} sdr_sde value: ${d.properties.sdr_sde || 'NULL/EMPTY'}`);
      });
    }
    
    // Step 1: Map all deals with properties (no pre-filtering)
    let allDeals = dealsData.results?.map((d: any) => {
      const p = d.properties;

      const sdrOwner =
        (p.sdr_owner ?? p.sdr_sde ?? "").toString().trim();

      const channel =
        (p.channel ?? p.deal_channel ?? "").toString().trim();

      return {
        id: d.id,
        amount: parseFloat(p.amount) || 0,
        closedate: p.closedate,
        dealstage: p.dealstage,
        hubspot_owner_id: p.hubspot_owner_id,
        sdr_owner: sdrOwner,
        channel,
        payment_terms: p.payment_terms,
        assignedTo: [],
      };
    }) || [];
    
    console.log(`Fetched ${allDeals.length} total deals for classification`);
    
    // Log channel values for debugging
    const channelCounts = allDeals.reduce((acc: any, deal: any) => {
      const ch = deal.channel || 'NULL/EMPTY';
      acc[ch] = (acc[ch] || 0) + 1;
      return acc;
    }, {});
    console.log('Channel distribution:', JSON.stringify(channelCounts));
    
    // Step 2: Normalize identifiers for matching
    const normalizedRepId = repId?.toString().trim().toLowerCase() || '';
    const normalizedEmail = ownerEmail?.toString().trim().toLowerCase() || '';
    const normalizedFullName = ownerFullName?.toString().trim().toLowerCase() || '';
    
    // Step 3: Classify each deal using attribution rules
    allDeals.forEach((deal: any) => {
      const normalized = {
        ownerId: deal.hubspot_owner_id?.toString().trim().toLowerCase() || '',
        channel: deal.channel?.toString().trim().toLowerCase() || '',
        sdr: deal.sdr_sde?.toString().trim().toLowerCase() || '',
      };
      
      // SDR attribution
      if (deal.sdr_owner) {
        const sdr = deal.sdr_owner.toLowerCase();
        const matchesId = normalizedRepId && (sdr === normalizedRepId || sdr.includes(normalizedRepId));
        const matchesEmail = normalizedEmail && (sdr === normalizedEmail || sdr.includes(normalizedEmail));
        const matchesName = normalizedFullName && (sdr === normalizedFullName || sdr.includes(normalizedFullName));
        if (matchesId || matchesEmail || matchesName) {
          deal.assignedTo.push("SDR");
        }
      }
      
      // B) AE attribution: hubspot_owner_id matches rep ID
      if (isAE && normalized.ownerId === normalizedRepId) {
        deal.assignedTo.push('AE');
      }
      
      // C) Marketing attribution: inbound channel with no SDR
      if (isMarketing && !normalized.sdr && (normalized.channel === 'inbound' || normalized.channel.includes('inbound'))) {
        deal.assignedTo.push('Marketing');
      }
    });
    
    // Step 4: Filter deals based on team
    let deals: any[] = [];
    if (isAE) {
      deals = allDeals.filter((d: any) => d.assignedTo.includes('AE'));
      console.log(`AE filter: ${deals.length} deals assigned to AE`);
    } else if (isSDR) {
      deals = allDeals.filter((d: any) => d.assignedTo.includes('SDR'));
      console.log(`SDR filter: ${deals.length} deals assigned to SDR`);
    } else if (isMarketing) {
      deals = allDeals.filter((d: any) => d.assignedTo.includes('Marketing'));
      console.log(`Marketing filter: ${deals.length} deals assigned to Marketing`);
    }
    
    console.log(`Final: Team=${team}, RepID=${repId}, Deals=${deals.length}`);

    // Fetch meetings from HubSpot (for SDR and Marketing teams)
    let meetings: any[] = [];
    
    if (isSDR || isMarketing) {
      console.log(`Fetching meetings for ${repName} (${team})...`);

      try {
        // Step 1: Fetch ALL meetings in date range that are "sales discovery meeting" + "completed"
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
        console.log(`Fetched ${meetingsData.results?.length || 0} raw meetings in date range`);

        // Filter for sales discovery + completed
        const qualifiedMeetings = (meetingsData.results || []).filter((m: any) => {
          const meetingType = m.properties.hs_meeting_type?.toLowerCase() || '';
          const outcome = m.properties.hs_meeting_outcome?.toLowerCase() || '';
          return meetingType.includes('sales') && meetingType.includes('discovery') && outcome === 'completed';
        });

        console.log(`Qualified meetings (sales discovery + completed): ${qualifiedMeetings.length}`);

        // Step 2: For each meeting, get associated deals and check sdr_owner
        for (const meeting of qualifiedMeetings) {
          const meetingId = meeting.id;
          
          // Get associated deals for this meeting
          const dealsAssocResp = await fetch(
            `https://api.hubapi.com/crm/v4/objects/meetings/${meetingId}/associations/deals`,
            { headers: { Authorization: `Bearer ${hubspotToken}` } }
          );

          if (!dealsAssocResp.ok) continue;

          const dealsAssocData = await dealsAssocResp.json();
          const dealIds = dealsAssocData.results?.map((r: any) => r.toObjectId) || [];

          if (dealIds.length === 0) continue;

          // Step 3: Check sdr_owner on each associated deal
          let assignedToRep = false;

          for (const dealId of dealIds) {
            const dealResp = await fetch(
              `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=sdr_owner,sdr_sde`,
              { headers: { Authorization: `Bearer ${hubspotToken}` } }
            );

            if (!dealResp.ok) continue;

            const dealData = await dealResp.json();
            const sdrOwner = (dealData.properties.sdr_owner ?? dealData.properties.sdr_sde ?? "").toString().trim();

            // Step 4: Attribution logic
            if (isSDR && sdrOwner) {
              // Check if this SDR matches
              const sdr = sdrOwner.toLowerCase();
              const matchesId = normalizedRepId && (sdr === normalizedRepId || sdr.includes(normalizedRepId));
              const matchesEmail = normalizedEmail && (sdr === normalizedEmail || sdr.includes(normalizedEmail));
              const matchesName = normalizedFullName && (sdr === normalizedFullName || sdr.includes(normalizedFullName));
              
              if (matchesId || matchesEmail || matchesName) {
                assignedToRep = true;
                break;
              }
            } else if (isMarketing && !sdrOwner) {
              // Marketing gets credit when sdr_owner is empty
              assignedToRep = true;
              break;
            }
          }

          // Add meeting to this rep's list if assigned
          if (assignedToRep) {
            const ts = parseInt(meeting.properties.hs_meeting_start_time);
            meetings.push({
              timestamp: new Date(ts).toISOString(),
              type: meeting.properties.hs_meeting_type,
              outcome: meeting.properties.hs_meeting_outcome,
            });
          }
        }

        console.log(`Total meetings counted for ${repName}: ${meetings.length}`);
      } catch (err) {
        console.error("Meeting attribution error:", err);
      }
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
    const inboundDeals = closedWonDeals.filter(d => d.channel?.toLowerCase() === 'inbound');
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
