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

    // Fetch deals from HubSpot
    const dealsResponse = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', {
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
                propertyName: 'closedate',
                operator: 'GTE',
                value: new Date(startDate).getTime(),
              },
              {
                propertyName: 'closedate',
                operator: 'LTE',
                value: new Date(endDate).getTime(),
              },
            ],
          },
        ],
        properties: ['amount', 'closedate', 'dealstage', 'deal_channel', 'payment_terms'],
        limit: 100,
      }),
    });

    const dealsData = await dealsResponse.json();
    const deals = dealsData.results?.map((d: any) => ({
      amount: parseFloat(d.properties.amount) || 0,
      closedate: d.properties.closedate,
      dealstage: d.properties.dealstage,
      hubspot_owner_id: repId,
      deal_channel: d.properties.deal_channel,
      payment_terms: d.properties.payment_terms,
    })) || [];

    // Fetch meetings from HubSpot
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
          properties: ['hs_meeting_start_time'],
          limit: 1000,
        }),
      }
    );

    const meetingsData = await meetingsResponse.json();
    const meetings = meetingsData.results?.map((m: any) => ({
      timestamp: new Date(parseInt(m.properties.hs_meeting_start_time)).toISOString(),
    })) || [];

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

  if (team === 'AE') {
    const bracket = settings.ae_brackets.find((b: any) => 
      totalRevenue >= b.min && (b.max === null || totalRevenue < b.max)
    );

    if (bracket) {
      dealCommission = totalRevenue * (bracket.percent / 100);
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
  } else if (team === 'SDR' || (team === 'Marketing' && settings.marketing_same_as_sdr)) {
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

    dealCommission = totalRevenue * (settings.sdr_closed_won_percent / 100);
  } else if (team === 'Marketing' && !settings.marketing_same_as_sdr) {
    const inboundDeals = closedWonDeals.filter(d => d.deal_channel?.toLowerCase() === 'inbound');
    const inboundRevenue = inboundDeals.reduce((sum, deal) => sum + deal.amount, 0);
    dealCommission = inboundRevenue * (settings.marketing_inbound_percent / 100);
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
