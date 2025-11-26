import { format, startOfWeek, endOfWeek, getISOWeek } from 'date-fns';

export interface CommissionSettings {
  ae_brackets: { min: number; max: number | null; percent: number }[];
  ae_payment_term_bonuses: { term: string; bonus_percent: number }[];
  ae_revenue_multiplier_brackets: { min: number; max: number | null; multiplier: number }[];
  sdr_meeting_tiers: { min: number; max: number | null; rate_per_meeting: number }[];
  sdr_closed_won_percent: number;
  sdr_revenue_multiplier_brackets: { min: number; max: number | null; multiplier: number }[];
  marketing_same_as_sdr: boolean;
  marketing_inbound_percent: number;
  marketing_revenue_multiplier_brackets: { min: number; max: number | null; multiplier: number }[];
}

export interface Deal {
  amount: number;
  closedate: string;
  dealstage: string;
  hubspot_owner_id: string;
  deal_channel?: string;
  payment_terms?: string;
}

export interface Meeting {
  timestamp: string;
}

export interface CommissionResult {
  repId: string;
  repName: string;
  team: 'AE' | 'SDR' | 'Marketing';
  periodStart: string;
  periodEnd: string;
  totalRevenue: number;
  totalCommission: number;
  dealCommission: number;
  meetingBonus: number;
  totalMeetings: number;
  weeklyBreakdown?: { week: number; meetings: number; bonus: number }[];
  usedBracketPercent?: number;
  usedPaymentTermBonuses?: { term: string; amount: number }[];
}

export function calculateCommission(
  repId: string,
  repName: string,
  team: 'AE' | 'SDR' | 'Marketing',
  deals: Deal[],
  meetings: Meeting[],
  settings: CommissionSettings
): CommissionResult {
  let totalRevenue = 0;
  let dealCommission = 0;
  let meetingBonus = 0;
  let totalMeetings = meetings.length;
  let weeklyBreakdown: { week: number; meetings: number; bonus: number }[] = [];
  let usedBracketPercent: number | undefined;
  let usedPaymentTermBonuses: { term: string; amount: number }[] = [];

  // Filter closed won deals
  const closedWonDeals = deals.filter(d => 
    d.dealstage?.toLowerCase().includes('closed') && 
    d.dealstage?.toLowerCase().includes('won')
  );

  totalRevenue = closedWonDeals.reduce((sum, deal) => sum + (deal.amount || 0), 0);

  // Apply revenue multiplier based on team
  let adjustedRevenue = totalRevenue;
  if (team === 'AE' && settings.ae_revenue_multiplier_brackets) {
    const multiplierBracket = settings.ae_revenue_multiplier_brackets.find(b =>
      totalRevenue >= b.min && (b.max === null || totalRevenue < b.max)
    );
    if (multiplierBracket) {
      adjustedRevenue = totalRevenue * multiplierBracket.multiplier;
    }
  } else if (team === 'SDR' && settings.sdr_revenue_multiplier_brackets) {
    const multiplierBracket = settings.sdr_revenue_multiplier_brackets.find(b =>
      totalRevenue >= b.min && (b.max === null || totalRevenue < b.max)
    );
    if (multiplierBracket) {
      adjustedRevenue = totalRevenue * multiplierBracket.multiplier;
    }
  } else if (team === 'Marketing' && settings.marketing_revenue_multiplier_brackets) {
    const multiplierBracket = settings.marketing_revenue_multiplier_brackets.find(b =>
      totalRevenue >= b.min && (b.max === null || totalRevenue < b.max)
    );
    if (multiplierBracket) {
      adjustedRevenue = totalRevenue * multiplierBracket.multiplier;
    }
  }

  if (team === 'AE') {
    // AE Logic: Monthly commission based on brackets
    const bracket = settings.ae_brackets.find(b => 
      adjustedRevenue >= b.min && (b.max === null || adjustedRevenue < b.max)
    );

    if (bracket) {
      usedBracketPercent = bracket.percent;
      dealCommission = adjustedRevenue * (bracket.percent / 100);
    }

    // Apply payment term bonuses
    closedWonDeals.forEach(deal => {
      if (deal.payment_terms) {
        const bonus = settings.ae_payment_term_bonuses.find(b => 
          b.term.toLowerCase() === deal.payment_terms?.toLowerCase()
        );
        if (bonus) {
          const bonusAmount = deal.amount * (bonus.bonus_percent / 100);
          dealCommission += bonusAmount;
          usedPaymentTermBonuses.push({ term: bonus.term, amount: bonusAmount });
        }
      }
    });

  } else if (team === 'SDR' || (team === 'Marketing' && settings.marketing_same_as_sdr)) {
    // SDR Logic or Marketing using SDR logic
    
    // Group meetings by ISO week
    const weeklyMeetings: Record<number, Meeting[]> = {};
    meetings.forEach(meeting => {
      const date = new Date(meeting.timestamp);
      const weekNum = getISOWeek(date);
      if (!weeklyMeetings[weekNum]) {
        weeklyMeetings[weekNum] = [];
      }
      weeklyMeetings[weekNum].push(meeting);
    });

    // Calculate weekly bonuses using multiplier
    Object.entries(weeklyMeetings).forEach(([week, weekMeetings]) => {
      const meetingCount = weekMeetings.length;
      const tier = settings.sdr_meeting_tiers.find(t => 
        meetingCount >= t.min && (t.max === null || meetingCount < t.max)
      );
      if (tier) {
        const weekBonus = meetingCount * tier.rate_per_meeting;
        meetingBonus += weekBonus;
        weeklyBreakdown.push({
          week: parseInt(week),
          meetings: meetingCount,
          bonus: weekBonus
        });
      }
    });

    // Monthly closed won bonus (use adjusted revenue)
    const closedWonBonus = adjustedRevenue * (settings.sdr_closed_won_percent / 100);
    dealCommission = closedWonBonus;

  } else if (team === 'Marketing' && !settings.marketing_same_as_sdr) {
    // Marketing with inbound logic
    const inboundDeals = closedWonDeals.filter(d => 
      d.deal_channel?.toLowerCase() === 'inbound'
    );
    const inboundRevenue = inboundDeals.reduce((sum, deal) => sum + (deal.amount || 0), 0);
    
    // Apply multiplier to inbound revenue
    let adjustedInboundRevenue = inboundRevenue;
    if (settings.marketing_revenue_multiplier_brackets) {
      const multiplierBracket = settings.marketing_revenue_multiplier_brackets.find(b =>
        inboundRevenue >= b.min && (b.max === null || inboundRevenue < b.max)
      );
      if (multiplierBracket) {
        adjustedInboundRevenue = inboundRevenue * multiplierBracket.multiplier;
      }
    }
    
    dealCommission = adjustedInboundRevenue * (settings.marketing_inbound_percent / 100);
  }

  const totalCommission = dealCommission + meetingBonus;

  return {
    repId,
    repName,
    team,
    periodStart: '', // Set by caller
    periodEnd: '', // Set by caller
    totalRevenue,
    totalCommission,
    dealCommission,
    meetingBonus,
    totalMeetings,
    weeklyBreakdown,
    usedBracketPercent,
    usedPaymentTermBonuses
  };
}
