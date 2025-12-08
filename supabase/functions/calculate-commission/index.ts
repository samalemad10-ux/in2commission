import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { startOfWeek, format } from "https://esm.sh/date-fns@3.6.0";

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
          'dealname',
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
        dealname: p.dealname || `Deal ${d.id}`,
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
    // Debug: Log all unique sdr_owner values for closed won deals
    const closedWonForDebug = allDeals.filter((d: any) => d.dealstage === 'closedwon');
    console.log(`=== DEAL DEBUG START ===`);
    console.log(`Total closed won deals: ${closedWonForDebug.length}`);
    console.log(`Rep being matched - ID: "${normalizedRepId}", Email: "${normalizedEmail}", Name: "${normalizedFullName}"`);
    
    // Log each closed won deal's sdr_owner
    closedWonForDebug.forEach((d: any, i: number) => {
      console.log(`Closed Won Deal ${i+1}: "${d.dealname}" - sdr_owner: "${d.sdr_owner || 'EMPTY'}"`);
    });
    console.log(`=== DEAL DEBUG END ===`);
    
    allDeals.forEach((deal: any) => {
      const normalized = {
        ownerId: deal.hubspot_owner_id?.toString().trim().toLowerCase() || '',
        channel: deal.channel?.toString().trim().toLowerCase() || '',
        sdr: deal.sdr_sde?.toString().trim().toLowerCase() || '',
      };
      
      // SDR attribution - sdr_owner can be either a HubSpot owner ID (numeric) or a name/email
      if (deal.sdr_owner) {
        const sdrOwnerValue = deal.sdr_owner.toString().trim().toLowerCase();
        
        // Primary check: sdr_owner is a HubSpot owner ID (numeric) - compare directly with repId
        const matchesRepId = normalizedRepId && sdrOwnerValue === normalizedRepId;
        
        // Fallback checks: sdr_owner might be an email or name
        const matchesEmail = normalizedEmail && (sdrOwnerValue === normalizedEmail || sdrOwnerValue.includes(normalizedEmail));
        const matchesName = normalizedFullName && (sdrOwnerValue === normalizedFullName || sdrOwnerValue.includes(normalizedFullName));
        
        if (deal.dealstage === 'closedwon') {
          console.log(`MATCH CHECK: "${deal.dealname}" sdr_owner="${sdrOwnerValue}" vs repId="${normalizedRepId}" => matchesRepId=${matchesRepId}, email=${matchesEmail}, name=${matchesName}`);
        }
        
        if (matchesRepId || matchesEmail || matchesName) {
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
    
    // DEBUG: Build deals debug info - show ALL closed won deals to debug attribution
    const allClosedWonDeals = allDeals.filter((d: any) => d.dealstage === 'closedwon');
    const debugDeals = allClosedWonDeals.slice(0, 30).map((d: any) => ({
      dealName: d.dealname,
      amount: d.amount,
      closedate: d.closedate,
      sdr_owner: d.sdr_owner || '(empty)',
      channel: d.channel,
      assignedToSDR: d.assignedTo.includes('SDR') ? 'YES' : 'NO',
      matchedRep: normalizedFullName,
    }));

    // Fetch meetings from HubSpot (for SDR and Marketing teams)
    let meetings: any[] = [];
    let debugMeetings: any[] = [];
    
    if (isSDR || isMarketing) {
      console.log(`Fetching meetings for ${repName} (${team})...`);

      try {
        // First, fetch meeting properties to find the correct field names
        const propsResponse = await fetch('https://api.hubapi.com/crm/v3/properties/meetings', {
          headers: { 'Authorization': `Bearer ${hubspotToken}` },
        });
        
        if (propsResponse.ok) {
          const propsData = await propsResponse.json();
          const allPropNames = propsData.results.map((p: any) => p.name);
          console.log('All available meeting properties:', allPropNames.join(', '));
          
          const typeProps = propsData.results.filter((p: any) => 
            p.name.toLowerCase().includes('type') || p.label?.toLowerCase().includes('type')
          );
          console.log('Type-related properties:', JSON.stringify(typeProps.map((p: any) => ({ name: p.name, label: p.label })), null, 2));
        }
        
        // Step 1: Fetch ALL meetings in date range with pagination (HubSpot limit: 200)
        const allMeetingsResults: any[] = [];
        let after: string | undefined = undefined;
        let hasMore = true;
        
        while (hasMore) {
          const meetingsResponse: Response = await fetch(
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
                properties: ['hs_meeting_start_time', 'hs_activity_type', 'hs_meeting_outcome', 'hs_meeting_title', 'hs_meeting_body', 'hs_created_by', 'hubspot_owner_id', 'hs_createdate', 'hs_internal_meeting_notes'],
                limit: 200,
                ...(after && { after }),
              }),
            }
          );

          const meetingsData: any = await meetingsResponse.json();
          
          if (!meetingsResponse.ok) {
            console.error('HubSpot meetings API error:', meetingsData);
            throw new Error(`HubSpot meetings API failed: ${meetingsData.message || 'Unknown error'}`);
          }
          
          allMeetingsResults.push(...(meetingsData.results || []));
          after = meetingsData.paging?.next?.after;
          hasMore = !!after;
        }
        
        console.log(`Fetched ${allMeetingsResults.length} total raw meetings in date range`);
        
        // Log sample meeting types and outcomes for debugging
        if (allMeetingsResults.length > 0) {
          console.log('Sample meetings (first 5):');
          allMeetingsResults.slice(0, 5).forEach((m: any, i: number) => {
            console.log(`  Meeting ${i + 1}:`, {
              type: m.properties.hs_activity_type,
              outcome: m.properties.hs_meeting_outcome,
              rawStartTime: m.properties.hs_meeting_start_time,
              parsedDate: new Date(parseInt(m.properties.hs_meeting_start_time)).toISOString(),
            });
          });
          
          // Get unique meeting types and outcomes
          const types = new Set(allMeetingsResults.map((m: any) => m.properties.hs_activity_type || 'NULL'));
          const outcomes = new Set(allMeetingsResults.map((m: any) => m.properties.hs_meeting_outcome || 'NULL'));
          console.log('All unique meeting types:', Array.from(types).join(', '));
          console.log('All unique meeting outcomes:', Array.from(outcomes).join(', '));
        }

        // Filter for sales discovery + completed
        const qualifiedMeetings = allMeetingsResults.filter((m: any) => {
          const meetingType = m.properties.hs_activity_type?.toLowerCase() || '';
          const outcome = m.properties.hs_meeting_outcome?.toLowerCase() || '';
          const matches = meetingType.includes('sales') && meetingType.includes('discovery') && outcome === 'completed';
          
          if (matches) {
            const meetingDate = new Date(m.properties.hs_meeting_start_time);
            console.log(`Matched meeting: type="${m.properties.hs_activity_type}", outcome="${m.properties.hs_meeting_outcome}", date="${meetingDate.toISOString()}"`);
          }
          
          return matches;
        });

        console.log(`Qualified meetings (sales discovery + completed): ${qualifiedMeetings.length}`);

        // Track meetings attributed to THIS rep for debug
        const attributedMeetings: any[] = [];

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
            const meetingDate = new Date(meeting.properties.hs_meeting_start_time);
            const weekNum = getISOWeek(meetingDate);
            
            console.log(`Attributed meeting to ${repName}: week ${weekNum}, date=${meetingDate.toISOString()}`);
            
            meetings.push({
              timestamp: meetingDate.toISOString(),
              activity: {
                type: meeting.properties.hs_activity_type,
              },
              status: meeting.properties.hs_meeting_outcome,
            });
            
            // Track for debug output
            attributedMeetings.push(meeting);
          }
        }

        console.log(`Filtered meetings for ${repName}: ${attributedMeetings.length} out of ${qualifiedMeetings.length}`);
        console.log(`Total meetings counted for ${repName}: ${meetings.length}`);
        
        // Log weekly distribution
        const weekDistribution: Record<number, number> = {};
        meetings.forEach(m => {
          const weekNum = getISOWeek(new Date(m.timestamp));
          weekDistribution[weekNum] = (weekDistribution[weekNum] || 0) + 1;
        });
        console.log(`Weekly meeting distribution for ${repName}:`, JSON.stringify(weekDistribution));
        
        // DEBUG: Build detailed meeting info for THIS rep's attributed meetings (limit to 20)
        const meetingsToDebug = attributedMeetings.slice(0, 20);
        console.log(`Building debug info for ${meetingsToDebug.length} of ${attributedMeetings.length} attributed meetings`);
        
        for (const m of meetingsToDebug) {
          const meetingId = m.id;
          
          // Fetch associated deals with MRR
          let associatedDeals: string[] = [];
          try {
            const dealsResp = await fetch(
              `https://api.hubapi.com/crm/v4/objects/meetings/${meetingId}/associations/deals`,
              { headers: { Authorization: `Bearer ${hubspotToken}` } }
            );
            if (dealsResp.ok) {
              const dealsData = await dealsResp.json();
              const dealIds = dealsData.results?.map((r: any) => r.toObjectId) || [];
              for (const dealId of dealIds) {
                const dealResp = await fetch(
                  `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=dealname,hs_mrr,amount`,
                  { headers: { Authorization: `Bearer ${hubspotToken}` } }
                );
                if (dealResp.ok) {
                  const dealData = await dealResp.json();
                  const mrr = dealData.properties.hs_mrr || dealData.properties.amount || '0';
                  associatedDeals.push(`${dealData.properties.dealname || `Deal ${dealId}`} (MRR: $${mrr})`);
                }
              }
            }
          } catch (e) { console.error('Error fetching deal associations:', e); }
          
          // Fetch associated contacts
          let associatedContacts: string[] = [];
          try {
            const contactsResp = await fetch(
              `https://api.hubapi.com/crm/v4/objects/meetings/${meetingId}/associations/contacts`,
              { headers: { Authorization: `Bearer ${hubspotToken}` } }
            );
            if (contactsResp.ok) {
              const contactsData = await contactsResp.json();
              const contactIds = contactsData.results?.map((r: any) => r.toObjectId) || [];
              for (const contactId of contactIds) {
                const contactResp = await fetch(
                  `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email`,
                  { headers: { Authorization: `Bearer ${hubspotToken}` } }
                );
                if (contactResp.ok) {
                  const contactData = await contactResp.json();
                  const name = `${contactData.properties.firstname || ''} ${contactData.properties.lastname || ''}`.trim();
                  associatedContacts.push(name || contactData.properties.email || `Contact ${contactId}`);
                }
              }
            }
          } catch (e) { console.error('Error fetching contact associations:', e); }
          
          // Get owner name
          let createdByName = m.properties.hs_created_by || '';
          if (m.properties.hubspot_owner_id) {
            try {
              const ownerResp = await fetch(
                `https://api.hubapi.com/crm/v3/owners/${m.properties.hubspot_owner_id}`,
                { headers: { Authorization: `Bearer ${hubspotToken}` } }
              );
              if (ownerResp.ok) {
                const ownerData = await ownerResp.json();
                createdByName = `${ownerData.firstName || ''} ${ownerData.lastName || ''}`.trim() || ownerData.email || createdByName;
              }
            } catch (e) {}
          }
          
          debugMeetings.push({
            meetingId,
            timestamp: new Date(m.properties.hs_meeting_start_time).toISOString(),
            meetingName: m.properties.hs_meeting_title || m.properties.hs_meeting_body || "(no name)",
            activityType: m.properties.hs_activity_type,
            status: m.properties.hs_meeting_outcome,
            createdBy: createdByName,
            associatedDeals,
            associatedContacts,
            allProperties: m.properties
          });
        }
        
        console.log(`DEBUG — ${repName}'s meetings:`, JSON.stringify(debugMeetings.slice(0, 3), null, 2));
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

    return new Response(JSON.stringify({ ...result, debugMeetings, debugDeals }), {
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
    // Filter meetings first - only completed discovery meetings
    const filteredMeetings = meetings.filter(m => {
      const isCompleted = m.status?.toLowerCase() === "completed";
      const isDiscovery =
        m.activity?.type?.toLowerCase().includes("sales discovery") ||
        m.activity?.type?.toLowerCase().includes("discovery");
      return isCompleted && isDiscovery;
    });

    console.log(`Filtered meetings for ${repName}: ${filteredMeetings.length} out of ${meetings.length}`);

    // Group meetings by real week start (Monday)
    const weeklyMeetings: Record<string, any[]> = {};

    filteredMeetings.forEach(meeting => {
      const date = new Date(meeting.timestamp);
      const weekStart = startOfWeek(date, { weekStartsOn: 1 });
      const weekKey = format(weekStart, "yyyy-MM-dd");

      if (!weeklyMeetings[weekKey]) {
        weeklyMeetings[weekKey] = [];
      }
      weeklyMeetings[weekKey].push(meeting);
    });

    // Calculate weekly bonuses
    console.log('SDR Meeting Tiers:', JSON.stringify(settings.sdr_meeting_tiers));
    
    Object.entries(weeklyMeetings).forEach(([weekKey, weekMeetings]) => {
      const meetingCount = weekMeetings.length;
      console.log(`Week ${weekKey}: ${meetingCount} meetings`);

      const tier = settings.sdr_meeting_tiers.find((t: any) =>
        meetingCount >= t.min && (t.max === null || meetingCount <= t.max)
      );
      console.log(`Found tier for week ${weekKey}:`, tier ? JSON.stringify(tier) : 'NO TIER FOUND');

      let weekBonus = 0;
      if (tier) {
        weekBonus = meetingCount * tier.bonus_amount;
        console.log(`Week ${weekKey} bonus calculation: ${meetingCount} × ${tier.bonus_amount} = ${weekBonus}`);
        meetingBonus += weekBonus;
      }

      // Month & week label logic
      const weekStartDate = new Date(weekKey);
      const monthName = format(weekStartDate, "MMMM");
      const weekNumber = Math.floor((weekStartDate.getDate() - 1) / 7) + 1;
      const weekLabel = `${monthName} Week ${weekNumber}`;

      weeklyBreakdown.push({
        week: weekNumber,
        weekLabel,
        meetings: meetingCount,
        bonus: weekBonus
      });
    });
    
    console.log('Total meeting bonus:', meetingBonus);
    console.log('Weekly breakdown:', JSON.stringify(weeklyBreakdown));

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
    totalMeetings: meetings.filter(m => {
      const isCompleted = m.status?.toLowerCase() === "completed";
      const isDiscovery =
        m.activity?.type?.toLowerCase().includes("sales discovery") ||
        m.activity?.type?.toLowerCase().includes("discovery");
      return isCompleted && isDiscovery;
    }).length,
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
