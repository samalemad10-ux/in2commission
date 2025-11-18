import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.83.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Fetching HubSpot owners...');

    const hubspotToken = Deno.env.get('HUBSPOT_PRIVATE_TOKEN');
    if (!hubspotToken) {
      throw new Error('HUBSPOT_PRIVATE_TOKEN not configured');
    }

    // Fetch all HubSpot owners
    const ownersResponse = await fetch('https://api.hubapi.com/crm/v3/owners/', {
      headers: {
        'Authorization': `Bearer ${hubspotToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!ownersResponse.ok) {
      const errorText = await ownersResponse.text();
      console.error('HubSpot owners fetch failed:', errorText);
      throw new Error(`Failed to fetch HubSpot owners: ${ownersResponse.status}`);
    }

    const ownersData = await ownersResponse.json();
    console.log(`Successfully fetched ${ownersData.results?.length || 0} owners`);

    // Map the owners to a simpler format
    const owners = ownersData.results.map((owner: any) => ({
      id: owner.id,
      name: `${owner.firstName} ${owner.lastName}`,
      email: owner.email,
      // You'll need to determine how to get team info from HubSpot
      // For now, we'll leave it empty and it can be set manually or fetched from a custom property
      team: owner.teams?.[0] || 'AE', // Default to AE if no team
    }));

    return new Response(
      JSON.stringify({ owners }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error fetching HubSpot owners:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
