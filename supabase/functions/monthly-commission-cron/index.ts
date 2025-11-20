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
    console.log('Starting monthly commission run...');

    const hubspotToken = Deno.env.get('HUBSPOT_PRIVATE_TOKEN');
    if (!hubspotToken) {
      throw new Error('HubSpot token not configured');
    }

    // Calculate previous month
    const now = new Date();
    const firstDayPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const startDate = firstDayPrevMonth.toISOString();
    const endDate = lastDayPrevMonth.toISOString();

    console.log(`Processing period: ${startDate} to ${endDate}`);

    // Fetch all HubSpot owners
    const ownersResponse = await fetch('https://api.hubapi.com/crm/v3/owners/', {
      headers: {
        'Authorization': `Bearer ${hubspotToken}`,
      },
    });

    const ownersData = await ownersResponse.json();
    const owners = ownersData.results || [];

    console.log(`Found ${owners.length} owners to process`);

    // Fetch settings
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const settingsResponse = await fetch(`${supabaseUrl}/rest/v1/commission_settings?select=*&limit=1`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    });

    const settings = (await settingsResponse.json())[0];

    // Process each owner
    const results = [];
    for (const owner of owners) {
      try {
        console.log(`Processing owner: ${owner.email}`);

        // Determine team (this would need to be customized based on your HubSpot setup)
        const team = owner.teams?.[0]?.name || 'AE'; // Default to AE if team not found
        
        // Normalize team name for comparison
        const teamLower = team.toLowerCase();
        const isAE = teamLower.includes('ae');
        const isSDR = teamLower.includes('sdr');
        const isMarketing = teamLower.includes('marketing');
        
        console.log(`Owner ${owner.email} - Team: ${team} (isAE: ${isAE}, isSDR: ${isSDR}, isMarketing: ${isMarketing})`);

        // For SDR, we already have owner details from the owners list
        const ownerEmail = owner.email;
        const ownerFullName = `${owner.firstName} ${owner.lastName}`;

        // Fetch deals with date filters only - we'll filter by team after
        let dealFilters: any[] = [
          {
            propertyName: 'closedate',
            operator: 'GTE',
            value: firstDayPrevMonth.getTime(),
          },
          {
            propertyName: 'closedate',
            operator: 'LTE',
            value: lastDayPrevMonth.getTime(),
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
        console.log(`Fetched ${dealsData.results?.length || 0} raw deals for ${owner.email} (${team})`);
        
        // Step 1: Map all deals with properties (no classification)
        let deals = dealsData.results?.map((d: any) => ({
          amount: parseFloat(d.properties.amount) || 0,
          closedate: d.properties.closedate,
          dealstage: d.properties.dealstage,
          hubspot_owner_id: d.properties.hubspot_owner_id,
          sdr_owner: d.properties.sdr_owner,
          deal_channel: d.properties.deal_channel,
          payment_terms: d.properties.payment_terms,
        })) || [];
        
        console.log(`Fetched ${deals.length} deals for ${owner.email}`);
        
        // Step 2: Filter deals independently based on team criteria
        const normalizedRepId = owner.id?.toString().trim().toLowerCase() || '';
        const normalizedEmail = ownerEmail?.toString().trim().toLowerCase() || '';
        const normalizedFullName = ownerFullName?.toString().trim().toLowerCase() || '';
        
        if (isAE) {
          console.log(`Filtering AE deals for repId: ${normalizedRepId}`);
          deals = deals.filter((d: any) => {
            const ownerId = d.hubspot_owner_id?.toString().trim().toLowerCase() || '';
            const match = ownerId === normalizedRepId;
            if (match) {
              console.log(`AE match: deal hubspot_owner_id=${ownerId}, amount=${d.amount}`);
            }
            return match;
          });
          console.log(`After AE filter: ${deals.length} deals for ${owner.email}`);
        } else if (isSDR) {
          console.log(`Filtering SDR deals. Looking for sdr_owner matching: email=${normalizedEmail}, fullName=${normalizedFullName}, id=${normalizedRepId}`);
          deals = deals.filter((d: any) => {
            const sdrOwner = d.sdr_owner?.toString().trim().toLowerCase() || '';
            if (!sdrOwner) return false;
            
            const emailMatch = sdrOwner === normalizedEmail;
            const nameMatch = sdrOwner === normalizedFullName;
            const idMatch = sdrOwner === normalizedRepId;
            
            if (emailMatch) {
              console.log(`SDR match by email: ${sdrOwner}, amount=${d.amount}`);
            } else if (nameMatch) {
              console.log(`SDR match by full name: ${sdrOwner}, amount=${d.amount}`);
            } else if (idMatch) {
              console.log(`SDR match by id: ${sdrOwner}, amount=${d.amount}`);
            }
            
            return emailMatch || nameMatch || idMatch;
          });
          console.log(`After SDR filter: ${deals.length} deals for ${owner.email}`);
        } else if (isMarketing) {
          console.log(`Filtering Marketing deals. Looking for deal_channel=inbound`);
          deals = deals.filter((d: any) => {
            const channel = d.deal_channel?.toString().trim().toLowerCase() || '';
            const match = channel === 'inbound';
            if (match) {
              console.log(`Marketing match: deal_channel=${channel}, amount=${d.amount}`);
            }
            return match;
          });
          console.log(`After Marketing filter: ${deals.length} deals for ${owner.email}`);
        }
        
        console.log(`Final: Team=${team}, OwnerID=${owner.id}, Deals=${deals.length}`);

        // Fetch meetings (only for SDR team)
        let meetings: any[] = [];
        if (isSDR) {
          const meetingsResponse = await fetch('https://api.hubapi.com/crm/v3/objects/meetings/search', {
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
                      value: owner.id,
                    },
                    {
                      propertyName: 'hs_meeting_start_time',
                      operator: 'GTE',
                      value: firstDayPrevMonth.getTime(),
                    },
                    {
                      propertyName: 'hs_meeting_start_time',
                      operator: 'LTE',
                      value: lastDayPrevMonth.getTime(),
                    },
                  ],
                },
              ],
              properties: ['hs_meeting_start_time', 'hs_meeting_type', 'hs_meeting_outcome'],
              limit: 1000,
            }),
          });

          const meetingsData = await meetingsResponse.json();
          console.log(`Fetched ${meetingsData.results?.length || 0} raw meetings for ${ownerFullName}`);
          
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

        // Calculate commission
        const commissionResult = calculateCommission(
          owner.id,
          owner.email,
          team,
          deals,
          meetings,
          settings,
          startDate,
          endDate
        );

        // Write back to HubSpot
        await fetch('https://api.hubapi.com/crm/v3/objects/commission_statement', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hubspotToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: {
              deals_commission: commissionResult.totalCommission,
              deals_rate_applied: commissionResult.usedBracketPercent || 0,
              deals_total_amount: commissionResult.totalRevenue,
              channel: commissionResult.team,
              total_meetings: commissionResult.totalMeetings,
            },
          }),
        });

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
            rep_id: owner.id,
            rep_name: owner.email,
            team,
            period_start: startDate,
            period_end: endDate,
            commission_json: commissionResult,
            success: true,
          }),
        });

        results.push({ owner: owner.email, status: 'success' });
      } catch (error: any) {
        console.error(`Error processing owner ${owner.email}:`, error);

        // Log error to database
        await fetch(`${supabaseUrl}/rest/v1/commission_run_logs`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({
            rep_id: owner.id,
            rep_name: owner.email,
            team: 'Unknown',
            period_start: startDate,
            period_end: endDate,
            commission_json: {},
            success: false,
            error_message: error.message,
          }),
        });

        results.push({ owner: owner.email, status: 'error', error: error.message });
      }
    }

    console.log('Monthly commission run completed');

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error in monthly commission cron:', error);
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

  const teamLower = team.toLowerCase();
  const isAE = teamLower.includes('ae');
  const isSDR = teamLower.includes('sdr');
  const isMarketing = teamLower.includes('marketing');

  // Apply revenue multiplier based on team
  let adjustedRevenue = totalRevenue;
  if (isAE && settings.ae_revenue_multiplier_brackets) {
    const multiplierBracket = settings.ae_revenue_multiplier_brackets.find((b: any) =>
      totalRevenue >= b.min && (b.max === null || totalRevenue < b.max)
    );
    if (multiplierBracket) {
      adjustedRevenue = totalRevenue * multiplierBracket.multiplier;
    }
  } else if (isSDR && settings.sdr_revenue_multiplier_brackets) {
    const multiplierBracket = settings.sdr_revenue_multiplier_brackets.find((b: any) =>
      totalRevenue >= b.min && (b.max === null || totalRevenue < b.max)
    );
    if (multiplierBracket) {
      adjustedRevenue = totalRevenue * multiplierBracket.multiplier;
    }
  } else if (isMarketing && settings.marketing_revenue_multiplier_brackets) {
    const multiplierBracket = settings.marketing_revenue_multiplier_brackets.find((b: any) =>
      totalRevenue >= b.min && (b.max === null || totalRevenue < b.max)
    );
    if (multiplierBracket) {
      adjustedRevenue = totalRevenue * multiplierBracket.multiplier;
    }
  }

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

  let usedBracketPercent: number | undefined;

  if (team === 'AE') {
    const bracket = settings.ae_brackets.find((b: any) => 
      totalRevenue >= b.min && (b.max === null || totalRevenue < b.max)
    );
    if (bracket) {
      usedBracketPercent = bracket.percent;
    }
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
    usedBracketPercent,
  };
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
