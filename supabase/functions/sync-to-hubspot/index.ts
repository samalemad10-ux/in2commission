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
    const commissionResult = await req.json();

    const hubspotToken = Deno.env.get('HUBSPOT_PRIVATE_TOKEN');
    if (!hubspotToken) {
      throw new Error('HubSpot token not configured');
    }

    // Prepare commission data for HubSpot
    const recordData = {
      properties: {
        deals_commission: commissionResult.totalCommission.toString(),
        deals_rate_applied: (commissionResult.usedBracketPercent || 0).toString(),
        deals_total_amount: commissionResult.totalRevenue.toString(),
        channel: commissionResult.team,
        total_meetings: commissionResult.totalMeetings.toString(),
        period_start: commissionResult.periodStart,
        period_end: commissionResult.periodEnd,
        rep_name: commissionResult.repName,
        rep_id: commissionResult.repId,
        deal_commission: commissionResult.dealCommission.toString(),
        meeting_bonus: commissionResult.meetingBonus.toString(),
      },
    };

    console.log('Syncing to HubSpot:', recordData);

    // Sync to HubSpot custom object (Commission Statements)
    const response = await fetch('https://api.hubapi.com/crm/v3/objects/2-49027397', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hubspotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(recordData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('HubSpot API error:', errorText);
      throw new Error(`HubSpot API error: ${response.status}`);
    }

    const result = await response.json();

    console.log('Successfully created commission record in HubSpot:', result.id);

    return new Response(JSON.stringify({ success: true, recordId: result.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error syncing to HubSpot:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
