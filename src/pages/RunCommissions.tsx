import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import Layout from "@/components/Layout";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function RunCommissions() {
  const [selectedRep, setSelectedRep] = useState<string>("");
  const [repName, setRepName] = useState<string>("");
  const [repTeam, setRepTeam] = useState<string>("");
  const [startDate, setStartDate] = useState<Date>(startOfMonth(subMonths(new Date(), 1)));
  const [endDate, setEndDate] = useState<Date>(endOfMonth(subMonths(new Date(), 1)));
  const [results, setResults] = useState<any>(null);

  // Fetch real HubSpot owners
  const { data: ownersData, isLoading: isLoadingOwners } = useQuery({
    queryKey: ["hubspot-owners"],
    queryFn: async () => {
      const response = await supabase.functions.invoke("fetch-hubspot-owners");
      if (response.error) throw response.error;
      return response.data;
    },
  });

  const hubspotOwners = ownersData?.owners || [];

  const calculateMutation = useMutation({
    mutationFn: async () => {
      const response = await supabase.functions.invoke("calculate-commission", {
        body: {
          repId: selectedRep,
          repName,
          team: repTeam,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: (data) => {
      setResults(data);
      toast.success("Commission calculated successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to calculate commission");
    },
  });

  const testLastMonthMutation = useMutation({
    mutationFn: async () => {
      const lastMonthStart = startOfMonth(subMonths(new Date(), 1));
      const lastMonthEnd = endOfMonth(subMonths(new Date(), 1));
      
      const response = await supabase.functions.invoke("calculate-commission", {
        body: {
          repId: selectedRep,
          repName,
          team: repTeam,
          startDate: lastMonthStart.toISOString(),
          endDate: lastMonthEnd.toISOString(),
        },
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: (data) => {
      setResults(data);
      toast.success(`Successfully retrieved last month's data (${format(subMonths(new Date(), 1), 'MMM yyyy')})`);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to retrieve last month's data");
    },
  });

  const syncToHubSpotMutation = useMutation({
    mutationFn: async () => {
      const response = await supabase.functions.invoke("sync-to-hubspot", {
        body: results,
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: () => {
      toast.success("Successfully synced to HubSpot");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to sync to HubSpot");
    },
  });

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold text-foreground">Run Commissions</h2>
          <p className="mt-2 text-muted-foreground">Calculate commissions for a specific rep and period</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Select Parameters</CardTitle>
            <CardDescription>Choose rep and date range</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Sales Representative</Label>
              <Select
                value={selectedRep}
                onValueChange={(value) => {
                  setSelectedRep(value);
                  const owner = hubspotOwners.find(o => o.id === value);
                  if (owner) {
                    setRepName(owner.name);
                    setRepTeam(owner.team);
                  }
                }}
                disabled={isLoadingOwners}
              >
                <SelectTrigger>
                  <SelectValue placeholder={isLoadingOwners ? "Loading owners..." : "Select a rep"} />
                </SelectTrigger>
                <SelectContent>
                  {hubspotOwners.map((owner: any) => (
                    <SelectItem key={owner.id} value={owner.id}>
                      {owner.name} ({owner.team})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Start Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(startDate, "PPP")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={startDate} onSelect={(date) => date && setStartDate(date)} />
                  </PopoverContent>
                </Popover>
              </div>

              <div>
                <Label>End Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(endDate, "PPP")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={endDate} onSelect={(date) => date && setEndDate(date)} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => calculateMutation.mutate()}
                disabled={!selectedRep || calculateMutation.isPending}
                className="flex-1"
              >
                {calculateMutation.isPending ? "Calculating..." : "Run Calculation"}
              </Button>
              <Button
                variant="outline"
                onClick={() => testLastMonthMutation.mutate()}
                disabled={!selectedRep || testLastMonthMutation.isPending}
                className="flex-1"
              >
                {testLastMonthMutation.isPending ? "Loading..." : "Test Last Month"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {results && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Commission Results</CardTitle>
                <CardDescription>
                  {results.repName} ({results.team}) - {format(new Date(results.periodStart), "MMM d, yyyy")} to{" "}
                  {format(new Date(results.periodEnd), "MMM d, yyyy")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Revenue</p>
                    <p className="text-2xl font-bold text-foreground">
                      ${(results.totalRevenue ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Commission</p>
                    <p className="text-2xl font-bold text-success">
                      ${(results.totalCommission ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Deal Commission</p>
                    <p className="text-2xl font-bold text-foreground">
                      ${(results.dealCommission ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Meeting Bonus</p>
                    <p className="text-2xl font-bold text-accent">
                      ${(results.meetingBonus ?? 0).toLocaleString()}
                    </p>
                  </div>
                </div>

                {results.team === "AE" && results.usedBracketPercent && (
                  <div className="mt-6">
                    <Badge variant="secondary">Bracket: {results.usedBracketPercent}%</Badge>
                  </div>
                )}

                {results.weeklyBreakdown && results.weeklyBreakdown.length > 0 && (
                  <div className="mt-6">
                    <h4 className="mb-4 font-semibold text-foreground">Weekly Breakdown</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Week</TableHead>
                          <TableHead>Meetings</TableHead>
                          <TableHead>Bonus</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {results.weeklyBreakdown.map((week: any, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell>{week.weekLabel || `Week ${week.week}`}</TableCell>
                            <TableCell>{week.meetings}</TableCell>
                            <TableCell>${week.bonus?.toLocaleString() ?? 0}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {results.debugMeetings && results.debugMeetings.length > 0 && (
                  <div style={{ marginTop: "24px" }}>
                    <h3>Meetings Used in Calculation ({results.debugMeetings.length})</h3>

                    {results.debugMeetings.map((m: any, i: number) => (
                      <div 
                        key={i} 
                        style={{ 
                          border: "1px solid #ddd", 
                          borderRadius: "6px",
                          padding: "12px", 
                          marginBottom: "12px"
                        }}
                      >
                        <p><strong>Name:</strong> {m.meetingName}</p>
                        <p><strong>Timestamp:</strong> {m.timestamp}</p>
                        <p><strong>Activity Type:</strong> {m.activityType}</p>
                        <p><strong>Status:</strong> {m.status}</p>
                        <p><strong>Created By:</strong> {m.createdBy || "(unknown)"}</p>
                        <p><strong>Associated Deals:</strong> {m.associatedDeals?.length > 0 ? m.associatedDeals.join(", ") : "(none)"}</p>
                        <p><strong>Associated Contacts:</strong> {m.associatedContacts?.length > 0 ? m.associatedContacts.join(", ") : "(none)"}</p>

                        <details style={{ marginTop: "10px" }}>
                          <summary>Show All Properties</summary>
                          <pre style={{ whiteSpace: "pre-wrap", fontSize: "12px" }}>
                            {JSON.stringify(m.allProperties, null, 2)}
                          </pre>
                        </details>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Button
              onClick={() => syncToHubSpotMutation.mutate()}
              disabled={syncToHubSpotMutation.isPending}
              variant="default"
              className="w-full"
            >
              {syncToHubSpotMutation.isPending ? "Syncing..." : "Sync to HubSpot"}
            </Button>
          </>
        )}
      </div>
    </Layout>
  );
}
