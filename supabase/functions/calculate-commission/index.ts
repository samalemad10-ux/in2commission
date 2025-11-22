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
        properties: ['amount', 'closedate', 'dealstage', 'hubspot_owner_id', 'channel', 'payment_terms', 'sdr_sde'],
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
    let allDeals = dealsData.results?.map((d: any) => ({
      amount: parseFloat(d.properties.amount) || 0,
      closedate: d.properties.closedate,
      dealstage: d.properties.dealstage,
      hubspot_owner_id: d.properties.hubspot_owner_id,
      sdr_sde: d.properties.sdr_sde,
      channel: d.properties.channel,
      payment_terms: d.properties.payment_terms,
      assignedTo: [] as string[], // Will hold ["AE"], ["SDR"], ["Marketing"], or combinations
    })) || [];
    
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
      
      // A) SDR attribution: sdr_sde matches this SDR (by id, email, or name)
      if (normalized.sdr) {
        const sdrValue = normalized.sdr; // already lowercased/trimmed

        const matchesId =
          normalizedRepId &&
          (sdrValue === normalizedRepId || sdrValue.includes(normalizedRepId));

        const matchesEmail =
          normalizedEmail &&
          (sdrValue === normalizedEmail || sdrValue.includes(normalizedEmail));

        const matchesName =
          normalizedFullName &&
          (sdrValue === normalizedFullName || sdrValue.includes(normalizedFullName));

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
    
    if (isSDR) {
      // SDRs get credit for meetings associated with their outbound deals
      console.log(`Fetching SDR meetings for ${repName}...`);
      
      try {
        // Get SDR's outbound deals
        const sdrOutboundDeals = deals.filter(d => 
          d.assignedTo.includes('SDR') && 
          d.channel?.toLowerCase() === 'outbound'
        );
        
        console.log(`Found ${sdrOutboundDeals.length} outbound deals for SDR`);
        
        // For each deal, fetch associated meetings
        for (const deal of sdrOutboundDeals) {
          // Find the original deal record to get the deal ID
          const dealRecord = dealsData.results?.find((d: any) => 
            d.properties.hubspot_owner_id === deal.hubspot_owner_id &&
            parseFloat(d.properties.amount) === deal.amount &&
            d.properties.closedate === deal.closedate
          );
          
          if (!dealRecord) {
            console.log(`Could not find deal record for deal with owner ${deal.hubspot_owner_id}`);
            continue;
          }
          
          const dealId = dealRecord.id;
          console.log(`Fetching meetings for deal ${dealId}`);
          
          // Fetch associated meetings using associations API
          const associationsResponse = await fetch(
            `https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/meetings`,
            {
              headers: {
                'Authorization': `Bearer ${hubspotToken}`,
              },
            }
          );
          
          if (!associationsResponse.ok) {
            console.log(`Failed to fetch associations for deal ${dealId}: ${associationsResponse.status}`);
            continue;
          }
          
          const associationsData = await associationsResponse.json();
          const meetingIds = associationsData.results?.map((r: any) => r.toObjectId) || [];
          
          console.log(`Found ${meetingIds.length} associated meetings for deal ${dealId}`);
          
          // Fetch meeting details for each meeting ID
          for (const meetingId of meetingIds) {
            const meetingResponse = await fetch(
              `https://api.hubapi.com/crm/v3/objects/meetings/${meetingId}?properties=hs_meeting_start_time,hs_meeting_type,hs_meeting_outcome`,
              {
                headers: {
                  'Authorization': `Bearer ${hubspotToken}`,
                },
              }
            );
            
            if (!meetingResponse.ok) {
              console.log(`Failed to fetch meeting ${meetingId}: ${meetingResponse.status}`);
              continue;
            }
            
            const meetingData = await meetingResponse.json();
            const meetingType = meetingData.properties.hs_meeting_type?.toLowerCase() || '';
            const outcome = meetingData.properties.hs_meeting_outcome?.toLowerCase() || '';
            
            // Filter for "sales discovery meeting" with "completed" outcome
            if (meetingType.includes('sales discovery meeting') && outcome === 'completed') {
              const meetingTimestamp = parseInt(meetingData.properties.hs_meeting_start_time);
              const meetingDate = new Date(meetingTimestamp);
              
              // Check if meeting is within date range
              if (meetingDate >= new Date(startDate) && meetingDate <= new Date(endDate)) {
                meetings.push({
                  timestamp: meetingDate.toISOString(),
                  type: meetingData.properties.hs_meeting_type,
                  outcome: meetingData.properties.hs_meeting_outcome,
                  dealId: dealId,
                });
                console.log(`Added qualifying meeting ${meetingId} from deal ${dealId}`);
              }
            }
          }
        }
        
        console.log(`Total SDR meetings: ${meetings.length}`);
      } catch (error) {
        console.error('Error fetching SDR meetings:', error);
      }
    } else if (isMarketing) {
      // Marketing fetches their own meetings
      console.log(`Fetching Marketing meetings for ${repName}...`);
      
      try {
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
        meetings = (meetingsData.results || [])
          .filter((m: any) => {
            const meetingType = m.properties.hs_meeting_type?.toLowerCase() || '';
            const outcome = m.properties.hs_meeting_outcome?.toLowerCase() || '';
            return meetingType.includes('sales discovery meeting') && outcome === 'completed';
          })
          .map((m: any) => ({
            timestamp: new Date(parseInt(m.properties.hs_meeting_start_time)).toISOString(),
            type: m.properties.hs_meeting_type,
            outcome: m.properties.hs_meeting_outcome,
          }));
        
        console.log(`Marketing meetings: ${meetings.length} qualifying meetings`);
      } catch (error) {
        console.error('Error fetching Marketing meetings:', error);
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
