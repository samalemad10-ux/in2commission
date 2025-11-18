import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import Layout from "@/components/Layout";

export default function Settings() {
  const queryClient = useQueryClient();
  
  const { data: settings, isLoading } = useQuery({
    queryKey: ["commission-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("commission_settings")
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
  });

  const [aeBrackets, setAeBrackets] = useState<any[]>([]);
  const [aePaymentBonuses, setAePaymentBonuses] = useState<any[]>([]);
  const [aeRevenueMultipliers, setAeRevenueMultipliers] = useState<any[]>([]);
  const [sdrMeetingTiers, setSdrMeetingTiers] = useState<any[]>([]);
  const [sdrClosedWonPercent, setSdrClosedWonPercent] = useState(0);
  const [sdrRevenueMultipliers, setSdrRevenueMultipliers] = useState<any[]>([]);
  const [marketingSameAsSdr, setMarketingSameAsSdr] = useState(true);
  const [marketingInboundPercent, setMarketingInboundPercent] = useState(0);
  const [marketingRevenueMultipliers, setMarketingRevenueMultipliers] = useState<any[]>([]);

  useEffect(() => {
    if (settings) {
      setAeBrackets(Array.isArray(settings.ae_brackets) ? settings.ae_brackets : []);
      setAePaymentBonuses(Array.isArray(settings.ae_payment_term_bonuses) ? settings.ae_payment_term_bonuses : []);
      setAeRevenueMultipliers(Array.isArray(settings.ae_revenue_multiplier_brackets) ? settings.ae_revenue_multiplier_brackets : []);
      setSdrMeetingTiers(Array.isArray(settings.sdr_meeting_tiers) ? settings.sdr_meeting_tiers : []);
      setSdrClosedWonPercent(Number(settings.sdr_closed_won_percent) || 0);
      setSdrRevenueMultipliers(Array.isArray(settings.sdr_revenue_multiplier_brackets) ? settings.sdr_revenue_multiplier_brackets : []);
      setMarketingSameAsSdr(settings.marketing_same_as_sdr !== false);
      setMarketingInboundPercent(Number(settings.marketing_inbound_percent) || 0);
      setMarketingRevenueMultipliers(Array.isArray(settings.marketing_revenue_multiplier_brackets) ? settings.marketing_revenue_multiplier_brackets : []);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("commission_settings")
        .update({
          ae_brackets: aeBrackets,
          ae_payment_term_bonuses: aePaymentBonuses,
          ae_revenue_multiplier_brackets: aeRevenueMultipliers,
          sdr_meeting_tiers: sdrMeetingTiers,
          sdr_closed_won_percent: sdrClosedWonPercent,
          sdr_revenue_multiplier_brackets: sdrRevenueMultipliers,
          marketing_same_as_sdr: marketingSameAsSdr,
          marketing_inbound_percent: marketingInboundPercent,
          marketing_revenue_multiplier_brackets: marketingRevenueMultipliers,
        })
        .eq("id", settings?.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commission-settings"] });
      toast.success("Settings saved successfully");
    },
    onError: () => {
      toast.error("Failed to save settings");
    },
  });

  if (isLoading) {
    return (
      <Layout>
        <div>Loading...</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold text-foreground">Commission Settings</h2>
          <p className="mt-2 text-muted-foreground">Configure commission rules and rates</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>AE Revenue Brackets</CardTitle>
            <CardDescription>Define revenue thresholds and commission percentages</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {aeBrackets.map((bracket, idx) => (
              <div key={idx} className="flex gap-4 items-end">
                <div className="flex-1">
                  <Label>Min Amount ($)</Label>
                  <Input
                    type="number"
                    value={bracket.min}
                    onChange={(e) => {
                      const newBrackets = [...aeBrackets];
                      newBrackets[idx].min = parseFloat(e.target.value);
                      setAeBrackets(newBrackets);
                    }}
                  />
                </div>
                <div className="flex-1">
                  <Label>Max Amount ($) - Leave 0 for unlimited</Label>
                  <Input
                    type="number"
                    value={bracket.max || 0}
                    onChange={(e) => {
                      const newBrackets = [...aeBrackets];
                      const val = parseFloat(e.target.value);
                      newBrackets[idx].max = val === 0 ? null : val;
                      setAeBrackets(newBrackets);
                    }}
                  />
                </div>
                <div className="flex-1">
                  <Label>Percent (%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={bracket.percent}
                    onChange={(e) => {
                      const newBrackets = [...aeBrackets];
                      newBrackets[idx].percent = parseFloat(e.target.value);
                      setAeBrackets(newBrackets);
                    }}
                  />
                </div>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => setAeBrackets(aeBrackets.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => setAeBrackets([...aeBrackets, { min: 0, max: null, percent: 0 }])}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Bracket
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AE Revenue Multiplier Brackets</CardTitle>
            <CardDescription>Multipliers applied to closed won amounts before commission calculation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {aeRevenueMultipliers.map((bracket, idx) => (
              <div key={idx} className="flex gap-4 items-end">
                <div className="flex-1">
                  <Label>Min Amount ($)</Label>
                  <Input
                    type="number"
                    value={bracket.min}
                    onChange={(e) => {
                      const newBrackets = [...aeRevenueMultipliers];
                      newBrackets[idx].min = parseFloat(e.target.value);
                      setAeRevenueMultipliers(newBrackets);
                    }}
                  />
                </div>
                <div className="flex-1">
                  <Label>Max Amount ($) - Leave 0 for unlimited</Label>
                  <Input
                    type="number"
                    value={bracket.max || 0}
                    onChange={(e) => {
                      const newBrackets = [...aeRevenueMultipliers];
                      const val = parseFloat(e.target.value);
                      newBrackets[idx].max = val === 0 ? null : val;
                      setAeRevenueMultipliers(newBrackets);
                    }}
                  />
                </div>
                <div className="flex-1">
                  <Label>Multiplier</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={bracket.multiplier}
                    onChange={(e) => {
                      const newBrackets = [...aeRevenueMultipliers];
                      newBrackets[idx].multiplier = parseFloat(e.target.value);
                      setAeRevenueMultipliers(newBrackets);
                    }}
                  />
                </div>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => setAeRevenueMultipliers(aeRevenueMultipliers.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => setAeRevenueMultipliers([...aeRevenueMultipliers, { min: 0, max: null, multiplier: 1.0 }])}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Multiplier Bracket
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AE Payment Term Bonuses</CardTitle>
            <CardDescription>Bonus percentages based on payment terms</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {aePaymentBonuses.map((bonus, idx) => (
              <div key={idx} className="flex gap-4 items-end">
                <div className="flex-1">
                  <Label>Term (e.g., "3 months")</Label>
                  <Input
                    value={bonus.term}
                    onChange={(e) => {
                      const newBonuses = [...aePaymentBonuses];
                      newBonuses[idx].term = e.target.value;
                      setAePaymentBonuses(newBonuses);
                    }}
                  />
                </div>
                <div className="flex-1">
                  <Label>Bonus Percent (%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={bonus.bonus_percent}
                    onChange={(e) => {
                      const newBonuses = [...aePaymentBonuses];
                      newBonuses[idx].bonus_percent = parseFloat(e.target.value);
                      setAePaymentBonuses(newBonuses);
                    }}
                  />
                </div>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => setAePaymentBonuses(aePaymentBonuses.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => setAePaymentBonuses([...aePaymentBonuses, { term: "", bonus_percent: 0 }])}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Bonus
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SDR Meeting Tiers</CardTitle>
            <CardDescription>Weekly meeting bonuses based on meeting counts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sdrMeetingTiers.map((tier, idx) => (
              <div key={idx} className="flex gap-4 items-end">
                <div className="flex-1">
                  <Label>Min Meetings</Label>
                  <Input
                    type="number"
                    value={tier.min}
                    onChange={(e) => {
                      const newTiers = [...sdrMeetingTiers];
                      newTiers[idx].min = parseInt(e.target.value);
                      setSdrMeetingTiers(newTiers);
                    }}
                  />
                </div>
                <div className="flex-1">
                  <Label>Max Meetings - Leave 0 for unlimited</Label>
                  <Input
                    type="number"
                    value={tier.max || 0}
                    onChange={(e) => {
                      const newTiers = [...sdrMeetingTiers];
                      const val = parseInt(e.target.value);
                      newTiers[idx].max = val === 0 ? null : val;
                      setSdrMeetingTiers(newTiers);
                    }}
                  />
                </div>
                <div className="flex-1">
                  <Label>Bonus Amount ($)</Label>
                  <Input
                    type="number"
                    value={tier.bonus_amount}
                    onChange={(e) => {
                      const newTiers = [...sdrMeetingTiers];
                      newTiers[idx].bonus_amount = parseFloat(e.target.value);
                      setSdrMeetingTiers(newTiers);
                    }}
                  />
                </div>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => setSdrMeetingTiers(sdrMeetingTiers.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => setSdrMeetingTiers([...sdrMeetingTiers, { min: 0, max: null, bonus_amount: 0 }])}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Tier
            </Button>

            <Separator className="my-4" />

            <div>
              <Label>SDR Closed Won Percent (%)</Label>
              <Input
                type="number"
                step="0.1"
                value={sdrClosedWonPercent}
                onChange={(e) => setSdrClosedWonPercent(parseFloat(e.target.value))}
              />
              <p className="mt-1 text-sm text-muted-foreground">
                Monthly percentage of closed won deal revenue
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SDR Revenue Multiplier Brackets</CardTitle>
            <CardDescription>Multipliers applied to closed won amounts before commission calculation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sdrRevenueMultipliers.map((bracket, idx) => (
              <div key={idx} className="flex gap-4 items-end">
                <div className="flex-1">
                  <Label>Min Amount ($)</Label>
                  <Input
                    type="number"
                    value={bracket.min}
                    onChange={(e) => {
                      const newBrackets = [...sdrRevenueMultipliers];
                      newBrackets[idx].min = parseFloat(e.target.value);
                      setSdrRevenueMultipliers(newBrackets);
                    }}
                  />
                </div>
                <div className="flex-1">
                  <Label>Max Amount ($) - Leave 0 for unlimited</Label>
                  <Input
                    type="number"
                    value={bracket.max || 0}
                    onChange={(e) => {
                      const newBrackets = [...sdrRevenueMultipliers];
                      const val = parseFloat(e.target.value);
                      newBrackets[idx].max = val === 0 ? null : val;
                      setSdrRevenueMultipliers(newBrackets);
                    }}
                  />
                </div>
                <div className="flex-1">
                  <Label>Multiplier</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={bracket.multiplier}
                    onChange={(e) => {
                      const newBrackets = [...sdrRevenueMultipliers];
                      newBrackets[idx].multiplier = parseFloat(e.target.value);
                      setSdrRevenueMultipliers(newBrackets);
                    }}
                  />
                </div>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => setSdrRevenueMultipliers(sdrRevenueMultipliers.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => setSdrRevenueMultipliers([...sdrRevenueMultipliers, { min: 0, max: null, multiplier: 1.0 }])}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Multiplier Bracket
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Marketing Settings</CardTitle>
            <CardDescription>Configure marketing commission logic</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Use SDR Logic for Marketing</Label>
                <p className="text-sm text-muted-foreground">
                  Apply the same meeting tiers and closed won percentage
                </p>
              </div>
              <Switch
                checked={marketingSameAsSdr}
                onCheckedChange={setMarketingSameAsSdr}
              />
            </div>

            {!marketingSameAsSdr && (
              <div>
                <Label>Marketing Inbound Revenue Percent (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={marketingInboundPercent}
                  onChange={(e) => setMarketingInboundPercent(parseFloat(e.target.value))}
                />
                <p className="mt-1 text-sm text-muted-foreground">
                  Percentage of inbound deal revenue
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Marketing Revenue Multiplier Brackets</CardTitle>
            <CardDescription>Multipliers applied to closed won amounts before commission calculation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {marketingRevenueMultipliers.map((bracket, idx) => (
              <div key={idx} className="flex gap-4 items-end">
                <div className="flex-1">
                  <Label>Min Amount ($)</Label>
                  <Input
                    type="number"
                    value={bracket.min}
                    onChange={(e) => {
                      const newBrackets = [...marketingRevenueMultipliers];
                      newBrackets[idx].min = parseFloat(e.target.value);
                      setMarketingRevenueMultipliers(newBrackets);
                    }}
                  />
                </div>
                <div className="flex-1">
                  <Label>Max Amount ($) - Leave 0 for unlimited</Label>
                  <Input
                    type="number"
                    value={bracket.max || 0}
                    onChange={(e) => {
                      const newBrackets = [...marketingRevenueMultipliers];
                      const val = parseFloat(e.target.value);
                      newBrackets[idx].max = val === 0 ? null : val;
                      setMarketingRevenueMultipliers(newBrackets);
                    }}
                  />
                </div>
                <div className="flex-1">
                  <Label>Multiplier</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={bracket.multiplier}
                    onChange={(e) => {
                      const newBrackets = [...marketingRevenueMultipliers];
                      newBrackets[idx].multiplier = parseFloat(e.target.value);
                      setMarketingRevenueMultipliers(newBrackets);
                    }}
                  />
                </div>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => setMarketingRevenueMultipliers(marketingRevenueMultipliers.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => setMarketingRevenueMultipliers([...marketingRevenueMultipliers, { min: 0, max: null, multiplier: 1.0 }])}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Multiplier Bracket
            </Button>
          </CardContent>
        </Card>

        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="w-full"
        >
          {saveMutation.isPending ? "Saving..." : "Save All Settings"}
        </Button>
      </div>
    </Layout>
  );
}
